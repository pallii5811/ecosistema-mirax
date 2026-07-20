"""UniversalSignalDiscoveryEngine — compose adapters with adaptive strategy loops."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .catalog import SourceCapabilityRegistry, default_source_capability_registry
from .cheap_discovery_prefilter import DiscoveryHit, cheap_rank_hits
from .contracts import AdapterDiscoveryRequest, DiscoveryCursor, QualifiedLead
from .orchestrator import OrchestrationResult, ProgressCallback, TerminalStatus, UniversalSourceOrchestrator
from .signal_strategy_planner import DiscoveryStrategy, plan_strategies
from .universal_evidence import extract_evidence_from_text
from .universal_query_spec import UniversalQuerySpec, compile_universal_query_spec


_ZERO_YIELD_ABORT_ROUNDS = 2
_DA_SIGNALS = frozenset({
    "website_weakness", "seo_errors", "missing_analytics", "missing_advertising_pixel", "site_stale",
})
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
    "active_advertising": ("generic_web_research_v1",),
    "rebranding": ("generic_web_research_v1",),
    "investing_marketing": ("generic_web_research_v1",),
    "funding": ("generic_web_research_v1",),
    "financing": ("generic_web_research_v1",),
    "capital_investment": ("generic_web_research_v1",),
    "leadership_change": ("generic_web_research_v1",),
    "technology_change": ("generic_web_research_v1",),
    "technology_adoption": ("generic_web_research_v1",),
    "technology_migration": ("generic_web_research_v1",),
    "outdated_technology": ("generic_web_research_v1",),
    "compliance_event": ("generic_web_research_v1",),
    "regulatory_change": ("generic_web_research_v1",),
    "compliance_gap": ("generic_web_research_v1",),
    "certification": ("generic_web_research_v1",),
    "website_weakness": ("legacy_digital_audit_v1",),
    "seo_errors": ("legacy_digital_audit_v1",),
    "missing_analytics": ("legacy_digital_audit_v1",),
    "missing_advertising_pixel": ("legacy_digital_audit_v1",),
}


@dataclass
class StrategyRuntimeStats:
    strategy_id: str
    provider_query: str = ""
    rounds: int = 0
    zero_yield_rounds: int = 0
    raw_hits: int = 0
    prefilter_accepted: int = 0
    pages_opened: int = 0
    candidates: int = 0
    qualified: int = 0
    cost_eur: float = 0.0
    cursor: Optional[str] = None
    aborted: bool = False
    productive: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "provider_query": self.provider_query,
            "rounds": self.rounds,
            "zero_yield_rounds": self.zero_yield_rounds,
            "raw_hits": self.raw_hits,
            "prefilter_accepted": self.prefilter_accepted,
            "pages_opened": self.pages_opened,
            "candidates": self.candidates,
            "qualified": self.qualified,
            "cost_eur": self.cost_eur,
            "cursor": self.cursor,
            "aborted": self.aborted,
            "productive": self.productive,
        }


@dataclass(frozen=True)
class UniversalEngineResult:
    query_spec: UniversalQuerySpec
    strategies: Tuple[DiscoveryStrategy, ...]
    orchestration: OrchestrationResult
    capability_status: str
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
            "cost_per_accepted": (self.cost_eur / self.qualified_count if self.qualified_count else None),
            "strategies": [item.to_dict() for item in self.strategies],
            "strategy_stats": [item.to_dict() for item in self.strategy_stats],
            "adapters_composed": list(self.adapters_composed),
            "prefilter_accepted": self.prefilter_accepted,
            "prefilter_rejected": self.prefilter_rejected,
            "orchestration_status": self.orchestration.status,
            "notes": list(self.notes),
            "semantic": dict(self.orchestration.semantic_telemetry),
            "query_spec": self.query_spec.to_dict(),
        }


def _infer_adapters(signals: Sequence[str]) -> Tuple[str, ...]:
    ordered: List[str] = []
    for signal in signals:
        for adapter_id in _ADAPTER_BY_SIGNAL_HINT.get(signal, ("generic_web_research_v1",)):
            if adapter_id not in ordered:
                ordered.append(adapter_id)
    return tuple(ordered)


def adapters_for_signals(signals: Sequence[str], *, allow_digital_audit: bool) -> Tuple[str, ...]:
    adapters = list(_infer_adapters(signals))
    if not allow_digital_audit:
        adapters = [item for item in adapters if item != "legacy_digital_audit_v1"]
    return tuple(adapters) or ("generic_web_research_v1",)


def _capability_status(
    *,
    adapters_composed: Sequence[str],
    qualified: int,
    requested: int,
    strategies_exhausted: bool,
) -> str:
    if not adapters_composed and not strategies_exhausted:
        return "UNAVAILABLE"
    structured = [item for item in adapters_composed if item != "generic_web_research_v1"]
    if qualified >= requested and structured:
        return "SUPPORTED"
    if structured or qualified > 0 or "generic_web_research_v1" in adapters_composed:
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


def _cursor_store_key(adapter_id: str, strategy_id: str) -> str:
    return f"{adapter_id}::{strategy_id}"


def _strategy_schedule(strategies: Sequence[DiscoveryStrategy], stats_map: Mapping[str, StrategyRuntimeStats]) -> List[DiscoveryStrategy]:
    """One strategy per batch; rotate by rounds, prefer productive on ties."""
    pending = [item for item in strategies if not stats_map[item.strategy_id].aborted]
    pending.sort(
        key=lambda item: (
            stats_map[item.strategy_id].rounds,
            0 if stats_map[item.strategy_id].productive else 1,
            item.priority,
            item.fallback_level,
            item.strategy_id,
        )
    )
    return pending


class UniversalSignalDiscoveryEngine:
    """Orchestrates QuerySpec → strategies → cheap prefilter → adapter composition."""

    def __init__(
        self,
        registry: Optional[SourceCapabilityRegistry] = None,
        *,
        orchestrator: Optional[UniversalSourceOrchestrator] = None,
        max_strategy_batches: int = 12,
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
            "seller": {
                "offer_description": "commercial offer",
                "products_or_services": [],
                "problems_solved": [],
                "preferred_buyer_roles": [],
            },
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
        allow_da = bool(set(spec.required_signals).intersection(_DA_SIGNALS))

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

        stats_map: Dict[str, StrategyRuntimeStats] = {
            item.strategy_id: StrategyRuntimeStats(
                strategy_id=item.strategy_id,
                provider_query=item.search_query,
            )
            for item in strategies
        }
        qualified_by_key: Dict[str, QualifiedLead] = {}
        spent = 0.0
        notes: List[str] = []
        adapters_used: List[str] = []
        last_result: Optional[OrchestrationResult] = None
        # Cursor isolation: adapter_id::strategy_id → DiscoveryCursor
        strategy_cursors: Dict[str, DiscoveryCursor] = {}
        if resume_cursors:
            # Legacy adapter-only cursors seed strategy-less bootstrap only once.
            for adapter_id, cursor in resume_cursors.items():
                strategy_cursors[_cursor_store_key(str(adapter_id), "__legacy__")] = cursor

        remaining = max(1, spec.requested_count)
        hard_budget = float(request.budget_eur)
        batches_run = 0
        accumulated_rejections: Dict[str, int] = {}
        accumulated_raw = 0

        while batches_run < self.max_strategy_batches:
            if remaining <= 0:
                break
            if spent + 1e-9 >= hard_budget:
                notes.append("cost_budget_reached")
                break

            schedule = _strategy_schedule(strategies, stats_map)
            if not schedule:
                notes.append("strategies_exhausted")
                break

            strategy = schedule[0]
            stats = stats_map[strategy.strategy_id]
            # Prefer live affinity map over planner hints so generic evidence signals
            # actually hit generic_web_research_v1 (planner may still list growth).
            inferred = adapters_for_signals((strategy.signal_type,), allow_digital_audit=allow_da)
            affinity = inferred or tuple(strategy.adapter_affinity)
            batch_adapters = list(dict.fromkeys([*mandatory_adapter_ids, *affinity]))
            if not allow_da:
                batch_adapters = [item for item in batch_adapters if item != "legacy_digital_audit_v1"]
            if not batch_adapters:
                batch_adapters = list(adapters_for_signals(spec.required_signals, allow_digital_audit=allow_da))

            # P0-1: always pass compatible adapters as mandatory for this strategy batch.
            run_mandatory = tuple(batch_adapters)
            # Keep residual for SemanticCommercialEventInterpreter + identity SERP.
            # Without this, multi-strategy rounds spend 100% on search_hits_http and
            # the next reserve() raises ResearchBudgetExceeded (shadow fails closed).
            semantic_reserve = 0.0
            if request.technical_filters.get("semantic_authority_required") is True:
                semantic_reserve = max(0.015, min(0.025, hard_budget * 0.4))
            round_budget = max(0.0, hard_budget - spent - semantic_reserve)
            if round_budget <= 0:
                notes.append("cost_budget_reached")
                break

            # P0-5: resume cursors for this strategy_id; fall back to legacy
            # adapter-only cursors from shadow resume so hiring state survives.
            batch_resume: Dict[str, DiscoveryCursor] = {}
            for adapter_id in run_mandatory:
                stored = strategy_cursors.get(_cursor_store_key(adapter_id, strategy.strategy_id))
                if stored is None:
                    stored = strategy_cursors.get(_cursor_store_key(adapter_id, "__legacy__"))
                    if stored is not None:
                        strategy_cursors[_cursor_store_key(adapter_id, strategy.strategy_id)] = stored
                if stored is not None:
                    batch_resume[adapter_id] = stored

            telemetry_bucket: Dict[str, Any] = {
                "raw_discovery_hits": 0,
                "prefilter_accepted": 0,
                "prefilter_rejected": 0,
                "prefilter_rejection_codes": {},
                "pages_opened_after_prefilter": 0,
                "provider_queries": [],
            }
            filtered_request = replace(
                request,
                requested_count=remaining,
                budget_eur=round_budget,
                # Isolate signal subset for this strategy when possible.
                signal_ids=(strategy.signal_type,)
                if strategy.signal_type in spec.required_signals or strategy.signal_type in spec.optional_signals
                else request.signal_ids,
                signal_match_mode="any",
                technical_filters={
                    **dict(request.technical_filters or {}),
                    "universal_engine": True,
                    "universal_strategy_id": strategy.strategy_id,
                    "universal_strategies": [item.to_dict() for item in strategies],
                    "universal_active_strategies": [strategy.to_dict()],
                    "universal_search_queries": (strategy.search_query,),
                    "universal_seed_companies": seeded_companies,
                    "universal_prefilter_telemetry": telemetry_bucket,
                    "discovery_round": batches_run + 1,
                    "max_source_records": int(
                        min(
                            int((request.technical_filters or {}).get("max_source_records") or 40),
                            max(12, remaining * 6),
                        )
                    ),
                },
            )

            result = await self.orchestrator.run(
                filtered_request,
                required_source_classes=required_source_classes,
                mandatory_adapter_ids=run_mandatory,
                resume_cursors=batch_resume or None,
                progress_callback=progress_callback,
            )
            last_result = result
            batches_run += 1
            spent += float(result.cost_eur)

            for adapter_progress in result.adapter_progress:
                if adapter_progress.adapter_id not in adapters_used:
                    adapters_used.append(adapter_progress.adapter_id)
                key = _cursor_store_key(adapter_progress.adapter_id, strategy.strategy_id)
                if adapter_progress.next_cursor is not None:
                    strategy_cursors[key] = adapter_progress.next_cursor
                    stats.cursor = adapter_progress.next_cursor.value
                elif adapter_progress.exhausted:
                    strategy_cursors.pop(key, None)

            before = len(qualified_by_key)
            qualified_by_key = _merge_qualified(qualified_by_key, result.qualified_leads)
            gained = len(qualified_by_key) - before
            remaining = max(0, spec.requested_count - len(qualified_by_key))
            accumulated_raw += int(result.progress.raw_candidate_count or 0)
            for code, count in dict(result.rejection_codes or {}).items():
                accumulated_rejections[str(code)] = accumulated_rejections.get(str(code), 0) + int(count or 0)

            # P0-4: true per-strategy telemetry (one strategy executed this batch).
            stats.rounds += 1
            stats.provider_query = strategy.search_query
            stats.cost_eur += float(result.cost_eur)
            stats.raw_hits += int(telemetry_bucket.get("raw_discovery_hits") or result.progress.raw_candidate_count)
            stats.prefilter_accepted += int(telemetry_bucket.get("prefilter_accepted") or 0)
            stats.pages_opened += int(telemetry_bucket.get("pages_opened_after_prefilter") or 0)
            stats.candidates += int(result.progress.unique_entity_count or 0)
            stats.qualified += gained
            prefilter_accepted += int(telemetry_bucket.get("prefilter_accepted") or 0)
            prefilter_rejected += int(telemetry_bucket.get("prefilter_rejected") or 0)

            if gained <= 0:
                stats.zero_yield_rounds += 1
                if stats.zero_yield_rounds >= self.zero_yield_abort_rounds:
                    stats.aborted = True
                    notes.append(f"aborted_zero_yield:{strategy.strategy_id}")
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
            empty_request = replace(
                request,
                budget_eur=request.budget_eur,
                technical_filters={**dict(request.technical_filters or {}), "universal_engine": True},
            )
            fallback_mandatory = tuple(mandatory_adapter_ids) or adapters_for_signals(
                spec.required_signals,
                allow_digital_audit=allow_da,
            )
            last_result = await self.orchestrator.run(
                empty_request,
                required_source_classes=required_source_classes,
                mandatory_adapter_ids=fallback_mandatory,
                resume_cursors=resume_cursors,
                progress_callback=progress_callback,
            )
            adapters_used = [item.adapter_id for item in last_result.adapter_progress]
            qualified_by_key = _merge_qualified({}, last_result.qualified_leads)
            spent = float(last_result.cost_eur)

        leads = tuple(
            sorted(qualified_by_key.values(), key=lambda lead: lead.candidate.confidence, reverse=True)
        )[: spec.requested_count]
        progress = replace(
            last_result.progress,
            qualified_count=len(leads),
            qualified_leads=leads,
            cost_eur=spent,
            raw_candidate_count=max(int(last_result.progress.raw_candidate_count or 0), accumulated_raw),
        )
        status: TerminalStatus = last_result.status
        if len(leads) >= spec.requested_count:
            status = "completed_requested_count"
        elif spent + 1e-9 >= hard_budget:
            status = "partial_budget_exhausted"
        merged_rejections = dict(last_result.rejection_codes or {})
        for code, count in accumulated_rejections.items():
            merged_rejections[code] = max(int(merged_rejections.get(code) or 0), int(count))
        orchestration = OrchestrationResult(
            status=status,
            coverage=last_result.coverage,
            qualified_leads=leads,
            progress=progress,
            rejection_codes=merged_rejections,
            adapter_progress=last_result.adapter_progress,
            cost_eur=spent,
            started_at=last_result.started_at,
            completed_at=datetime.now(timezone.utc).isoformat(),
            limitations=tuple(dict.fromkeys((*last_result.limitations, *notes))),
            semantic_telemetry=last_result.semantic_telemetry,
        )
        strategies_exhausted = all(
            stats_map[item.strategy_id].aborted or stats_map[item.strategy_id].rounds > 0 for item in strategies
        ) and len(leads) < spec.requested_count
        capability = _capability_status(
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
