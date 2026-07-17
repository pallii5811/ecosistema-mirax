"""UniversalSignalDiscoveryEngine — compose adapters with adaptive strategy loops."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .catalog import SourceCapabilityRegistry, default_source_capability_registry
from .cheap_discovery_prefilter import DiscoveryHit, cheap_rank_hits
from .contracts import AdapterDiscoveryRequest, DiscoveryCursor, QualifiedLead
from .orchestrator import OrchestrationResult, ProgressCallback, TerminalStatus, UniversalSourceOrchestrator
from .signal_strategy_planner import DiscoveryStrategy, plan_strategies, strategies_for_adapter
from .universal_evidence import extract_evidence_from_text
from .universal_query_spec import UniversalQuerySpec, compile_universal_query_spec


_ZERO_YIELD_ABORT_ROUNDS = 2
_ADAPTER_BY_SIGNAL_HINT: Dict[str, Tuple[str, ...]] = {
    "hiring": ("structured_hiring_v1",),
    "hiring_sales": ("structured_hiring_v1",),
    "hiring_marketing": ("structured_hiring_v1",),
    "hiring_operational": ("structured_hiring_v1",),
    "hiring_technology": ("structured_hiring_v1",),
    "tender_won": ("public_procurement_v1",),
    "contract_awarded": ("public_procurement_v1",),
    "new_location": ("official_growth_signals_v1",),
    "geographic_expansion": ("official_growth_signals_v1",),
    "production_expansion": ("official_growth_signals_v1",),
    "expansion": ("official_growth_signals_v1",),
    "active_advertising": ("official_growth_signals_v1",),
    "rebranding": ("official_growth_signals_v1",),
    "investing_marketing": ("official_growth_signals_v1",),
    "website_weakness": ("legacy_digital_audit_v1",),
    "seo_errors": ("legacy_digital_audit_v1",),
    "missing_analytics": ("legacy_digital_audit_v1",),
    "missing_advertising_pixel": ("legacy_digital_audit_v1",),
}


@dataclass
class StrategyRuntimeStats:
    strategy_id: str
    rounds: int = 0
    zero_yield_rounds: int = 0
    raw_hits: int = 0
    qualified: int = 0
    cost_eur: float = 0.0
    aborted: bool = False
    productive: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "rounds": self.rounds,
            "zero_yield_rounds": self.zero_yield_rounds,
            "raw_hits": self.raw_hits,
            "qualified": self.qualified,
            "cost_eur": self.cost_eur,
            "aborted": self.aborted,
            "productive": self.productive,
        }


@dataclass(frozen=True)
class UniversalEngineResult:
    query_spec: UniversalQuerySpec
    strategies: Tuple[DiscoveryStrategy, ...]
    orchestration: OrchestrationResult
    capability_status: str  # SUPPORTED | SUPPORTED_PARTIAL | UNAVAILABLE
    strategy_stats: Tuple[StrategyRuntimeStats, ...]
    prefilter_accepted: int = 0
    prefilter_rejected: int = 0
    adapters_composed: Tuple[str, ...] = ()
    notes: Tuple[str, ...] = ()

    @property
    def qualified_count(self) -> int:
        return len(self.orchestration.qualified_leads)

    @property
    def cost_eur(self) -> float:
        return float(self.orchestration.cost_eur)

    def to_telemetry(self) -> Dict[str, Any]:
        return {
            "engine": "UniversalSignalDiscoveryEngine",
            "capability_status": self.capability_status,
            "requested_count": self.query_spec.requested_count,
            "qualified_count": self.qualified_count,
            "cost_eur": self.cost_eur,
            "cost_per_accepted": (
                self.cost_eur / self.qualified_count if self.qualified_count else None
            ),
            "strategies": [item.to_dict() for item in self.strategies],
            "strategy_stats": [item.to_dict() for item in self.strategy_stats],
            "adapters_composed": list(self.adapters_composed),
            "prefilter_accepted": self.prefilter_accepted,
            "prefilter_rejected": self.prefilter_rejected,
            "orchestration_status": self.orchestration.status,
            "notes": list(self.notes),
            "query_spec": self.query_spec.to_dict(),
        }


def _infer_adapters(signals: Sequence[str]) -> Tuple[str, ...]:
    ordered: List[str] = []
    for signal in signals:
        for adapter_id in _ADAPTER_BY_SIGNAL_HINT.get(signal, ("generic_web_research_v1",)):
            if adapter_id not in ordered:
                ordered.append(adapter_id)
    return tuple(ordered)


def _capability_status(
    *,
    required_signals: Sequence[str],
    adapters_composed: Sequence[str],
    qualified: int,
    requested: int,
    strategies_exhausted: bool,
) -> str:
    if not adapters_composed and not strategies_exhausted:
        return "UNAVAILABLE"
    # Digital-audit-only is supported when DA adapter selected intentionally.
    structured = [a for a in adapters_composed if a != "generic_web_research_v1"]
    if qualified >= requested and structured:
        return "SUPPORTED"
    if structured or qualified > 0:
        return "SUPPORTED_PARTIAL"
    if "generic_web_research_v1" in adapters_composed:
        return "SUPPORTED_PARTIAL"
    return "UNAVAILABLE"


def _merge_qualified(
    existing: Mapping[str, QualifiedLead],
    incoming: Sequence[QualifiedLead],
) -> Dict[str, QualifiedLead]:
    merged = dict(existing)
    for lead in incoming:
        domain = str(lead.candidate.official_domain or "").strip().lower()
        key = domain or lead.candidate.canonical_company_name.casefold()
        if not key:
            continue
        if key not in merged or lead.candidate.confidence > merged[key].candidate.confidence:
            merged[key] = lead
    return merged


class UniversalSignalDiscoveryEngine:
    """Orchestrates QuerySpec → strategies → cheap prefilter → adapter composition."""

    def __init__(
        self,
        registry: Optional[SourceCapabilityRegistry] = None,
        *,
        orchestrator: Optional[UniversalSourceOrchestrator] = None,
        max_strategy_batches: int = 8,
        zero_yield_abort_rounds: int = _ZERO_YIELD_ABORT_ROUNDS,
    ) -> None:
        self.registry = registry or default_source_capability_registry()
        self.orchestrator = orchestrator or UniversalSourceOrchestrator(self.registry)
        self.max_strategy_batches = max(1, max_strategy_batches)
        self.zero_yield_abort_rounds = max(1, zero_yield_abort_rounds)

    def compile_spec(
        self,
        plan: Mapping[str, Any],
        *,
        requested_count: Optional[int] = None,
        hard_cap_eur: float = 0.125,
    ) -> UniversalQuerySpec:
        return compile_universal_query_spec(plan, requested_count=requested_count, hard_cap_eur=hard_cap_eur)

    def plan(self, spec: UniversalQuerySpec) -> Tuple[DiscoveryStrategy, ...]:
        return plan_strategies(spec)

    def prefilter_hits(
        self,
        hits: Sequence[Mapping[str, Any] | DiscoveryHit],
        *,
        excluded_domains: Sequence[str] = (),
    ) -> Tuple[Tuple[DiscoveryHit, Any], ...]:
        return cheap_rank_hits(hits, excluded_domains=excluded_domains)

    def extract_evidence(self, **kwargs: Any) -> Tuple[Any, ...]:
        return extract_evidence_from_text(**kwargs)

    async def run(
        self,
        request: AdapterDiscoveryRequest,
        *,
        plan: Optional[Mapping[str, Any]] = None,
        required_source_classes: Sequence[str] = (),
        mandatory_adapter_ids: Sequence[str] = (),
        resume_cursors: Optional[Mapping[str, DiscoveryCursor]] = None,
        progress_callback: Optional[ProgressCallback] = None,
        cheap_hits: Sequence[Mapping[str, Any]] = (),
    ) -> UniversalEngineResult:
        plan_map: Mapping[str, Any] = plan or {
            "original_query": request.query,
            "raw_query": request.query,
            "requested_count": request.requested_count,
            "search_strategy": request.intent,
            "seller": {"offer_description": "commercial offer", "products_or_services": [], "problems_solved": [], "preferred_buyer_roles": []},
            "target": {
                "entity_types": ["operating_company"],
                "industries": list(request.sectors),
                "company_sizes": [],
                "geographies": list(request.geographies),
                "local_business_preference": False,
                "required_attributes": [],
                "excluded_attributes": [],
                "excluded_entities": list(request.technical_filters.get("excluded_entities") or ()),
            },
            "signal_policy": {
                "required_signals": list(request.signal_ids),
                "optional_signals": list(request.technical_filters.get("optional_signals") or ()),
                "negative_signals": [],
                "maximum_age_days_by_signal": {
                    signal: int(request.freshness_max_age_days or 180) for signal in request.signal_ids
                },
                "minimum_signal_confidence": 0.7,
            },
            "source_policy": {
                "preferred_source_classes": list(required_source_classes),
                "allowed_source_classes": [],
                "excluded_source_classes": [],
                "minimum_independent_sources": 1,
                "primary_source_required_for": list(request.signal_ids),
            },
            "evidence_policy": {
                "require_official_domain": True,
                "require_source_url": True,
                "require_observed_at": True,
                "minimum_evidence_confidence": 0.7,
                "corroboration_required_above_risk": 0.9,
            },
            "budget_policy": {
                "target_cost_eur": request.budget_eur,
                "hard_cost_eur": request.budget_eur,
                "maximum_search_calls": 40,
                "maximum_pages_opened": 80,
                "maximum_llm_evaluations": 20,
            },
            "ranking_policy": {"signal_match_mode": request.signal_match_mode},
        }
        spec = self.compile_spec(plan_map, requested_count=request.requested_count, hard_cap_eur=request.budget_eur)
        strategies = self.plan(spec)

        prefilter_accepted = 0
        prefilter_rejected = 0
        seeded_companies: List[str] = []
        if cheap_hits:
            ranked = self.prefilter_hits(cheap_hits)
            prefilter_accepted = len(ranked)
            prefilter_rejected = max(0, len(tuple(cheap_hits)) - prefilter_accepted)
            seeded_companies = [
                decision.probable_company_name
                for _, decision in ranked
                if decision.probable_company_name
            ][:40]

        inferred = _infer_adapters(spec.required_signals)
        mandatory = tuple(dict.fromkeys([*mandatory_adapter_ids, *inferred]))
        # Never force Digital Audit unless the query actually requires DA signals.
        da_signals = {"website_weakness", "seo_errors", "missing_analytics", "missing_advertising_pixel", "site_stale"}
        if not set(spec.required_signals).intersection(da_signals):
            mandatory = tuple(item for item in mandatory if item != "legacy_digital_audit_v1")

        stats_map: Dict[str, StrategyRuntimeStats] = {
            item.strategy_id: StrategyRuntimeStats(strategy_id=item.strategy_id) for item in strategies
        }
        qualified_by_key: Dict[str, QualifiedLead] = {}
        spent = 0.0
        notes: List[str] = []
        adapters_used: List[str] = []
        last_result: Optional[OrchestrationResult] = None
        resume = dict(resume_cursors or {})
        remaining = max(1, spec.requested_count)
        # Operational hard budget comes from the caller (shadow already clamps ≤ €0.125).
        # QuerySpec.cost_budget remains the per-lead target for telemetry / truthfulness.
        hard_budget = float(request.budget_eur)
        target_cost = float(spec.cost_budget)

        # Batch strategies by fallback level then priority.
        batches: List[List[DiscoveryStrategy]] = []
        by_level: Dict[int, List[DiscoveryStrategy]] = {}
        for item in strategies:
            by_level.setdefault(item.fallback_level, []).append(item)
        for level in sorted(by_level):
            # Chunk each level into small productive batches.
            level_items = by_level[level]
            for index in range(0, len(level_items), 3):
                batches.append(level_items[index : index + 3])

        for batch_index, batch in enumerate(batches[: self.max_strategy_batches]):
            if remaining <= 0:
                break
            if spent + 1e-9 >= hard_budget:
                notes.append("cost_budget_reached")
                break
            if target_cost > 0 and spent + 1e-9 >= target_cost and len(qualified_by_key) >= spec.requested_count:
                notes.append("target_cost_met")
                break
            # Drop aborted zero-yield strategies.
            active = [item for item in batch if not stats_map[item.strategy_id].aborted]
            if not active:
                continue

            batch_adapters = []
            for item in active:
                batch_adapters.extend(item.adapter_affinity or inferred)
            batch_adapters = list(dict.fromkeys(batch_adapters))
            if not set(spec.required_signals).intersection(da_signals):
                batch_adapters = [a for a in batch_adapters if a != "legacy_digital_audit_v1"]
            if not batch_adapters:
                batch_adapters = list(inferred) or ["generic_web_research_v1"]

            strategy_dicts = [item.to_dict() for item in active]
            search_queries = [item.search_query for item in active]
            round_budget = max(0.0, hard_budget - spent)
            if round_budget <= 0:
                notes.append("cost_budget_reached")
                break

            filtered_request = replace(
                request,
                requested_count=remaining,
                budget_eur=round_budget,
                technical_filters={
                    **dict(request.technical_filters or {}),
                    "universal_engine": True,
                    "universal_strategies": [item.to_dict() for item in strategies],
                    "universal_active_strategies": strategy_dicts,
                    "universal_search_queries": search_queries,
                    "universal_seed_companies": seeded_companies,
                    "discovery_round": batch_index + 1,
                    # Prefer cheap discovery: keep source-record caps modest per batch.
                    "max_source_records": int(
                        min(
                            int((request.technical_filters or {}).get("max_source_records") or 40),
                            max(12, remaining * 6),
                        )
                    ),
                },
            )

            # Prefer mandatory from plan when provided; else strategy affinity.
            run_mandatory = tuple(mandatory_adapter_ids) if mandatory_adapter_ids else tuple(batch_adapters)
            result = await self.orchestrator.run(
                filtered_request,
                required_source_classes=required_source_classes,
                mandatory_adapter_ids=run_mandatory if mandatory_adapter_ids else (),
                resume_cursors=resume or None,
                progress_callback=progress_callback,
            )
            last_result = result
            spent += float(result.cost_eur)
            for adapter_id in result.adapter_progress:
                if adapter_id.adapter_id not in adapters_used:
                    adapters_used.append(adapter_id.adapter_id)
                if adapter_id.next_cursor is not None:
                    resume[adapter_id.adapter_id] = adapter_id.next_cursor
                elif adapter_id.exhausted:
                    resume.pop(adapter_id.adapter_id, None)

            before = len(qualified_by_key)
            qualified_by_key = _merge_qualified(qualified_by_key, result.qualified_leads)
            gained = len(qualified_by_key) - before
            remaining = max(0, spec.requested_count - len(qualified_by_key))

            for item in active:
                stats = stats_map[item.strategy_id]
                stats.rounds += 1
                stats.cost_eur += float(result.cost_eur) / max(1, len(active))
                stats.raw_hits += int(result.progress.raw_candidate_count)
                stats.qualified += gained
                if gained <= 0:
                    stats.zero_yield_rounds += 1
                    if stats.zero_yield_rounds >= self.zero_yield_abort_rounds:
                        stats.aborted = True
                        notes.append(f"aborted_zero_yield:{item.strategy_id}")
                else:
                    stats.productive = True
                    stats.zero_yield_rounds = 0

            if result.status == "completed_requested_count" or len(qualified_by_key) >= spec.requested_count:
                notes.append("requested_count_reached")
                break
            if result.status in {"partial_budget_exhausted", "partial_time_limit"}:
                notes.append(result.status)
                break

        if last_result is None:
            # No executable batch — empty orchestration via orchestrator once.
            empty_request = replace(
                request,
                budget_eur=request.budget_eur,
                technical_filters={**dict(request.technical_filters or {}), "universal_engine": True},
            )
            last_result = await self.orchestrator.run(
                empty_request,
                required_source_classes=required_source_classes,
                mandatory_adapter_ids=mandatory_adapter_ids,
                resume_cursors=resume_cursors,
                progress_callback=progress_callback,
            )
            adapters_used = [item.adapter_id for item in last_result.adapter_progress]
            qualified_by_key = _merge_qualified({}, last_result.qualified_leads)
            spent = float(last_result.cost_eur)

        leads = tuple(sorted(qualified_by_key.values(), key=lambda lead: lead.candidate.confidence, reverse=True))[
            : spec.requested_count
        ]
        # Rebuild orchestration result with merged leads / cumulative cost.
        progress = replace(
            last_result.progress,
            qualified_count=len(leads),
            qualified_leads=leads,
            cost_eur=spent,
        )
        status: TerminalStatus = last_result.status
        if len(leads) >= spec.requested_count:
            status = "completed_requested_count"
        elif spent + 1e-9 >= hard_budget:
            status = "partial_budget_exhausted"
        orchestration = OrchestrationResult(
            status=status,
            coverage=last_result.coverage,
            qualified_leads=leads,
            progress=progress,
            rejection_codes=last_result.rejection_codes,
            adapter_progress=last_result.adapter_progress,
            cost_eur=spent,
            started_at=last_result.started_at,
            completed_at=datetime.now(timezone.utc).isoformat(),
            limitations=tuple(dict.fromkeys((*last_result.limitations, *notes))),
        )

        strategies_exhausted = all(
            stats_map[item.strategy_id].aborted or stats_map[item.strategy_id].rounds > 0 for item in strategies
        ) and len(leads) < spec.requested_count

        capability = _capability_status(
            required_signals=spec.required_signals,
            adapters_composed=adapters_used,
            qualified=len(leads),
            requested=spec.requested_count,
            strategies_exhausted=strategies_exhausted,
        )
        upgraded_spec = UniversalQuerySpec(**{**spec.to_dict(), "capability_status": capability})

        return UniversalEngineResult(
            query_spec=upgraded_spec,
            strategies=strategies,
            orchestration=orchestration,
            capability_status=capability,
            strategy_stats=tuple(stats_map[item.strategy_id] for item in strategies),
            prefilter_accepted=prefilter_accepted,
            prefilter_rejected=prefilter_rejected,
            adapters_composed=tuple(adapters_used),
            notes=tuple(dict.fromkeys(notes)),
        )
