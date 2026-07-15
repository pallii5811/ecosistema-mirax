"""Fail-closed, default-off worker bridge for the v5 source orchestrator."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, MutableMapping, Optional, Sequence, Tuple

from .catalog import SourceCapabilityRegistry, default_source_capability_registry
from .contracts import DiscoveryCursor, OpportunityCandidate
from .orchestrator import OrchestrationResult, ProgressCallback, UniversalSourceOrchestrator, request_from_plan


_MAX_SHADOW_CAP_EUR = 0.125
def _truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ShadowRuntimeDecision:
    enabled: bool
    reason: str


def source_adapter_shadow_decision(
    intent: object,
    *,
    environ: Optional[Mapping[str, str]] = None,
) -> ShadowRuntimeDecision:
    env = environ or os.environ
    if not _truthy(env.get("MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED")):
        return ShadowRuntimeDecision(False, "SOURCE_ADAPTER_SHADOW_DISABLED")
    if _truthy(env.get("MIRAX_SEARCH_DISABLED", "1")):
        return ShadowRuntimeDecision(False, "MIRAX_SEARCH_DISABLED")
    if not isinstance(intent, Mapping):
        return ShadowRuntimeDecision(False, "SHADOW_INTENT_MISSING")
    checks = (
        str(intent.get("lifecycle_stage") or "") == "v5_shadow",
        intent.get("customer_visible") is False,
        intent.get("prepare_only") is False,
        intent.get("execution_authorized") is True,
        intent.get("source_adapter_shadow") is True,
    )
    if not all(checks):
        return ShadowRuntimeDecision(False, "SOURCE_ADAPTER_SHADOW_NOT_AUTHORIZED")
    uqe = intent.get("uqe_plan") if isinstance(intent.get("uqe_plan"), Mapping) else {}
    plan = uqe.get("canonical_plan") if isinstance(uqe.get("canonical_plan"), Mapping) else intent.get("canonical_plan")
    if not isinstance(plan, Mapping):
        return ShadowRuntimeDecision(False, "CANONICAL_PLAN_MISSING")
    return ShadowRuntimeDecision(True, "AUTHORIZED_SHADOW_ONLY")


def _canonical_plan(intent: Mapping[str, Any]) -> Mapping[str, Any]:
    uqe = intent.get("uqe_plan") if isinstance(intent.get("uqe_plan"), Mapping) else {}
    plan = uqe.get("canonical_plan") if isinstance(uqe.get("canonical_plan"), Mapping) else intent.get("canonical_plan")
    if not isinstance(plan, Mapping):
        raise ValueError("canonical shadow plan is required")
    return plan


def _hard_cap(plan: Mapping[str, Any], environ: Mapping[str, str]) -> float:
    budget = plan.get("budget_policy") if isinstance(plan.get("budget_policy"), Mapping) else {}
    plan_cap = float(budget.get("hard_cost_eur") or _MAX_SHADOW_CAP_EUR)
    configured = float(environ.get("MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR") or _MAX_SHADOW_CAP_EUR)
    return max(0.0, min(_MAX_SHADOW_CAP_EUR, plan_cap, configured))


def _mandatory_adapter_ids(intent: Mapping[str, Any], plan: Mapping[str, Any]) -> Tuple[str, ...]:
    uqe = intent.get("uqe_plan") if isinstance(intent.get("uqe_plan"), Mapping) else {}
    source_coverage = uqe.get("source_coverage") if isinstance(uqe.get("source_coverage"), Mapping) else {}
    adapter_ids = source_coverage.get("adapter_ids")
    if isinstance(adapter_ids, list) and adapter_ids:
        return tuple(dict.fromkeys(str(item).strip() for item in adapter_ids if str(item).strip()))
    source_plan = uqe.get("source_plan") if isinstance(uqe.get("source_plan"), list) else []
    collected: list[str] = []
    for lane in source_plan:
        if not isinstance(lane, Mapping) or lane.get("execution_mode") != "adapter":
            continue
        for adapter_id in lane.get("adapter_ids") or ():
            text = str(adapter_id).strip()
            if text:
                collected.append(text)
    if collected:
        return tuple(dict.fromkeys(collected))
    return ()


async def execute_source_adapter_shadow(
    intent: Mapping[str, Any],
    *,
    requested_count: int,
    registry: Optional[SourceCapabilityRegistry] = None,
    progress_callback: Optional[ProgressCallback] = None,
    environ: Optional[Mapping[str, str]] = None,
    persistent_client: Any = None,
    search_id: Optional[str] = None,
    resume_state: Optional[Mapping[str, Any]] = None,
) -> OrchestrationResult:
    env = environ or os.environ
    decision = source_adapter_shadow_decision(intent, environ=env)
    if not decision.enabled:
        raise PermissionError(decision.reason)
    from backend_mirror.contracts.commercial_search_plan import validate_commercial_search_plan
    from backend_mirror.contracts.signal_ontology import validate_plan_signals
    from backend_mirror.contracts.source_registry import validate_plan_source_policy

    plan = validate_commercial_search_plan(_canonical_plan(intent)).model_dump(mode="json")
    validate_plan_signals(plan)
    validate_plan_source_policy(plan)
    cap = _hard_cap(plan, env)
    if cap <= 0:
        raise PermissionError("SOURCE_ADAPTER_SHADOW_ZERO_BUDGET")
    if (persistent_client is None) != (search_id is None):
        raise ValueError("persistent_client and search_id must be provided together")
    resume = dict(resume_state or intent.get("shadow_resume") or {})
    prior_cost_eur = float(resume.get("prior_cost_eur") or 0.0)
    request = request_from_plan(plan, requested_count=max(1, requested_count), budget_eur=cap)
    source_policy = plan.get("source_policy") or {}
    preferred = tuple(str(item) for item in source_policy.get("preferred_source_classes") or ())
    mandatory = _mandatory_adapter_ids(intent, plan)
    resume_cursors: dict[str, DiscoveryCursor] = {}
    for adapter_id, cursor_value in dict(resume.get("resume_cursors") or {}).items():
        text = str(cursor_value or "").strip()
        if text:
            resume_cursors[str(adapter_id)] = DiscoveryCursor(text)
    # worker_supabase exposes backend_mirror on sys.path and paid providers
    # import these modules by their runtime names. Reusing that exact namespace
    # avoids creating a second ContextVar that provider threads cannot see.
    from cost_context import reset_current_cost_governor, set_current_cost_governor
    from cost_governor import ResearchCostGovernor

    governor = ResearchCostGovernor.from_plan(
        {"canonical_plan": plan, "_prior_cost_eur": prior_cost_eur},
        requested_count,
        persistent_client=persistent_client,
        search_id=search_id,
    )
    token = set_current_cost_governor(governor)
    try:
        orchestrator = UniversalSourceOrchestrator(registry or default_source_capability_registry())
        result = await orchestrator.run(
            request,
            required_source_classes=preferred,
            mandatory_adapter_ids=mandatory,
            progress_callback=progress_callback,
            resume_cursors=resume_cursors or None,
        )
    finally:
        reset_current_cost_governor(token)
    if result.cost_eur + prior_cost_eur > cap + 1e-9:
        raise RuntimeError("SOURCE_ADAPTER_SHADOW_HARD_CAP_EXCEEDED")
    if governor.committed_micro_eur > governor.hard_micro_eur:
        raise RuntimeError("SOURCE_ADAPTER_SHADOW_PERSISTENT_CAP_EXCEEDED")
    if result.progress.published_count != 0:
        raise RuntimeError("SOURCE_ADAPTER_SHADOW_PUBLICATION_FORBIDDEN")
    return result


def build_shadow_resume_state(
    result: OrchestrationResult,
    *,
    qualified_lead_payloads: Sequence[Mapping[str, Any]],
    prior_state: Optional[Mapping[str, Any]] = None,
    requested_count: int,
) -> dict[str, Any]:
    prior = dict(prior_state or {})
    resume_cursors: dict[str, str] = dict(prior.get("resume_cursors") or {})
    provider_exhausted = True
    acquisition: dict[str, Any] = dict(prior.get("acquisition") or {})
    for item in result.adapter_progress:
        if item.next_cursor is not None:
            resume_cursors[item.adapter_id] = item.next_cursor.value
        provider_exhausted = provider_exhausted and item.exhausted
        if item.acquisition_telemetry:
            acquisition.update(dict(item.acquisition_telemetry))
    processed_domains = list(dict.fromkeys(
        list(prior.get("processed_domains") or [])
        + [
            str(payload.get("sito") or payload.get("website") or "").replace("https://", "").replace("http://", "").split("/")[0]
            for payload in qualified_lead_payloads
            if isinstance(payload, Mapping)
        ]
    ))
    cumulative_orchestrator = len(qualified_lead_payloads)
    resumable = (
        result.status == "partial_time_limit"
        and not provider_exhausted
        and cumulative_orchestrator < requested_count
        and bool(resume_cursors)
    )
    return {
        "resumable": resumable,
        "resume_cursors": resume_cursors,
        "prior_cost_eur": round(float(prior.get("prior_cost_eur") or 0.0) + float(result.cost_eur or 0.0), 6),
        "cumulative_orchestrator_qualified": cumulative_orchestrator,
        "qualified_lead_payloads": [dict(item) for item in qualified_lead_payloads if isinstance(item, Mapping)],
        "processed_domains": processed_domains,
        "acquisition": acquisition,
        "termination_reason": result.status,
        "provider_exhausted": provider_exhausted,
    }


def merge_shadow_qualified_payloads(
    prior_payloads: Sequence[Mapping[str, Any]],
    new_payloads: Sequence[Mapping[str, Any]],
) -> list[MutableMapping[str, Any]]:
    merged: dict[str, MutableMapping[str, Any]] = {}
    for payload in (*prior_payloads, *new_payloads):
        if not isinstance(payload, Mapping):
            continue
        domain = str(payload.get("sito") or payload.get("website") or "").lower().replace("https://", "").replace("http://", "").split("/")[0]
        if domain.startswith("www."):
            domain = domain[4:]
        if domain:
            merged[domain] = dict(payload)
    return list(merged.values())


def candidate_to_lifecycle_shadow_payload(
    candidate: OpportunityCandidate,
    *,
    opportunity_value_score: float,
) -> MutableMapping[str, Any]:
    if not candidate.official_domain_verified:
        raise ValueError("shadow payload requires verified official domain")
    verification = candidate.provenance.get("domain_verification")
    if not isinstance(verification, Mapping):
        raise ValueError("shadow payload requires domain verification provenance")
    now = datetime.now(timezone.utc).isoformat()
    contacts = {item.kind: item.value for item in candidate.contacts if item.verified}
    signals = []
    for evidence in candidate.evidence:
        signals.append({
            "type": evidence.signal_id,
            "source_url": evidence.source_url,
            "source_class": evidence.source_class,
            "source_publisher": evidence.source_publisher,
            "evidence": evidence.excerpt,
            "observed_at": evidence.observed_at,
            "published_at": evidence.published_at,
            "confidence": evidence.confidence,
            "status": "verified",
            "retrieval_method": evidence.extraction_method,
            "contradiction_status": "none",
        })
    geography = next((item for item in candidate.geographies if item), "")
    size = str(candidate.provenance.get("company_size") or candidate.provenance.get("company_size_class") or "unknown")
    return {
        "azienda": candidate.canonical_company_name,
        "name": candidate.canonical_company_name,
        "legal_name": candidate.canonical_company_name,
        "sito": f"https://{candidate.official_domain}",
        "website": f"https://{candidate.official_domain}",
        "entity_type": "company",
        "citta": geography,
        "company_size_class": size,
        "operating_company_probability": 0.95 if candidate.entity_class == "operating_company" else 0.0,
        "source_adapter_id": candidate.adapter_id,
        "domain_verification": dict(verification),
        "business_signals": signals,
        "matched_signals": list(dict.fromkeys(item.signal_id for item in candidate.evidence)),
        "required_signals": list(dict.fromkeys(item.signal_id for item in candidate.evidence)),
        "why_now": candidate.why_now,
        "signal_confidence": candidate.confidence,
        "hotness_score": round(opportunity_value_score * 100, 2),
        "lead_quality_contract": {
            "score": round(float(candidate.buyer_fit or 0.0) * 100, 2),
            "official_domain_present": True,
            "source_adapter_id": candidate.adapter_id,
        },
        "telefono": contacts.get("phone"),
        "email": contacts.get("email"),
        "last_audited_at": now,
        "technical_report": {
            "audit_status": "complete",
            "source_adapter_id": candidate.adapter_id,
            "source_adapter_version": candidate.adapter_version,
            "domain_verification": dict(verification),
        },
        "contradiction_flags": list(candidate.contradiction_flags),
        "source": "v5_source_adapter_shadow",
        "customer_visible": False,
    }


def serialize_shadow_qualified_leads(result: OrchestrationResult) -> list[MutableMapping[str, Any]]:
    return [
        candidate_to_lifecycle_shadow_payload(
            lead.candidate,
            opportunity_value_score=lead.opportunity_value_score,
        )
        for lead in result.qualified_leads
    ]
