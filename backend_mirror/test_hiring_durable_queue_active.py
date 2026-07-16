from __future__ import annotations

from datetime import date, timedelta

from backend_mirror.source_adapters.hiring_ats_parsers import (
    parse_greenhouse_json,
    parse_teamtailor_json,
    parse_vacancy_html,
    parse_workday_json,
)
from backend_mirror.source_adapters.hiring_budget import (
    HiringDiscoveryState,
    canonical_url_key,
    reconcile_hiring_url_queue,
)
from backend_mirror.source_adapters.hiring_url_queue import build_processing_batch


def _urls(count: int) -> tuple[str, ...]:
    return tuple(f"https://boards.greenhouse.io/acme/jobs/{100000 + index}" for index in range(count))


def _outcome(url: str, *, state: str, code: str, parser_result: str = "empty") -> dict:
    return {
        "url": url,
        "canonical_url": canonical_url_key(url),
        "url_state": state,
        "rejection_code": code,
        "parser_result": parser_result,
    }


def test_queue_recovery_ignores_legacy_offset_and_recovers_all_155_urls():
    urls = _urls(155)
    outcomes = [
        _outcome(url, state="rejected_final", code="ROLE_MISMATCH") for url in urls[:35]
    ] + [
        _outcome(url, state="retryable_parser_failure", code="FETCH_TIMEOUT") for url in urls[35:55]
    ]
    state = HiringDiscoveryState(
        seen_urls=urls,
        url_offset=155,
        discovery_url_offset=155,
        url_outcomes=tuple(outcomes),
        retry_urls=urls[35:55],
    )
    summary = reconcile_hiring_url_queue(state)
    assert summary == {
        "seen_urls": 155,
        "unique_seen_urls": 155,
        "unique_outcome_urls": 55,
        "terminal_urls": 35,
        "retryable_urls": 20,
        "recovered_unprocessed_urls": 100,
        "duplicates": 0,
        "reconciliation_total": 155,
    }
    assert len(state.pending_urls) == 100
    assert state.discovery_url_offset == 35


def test_priority_sort_resume_processes_20_then_exact_remaining_5_without_skip():
    urls = tuple(reversed(_urls(25)))
    state = HiringDiscoveryState(seen_urls=urls, url_offset=25, discovery_url_offset=25)
    meta = {url: ("marketing Lombardia", "serp:ats") for url in urls}
    first_summary = reconcile_hiring_url_queue(state)
    assert first_summary["recovered_unprocessed_urls"] == 25
    first = build_processing_batch(
        list(urls), meta, pending_urls=state.pending_urls,
        processed_terminal_urls=state.processed_terminal_urls, batch_cap=20,
    )
    assert len(first) == 20
    state.url_outcomes = tuple(
        _outcome(item["url"], state="rejected_final", code="ROLE_MISMATCH") for item in first
    )
    reconcile_hiring_url_queue(state)
    second = build_processing_batch(
        list(urls), meta, pending_urls=state.pending_urls,
        processed_terminal_urls=state.processed_terminal_urls, batch_cap=20,
    )
    assert len(second) == 5
    assert {item["canonical_url"] for item in first}.isdisjoint(
        {item["canonical_url"] for item in second}
    )
    state.url_outcomes = tuple([
        *state.url_outcomes,
        *(_outcome(item["url"], state="rejected_final", code="ROLE_MISMATCH") for item in second),
    ])
    summary = reconcile_hiring_url_queue(state)
    assert summary["terminal_urls"] == 25
    assert summary["recovered_unprocessed_urls"] == 0
    assert summary["unique_outcome_urls"] == 25


def test_domain_deferred_remains_pending_until_terminal_outcome():
    url = _urls(1)[0]
    state = HiringDiscoveryState(
        seen_urls=(url,),
        url_outcomes=(_outcome(url, state="pending_deferred", code="DOMAIN_BATCH_DEFERRED"),),
        retryable_urls=(),
    )
    first = reconcile_hiring_url_queue(state)
    assert first["recovered_unprocessed_urls"] == 1
    assert state.retry_urls == ()
    state.url_outcomes = (_outcome(url, state="rejected_final", code="ROLE_MISMATCH"),)
    second = reconcile_hiring_url_queue(state)
    assert second["terminal_urls"] == 1
    assert state.pending_urls == ()


def _workday_payload(can_apply=...):
    info = {
        "title": "Marketing Manager",
        "location": "Milano, Lombardia",
        "startDate": date.today().isoformat(),
        "jobDescription": "Marketing manager",
        "hiringOrganization": {"name": "BD"},
    }
    if can_apply is not ...:
        info["canApply"] = can_apply
    return {"jobPostingInfo": info}


def test_workday_active_true_false_and_missing_have_explicit_semantics():
    url = "https://bdx.wd1.myworkdayjobs.com/it-it/external/job/milano/marketing-manager_r-1"
    yes = parse_workday_json(_workday_payload(True), url)[0]
    no = parse_workday_json(_workday_payload(False), url)[0]
    unknown = parse_workday_json(_workday_payload(), url)[0]
    assert (yes["active"], yes["active_evidence"], yes["active_verification_method"]) == (
        True, "workday_can_apply_true", "workday_cxs_can_apply",
    )
    assert no["active"] is False and no["active_evidence"] == "workday_can_apply_false"
    assert unknown["active"] is None and unknown["active_evidence"] == ""


def test_greenhouse_and_teamtailor_individual_api_active_provenance():
    greenhouse = parse_greenhouse_json({
        "title": "Marketing Manager", "company_name": "Acme Srl",
        "location": {"name": "Milano"}, "updated_at": date.today().isoformat(),
    }, "https://boards.greenhouse.io/acme/jobs/123456")[0]
    assert greenhouse["active"] is True
    assert greenhouse["active_evidence"] == "greenhouse_job_api_current"
    assert greenhouse["source_subtype"] == "first_party_ats"

    current = parse_teamtailor_json({
        "attributes": {"title": "Social Media Manager", "location": "Milano", "published-at": date.today().isoformat()},
        "company": {"name": "Acme Srl"},
    }, "https://acme.teamtailor.com/jobs/123-social-media-manager")[0]
    closed = parse_teamtailor_json({
        "attributes": {"title": "Social Media Manager", "location": "Milano", "published-at": date.today().isoformat(), "status": "closed"},
        "company": {"name": "Acme Srl"},
    }, "https://acme.teamtailor.com/jobs/123-social-media-manager")[0]
    assert current["active"] is True and current["active_evidence"] == "teamtailor_job_api_current"
    assert closed["active"] is False and closed["active_evidence"] == "teamtailor_job_closed"


def _jobposting_html(posted: str, valid_through: str = "") -> str:
    return f'''<html><script type="application/ld+json">{{
      "@type":"JobPosting","title":"Marketing Manager","datePosted":"{posted}",
      "validThrough":"{valid_through}",
      "jobLocation":{{"address":{{"addressLocality":"Milano","addressRegion":"Lombardia"}}}},
      "hiringOrganization":{{"name":"Acme Srl","url":"https://acme.it"}}
    }}</script></html>'''


def test_jsonld_live_gets_provenance_stale_never_defaults_true():
    live = parse_vacancy_html(
        _jobposting_html(date.today().isoformat(), (date.today() + timedelta(days=10)).isoformat()),
        "https://acme.it/jobs/marketing-manager",
    ).records[0]
    stale = parse_vacancy_html(
        _jobposting_html((date.today() - timedelta(days=90)).isoformat()),
        "https://acme.it/jobs/old-marketing-manager",
    ).records[0]
    assert live["active"] is True and live["active_evidence"] == "live_jobposting_page"
    assert stale["active"] is None and stale["active_evidence"] == ""


def test_legacy_success_without_active_is_refetched_once_not_terminal():
    url = "https://bdx.wd1.myworkdayjobs.com/it-it/external/job/milano/marketing-manager_r-1"
    state = HiringDiscoveryState(
        seen_urls=(url,),
        url_outcomes=(_outcome(url, state="rejected_final", code="SME_STATUS_UNVERIFIED", parser_result="success"),),
    )
    first = reconcile_hiring_url_queue(state)
    second = reconcile_hiring_url_queue(state)
    assert first["terminal_urls"] == second["terminal_urls"] == 0
    assert first["retryable_urls"] == second["retryable_urls"] == 1
    assert state.url_outcomes[0]["rejection_code"] == "ACTIVE_STATUS_REFETCH_REQUIRED"
    assert state.revalidation_queue == (canonical_url_key(url),)


def test_completed_active_check_without_proof_is_not_requeued_forever():
    url = "https://acme.it/jobs/old-marketing-manager"
    state = HiringDiscoveryState(
        seen_urls=(url,),
        url_outcomes=({
            **_outcome(url, state="rejected_final", code="VACANCY_DATE_MISSING", parser_result="success"),
            "active": None,
            "active_checked_at": "2026-07-16T12:00:00+00:00",
            "active_verification_method": "jsonld_jobposting_unverified",
            "active_evidence": "",
        },),
    )
    summary = reconcile_hiring_url_queue(state)
    assert summary["terminal_urls"] == 1
    assert state.revalidation_queue == ()
    assert state.retry_urls == ()


def test_failed_active_refetch_moves_from_revalidation_to_technical_retry():
    url = "https://bdx.wd1.myworkdayjobs.com/it-it/external/job/milano/marketing-manager_r-1"
    state = HiringDiscoveryState(
        seen_urls=(url,),
        revalidation_queue=(url,),
        url_outcomes=({
            **_outcome(url, state="retryable_active_refetch", code="ACTIVE_STATUS_REFETCH_REQUIRED", parser_result="success"),
            "active": None,
            "cxs_failure_code": "WORKDAY_CXS_HTTP_403",
            "cxs_attempt_count": 1,
            "available_fallback_strategies": ["official_html_structured"],
        },),
    )
    summary = reconcile_hiring_url_queue(state)
    assert summary["retryable_urls"] == 1
    assert state.revalidation_queue == ()
    assert state.url_outcomes[0]["rejection_code"] == "WORKDAY_CXS_HTTP_403"
    assert state.url_outcomes[0]["parser_result"] == "empty"
