from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend_mirror.contracts.source_registry import source_runtime_coverage
from backend_mirror.source_adapters import AdapterDiscoveryRequest, DiscoveryCursor
from backend_mirror.source_adapters.growth import (
    GrowthProviderResult,
    GrowthSignalsAdapter,
    _default_growth_provider,
    parse_growth_page,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "growth_signals_replay_v1.json"


def fixture_rows(group: str) -> list[dict]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    out = []
    for index, item in enumerate(payload[group], 1):
        row = {**payload["defaults"], **item}
        row["published_at"] = (date.today() - timedelta(days=int(row.pop("days_ago")))).isoformat()
        row.setdefault("geography", "Lombardia")
        row.setdefault("source_url", f"https://{row['official_domain']}/news/evento-{index}")
        row.setdefault("source_publisher", row["company_name"])
        out.append(row)
    return out


def request(signal: str, *, count: int = 20, budget: float = 0.125, cursor=None) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="growth_signals",
        signal_ids=(signal,),
        signal_match_mode="all",
        geographies=("Lombardia", "italy"),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=budget,
        query=(
            "Trovami PMI in Lombardia che stanno investendo concretamente in marketing"
            if signal == "investing_marketing"
            else "Trovami PMI in Lombardia con segnali concreti di espansione"
        ),
        sectors=(),
        technical_filters={},
        cursor=cursor,
    )


def provider(group: str, *, exhausted: bool = True, cost: float = 0.0):
    async def _provider(_request, _offset, _limit):
        return GrowthProviderResult(tuple([*fixture_rows("negative"), *fixture_rows(group)]), exhausted, cost)
    return _provider


@pytest.mark.parametrize("signal,group", [("investing_marketing", "marketing"), ("expansion", "expansion")])
def test_twenty_verified_growth_events_per_archetype(signal, group) -> None:
    result = asyncio.run(GrowthSignalsAdapter((provider(group),)).discover(request(signal)))
    assert len(result.candidates) == 20
    assert len({(item.official_domain, item.signal_id) for item in result.candidates}) == 20
    assert all(item.signal_date for item in result.candidates)
    assert all(item.evidence[0].source_url for item in result.candidates)
    assert all(item.evidence[0].provenance["proof_level"] in {"direct", "strong_proxy"} for item in result.candidates)
    assert all(item.entity_class == "operating_company" for item in result.candidates)
    assert result.cost_eur == 0
    assert result.exhaustion.reason == "requested_count_reached"


def test_weak_stale_publisher_noise_geography_and_enterprise_are_rejected() -> None:
    result = asyncio.run(GrowthSignalsAdapter((provider("marketing"),)).discover(request("investing_marketing")))
    expected = {item["expected_rejection"] for item in fixture_rows("negative")}
    assert expected.issubset(set(result.warnings))


def test_official_and_structured_news_parser_preserve_entity_boundary() -> None:
    today = date.today().isoformat()
    official_jsonld = {
        "@context": "https://schema.org", "@type": "Organization",
        "name": "Parser Growth Fixture Srl", "url": "https://parser-growth-fixture.test",
    }
    official_html = f"""
      <script type="application/ld+json">{json.dumps(official_jsonld)}</script>
      <meta property="article:published_time" content="{today}">
      <meta property="og:site_name" content="Parser Growth Fixture Srl">
      <article>Parser Growth Fixture Srl ha avviato una nuova campagna pubblicitaria in Lombardia.</article>
    """
    official = parse_growth_page(
        official_html, "https://parser-growth-fixture.test/news/campagna",
        ("investing_marketing",), ("Lombardia",),
    )
    assert official and official[0]["source_class"] == "official_company_website"
    assert official[0]["proof_level"] == "direct"
    assert official[0]["official_domain"] == "parser-growth-fixture.test"

    news_jsonld = {
        "@context": "https://schema.org", "@type": "NewsArticle",
        "about": {"@type": "Organization", "name": "Buyer Fixture Srl", "url": "https://buyer-fixture.test"},
    }
    news_html = f"""
      <script type="application/ld+json">{json.dumps(news_jsonld)}</script>
      <meta property="article:published_time" content="{today}">
      <meta property="og:site_name" content="Notizie Lombardia">
      <article>Buyer Fixture Srl inaugura una nuova sede in Lombardia.</article>
    """
    news = parse_growth_page(news_html, "https://notizie-lombardia.test/economia/buyer", ("expansion",), ("Lombardia",))
    assert news and news[0]["source_class"] == "recognized_local_news"
    assert news[0]["corroborated"] is False
    result = asyncio.run(GrowthSignalsAdapter((lambda *_: _async_result(news),)).discover(request("expansion", count=1)))
    assert result.candidates == ()
    assert "SECONDARY_SOURCE_NOT_CORROBORATED" in result.warnings


async def _async_result(records):
    return GrowthProviderResult(tuple(records), True, 0.0)


def test_cursor_and_hard_cost_cap() -> None:
    result = asyncio.run(GrowthSignalsAdapter((provider("marketing", exhausted=False),)).discover(request("investing_marketing", count=5)))
    assert result.exhaustion.next_cursor
    assert result.exhaustion.next_cursor.value == "growth:v1:20"
    with pytest.raises(ValueError, match="invalid growth cursor"):
        asyncio.run(GrowthSignalsAdapter((provider("marketing"),)).discover(request("investing_marketing", cursor=DiscoveryCursor("bad"))))
    with pytest.raises(RuntimeError, match="HARD_COST_CAP"):
        asyncio.run(GrowthSignalsAdapter((provider("marketing", cost=0.126),)).discover(request("investing_marketing")))


def test_default_provider_checks_budget_before_each_query(monkeypatch) -> None:
    calls = []

    def fake_search(query, _limit, *, cost_scope):
        assert cost_scope.startswith("growth-adapter:")
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
    one = asyncio.run(_default_growth_provider(request("investing_marketing", budget=0.009), 0, 20))
    assert len(calls) == 1 and one.cost_eur == 0.005
    calls.clear()
    none = asyncio.run(_default_growth_provider(request("investing_marketing", budget=0.004), 0, 20))
    assert calls == [] and none.cost_eur == 0


def test_growth_runtime_is_registered_without_claiming_ad_library() -> None:
    from backend_mirror.source_adapters.catalog import default_source_capability_registry

    ids = {item.adapter_id for item in default_source_capability_registry().capabilities()}
    assert "official_growth_signals_v1" in ids
    assert source_runtime_coverage("official_company_website") == "generic_fallback_partial"
    assert source_runtime_coverage("recognized_local_news") == "generic_fallback_partial"
    assert source_runtime_coverage("ad_transparency_library") == "unsupported"


def test_any_accepts_alternative_signals_but_all_is_fail_closed() -> None:
    marketing = fixture_rows("marketing")[0]
    expansion = fixture_rows("expansion")[0]

    async def mixed(_request, _offset, _limit):
        return GrowthProviderResult((marketing, expansion), True, 0.0)

    any_request = replace(
        request("investing_marketing", count=2),
        signal_ids=("investing_marketing", "expansion"),
        signal_match_mode="any",
    )
    any_result = asyncio.run(GrowthSignalsAdapter((mixed,)).discover(any_request))
    assert len(any_result.candidates) == 2
    assert {item.signal_id for item in any_result.candidates} == {"active_advertising", "new_location"}

    all_request = replace(any_request, signal_match_mode="all")
    all_result = asyncio.run(GrowthSignalsAdapter((mixed,)).discover(all_request))
    assert all_result.candidates == ()
    assert "ALL_SIGNALS_INCOMPLETE" in all_result.warnings
