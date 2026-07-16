from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from backend_mirror.source_adapters.hiring_budget import (
    HiringDiscoveryState,
    hiring_provider_exhausted,
    reconcile_hiring_url_queue,
)
from backend_mirror.source_adapters.hiring_retry_policy import classify_retry_outcome


NOW = datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc)
URL = "https://tenant.wd3.myworkdayjobs.com/it-IT/site/job/milano/marketing-manager_R1"


def decide(**fields):
    return classify_retry_outcome({"canonical_url": URL, **fields}, now=NOW)


def test_workday_403_without_untried_fallback_is_terminal():
    result = decide(
        rejection_code="WORKDAY_CXS_HTTP_403",
        cxs_attempt_count=1,
        fetch_path="html",
        fetch_success=True,
    )
    assert result.retryable is False
    assert result.url_state == "rejected_final_technical_exhausted"
    assert result.terminal_after_reason == "WORKDAY_CXS_HTTP_403_NO_UNTRIED_FALLBACK"


def test_workday_403_with_different_untried_fallback_retries_once():
    initial = decide(
        rejection_code="WORKDAY_CXS_HTTP_403",
        cxs_attempt_count=1,
        fetch_path="cxs_first",
        available_fallback_strategies=["official_html_structured"],
        retry_attempt_count=0,
    )
    assert initial.retryable is True
    assert initial.retry_strategy == "official_html_structured"
    assert initial.max_retry_attempts == 1

    exhausted = decide(
        rejection_code="WORKDAY_CXS_HTTP_403",
        cxs_attempt_count=1,
        fetch_path="cxs_first",
        available_fallback_strategies=["official_html_structured"],
        retry_attempt_count=1,
    )
    assert exhausted.retryable is False


def test_workday_404_is_terminal():
    result = decide(rejection_code="WORKDAY_CXS_HTTP_404", cxs_http_status=404)
    assert result.retryable is False
    assert result.url_state == "rejected_final"


def test_timeout_below_max_retries_and_at_max_is_terminal():
    retry = decide(rejection_code="FETCH_TIMEOUT", retry_attempt_count=1, max_retry_attempts=2)
    assert retry.retryable is True
    assert retry.retry_strategy == "same_provider_transient"

    terminal = decide(rejection_code="FETCH_TIMEOUT", retry_attempt_count=2, max_retry_attempts=2)
    assert terminal.retryable is False
    assert terminal.url_state == "rejected_final_technical_exhausted"
    assert terminal.terminal_after_reason == "MAX_RETRY_ATTEMPTS_REACHED:FETCH_TIMEOUT"


def test_dns_and_connection_reset_are_transient():
    assert decide(rejection_code="DNS_ERROR", retry_attempt_count=0).retryable is True
    assert decide(rejection_code="CONNECTION_RESET", retry_attempt_count=0).retryable is True


def test_http_429_and_5xx_retry_but_generic_404_does_not():
    assert decide(rejection_code="FETCH_HTTP_ERROR", http_status=429).retryable is True
    assert decide(rejection_code="FETCH_HTTP_ERROR", http_status=503).retryable is True
    assert decide(rejection_code="FETCH_HTTP_ERROR", http_status=404).retryable is False


def test_domain_batch_deferred_is_pending_without_network_retry_increment():
    result = decide(rejection_code="DOMAIN_BATCH_DEFERRED", retry_attempt_count=0, fetch_attempt_count=1)
    assert result.url_state == "pending_deferred"
    assert result.retryable is False
    assert result.retry_attempt_count == 0
    assert result.max_retry_attempts == 0


def test_queue_has_no_infinite_terminal_retry_and_provider_exhausts():
    state = HiringDiscoveryState(
        seen_urls=(URL,),
        retry_urls=(URL,),
        retryable_urls=(URL,),
        url_outcomes=({
            "canonical_url": URL,
            "rejection_code": "WORKDAY_CXS_HTTP_404",
            "url_state": "retryable_parser_failure",
            "cxs_http_status": 404,
        },),
    )
    telemetry = reconcile_hiring_url_queue(state)
    assert telemetry["terminal_urls"] == 1
    assert telemetry["retryable_urls"] == 0
    assert state.retry_urls == ()
    assert hiring_provider_exhausted(state, discovery_exhausted=True) is True


def test_executable_transient_prevents_provider_exhaustion():
    state = HiringDiscoveryState(
        seen_urls=(URL,),
        retry_urls=(URL,),
        url_outcomes=({
            "canonical_url": URL,
            "rejection_code": "FETCH_TIMEOUT",
            "url_state": "retryable_parser_failure",
            "retry_attempt_count": 0,
        },),
    )
    assert hiring_provider_exhausted(state, discovery_exhausted=True) is False


def test_hiring_sales_role_semantics_are_not_part_of_retry_policy():
    # Role-specific Sales/Marketing matching remains outside this technical policy.
    result = decide(rejection_code="ROLE_MISMATCH", vacancy_title="Sales Manager")
    assert result.retryable is False
    assert result.terminal_after_reason == "ROLE_MISMATCH"


def test_real_hiring_marketing_cohort_reconciles_exactly_and_has_no_executable_retry():
    report_path = Path(__file__).resolve().parents[1] / "evaluation" / "hiring-retry-exhaustion-audit.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["search_id"] == "2f68adb3-016e-4b1b-8b9f-754a703a1a7c"
    assert report["reconciliation"] == {"expected": 52, "materialized": 52, "unique_urls": 52}
    assert report["summary"]["terminali_subito"] == 52
    assert report["summary"]["transient_reali"] == 0
    assert report["summary"]["fallback_diversi_disponibili"] == 0
    assert report["summary"]["expected_max_new_qualified"] == 0
    assert report["summary"]["automatic_decision"] == "B"
