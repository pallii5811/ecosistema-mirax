from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.hiring import _validate_record, parse_hiring_page
from backend_mirror.source_adapters.hiring_ats_parsers import (
    bootstrap_legacy_retry_urls,
    build_workday_cxs_url,
    classify_failure_for_retry,
    detect_ats_vendor,
    parse_vacancy_html,
    parse_workday_json,
)
from backend_mirror.source_adapters.hiring_qualification import vacancy_geography_matches, vacancy_role_matches_sales
from backend_mirror.source_adapters.hiring_recruiter import enrich_record_with_recruiter_fields
from backend_mirror.source_adapters.hiring_url_queue import classify_url_prefetch

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _sales_request() -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia",),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=0.125,
        query="commerciali Lombardia",
        sectors=(),
        technical_filters={},
        cursor=None,
    )


def test_jsonld_vacancy_extracted():
    html = """
    <html><head>
      <script type="application/ld+json">
      {"@type":"JobPosting","title":"Commerciale","datePosted":"2026-07-10",
       "jobLocation":{"address":{"addressLocality":"Milano","addressRegion":"Lombardia"}},
       "hiringOrganization":{"name":"Acme Srl","url":"https://acme.it"},
       "description":"Acme cerca commerciale. Candidati."}
      </script>
    </head><body></body></html>
    """
    records = parse_hiring_page(html, "https://acme.it/jobs/commerciale-milano")
    assert records
    assert records[0]["company_name"] == "Acme Srl"
    assert records[0]["employer_official_domain"] == "acme.it"


def test_workday_cxs_parser_extracts_employer_role_location():
    payload = json.loads((FIXTURES / "hiring_workday_cxs_sample.json").read_text(encoding="utf-8"))
    url = "https://airliquidehr.wd3.myworkdayjobs.com/en-us/airliquideexternalcareer/job/italy-moncalieri/commerciale---lombardia-nord_r10094218"
    records = parse_workday_json(payload, url)
    assert len(records) == 1
    record = records[0]
    assert "Commerciale" in record["vacancy_title"]
    assert record["company_name"] == "Air Liquide"
    assert "Moncalieri" in record["location"] or "Lombardia" in record["location"]
    assert record["employer_official_domain"] == "airliquide.com"


def test_workday_cxs_url_builder():
    url = "https://airliquidehr.wd3.myworkdayjobs.com/en-us/airliquideexternalcareer/job/italy-moncalieri/commerciale---lombardia-nord_r10094218/apply"
    api = build_workday_cxs_url(url)
    assert api == (
        "https://airliquidehr.wd3.myworkdayjobs.com/wday/cxs/airliquidehr/"
        "airliquideexternalcareer/job/italy-moncalieri/commerciale---lombardia-nord_r10094218"
    )


def test_workday_cxs_url_uses_outage_tenant_from_html():
    url = "https://airliquidehr.wd3.myworkdayjobs.com/en-us/airliquideexternalcareer/job/commerciale---lombardia-nord_r10094218"
    html = '<script src="/wday/drs/outage?t=airliquidehr&s=airliquideexternalcareer"></script>'
    api = build_workday_cxs_url(url, html)
    assert "/wday/cxs/airliquidehr/airliquideexternalcareer/job/" in api


def test_workday_cxs_parser_keeps_sales_lombardia_and_corporate_domain():
    payload = {
        "jobPostingInfo": {
            "title": "Commerciale Junior B2B - Lombardia",
            "location": "Milano",
            "additionalLocations": ["Bergamo"],
            "startDate": "2026-06-30",
            "postedOn": "Posted Today",
            "jobDescription": "Solenis cerca un commerciale junior B2B in Lombardia. Candidati.",
            "externalUrl": "https://solenis.wd1.myworkdayjobs.com/en-us/solenis/job/commerciale-junior-b2b--lombardia-_r0028690",
            "jobReqId": "R0028690",
            "canApply": True,
            "hiringOrganization": {"name": "Solenis", "url": ""},
        }
    }
    url = "https://solenis.wd1.myworkdayjobs.com/en-us/solenis/job/commerciale-junior-b2b--lombardia-_r0028690/apply/applymanually"
    records = parse_workday_json(payload, url)
    assert len(records) == 1
    record = records[0]
    assert record["published_at"].startswith("2026-06-30")
    assert "Commerciale" in record["vacancy_title"]
    assert "Milano" in record["location"] and "Bergamo" in record["location"]
    assert record["employer_official_domain"] == "solenis.com"
    assert "myworkdayjobs.com" not in record["employer_official_domain"]
    assert record["requisition_id"] == "R0028690"
    request = _sales_request()
    valid, rejection = _validate_record(enrich_record_with_recruiter_fields(record), request, date(2026, 7, 15))
    assert valid is True, rejection
    assert vacancy_geography_matches(
        location=record["location"],
        title=record["vacancy_title"],
        geographies=("Lombardia",),
    ) is True
    assert vacancy_role_matches_sales(title=record["vacancy_title"], description=record["description"])[0] is True


def test_workday_cxs_tenant_name_fallback_without_hiring_organization():
    payload = {
        "jobPostingInfo": {
            "title": "Agente in attivita finanziaria - Lombardia",
            "location": "MILAN",
            "startDate": "2026-03-16",
            "canApply": True,
            "jobReqId": "REQ-10083295",
            "jobDescription": "ING cerca agente finanziario in Lombardia.",
        }
    }
    url = "https://ing.wd3.myworkdayjobs.com/it-it/icsgblcor/job/agente-in-attivit-finanziaria---percorso-beginner_req-10083295"
    records = parse_workday_json(payload, url)
    assert len(records) == 1
    assert records[0]["company_name"] == "ING"
    assert records[0]["employer_official_domain"] == "ing.it"
    assert records[0]["published_at"].startswith("2026-03-16")


def test_workday_cxs_failure_codes_are_precise():
    from backend_mirror.source_adapters.hiring import _workday_parse_failure_code
    assert _workday_parse_failure_code({"cxs_failure_code": "WORKDAY_CXS_HTTP_404"}, "JAVASCRIPT_SHELL") == "WORKDAY_CXS_HTTP_404"
    assert _workday_parse_failure_code({"cxs_failure_code": "WORKDAY_CXS_NOT_JSON"}, "PARSE_FAILED") == "WORKDAY_CXS_NOT_JSON"
    assert _workday_parse_failure_code({}, "JAVASCRIPT_SHELL") == "JAVASCRIPT_SHELL"


def test_javascript_shell_not_treated_as_success_without_records():
    html = "<html><body><div class=\"wd-ApplicationShell\">loading</div></body></html>"
    result = parse_vacancy_html(html, "https://airliquidehr.wd3.myworkdayjobs.com/job/x/y")
    assert not result.records
    assert result.failure_code == "JAVASCRIPT_SHELL"


def test_listing_page_rejected():
    item = classify_url_prefetch("https://www.indeed.com/jobs?q=commerciale&l=Lombardia")
    assert item["prefetch_accept"] is False
    assert item["rejection_code"] in {"LISTING_PAGE", "NOT_INDIVIDUAL_VACANCY"}


def test_synergie_anonymous_recruiter_rejected():
    item = classify_url_prefetch("https://www.synergie-italia.it/annunci-lombardia/vendita-offerte-lavoro")
    assert item["prefetch_accept"] is False
    assert item["rejection_code"] == "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"


def test_employer_and_ats_domains_remain_separate():
    payload = json.loads((FIXTURES / "hiring_workday_cxs_sample.json").read_text(encoding="utf-8"))
    url = "https://airliquidehr.wd3.myworkdayjobs.com/en-us/airliquideexternalcareer/job/x/y"
    record = parse_workday_json(payload, url)[0]
    assert "myworkdayjobs.com" in record["vacancy_source_domain"]
    assert record["employer_official_domain"] == "airliquide.com"


def test_lombard_city_without_region_passes_validation():
    payload = json.loads((FIXTURES / "hiring_workday_cxs_sample.json").read_text(encoding="utf-8"))
    record = parse_workday_json(payload, "https://airliquidehr.wd3.myworkdayjobs.com/job/x/y")[0]
    record["location"] = "Milano, Italia"
    record["published_at"] = "2026-07-10"
    record["active"] = True
    record["active_evidence"] = "workday_can_apply_true"
    record["active_verification_method"] = "workday_cxs_can_apply"
    record["evidence"] = "Commerciale sales business developer"
    enriched = enrich_record_with_recruiter_fields(record)
    ok, rejection = _validate_record(enriched, _sales_request(), date(2026, 7, 15))
    assert ok, rejection


def test_non_sales_role_rejected():
    record = {
        "company_name": "Acme Srl",
        "vacancy_title": "Magazziniere",
        "location": "Milano, Lombardia",
        "published_at": "2026-07-10",
        "active": True,
        "active_evidence": "live_jobposting_page",
        "active_verification_method": "http_200_jsonld_jobposting",
        "source_url": "https://acme.it/jobs/magazziniere",
        "source_class": "company_careers",
        "employer_is_direct": True,
        "official_domain_verified": True,
        "employer_official_domain": "acme.it",
        "entity_class": "operating_company",
        "evidence": "Acme cerca magazziniere.",
    }
    ok, rejection = _validate_record(record, _sales_request(), date(2026, 7, 15))
    assert ok is False
    assert rejection in {"HIRING_ROLE_MISMATCH", "ROLE_MISMATCH", "OPERATIONAL_ROLE_UNPROVEN"}


def test_stale_vacancy_rejected():
    record = {
        "company_name": "Acme Srl",
        "vacancy_title": "Commerciale",
        "location": "Milano, Lombardia",
        "published_at": "2024-01-01",
        "active": True,
        "source_url": "https://acme.it/jobs/commerciale",
        "source_class": "company_careers",
        "employer_is_direct": True,
        "official_domain_verified": True,
        "employer_official_domain": "acme.it",
        "entity_class": "operating_company",
        "evidence": "Commerciale sales",
    }
    ok, rejection = _validate_record(record, _sales_request(), date(2026, 7, 15))
    assert ok is False
    assert rejection in {"VACANCY_STALE", "STALE_VACANCY"}


def test_retryable_failures_requeue_hard_rejects_do_not():
    assert classify_failure_for_retry("JAVASCRIPT_SHELL")
    assert classify_failure_for_retry("JSONLD_JOBPOSTING_MISSING")
    assert not classify_failure_for_retry("LISTING_PAGE")
    assert not classify_failure_for_retry("RECRUITER_FINAL_EMPLOYER_UNRESOLVED")


def test_legacy_bootstrap_requeues_workday_urls_only():
    urls = [
        "https://airliquidehr.wd3.myworkdayjobs.com/en-us/x/job/a/b",
        "https://www.indeed.com/jobs?q=commerciale&l=Lombardia",
    ]
    retry = bootstrap_legacy_retry_urls(urls, url_offset=2, parser_epoch=1, url_outcomes={})
    assert len(retry) == 1
    assert detect_ats_vendor(retry[0]) == "workday"


def test_detect_ats_vendor_workday():
    assert detect_ats_vendor("https://airliquidehr.wd3.myworkdayjobs.com/job/x") == "workday"
