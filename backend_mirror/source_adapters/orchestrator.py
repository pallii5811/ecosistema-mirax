"""Breadth-first orchestration over executable MIRAX source adapters."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Literal, Mapping, Optional, Sequence, Tuple

from .catalog import CapabilityCoverage, SourceCapabilityRegistry
from .contracts import (
    AdapterDiscoveryRequest,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    QualifiedLead,
    SourceAdapter,
)


TerminalStatus = Literal[
    "completed_requested_count",
    "partial_market_exhausted",
    "partial_sources_exhausted",
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


CandidateQualifier = Callable[[OpportunityCandidate], Awaitable[QualificationDecision]]


@dataclass
class AdapterProgress:
    adapter_id: str
    calls: int = 0
    operations: int = 0
    raw_candidates: int = 0
    unique_candidates: int = 0
    qualified: int = 0
    cost_eur: float = 0.0
    exhausted: bool = False
    next_cursor: Optional[DiscoveryCursor] = None
    warnings: List[str] = field(default_factory=list)

    @property
    def qualified_per_operation(self) -> float:
        return self.qualified / self.operations if self.operations else 0.0


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


def request_from_plan(
    plan: Mapping[str, Any],
    *,
    requested_count: Optional[int] = None,
    budget_eur: float = 0.125,
) -> AdapterDiscoveryRequest:
    """Translate a canonical compiler plan without semantic repair or LLM use."""
    ranking = plan.get("ranking_policy") if isinstance(plan.get("ranking_policy"), Mapping) else {}
    evidence_policy = plan.get("evidence_policy") if isinstance(plan.get("evidence_policy"), Mapping) else {}
    target = plan.get("target") if isinstance(plan.get("target"), Mapping) else {}
    geographies = target.get("geographies") if isinstance(target.get("geographies"), list) else None
    if not geographies:
        location = str(plan.get("location") or "").strip()
        geographies = [location, "italy"] if location else ["italy"]
    signals = tuple(str(item).strip() for item in plan.get("required_signals") or () if str(item).strip())
    if not signals:
        raise ValueError("canonical plan requires at least one signal")
    mode = str(ranking.get("signal_match_mode") or plan.get("signal_match_mode") or "all").lower()
    if mode not in {"any", "all"}:
        raise ValueError("canonical plan has invalid signal_match_mode")
    freshness = evidence_policy.get("max_age_days")
    if freshness is None:
        freshness = ranking.get("max_signal_age_days")
    count = requested_count if requested_count is not None else int(plan.get("requested_count") or 1)
    technical = dict(plan.get("technical_filters") or {}) if isinstance(plan.get("technical_filters"), Mapping) else {}
    technical.update({
        "query_origin": technical.get("query_origin") or "compiler_plan",
        "parent_query": technical.get("parent_query") or str(plan.get("original_query") or ""),
        "discovery_round": int(technical.get("discovery_round") or 1),
    })
    sector = str(plan.get("sector") or "").strip()
    return AdapterDiscoveryRequest(
        intent=str(plan.get("search_strategy") or "commercial_search"),
        signal_ids=signals,
        signal_match_mode=mode,  # type: ignore[arg-type]
        geographies=tuple(str(item).strip() for item in geographies if str(item).strip()),
        freshness_max_age_days=int(freshness) if freshness is not None else None,
        requested_count=count,
        budget_eur=budget_eur,
        query=str(plan.get("original_query") or plan.get("raw_query") or "").strip(),
        sectors=(sector,) if sector else (),
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
    )


async def default_candidate_qualifier(candidate: OpportunityCandidate) -> QualificationDecision:
    if not candidate.official_domain:
        return QualificationDecision(False, False, False, "OFFICIAL_DOMAIN_UNRESOLVED")
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
    score = min(1.0, 0.45 * candidate.confidence + 0.35 * candidate.buyer_fit + 0.20)
    return QualificationDecision(True, True, True, opportunity_value_score=score, reasons=("canonical_gate_passed",))


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
    ) -> OrchestrationResult:
        started_dt = datetime.now(timezone.utc)
        started = started_dt.isoformat()
        start_clock = time.monotonic()
        coverage = self.registry.resolve(
            request,
            required_source_classes=required_source_classes,
            allow_generic_fallback=True,
        )
        states = {adapter_id: AdapterProgress(adapter_id) for adapter_id in coverage.adapter_ids}
        if not states:
            return self._empty_result("failed_terminal", coverage, request, started, states, ("no_executable_adapter",))

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

        while round_index < self.max_rounds and time.monotonic() - start_clock < self.max_seconds:
            active = [state for state in states.values() if not state.exhausted]
            if not active:
                terminal = "partial_sources_exhausted"
                break
            progressed = False
            for state in active:
                if len(qualified_by_entity) >= request.requested_count:
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
                adapter_request = AdapterDiscoveryRequest(
                    intent=request.intent,
                    signal_ids=signals,
                    signal_match_mode="all" if request.signal_match_mode == "all" else "any",
                    geographies=request.geographies,
                    freshness_max_age_days=request.freshness_max_age_days,
                    requested_count=max(1, request.requested_count - len(qualified_by_entity)),
                    budget_eur=allocation,
                    query=request.query,
                    sectors=request.sectors,
                    technical_filters={**request.technical_filters, "discovery_round": round_index + 1},
                    cursor=state.next_cursor,
                )
                result = await adapter.discover(adapter_request)
                if result.cost_eur > allocation + 1e-9 or spent + result.cost_eur > request.budget_eur + 1e-9:
                    raise RuntimeError(f"ORCHESTRATOR_HARD_COST_CAP_EXCEEDED:{state.adapter_id}")
                progressed = True
                spent += result.cost_eur
                state.calls += 1
                state.operations += result.operations
                state.cost_eur += result.cost_eur
                state.raw_candidates += len(result.candidates)
                state.warnings.extend(result.warnings)
                state.exhausted = result.exhaustion.exhausted
                state.next_cursor = result.exhaustion.next_cursor
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
                    if request.signal_match_mode == "all" and not set(request.signal_ids).issubset(evidence_signals):
                        rejection_by_entity[key] = "SIGNAL_SET_INCOMPLETE"
                        continue
                    decision = await self.qualifier(merged)
                    decisions[key] = decision
                    if not decision.qualified:
                        rejection_by_entity[key] = decision.rejection_code or "QUALIFICATION_FAILED"
                        continue
                    qualified_by_entity[key] = QualifiedLead(
                        candidate=merged,
                        qualification_reasons=decision.reasons or ("qualified",),
                        opportunity_value_score=decision.opportunity_value_score,
                        qualified_at=datetime.now(timezone.utc).isoformat(),
                    )
                    rejection_by_entity.pop(key, None)
                    for adapter_id in source_by_entity[key]:
                        states[adapter_id].qualified += 1
                    if len(qualified_by_entity) >= request.requested_count:
                        terminal = "completed_requested_count"
                        break
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
            requested_count=request.requested_count,
            discovered_count=discovered,
            raw_candidate_count=raw_count,
            unique_entity_count=len(accumulated),
            resolved_count=resolved,
            audited_count=audited,
            evidence_verified_count=evidence_verified,
            qualified_count=len(qualified_by_entity),
            rejected_count=len(accumulated) - len(qualified_by_entity),
        )
        limitations = ("generic_fallback_partial",) if coverage.status == "generic_fallback_partial" else ()
        return OrchestrationResult(
            status=terminal,
            coverage=coverage,
            qualified_leads=tuple(qualified_by_entity.values())[:request.requested_count],
            progress=progress,
            rejection_codes=rejection_codes,
            adapter_progress=tuple(states.values()),
            cost_eur=spent,
            started_at=started,
            completed_at=datetime.now(timezone.utc).isoformat(),
            limitations=limitations,
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
