"""Offline tests for UniversalSignalDiscoveryEngine (no live network)."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import date, datetime, timezone

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    CANARY_QUERY_SPECS,
    DiscoveryHit,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceCapabilityRegistry,
    SourceExhaustion,
    UniversalSignalDiscoveryEngine,
    UniversalSourceOrchestrator,
    cheap_rank_hits,
    compile_universal_query_spec,
    extract_evidence_from_text,
    plan_strategies,
    prefilter_discovery_hit,
    request_from_plan,
)
from backend_mirror.source_adapters.universal_query_spec import canary_plan_from_seed
from backend_mirror.source_adapters.universal_strategy_queries import universal_strategy_queries_from_filters


def _capability(adapter_id: str, signals: tuple[str, ...]) -> SourceCapability:
    return SourceCapability(
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        supported_intents=("commercial_search", "*"),
        supported_signals=signals,
        source_classes=("recognized_news", "official_company_website", "job_board"),
        geographic_coverage=("global",),
        freshness_max_age_days=None,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=20,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=0.01,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("source_url",),
        evidence_guarantees=("signal_id",),
        exhaustion_semantics="partition",
        coverage_status="supported",
    )


def _candidate(company: str, domain: str, signal: str, adapter_id: str) -> OpportunityCandidate:
    evidence = EvidenceRecord(
        signal_id=signal,
        source_url=f"https://news.example/{domain}/{signal}",
        source_publisher="Fixture News",
        source_class="recognized_news",
        excerpt=f"{company} ha annunciato evento {signal} con prova esplicita",
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
        buyer_fit=0.9,
        signal_id=signal,
        signal_date=date.today().isoformat(),
        evidence=(evidence,),
        why_now=f"Segnale {signal}",
        contacts=(),
        confidence=0.92,
        contradiction_flags=(),
        provenance={
            "domain_verification": {
                "status": "verified",
                "url": f"https://{domain}/",
                "confidence": 0.95,
                "evidence": ["homepage_match"],
                "resolution_source": "fixture",
                "resolution_method": "fixture",
            },
            "adapter_id": adapter_id,
        },
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        official_domain_verified=True,
        official_domain_confidence=0.95,
    )


class _StubAdapter:
    def __init__(self, adapter_id: str, signals: tuple[str, ...], pages: list[list[OpportunityCandidate]]):
        self._capability = _capability(adapter_id, signals)
        self._pages = pages
        self.calls = 0

    @property
    def capability(self) -> SourceCapability:
        return self._capability

    async def discover(self, request: AdapterDiscoveryRequest):
        self.calls += 1
        index = min(self.calls - 1, len(self._pages) - 1) if self._pages else 0
        page = list(self._pages[index]) if self._pages else []
        # Honor universal search queries presence (engine composition).
        assert request.technical_filters.get("universal_engine") is True
        exhausted = self.calls >= len(self._pages)
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self._capability.adapter_id,
            adapter_version="1.0.0",
            candidates=tuple(page),
            exhaustion=SourceExhaustion(
                exhausted,
                "source" if exhausted else "partition",
                "fixture",
                exhausted,
                None,
            ),
            operations=max(1, len(page)),
            cost_eur=0.01,
            started_at=now,
            completed_at=now,
            warnings=(),
        )


def test_query_spec_and_strategies_for_all_canaries():
    for seed in CANARY_QUERY_SPECS:
        plan = canary_plan_from_seed(seed, requested_count=5)
        spec = compile_universal_query_spec(plan, requested_count=5)
        assert spec.requested_count == 5
        assert spec.cost_budget <= 0.125 + 1e-9
        assert spec.required_signals
        assert "official_domain" in spec.evidence_requirements
        strategies = plan_strategies(spec)
        assert len(strategies) >= 6 * len(spec.required_signals)
        kinds = {item.strategy_id.split(":", 1)[-1] for item in strategies}
        assert {"company_owned", "source_specific", "event_specific", "geography_specific", "italian_synonyms", "fallback"} <= kinds
        # Never collapse to category+city only.
        assert any("OR" in item.search_query or "site:" in item.search_query for item in strategies)


def test_crm_expansion_example_observability():
    seed = next(item for item in CANARY_QUERY_SPECS if item["id"] == "multi_expansion_hiring")
    plan = canary_plan_from_seed(seed, requested_count=5)
    spec = compile_universal_query_spec(plan, requested_count=5)
    assert "geographic_expansion" in spec.required_signals
    assert "hiring_sales" in spec.required_signals
    strategies = plan_strategies(spec)
    joined = " ".join(item.search_query.casefold() for item in strategies)
    assert "commerciale" in joined or "sales" in joined
    assert "sede" in joined or "espans" in joined


def test_cheap_prefilter_rejects_directory_and_stale():
    hits = [
        DiscoveryHit("PagineGialle elenco", "https://www.paginegialle.it/foo", "elenco aziende"),
        DiscoveryHit("Comune di Milano", "https://www.comune.milano.it/x", "avviso pubblico"),
        DiscoveryHit("Acme Spa apre nuova sede a Bergamo", "https://www.acme-industrie.it/news/sede", "Acme Spa inaugura nuova sede 2026"),
        DiscoveryHit("Old Co apertura 2018", "https://news.example/old", "apertura sede nel 2018"),
        DiscoveryHit("Italia che fa impresa", "https://bebeez.it/italia-che-fa-impresa/", "hub imprese"),
        DiscoveryHit("RICHIEDI INFORMAZIONI", "https://bevertech.it/espositori/richiedi-informazioni", "form"),
        DiscoveryHit("Italia Nostra Onlus", "https://www.italianostra.org/sezioni-e-consigli-regionali/sardegna/", "associazione"),
    ]
    ranked = cheap_rank_hits(hits)
    accepted_urls = {hit.url for hit, _ in ranked}
    assert "https://www.acme-industrie.it/news/sede" in accepted_urls
    assert all("paginegialle" not in url for url in accepted_urls)
    assert all("comune.milano" not in url for url in accepted_urls)
    assert all("bebeez.it" not in url for url in accepted_urls)
    assert all("richiedi-informazioni" not in url for url in accepted_urls)
    assert all("italianostra" not in url for url in accepted_urls)
    rejected = prefilter_discovery_hit(hits[0])
    assert rejected.accepted is False


def test_evidence_extraction_requires_proof_phrase():
    text = (
        "Bergamo, 12 marzo 2026 — Acme Industrie Spa ha inaugurato una nuova sede operativa "
        "e cerca un direttore commerciale per rafforzare la rete."
    )
    events = extract_evidence_from_text(
        text=text,
        source_url="https://www.acme-industrie.it/news",
        source_class="corporate_newsroom",
        publisher="Acme Industrie",
        company_name_hint="Acme Industrie Spa",
        requested_signals=("new_location", "hiring_sales", "leadership_change"),
    )
    assert events
    assert all(item.evidence_excerpt for item in events)
    assert all(item.source_url for item in events)
    types = {item.event_type for item in events}
    assert "new_location" in types or "leadership_change" in types


def test_universal_strategy_query_injection():
    queries = universal_strategy_queries_from_filters(
        {
            "universal_active_strategies": [
                {"signal_type": "hiring_sales", "search_query": 'assume "commerciale" Lombardia'},
                {"signal_type": "tender_won", "search_query": "aggiudicata gara"},
            ]
        },
        signal_ids=("hiring_sales",),
        max_queries=4,
    )
    assert queries == ('assume "commerciale" Lombardia',)


def test_engine_adaptive_loop_reaches_requested_count_without_padding():
    hiring = _StubAdapter(
        "structured_hiring_v1",
        ("hiring_sales",),
        [
            [_candidate("Alpha Spa", "alpha.test", "hiring_sales", "structured_hiring_v1")],
            [_candidate("Beta Srl", "beta.test", "hiring_sales", "structured_hiring_v1")],
            [
                _candidate("Gamma Spa", "gamma.test", "hiring_sales", "structured_hiring_v1"),
                _candidate("Delta Srl", "delta.test", "hiring_sales", "structured_hiring_v1"),
                _candidate("Epsilon Spa", "epsilon.test", "hiring_sales", "structured_hiring_v1"),
            ],
        ],
    )
    registry = SourceCapabilityRegistry([hiring])
    engine = UniversalSignalDiscoveryEngine(
        registry,
        orchestrator=UniversalSourceOrchestrator(registry, max_rounds=5, max_seconds=30),
        max_strategy_batches=6,
        zero_yield_abort_rounds=2,
    )
    seed = next(item for item in CANARY_QUERY_SPECS if item["id"] == "hiring_sales")
    plan = canary_plan_from_seed(seed, requested_count=5)
    request = request_from_plan(plan, requested_count=5, budget_eur=0.125)
    result = asyncio.run(engine.run(request, plan=plan, cheap_hits=[
        {"title": "Alpha Spa assume commerciale", "url": "https://jobs.example/alpha", "snippet": "posizione aperta sales Lombardia 2026"},
    ]))
    assert result.qualified_count == 5
    assert result.orchestration.status == "completed_requested_count"
    assert result.cost_eur <= 0.125 + 1e-9
    assert result.cost_eur / max(1, result.qualified_count) <= 0.025 + 1e-9 or result.cost_eur <= 0.05
    assert result.capability_status in {"SUPPORTED", "SUPPORTED_PARTIAL"}
    assert "legacy_digital_audit_v1" not in result.adapters_composed
    domains = {lead.candidate.official_domain for lead in result.orchestration.qualified_leads}
    assert len(domains) == 5


def test_engine_does_not_force_digital_audit_for_non_seo_query():
    growth = _StubAdapter(
        "official_growth_signals_v1",
        ("new_location", "geographic_expansion"),
        [[_candidate("Open Spa", "open.test", "new_location", "official_growth_signals_v1")]],
    )
    registry = SourceCapabilityRegistry([growth])
    engine = UniversalSignalDiscoveryEngine(registry, orchestrator=UniversalSourceOrchestrator(registry, max_rounds=3, max_seconds=20))
    seed = next(item for item in CANARY_QUERY_SPECS if item["id"] == "new_locations")
    plan = canary_plan_from_seed(seed, requested_count=1)
    request = request_from_plan(plan, requested_count=1, budget_eur=0.025)
    result = asyncio.run(engine.run(request, plan=plan))
    assert "legacy_digital_audit_v1" not in result.adapters_composed
    assert result.qualified_count >= 1


def test_small_target_caps_zero_yield_strategy_batches_before_hard_budget_is_burned():
    empty = _StubAdapter("official_growth_signals_v1", ("production_expansion",), [[]])
    registry = SourceCapabilityRegistry([empty])
    engine = UniversalSignalDiscoveryEngine(
        registry,
        orchestrator=UniversalSourceOrchestrator(registry, max_rounds=2, max_seconds=20),
        max_strategy_batches=12,
    )
    plan = {
        **canary_plan_from_seed(
            {
                "id": "expansion-cost-guard",
                "query": "PMI del Nord Italia con nuovi stabilimenti",
                "required_signals": ["production_expansion"],
                "geographies": ["Nord Italia"],
                "industries": ["manifattura"],
            },
            requested_count=3,
        ),
    }
    plan["budget_policy"]["maximum_search_calls"] = 40
    request = request_from_plan(plan, requested_count=3, budget_eur=0.125)
    result = asyncio.run(engine.run(request, plan=plan))
    assert empty.calls <= 6
    assert "strategy_batch_cost_guard_reached:6" in result.notes


def test_legacy_cursor_with_followups_binds_to_unrelated_strategy_query() -> None:
    """Queued recoveries must not be stranded when resume rotates to a virgin strategy."""
    from backend_mirror.source_adapters.contracts import DiscoveryCursor
    from backend_mirror.source_adapters.generic_web_budget import (
        GenericWebDiscoveryState,
        encode_generic_web_cursor,
    )
    from backend_mirror.source_adapters.signal_strategy_planner import DiscoveryStrategy
    from backend_mirror.source_adapters.universal_signal_discovery_engine import (
        _legacy_cursor_belongs_to_strategy,
    )

    state = GenericWebDiscoveryState(
        pages_fetched=12,
        provider_calls=2,
        executed_query_keys=('\"sceglie\" CRM OR \"adotta\" CRM Italia',),
        followup_queries=('\"Opinel\" (CRM) (sceglie OR adotta)',),
    )
    cursor = encode_generic_web_cursor(state)
    other = DiscoveryStrategy(
        strategy_id="technology_adoption:crm_hypothesis_0",
        signal_type="technology_adoption",
        source_class="recognized_news",
        search_query='azienda Italia ("adotta" OR "sceglie") CRM',
        preferred_domains=(),
        excluded_domains=(),
        freshness_days=365,
        expected_evidence=("company_name",),
        estimated_cost=0.005,
        priority=1,
        fallback_level=0,
        adapter_affinity=("generic_web_research_v1",),
    )
    assert _legacy_cursor_belongs_to_strategy(cursor, other) is True

    empty = encode_generic_web_cursor(GenericWebDiscoveryState())
    assert _legacy_cursor_belongs_to_strategy(empty, other) is False
