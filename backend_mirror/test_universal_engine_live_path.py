"""P0 live-path wiring tests: affinity, prefilter spies, generic evidence, telemetry, cursors."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Mapping, Tuple

import pytest

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    CANARY_QUERY_SPECS,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceCapabilityRegistry,
    SourceExhaustion,
    UniversalSignalDiscoveryEngine,
    UniversalSourceOrchestrator,
    request_from_plan,
)
import backend_mirror.source_adapters.generic_web as generic_web
from backend_mirror.source_adapters.generic_web import GenericWebProviderResult, GenericWebResearchAdapter, _gate_serp_hits
from backend_mirror.source_adapters.cheap_discovery_prefilter import DiscoveryHit, prefilter_discovery_hit
from backend_mirror.source_adapters.shadow_runtime import execute_source_adapter_shadow
from backend_mirror.source_adapters.universal_query_spec import canary_plan_from_seed
from backend_mirror.source_adapters.universal_signal_discovery_engine import adapters_for_signals
from backend_mirror.agents.entity_identity_resolver import EntityIdentityResult


def _cap(adapter_id: str, signals: tuple[str, ...], *, fallback: bool = False) -> SourceCapability:
    return SourceCapability(
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        supported_intents=("*",) if fallback else ("commercial_search", "*"),
        supported_signals=signals if signals != ("*",) else ("*",),
        source_classes=("recognized_news", "official_company_website", "job_board", "search_snippet"),
        geographic_coverage=("global",),
        freshness_max_age_days=None,
        discovery_mode="generic_fallback" if fallback else "discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=20,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=0.01,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("source_url",),
        evidence_guarantees=("signal_id",),
        exhaustion_semantics="best_effort" if fallback else "partition",
        coverage_status="generic_fallback_partial" if fallback else "supported",
    )


def _candidate(company: str, domain: str, signal: str, adapter_id: str) -> OpportunityCandidate:
    evidence = EvidenceRecord(
        signal_id=signal,
        source_url=f"https://news.example/{domain}/{signal}",
        source_publisher="Fixture News",
        source_class="recognized_news",
        excerpt=f"{company} prova esplicita {signal} inaugurata nel 2026",
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


class SpyAdapter:
    def __init__(self, adapter_id: str, signals: tuple[str, ...], pages: list[list[OpportunityCandidate]], *, fallback=False):
        self._capability = _cap(adapter_id, signals, fallback=fallback)
        self._pages = pages
        self.calls = 0
        self.queries: list[str] = []
        self.signal_ids: list[tuple[str, ...]] = []
        self.cursors: list[str | None] = []
        self.strategy_ids: list[str] = []

    @property
    def capability(self) -> SourceCapability:
        return self._capability

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        self.calls += 1
        self.signal_ids.append(tuple(request.signal_ids))
        self.cursors.append(request.cursor.value if request.cursor else None)
        self.strategy_ids.append(str((request.technical_filters or {}).get("universal_strategy_id") or ""))
        for item in (request.technical_filters or {}).get("universal_search_queries") or ():
            self.queries.append(str(item))
        # Simulate prefilter telemetry written by live adapters.
        bucket = request.technical_filters.get("universal_prefilter_telemetry")
        if isinstance(bucket, dict):
            bucket["raw_discovery_hits"] = int(bucket.get("raw_discovery_hits") or 0) + 5
            bucket["prefilter_accepted"] = int(bucket.get("prefilter_accepted") or 0) + 2
            bucket["prefilter_rejected"] = int(bucket.get("prefilter_rejected") or 0) + 3
            bucket["pages_opened_after_prefilter"] = int(bucket.get("pages_opened_after_prefilter") or 0) + 1
            bucket["provider_queries"] = list(bucket.get("provider_queries") or []) + list(
                (request.technical_filters or {}).get("universal_search_queries") or ()
            )
        index = min(self.calls - 1, len(self._pages) - 1) if self._pages else 0
        page = list(self._pages[index]) if self._pages else []
        exhausted = self.calls >= len(self._pages)
        now = datetime.now(timezone.utc).isoformat()
        next_cursor = None if exhausted else DiscoveryCursor(f"{self._capability.adapter_id}:p{self.calls}")
        return AdapterExecutionResult(
            adapter_id=self._capability.adapter_id,
            adapter_version="1.0.0",
            candidates=tuple(page),
            exhaustion=SourceExhaustion(exhausted, "source" if exhausted else "partition", "fixture", exhausted, next_cursor),
            operations=max(1, len(page)),
            cost_eur=0.01,
            started_at=now,
            completed_at=now,
        )


def test_strategy_adapter_affinity_matrix():
    assert adapters_for_signals(("hiring_sales",), allow_digital_audit=False) == ("structured_hiring_v1",)
    assert adapters_for_signals(("tender_won",), allow_digital_audit=False) == ("public_procurement_v1",)
    assert adapters_for_signals(("geographic_expansion",), allow_digital_audit=False) == ("official_growth_signals_v1",)
    assert adapters_for_signals(("funding",), allow_digital_audit=False) == ("generic_web_research_v1",)
    assert adapters_for_signals(("leadership_change",), allow_digital_audit=False) == ("generic_web_research_v1",)
    assert adapters_for_signals(("investing_marketing",), allow_digital_audit=False) == ("generic_web_research_v1",)
    assert adapters_for_signals(("technology_change",), allow_digital_audit=False) == ("generic_web_research_v1",)
    assert adapters_for_signals(("compliance_event",), allow_digital_audit=False) == ("generic_web_research_v1",)
    assert "legacy_digital_audit_v1" not in adapters_for_signals(("hiring_sales",), allow_digital_audit=False)
    assert adapters_for_signals(("website_weakness",), allow_digital_audit=True) == ("legacy_digital_audit_v1",)
    multi = adapters_for_signals(("geographic_expansion", "hiring_sales"), allow_digital_audit=False)
    assert "official_growth_signals_v1" in multi and "structured_hiring_v1" in multi


def test_engine_passes_affinity_as_mandatory_when_external_empty():
    hiring = SpyAdapter("structured_hiring_v1", ("hiring_sales",), [[_candidate("A Spa", "a.test", "hiring_sales", "structured_hiring_v1")]])
    growth = SpyAdapter(
        "official_growth_signals_v1",
        ("geographic_expansion", "new_location"),
        [[_candidate("B Spa", "b.test", "geographic_expansion", "official_growth_signals_v1")]],
    )
    registry = SourceCapabilityRegistry([hiring, growth])
    engine = UniversalSignalDiscoveryEngine(registry, orchestrator=UniversalSourceOrchestrator(registry, max_rounds=3, max_seconds=20), max_strategy_batches=4)
    seed = next(item for item in CANARY_QUERY_SPECS if item["id"] == "hiring_sales")
    plan = canary_plan_from_seed(seed, requested_count=1)
    request = request_from_plan(plan, requested_count=1, budget_eur=0.05)
    result = asyncio.run(engine.run(request, plan=plan, mandatory_adapter_ids=()))
    assert hiring.calls >= 1
    assert growth.calls == 0
    assert "structured_hiring_v1" in result.adapters_composed
    assert "legacy_digital_audit_v1" not in result.adapters_composed


def test_prefilter_rejects_before_fetch_semantics():
    directory = prefilter_discovery_hit(DiscoveryHit("Elenco", "https://www.paginegialle.it/x", "aziende"))
    assert directory.accepted is False and directory.reason == "directory"
    no_event = prefilter_discovery_hit(DiscoveryHit("Acme homepage", "https://www.acme.test/", "chi siamo storia"))
    assert no_event.accepted is False and no_event.reason == "no_event_hint"
    stale = prefilter_discovery_hit(DiscoveryHit("Old", "https://news.test/old", "inaugura nuova sede nel 2018"))
    assert stale.accepted is False and stale.reason == "stale_year"
    good = prefilter_discovery_hit(
        DiscoveryHit("Acme Spa apre nuova sede", "https://www.acme-industrie.it/news/sede", "Acme Spa inaugura nuova sede 2026")
    )
    assert good.accepted is True


def test_gate_serp_hits_reduces_fetch_set():
    request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=1,
        budget_eur=0.05,
        query="funding",
        technical_filters={"universal_engine": True, "universal_prefilter_telemetry": {}},
    )
    hits = [
        {"title": "Dir", "url": "https://www.paginegialle.it/a", "snippet": "elenco"},
        {"title": "No event", "url": "https://www.acme.test/", "snippet": "chi siamo"},
        {"title": "Fund Co raccoglie round", "url": "https://www.fundco.it/news", "snippet": "ha raccolto un investimento 2026"},
    ]
    accepted = _gate_serp_hits(request, hits, provider_query="funding Italia")
    assert len(accepted) == 1
    assert accepted[0].url.endswith("/news")
    telemetry = request.technical_filters["universal_prefilter_telemetry"]
    assert telemetry["raw_discovery_hits"] == 3
    assert telemetry["prefilter_accepted"] == 1
    assert telemetry["prefilter_rejected"] == 2
    assert telemetry["pages_opened_after_prefilter"] == 0


def test_live_generic_prefilter_uses_real_snippet_not_query(monkeypatch):
    fetches: list[str] = []
    monkeypatch.setattr(
        "backend_mirror.agents.search_serp.search_hits_http",
        lambda *args, **kwargs: [{
            "title": "Acme Industrie Srl",
            "url": "https://acme-industrie.it/chi-siamo",
            "snippet": "Storia, persone e valori della società.",
            "source_type": "search",
            "provider": "serper",
        }],
    )
    request = AdapterDiscoveryRequest(
        intent="commercial_search", signal_ids=("funding",), signal_match_mode="any",
        geographies=("Italia",), freshness_max_age_days=365, requested_count=1,
        budget_eur=0.005, query="aziende con finanziamento",
        technical_filters={
            "universal_engine": True,
            "universal_search_queries": ("aziende con finanziamento",),
            "universal_page_fetch": lambda url: (fetches.append(url) or ("", url)),
            "universal_prefilter_telemetry": {},
        },
    )
    result = asyncio.run(GenericWebResearchAdapter().discover(request))
    assert result.candidates == ()
    assert fetches == []
    telemetry = request.technical_filters["universal_prefilter_telemetry"]
    assert telemetry["prefilter_rejection_codes"] == {"no_event_hint": 1}


def test_empty_title_and_page_without_company_identity_rejects(monkeypatch):
    monkeypatch.setattr(
        "backend_mirror.agents.search_serp.search_hits_http",
        lambda *args, **kwargs: [{
            "title": "",
            "url": "https://news.example.it/round-2026",
            "snippet": "Annunciato un finanziamento il 12 marzo 2026.",
            "source_type": "news",
            "provider": "serper",
        }],
    )
    request = AdapterDiscoveryRequest(
        intent="commercial_search", signal_ids=("funding",), signal_match_mode="any",
        geographies=("Italia",), freshness_max_age_days=365, requested_count=1,
        budget_eur=0.005, query="finanziamenti recenti",
        technical_filters={
            "universal_engine": True,
            "universal_search_queries": ("finanziamenti recenti",),
            "universal_page_fetch": lambda url: ("<html><body>Annunciato un finanziamento il 12 marzo 2026.</body></html>", url),
            "universal_prefilter_telemetry": {},
        },
    )
    result = asyncio.run(GenericWebResearchAdapter().discover(request))
    assert result.candidates == ()
    assert "COMPANY_IDENTITY_UNRESOLVED" in result.warnings
    assert "Nova Spa" not in repr(result)


def test_universal_record_without_explicit_matched_signal_is_not_promoted(monkeypatch):
    async def provider(request, offset, limit):
        return GenericWebProviderResult(({
            "company_name": "Acme Industrie Srl",
            "official_domain": "acme-industrie.it",
            "official_domain_verified": True,
            "entity_class": "operating_company",
            "matched_signal_ids": (),
            "published_at": date.today().isoformat(),
            "source_url": "https://acme-industrie.it/news/evento",
            "source_publisher": "Acme Industrie Srl",
            "source_class": "official_company_website",
            "evidence_excerpt": "Acme Industrie Srl annuncia un evento verificabile.",
            "why_now": "Evento verificabile",
            "buyer_fit": 0.8,
        },), 0.0)

    monkeypatch.setattr(generic_web, "_valid_record", lambda *args: (True, ""))
    request = AdapterDiscoveryRequest(
        intent="commercial_search", signal_ids=("funding",), signal_match_mode="any",
        geographies=("Italia",), freshness_max_age_days=365, requested_count=1,
        budget_eur=0.0, query="funding", technical_filters={"universal_engine": True},
    )
    result = asyncio.run(GenericWebResearchAdapter((provider,)).discover(request))
    assert result.candidates == ()
    assert "NO_REQUESTED_SIGNAL_EVIDENCE" in result.warnings


@pytest.mark.parametrize(
    "signal_id,needle,snippet",
    [
        ("funding", "finanz", "Nova Spa ha raccolto un investimento nel 2026"),
        ("leadership_change", "direttore", "Nova Spa nomina un nuovo direttore commerciale nel 2026"),
        ("investing_marketing", "Ads", "Nova Spa attiva campagna pubblicitaria Meta Ads nel 2026"),
        ("technology_adoption", "piattaforma", "Nova Spa adotta e sceglie la piattaforma CRM nel 2026"),
        ("regulatory_change", "normativ", "Nova Spa completa adeguamento normativo nel 2026"),
    ],
)
def test_generic_provider_receives_universal_search_queries(signal_id: str, needle: str, snippet: str):
    sent: list[str] = []

    def spy_search(query: str, target: int):
        sent.append(query)
        return [{
            "title": "Nova Spa — annuncio",
            "url": "https://www.novaspa.it/news/evento",
            "snippet": snippet,
        }]

    def spy_fetch(url: str):
        html = (
            "<html><body>Nova Spa ha raccolto un finanziamento e nomina un nuovo direttore commerciale "
            "attivando Meta Ads campagna pubblicitaria e sceglie la piattaforma CRM dopo adeguamento normativo "
            "il 12 marzo 2026.</body></html>"
        )
        return html, url

    def fake_identity(request, **kwargs):
        return EntityIdentityResult(
            official_domain="novaspa.it",
            operating_entity_name="Nova Spa",
            entity_class="operating_company",
            identity_status="verified",
            identity_confidence=0.9,
            identity_evidence=("fixture_identity",),
            resolution_method="fixture",
            resolution_source="fixture",
            identity_resolved_at=datetime.now(timezone.utc).isoformat(),
            cost_eur=0.0,
        )

    import backend_mirror.agents.entity_identity_resolver as identity_mod

    original = identity_mod.resolve_entity_identity
    identity_mod.resolve_entity_identity = fake_identity  # type: ignore[assignment]
    try:
        adapter = GenericWebResearchAdapter()
        request = AdapterDiscoveryRequest(
            intent="commercial_search",
            signal_ids=(signal_id,),
            signal_match_mode="any",
            geographies=("Italia",),
            freshness_max_age_days=365,
            requested_count=1,
            budget_eur=0.05,
            query=f"query {signal_id}",
            technical_filters={
                "universal_engine": True,
                "universal_search_queries": (f'azienda Italia ("{needle}") 2026',),
                "universal_active_strategies": [{
                    "signal_type": signal_id,
                    "search_query": f'azienda Italia ("{needle}") 2026',
                }],
                "universal_serp_search": spy_search,
                "universal_page_fetch": spy_fetch,
                "universal_prefilter_telemetry": {},
            },
        )
        result = asyncio.run(adapter.discover(request))
    finally:
        identity_mod.resolve_entity_identity = original  # type: ignore[assignment]

    assert sent, "provider search was not called"
    assert any(needle.casefold() in q.casefold() for q in sent)
    assert result.candidates, f"expected qualified candidate for {signal_id}, warnings={result.warnings}"
    lead = result.candidates[0]
    assert lead.official_domain == "novaspa.it"
    assert lead.entity_class == "operating_company"
    assert lead.signal_date
    assert lead.evidence and lead.evidence[0].excerpt
    assert lead.evidence[0].source_url
    assert lead.why_now
    assert lead.buyer_fit is not None
    assert lead.provenance.get("domain_verification")


def _shadow_plan_for_seed(seed: Mapping[str, Any]) -> Dict[str, Any]:
    import copy
    import json
    from pathlib import Path

    base = json.loads(
        (Path(__file__).resolve().parent.parent / "contracts/fixtures/commercial-search-plan.valid.json").read_text(
            encoding="utf-8"
        )
    )
    plan = copy.deepcopy(base)
    signals = list(seed["required_signals"])
    plan["raw_query"] = seed["query"]
    plan["search_id"] = f"universal-{seed['id']}"
    plan["signal_policy"]["required_signals"] = signals
    plan["signal_policy"]["optional_signals"] = []
    plan["signal_policy"]["maximum_age_days_by_signal"] = {signal: 180 for signal in signals}
    plan["commercial_hypotheses"][0]["signals"] = signals
    plan["commercial_hypotheses"][0]["buyer_problem"] = seed.get("business_problem") or plan["commercial_hypotheses"][0]["buyer_problem"]
    plan["target"]["geographies"] = list(seed.get("geographies") or ["Italia"])
    plan["source_policy"]["preferred_source_classes"] = []
    plan["source_policy"]["allowed_source_classes"] = [
        "official_company_website",
        "company_careers",
        "public_procurement_portal",
        "recognized_local_news",
        "industry_publication",
        "search_snippet",
        "job_board",
    ]
    plan["budget_policy"]["hard_cost_eur"] = 0.125
    plan["budget_policy"]["target_cost_eur"] = 0.025
    return plan


def test_shadow_matrix_ten_queries_provider_spy():
    """End-to-end shadow path with spy adapters for all 10 canary queries."""
    adapters = {
        "structured_hiring_v1": SpyAdapter("structured_hiring_v1", ("hiring", "hiring_sales", "hiring_marketing", "hiring_operational", "hiring_technology"), [[]]),
        "public_procurement_v1": SpyAdapter("public_procurement_v1", ("tender_won", "contract_awarded"), [[]]),
        "official_growth_signals_v1": SpyAdapter(
            "official_growth_signals_v1",
            ("new_location", "geographic_expansion", "production_expansion", "active_advertising", "rebranding", "investing_marketing", "expansion"),
            [[]],
        ),
        "generic_web_research_v1": SpyAdapter(
            "generic_web_research_v1",
            ("*",),
            [[]],
            fallback=True,
        ),
        "legacy_digital_audit_v1": SpyAdapter(
            "legacy_digital_audit_v1",
            ("website_weakness", "seo_errors", "missing_analytics", "missing_advertising_pixel", "*"),
            [[]],
        ),
    }
    # Digital audit must be selectable by registry (intents + signals).
    adapters["legacy_digital_audit_v1"]._capability = _cap(
        "legacy_digital_audit_v1",
        ("website_weakness", "seo_errors", "missing_analytics", "missing_advertising_pixel"),
    )
    adapters["structured_hiring_v1"]._pages = [[_candidate("HireCo", "hireco.test", "hiring_sales", "structured_hiring_v1")]]
    adapters["public_procurement_v1"]._pages = [[_candidate("TenderCo", "tenderco.test", "tender_won", "public_procurement_v1")]]
    adapters["official_growth_signals_v1"]._pages = [[_candidate("GrowCo", "growco.test", "geographic_expansion", "official_growth_signals_v1")]]
    adapters["generic_web_research_v1"]._pages = [[_candidate("FundCo", "fundco.test", "funding", "generic_web_research_v1")]]
    adapters["legacy_digital_audit_v1"]._pages = [[_candidate("SeoCo", "seoco.test", "website_weakness", "legacy_digital_audit_v1")]]

    registry = SourceCapabilityRegistry(list(adapters.values()))
    env = {
        "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1",
        "MIRAX_SEARCH_DISABLED": "0",
        "MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": "0.125",
    }
    rows = []
    for seed in CANARY_QUERY_SPECS:
        for spy in adapters.values():
            spy.calls = 0
            spy.queries.clear()
            spy.strategy_ids.clear()
        plan = _shadow_plan_for_seed(seed)
        intent = {
            "lifecycle_stage": "v5_shadow",
            "customer_visible": False,
            "prepare_only": False,
            "execution_authorized": True,
            "source_adapter_shadow": True,
            "uqe_plan": {"canonical_plan": plan, "source_coverage": {"adapter_ids": []}},
        }
        result = asyncio.run(
            execute_source_adapter_shadow(
                intent,
                requested_count=1,
                registry=registry,
                environ=env,
            )
        )
        called = [aid for aid, spy in adapters.items() if spy.calls > 0]
        rows.append({
            "id": seed["id"],
            "called": called,
            "queries": [q for spy in adapters.values() for q in spy.queries],
            "qualified": result.progress.qualified_count,
            "cost": result.cost_eur,
            "da_called": adapters["legacy_digital_audit_v1"].calls > 0,
        })
        assert result.progress.published_count == 0
        assert result.cost_eur <= 0.125 + 1e-9
        assert any(spy.queries for spy in adapters.values() if spy.calls), f"no provider query for {seed['id']}"

    assert len(rows) == 10
    seo = next(item for item in rows if item["id"] == "seo_weakness")
    assert seo["da_called"] is True
    for item in rows:
        if item["id"] != "seo_weakness":
            assert item["da_called"] is False, item
    hiring = next(item for item in rows if item["id"] == "hiring_sales")
    assert "structured_hiring_v1" in hiring["called"]
    tender = next(item for item in rows if item["id"] == "tender_won")
    assert "public_procurement_v1" in tender["called"]
    expansion = next(item for item in rows if item["id"] == "new_locations")
    assert "official_growth_signals_v1" in expansion["called"]
    funding = next(item for item in rows if item["id"] == "funding")
    assert "generic_web_research_v1" in funding["called"]
    marketing = next(item for item in rows if item["id"] == "marketing_investment")
    assert "generic_web_research_v1" in marketing["called"]



def test_strategy_telemetry_and_cursor_isolation():
    """P0-4/P0-5: per-strategy metrics + cursor keyed by adapter::strategy."""
    from backend_mirror.source_adapters.catalog import CapabilityCoverage
    from backend_mirror.source_adapters.orchestrator import AdapterProgress, OrchestrationResult, SearchProgress
    from backend_mirror.source_adapters.contracts import QualifiedLead

    class FakeOrch:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def run(self, request, *, mandatory_adapter_ids=(), resume_cursors=None, **kwargs):
            strategy_id = str((request.technical_filters or {}).get("universal_strategy_id") or "")
            resume = {k: (v.value if v else None) for k, v in (resume_cursors or {}).items()}
            self.calls.append({
                "strategy_id": strategy_id,
                "query": list((request.technical_filters or {}).get("universal_search_queries") or ()),
                "resume": resume,
                "mandatory": list(mandatory_adapter_ids),
            })
            idx = len(self.calls)
            adapter_id = list(mandatory_adapter_ids)[0]
            now = datetime.now(timezone.utc).isoformat()
            leads: tuple = ()
            if idx == 1:
                # Strategy A page 1 -> cursor p2 token for next page
                next_cursor = DiscoveryCursor("generic_web_research_v1:A:p2")
                cand = _candidate("A1", "a1.test", "funding", adapter_id)
                leads = (
                    QualifiedLead(
                        candidate=cand,
                        qualification_reasons=("fixture",),
                        opportunity_value_score=0.8,
                        qualified_at=now,
                    ),
                )
            elif idx == 2:
                # Strategy B must start fresh (no A cursor)
                assert "generic_web_research_v1:A:p2" not in resume.values()
                next_cursor = DiscoveryCursor("generic_web_research_v1:B:p1")
                leads = ()
            elif idx == 3:
                # Resume strategy A at page 2
                assert resume.get(adapter_id) == "generic_web_research_v1:A:p2"
                next_cursor = DiscoveryCursor("generic_web_research_v1:A:p3")
                cand = _candidate("A2", "a2.test", "funding", adapter_id)
                leads = (
                    QualifiedLead(
                        candidate=cand,
                        qualification_reasons=("fixture",),
                        opportunity_value_score=0.8,
                        qualified_at=now,
                    ),
                )
            else:
                next_cursor = DiscoveryCursor(f"generic_web_research_v1:X:p{idx}")
                leads = ()

            bucket = (request.technical_filters or {}).get("universal_prefilter_telemetry")
            if isinstance(bucket, dict):
                bucket["raw_discovery_hits"] = 4
                bucket["prefilter_accepted"] = 1
                bucket["pages_opened_after_prefilter"] = 1
                bucket["provider_queries"] = list((request.technical_filters or {}).get("universal_search_queries") or ())

            progress = SearchProgress(
                requested_count=request.requested_count,
                discovered_count=len(leads),
                raw_candidate_count=4,
                unique_entity_count=len(leads),
                resolved_count=len(leads),
                audited_count=0,
                evidence_verified_count=0,
                qualified_count=len(leads),
                rejected_count=0,
                cost_eur=0.01,
                qualified_leads=leads,
            )
            return OrchestrationResult(
                status="partial_sources_exhausted",
                coverage=CapabilityCoverage("supported", tuple(mandatory_adapter_ids), ("funding",), (), ()),
                qualified_leads=leads,
                progress=progress,
                rejection_codes={},
                adapter_progress=(
                    AdapterProgress(adapter_id=adapter_id, calls=1, next_cursor=next_cursor, exhausted=False),
                ),
                cost_eur=0.01,
                started_at=now,
                completed_at=now,
            )

    fake = FakeOrch()
    generic = SpyAdapter("generic_web_research_v1", ("funding", "capital_investment", "*"), [[]], fallback=True)
    registry = SourceCapabilityRegistry([generic])
    engine = UniversalSignalDiscoveryEngine(
        registry,
        orchestrator=fake,  # type: ignore[arg-type]
        max_strategy_batches=4,
        zero_yield_abort_rounds=2,
    )
    from backend_mirror.source_adapters.signal_strategy_planner import DiscoveryStrategy

    two = (
        DiscoveryStrategy(
            strategy_id="funding:A",
            signal_type="funding",
            source_class="recognized_news",
            search_query='funding A query ("investimento")',
            preferred_domains=(),
            excluded_domains=(),
            freshness_days=180,
            expected_evidence=("company_name",),
            estimated_cost=0.005,
            priority=10,
                fallback_level=0,
                adapter_affinity=("generic_web_research_v1",),
                hypothesis_id="h-funding",
                event_type="funding",
                semantic_justification="funding event supports growth",
                required_target_role="target_operating_company",
            ),
        DiscoveryStrategy(
            strategy_id="funding:B",
            signal_type="funding",
            source_class="recognized_news",
            search_query='funding B query ("round")',
            preferred_domains=(),
            excluded_domains=(),
            freshness_days=180,
            expected_evidence=("company_name",),
            estimated_cost=0.005,
            priority=11,
                fallback_level=1,
                adapter_affinity=("generic_web_research_v1",),
                hypothesis_id="h-funding",
                event_type="funding",
                semantic_justification="funding event supports growth",
                required_target_role="target_operating_company",
            ),
    )
    engine.plan = lambda spec: two  # type: ignore[method-assign]
    seed = next(item for item in CANARY_QUERY_SPECS if item["id"] == "funding")
    plan = canary_plan_from_seed(seed, requested_count=3)
    request = request_from_plan(plan, requested_count=3, budget_eur=0.125)
    result = asyncio.run(engine.run(request, plan=plan))

    assert len(fake.calls) >= 3
    assert all(len(call["query"]) == 1 for call in fake.calls)
    # A -> B -> A resume
    assert fake.calls[0]["strategy_id"] != fake.calls[1]["strategy_id"]
    assert fake.calls[2]["strategy_id"] == fake.calls[0]["strategy_id"]
    assert fake.calls[2]["resume"].get("generic_web_research_v1") == "generic_web_research_v1:A:p2"
    assert "generic_web_research_v1:A:p2" not in fake.calls[1]["resume"].values()

    executed = [s for s in result.strategy_stats if s.rounds > 0]
    assert executed
    assert len({(s.strategy_id, s.provider_query) for s in executed}) == len(executed)
    productive = [s for s in executed if s.productive]
    assert productive
    assert all(s.raw_hits == 4 * s.rounds for s in executed)
    # Zero-yield strategy B aborted after 2 empty rounds if it ran twice, or still pending
    domains = [lead.candidate.official_domain for lead in result.orchestration.qualified_leads]
    assert len(domains) == len(set(domains))
