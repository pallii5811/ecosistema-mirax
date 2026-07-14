"""Deterministic regression tests for the scalable agentic discovery core."""
from __future__ import annotations

from unittest.mock import patch

from agents.agentic_gap_fill import (
    AGENTIC_MAX_SCRAPE_PAGES,
    build_agentic_completion_message,
    compute_agentic_page_budget,
    decode_agentic_checkpoint,
    encode_agentic_checkpoint,
    extracted_to_lead_stub,
    prepare_agentic_extracted_item,
    _satisfied_required_signals,
)
from agents.portal_blacklist import (
    is_blacklisted_domain,
    is_extraction_blocked_source,
)
from agents.search_serp import _extract_links_from_html
from agents.search_serp import _dedupe_urls, search_urls_http
from agents.data_extractor import _heuristic_extract_companies
from agents.web_researcher import (
    WebResearcher,
    _heuristic_search_queries,
    _queries_for_discovery_round,
    _required_source_lane_count,
    _source_plan_query_specs,
    _source_plan_queries,
)


def test_evidence_source_is_not_target_domain() -> None:
    assert is_blacklisted_domain("startupitalia.eu") is True
    assert is_extraction_blocked_source("https://startupitalia.eu/news/acme-round") is False
    assert is_blacklisted_domain("indeed.it") is True
    assert is_blacklisted_domain("jobeka.com") is True
    assert is_blacklisted_domain("fortune.com") is True
    assert is_blacklisted_domain("salesforce.com") is True
    assert is_blacklisted_domain("hubspot.com") is True
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


def test_search_provider_prefers_api_and_blocks_code_hosts() -> None:
    assert _dedupe_urls(
        [
            "https://azienda.example/jobs?utm_source=openai",
            "https://azienda.example/careers/](https://azienda.example/careers/",
            "https://github.com/acme/repo",
            "https://example.com/bando.pdf?utm_source=openai",
        ],
        10,
    ) == ["https://azienda.example/jobs", "https://azienda.example/careers/"]
    api_urls = [f"https://azienda.example/jobs-{i}" for i in range(5)]
    with patch(
        "agents.search_serp._search_openai_web",
        return_value=api_urls,
    ), patch("agents.search_serp._ddg_pages", side_effect=AssertionError("html fallback should not run")):
        assert search_urls_http("Business Developer Italia", 5) == api_urls


def test_extractor_has_evidence_first_fallback_for_rate_limits() -> None:
    plan = {
        "required_signals": ["hiring"],
        "commercial_hypothesis": {
            "hiring_roles": ["Business Development Representative", "Inside Sales"],
        },
    }
    portal_text = "ToolsGroup is seeking a motivated Business Development Representative to support outbound prospecting."
    extracted = _heuristic_extract_companies(plan, "https://it.jobeka.com/lavoro-bdr-lecco", portal_text)
    assert extracted
    assert extracted[0]["name"] == "ToolsGroup"
    assert extracted[0]["website"] == ""
    assert extracted[0]["matched_signals"] == ["hiring"]

    official = _heuristic_extract_companies(
        plan,
        "https://www.acme-sales.it/careers",
        "Lavora con noi: ricerchiamo Inside Sales per sviluppo nuovi clienti e prospecting.",
    )
    assert official
    assert official[0]["website"] == "https://www.acme-sales.it/"

    generic = _heuristic_extract_companies(
        plan,
        "https://www.generic-pmi.it/lavora-con-noi",
        "Lavora con noi: cerchiamo persone motivate e professionali.",
    )
    assert generic == []


def test_portal_evidence_must_match_company_name() -> None:
    mismatched = {
        "name": "Rhiag Group Italia",
        "website": "",
        "source_url": "https://it.jobeka.com/lavoro-professional-sales-representative-saronno",
        "evidence": "Errebian Spa ricerca 5 Sales Representative per la Lombardia.",
        "matched_signals": ["hiring"],
        "_required_signals": ["hiring"],
    }
    assert prepare_agentic_extracted_item(mismatched, location="Italia") is None


def test_quality_contract_rejects_non_target_and_keeps_verified_pmi() -> None:
    public_entity = {
        "name": "Comune di Milano",
        "website": "https://www.comune.milano.it",
        "source_url": "https://www.comune.milano.it/bando",
        "evidence": "Comune di Milano pubblica un nuovo bando.",
        "matched_signals": ["tender_won"],
        "_required_signals": ["tender_won"],
    }
    assert prepare_agentic_extracted_item(public_entity, location="Milano") is None

    generic_role = {
        "name": "Sales Development Representative",
        "website": "",
        "source_url": "https://it.jobeka.com/lavoro-sdr-milano",
        "evidence": "Acme Srl ricerca Sales Development Representative per prospecting outbound.",
        "matched_signals": ["hiring"],
        "_required_signals": ["hiring"],
    }
    assert prepare_agentic_extracted_item(generic_role, location="Milano") is None

    pmi = {
        "name": "Acme Sales Srl",
        "website": "https://acme-sales.it",
        "source_url": "https://acme-sales.it/lavora-con-noi",
        "evidence": "Acme Sales Srl ricerca un Business Development Representative per outbound e sviluppo nuovi clienti.",
        "matched_signals": ["hiring"],
        "_required_signals": ["hiring"],
    }
    with patch(
        "agents.domain_resolver.resolve_company_identity",
        return_value={"url": "https://acme-sales.it", "status": "verified", "confidence": 0.96},
    ):
        prepared = prepare_agentic_extracted_item(pmi, location="Milano")
    assert prepared is not None
    assert prepared["lead_quality_contract"]["score"] >= 80
    assert prepared["lead_quality_contract"]["satisfied_signals"] == ["hiring"]
    stub = extracted_to_lead_stub(prepared, category="PMI B2B", location="Milano")
    assert stub["lead_quality_contract"]["official_domain_present"] is True
    assert stub["lead_temperature"] in {"hot", "warm"}


def test_web_researcher_respects_total_url_budget() -> None:
    researcher = WebResearcher(
        {"original_query": "aziende che assumono commerciali", "_max_total_urls": 7},
        max_queries=12,
        max_urls_per_query=40,
    )
    assert researcher.max_total_urls == 7
    assert min(researcher.max_total_urls, researcher.max_queries * researcher.max_urls_per_query) == 7


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


def test_required_signal_lanes_are_coverage_first_under_small_query_cap(monkeypatch) -> None:
    import agents.web_researcher as web_researcher

    monkeypatch.setattr(web_researcher, "DISCOVERY_MAX_QUERIES", 2)
    plan = {
        "original_query": "PMI con personale operativo, appalti e ampliamenti produttivi",
        "sector": "company",
        "location": "Italia",
        "required_signals": ["hiring_operational", "contract_awarded", "production_expansion"],
        "source_plan": [
            {
                "lane": "job_market",
                "priority": 100,
                "source_types": ["company_careers"],
                "query_templates": ["careers operai {location}", "posizioni tecnici {location}"],
                "expected_evidence": ["hiring_operational"],
            },
            {
                "lane": "public_procurement",
                "priority": 90,
                "source_types": ["public_procurement_portal"],
                "query_templates": ["appalto aggiudicato PMI {location}"],
                "expected_evidence": ["contract_awarded"],
            },
            {
                "lane": "web_evidence",
                "priority": 80,
                "source_types": ["official_company_website"],
                "query_templates": ["nuovo stabilimento PMI {location}"],
                "expected_evidence": ["production_expansion"],
            },
        ],
    }
    specs = _source_plan_query_specs(plan)
    assert _required_source_lane_count(plan) == 3
    assert [spec["expected_signals"] for spec in specs[:3]] == [
        ["hiring_operational"],
        ["contract_awarded"],
        ["production_expansion"],
    ]
    queries = _heuristic_search_queries(plan)
    assert len(queries) >= 3
    assert "careers operai" in queries[0]
    assert "appalto aggiudicato" in queries[1]
    assert "nuovo stabilimento" in queries[2]


def test_accountant_source_plan_does_not_degrade_to_hiring_or_retail_careers() -> None:
    plan = {
        "original_query": "Sono un commercialista: trovami PMI italiane con nuova apertura o cambi societari",
        "sector": "company",
        "location": "Italia",
        "required_signals": ["registry_change", "company_formation", "geographic_expansion"],
        "source_plan": [
            {"lane": "public_registry", "priority": 100, "query_templates": []},
            {"lane": "web_evidence", "priority": 90, "query_templates": []},
            {"lane": "news", "priority": 80, "query_templates": []},
        ],
    }
    queries = _heuristic_search_queries(plan)
    assert queries
    assert "registroimprese" in queries[0]
    joined = "\n".join(queries).lower()
    assert "indeed" not in joined
    assert "infojobs" not in joined
    assert "lavora con noi" not in joined
    assert "careers" not in joined


def test_high_value_source_lanes_generate_goldmine_queries() -> None:
    plan = {
        "original_query": "PMI che spendono in pubblicita e cercano nuovi clienti",
        "sector": "PMI B2B",
        "location": "Italia",
        "required_signals": ["investing_marketing", "seeking_supplier", "market_entry"],
        "source_plan": [
            {
                "lane": "ads",
                "priority": 100,
                "query_templates": ["{sector} campagne attive {location}"],
            },
            {
                "lane": "partnerships",
                "priority": 90,
                "query_templates": ["{sector} nuova partnership {location}"],
            },
            {
                "lane": "events",
                "priority": 80,
                "query_templates": ["{sector} fiera nuovi clienti {location}"],
            },
            {
                "lane": "reviews",
                "priority": 70,
                "query_templates": ["{sector} recensioni problemi {location}"],
            },
        ],
    }
    source_queries = _source_plan_queries(plan)
    assert any("Meta Ad Library" in query or "Google Ads" in query for query in source_queries)
    assert any("nuova partnership" in query or "accordo commerciale" in query for query in source_queries)
    assert any("fiera" in query or "webinar" in query for query in source_queries)
    assert any("Trustpilot" in query or "recensioni" in query for query in source_queries)

    heuristic_queries = _heuristic_search_queries(plan)
    joined = "\n".join(heuristic_queries)
    assert "landing page" in joined or "campagne Meta" in joined
    assert "albo fornitori" in joined
    assert "nuovo mercato" in joined or "nuova partnership" in joined


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
    assert "site:.it" in queries[0]
    assert "lavora con noi" in queries[0]
    assert "developer" in queries[0]
    researcher = WebResearcher({**plan, "_discovery_round": 2, "_search_queries_override": queries})
    reused = __import__("asyncio").run(researcher.generate_search_queries())
    assert researcher.generated_base_queries
    assert reused != queries
    assert all("ultimo anno" in query or "comunicato stampa" in query for query in reused)


def test_generic_hr_hiring_never_defaults_to_developer_or_generic_seller_noise() -> None:
    plan = {
        "original_query": "Sono un consulente HR: trovami PMI con ruoli difficili aperti e assunzioni recenti",
        "sector": "company",
        "location": "Italia",
        "required_signals": ["hiring"],
        "source_plan": [{
            "lane": "job_market",
            "priority": 100,
            "query_templates": [
                'site:.it ("lavora con noi" OR careers OR "posizioni aperte") ("Srl" OR "PMI") {location}'
            ],
        }],
    }
    queries = _heuristic_search_queries(plan)
    assert queries
    assert "site:.it" in queries[0]
    joined = "\n".join(queries).lower()
    assert "sviluppatore" not in joined
    assert "startupitalia" not in joined
    assert "in crescita assume" not in joined


if __name__ == "__main__":
    test_evidence_source_is_not_target_domain()
    test_serp_keeps_multiple_evidence_pages_per_host()
    test_search_provider_prefers_api_and_blocks_code_hosts()
    test_extractor_has_evidence_first_fallback_for_rate_limits()
    test_portal_evidence_must_match_company_name()
    test_quality_contract_rejects_non_target_and_keeps_verified_pmi()
    test_web_researcher_respects_total_url_budget()
    test_rounds_are_distinct()
    test_page_budget_scales_with_requested_target()
    test_completion_language_is_honest()
    test_checkpoint_roundtrip_and_query_isolation()
    test_source_plan_drives_long_tail_queries()
    test_high_value_source_lanes_generate_goldmine_queries()
    test_query_match_score_uses_evidence_and_domain()
    test_signal_query_cannot_be_crowded_out_and_override_is_reused()
    print("test_agentic_discovery_v2: 15/15 OK")
