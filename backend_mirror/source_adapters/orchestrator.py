"""Breadth-first orchestration over executable MIRAX source adapters."""

from __future__ import annotations

import time
import inspect
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Literal, Mapping, Optional, Sequence, Tuple

from .catalog import CapabilityCoverage, SourceAdapterRegistryMismatchError, SourceCapabilityRegistry
from .contracts import (
    AdapterDiscoveryRequest,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    QualifiedLead,
    SourceAdapter,
)
from .opportunity_scoring import score_opportunity


_SEO_GROUP_SIGNALS = frozenset({"website_weakness", "seo_errors", "site_stale"})
_TRACKING_ABSENCE_SIGNALS = frozenset({
    "missing_advertising_pixel", "missing_analytics", "no_pixel", "no_gtm",
})


def _signal_groups_from_required_signals(signals: Sequence[str]) -> Optional[List[List[str]]]:
    seo = [signal for signal in signals if signal in _SEO_GROUP_SIGNALS]
    tracking = [signal for signal in signals if signal in _TRACKING_ABSENCE_SIGNALS]
    if seo and tracking:
        return [seo, tracking]
    return None


def _evidence_satisfies_request(evidence_signals: set[str], request: AdapterDiscoveryRequest) -> bool:
    groups = request.technical_filters.get("signal_groups")
    if isinstance(groups, list) and groups:
        for group in groups:
            if not isinstance(group, (list, tuple)):
                continue
            if not any(str(signal) in evidence_signals for signal in group):
                return False
        return True
    if request.signal_match_mode == "all":
        return set(request.signal_ids).issubset(evidence_signals)
    return bool(evidence_signals.intersection(request.signal_ids))


TerminalStatus = Literal[
    "completed_requested_count",
    "partial_market_exhausted",
    "partial_sources_exhausted",
    "provider_exhausted_authoritative",
    "raw_safety_cap_reached",
    "partial_budget_exhausted",
    "partial_time_limit",
    "clarification_required",
    "failed_recoverable",
    "failed_terminal",
]


@dataclass(frozen=True)
class QualificationDecision:
    qualified: bool
    audited: bool
    evidence_verified: bool
    rejection_code: Optional[str] = None
    opportunity_value_score: float = 0.0
    reasons: Tuple[str, ...] = ()
    semantic_grounding: Optional[Mapping[str, Any]] = None


CandidateQualifier = Callable[[OpportunityCandidate], Awaitable[QualificationDecision]]
ProgressCallback = Callable[["SearchProgress"], Any]


@dataclass
class AdapterProgress:
    adapter_id: str
    calls: int = 0
    operations: int = 0
    raw_candidates: int = 0
    unique_candidates: int = 0
    qualified: int = 0
    grounded: int = 0
    estimated_cost_eur: float = 0.0
    cost_eur: float = 0.0
    provider_queries: int = 0
    pages_fetched: int = 0
    official_domains_resolved: int = 0
    semantic_calls: int = 0
    semantic_cache_hits: int = 0
    elapsed_ms: int = 0
    exhausted: bool = False
    exhaustion_authoritative: bool = False
    exhaustion_scope: Optional[str] = None
    exhaustion_reason: Optional[str] = None
    next_cursor: Optional[DiscoveryCursor] = None
    warnings: List[str] = field(default_factory=list)
    projection_traces: List[Dict[str, Any]] = field(default_factory=list)
    acquisition_telemetry: Dict[str, Any] = field(default_factory=dict)
    rejection_histogram: Dict[str, int] = field(default_factory=dict)
    rejected_candidates: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def qualified_per_operation(self) -> float:
        return self.qualified / self.operations if self.operations else 0.0

    def to_root_cause_telemetry(self) -> Dict[str, Any]:
        return {
            "adapter_id": self.adapter_id,
            "provider_queries": self.provider_queries or self.calls,
            "operations": self.operations,
            "estimated_cost": round(self.estimated_cost_eur, 6),
            "settled_cost": round(self.cost_eur, 6),
            "results_received": self.raw_candidates,
            "raw_candidates": self.raw_candidates,
            "unique_candidates": self.unique_candidates,
            "pages_fetched": self.pages_fetched,
            "official_domains_resolved": self.official_domains_resolved,
            "semantic_calls": self.semantic_calls,
            "semantic_cache_hits": self.semantic_cache_hits,
            "grounded": self.grounded,
            "qualified": self.qualified,
            "rejection_histogram": dict(self.rejection_histogram),
            "next_cursor": (
                getattr(self.next_cursor, "value", None)
                if self.next_cursor is not None
                else None
            ),
            "exhaustion_reason": self.exhaustion_reason,
            "elapsed_ms": self.elapsed_ms,
            "rejected_candidates": list(self.rejected_candidates)[:50],
        }


@dataclass(frozen=True)
class SearchProgress:
    requested_count: int
    discovered_count: int
    raw_candidate_count: int
    unique_entity_count: int
    resolved_count: int
    audited_count: int
    evidence_verified_count: int
    qualified_count: int
    rejected_count: int
    published_count: int = 0
    cost_eur: float = 0.0
    qualified_leads: Tuple[QualifiedLead, ...] = ()
    runtime_state: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OrchestrationResult:
    status: TerminalStatus
    coverage: CapabilityCoverage
    qualified_leads: Tuple[QualifiedLead, ...]
    progress: SearchProgress
    rejection_codes: Mapping[str, int]
    adapter_progress: Tuple[AdapterProgress, ...]
    cost_eur: float
    started_at: str
    completed_at: str
    limitations: Tuple[str, ...] = ()
    semantic_telemetry: Mapping[str, Any] = field(default_factory=dict)


def request_from_plan(
    plan: Mapping[str, Any],
    *,
    requested_count: Optional[int] = None,
    budget_eur: float = 0.125,
) -> AdapterDiscoveryRequest:
    """Translate a canonical compiler plan without semantic repair or LLM use."""
    ranking = plan.get("ranking_policy") if isinstance(plan.get("ranking_policy"), Mapping) else {}
    evidence_policy = plan.get("evidence_policy") if isinstance(plan.get("evidence_policy"), Mapping) else {}
    signal_policy = plan.get("signal_policy") if isinstance(plan.get("signal_policy"), Mapping) else {}
    semantic_contract = plan.get("semantic_query_contract") if isinstance(plan.get("semantic_query_contract"), Mapping) else {}
    source_policy = plan.get("source_policy") if isinstance(plan.get("source_policy"), Mapping) else {}
    budget_policy = plan.get("budget_policy") if isinstance(plan.get("budget_policy"), Mapping) else {}
    target = plan.get("target") if isinstance(plan.get("target"), Mapping) else {}
    geographies = target.get("geographies") if isinstance(target.get("geographies"), list) else None
    if not geographies:
        location = str(plan.get("location") or "").strip()
        geographies = [location, "italy"] if location else ["italy"]
    signals = tuple(str(item).strip() for item in (
        signal_policy.get("required_signals") or plan.get("required_signals") or ()
    ) if str(item).strip())
    if not signals and semantic_contract:
        signals = tuple(
            str(item).strip() for item in semantic_contract.get("required_relationships") or ()
            if str(item).strip()
        )
    if not signals:
        raise ValueError("canonical plan requires a signal or open-world semantic relationship")
    mode = str(ranking.get("signal_match_mode") or plan.get("signal_match_mode") or "all").lower()
    if mode not in {"any", "all"}:
        raise ValueError("canonical plan has invalid signal_match_mode")
    freshness = evidence_policy.get("max_age_days")
    if freshness is None:
        freshness = ranking.get("max_signal_age_days")
    if freshness is None:
        ages = signal_policy.get("maximum_age_days_by_signal")
        if isinstance(ages, Mapping):
            required_ages = [ages.get(signal) for signal in signals if ages.get(signal) is not None]
            freshness = min(int(value) for value in required_ages) if required_ages else None
    count = requested_count if requested_count is not None else int(plan.get("requested_count") or 1)
    technical = dict(plan.get("technical_filters") or {}) if isinstance(plan.get("technical_filters"), Mapping) else {}
    technical.update({
        "query_origin": technical.get("query_origin") or "compiler_plan",
        "parent_query": technical.get("parent_query") or str(plan.get("original_query") or plan.get("raw_query") or ""),
        "discovery_round": int(technical.get("discovery_round") or 1),
        "company_sizes": tuple(str(item) for item in target.get("company_sizes") or ()),
        "employee_range": target.get("employee_range"),
        "revenue_range": target.get("revenue_range"),
        "required_attributes": tuple(str(item) for item in target.get("required_attributes") or ()),
        "excluded_attributes": tuple(str(item) for item in target.get("excluded_attributes") or ()),
        "excluded_entities": tuple(str(item) for item in target.get("excluded_entities") or ()),
        "optional_signals": tuple(str(item) for item in signal_policy.get("optional_signals") or ()),
        "negative_signals": tuple(str(item) for item in signal_policy.get("negative_signals") or ()),
        "minimum_signal_confidence": signal_policy.get("minimum_signal_confidence"),
        "preferred_source_classes": tuple(str(item) for item in source_policy.get("preferred_source_classes") or ()),
        "allowed_source_classes": tuple(str(item) for item in source_policy.get("allowed_source_classes") or ()),
        "excluded_source_classes": tuple(str(item) for item in source_policy.get("excluded_source_classes") or ()),
        "minimum_evidence_confidence": evidence_policy.get("minimum_evidence_confidence"),
        "semantic_query_contract": dict(semantic_contract) if semantic_contract else None,
        "semantic_authority_required": bool(semantic_contract) and not bool(semantic_contract.get("clarification_required")),
        "semantic_telemetry": {},
    })
    signal_groups = _signal_groups_from_required_signals(signals)
    if signal_groups:
        technical["signal_groups"] = signal_groups
    industries = tuple(str(item).strip() for item in target.get("industries") or () if str(item).strip())
    sector = str(plan.get("sector") or "").strip()
    hard_budget = budget_policy.get("hard_cost_eur")
    effective_budget = min(budget_eur, float(hard_budget)) if hard_budget is not None else budget_eur
    return AdapterDiscoveryRequest(
        intent=str(plan.get("search_strategy") or "commercial_search"),
        signal_ids=signals,
        signal_match_mode=mode,  # type: ignore[arg-type]
        geographies=tuple(str(item).strip() for item in geographies if str(item).strip()),
        freshness_max_age_days=int(freshness) if freshness is not None else None,
        requested_count=count,
        budget_eur=effective_budget,
        query=str(plan.get("original_query") or plan.get("raw_query") or "").strip(),
        sectors=industries or ((sector,) if sector else ()),
        technical_filters=technical,
    )


def _candidate_key(candidate: OpportunityCandidate) -> str:
    domain = str(candidate.official_domain or "").strip().lower()
    if domain:
        return f"domain:{domain}"
    identifiers = ":".join(f"{key}={value}" for key, value in sorted(candidate.company_identifiers.items()))
    if identifiers:
        return f"id:{identifiers.lower()}"
    return f"name:{candidate.canonical_company_name.strip().casefold()}"


def _processed_employer_keys(request: AdapterDiscoveryRequest) -> set[str]:
    return {
        str(item).strip()
        for item in (request.technical_filters.get("processed_employer_keys") or ())
        if str(item or "").strip()
    }


def _total_unique_target(request: AdapterDiscoveryRequest) -> int:
    return max(1, int(request.technical_filters.get("total_unique_employer_target") or request.requested_count))


def _new_unique_qualified_keys(
    qualified_by_entity: Mapping[str, QualifiedLead],
    processed_employer_keys: set[str],
) -> set[str]:
    return {key for key in qualified_by_entity if key not in processed_employer_keys}


def _cumulative_unique_qualified(
    qualified_by_entity: Mapping[str, QualifiedLead],
    processed_employer_keys: set[str],
) -> int:
    return len(processed_employer_keys) + len(_new_unique_qualified_keys(qualified_by_entity, processed_employer_keys))


def _unique_target_reached(
    qualified_by_entity: Mapping[str, QualifiedLead],
    processed_employer_keys: set[str],
    request: AdapterDiscoveryRequest,
) -> bool:
    new_unique = _new_unique_qualified_keys(qualified_by_entity, processed_employer_keys)
    cumulative = len(processed_employer_keys) + len(new_unique)
    return len(new_unique) >= request.requested_count or cumulative >= _total_unique_target(request)


def _domain_verification_valid(candidate: OpportunityCandidate) -> bool:
    verification = candidate.provenance.get("domain_verification")
    if not isinstance(verification, Mapping):
        return False
    verified_url = str(verification.get("url") or "").strip().lower()
    verified_host = verified_url.split("://", 1)[-1].split("/", 1)[0].removeprefix("www.").split(":", 1)[0]
    evidence = tuple(str(item).strip() for item in verification.get("evidence") or () if str(item).strip())
    try:
        confidence = float(verification.get("confidence") or 0.0)
    except (TypeError, ValueError):
        return False
    return bool(
        str(verification.get("status") or "").lower() == "verified"
        and verified_host == str(candidate.official_domain or "").lower().removeprefix("www.")
        and confidence >= 0.70
        and abs(confidence - candidate.official_domain_confidence) <= 0.05
        and evidence
        and str(verification.get("resolution_source") or "").strip()
        and str(verification.get("resolution_method") or "").strip()
    )


def _merge_candidates(left: OpportunityCandidate, right: OpportunityCandidate) -> OpportunityCandidate:
    evidence_map: Dict[Tuple[str, str, str], EvidenceRecord] = {}
    for item in (*left.evidence, *right.evidence):
        evidence_map[(item.signal_id, item.source_url, item.excerpt)] = item
    contact_map = {(item.kind, item.value): item for item in (*left.contacts, *right.contacts)}
    matched = sorted({item.signal_id for item in evidence_map.values()})
    adapters = sorted({left.adapter_id, right.adapter_id, *left.provenance.get("contributing_adapters", ()), *right.provenance.get("contributing_adapters", ())})
    dates = [value for value in (left.signal_date, right.signal_date) if value]
    fits = [value for value in (left.buyer_fit, right.buyer_fit) if value is not None]
    return OpportunityCandidate(
        canonical_company_name=left.canonical_company_name or right.canonical_company_name,
        company_identifiers={**right.company_identifiers, **left.company_identifiers},
        official_domain=left.official_domain or right.official_domain,
        entity_class=left.entity_class or right.entity_class,
        geographies=tuple(dict.fromkeys((*left.geographies, *right.geographies))),
        buyer_fit=max(fits) if fits else None,
        signal_id=left.signal_id,
        signal_date=max(dates) if dates else None,
        evidence=tuple(evidence_map.values()),
        why_now=" | ".join(dict.fromkeys(value for value in (left.why_now, right.why_now) if value)) or None,
        contacts=tuple(contact_map.values()),
        confidence=max(left.confidence, right.confidence),
        contradiction_flags=tuple(sorted(set(left.contradiction_flags) | set(right.contradiction_flags))),
        provenance={**left.provenance, **right.provenance, "matched_signal_ids": matched, "contributing_adapters": adapters},
        adapter_id=left.adapter_id,
        adapter_version=left.adapter_version,
        official_domain_verified=left.official_domain_verified or right.official_domain_verified,
        official_domain_confidence=max(left.official_domain_confidence, right.official_domain_confidence),
    )


def _apply_semantic_enrichment(
    candidate: OpportunityCandidate,
    semantic_grounding: Mapping[str, Any],
) -> OpportunityCandidate:
    """Apply only typed, grounded semantic fields to the published candidate."""
    raw = semantic_grounding.get("candidate_enrichment")
    if not isinstance(raw, Mapping):
        return candidate
    try:
        buyer_fit = float(raw.get("buyer_fit")) if raw.get("buyer_fit") is not None else candidate.buyer_fit
    except (TypeError, ValueError):
        buyer_fit = candidate.buyer_fit
    try:
        confidence = float(raw.get("confidence")) if raw.get("confidence") is not None else candidate.confidence
    except (TypeError, ValueError):
        confidence = candidate.confidence
    if buyer_fit is not None and not 0.0 <= buyer_fit <= 1.0:
        buyer_fit = candidate.buyer_fit
    if not 0.0 <= confidence <= 1.0:
        confidence = candidate.confidence
    grounded_records: Dict[Tuple[str, str, str], EvidenceRecord] = {}
    originals_by_url = {item.source_url: item for item in candidate.evidence}
    for grounded in semantic_grounding.get("grounded_evidence") or ():
        if not isinstance(grounded, Mapping):
            continue
        interpretation = grounded.get("interpretation") if isinstance(grounded.get("interpretation"), Mapping) else {}
        verdict = grounded.get("verdict") if isinstance(grounded.get("verdict"), Mapping) else {}
        if verdict.get("accepted") is not True:
            continue
        source_url = str(verdict.get("source_url") or "").strip()
        excerpt = str(verdict.get("evidence_excerpt") or interpretation.get("evidence_excerpt") or "").strip()
        publisher = str(verdict.get("source_publisher") or interpretation.get("publisher") or "").strip()
        if not source_url or not excerpt or not publisher:
            continue
        original = originals_by_url.get(source_url)
        semantic_relationships = tuple(
            str(value) for value in interpretation.get("satisfied_relationships") or () if str(value)
        )
        original_relationship = original.signal_id if original else str(grounded.get("evidence_signal_id") or "")
        relationships = tuple(dict.fromkeys(
            value for value in (*semantic_relationships, original_relationship) if value
        ))
        if not relationships:
            relationships = (candidate.signal_id,)
        try:
            evidence_confidence = float(interpretation.get("confidence") or confidence)
        except (TypeError, ValueError):
            evidence_confidence = confidence
        for relationship in relationships:
            record = EvidenceRecord(
                signal_id=relationship,
                source_url=source_url,
                source_publisher=publisher,
                source_class=original.source_class if original else "semantic_grounded_source",
                excerpt=excerpt,
                observed_at=str(verdict.get("verified_at") or (original.observed_at if original else "")),
                published_at=str(interpretation.get("event_date") or "") or (original.published_at if original else None),
                extraction_method="semantic_interpreter_with_deterministic_grounding",
                confidence=max(0.0, min(1.0, evidence_confidence)),
                provenance={
                    **(dict(original.provenance) if original else {}),
                    "status": "verified",
                    "semantic_checks": dict(verdict.get("checks") or {}),
                    "target_role": interpretation.get("target_entity_role"),
                    "contract_hash": semantic_grounding.get("contract_hash"),
                },
            )
            grounded_records[(record.signal_id, record.source_url, record.excerpt)] = record
    evidence = tuple(grounded_records.values()) or candidate.evidence
    enriched_signal_id = evidence[0].signal_id if evidence else candidate.signal_id
    return replace(
        candidate,
        buyer_fit=buyer_fit,
        why_now=str(raw.get("why_now") or "").strip() or candidate.why_now,
        signal_date=str(raw.get("signal_date") or "").strip() or candidate.signal_date,
        signal_id=enriched_signal_id,
        evidence=evidence,
        confidence=confidence,
        provenance={**candidate.provenance, "semantic_grounding": dict(semantic_grounding)},
    )


async def default_candidate_qualifier(candidate: OpportunityCandidate) -> QualificationDecision:
    if not candidate.official_domain:
        return QualificationDecision(False, False, False, "OFFICIAL_DOMAIN_UNRESOLVED")
    if (
        not candidate.official_domain_verified
        or candidate.official_domain_confidence < 0.70
        or not _domain_verification_valid(candidate)
    ):
        return QualificationDecision(False, False, False, "OFFICIAL_DOMAIN_UNVERIFIED")
    if candidate.entity_class != "operating_company":
        return QualificationDecision(False, False, False, "NON_OPERATING_ENTITY")
    evidence_verified = bool(candidate.evidence) and all(
        item.source_url and item.source_publisher and item.excerpt and item.published_at
        for item in candidate.evidence
    )
    if not evidence_verified:
        return QualificationDecision(False, True, False, "EVIDENCE_INCOMPLETE")
    if candidate.buyer_fit is None or candidate.buyer_fit < 0.5:
        return QualificationDecision(False, True, True, "TARGET_FIT_UNVERIFIED")
    if candidate.confidence < 0.7:
        return QualificationDecision(False, True, True, "CONFIDENCE_TOO_LOW")
    score = score_opportunity(candidate)
    if score.total < 0.55:
        return QualificationDecision(
            False,
            True,
            True,
            "OPPORTUNITY_VALUE_TOO_LOW",
            opportunity_value_score=score.total,
            reasons=score.explanation(),
        )
    return QualificationDecision(
        True,
        True,
        True,
        opportunity_value_score=score.total,
        reasons=("canonical_gate_passed", *score.explanation()),
    )


async def semantic_authority_qualifier(
    candidate: OpportunityCandidate,
    request: AdapterDiscoveryRequest,
) -> QualificationDecision:
    """Fail-closed common semantic authority for all AI-native plans."""
    raw_contract = request.technical_filters.get("semantic_query_contract")
    if not isinstance(raw_contract, Mapping):
        return QualificationDecision(False, False, False, "SEMANTIC_QUERY_CONTRACT_MISSING")
    try:
        from backend_mirror.semantic_intelligence import (
            AnthropicSemanticModel,
            SemanticCommercialEventInterpreter,
            SemanticEvidenceGroundingVerifier,
            SemanticQueryContract,
            SemanticResultCache,
            SemanticTelemetry,
        )

        contract = SemanticQueryContract.from_model(
            raw_contract,
            original_query=request.query,
            requested_count=request.requested_count,
        )
        if contract.clarification_required:
            return QualificationDecision(False, False, False, "SEMANTIC_CLARIFICATION_REQUIRED")
        telemetry_bucket = request.technical_filters.get("semantic_telemetry")
        telemetry = SemanticTelemetry()
        telemetry.pages_discovered = len(candidate.evidence)
        telemetry.pages_prefiltered = len(candidate.evidence)
        telemetry.candidates = 1

        def flush_telemetry() -> None:
            if isinstance(telemetry_bucket, dict):
                for key, value in telemetry.to_dict().items():
                    if isinstance(value, (int, float)) and value is not None:
                        telemetry_bucket[key] = telemetry_bucket.get(key, 0) + value

        def record_usage(usage: Mapping[str, Any]) -> None:
            telemetry.input_tokens += int(usage.get("input_tokens") or 0)
            telemetry.output_tokens += int(usage.get("output_tokens") or 0)
            telemetry.cost_eur += float(usage.get("cost_eur") or 0.0)

        supplied_model = request.technical_filters.get("semantic_model_client")
        model = supplied_model if hasattr(supplied_model, "complete_json") else AnthropicSemanticModel(on_usage=record_usage)
        supplied_adjudicator = request.technical_filters.get("semantic_adjudicator_client")
        adjudicator = supplied_adjudicator if hasattr(supplied_adjudicator, "complete_json") else None
        cache_path = request.technical_filters.get("semantic_cache_path")
        cache = SemanticResultCache(str(cache_path)) if cache_path else SemanticResultCache()
        interpreter = SemanticCommercialEventInterpreter(
            model, adjudicator=adjudicator, cache=cache, telemetry=telemetry,
        )
        verifier = SemanticEvidenceGroundingVerifier()
        grounded: list[Mapping[str, Any]] = []
        supported_relationships: set[str] = set()
        passed_rubric: set[str] = set()
        rejection_codes: list[str] = []
        for evidence in candidate.evidence:
            provenance = evidence.provenance if isinstance(evidence.provenance, Mapping) else {}
            source_text = str(provenance.get("source_text") or evidence.excerpt)
            if len(source_text) > 12_000:
                evidence_offset = source_text.find(evidence.excerpt)
                if evidence_offset >= 0:
                    window_start = max(0, evidence_offset - 4_000)
                    source_text = source_text[window_start:window_start + 12_000]
                else:
                    source_text = evidence.excerpt
            interpretation = await interpreter.interpret(
                contract,
                title=str(provenance.get("page_title") or ""),
                snippet=str(provenance.get("search_snippet") or evidence.excerpt),
                source_text=source_text,
                source_url=evidence.source_url,
                publisher=evidence.source_publisher,
                structured_metadata=(
                    provenance.get("structured_metadata")
                    if isinstance(provenance.get("structured_metadata"), Mapping)
                    else {}
                ),
                entity_hints=(candidate.canonical_company_name, candidate.official_domain or ""),
            )
            # Verify every source independently. Relationship/rubric completeness
            # is aggregated afterwards so legitimate multi-source queries work.
            per_source_contract = replace(
                contract,
                required_relationships=tuple(
                    item for item in contract.required_relationships
                    if item in interpretation.satisfied_relationships
                ),
                acceptance_rubric=tuple(
                    item for item in contract.acceptance_rubric
                    if item in interpretation.acceptance_rubric_passed
                ),
            )
            verdict = verifier.verify(
                per_source_contract,
                interpretation,
                source_text=source_text,
                source_url=evidence.source_url,
                source_publisher=evidence.source_publisher,
                official_domain_verified=candidate.official_domain_verified,
                official_domain_confidence=candidate.official_domain_confidence,
                entity_class=candidate.entity_class,
                candidate_company=candidate.canonical_company_name,
                maximum_age_days=request.freshness_max_age_days,
            )
            if verdict.accepted:
                grounded.append({
                    "interpretation": interpretation.to_dict(),
                    "verdict": verdict.to_dict(),
                    "evidence_signal_id": evidence.signal_id,
                })
                supported_relationships.update(interpretation.satisfied_relationships)
                passed_rubric.update(interpretation.acceptance_rubric_passed)
            else:
                rejection_codes.append(verdict.rejection_code or "EVIDENCE_GROUNDING_FAILED")
        telemetry.grounded = len(grounded)
        missing_relationships = set(contract.required_relationships) - supported_relationships
        missing_rubric = set(contract.acceptance_rubric) - passed_rubric
        if missing_relationships or missing_rubric:
            code = "SEMANTIC_QUERY_MISMATCH" if grounded else (
                rejection_codes[0] if rejection_codes else "EVIDENCE_GROUNDING_FAILED"
            )
            flush_telemetry()
            return QualificationDecision(
                False, True, bool(grounded), code,
                reasons=tuple([
                    *(f"missing_relationship:{item}" for item in sorted(missing_relationships)),
                    *(f"missing_rubric:{item}" for item in sorted(missing_rubric)),
                ]),
                semantic_grounding={
                    "accepted": False,
                    "contract_hash": contract.contract_hash,
                    "grounded_evidence": grounded,
                    "rejection_codes": rejection_codes,
                    "telemetry": telemetry.to_dict(),
                },
            )
        accepted_interpretations = [
            item.get("interpretation") for item in grounded
            if isinstance(item.get("interpretation"), Mapping)
        ]
        semantic_confidence = max(
            (float(item.get("confidence") or 0.0) for item in accepted_interpretations),
            default=0.0,
        )
        semantic_buyer_fit = max(
            (min(float(item.get("confidence") or 0.0), float(item.get("certainty") or 0.0))
             for item in accepted_interpretations),
            default=0.0,
        )
        semantic_why_now = next(
            (str(item.get("why_now") or "").strip() for item in accepted_interpretations if str(item.get("why_now") or "").strip()),
            "",
        )
        semantic_dates = sorted(
            str(item.get("event_date"))[:10] for item in accepted_interpretations if item.get("event_date")
        )
        enriched_candidate = replace(
            candidate,
            buyer_fit=max(candidate.buyer_fit or 0.0, semantic_buyer_fit),
            why_now=semantic_why_now or candidate.why_now,
            signal_date=semantic_dates[-1] if semantic_dates else candidate.signal_date,
            confidence=max(candidate.confidence, semantic_confidence),
        )
        result = await default_candidate_qualifier(enriched_candidate)
        candidate_enrichment = {
            "buyer_fit": enriched_candidate.buyer_fit,
            "why_now": enriched_candidate.why_now,
            "signal_date": enriched_candidate.signal_date,
            "confidence": enriched_candidate.confidence,
        }
        if not result.qualified:
            flush_telemetry()
            return replace(result, semantic_grounding={
                "accepted": True,
                "contract_hash": contract.contract_hash,
                "grounded_evidence": grounded,
                "candidate_enrichment": candidate_enrichment,
                "telemetry": telemetry.to_dict(),
            })
        telemetry.qualified = 1
        semantic_payload = {
            "accepted": True,
            "contract_hash": contract.contract_hash,
            "target_role": contract.target_role_in_event,
            "relationships": sorted(supported_relationships),
            "acceptance_rubric": sorted(passed_rubric),
            "grounded_evidence": grounded,
            "candidate_enrichment": candidate_enrichment,
            "telemetry": telemetry.to_dict(),
        }
        flush_telemetry()
        return replace(
            result,
            reasons=("semantic_authority_passed", *result.reasons),
            semantic_grounding=semantic_payload,
        )
    except Exception as exc:
        if "telemetry" in locals() and "telemetry_bucket" in locals() and isinstance(telemetry_bucket, dict):
            for key, value in telemetry.to_dict().items():
                if isinstance(value, (int, float)) and value is not None:
                    telemetry_bucket[key] = telemetry_bucket.get(key, 0) + value
        return QualificationDecision(
            False, False, False, "SEMANTIC_INTERPRETATION_FAILED",
            reasons=(type(exc).__name__,),
            semantic_grounding={"accepted": False, "error_type": type(exc).__name__},
        )


def _signal_subset(adapter: SourceAdapter, request: AdapterDiscoveryRequest) -> Tuple[str, ...]:
    supported = set(adapter.capability.supported_signals)
    return request.signal_ids if "*" in supported else tuple(signal for signal in request.signal_ids if signal in supported)


class UniversalSourceOrchestrator:
    def __init__(
        self,
        registry: SourceCapabilityRegistry,
        *,
        qualifier: CandidateQualifier = default_candidate_qualifier,
        max_rounds: int = 20,
        max_seconds: float = 120.0,
    ) -> None:
        if max_rounds <= 0 or max_seconds <= 0:
            raise ValueError("orchestrator limits must be positive")
        self.registry = registry
        self.qualifier = qualifier
        self.max_rounds = max_rounds
        self.max_seconds = max_seconds

    async def run(
        self,
        request: AdapterDiscoveryRequest,
        *,
        required_source_classes: Sequence[str] = (),
        mandatory_adapter_ids: Sequence[str] = (),
        resume_cursors: Optional[Mapping[str, DiscoveryCursor]] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> OrchestrationResult:
        started_dt = datetime.now(timezone.utc)
        started = started_dt.isoformat()
        start_clock = time.monotonic()
        mandatory = tuple(dict.fromkeys(str(item).strip() for item in mandatory_adapter_ids if str(item).strip()))
        if mandatory:
            # Affinity batches must execute exactly these adapters — resolve against
            # a constrained registry so structured peers cannot crowd out generic_web.
            constrained: List[SourceAdapter] = []
            unresolved: List[str] = []
            for adapter_id in mandatory:
                try:
                    constrained.append(self.registry.adapter(adapter_id))
                except KeyError:
                    unresolved.append(adapter_id)
            if unresolved or not constrained:
                raise SourceAdapterRegistryMismatchError(
                    "canonical plan requires "
                    f"{list(mandatory)} but runtime selected [] "
                    f"with status=unsupported; reasons={unresolved or ['no_executable_adapter']}"
                )
            coverage = SourceCapabilityRegistry(constrained).resolve(
                request,
                required_source_classes=required_source_classes,
                allow_generic_fallback=True,
            )
            selected = set(coverage.adapter_ids)
            missing = [adapter_id for adapter_id in mandatory if adapter_id not in selected]
            status_ok = coverage.status in {"supported", "generic_fallback_partial"}
            if not status_ok or missing:
                raise SourceAdapterRegistryMismatchError(
                    "canonical plan requires "
                    f"{list(mandatory)} but runtime selected {list(coverage.adapter_ids)} "
                    f"with status={coverage.status}; reasons={list(coverage.reasons)}"
                )
            coverage = CapabilityCoverage(
                "supported",
                tuple(adapter_id for adapter_id in mandatory if adapter_id in selected),
                coverage.covered_signals,
                coverage.missing_signals,
                coverage.reasons,
            )
        else:
            coverage = self.registry.resolve(
                request,
                required_source_classes=required_source_classes,
                allow_generic_fallback=True,
            )
        states = {adapter_id: AdapterProgress(adapter_id) for adapter_id in coverage.adapter_ids}
        if not states:
            return self._empty_result("failed_terminal", coverage, request, started, states, ("no_executable_adapter",))
        supplied_cursors = dict(resume_cursors or {})
        unknown_cursor_adapters = set(supplied_cursors) - set(states)
        if unknown_cursor_adapters:
            raise ValueError(f"resume cursor references unselected adapter(s): {sorted(unknown_cursor_adapters)}")
        for adapter_id, cursor in supplied_cursors.items():
            states[adapter_id].next_cursor = cursor
        if request.cursor is not None:
            if supplied_cursors:
                raise ValueError("use request.cursor or resume_cursors, not both")
            if len(states) != 1:
                raise ValueError("request.cursor is ambiguous with multiple adapters; use resume_cursors")
            next(iter(states.values())).next_cursor = request.cursor

        raw_count = 0
        discovered = 0
        spent = 0.0
        accumulated: Dict[str, OpportunityCandidate] = {}
        source_by_entity: Dict[str, set[str]] = {}
        qualified_by_entity: Dict[str, QualifiedLead] = {}
        decisions: Dict[str, QualificationDecision] = {}
        rejection_by_entity: Dict[str, str] = {}
        terminal: Optional[TerminalStatus] = None
        round_index = 0
        processed_employer_keys = _processed_employer_keys(request)

        def digital_audit_only() -> bool:
            return bool(states) and set(states) == {"legacy_digital_audit_v1"}

        async def emit_progress() -> None:
            if progress_callback is None:
                return
            audited_now = sum(1 for decision in decisions.values() if decision.audited)
            evidence_now = sum(1 for decision in decisions.values() if decision.evidence_verified)
            new_unique_keys = _new_unique_qualified_keys(qualified_by_entity, processed_employer_keys)
            runtime_state = {
                adapter_id: {
                    "next_cursor": state.next_cursor.value if state.next_cursor is not None else None,
                    "exhausted": state.exhausted,
                    "exhaustion_authoritative": state.exhaustion_authoritative,
                    "exhaustion_scope": state.exhaustion_scope,
                    "exhaustion_reason": state.exhaustion_reason,
                    "acquisition": dict(state.acquisition_telemetry),
                }
                for adapter_id, state in states.items()
            }
            snapshot = SearchProgress(
                requested_count=_total_unique_target(request),
                discovered_count=discovered,
                raw_candidate_count=raw_count,
                unique_entity_count=len(accumulated),
                resolved_count=sum(1 for item in accumulated.values() if item.official_domain),
                audited_count=audited_now,
                evidence_verified_count=evidence_now,
                qualified_count=_cumulative_unique_qualified(qualified_by_entity, processed_employer_keys),
                rejected_count=len(accumulated) - len(qualified_by_entity),
                cost_eur=spent,
                qualified_leads=tuple(qualified_by_entity[key] for key in sorted(new_unique_keys)),
                runtime_state=runtime_state,
            )
            outcome = progress_callback(snapshot)
            if inspect.isawaitable(outcome):
                await outcome

        while round_index < self.max_rounds and time.monotonic() - start_clock < self.max_seconds:
            active = [state for state in states.values() if not state.exhausted]
            if not active:
                terminal = (
                    "provider_exhausted_authoritative"
                    if digital_audit_only() and all(state.exhaustion_authoritative for state in states.values())
                    else "raw_safety_cap_reached"
                    if digital_audit_only()
                    and any(state.exhaustion_reason == "raw_safety_cap_reached" for state in states.values())
                    else "partial_sources_exhausted"
                )
                break
            progressed = False
            for state in active:
                if _unique_target_reached(qualified_by_entity, processed_employer_keys, request):
                    terminal = "completed_requested_count"
                    break
                adapter = self.registry.adapter(state.adapter_id)
                remaining = max(0.0, request.budget_eur - spent)
                min_cost = adapter.capability.estimated_cost_eur_per_operation
                if min_cost > remaining + 1e-9:
                    continue
                active_left = max(1, len([item for item in active if not item.exhausted]))
                allocation = min(remaining, max(min_cost, remaining / active_left))
                signals = _signal_subset(adapter, request)
                if not signals:
                    state.exhausted = True
                    state.warnings.append("NO_COMPATIBLE_SIGNALS")
                    continue
                new_unique_so_far = len(_new_unique_qualified_keys(qualified_by_entity, processed_employer_keys))
                remaining_new_unique = max(
                    1,
                    min(
                        request.requested_count - new_unique_so_far,
                        _total_unique_target(request) - len(processed_employer_keys) - new_unique_so_far,
                    ),
                )
                adapter_request = AdapterDiscoveryRequest(
                    intent=request.intent,
                    signal_ids=signals,
                    signal_match_mode="all" if request.signal_match_mode == "all" else "any",
                    geographies=request.geographies,
                    freshness_max_age_days=request.freshness_max_age_days,
                    requested_count=remaining_new_unique,
                    budget_eur=allocation,
                    query=request.query,
                    sectors=request.sectors,
                    technical_filters={
                        **request.technical_filters,
                        "discovery_round": round_index + 1,
                        "requested_qualified_count": _total_unique_target(request),
                        "maps_batch_size": int(request.technical_filters.get("maps_batch_size") or 15),
                        **({
                            "raw_candidate_budget": min(
                                50,
                                max(30, int(
                                    request.technical_filters.get("raw_candidate_budget")
                                    or request.requested_count * 6
                                )),
                            ),
                        } if state.adapter_id != "legacy_digital_audit_v1" else {}),
                    },
                    cursor=state.next_cursor,
                )
                result = await adapter.discover(adapter_request)
                if result.cost_eur > allocation + 1e-9 or spent + result.cost_eur > request.budget_eur + 1e-9:
                    raise RuntimeError(f"ORCHESTRATOR_HARD_COST_CAP_EXCEEDED:{state.adapter_id}")
                progressed = True
                spent += result.cost_eur
                state.calls += 1
                state.operations += result.operations
                state.estimated_cost_eur += float(allocation)
                state.cost_eur += result.cost_eur
                state.provider_queries += int(
                    ((result.telemetry or {}).get("provider_queries")
                     if isinstance(result.telemetry, Mapping)
                     else None)
                    or 0
                ) or 1
                state.raw_candidates += len(result.candidates)
                state.warnings.extend(result.warnings)
                state.exhausted = result.exhaustion.exhausted
                state.exhaustion_authoritative = result.exhaustion.authoritative
                state.exhaustion_scope = result.exhaustion.scope
                state.exhaustion_reason = result.exhaustion.reason
                state.next_cursor = result.exhaustion.next_cursor
                if isinstance(result.telemetry, Mapping):
                    traces = result.telemetry.get("projection_traces")
                    if isinstance(traces, list):
                        state.projection_traces.extend(item for item in traces if isinstance(item, Mapping))
                    acquisition = result.telemetry.get("acquisition")
                    if isinstance(acquisition, Mapping):
                        state.acquisition_telemetry.update(dict(acquisition))
                        state.pages_fetched += int(acquisition.get("pages_fetched") or acquisition.get("urls_fetched") or 0)
                        state.official_domains_resolved += int(
                            acquisition.get("official_domains_resolved") or acquisition.get("domains_resolved") or 0
                        )
                        state.semantic_calls += int(acquisition.get("semantic_calls") or 0)
                        state.semantic_cache_hits += int(acquisition.get("semantic_cache_hits") or 0)
                        state.elapsed_ms += int(acquisition.get("elapsed_ms") or 0)
                discovered += result.operations
                raw_count += len(result.candidates)

                for candidate in result.candidates:
                    key = _candidate_key(candidate)
                    is_new = key not in accumulated
                    accumulated[key] = candidate if is_new else _merge_candidates(accumulated[key], candidate)
                    source_by_entity.setdefault(key, set()).add(state.adapter_id)
                    if is_new:
                        state.unique_candidates += 1
                    merged = accumulated[key]
                    evidence_signals = {item.signal_id for item in merged.evidence}
                    if not _evidence_satisfies_request(evidence_signals, request):
                        code = (
                            "SIGNAL_GROUP_MISMATCH"
                            if request.technical_filters.get("signal_groups")
                            else "SIGNAL_SET_INCOMPLETE"
                        )
                        rejection_by_entity[key] = code
                        state.rejection_histogram[code] = state.rejection_histogram.get(code, 0) + 1
                        state.rejected_candidates.append({
                            "entity_hint": str(getattr(merged, "canonical_company_name", "") or "")[:120],
                            "source_url": str(
                                (merged.evidence[0].source_url if merged.evidence else "")
                                or getattr(merged, "official_domain", "")
                                or ""
                            )[:300],
                            "adapter": state.adapter_id,
                            "rejection_stage": "evidence_match",
                            "rejection_code": code,
                        })
                        continue
                    if request.technical_filters.get("semantic_authority_required") is True:
                        decision = await semantic_authority_qualifier(merged, request)
                    else:
                        decision = await self.qualifier(merged)
                    decisions[key] = decision
                    if not decision.qualified:
                        code = decision.rejection_code or "QUALIFICATION_FAILED"
                        rejection_by_entity[key] = code
                        state.rejection_histogram[code] = state.rejection_histogram.get(code, 0) + 1
                        state.rejected_candidates.append({
                            "entity_hint": str(getattr(merged, "canonical_company_name", "") or "")[:120],
                            "source_url": str(
                                (merged.evidence[0].source_url if merged.evidence else "")
                                or getattr(merged, "official_domain", "")
                                or ""
                            )[:300],
                            "adapter": state.adapter_id,
                            "rejection_stage": "qualification",
                            "rejection_code": code,
                        })
                        continue
                    if key in processed_employer_keys:
                        code = "DUPLICATE_EMPLOYER_OPPORTUNITY"
                        rejection_by_entity[key] = code
                        state.rejection_histogram[code] = state.rejection_histogram.get(code, 0) + 1
                        continue
                    if decision.semantic_grounding:
                        state.grounded += 1
                        merged = _apply_semantic_enrichment(merged, decision.semantic_grounding)
                        accumulated[key] = merged
                    qualified_by_entity[key] = QualifiedLead(
                        candidate=merged,
                        qualification_reasons=decision.reasons or ("qualified",),
                        opportunity_value_score=decision.opportunity_value_score,
                        qualified_at=datetime.now(timezone.utc).isoformat(),
                    )
                    rejection_by_entity.pop(key, None)
                    for adapter_id in source_by_entity[key]:
                        states[adapter_id].qualified += 1
                    if _unique_target_reached(qualified_by_entity, processed_employer_keys, request):
                        terminal = "completed_requested_count"
                        break
                await emit_progress()
                if terminal:
                    break
            if terminal:
                break
            if not progressed:
                terminal = "partial_budget_exhausted"
                break
            round_index += 1

        if terminal is None:
            terminal = "partial_time_limit"
        if terminal != "completed_requested_count" and states and all(state.exhausted for state in states.values()):
            if digital_audit_only() and all(state.exhaustion_authoritative for state in states.values()):
                terminal = "provider_exhausted_authoritative"
            elif digital_audit_only() and any(
                state.exhaustion_reason == "raw_safety_cap_reached" for state in states.values()
            ):
                terminal = "raw_safety_cap_reached"
            else:
                terminal = "partial_sources_exhausted"

        for key in accumulated:
            if key not in qualified_by_entity and key not in rejection_by_entity:
                rejection_by_entity[key] = "QUALIFICATION_NOT_COMPLETED"
        rejection_codes: Dict[str, int] = {}
        for code in rejection_by_entity.values():
            rejection_codes[code] = rejection_codes.get(code, 0) + 1
        resolved = sum(1 for item in accumulated.values() if item.official_domain)
        audited = sum(1 for decision in decisions.values() if decision.audited)
        evidence_verified = sum(1 for decision in decisions.values() if decision.evidence_verified)
        progress = SearchProgress(
            requested_count=_total_unique_target(request),
            discovered_count=discovered,
            raw_candidate_count=raw_count,
            unique_entity_count=len(accumulated),
            resolved_count=resolved,
            audited_count=audited,
            evidence_verified_count=evidence_verified,
            qualified_count=_cumulative_unique_qualified(qualified_by_entity, processed_employer_keys),
            rejected_count=len(accumulated) - len(qualified_by_entity),
        )
        limitations = ("generic_fallback_partial",) if coverage.status == "generic_fallback_partial" else ()
        new_unique_keys = _new_unique_qualified_keys(qualified_by_entity, processed_employer_keys)
        semantic_telemetry = dict(request.technical_filters.get("semantic_telemetry") or {})
        total_cost = spent + float(semantic_telemetry.get("cost_eur") or 0.0)
        if total_cost > request.budget_eur + 1e-9:
            raise RuntimeError("ORCHESTRATOR_HARD_COST_CAP_EXCEEDED")
        return OrchestrationResult(
            status=terminal,
            coverage=coverage,
            qualified_leads=tuple(qualified_by_entity[key] for key in sorted(new_unique_keys)),
            progress=progress,
            rejection_codes=rejection_codes,
            adapter_progress=tuple(states.values()),
            cost_eur=total_cost,
            started_at=started,
            completed_at=datetime.now(timezone.utc).isoformat(),
            limitations=limitations,
            semantic_telemetry=semantic_telemetry,
        )

    @staticmethod
    def _empty_result(
        status: TerminalStatus,
        coverage: CapabilityCoverage,
        request: AdapterDiscoveryRequest,
        started: str,
        states: Mapping[str, AdapterProgress],
        limitations: Tuple[str, ...],
    ) -> OrchestrationResult:
        return OrchestrationResult(
            status=status, coverage=coverage, qualified_leads=(),
            progress=SearchProgress(request.requested_count, 0, 0, 0, 0, 0, 0, 0, 0),
            rejection_codes={}, adapter_progress=tuple(states.values()), cost_eur=0.0,
            started_at=started, completed_at=datetime.now(timezone.utc).isoformat(), limitations=limitations,
        )
