from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend_mirror.source_adapters import AdapterDiscoveryRequest, DigitalAuditAdapter
from backend_mirror.source_adapters.digital_audit import (
    CandidateProjectionDecision,
    category_matches_target,
    maps_batch_size_for,
    project_candidate_from_raw,
    raw_candidate_budget_for,
    signal_groups_from_required_signals,
    trace_candidate_projection,
)
from backend_mirror.source_adapters.orchestrator import UniversalSourceOrchestrator, default_candidate_qualifier, request_from_plan


MILANO_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "digital_audit_milano_replay_v1.json"


def milano_rows() -> list[dict]:
    return json.loads(MILANO_FIXTURE.read_text(encoding="utf-8"))


def milano_request(*, count: int = 5) -> AdapterDiscoveryRequest:
    groups = signal_groups_from_required_signals((
        "website_weakness", "missing_advertising_pixel", "missing_analytics",
    ))
    return AdapterDiscoveryRequest(
        intent="maps",
        signal_ids=("website_weakness", "missing_advertising_pixel", "missing_analytics"),
        signal_match_mode="all",
        geographies=("Milano",),
        freshness_max_age_days=14,
        requested_count=count,
        budget_eur=0.125,
        query="Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e assenza di strumenti di tracciamento pubblicitario.",
        sectors=("imprese di pulizia",),
        technical_filters={"signal_groups": groups},
    )


def test_signal_groups_are_derived_for_digital_audit_query() -> None:
    plan = request_from_plan({
        "search_strategy": "maps",
        "signal_policy": {
            "required_signals": ["website_weakness", "missing_advertising_pixel", "missing_analytics"],
            "optional_signals": [],
            "negative_signals": [],
            "minimum_signal_confidence": 0.75,
            "maximum_age_days_by_signal": {
                "website_weakness": 30,
                "missing_analytics": 14,
                "missing_advertising_pixel": 14,
            },
        },
        "target": {"industries": ["imprese di pulizia"], "geographies": ["Milano"]},
        "ranking_policy": {"signal_match_mode": "all"},
    })
    assert plan.technical_filters["signal_groups"] == [
        ["website_weakness"],
        ["missing_advertising_pixel", "missing_analytics"],
    ]


@pytest.mark.parametrize(
    ("discovery", "expected"),
    [
        ("impresa di pulizie", True),
        ("servizio di pulizia", True),
        ("cleaning service", True),
        ("lavanderia self service", False),
        ("negozio di detergenti", False),
    ],
)
def test_category_matching_aliases(discovery: str, expected: bool) -> None:
    ok, _, _ = category_matches_target("imprese di pulizia", discovery, business_name="Fixture Srl")
    assert ok is expected


def test_website_weakness_and_missing_pixel_pass() -> None:
    raw = {
        **milano_rows()[0],
        "meta_pixel": False,
        "google_tag_manager": True,
        "technical_report": {"has_ga4": True, "seo_disaster": True, "load_speed_seconds": 5.0},
        "audit": {"has_facebook_pixel": False, "has_gtm": True},
    }
    decision = project_candidate_from_raw(raw, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
    assert decision.accepted is True
    assert decision.candidate is not None
    assert "website_weakness" in {item.signal_id for item in decision.candidate.evidence}
    assert "missing_advertising_pixel" in {item.signal_id for item in decision.candidate.evidence}


def test_website_weakness_and_missing_analytics_pass() -> None:
    raw = {
        **milano_rows()[1],
        "meta_pixel": True,
        "google_tag_manager": True,
        "technical_report": {"has_ga4": False, "seo_disaster": True, "load_speed_seconds": 4.5},
        "audit": {"has_facebook_pixel": True, "has_gtm": True},
    }
    decision = project_candidate_from_raw(raw, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
    assert decision.accepted is True
    assert "missing_analytics" in {item.signal_id for item in decision.candidate.evidence}


def test_tracking_present_fails() -> None:
    decision = project_candidate_from_raw(milano_rows()[2], milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
    assert decision.accepted is False
    assert decision.rejection_code == "TRACKING_ABSENCE_NOT_VERIFIED"


def test_missing_tracking_without_seo_fails() -> None:
    raw = {
        **milano_rows()[2],
        "meta_pixel": False,
        "google_tag_manager": False,
        "technical_report": {"has_ga4": False, "seo_disaster": False, "load_speed_seconds": 2.0, "html_errors": 0},
        "audit": {"has_facebook_pixel": False, "has_gtm": False},
        "html_errors": 0,
    }
    decision = project_candidate_from_raw(raw, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
    assert decision.accepted is False
    assert decision.rejection_code == "SEO_WEAKNESS_NOT_VERIFIED"


def test_wrong_category_fails_with_code() -> None:
    raw = {**milano_rows()[0], "category": "negozio di detergenti", "business_name": "Detergenti Express"}
    decision = project_candidate_from_raw(raw, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
    assert decision.accepted is False
    assert decision.rejection_code == "CATEGORY_TARGET_MISMATCH"


def test_every_rejection_has_code() -> None:
    for row in milano_rows():
        trace = trace_candidate_projection(row, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
        if trace["candidate_projection"] == "fail":
            assert trace["rejection_code"]


def test_milano_replay_trace_table(capsys) -> None:
    request = milano_request(count=5)
    for row in milano_rows():
        trace = trace_candidate_projection(row, request, observed_at="2026-07-15T00:00:00+00:00")
        print(json.dumps(trace, ensure_ascii=False))
    output = capsys.readouterr().out
    assert "Bloom Cleaning" in output
    assert "CATEGORY_TARGET_MISMATCH" not in output or "Bloom Cleaning" in output


@dataclass
class _BatchRunner:
    batches: list[list[dict]]
    calls: list[dict] = field(default_factory=list)

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        index = len(self.calls) - 1
        if index >= len(self.batches):
            return []
        return self.batches[index]


@dataclass
class _GrowingPoolRunner:
    pool: list[dict]
    calls: list[dict] = field(default_factory=list)

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        cap = int(str(kwargs.get("zone") or "15"))
        return self.pool[:cap]


def test_zero_projected_candidates_do_not_exhaust_when_more_batches_exist() -> None:
    rejected = {**milano_rows()[2], "place_id": "maps-reject"}
    pool = [{**rejected, "result_index": index, "place_id": f"maps-reject-{index}"} for index in range(15)]
    pool.extend(milano_rows()[:2])
    runner = _GrowingPoolRunner(pool)
    first = asyncio.run(DigitalAuditAdapter(runner).discover(milano_request(count=5)))
    assert first.candidates == ()
    assert first.exhaustion.exhausted is False
    assert first.exhaustion.reason == "batch_cap_reached"
    assert first.exhaustion.next_cursor is not None
    assert runner.calls[0]["zone"] == "15"

    second = asyncio.run(DigitalAuditAdapter(runner).discover(
        AdapterDiscoveryRequest(**{
            **milano_request(count=5).__dict__,
            "cursor": first.exhaustion.next_cursor,
        })
    ))
    assert len(second.candidates) >= 1
    assert runner.calls[1]["zone"] == "25"


def test_orchestrator_continues_until_qualified() -> None:
    accepted = dict(milano_rows()[0])
    rejected = {**milano_rows()[2], "place_id": "maps-reject"}
    pool = [{**rejected, "result_index": index, "place_id": f"maps-reject-{index}"} for index in range(15)]
    pool.extend([accepted, rejected])
    runner = _GrowingPoolRunner(pool)

    async def run_once():
        adapter = DigitalAuditAdapter(runner)
        registry = __import__("backend_mirror.source_adapters.catalog", fromlist=["SourceCapabilityRegistry"]).SourceCapabilityRegistry((adapter,))
        return await UniversalSourceOrchestrator(registry).run(milano_request(count=1))

    result = asyncio.run(run_once())
    assert result.progress.qualified_count == 1
    assert len(runner.calls) >= 2


def test_requested_count_does_not_set_raw_cap_to_five() -> None:
    budget = raw_candidate_budget_for(5, {})
    batch = maps_batch_size_for({})
    assert budget >= 30
    assert batch == 15


def test_raw_budget_reached_is_not_provider_exhaustion() -> None:
    rejected = {**milano_rows()[2], "place_id": "maps-reject"}
    pool = [{**rejected, "result_index": index, "place_id": f"maps-reject-{index}"} for index in range(30)]
    runner = _GrowingPoolRunner(pool)
    request = milano_request(count=5)
    request = AdapterDiscoveryRequest(**{
        **request.__dict__,
        "technical_filters": {**dict(request.technical_filters), "raw_candidate_budget": 30, "maps_batch_size": 15},
    })
    first = asyncio.run(DigitalAuditAdapter(runner).discover(request))
    assert first.exhaustion.reason == "batch_cap_reached"
    assert runner.calls[0]["zone"] == "15"


def test_orchestrator_terminates_at_qualified_five() -> None:
    accepted_rows = [
        dict(milano_rows()[0], place_id="maps-pass-0", result_index=100),
        dict(milano_rows()[1], place_id="maps-pass-1", result_index=101),
        dict(milano_rows()[3], place_id="maps-pass-2", result_index=102),
        dict(milano_rows()[4], place_id="maps-pass-3", result_index=103),
        dict(milano_rows()[0], business_name="Bloom Cleaning North", place_id="maps-pass-4", website="https://www.bloomnorth.it", result_index=104),
    ]
    rejected = {**milano_rows()[2], "place_id": "maps-reject"}
    pool = [{**rejected, "result_index": index, "place_id": f"maps-reject-{index}"} for index in range(20)]
    pool.extend(accepted_rows)
    runner = _GrowingPoolRunner(pool)

    async def run_once():
        adapter = DigitalAuditAdapter(runner)
        registry = __import__("backend_mirror.source_adapters.catalog", fromlist=["SourceCapabilityRegistry"]).SourceCapabilityRegistry((adapter,))
        return await UniversalSourceOrchestrator(registry).run(milano_request(count=5))

    result = asyncio.run(run_once())
    assert result.progress.qualified_count == 5
    assert result.status == "completed_requested_count"


@pytest.mark.parametrize(
    ("raw_patch", "expected_signal"),
    [
        ({"meta_pixel": False, "audit": {"has_facebook_pixel": False}}, "missing_advertising_pixel"),
        ({"has_meta_pixel": False}, "missing_advertising_pixel"),
        ({"technical_report": {"has_ga4": False}, "audit": {"has_facebook_pixel": True, "has_gtm": True}, "meta_pixel": True}, "missing_analytics"),
        ({"has_google_analytics": False, "technical_report": {"seo_disaster": True}, "meta_pixel": False, "audit": {"has_facebook_pixel": False}}, "missing_analytics"),
        ({"meta_pixel": True, "audit": {"has_facebook_pixel": True, "has_gtm": True}, "tech_stack": ["Meta Pixel", "GA4", "GTM"], "technical_report": {"seo_disaster": True}}, None),
    ],
)
def test_payload_field_variants(raw_patch: dict, expected_signal: str | None) -> None:
    raw = {
        **milano_rows()[0],
        "website_status": "HAS_WEBSITE",
        "website_has_html": True,
        "website_error": None,
        **raw_patch,
    }
    from backend_mirror.source_adapters.digital_audit import _confirmed_signal_values

    confirmed = _confirmed_signal_values(raw)
    if expected_signal is None:
        assert "missing_advertising_pixel" not in confirmed
        assert "missing_analytics" not in confirmed
    else:
        assert expected_signal in confirmed


def test_trace_contains_original_and_normalized_values() -> None:
    raw = {
        **milano_rows()[0],
        "tech_stack": ["MISSING GA4", "DISASTRO SEO (NO H1/TITLE)", "Meta Pixel"],
        "meta_pixel": True,
        "technical_report": {"has_ga4": True, "seo_disaster": False},
    }
    trace = trace_candidate_projection(raw, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
    assert trace["tech_stack_original"]
    assert "normalized_signals" in trace
    assert "audit_payload" in trace
    assert trace["rejection_code"]


def test_rejected_records_always_have_rejection_code_in_trace() -> None:
    for row in milano_rows():
        trace = trace_candidate_projection(row, milano_request(count=1), observed_at="2026-07-15T00:00:00+00:00")
        if trace["rejected"]:
            assert trace["rejection_code"]
        assert "signal_group_seo" in trace
        assert "signal_group_tracking" in trace


def test_adapter_returns_projection_traces_in_telemetry() -> None:
    runner = _BatchRunner([milano_rows()[:2]])
    result = asyncio.run(DigitalAuditAdapter(runner).discover(milano_request(count=5)))
    traces = result.telemetry.get("projection_traces")
    assert isinstance(traces, list)
    assert len(traces) == 2
    assert all(trace.get("rejection_code") for trace in traces)


def test_deduplication_blocks_repeated_domains_across_batch_keys() -> None:
    duplicate = dict(milano_rows()[0], business_name="Bloom Cleaning duplicate", result_index=99)
    runner = _BatchRunner([milano_rows()[:1] + [duplicate]])

    result = asyncio.run(DigitalAuditAdapter(runner).discover(milano_request(count=5)))
    assert len(result.candidates) == 1


def test_exhaustion_is_explicit_when_maps_returns_less_than_fetch_cap() -> None:
    runner = _BatchRunner([milano_rows()[2:3]])
    result = asyncio.run(DigitalAuditAdapter(runner).discover(milano_request(count=5)))
    assert result.exhaustion.exhausted is True
    assert result.exhaustion.reason == "provider_exhausted"


def test_worker_tech_stack_labels_confirm_signals() -> None:
    raw = {
        **milano_rows()[0],
        "meta_pixel": True,
        "google_tag_manager": True,
        "technical_report": {"has_ga4": True, "seo_disaster": False},
        "audit": {"has_facebook_pixel": True, "has_gtm": True},
        "tech_stack": ["MISSING GA4", "DISASTRO SEO (NO H1/TITLE)", "Meta Pixel", "GTM"],
        "html_errors": 0,
    }
    from backend_mirror.source_adapters.digital_audit import _confirmed_signal_values

    confirmed = _confirmed_signal_values(raw)
    assert "missing_analytics" in confirmed
    assert "website_weakness" in confirmed
    assert "missing_advertising_pixel" not in confirmed


def test_requested_count_remains_qualified_target_in_orchestrator() -> None:
    pool = milano_rows()[:3]
    runner = _GrowingPoolRunner(pool)
    result = asyncio.run(UniversalSourceOrchestrator(
        __import__("backend_mirror.source_adapters.catalog", fromlist=["SourceCapabilityRegistry"]).SourceCapabilityRegistry((DigitalAuditAdapter(runner),)),
    ).run(milano_request(count=2)))
    assert result.progress.requested_count == 2
    assert result.progress.qualified_count == 2
    assert all(asyncio.run(default_candidate_qualifier(lead.candidate)).qualified for lead in result.qualified_leads)
