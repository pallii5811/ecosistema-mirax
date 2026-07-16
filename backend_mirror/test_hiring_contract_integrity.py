from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import Any, Dict, List
from unittest.mock import AsyncMock

import pytest

from backend_mirror.commercial_lifecycle import evaluate_publication_gate, plan_requires_explicit_size_constraint
from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest, EvidenceRecord, OpportunityCandidate
from backend_mirror.source_adapters.hiring import (
    HiringAdapter,
    _default_hiring_provider,
    _fetch_ats_structured_json,
    _validate_record,
)
from backend_mirror.source_adapters.hiring_ats_parsers import parse_workday_json
from backend_mirror.source_adapters.hiring_budget import DISCOVERY_CAP_EUR, HiringDiscoveryState
from backend_mirror.source_adapters.hiring_qualification import (
    QUALIFICATION_VALIDATOR_EPOCH,
    apply_first_party_ats_metadata,
    outcome_to_record,
    requires_sme_size_gate,
    resolve_employer_identity,
    size_constraint_policy,
)
from backend_mirror.source_adapters.shadow_runtime import candidate_to_lifecycle_shadow_payload


def _marketing_request(**overrides: Any) -> AdapterDiscoveryRequest:
    base = {
        "intent": "hiring",
        "signal_ids": ("hiring_marketing",),
        "signal_match_mode": "any",
        "geographies": ("Italia",),
        "freshness_max_age_days": 60,
        "requested_count": 5,
        "budget_eur": 0.125,
        "query": "Trova marketing manager in Italia",
        "technical_filters": {
            "parent_query": "Trova marketing manager in Italia",
            "company_sizes": ("micro", "small", "medium"),
            "required_attributes": ("marketing",),
            "local_business_preference": True,
        },
    }
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def _workday_bd_record(*, active: Any = True) -> dict[str, Any]:
    url = (
        "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/"
        "ita-milano---via-enrico-cialdini/marketing-manager-women-s-health---europe_r-537742-1"
    )
    payload = {
        "jobPostingInfo": {
            "title": "Marketing Manager Women's Health - Europe",
            "location": "ITA Milano - Via Enrico Cialdini, Italia",
            "startDate": (date.today() - timedelta(days=5)).isoformat(),
            "canApply": active if active is not False else False,
            "jobDescription": "Lead marketing for Women's Health Europe.",
            "hiringOrganization": {"name": "2600 Becton Dickinson, S.A. (BD SA Spain)", "url": ""},
            "externalUrl": url,
        }
    }
    row = parse_workday_json(payload, url)[0]
    if active is None:
        row.pop("active", None)
    return resolve_employer_identity(row)


def test_workday_first_party_uses_canonical_source_class_and_subtype() -> None:
    record = _workday_bd_record(active=True)
    assert record["source_class"] == "company_careers"
    assert record["source_subtype"] == "first_party_ats"
    assert record["ats_vendor"] == "workday"
    assert record["employer_official_domain"] == "bd.com"
    assert "myworkdayjobs.com" not in record["employer_official_domain"]


def test_workday_e2e_candidate_shadow_evidence_lifecycle() -> None:
    record = _workday_bd_record(active=True)
    ok, code = _validate_record(record, _marketing_request(), date.today())
    assert ok is True, code
    assert code != "SECONDARY_SOURCE_NOT_CORROBORATED"
    assert code != "HIRING_SOURCE_CLASS_INVALID"

    published = record["published_at"]
    evidence = EvidenceRecord(
        signal_id="hiring_marketing",
        source_url=record["source_url"],
        source_publisher=record["vacancy_source_domain"],
        source_class=record["source_class"],
        excerpt=record["evidence"],
        observed_at=published,
        published_at=published,
        extraction_method=record["extraction_method"],
        confidence=0.96,
        provenance={
            "vacancy_title": record["vacancy_title"],
            "active": record.get("active"),
            "source_subtype": record.get("source_subtype"),
            "ats_vendor": record.get("ats_vendor"),
            "employer_official_domain": record["employer_official_domain"],
            "vacancy_source_domain": record["vacancy_source_domain"],
        },
    )
    candidate = OpportunityCandidate(
        canonical_company_name=record["company_name"],
        company_identifiers={},
        official_domain=record["employer_official_domain"],
        official_domain_verified=True,
        official_domain_confidence=0.96,
        entity_class="operating_company",
        geographies=(record["location"],),
        buyer_fit=1.0,
        signal_id="hiring_marketing",
        signal_date=published,
        evidence=(evidence,),
        why_now="Vacancy attiva",
        contacts=(),
        confidence=0.96,
        contradiction_flags=(),
        provenance={
            "domain_verification": {
                "status": "verified",
                "confidence": 0.96,
                "score": 96,
                "evidence": record.get("domain_verification_evidence") or ("workday_tenant_corporate_map",),
                "resolution_source": "source_adapter",
                "resolution_method": "verified_source_adapter",
                "adapter_id": "structured_hiring_v1",
                "url": f"https://{record['employer_official_domain']}/",
            },
            "vacancy_url": record["source_url"],
            "vacancy_source_domain": record["vacancy_source_domain"],
            "employer_official_domain": record["employer_official_domain"],
            "source_subtype": record.get("source_subtype"),
            "ats_vendor": record.get("ats_vendor"),
        },
        adapter_id="structured_hiring_v1",
        adapter_version="1.0.0",
    )
    lead = candidate_to_lifecycle_shadow_payload(candidate, opportunity_value_score=0.9)
    assert lead["business_signals"][0]["source_class"] == "company_careers"
    plan = {
        "raw_query": "Trova marketing manager in Italia",
        "target": {
            "company_sizes": ["micro", "small", "medium"],
            "local_business_preference": True,
        },
        "signal_policy": {"required_signals": ["hiring_marketing"]},
    }
    gate = evaluate_publication_gate(lead, plan, cost_within_budget=True)
    assert "unknown_source" not in gate.get("rejection_codes", [])
    assert "SECONDARY_SOURCE" not in str(gate.get("rejection_codes", []))


@pytest.mark.parametrize(
    ("can_apply", "expected_ok", "expected_code"),
    [
        (True, True, ""),
        (False, False, "VACANCY_NOT_CONFIRMED_ACTIVE"),
        (None, False, "VACANCY_ACTIVE_STATUS_UNVERIFIED"),
    ],
)
def test_active_status_tristate(can_apply, expected_ok, expected_code) -> None:
    record = _workday_bd_record(active=can_apply if can_apply is not None else None)
    if can_apply is None:
        assert "active" not in record or record.get("active") is None
    ok, code = _validate_record(record, _marketing_request(), date.today())
    assert ok is expected_ok
    if expected_code:
        assert code == expected_code


def test_resolver_does_not_coerce_active_none_to_true() -> None:
    prior = {"source_url": "https://bdx.wd1.myworkdayjobs.com/job/x", "company_name": "BD", "active": None}
    resolved = resolve_employer_identity(prior)
    assert resolved.get("active") is None


def test_marketing_query_without_explicit_size_passes_size_gate() -> None:
    req = _marketing_request()
    policy = size_constraint_policy(req)
    assert policy["company_size_policy_active"] is False
    assert not requires_sme_size_gate(req)
    record = _workday_bd_record(active=True)
    record.pop("company_size", None)
    record.pop("employee_count", None)
    ok, code = _validate_record(record, req, date.today())
    assert code != "SME_STATUS_UNVERIFIED"
    assert ok is True


def test_explicit_pmi_ui_filter_rejects_unknown_size() -> None:
    req = _marketing_request(
        technical_filters={
            "parent_query": "Trova marketing manager in Italia",
            "size_constraint_provenance": "user_explicit",
            "company_sizes": ("micro", "small", "medium"),
        },
    )
    assert requires_sme_size_gate(req)
    record = _workday_bd_record(active=True)
    ok, code = _validate_record(record, req, date.today())
    assert ok is False
    assert code == "SME_STATUS_UNVERIFIED"


def test_social_media_in_query_does_not_activate_size_gate() -> None:
    req = _marketing_request(query="Trova social media marketing manager in Italia")
    assert not requires_sme_size_gate(req)


def test_bd_revalidation_from_persisted_outcome_without_refetch() -> None:
    outcome = {
        "url": "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/ita-milano/mm_r-1",
        "vacancy_title": "Marketing Manager Women's Health - Europe",
        "employer": "2600 Becton Dickinson, S.A. (BD SA Spain)",
        "location": "ITA Milano - Via Enrico Cialdini, Italia",
        "publication_date": (date.today() - timedelta(days=3)).isoformat(),
        "source_domain": "bdx.wd1.myworkdayjobs.com",
        "tenant": "bdx",
        "parser_result": "success",
        "active": True,
        "active_evidence": "workday_can_apply_true",
        "active_verification_method": "workday_cxs_can_apply",
        "official_domain_verified": True,
    }
    record = resolve_employer_identity(outcome_to_record(outcome))
    ok, code = _validate_record(record, _marketing_request(), date.today())
    assert record["employer_official_domain"] == "bd.com"
    assert record["source_class"] == "company_careers"
    assert record.get("source_subtype") == "first_party_ats"
    assert ok is True, code


def test_provider_real_batch_twenty_five_pending(monkeypatch) -> None:
    search_calls: list[str] = []

    def fake_search(query, _limit, *, cost_scope):
        search_calls.append(query)
        return []

    urls = [f"https://careers-batch-{index}.example.test/jobs/role-{index}" for index in range(25)]
    meta = {url: ("marketing q", "serp:careers") for url in urls}
    state = HiringDiscoveryState(
        discovery_spent_eur=DISCOVERY_CAP_EUR,
        seen_urls=tuple(urls),
        url_meta=tuple({"url": url, "query": meta[url][0], "query_source": meta[url][1]} for url in urls),
        url_offset=0,
        discovery_url_offset=0,
        qualification_validator_epoch=QUALIFICATION_VALIDATOR_EPOCH,
    )

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/html"}

        def __init__(self, url: str):
            self.url = url

        @property
        def text(self) -> str:
            return "<html><body><h1>Marketing Manager</h1><p>Milano Italia</p></body></html>"

    fetch_order: list[str] = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url):
            fetch_order.append(url)
            if "slow.example.test" in url:
                await asyncio.sleep(0.15)
            return FakeResponse(url)

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", fake_search)
    monkeypatch.setattr("httpx.AsyncClient", FakeClient)

    start_offset = state.url_offset
    result = asyncio.run(_default_hiring_provider(_marketing_request(), state, 20))
    end_offset = result.discovery_state.url_offset if result.discovery_state else state.url_offset
    outcomes = len(result.discovery_state.url_outcomes) if result.discovery_state else 0

    assert search_calls == []
    assert result.urls_processed >= 20
    assert 0 <= end_offset - start_offset <= outcomes
    assert outcomes >= 20
    assert result.discovery_state is not None
    assert len(result.discovery_state.pending_urls) == 5


def test_provider_slow_url_does_not_block_batch(monkeypatch) -> None:
    urls = [
        "https://slow.example.test/jobs/1",
        *[f"https://fast-{index}.example.test/jobs/{index}" for index in range(2, 22)],
    ]
    state = HiringDiscoveryState(
        discovery_spent_eur=DISCOVERY_CAP_EUR,
        seen_urls=tuple(urls),
        url_meta=tuple({"url": url, "query": "q", "query_source": "serp:careers"} for url in urls),
        qualification_validator_epoch=QUALIFICATION_VALIDATOR_EPOCH,
    )

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/html"}

        def __init__(self, url: str):
            self.url = url

        @property
        def text(self) -> str:
            return "<html><body>Marketing Manager Milano</body></html>"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url):
            if "slow.example.test" in url:
                await asyncio.sleep(0.12)
            return FakeResponse(url)

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", lambda *a, **k: [])
    monkeypatch.setattr("httpx.AsyncClient", FakeClient)

    result = asyncio.run(_default_hiring_provider(_marketing_request(), state, 20))
    assert result.urls_processed >= 20


def test_cxs_dedup_terminal_failure_single_attempt() -> None:
    url = "https://bakerhughes.wd5.myworkdayjobs.com/it-it/bakerhughes/job/test_r1"
    prior = {
        "ats_vendor": "workday",
        "cxs_failure_code": "WORKDAY_CXS_HTTP_403",
        "cxs_attempts": [{"cxs_url": "https://example/cxs", "http_status": 403}],
    }

    class FakeClient:
        async def get(self, *_args, **_kwargs):
            raise AssertionError("second CXS call must not happen")

    payload, forensic = asyncio.run(
        _fetch_ats_structured_json(FakeClient(), url, "<html></html>", prior_forensic=prior)
    )
    assert payload is None
    assert forensic["cxs_attempt_count"] == 1


def test_cxs_retry_only_after_unresolved_html_metadata(monkeypatch) -> None:
    url = "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/ita-milano/mm_r-1"
    api = "https://bdx.wd1.myworkdayjobs.com/wday/cxs/bdx/external/job/mm"
    calls: list[str] = []

    def fake_build(workday_url: str, html: str) -> str | None:
        return api if html.strip() else None

    monkeypatch.setattr("backend_mirror.source_adapters.hiring.build_workday_cxs_url", fake_build)

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "application/json"}
        content = b"{}"
        url = api

        def json(self):
            return {"jobPostingInfo": {"title": "Marketing Manager", "startDate": "2026-07-01", "canApply": True}}

    class FakeClient:
        async def get(self, api_url, **_kwargs):
            calls.append(api_url)
            return FakeResponse()

    payload, forensic = asyncio.run(_fetch_ats_structured_json(FakeClient(), url, ""))
    assert payload is None
    assert forensic.get("cxs_failure_code") == "WORKDAY_CXS_URL_UNRESOLVED"
    assert calls == []

    payload, forensic = asyncio.run(_fetch_ats_structured_json(FakeClient(), url, '<script>"tenant":"bdx"</script>'))
    assert payload is not None
    assert len(calls) == 1

    payload2, forensic2 = asyncio.run(
        _fetch_ats_structured_json(
            FakeClient(), url, '<script>"tenant":"bdx"</script>',
            prior_forensic={**forensic, "cxs_failure_code": "WORKDAY_CXS_HTTP_403"},
        )
    )
    assert payload2 is None
    assert len(calls) == 1


def test_domain_batch_deferred_is_retryable_not_fetch_timeout() -> None:
    from backend_mirror.source_adapters.hiring_ats_parsers import classify_failure_for_retry

    assert classify_failure_for_retry("DOMAIN_BATCH_DEFERRED")
    assert not classify_failure_for_retry("LISTING_PAGE")


def test_qualification_epoch_bumped_for_revalidation() -> None:
    assert QUALIFICATION_VALIDATOR_EPOCH >= 4


def test_plan_requires_explicit_size_ignores_compiler_sizes_only() -> None:
    plan = {
        "raw_query": "Trova marketing manager in Italia",
        "target": {"company_sizes": ["micro", "small", "medium"], "local_business_preference": True},
    }
    assert plan_requires_explicit_size_constraint(plan) is False
