"""Regression: engine keeps hunting after partial_sources with progress."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceCapabilityRegistry,
    UniversalSignalDiscoveryEngine,
)
from backend_mirror.source_adapters.catalog import CapabilityCoverage
from backend_mirror.source_adapters.contracts import QualifiedLead
from backend_mirror.source_adapters.orchestrator import AdapterProgress, OrchestrationResult, SearchProgress
from backend_mirror.source_adapters.signal_strategy_planner import DiscoveryStrategy
from backend_mirror.source_adapters.universal_query_spec import UniversalQuerySpec


def _capability() -> SourceCapability:
    return SourceCapability(
        adapter_id="generic_web_research_v1",
        adapter_version="1.0.0",
        supported_intents=("*",),
        supported_signals=("production_expansion",),
        source_classes=("recognized_news",),
        geographic_coverage=("global",),
        freshness_max_age_days=None,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=20,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=0.005,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("source_url",),
        evidence_guarantees=("signal_id",),
        exhaustion_semantics="partition",
        coverage_status="supported",
    )


def _candidate(name: str, domain: str) -> OpportunityCandidate:
    published = date.today().isoformat()
    return OpportunityCandidate(
        canonical_company_name=name,
        company_identifiers={},
        official_domain=domain,
        official_domain_verified=True,
        official_domain_confidence=0.9,
        entity_class="operating_company",
        geographies=("Nord Italia",),
        buyer_fit=0.9,
        signal_id="production_expansion",
        signal_date=published,
        evidence=(
            EvidenceRecord(
                signal_id="production_expansion",
                source_url=f"https://news.example/{domain}/expansion",
                source_publisher="Fixture News",
                source_class="recognized_news",
                excerpt=f"{name} inaugura nuovo stabilimento produttivo in Lombardia",
                observed_at=datetime.now(timezone.utc).isoformat(),
                published_at=published,
                extraction_method="fixture",
                confidence=0.9,
            ),
        ),
        why_now=f"{name} ha inaugurato un nuovo stabilimento produttivo documentato",
        contacts=(),
        confidence=0.9,
        contradiction_flags=(),
        provenance={
            "domain_verification": {
                "status": "verified",
                "confidence": 0.9,
                "score": 90,
                "evidence": ("company_tokens_in_host",),
                "resolution_source": "fixture",
                "resolution_method": "free_owned_host_verification",
                "adapter_id": "generic_web_research_v1",
                "url": f"https://{domain}/",
            }
        },
        adapter_id="generic_web_research_v1",
        adapter_version="1.0.0",
    )


def _qualified(candidate: OpportunityCandidate) -> QualifiedLead:
    return QualifiedLead(
        candidate=candidate,
        qualification_reasons=("fixture",),
        opportunity_value_score=0.8,
        qualified_at=datetime.now(timezone.utc).isoformat(),
    )


class _FakeOrchestrator:
    def __init__(self) -> None:
        self.calls = 0

    async def run(self, request, **kwargs):
        self.calls += 1
        now = datetime.now(timezone.utc).isoformat()
        if self.calls == 1:
            leads = (_qualified(_candidate("Alpha Srl", "alpha-pmi.test")),)
            status = "partial_sources_exhausted"
        else:
            leads = (_qualified(_candidate("Beta Srl", "beta-pmi.test")),)
            status = "completed_requested_count"
        return OrchestrationResult(
            status=status,  # type: ignore[arg-type]
            coverage=CapabilityCoverage(
                status="supported",
                adapter_ids=("generic_web_research_v1",),
                covered_signals=("production_expansion",),
                missing_signals=(),
                reasons=(),
            ),
            qualified_leads=leads,
            progress=SearchProgress(
                requested_count=request.requested_count,
                discovered_count=len(leads),
                raw_candidate_count=len(leads),
                unique_entity_count=len(leads),
                resolved_count=len(leads),
                audited_count=len(leads),
                evidence_verified_count=len(leads),
                qualified_count=len(leads),
                rejected_count=0,
            ),
            rejection_codes={},
            adapter_progress=(
                AdapterProgress(
                    adapter_id="generic_web_research_v1",
                    calls=1,
                    exhausted=status == "partial_sources_exhausted",
                    exhaustion_authoritative=True,
                    pages_fetched=3,
                ),
            ),
            cost_eur=0.01,
            started_at=now,
            completed_at=now,
        )


class _FakeAdapter:
    capability = _capability()

    async def discover(self, request):
        raise AssertionError("discover should not be called")


def _fixture_spec() -> UniversalQuerySpec:
    return UniversalQuerySpec(
        original_query="PMI Nord Italia nuovo stabilimento",
        seller_profile="seller",
        seller_offer="antincendio",
        target_company_profile="PMI",
        target_industries=("manifatturiero",),
        target_geographies=("Nord Italia",),
        buyer_roles=(),
        business_problem="espansione produttiva",
        requested_count=2,
        freshness_days=180,
        required_signals=("production_expansion",),
        optional_signals=(),
        excluded_entities=(),
        source_preferences=("recognized_news",),
        evidence_requirements=("official_domain",),
        cost_budget=0.10,
        capability_status="SUPPORTED",
    )


def test_engine_continues_after_partial_sources_with_progress(monkeypatch) -> None:
    orch = _FakeOrchestrator()
    registry = SourceCapabilityRegistry([_FakeAdapter()])
    engine = UniversalSignalDiscoveryEngine(registry, orchestrator=orch, max_strategy_batches=6)

    strategies = (
        DiscoveryStrategy(
            strategy_id="production_expansion:wave_a",
            signal_type="production_expansion",
            source_class="recognized_news",
            search_query="nuovo stabilimento Nord Italia",
            preferred_domains=(),
            excluded_domains=(),
            freshness_days=180,
            expected_evidence=("company_name",),
            estimated_cost=0.005,
            priority=1,
            fallback_level=0,
            adapter_affinity=("generic_web_research_v1",),
            hypothesis_id="canonical-signal:production_expansion",
            event_type="production_expansion",
            semantic_justification="production expansion supports industrial safety need",
        ),
        DiscoveryStrategy(
            strategy_id="production_expansion:wave_b",
            signal_type="production_expansion",
            source_class="recognized_news",
            search_query="ampliamento produttivo Lombardia",
            preferred_domains=(),
            excluded_domains=(),
            freshness_days=180,
            expected_evidence=("company_name",),
            estimated_cost=0.005,
            priority=2,
            fallback_level=0,
            adapter_affinity=("generic_web_research_v1",),
            hypothesis_id="canonical-signal:production_expansion",
            event_type="production_expansion",
            semantic_justification="production expansion supports industrial safety need",
        ),
    )
    monkeypatch.setattr(engine, "compile_spec", lambda *a, **k: _fixture_spec())
    monkeypatch.setattr(engine, "plan", lambda *a, **k: strategies)
    monkeypatch.setattr(
        "backend_mirror.source_adapters.universal_signal_discovery_engine.adapters_for_signals",
        lambda *a, **k: ("generic_web_research_v1",),
    )

    request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("production_expansion",),
        signal_match_mode="any",
        geographies=("Nord Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.10,
        query="PMI Nord Italia nuovo stabilimento",
        technical_filters={"semantic_authority_required": True},
    )
    result = asyncio.run(engine.run(request, plan={"raw_query": request.query}))
    assert orch.calls >= 2, orch.calls
    assert result.qualified_count >= 2
