from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceCapabilityRegistry,
    SourceExhaustion,
)
from backend_mirror.source_adapters.orchestrator import (
    QualificationDecision,
    UniversalSourceOrchestrator,
    default_candidate_qualifier,
    request_from_plan,
)


def capability(adapter_id: str, signals: tuple[str, ...], *, fallback=False, cost=0.0) -> SourceCapability:
    return SourceCapability(
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        supported_intents=("*",) if fallback else ("commercial_search",),
        supported_signals=signals,
        source_classes=("search_snippet",) if fallback else (f"{adapter_id}_source",),
        geographic_coverage=("global",),
        freshness_max_age_days=None if fallback else 1,
        discovery_mode="generic_fallback" if fallback else "discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=20,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=cost,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("source_url",),
        evidence_guarantees=("signal_id",),
        exhaustion_semantics="best_effort" if fallback else "partition",
        coverage_status="generic_fallback_partial" if fallback else "supported",
    )


def candidate(company: str, domain: str, signal: str, adapter_id: str) -> OpportunityCandidate:
    evidence = EvidenceRecord(
        signal_id=signal,
        source_url=f"https://source.test/{adapter_id}/{domain}",
        source_publisher="Fixture Publisher",
        source_class=f"{adapter_id}_source",
        excerpt=f"{company} prova esplicita {signal}",
        observed_at=datetime.now(timezone.utc).isoformat(),
        published_at=date.today().isoformat(),
        extraction_method="fixture",
        confidence=0.95,
    )
    return OpportunityCandidate(
        canonical_company_name=company,
        company_identifiers={},
        official_domain=domain,
        entity_class="operating_company",
        geographies=("italy",),
        buyer_fit=0.95,
        signal_id=signal,
        signal_date=date.today().isoformat(),
        evidence=(evidence,),
        why_now=f"Evento {signal}",
        contacts=(),
        confidence=0.95,
        contradiction_flags=(),
        provenance={"adapter_id": adapter_id},
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        official_domain_verified=True,
        official_domain_confidence=0.95,
    )


@dataclass
class PagedAdapter:
    capability: SourceCapability
    pages: list[list[OpportunityCandidate]]
    costs: list[float] = field(default_factory=list)
    call_order: list[str] = field(default_factory=list)
    budgets: list[float] = field(default_factory=list)
    never_exhaust: bool = False

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        self.call_order.append(self.capability.adapter_id)
        self.budgets.append(request.budget_eur)
        index = int(request.cursor.value.rsplit(":", 1)[-1]) if request.cursor else 0
        page = self.pages[index] if index < len(self.pages) else []
        cost = self.costs[index] if index < len(self.costs) else 0.0
        last = index + 1 >= len(self.pages)
        exhausted = False if self.never_exhaust else last
        next_cursor = DiscoveryCursor(f"{self.capability.adapter_id}:{index + 1}") if not exhausted else None
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version="1.0.0",
            candidates=tuple(page),
            exhaustion=SourceExhaustion(exhausted, "source" if exhausted else "partition", "fixture", exhausted, next_cursor),
            operations=len(page),
            cost_eur=cost,
            started_at=now,
            completed_at=now,
        )


def request(signals=("hiring",), *, mode="all", count=2, budget=0.125) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=tuple(signals),
        signal_match_mode=mode,
        geographies=("italy",),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=budget,
        query="fixture",
    )


async def fixture_qualifier(item: OpportunityCandidate) -> QualificationDecision:
    if item.canonical_company_name.startswith("Reject"):
        return QualificationDecision(False, True, True, "FIXTURE_REJECT")
    return await default_candidate_qualifier(item)


def test_requested_count_tracks_qualified_and_continues_after_raw_rejections() -> None:
    adapter = PagedAdapter(
        capability("hiring_adapter", ("hiring",)),
        [
            [candidate("Reject Uno", "reject.test", "hiring", "hiring_adapter"), candidate("Good Uno", "good1.test", "hiring", "hiring_adapter")],
            [candidate("Good Due", "good2.test", "hiring", "hiring_adapter")],
        ],
    )
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((adapter,)), qualifier=fixture_qualifier,
    ).run(request()))
    assert result.status == "completed_requested_count"
    assert result.progress.raw_candidate_count == 3
    assert result.progress.unique_entity_count == 3
    assert result.progress.qualified_count == 2
    assert result.progress.rejected_count == 1
    assert result.rejection_codes == {"FIXTURE_REJECT": 1}
    assert adapter.call_order == ["hiring_adapter", "hiring_adapter"]


def test_breadth_first_all_mode_merges_evidence_for_same_company() -> None:
    order: list[str] = []
    procurement = PagedAdapter(
        capability("procurement_adapter", ("tender_won",)),
        [[candidate("Multi Srl", "multi.test", "tender_won", "procurement_adapter")]],
        call_order=order,
    )
    hiring = PagedAdapter(
        capability("hiring_adapter", ("hiring",)),
        [[candidate("Multi Srl", "multi.test", "hiring", "hiring_adapter")]],
        call_order=order,
    )
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((procurement, hiring)),
    ).run(request(("tender_won", "hiring"), mode="all", count=1)))
    assert order == ["procurement_adapter", "hiring_adapter"]
    assert result.status == "completed_requested_count"
    assert result.progress.raw_candidate_count == 2
    assert result.progress.unique_entity_count == 1
    assert result.progress.qualified_count == 1
    lead = result.qualified_leads[0]
    assert {item.signal_id for item in lead.candidate.evidence} == {"tender_won", "hiring"}
    assert set(lead.candidate.provenance["contributing_adapters"]) == {"procurement_adapter", "hiring_adapter"}


def test_any_mode_accepts_alternative_adapter_signals() -> None:
    first = PagedAdapter(capability("first", ("signal_a",)), [[candidate("A Srl", "a.test", "signal_a", "first")]])
    second = PagedAdapter(capability("second", ("signal_b",)), [[candidate("B Srl", "b.test", "signal_b", "second")]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((first, second))).run(
        request(("signal_a", "signal_b"), mode="any", count=2),
    ))
    assert result.status == "completed_requested_count"
    assert {item.candidate.official_domain for item in result.qualified_leads} == {"a.test", "b.test"}


def test_budget_is_allocated_before_calls_and_never_exceeded() -> None:
    first = PagedAdapter(capability("first", ("signal_a",), cost=0.02), [[]], costs=[0.02])
    second = PagedAdapter(capability("second", ("signal_a",), cost=0.02), [[]], costs=[0.02])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((first, second))).run(
        request(("signal_a",), count=1, budget=0.05),
    ))
    assert first.budgets and second.budgets
    assert first.budgets[0] <= 0.05
    assert second.budgets[0] <= 0.03 + 1e-9
    assert result.cost_eur == pytest.approx(0.04)
    assert result.cost_eur <= 0.05


def test_adapter_overspend_is_quarantined_by_hard_cap() -> None:
    bad = PagedAdapter(capability("bad", ("signal_a",), cost=0.01), [[]], costs=[0.06])
    with pytest.raises(RuntimeError, match="ORCHESTRATOR_HARD_COST_CAP_EXCEEDED"):
        asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((bad,))).run(
            request(("signal_a",), count=1, budget=0.05),
        ))


def test_partial_fallback_never_claims_global_exhaustion() -> None:
    fallback = PagedAdapter(capability("generic", ("*",), fallback=True), [[]], never_exhaust=True)
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((fallback,)), max_rounds=2,
    ).run(request(("uncovered_signal",), count=1)))
    assert result.coverage.status == "generic_fallback_partial"
    assert result.status == "partial_time_limit"
    assert result.limitations == ("generic_fallback_partial",)
    assert result.adapter_progress[0].exhausted is False


def test_plan_boundary_maps_canonical_fields_without_llm_repair() -> None:
    mapped = request_from_plan({
        "search_strategy": "commercial_search",
        "required_signals": ["hiring_operational"],
        "ranking_policy": {"signal_match_mode": "all", "max_signal_age_days": 14},
        "target": {"geographies": ["Lombardia", "italy"]},
        "original_query": "PMI in Lombardia che assumono operai",
        "sector": "manifattura",
        "requested_count": 25,
    }, budget_eur=0.125)
    assert mapped.signal_ids == ("hiring_operational",)
    assert mapped.geographies == ("Lombardia", "italy")
    assert mapped.freshness_max_age_days == 14
    assert mapped.requested_count == 25
    assert mapped.budget_eur == 0.125
    assert mapped.technical_filters["query_origin"] == "compiler_plan"


def test_plan_boundary_maps_real_v1_contract_without_semantic_loss() -> None:
    root = Path(__file__).resolve().parents[1]
    plan = json.loads((root / "contracts" / "fixtures" / "commercial-search-plan.valid.json").read_text(encoding="utf-8"))
    mapped = request_from_plan(plan, requested_count=25, budget_eur=1.0)
    assert mapped.intent == "commercial_search"
    assert mapped.signal_ids == ("hiring_operational",)
    assert mapped.signal_match_mode == "all"
    assert mapped.geographies == ("Lombardia",)
    assert mapped.freshness_max_age_days == 120
    assert mapped.requested_count == 25
    assert mapped.budget_eur == 0.125
    assert mapped.query == plan["raw_query"]
    assert mapped.sectors == ("logistica", "edilizia", "produzione")
    assert mapped.technical_filters["company_sizes"] == ("micro", "small", "medium")
    assert mapped.technical_filters["employee_range"] == {"min": 5, "max": 249}
    assert mapped.technical_filters["negative_signals"] == ("business_closed",)
    assert mapped.technical_filters["preferred_source_classes"] == (
        "company_careers", "public_procurement_portal",
    )
