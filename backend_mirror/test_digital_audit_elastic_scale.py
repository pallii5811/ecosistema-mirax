from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest

from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest, DiscoveryCursor
from backend_mirror.source_adapters.catalog import SourceCapabilityRegistry
from backend_mirror.source_adapters.digital_audit import (
    DigitalAuditCursorState,
    DigitalAuditAdapter,
    _build_cursor,
    _parse_cursor,
)
from backend_mirror.source_adapters.orchestrator import UniversalSourceOrchestrator
from backend_mirror.test_digital_audit_projection import milano_request, milano_rows
from backend_mirror.maps_pagination import maps_identity_hash, select_digital_audit_maps_page


@dataclass
class ElasticMapsRunner:
    total_raw: int
    accepted_every: int = 1
    calls: list[dict] = field(default_factory=list)

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        intent = kwargs.get("intent") or {}
        start = int(intent.get("maps_start_index") or 0)
        partition_index = int(intent.get("partition_index") or 0)
        page_size = int(intent.get("maps_page_size") or 50)
        fetch_cap = int(intent.get("maps_fetch_cap") or start + page_size)
        partition_base = partition_index * 200
        global_start = partition_base + start
        end = min(self.total_raw, global_start + page_size)
        accepted = milano_rows()[0]
        rejected = milano_rows()[2]
        rows = []
        for index in range(global_start, end):
            is_accepted = index % self.accepted_every == 0
            base = accepted if is_accepted else rejected
            row = dict(
                base,
                place_id=f"elastic-place-{index}",
                result_index=index,
                business_name=f"Elastic Cleaning {index}",
                _maps_acquired_total=min(max(0, self.total_raw - partition_base), fetch_cap),
                _maps_provider_page_count=end - global_start,
            )
            if is_accepted:
                row["website"] = f"https://elastic-cleaning-{index}.example"
            rows.append(row)
        return rows


def elastic_request(
    requested: int,
    *,
    per_round: int = 200,
    safety_cap: int = 100_000,
) -> AdapterDiscoveryRequest:
    base = milano_request(count=requested)
    return AdapterDiscoveryRequest(**{
        **base.__dict__,
        "technical_filters": {
            **dict(base.technical_filters),
            "per_round_raw_cap": per_round,
            "maximum_safety_raw_cap": safety_cap,
        },
    })


def collect_stream(
    *,
    requested: int,
    runner: ElasticMapsRunner,
    per_round: int = 200,
    safety_cap: int = 100_000,
    restart_after: int | None = None,
) -> tuple[list[str], int, object, DiscoveryCursor | None]:
    cursor = None
    accepted_domains: list[str] = []
    raw_processed = 0
    last = None
    adapter = DigitalAuditAdapter(runner)
    for call_index in range(10_000):
        if restart_after is not None and call_index == restart_after:
            adapter = DigitalAuditAdapter(runner)
        base = elastic_request(requested, per_round=per_round, safety_cap=safety_cap)
        request = AdapterDiscoveryRequest(**{**base.__dict__, "cursor": cursor})
        last = asyncio.run(adapter.discover(request))
        raw_processed += last.operations
        remaining = requested - len(accepted_domains)
        accepted_domains.extend(
            candidate.official_domain for candidate in last.candidates[:remaining] if candidate.official_domain
        )
        if len(accepted_domains) >= requested or last.exhaustion.authoritative:
            return accepted_domains, raw_processed, last, last.exhaustion.next_cursor
        cursor = last.exhaustion.next_cursor
        if cursor is None or last.exhaustion.reason == "raw_safety_cap_reached":
            return accepted_domains, raw_processed, last, cursor
    raise AssertionError("elastic stream did not terminate")


def test_requested_20_at_ten_percent_yield_processes_at_least_200_raw() -> None:
    leads, raw, last, _ = collect_stream(
        requested=20,
        runner=ElasticMapsRunner(total_raw=1_000, accepted_every=10),
        per_round=100,
    )
    assert len(leads) == 20
    assert len(set(leads)) == 20
    assert raw >= 200
    assert last.telemetry["acquisition"]["cumulative_raw_unique"] >= 200


def test_requested_100_at_twenty_percent_yield_processes_at_least_500_raw() -> None:
    leads, raw, _, _ = collect_stream(
        requested=100,
        runner=ElasticMapsRunner(total_raw=2_000, accepted_every=5),
        per_round=200,
    )
    assert len(leads) == 100
    assert len(set(leads)) == 100
    assert raw >= 500


@pytest.mark.parametrize("requested", [500, 5000])
def test_large_cumulative_targets_are_valid_and_exact(requested: int) -> None:
    leads, _, _, _ = collect_stream(
        requested=requested,
        runner=ElasticMapsRunner(total_raw=requested + 200),
        per_round=200,
    )
    assert len(leads) == requested
    assert len(set(leads)) == requested


def test_authoritative_provider_exhaustion_returns_all_73_available() -> None:
    leads, _, last, cursor = collect_stream(
        requested=100,
        runner=ElasticMapsRunner(total_raw=73),
        per_round=50,
    )
    assert len(leads) == 73
    assert last.exhaustion.reason == "provider_exhausted_authoritative"
    assert last.exhaustion.authoritative is True
    assert cursor is None


def test_raw_safety_cap_is_resumable_and_never_source_exhaustion() -> None:
    leads, raw, last, cursor = collect_stream(
        requested=100,
        runner=ElasticMapsRunner(total_raw=2_000, accepted_every=10),
        per_round=100,
        safety_cap=100,
    )
    assert len(leads) == 10
    assert raw == 100
    assert last.exhaustion.reason == "raw_safety_cap_reached"
    assert last.exhaustion.authoritative is False
    assert cursor is not None


def test_worker_restart_resumes_without_duplicate_or_loss() -> None:
    leads, raw, last, cursor = collect_stream(
        requested=100,
        runner=ElasticMapsRunner(total_raw=1_000, accepted_every=5),
        per_round=50,
        restart_after=4,
    )
    assert len(leads) == 100
    assert len(set(leads)) == 100
    assert raw >= 500
    state = _parse_cursor(cursor or last.exhaustion.next_cursor, requested_count=100) if (cursor or last.exhaustion.next_cursor) else None
    assert state is None or state.cumulative_raw_unique >= 500


def test_v3_cursor_contains_required_cumulative_contract() -> None:
    runner = ElasticMapsRunner(total_raw=1_000, accepted_every=10)
    result = asyncio.run(DigitalAuditAdapter(runner).discover(elastic_request(20, per_round=50)))
    assert result.exhaustion.next_cursor is not None
    assert result.exhaustion.next_cursor.value.startswith("da:v3:")
    state = _parse_cursor(result.exhaustion.next_cursor, requested_count=20)
    assert state.requested_qualified_count == 20
    assert state.cumulative_raw_unique == 50
    assert state.cumulative_audited == 50
    assert state.cumulative_qualified_unique == 5
    assert state.provider_offset == 50
    assert state.partition_index == 0
    assert state.observed_yield == pytest.approx(0.1)
    assert state.adaptive_raw_target >= state.cumulative_raw_unique
    assert state.processed_place_ids_ref != "empty"


def test_legacy_runner_page_selection_never_reaudits_prior_page() -> None:
    raw = [
        {"place_id": f"place-{index}", "business_name": f"Cleaning {index}"}
        for index in range(100)
    ]
    prior_hashes = [maps_identity_hash(item) for item in raw[:50]]
    page = select_digital_audit_maps_page(raw, {
        "maps_start_index": 50,
        "maps_page_size": 50,
        "maps_fetch_cap": 100,
        "processed_identity_hashes": prior_hashes,
    })
    assert len(page) == 50
    assert {item["place_id"] for item in page} == {f"place-{index}" for index in range(50, 100)}


def test_pre_and_post_audit_website_forms_share_one_identity() -> None:
    pre_audit = {"website": "https://www.example-cleaning.it/servizi?ref=maps"}
    post_audit = {"website": "example-cleaning.it"}
    assert maps_identity_hash(pre_audit) == maps_identity_hash(post_audit)
    page = select_digital_audit_maps_page([pre_audit], {
        "maps_page_size": 1,
        "processed_identity_hashes": [maps_identity_hash(post_audit)],
    })
    assert page[0]["_maps_control_only"] is True


def test_all_processed_provider_page_returns_control_record_not_audit_work() -> None:
    raw = [{"place_id": f"place-{index}"} for index in range(10)]
    page = select_digital_audit_maps_page(raw, {
        "maps_start_index": 0,
        "maps_page_size": 10,
        "maps_fetch_cap": 10,
        "processed_identity_hashes": [maps_identity_hash(item) for item in raw],
    })
    assert page == [{
        "_maps_control_only": True,
        "_maps_acquired_total": 10,
        "_maps_fetch_cap": 10,
        "_maps_provider_page_count": 10,
    }]


def test_progress_checkpoint_carries_cursor_identities_leads_and_cost() -> None:
    adapter = DigitalAuditAdapter(ElasticMapsRunner(total_raw=1_000, accepted_every=10))
    snapshots = []
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((adapter,)),
        max_rounds=1,
    ).run(
        elastic_request(20, per_round=50),
        progress_callback=lambda snapshot: snapshots.append(snapshot),
    ))
    assert result.status == "partial_time_limit"
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    state = snapshot.runtime_state["legacy_digital_audit_v1"]
    assert state["next_cursor"].startswith("da:v3:")
    assert state["exhaustion_authoritative"] is False
    assert state["acquisition"]["cumulative_raw_unique"] == 50
    assert len(state["acquisition"]["processed_identity_hashes"]) == 50
    assert len(snapshot.qualified_leads) == 5
    assert snapshot.cost_eur == pytest.approx(result.cost_eur)


def test_persisted_lifecycle_count_overrides_stale_higher_cursor_count() -> None:
    stale_cursor = _build_cursor(DigitalAuditCursorState(
        requested_qualified_count=5,
        cumulative_raw_unique=10,
        cumulative_audited=10,
        cumulative_qualified_unique=5,
        provider_offset=10,
        observed_yield=0.5,
        adaptive_raw_target=10,
    ))
    runner = ElasticMapsRunner(total_raw=100)
    base = elastic_request(5, per_round=10)
    request = AdapterDiscoveryRequest(**{
        **base.__dict__,
        "requested_count": 1,
        "cursor": stale_cursor,
        "technical_filters": {
            **dict(base.technical_filters),
            "requested_qualified_count": 5,
            "processed_employer_keys": [f"domain:prior-{index}.example" for index in range(4)],
        },
    })
    result = asyncio.run(DigitalAuditAdapter(runner).discover(request))
    assert len(runner.calls) == 1
    assert len(result.candidates) == 1
    assert result.telemetry["acquisition"]["cumulative_qualified_unique"] == 5
