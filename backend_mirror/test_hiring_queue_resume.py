from __future__ import annotations

import asyncio
from typing import Dict, List, Tuple

import pytest

from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.hiring import HiringAdapter, HiringProviderResult, _default_hiring_provider
from backend_mirror.source_adapters.hiring_budget import (
    DISCOVERY_CAP_EUR,
    HARD_CAP_EUR,
    QUERY_COST_EUR,
    HiringDiscoveryState,
    encode_discovery_cursor,
    load_discovery_state,
)
from backend_mirror.source_adapters.hiring_url_queue import (
    PENDING_PROGRESS_BATCH_CAP,
    build_priority_queue,
    build_processing_batch,
    classify_url_prefetch,
    should_prefer_pending_over_retry,
)


def _sales_request(**overrides) -> AdapterDiscoveryRequest:
    base = dict(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia",),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=HARD_CAP_EUR,
        query="Trovami aziende in Lombardia che stanno assumendo commerciali.",
        sectors=(),
        technical_filters={},
        cursor=None,
    )
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def test_operations_count_urls_processed_not_queue_total():
    async def queue_provider(_request, state, _limit):
        state.url_offset = 2
        return HiringProviderResult((), False, 0.0, (), (), state, urls_processed=2, urls_discovered_total=10)

    result = asyncio.run(HiringAdapter((queue_provider,)).discover(_sales_request()))
    assert result.operations == 2
    assert result.telemetry["queue_total_urls"] == 0


def test_discovery_locked_still_fetches_pending_urls(monkeypatch):
    calls: list[str] = []

    def fake_search(query, _limit, *, cost_scope):
        calls.append(query)
        return ["https://fixture.test/jobs/sales"]

    fetch_urls: list[str] = []

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/html"}
        url = "https://boards.greenhouse.io/acme/jobs/123"

        @property
        def text(self):
            return "<html></html>"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url):
            fetch_urls.append(url)
            return FakeResponse()

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", fake_search)
    monkeypatch.setattr("httpx.AsyncClient", FakeClient)
    state = HiringDiscoveryState(
        discovery_spent_eur=DISCOVERY_CAP_EUR,
        seen_urls=(
            "https://boards.greenhouse.io/acme/jobs/123",
            "https://www.indeed.com/viewjob?jk=abc",
        ),
        url_meta=(
            {"url": "https://boards.greenhouse.io/acme/jobs/123", "query_source": "serp:ats", "query": "q1"},
            {"url": "https://www.indeed.com/viewjob?jk=abc", "query_source": "serp:local_vacancy", "query": "q2"},
        ),
    )
    result = asyncio.run(_default_hiring_provider(_sales_request(), state, 5))
    assert calls == []
    assert fetch_urls
    assert result.urls_processed > 0
    assert result.discovery_state is not None
    assert len(result.discovery_state.processed_terminal_urls) == 2
    assert len(result.discovery_state.retryable_urls) == 0


def test_priority_queue_puts_ats_before_aggregators():
    urls = [
        "https://www.jobijoba.it/offerte-lavoro/commerciale-lombardia",
        "https://boards.greenhouse.io/acme/jobs/123456",
        "https://careers.acme.com/it/job/commerciale-milano-req-12345678",
    ]
    meta = {
        urls[0]: ("", "serp:local_vacancy"),
        urls[1]: ("", "serp:ats"),
        urls[2]: ("", "serp:careers"),
    }
    ordered = build_priority_queue(urls, meta, start_offset=0)
    accepted = [item for item in ordered if item["prefetch_accept"]]
    assert accepted[0]["canonical_url"] == urls[1].lower().rstrip("/")
    assert accepted[1]["canonical_url"] == urls[2].lower().rstrip("/")


def test_synergie_listing_prefetch_rejected():
    item = classify_url_prefetch(
        "https://www.synergie-italia.it/annunci-lombardia/vendita-offerte-lavoro",
        query_source="serp:local_vacancy",
    )
    assert item["prefetch_accept"] is False
    assert item["rejection_code"] == "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"


def test_resume_cursor_preserves_url_offset_and_skips_discovery(monkeypatch):
    calls: list[str] = []

    def fake_search(query, _limit, *, cost_scope):
        calls.append(query)
        return []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url):
            raise AssertionError("should not fetch in this unit test")

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", fake_search)
    monkeypatch.setattr("httpx.AsyncClient", FakeClient)
    state = HiringDiscoveryState(
        query_index=10,
        url_offset=60,
        discovery_spent_eur=0.05,
        executed_query_keys=("q1", "q2"),
        seen_urls=tuple(f"https://example.test/jobs/{index}" for index in range(170)),
    )
    cursor = encode_discovery_cursor(state)
    loaded = load_discovery_state(cursor, {})
    assert loaded.url_offset == 60
    assert loaded.discovery_spent_eur == pytest.approx(0.05)
    assert loaded.discovery_locked()
    # A legacy scalar offset cannot prove that any URL was processed.
    assert loaded.queue_pending() == 170
    assert loaded.url_offset == 0


def test_pending_first_queue_puts_p1_before_workday_retry():
    urls = [f"https://example.test/jobs/{index}" for index in range(170)]
    urls[100] = "https://careers.deliveroo.co.uk/role/commerciale-brescia-ftc-12-months-f4afbb437f80/apply"
    urls[101] = "https://mango.wd3.myworkdayjobs.com/it-it/mango_work_your_passion/job/stage-visual-merchandiser_jr132265-1"
    meta = {
        urls[100]: ("", "serp:local_vacancy"),
        urls[101]: ("", "serp:ats"),
    }
    retry = (
        "https://solenis.wd1.myworkdayjobs.com/en-us/solenis/job/commerciale-junior-b2b--lombardia-_r0028690",
        "https://verisure.wd3.myworkdayjobs.com/en-us/equest/job/consulente-commerciale-junior_r2026020902",
    )
    assert should_prefer_pending_over_retry(revalidation_urls=(), discovery_offset=100, total_urls=len(urls))
    batch = build_processing_batch(
        urls,
        meta,
        retry_urls=retry,
        revalidation_urls=(),
        start_offset=100,
        batch_cap=PENDING_PROGRESS_BATCH_CAP,
        prefer_pending_over_retry=True,
    )
    assert batch
    assert batch[0].get("is_pending") is True
    retry_positions = [index for index, item in enumerate(batch) if item.get("is_retry")]
    pending_positions = [index for index, item in enumerate(batch) if item.get("is_pending")]
    assert pending_positions
    assert not retry_positions or min(retry_positions) > max(pending_positions)


def test_revalidation_still_precedes_pending_when_present():
    urls = ["https://careers.acme.com/job/sales-req-12345678"]
    meta = {urls[0]: ("", "serp:careers")}
    reval = ["https://careers.acme.com/job/sales-req-12345678"]
    batch = build_processing_batch(
        urls,
        meta,
        retry_urls=("https://solenis.wd1.myworkdayjobs.com/job/x",),
        revalidation_urls=reval,
        start_offset=0,
        batch_cap=5,
        prefer_pending_over_retry=False,
    )
    assert batch[0].get("is_revalidation") is True
    assert should_prefer_pending_over_retry(revalidation_urls=reval, discovery_offset=0, total_urls=1) is False
