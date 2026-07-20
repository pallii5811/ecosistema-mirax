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
    _structured_subject_identities,
)
from backend_mirror.source_adapters.generic_web_budget import decode_generic_web_v2_payload


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
    assert result.exhaustion.next_cursor.value.startswith("generic-web:v2:")
    with pytest.raises(ValueError, match="invalid generic web cursor"):
        asyncio.run(GenericWebResearchAdapter((provider(),)).discover(request(cursor=DiscoveryCursor("bad"))))
    with pytest.raises(RuntimeError, match="HARD_COST_CAP"):
        asyncio.run(GenericWebResearchAdapter((provider(cost=0.126),)).discover(request()))


def test_resume_cursor_v1_migrates_to_v2() -> None:
    adapter = GenericWebResearchAdapter((provider(),))
    result = asyncio.run(adapter.discover(request(count=2, cursor=DiscoveryCursor("generic-web:v1:20"))))
    assert result.exhaustion.next_cursor
    assert result.exhaustion.next_cursor.value.startswith("generic-web:v2:")


def test_resume_cursor_v2_is_accepted() -> None:
    adapter = GenericWebResearchAdapter((provider(),))
    first = asyncio.run(adapter.discover(request(count=2)))
    second = asyncio.run(adapter.discover(request(count=2, cursor=first.exhaustion.next_cursor)))
    assert second.exhaustion.next_cursor
    assert second.exhaustion.next_cursor.value.startswith("generic-web:v2:")
    assert second.exhaustion.next_cursor.value != first.exhaustion.next_cursor.value


def test_resume_round_advances_processed_urls_without_duplicate_fetch() -> None:
    fetch_calls: list[str] = []

    def serp(_query: str, _limit: int):
        return [
            {"title": "A", "url": "https://alpha.test/news/a", "snippet": "Alpha annuncia migrazione CRM", "publisher": "News", "provider": "fixture", "rank": 1},
            {"title": "B", "url": "https://beta.test/news/b", "snippet": "Beta cerca partner CRM", "publisher": "News", "provider": "fixture", "rank": 2},
            {"title": "C", "url": "https://gamma.test/news/c", "snippet": "Gamma implementa CRM", "publisher": "News", "provider": "fixture", "rank": 3},
            {"title": "D", "url": "https://delta.test/news/d", "snippet": "Delta avvia progetto CRM", "publisher": "News", "provider": "fixture", "rank": 4},
        ]

    def fetch(url: str):
        fetch_calls.append(url)
        html = f"""
        <html><head>
        <meta property="article:published_time" content="{date.today().isoformat()}"/>
        </head><body>
        <article>Alpha Srl annuncia migrazione CRM.</article>
        </body></html>
        """
        return html, url

    req = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("technology_adoption",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=365,
        requested_count=1,
        budget_eur=0.05,
        query="aziende che migrano CRM",
        sectors=("software",),
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": False,
            "universal_search_queries": ("aziende crm",),
            "universal_serp_search": serp,
            "universal_page_fetch": fetch,
            "universal_prefilter_telemetry": {},
        },
    )
    adapter = GenericWebResearchAdapter()
    first = asyncio.run(adapter.discover(req))
    payload1 = decode_generic_web_v2_payload(first.exhaustion.next_cursor.value) or {}
    processed1 = len(payload1.get("processed_terminal_urls") or [])
    first_fetch_total = len(fetch_calls)

    second = asyncio.run(adapter.discover(replace(req, cursor=first.exhaustion.next_cursor)))
    payload2 = decode_generic_web_v2_payload(second.exhaustion.next_cursor.value) or {}
    processed2 = len(payload2.get("processed_terminal_urls") or [])
    assert second.exhaustion.next_cursor.value != first.exhaustion.next_cursor.value
    assert processed2 >= processed1
    assert len(fetch_calls) == first_fetch_total


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


def test_open_world_acquisition_uses_structured_target_not_publisher() -> None:
    relationship = "resources_allocated_to_target_company"
    article = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "datePublished": date.today().isoformat(),
        "publisher": {"@type": "Organization", "name": "Economia Oggi", "url": "https://news.test"},
        "about": {"@type": "Organization", "name": "Beta Srl", "url": "https://beta.test"},
    }
    html = (
        f'<script type="application/ld+json">{json.dumps(article)}</script>'
        '<article>A Beta Srl sono state destinate nuove risorse per ampliare la produzione.</article>'
    )
    semantic_request = AdapterDiscoveryRequest(
        intent="commercial_search", signal_ids=(relationship,), signal_match_mode="all",
        geographies=("Italia",), freshness_max_age_days=365, requested_count=1,
        budget_eur=0.005, query="aziende a cui sono state destinate nuove risorse",
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "semantic_query_contract": {"required_relationships": [relationship]},
            "universal_search_queries": ("aziende a cui sono state destinate nuove risorse",),
            "universal_serp_search": lambda _query, _limit: [{
                "title": "Nuove risorse per Beta Srl", "url": "https://news.test/beta",
                "snippet": "A Beta Srl sono state destinate nuove risorse.",
                "publisher": "Economia Oggi", "provider": "fixture",
            }],
            "universal_page_fetch": lambda url: (html, url),
            "universal_prefilter_telemetry": {},
        },
    )
    result = asyncio.run(_default_generic_provider(semantic_request, 0, 10))
    assert len(result.records) == 1
    record = result.records[0]
    assert record["company_name"] == "Beta Srl"
    assert record["official_domain"] == "beta.test"
    assert record["source_publisher"] == "Economia Oggi"
    assert record["matched_signal_ids"] == [relationship]
    assert "destinate nuove risorse" in record["source_text"]


def test_structured_identity_incomplete_falls_through_to_open_world() -> None:
    published = date.today().isoformat()
    article = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "publisher": {"@type": "Organization", "name": "Energia News", "url": "https://news.test"},
        "about": {"@type": "Organization", "name": "Sintropy.AI", "url": "https://sintropy.ai"},
        # intentionally no datePublished — must not block open-world extraction
    }
    html = (
        f'<html><head><script type="application/ld+json">{json.dumps(article)}</script>'
        f'<meta property="article:published_time" content="{published}T10:00:00Z"></head>'
        "<body><p>Sintropy.AI chiude un round seed da 1 milione di euro.</p></body></html>"
    )
    # Remove meta so structured path has identity but no structured date from JSON-LD only.
    html_no_meta = (
        f'<html><head><script type="application/ld+json">{json.dumps(article)}</script></head>'
        "<body><article><p>Sintropy.AI chiude un round seed da 1 milione di euro per accelerare "
        "lo sviluppo della piattaforma di efficientamento energetico dedicata a retail e industria "
        f"alimentare. L'annuncio e stato pubblicato il {published[8:10]}/{published[5:7]}/{published[0:4]} "
        "con il coinvolgimento di investitori italiani.</p></article></body></html>"
    )
    funding_request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami startup che stanno raccogliendo fondi di investimento.",
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "semantic_query_contract": {"required_relationships": ["startup_raising_or_receiving_investment"]},
            "universal_search_queries": ("startup round",),
            "universal_serp_search": lambda _query, _limit: [{
                "title": "Sintropy.AI chiude un round seed da 1 milione di euro",
                "url": "https://news.test/sintropy",
                "snippet": "Sintropy.AI chiude un round seed da 1 milione di euro",
                "publisher": "Energia News",
                "provider": "fixture",
            }],
            "universal_page_fetch": lambda url: (html_no_meta, url),
            "universal_prefilter_telemetry": {},
        },
    )
    result = asyncio.run(GenericWebResearchAdapter((_default_generic_provider,)).discover(funding_request))
    assert len(result.candidates) == 1, result.warnings
    assert result.candidates[0].canonical_company_name == "Sintropy.AI"


def test_open_world_invertix_article_emits_raw_candidate() -> None:
    published = date.today().isoformat()
    body = (
        "Invertix chiude un round pre-seed da 1,7 milioni di euro. "
        "Invertix, startup con sede tra Italia e Germania che sviluppa agenti AI per il settore energy, "
        "annuncia la chiusura del round."
    )
    html = (
        f'<html><head><meta property="article:published_time" content="{published}T10:00:00Z"></head>'
        f"<body><article><p>{body}</p></article></body></html>"
    )
    funding_request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami startup che stanno raccogliendo fondi di investimento.",
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "semantic_query_contract": {"required_relationships": ["startup_raising_or_receiving_investment"]},
            "universal_search_queries": ("startup round investimento italia",),
            "universal_serp_search": lambda _query, _limit: [{
                "title": "Invertix chiude un round pre-seed da 1,7 milioni di euro",
                "url": "https://www.energiamercato.it/notizie/enertech/invertix-round-di-finanziamento",
                "snippet": "Invertix chiude un round pre-seed da 1,7 milioni di euro",
                "publisher": "Energiamercato",
                "provider": "fixture",
            }],
            "universal_page_fetch": lambda url: (html, url),
            "universal_prefilter_telemetry": {},
        },
    )
    adapter_result = asyncio.run(GenericWebResearchAdapter((_default_generic_provider,)).discover(funding_request))
    assert len(adapter_result.candidates) == 1, adapter_result.warnings
    assert adapter_result.candidates[0].canonical_company_name == "Invertix"
    assert not adapter_result.candidates[0].official_domain
    assert adapter_result.candidates[0].official_domain_verified is False


def test_open_world_funding_news_uses_page_date_when_body_has_no_date() -> None:
    published = date.today().isoformat()
    html = (
        f'<html><head><meta property="article:published_time" content="{published}T10:00:00Z"></head>'
        "<body><p>Sirius Game, la startup edutech chiude un round da 1,3 milioni di euro "
        "guidato da CDP Venture Capital.</p></body></html>"
    )
    funding_request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=365,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami startup che stanno raccogliendo fondi di investimento.",
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "semantic_query_contract": {"required_relationships": ["startup_raising_or_receiving_investment"]},
            "universal_search_queries": ("startup round investimento italia",),
            "universal_serp_search": lambda _query, _limit: [{
                "title": "Sirius Game, la startup edutech chiude un round da 1,3 milioni",
                "url": "https://finanza.repubblica.it/news/sirius-game-round",
                "snippet": "Sirius Game, la startup edutech chiude un round da 1,3 milioni di euro guidato da CDP.",
                "publisher": "La Repubblica",
                "provider": "fixture",
            }],
            "universal_page_fetch": lambda url: (html, url),
            "universal_prefilter_telemetry": {},
        },
    )
    result = asyncio.run(_default_generic_provider(funding_request, 0, 10))
    assert len(result.records) == 1
    record = result.records[0]
    assert record["company_name"] == "Sirius Game"
    assert record["published_at"] == published
    assert "round" in record["evidence_excerpt"].casefold()
    assert "Sirius Game" in record["source_text"]


def test_semantic_deferred_news_candidate_when_extractor_misses_signal() -> None:
    published = date.today().isoformat()
    html = (
        f'<html><head><meta property="article:published_time" content="{published}T10:00:00Z"></head>'
        "<body><p>Matchplat annuncia una operazione di crescita con partner industriali.</p></body></html>"
    )
    funding_request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=365,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami startup che stanno raccogliendo fondi di investimento.",
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "universal_search_queries": ("startup investimento italia",),
            "universal_serp_search": lambda _query, _limit: [{
                "title": "Matchplat, startup fintech annuncia operazione di crescita",
                "url": "https://news.test/matchplat",
                "snippet": "Matchplat annuncia una operazione di crescita con partner industriali.",
                "publisher": "News Test",
                "provider": "fixture",
            }],
            "universal_page_fetch": lambda url: (html, url),
            "universal_prefilter_telemetry": {},
        },
    )
    result = asyncio.run(_default_generic_provider(funding_request, 0, 10))
    assert len(result.records) == 1
    record = result.records[0]
    assert record["company_name"] == "Matchplat"
    assert record["extraction_method"] == "semantic_deferred_news_candidate"
    assert record["evidence_excerpt"] in record["source_text"]


def test_structured_identity_never_promotes_article_publisher() -> None:
    article = {
        "@context": "https://schema.org", "@type": "NewsArticle",
        "publisher": {"@type": "Organization", "name": "Economia Oggi", "url": "https://news.test"},
    }
    html = f'<script type="application/ld+json">{json.dumps(article)}</script>'
    assert _structured_subject_identities(html, page_host="news.test") == ()
