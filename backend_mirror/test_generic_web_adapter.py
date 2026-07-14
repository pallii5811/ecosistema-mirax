from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend_mirror.contracts.source_registry import source_runtime_coverage
from backend_mirror.source_adapters import AdapterDiscoveryRequest, DiscoveryCursor
from backend_mirror.source_adapters.generic_web import (
    GenericWebProviderResult,
    GenericWebResearchAdapter,
    _default_generic_provider,
    diversified_queries,
    parse_primary_evidence_page,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "generic_web_replay_v1.json"


def fixture_rows(group: str) -> list[dict]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rows = []
    for index, item in enumerate(payload[group], 1):
        row = {**payload["defaults"], **item}
        days = row.pop("days_ago")
        row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat() if days is not None else ""
        row.setdefault("source_url", f"https://{row['official_domain']}/news/fornitori-{index}")
        row.setdefault("source_publisher", row["company_name"])
        rows.append(row)
    return rows


def request(*, count=12, budget=0.125, cursor=None) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("seeking_supplier",),
        signal_match_mode="all",
        geographies=("Lombardia", "italy"),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=budget,
        query="Trovami PMI in Lombardia che cercano nuovi fornitori",
        sectors=("manifattura",),
        technical_filters={"query_origin": "user", "parent_query": "root", "discovery_round": 2},
        cursor=cursor,
    )


def provider(*, cost=0.0):
    async def _provider(_request, _offset, _limit):
        return GenericWebProviderResult(tuple([*fixture_rows("negative"), *fixture_rows("positive")]), cost)
    return _provider


def test_partial_fallback_emits_canonical_candidates_with_limitations() -> None:
    result = asyncio.run(GenericWebResearchAdapter((provider(),)).discover(request()))
    assert len(result.candidates) == 12
    assert len({item.official_domain for item in result.candidates}) == 12
    assert all(item.signal_id == "seeking_supplier" for item in result.candidates)
    assert all(item.confidence == 0.72 for item in result.candidates)
    assert all(item.contradiction_flags == ("GENERIC_FALLBACK_PARTIAL",) for item in result.candidates)
    assert all(item.evidence[0].provenance["query_origin"] for item in result.candidates)
    assert result.exhaustion.exhausted is False
    assert result.exhaustion.authoritative is False
    assert "partial_coverage" in result.exhaustion.reason


def test_invalid_generic_records_are_rejected_fail_closed() -> None:
    result = asyncio.run(GenericWebResearchAdapter((provider(),)).discover(request()))
    expected = {item["expected_rejection"] for item in fixture_rows("negative")}
    assert expected.issubset(set(result.warnings))


def test_parser_requires_dated_first_party_explicit_evidence() -> None:
    organization = {
        "@context": "https://schema.org", "@type": "Organization",
        "name": "Primary Fixture Srl", "url": "https://primary-fixture.test",
        "numberOfEmployees": 44,
    }
    html = f"""
      <script type="application/ld+json">{json.dumps(organization)}</script>
      <meta property="article:published_time" content="{date.today().isoformat()}">
      <meta property="og:site_name" content="Primary Fixture Srl">
      <article>Primary Fixture Srl avvia una ricerca fornitori in Lombardia.</article>
    """
    parsed = parse_primary_evidence_page(html, "https://primary-fixture.test/news/fornitori", request())
    assert parsed and parsed[0]["matched_signal_ids"] == ["seeking_supplier"]
    assert parsed[0]["company_size"] == "small"
    assert parse_primary_evidence_page(html, "https://primary-fixture.test/", request()) == []
    assert parse_primary_evidence_page("<p>ricerca fornitori</p>", "https://publisher.test/news/x", request()) == []


def test_all_and_any_preserve_signal_lineage() -> None:
    row = fixture_rows("positive")[0]
    row["matched_signal_ids"] = ["seeking_supplier"]

    async def one(_request, _offset, _limit):
        return GenericWebProviderResult((row,), 0.0)

    all_request = replace(request(count=1), signal_ids=("seeking_supplier", "certification"), signal_match_mode="all")
    all_result = asyncio.run(GenericWebResearchAdapter((one,)).discover(all_request))
    assert all_result.candidates == ()
    assert "ALL_SIGNALS_INCOMPLETE" in all_result.warnings

    any_request = replace(all_request, signal_match_mode="any")
    any_result = asyncio.run(GenericWebResearchAdapter((one,)).discover(any_request))
    assert len(any_result.candidates) == 1
    assert [item.signal_id for item in any_result.candidates[0].evidence] == ["seeking_supplier"]


def test_query_diversification_cursor_and_hard_cap() -> None:
    queries = diversified_queries(request())
    assert len(queries) == 3
    assert len(set(queries)) == 3
    result = asyncio.run(GenericWebResearchAdapter((provider(),)).discover(request(count=2)))
    assert result.exhaustion.next_cursor
    assert result.exhaustion.next_cursor.value == "generic-web:v1:20"
    with pytest.raises(ValueError, match="invalid generic web cursor"):
        asyncio.run(GenericWebResearchAdapter((provider(),)).discover(request(cursor=DiscoveryCursor("bad"))))
    with pytest.raises(RuntimeError, match="HARD_COST_CAP"):
        asyncio.run(GenericWebResearchAdapter((provider(cost=0.126),)).discover(request()))


def test_default_provider_reserves_before_every_query(monkeypatch) -> None:
    calls = []

    def fake_search(query, _limit, *, cost_scope):
        assert cost_scope.startswith("generic-web:")
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
    one = asyncio.run(_default_generic_provider(request(budget=0.009), 0, 20))
    assert len(calls) == 1 and one.cost_eur == 0.005
    calls.clear()
    none = asyncio.run(_default_generic_provider(request(budget=0.004), 0, 20))
    assert calls == [] and none.cost_eur == 0


def test_runtime_registry_keeps_fallback_explicitly_partial() -> None:
    from backend_mirror.source_adapters.catalog import default_source_capability_registry

    registry = default_source_capability_registry()
    capability = next(item for item in registry.capabilities() if item.adapter_id == "generic_web_research_v1")
    assert capability.coverage_status == "generic_fallback_partial"
    assert capability.discovery_mode == "generic_fallback"
    assert source_runtime_coverage("search_snippet") == "generic_fallback_partial"
    coverage = registry.resolve(request(), required_source_classes=("search_snippet",))
    assert coverage.status == "generic_fallback_partial"
    assert coverage.adapter_ids == ("generic_web_research_v1",)
