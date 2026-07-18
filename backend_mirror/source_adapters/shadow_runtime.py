"""Fail-closed, default-off worker bridge for the v5 source orchestrator."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Mapping, MutableMapping, Optional, Sequence, Tuple

from .catalog import SourceCapabilityRegistry, default_source_capability_registry
from .contracts import DiscoveryCursor, OpportunityCandidate
from .hiring_qualification import (
    collect_processed_employer_keys,
    count_unique_employer_keys,
    employer_key_from_payload,
    merge_related_opportunity,
    related_opportunity_from_payload,
    evaluate_vacancy_geography,
)
from .orchestrator import OrchestrationResult, ProgressCallback, request_from_plan


_MAX_SHADOW_CAP_EUR = 0.125


def revalidate_hiring_payload_geographies(
    payloads: Sequence[Mapping[str, Any]],
    geographies: Sequence[str],
) -> tuple[list[MutableMapping[str, Any]], list[MutableMapping[str, Any]]]:
    """Remove out-of-scope Hiring payloads from resume counting while retaining forensic outcomes."""
    accepted: list[MutableMapping[str, Any]] = []
    rejected: list[MutableMapping[str, Any]] = []
    for item in payloads:
        if not isinstance(item, Mapping):
            continue
        payload = dict(item)
        signals = {str(value) for value in payload.get("matched_signals") or ()}
        is_hiring = payload.get("source_adapter_id") == "structured_hiring_v1" or any(
            value.startswith("hiring") for value in signals
        )
        if not is_hiring:
            accepted.append(payload)
            continue
        assessment = evaluate_vacancy_geography(
            location=str(payload.get("citta") or payload.get("location") or ""),
            title=str(payload.get("vacancy_title") or payload.get("hiring_title") or ""),
            address_locality=str(payload.get("address_locality") or ""),
            address_region=str(payload.get("address_region") or ""),
            address_country=str(payload.get("address_country") or ""),
            additional_locations=payload.get("additional_locations") or (),
            source_url=str(payload.get("vacancy_url") or ""),
            geographies=geographies,
        )
        payload.update(assessment.to_dict())
        if assessment:
            accepted.append(payload)
        else:
            payload["rejection_code"] = assessment.geography_rejection_code
            payload["geography_revalidated"] = True
            rejected.append(payload)
    return accepted, rejected
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
    prior_payloads_raw = [
        item for item in (resume.get("qualified_lead_payloads") or ())
        if isinstance(item, Mapping)
    ]
    prior_payloads, geography_rejected = revalidate_hiring_payload_geographies(
        prior_payloads_raw,
        tuple(str(item) for item in plan.get("target", {}).get("geographies") or ()),
    )
    if geography_rejected:
        resume["geography_revalidation_rejections"] = geography_rejected
        resume["qualified_lead_payloads"] = prior_payloads
    hiring_revalidated = any(
        item.get("source_adapter_id") == "structured_hiring_v1"
        for item in prior_payloads_raw
    )
    processed_employer_keys = collect_processed_employer_keys(
        () if hiring_revalidated else (resume.get("processed_employer_keys") or ()),
        prior_payloads,
    )
    total_unique_target = int(resume.get("total_unique_employer_target") or 0)
    if total_unique_target <= 0:
        total_unique_target = max(1, int(requested_count) + len(processed_employer_keys))
    request = request_from_plan(plan, requested_count=max(1, int(requested_count)), budget_eur=cap)
    request = replace(
        request,
        technical_filters={
            **request.technical_filters,
            "processed_employer_keys": processed_employer_keys,
            "processed_domains": tuple(resume.get("processed_domains") or ()),
            "processed_identity_hashes": tuple(resume.get("processed_identity_hashes") or ()),
            "cumulative_raw_unique": int(resume.get("cumulative_raw_unique") or 0),
            "cumulative_audited": int(resume.get("cumulative_audited") or 0),
            "cumulative_qualified_unique": len(processed_employer_keys),
            "total_unique_employer_target": total_unique_target,
        },
    )
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
        from .universal_signal_discovery_engine import UniversalSignalDiscoveryEngine

        engine = UniversalSignalDiscoveryEngine(registry or default_source_capability_registry())
        engine_result = await engine.run(
            request,
            plan=plan,
            required_source_classes=preferred,
            mandatory_adapter_ids=mandatory,
            progress_callback=progress_callback,
            resume_cursors=resume_cursors or None,
        )
        result = engine_result.orchestration
        # Keep shadow fail-closed for customer visibility; telemetry stays in limitations.
        if engine_result.notes:
            result = replace(
                result,
                limitations=tuple(dict.fromkeys((*result.limitations, *engine_result.notes, f"universal_capability:{engine_result.capability_status}"))),
            )
        committed_run_cost = max(
            0.0,
            governor.committed_micro_eur / 1_000_000 - prior_cost_eur,
        )
        if committed_run_cost > result.cost_eur:
            result = replace(result, cost_eur=committed_run_cost)
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
    provider_exhausted_authoritative = True
    acquisition: dict[str, Any] = dict(prior.get("acquisition") or {})
    for item in result.adapter_progress:
        if item.next_cursor is not None:
            resume_cursors[item.adapter_id] = item.next_cursor.value
        elif item.exhausted:
            resume_cursors.pop(item.adapter_id, None)
        provider_exhausted = provider_exhausted and item.exhausted
        provider_exhausted_authoritative = (
            provider_exhausted_authoritative
            and item.exhausted
            and bool(getattr(item, "exhaustion_authoritative", False))
        )
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
    processed_employer_keys = collect_processed_employer_keys(
        prior.get("processed_employer_keys") or (),
        qualified_lead_payloads,
    )
    cumulative_orchestrator = len(processed_employer_keys)
    resumable = (
        cumulative_orchestrator < requested_count
        and (
            result.status == "partial_time_limit"
            or (
                result.status == "completed_requested_count"
                and cumulative_orchestrator < requested_count
            )
            or (not provider_exhausted_authoritative and bool(resume_cursors))
        )
    )
    processed_identity_hashes = tuple(dict.fromkeys(
        list(prior.get("processed_identity_hashes") or ())
        + list(acquisition.get("processed_identity_hashes") or ())
    ))
    return {
        "resumable": resumable,
        "resume_cursors": resume_cursors,
        "prior_cost_eur": round(float(prior.get("prior_cost_eur") or 0.0) + float(result.cost_eur or 0.0), 6),
        "cumulative_orchestrator_qualified": cumulative_orchestrator,
        "unique_lifecycle_accepted_count": cumulative_orchestrator,
        "processed_employer_keys": list(processed_employer_keys),
        "total_unique_employer_target": int(prior.get("total_unique_employer_target") or requested_count),
        "qualified_lead_payloads": [dict(item) for item in qualified_lead_payloads if isinstance(item, Mapping)],
        "processed_domains": processed_domains,
        "processed_identity_hashes": list(processed_identity_hashes),
        "processed_place_ids_ref": acquisition.get("processed_place_ids_ref") or prior.get("processed_place_ids_ref"),
        "cumulative_raw_unique": int(acquisition.get("cumulative_raw_unique") or prior.get("cumulative_raw_unique") or 0),
        "cumulative_audited": int(acquisition.get("cumulative_audited") or prior.get("cumulative_audited") or 0),
        "cumulative_qualified_unique": cumulative_orchestrator,
        "acquisition": acquisition,
        "termination_reason": result.status,
        "provider_exhausted": provider_exhausted_authoritative,
        "provider_exhausted_authoritative": provider_exhausted_authoritative,
    }


def merge_shadow_qualified_payloads(
    prior_payloads: Sequence[Mapping[str, Any]],
    new_payloads: Sequence[Mapping[str, Any]],
) -> list[MutableMapping[str, Any]]:
    merged: dict[str, MutableMapping[str, Any]] = {}
    for payload in prior_payloads:
        if not isinstance(payload, Mapping):
            continue
        key = employer_key_from_payload(payload)
        if not key:
            continue
        frozen = dict(payload)
        frozen.setdefault("related_opportunities", list(frozen.get("related_opportunities") or ()))
        merged[key] = frozen
    for payload in new_payloads:
        if not isinstance(payload, Mapping):
            continue
        key = employer_key_from_payload(payload)
        if not key:
            continue
        if key in merged:
            related = related_opportunity_from_payload(payload)
            existing = merged[key].get("related_opportunities") or []
            merged[key]["related_opportunities"] = list(merge_related_opportunity(existing, related))
            continue
        fresh = dict(payload)
        fresh.setdefault("related_opportunities", [])
        merged[key] = fresh
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
    size = str(
        candidate.provenance.get("company_size")
        or candidate.provenance.get("company_size_class")
        or ""
    ).strip()
    employee_count = candidate.provenance.get("employee_count")
    if not size or employee_count is None:
        for evidence in candidate.evidence:
            ev_prov = evidence.provenance if isinstance(evidence.provenance, dict) else {}
            if not size and ev_prov.get("company_size"):
                size = str(ev_prov["company_size"]).strip()
            if employee_count is None and ev_prov.get("employee_count") is not None:
                employee_count = ev_prov["employee_count"]
            if size and employee_count is not None:
                break
    if not size:
        size = "unknown"
    employer_domain = str(
        candidate.provenance.get("employer_official_domain")
        or candidate.official_domain
        or ""
    ).strip()
    semantic_grounding = (
        dict(candidate.provenance.get("semantic_grounding"))
        if isinstance(candidate.provenance.get("semantic_grounding"), Mapping)
        else {}
    )
    grounded_items = semantic_grounding.get("grounded_evidence") or ()
    grounded_interpretation = next((
        item.get("interpretation") for item in grounded_items
        if isinstance(item, Mapping) and isinstance(item.get("interpretation"), Mapping)
    ), {})
    public_source = candidate.evidence[0].source_url if candidate.evidence else f"https://{candidate.official_domain}"
    legal_name = str(candidate.company_identifiers.get("legal_name") or "").strip() or None

    def field(value: Any, status: str, confidence: float, source: Optional[str] = None) -> Mapping[str, Any]:
        return {
            "value": value,
            "source": source or public_source,
            "confidence": round(max(0.0, min(1.0, confidence)), 4),
            "observed_at": now,
            "status": status,
        }

    field_provenance = {
        "company_name": field(candidate.canonical_company_name, "verified", candidate.official_domain_confidence),
        "official_domain": field(candidate.official_domain, "verified", candidate.official_domain_confidence),
        "legal_name": field(legal_name, "verified" if legal_name else "unavailable", 0.9 if legal_name else 0.0),
        "location": field(
            geography or None,
            "verified" if candidate.provenance.get("geography_match") is True else "inferred" if geography else "unavailable",
            0.9 if candidate.provenance.get("geography_match") is True else 0.6 if geography else 0.0,
        ),
        "phone": field(contacts.get("phone"), "verified" if contacts.get("phone") else "unavailable", 0.9 if contacts.get("phone") else 0.0),
        "email": field(contacts.get("email"), "verified" if contacts.get("email") else "unavailable", 0.9 if contacts.get("email") else 0.0),
        "signal_event": field(candidate.signal_id, "verified", candidate.confidence),
        "event_date": field(candidate.signal_date, "verified" if candidate.signal_date else "unavailable", candidate.confidence if candidate.signal_date else 0.0),
        "evidence": field(candidate.evidence[0].excerpt if candidate.evidence else None, "verified" if candidate.evidence else "unavailable", candidate.confidence),
        "buyer_need": field(grounded_interpretation.get("buyer_need") or None, "inferred" if grounded_interpretation.get("buyer_need") else "unavailable", candidate.confidence),
        "why_now": field(candidate.why_now, "inferred" if candidate.why_now else "unavailable", candidate.confidence),
        "opportunity_score": field(round(opportunity_value_score * 100, 2), "inferred", candidate.confidence),
        "company_size": field(size if size != "unknown" else None, "inferred" if size != "unknown" else "unavailable", 0.65 if size != "unknown" else 0.0),
        "revenue": field(None, "unavailable", 0.0),
        "decision_makers": field(None, "unavailable", 0.0),
    }
    payload: MutableMapping[str, Any] = {
        "azienda": candidate.canonical_company_name,
        "name": candidate.canonical_company_name,
        "legal_name": legal_name,
        "sito": f"https://{candidate.official_domain}",
        "website": f"https://{candidate.official_domain}",
        "entity_type": "company",
        "citta": geography,
        "company_size_class": size,
        **({"employee_count": employee_count} if employee_count is not None else {}),
        "employer_is_direct": candidate.provenance.get("employer_is_direct") is True,
        "vacancy_url": candidate.provenance.get("vacancy_url"),
        "vacancy_title": candidate.provenance.get("vacancy_title"),
        "vacancy_source_domain": candidate.provenance.get("vacancy_source_domain"),
        "location": candidate.provenance.get("location") or geography,
        "address_locality": candidate.provenance.get("address_locality"),
        "address_region": candidate.provenance.get("address_region"),
        "address_country": candidate.provenance.get("address_country"),
        "additional_locations": list(candidate.provenance.get("additional_locations") or ()),
        "geography_match": candidate.provenance.get("geography_match") is True,
        "requested_geographies": list(candidate.provenance.get("requested_geographies") or ()),
        "normalized_country": candidate.provenance.get("normalized_country"),
        "matched_geography": candidate.provenance.get("matched_geography"),
        "geography_match_method": candidate.provenance.get("geography_match_method"),
        "geography_match_evidence": candidate.provenance.get("geography_match_evidence"),
        "geography_rejection_code": candidate.provenance.get("geography_rejection_code"),
        "acquisition_geography": candidate.provenance.get("geography_match_evidence"),
        "employer_official_domain": employer_domain or None,
        "operating_company_probability": 0.95 if candidate.entity_class == "operating_company" else 0.0,
        "source_adapter_id": candidate.adapter_id,
        "semantic_grounding": semantic_grounding or None,
        "field_provenance": field_provenance,
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
            "semantic_grounding": semantic_grounding or None,
            "field_provenance": field_provenance,
            "geography": {
                "geography_match": candidate.provenance.get("geography_match") is True,
                "requested_geographies": list(candidate.provenance.get("requested_geographies") or ()),
                "normalized_country": candidate.provenance.get("normalized_country"),
                "matched_geography": candidate.provenance.get("matched_geography"),
                "geography_match_method": candidate.provenance.get("geography_match_method"),
                "geography_match_evidence": candidate.provenance.get("geography_match_evidence"),
                "geography_rejection_code": candidate.provenance.get("geography_rejection_code"),
            },
        },
        "contradiction_flags": list(candidate.contradiction_flags),
        "source": "v5_source_adapter_shadow",
        "customer_visible": False,
    }
    return payload


def serialize_shadow_qualified_leads(result: OrchestrationResult) -> list[MutableMapping[str, Any]]:
    return [
        candidate_to_lifecycle_shadow_payload(
            lead.candidate,
            opportunity_value_score=lead.opportunity_value_score,
        )
        for lead in result.qualified_leads
    ]
