"""Deterministic regression tests for the scalable agentic discovery core."""
from __future__ import annotations

from agents.agentic_gap_fill import (
    AGENTIC_MAX_SCRAPE_PAGES,
    build_agentic_completion_message,
    compute_agentic_page_budget,
    decode_agentic_checkpoint,
    encode_agentic_checkpoint,
    extracted_to_lead_stub,
    _satisfied_required_signals,
)
from agents.portal_blacklist import (
    is_blacklisted_domain,
    is_extraction_blocked_source,
)
from agents.search_serp import _extract_links_from_html
from agents.web_researcher import (
    WebResearcher,
    _heuristic_search_queries,
    _queries_for_discovery_round,
    _source_plan_queries,
)


def test_evidence_source_is_not_target_domain() -> None:
    assert is_blacklisted_domain("startupitalia.eu") is True
    assert is_extraction_blocked_source("https://startupitalia.eu/news/acme-round") is False
    assert is_blacklisted_domain("indeed.it") is True
    assert is_extraction_blocked_source("https://indeed.it/jobs?q=python") is False
    assert is_extraction_blocked_source("https://github.com/acme/repo") is True


def test_serp_keeps_multiple_evidence_pages_per_host() -> None:
    links = "".join(
        f'<a href="https://news.example.it/article-{i}">Article {i}</a>'
        for i in range(1, 7)
    )
    seen: set[str] = set()
    counts: dict[str, int] = {}
    found = _extract_links_from_html(links, "https://search.example", seen, counts)
    assert len(found) == 4
    assert len(set(found)) == 4


def test_rounds_are_distinct() -> None:
    raw = ["aziende software Italia assunzioni", "startup funding Italia"]
    first = _queries_for_discovery_round(raw, {"_discovery_round": 1}, max_queries=5)
    second = _queries_for_discovery_round(raw, {"_discovery_round": 2}, max_queries=5)
    third = _queries_for_discovery_round(raw, {"_discovery_round": 3}, max_queries=5)
    assert first != second != third
    assert all("-site:github.com" in query for query in first + second + third)


def test_page_budget_scales_with_requested_target() -> None:
    small = compute_agentic_page_budget(10)
    large = compute_agentic_page_budget(1_000)
    if AGENTIC_MAX_SCRAPE_PAGES <= 0:
        assert small >= 50
        assert large >= 5_000
        assert large > small
    else:
        assert small == large == AGENTIC_MAX_SCRAPE_PAGES


def test_completion_language_is_honest() -> None:
    partial = build_agentic_completion_message(42, 1_000, "page_budget")
    exhausted = build_agentic_completion_message(42, 1_000, "sources_exhausted")
    timeout = build_agentic_completion_message(42, 1_000, "time_budget")
    assert "parziale" in partial.lower()
    assert "esaurite" in partial.lower()
    assert "Ricerca esaurita" in exhausted
    assert "ripreso" in timeout


def test_checkpoint_roundtrip_and_query_isolation() -> None:
    plan = {
        "original_query": "aziende che assumono commerciali",
        "sector": "aziende",
        "location": "Italia",
        "required_signals": ["hiring"],
    }
    checkpoint = encode_agentic_checkpoint(
        plan,
        round_idx=7,
        pages_scraped=321,
        seen_urls={"https://a.example/1", "https://b.example/2"},
        stop_reason="page_budget",
    )
    assert "https://" not in checkpoint["seen_urls_zlib"]
    restored = decode_agentic_checkpoint(plan, checkpoint)
    assert restored["round_idx"] == 7
    assert restored["pages_scraped"] == 321
    assert restored["seen_urls"] == {"https://a.example/1", "https://b.example/2"}

    changed = {**plan, "original_query": "startup che cercano investimenti"}
    reset = decode_agentic_checkpoint(changed, checkpoint)
    assert reset == {"round_idx": 0, "pages_scraped": 0, "seen_urls": set()}


def test_source_plan_drives_long_tail_queries() -> None:
    plan = {
        "original_query": "case di cura che devono pubblicare la polizza professionale",
        "sector": "case di cura",
        "location": "Italia",
        "source_plan": [
            {
                "lane": "regulatory",
                "priority": 100,
                "query_templates": ["{query} {location}"],
                "expected_evidence": ["obbligo", "polizza"],
            },
            {
                "lane": "public_registry",
                "priority": 80,
                "query_templates": ["{sector} autorizzazione"],
                "expected_evidence": ["denominazione"],
            },
        ],
    }
    queries = _source_plan_queries(plan)
    assert len(queries) == 2
    assert "gazzettaufficiale" in queries[0]
    assert "registroimprese" in queries[1]


def test_query_match_score_uses_evidence_and_domain() -> None:
    extracted = {
        "name": "Acme Srl",
        "website": "https://acme.it/",
        "evidence": "Acme Srl sta assumendo due commerciali.",
        "source_url": "https://jobs.example/acme",
        "matched_signals": ["hiring"],
        "_required_signals": ["hiring"],
        "domain_verification": {"status": "verified", "confidence": 0.95},
    }
    stub = extracted_to_lead_stub(extracted, category="aziende", location="Italia")
    assert stub["query_match_status"] == "verified"
    assert stub["query_match_score"] >= 90
    assert stub["agentic_evidence_records"][0]["source_url"] == "https://jobs.example/acme"
    assert _satisfied_required_signals(
        {"investing_marketing"},
        {"meta_ads_started"},
    ) == {"investing_marketing"}

    probable = extracted_to_lead_stub(
        {**extracted, "domain_verification": {"status": "probable", "confidence": 0.6}},
        category="aziende",
        location="Italia",
    )
    assert probable["query_match_status"] == "probable"


def test_signal_query_cannot_be_crowded_out_and_override_is_reused() -> None:
    plan = {
        "original_query": "aziende che assumono sviluppatori a Roma",
        "sector": "software",
        "location": "Roma",
        "required_signals": ["hiring"],
        "source_plan": [
            {
                "lane": lane,
                "priority": 100 - index,
                "query_templates": ["{query}"],
            }
            for index, lane in enumerate(
                ["news", "company_web", "technology", "real_estate", "regulatory", "web_evidence"]
            )
        ],
    }
    queries = _heuristic_search_queries(plan)
    assert "indeed.it" in queries[0]
    researcher = WebResearcher({**plan, "_discovery_round": 2, "_search_queries_override": queries})
    reused = __import__("asyncio").run(researcher.generate_search_queries())
    assert researcher.generated_base_queries
    assert reused != queries
    assert all("ultimo anno" in query or "comunicato stampa" in query for query in reused)


if __name__ == "__main__":
    test_evidence_source_is_not_target_domain()
    test_serp_keeps_multiple_evidence_pages_per_host()
    test_rounds_are_distinct()
    test_page_budget_scales_with_requested_target()
    test_completion_language_is_honest()
    test_checkpoint_roundtrip_and_query_isolation()
    test_source_plan_drives_long_tail_queries()
    test_query_match_score_uses_evidence_and_domain()
    test_signal_query_cannot_be_crowded_out_and_override_is_reused()
    print("test_agentic_discovery_v2: 9/9 OK")
