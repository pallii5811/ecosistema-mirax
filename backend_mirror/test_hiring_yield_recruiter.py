from __future__ import annotations

import asyncio
import base64
import json
from dataclasses import replace

import pytest

from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest, DiscoveryCursor
from backend_mirror.source_adapters.hiring import HiringAdapter, HiringProviderResult, _default_hiring_provider, _validate_record
from backend_mirror.source_adapters.hiring_budget import (
    DISCOVERY_CAP_EUR,
    HARD_CAP_EUR,
    QUERY_COST_EUR,
    HiringDiscoveryState,
    encode_discovery_cursor,
    load_discovery_state,
)
from backend_mirror.source_adapters.hiring_recruiter import classify_hiring_employer, enrich_record_with_recruiter_fields
from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor


def _sales_request(**overrides) -> AdapterDiscoveryRequest:
    base = dict(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia",),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=HARD_CAP_EUR,
        query="Trovami aziende in Lombardia che stanno assumendo commerciali, sales manager o business developer.",
        sectors=(),
        technical_filters={},
        cursor=None,
    )
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def _base_record(**overrides) -> dict:
    record = {
        "company_name": "Acme Srl",
        "vacancy_title": "Commerciale",
        "location": "Milano, Lombardia, Italia",
        "published_at": "2026-07-10",
        "active": True,
        "source_url": "https://acme.test/jobs/commerciale-milano",
        "source_class": "company_careers",
        "employer_is_direct": True,
        "official_domain_verified": True,
        "employer_official_domain": "acme.test",
        "entity_class": "operating_company",
        "evidence": "Acme cerca un commerciale. Candidati.",
    }
    record.update(overrides)
    return record


def test_synergie_anonymous_client_is_rejected():
    record = _base_record(
        company_name="Synergie Italia",
        vacancy_title="COMMERCIALE SETTORE GIOIELLERIA",
        source_url="https://synergie-italia.test/jobs/commerciale-gioielleria",
        employer_official_domain="synergie-italia.test",
        evidence="Synergie cerca commerciale per importante cliente nel settore gioielleria.",
        employer_is_direct=True,
    )
    enriched = enrich_record_with_recruiter_fields(record)
    assert enriched["employer_is_recruiter"] is True
    assert enriched["hiring_for_self"] is False
    assert enriched["rejection_code"] == "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
    ok, rejection = _validate_record(enriched, _sales_request(), __import__("datetime").date(2026, 7, 15))
    assert ok is False
    assert rejection == "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"


def test_recruiter_internal_sales_vacancy_passes():
    record = _base_record(
        company_name="Synergie Italia",
        vacancy_title="Commerciale interno Synergie Italia",
        source_url="https://synergie-italia.test/jobs/commerciale-interno",
        employer_official_domain="synergie-italia.test",
        evidence="Synergie Italia assume commerciale interno per la propria rete.",
    )
    enriched = enrich_record_with_recruiter_fields(record)
    assert enriched["hiring_for_self"] is True
    assert enriched.get("rejection_code", "") != "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
    ok, rejection = _validate_record(enriched, _sales_request(), __import__("datetime").date(2026, 7, 15))
    assert ok is True, rejection


def test_recruiter_with_named_final_employer_passes_on_final_domain():
    record = _base_record(
        company_name="Manpower",
        vacancy_title="Commerciale",
        source_url="https://manpower.test/jobs/commerciale-rexel",
        employer_official_domain="manpower.test",
        final_employer_name="Rexel",
        final_employer_domain="rexel.com",
        evidence="Manpower seleziona commerciale presso Rexel.",
        employer_is_direct=False,
    )
    enriched = enrich_record_with_recruiter_fields(record)
    assert enriched["employer_is_recruiter"] is True
    assert enriched["company_name"] == "Rexel"
    assert enriched["employer_official_domain"] == "rexel.com"
    ok, rejection = _validate_record(enriched, _sales_request(), __import__("datetime").date(2026, 7, 15))
    assert ok is True, rejection


def test_single_query_cost_does_not_consume_full_cap(monkeypatch):
    calls: list[str] = []

    def fake_search(query, _limit, *, cost_scope):
        calls.append(query)
        return ["https://fixture.test/jobs/sales"]

    class EmptyClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", fake_search)
    monkeypatch.setattr("httpx.AsyncClient", EmptyClient)
    result = asyncio.run(_default_hiring_provider(_sales_request(), HiringDiscoveryState(), 20))
    assert len(calls) <= 4
    assert result.cost_eur <= QUERY_COST_EUR * 4 + 1e-9
    assert result.cost_eur < HARD_CAP_EUR


def test_resume_does_not_repeat_executed_queries(monkeypatch):
    calls: list[str] = []

    def fake_search(query, _limit, *, cost_scope):
        calls.append(query)
        return []

    class EmptyClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", fake_search)
    monkeypatch.setattr("httpx.AsyncClient", EmptyClient)
    state = HiringDiscoveryState(
        query_index=1,
        executed_query_keys=("serp:local_vacancy:commerciale:Lombardia:fixture",),
        discovery_spent_eur=QUERY_COST_EUR,
    )
    executed_before = set(state.executed_query_keys)
    asyncio.run(_default_hiring_provider(_sales_request(budget_eur=0.02), state, 20))
    assert executed_before.issubset(set(state.executed_query_keys))
    assert len(state.executed_query_keys) > len(executed_before)


def test_discovery_cursor_preserves_state_roundtrip():
    state = HiringDiscoveryState(
        query_index=3,
        url_offset=12,
        discovery_spent_eur=0.015,
        executed_query_keys=("q1", "q2", "q3"),
        seen_urls=("https://a.test/1", "https://b.test/2"),
    )
    cursor = encode_discovery_cursor(state)
    loaded = load_discovery_state(cursor, {})
    assert loaded.query_index == 3
    assert loaded.url_offset == 12
    assert loaded.discovery_spent_eur == pytest.approx(0.015)
    assert loaded.executed_query_keys == ("q1", "q2", "q3")
    assert len(loaded.seen_urls) == 2


def test_governor_resume_with_persistent_client_does_not_double_reserve_prior_cost():
    class _RpcResult:
        data = {"id": "ledger-row"}

        def execute(self):
            return self

    class _PersistentClient:
        def rpc(self, name, payload):
            return _RpcResult()

    governor = ResearchCostGovernor.from_plan(
        {"_prior_cost_eur": 0.125},
        5,
        persistent_client=_PersistentClient(),
        search_id="00000000-0000-0000-0000-000000000001",
    )
    assert governor.snapshot()["committed_cost_eur"] == pytest.approx(0.125)
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("search:next", "web_search", QUERY_COST_EUR)


def test_hard_cap_never_exceeded_in_adapter():
    async def expensive_provider(_request, state, _limit):
        return HiringProviderResult((), True, HARD_CAP_EUR + 0.001, (), (), state)

    with pytest.raises(RuntimeError, match="HARD_COST_CAP"):
        asyncio.run(HiringAdapter((expensive_provider,)).discover(_sales_request()))


def test_discovery_pool_cap_limits_serper_spend():
    state = HiringDiscoveryState(discovery_spent_eur=DISCOVERY_CAP_EUR - QUERY_COST_EUR)
    assert state.max_queries_this_batch() == 1
    state.discovery_spent_eur = DISCOVERY_CAP_EUR
    assert state.max_queries_this_batch() == 0
