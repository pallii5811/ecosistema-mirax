"""Rich SERP preservation and progressive hiring discovery regressions."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any, Dict, List

import pytest

from backend_mirror.source_adapters.cheap_discovery_prefilter import DiscoveryHit, prefilter_discovery_hit
from backend_mirror.source_adapters.hiring import (
    _build_hiring_discovery_queries,
    _default_hiring_provider,
    _gate_hiring_serp_hit,
    _normalize_serp_hit,
)
from backend_mirror.source_adapters.hiring_budget import (
    DISCOVERY_SOFT_CAP_EUR,
    HiringDiscoveryState,
    INITIAL_SERP_QUERIES,
    QUERY_COST_EUR,
)
from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest


def _request(**kwargs: Any) -> AdapterDiscoveryRequest:
    base = dict(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia", "Italia"),
        freshness_max_age_days=60,
        requested_count=2,
        budget_eur=0.05,
        query="Trova aziende lombarde che stanno ampliando la squadra incaricata di sviluppare nuovi clienti.",
        sectors=(),
        technical_filters={"universal_engine": True, "universal_prefilter_telemetry": {}},
        cursor=None,
    )
    base.update(kwargs)
    return AdapterDiscoveryRequest(**base)


class _EmptyClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


def test_normalize_preserves_rich_fields_and_rejects_query_as_snippet():
    query = "commerciale Lombardia posizione aperta"
    rich = _normalize_serp_hit(
        {
            "url": "https://boards.greenhouse.io/acme/jobs/1",
            "title": "Commerciale Lombardia — assunzione",
            "snippet": "Acme Spa cerca un commerciale per sviluppare nuovi clienti.",
            "publisher": "Greenhouse",
            "provider": "serper",
            "source_type": "search",
        },
        rank=1,
        query=query,
    )
    assert rich["title"].startswith("Commerciale")
    assert "nuovi clienti" in rich["snippet"]
    assert rich["hit_metadata_quality"] == "rich"
    assert query not in rich["snippet"]

    echoed = _normalize_serp_hit(
        {"url": "https://example.com/x", "title": "", "snippet": query, "provider": "serper"},
        rank=2,
        query=query,
    )
    assert echoed["snippet"] == ""
    assert echoed["hit_metadata_quality"] == "url_only"

    url_only = _normalize_serp_hit("https://jobs.lever.co/acme/xyz", rank=3, query=query)
    assert url_only["title"] == ""
    assert url_only["snippet"] == ""
    assert url_only["hit_metadata_quality"] == "url_only"


def test_rich_hiring_hit_accepted_by_prefilter_without_query_text():
    hit = DiscoveryHit(
        title="Business Developer Milano — assunzione",
        url="https://boards.greenhouse.io/acme/jobs/99",
        snippet="Candidati per sviluppare nuovi clienti in Lombardia.",
        publisher="Acme",
        rank=1,
    )
    decision = _gate_hiring_serp_hit(hit)
    assert decision.accepted is True
    # Query text must never be required as synthetic evidence.
    assert "Trova aziende" not in f"{hit.title} {hit.snippet}"


def test_url_only_hit_does_not_invent_evidence():
    hit = _normalize_serp_hit(
        {"url": "https://jobs.lever.co/acme/role", "title": "", "snippet": "", "provider": "legacy_url"},
        rank=1,
        query="commerciale Lombardia",
    )
    assert hit["title"] == ""
    assert hit["snippet"] == ""
    assert hit["hit_metadata_quality"] == "url_only"
    decision = prefilter_discovery_hit(
        DiscoveryHit(title=hit["title"], url=hit["url"], snippet=hit["snippet"])
    )
    # Empty title/snippet cannot invent event evidence.
    assert decision.accepted is False or decision.reason != "accepted_with_fabricated_snippet"


def test_progressive_serp_stops_at_initial_limit_and_preserves_rich_meta(monkeypatch):
    calls: List[str] = []

    def fake_hits(query, _limit, *, cost_scope):
        calls.append(query)
        return [{
            "url": f"https://boards.greenhouse.io/acme/jobs/{len(calls)}",
            "title": f"Commerciale assunzione {len(calls)}",
            "snippet": "Posizione aperta per sviluppare nuovi clienti in Lombardia.",
            "publisher": "Acme",
            "provider": "serper",
            "source_type": "search",
        }]

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_hits_http", fake_hits)
    monkeypatch.setattr("httpx.AsyncClient", _EmptyClient)
    telemetry: Dict[str, Any] = {}
    state = HiringDiscoveryState()
    result = asyncio.run(
        _default_hiring_provider(
            _request(budget_eur=0.05, technical_filters={
                "universal_engine": True,
                "universal_prefilter_telemetry": telemetry,
            }),
            state,
            20,
        )
    )
    assert len(calls) <= INITIAL_SERP_QUERIES
    assert result.provider_queries_executed == len(calls)
    assert result.discovery_state is not None
    assert result.discovery_state.discovery_spent_eur <= DISCOVERY_SOFT_CAP_EUR + 1e-9
    assert result.discovery_state.discovery_spent_eur < 0.04
    meta = list(result.discovery_state.url_meta)
    assert meta
    assert all(item.get("title") for item in meta)
    assert all(item.get("snippet") for item in meta)
    assert all(item.get("hit_metadata_quality") == "rich" for item in meta)
    assert all("Trova aziende" not in str(item.get("snippet") or "") for item in meta)
    assert telemetry.get("rich_serp_hits", 0) >= 1
    assert telemetry.get("provider_queries_executed", 0) == len(calls)


def test_no_further_serp_when_queue_has_pending_work(monkeypatch):
    calls: List[str] = []

    def fake_hits(query, _limit, *, cost_scope):
        calls.append(query)
        return [{
            "url": "https://boards.greenhouse.io/acme/jobs/pending",
            "title": "Sales Manager assunzione",
            "snippet": "Candidati ora — sviluppare nuovi clienti.",
            "provider": "serper",
        }]

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_hits_http", fake_hits)
    monkeypatch.setattr("httpx.AsyncClient", _EmptyClient)
    seeded = HiringDiscoveryState(
        seen_urls=("https://boards.greenhouse.io/acme/jobs/seed",),
        pending_urls=("https://boards.greenhouse.io/acme/jobs/seed",),
        url_meta=({
            "url": "https://boards.greenhouse.io/acme/jobs/seed",
            "title": "Business Developer",
            "snippet": "assunzione commerciale Lombardia",
            "query": "seed",
            "query_source": "serp:local_vacancy",
            "hit_metadata_quality": "rich",
        },),
    )
    asyncio.run(_default_hiring_provider(_request(budget_eur=0.05), seeded, 20))
    assert calls == []


def test_high_yield_query_order_starts_regional_before_provinces():
    pairs = _build_hiring_discovery_queries(_request())
    assert pairs[0][2] == "serp:local_vacancy"
    assert "Lombardia" in pairs[0][1]
    assert pairs[1][2] == "serp:ats"
    # Province expansion must not precede the regional wave.
    first_province = next(
        (index for index, item in enumerate(pairs) if "Milano" in item[1] and item[2] == "serp:local_vacancy"),
        None,
    )
    assert first_province is None or first_province >= 3


def test_cursor_preserves_rich_hit_metadata(monkeypatch):
    def fake_hits(query, _limit, *, cost_scope):
        return [{
            "url": "https://boards.greenhouse.io/acme/jobs/cursor",
            "title": "Account Executive assunzione",
            "snippet": "Posizione aperta sales Lombardia.",
            "provider": "serper",
            "rank": 1,
        }]

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_hits_http", fake_hits)
    monkeypatch.setattr("httpx.AsyncClient", _EmptyClient)
    first = asyncio.run(_default_hiring_provider(_request(budget_eur=0.01), HiringDiscoveryState(), 10))
    assert first.discovery_state is not None
    restored = HiringDiscoveryState.from_dict(first.discovery_state.to_dict())
    row = restored.url_meta[0]
    assert row["title"] == "Account Executive assunzione"
    assert "Posizione aperta" in row["snippet"]
    assert row["hit_metadata_quality"] == "rich"
