from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest

from source_adapters.contracts import (
    AdapterDiscoveryRequest,
    DiscoveryCursor,
)
from source_adapters.digital_audit import DigitalAuditAdapter
from source_adapters.orchestrator import AdapterProgress, OrchestrationResult, UniversalSourceOrchestrator
from source_adapters.shadow_runtime import (
    build_shadow_resume_state,
    merge_shadow_qualified_payloads,
)
from test_digital_audit_projection import milano_request, milano_rows


@dataclass
class _GrowingPoolRunner:
    pool: list[dict]
    calls: list[dict] = field(default_factory=list)

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        start = int(kwargs.get("intent", {}).get("maps_start_index") or 0)
        page_size = int(kwargs.get("intent", {}).get("maps_page_size") or 15)
        fetch_cap = int(kwargs.get("intent", {}).get("maps_fetch_cap") or start + page_size)
        page = self.pool[start:start + page_size]
        return [dict(item, _maps_acquired_total=min(len(self.pool), fetch_cap), _maps_provider_page_count=len(page)) for item in page]


def _mock_partial_time_result(*, cursor: str, qualified_payloads: list[dict]) -> OrchestrationResult:
    from source_adapters.catalog import CapabilityCoverage

    return OrchestrationResult(
        status="partial_time_limit",
        coverage=CapabilityCoverage("supported", ("legacy_digital_audit_v1",), (), (), ()),
        qualified_leads=(),
        progress=type("P", (), {
            "requested_count": 5,
            "discovered_count": 15,
            "raw_candidate_count": 15,
            "unique_entity_count": 3,
            "resolved_count": 3,
            "audited_count": 15,
            "evidence_verified_count": 3,
            "qualified_count": len(qualified_payloads),
            "rejected_count": 12,
            "published_count": 0,
        })(),
        rejection_codes={},
        adapter_progress=(
            AdapterProgress(
                adapter_id="legacy_digital_audit_v1",
                calls=1,
                operations=15,
                raw_candidates=3,
                unique_candidates=3,
                qualified=len(qualified_payloads),
                cost_eur=0.0,
                exhausted=False,
                next_cursor=DiscoveryCursor(cursor),
                acquisition_telemetry={
                    "next_start_index": 15,
                    "batch_cap": 15,
                    "raw_candidate_budget": 30,
                    "provider_exhausted": False,
                },
            ),
        ),
        cost_eur=0.0,
        started_at="2026-07-15T00:00:00+00:00",
        completed_at="2026-07-15T00:00:00+00:00",
    )


def test_partial_time_limit_produces_resumable_state() -> None:
    payloads = [{"sito": "https://shinecleaning.it", "source_adapter_id": "legacy_digital_audit_v1"}]
    resume = build_shadow_resume_state(
        _mock_partial_time_result(cursor="da:v2:15:15:30", qualified_payloads=payloads),
        qualified_lead_payloads=payloads,
        requested_count=5,
    )
    assert resume["resumable"] is True
    assert resume["provider_exhausted"] is False
    assert resume["resume_cursors"]["legacy_digital_audit_v1"] == "da:v2:15:15:30"


def test_raw_safety_cap_remains_resumable_and_not_provider_exhausted() -> None:
    result = _mock_partial_time_result(cursor="da:v3:safety", qualified_payloads=[])
    result = OrchestrationResult(**{
        **result.__dict__,
        "status": "raw_safety_cap_reached",
        "adapter_progress": (
            AdapterProgress(
                adapter_id="legacy_digital_audit_v1",
                exhausted=True,
                exhaustion_authoritative=False,
                exhaustion_scope="budget",
                exhaustion_reason="raw_safety_cap_reached",
                next_cursor=DiscoveryCursor("da:v3:safety"),
            ),
        ),
    })
    resume = build_shadow_resume_state(result, qualified_lead_payloads=[], requested_count=5)
    assert resume["resumable"] is True
    assert resume["provider_exhausted"] is False
    assert resume["resume_cursors"]["legacy_digital_audit_v1"] == "da:v3:safety"


def test_authoritative_exhaustion_is_terminal_and_removes_stale_cursor() -> None:
    result = _mock_partial_time_result(cursor="da:v3:old", qualified_payloads=[])
    result = OrchestrationResult(**{
        **result.__dict__,
        "status": "provider_exhausted_authoritative",
        "adapter_progress": (
            AdapterProgress(
                adapter_id="legacy_digital_audit_v1",
                exhausted=True,
                exhaustion_authoritative=True,
                exhaustion_scope="source",
                exhaustion_reason="provider_exhausted_authoritative",
                next_cursor=None,
            ),
        ),
    })
    resume = build_shadow_resume_state(
        result,
        qualified_lead_payloads=[],
        prior_state={"resume_cursors": {"legacy_digital_audit_v1": "da:v3:old"}},
        requested_count=5,
    )
    assert resume["resumable"] is False
    assert resume["provider_exhausted"] is True
    assert resume["resume_cursors"] == {}


def test_empty_generic_web_cursor_does_not_wipe_productive_prior() -> None:
    from source_adapters.generic_web_budget import GenericWebDiscoveryState, encode_generic_web_cursor

    rich = encode_generic_web_cursor(
        GenericWebDiscoveryState(
            provider_calls=1,
            pages_fetched=3,
            executed_query_keys=('azienda Italia ("adotta") CRM',),
            url_meta=({"url": "https://example.it/news"},),
        )
    ).value
    empty = encode_generic_web_cursor(GenericWebDiscoveryState()).value
    result = OrchestrationResult(**{
        **_mock_partial_time_result(cursor=empty, qualified_payloads=[]).__dict__,
        "adapter_progress": (
            AdapterProgress(
                adapter_id="generic_web_research_v1",
                exhausted=True,
                exhaustion_authoritative=False,
                exhaustion_scope="partition",
                exhaustion_reason="sample_partition_complete_not_global_exhaustion",
                next_cursor=DiscoveryCursor(empty),
                acquisition_telemetry={"pages_fetched": 0, "provider_queries": 0},
            ),
        ),
    })
    resume = build_shadow_resume_state(
        result,
        qualified_lead_payloads=[],
        prior_state={
            "resume_cursors": {"generic_web_research_v1": rich},
            "acquisition": {"pages_fetched": 3, "provider_queries": 1},
            "prior_cost_eur": 0.02,
        },
        requested_count=2,
    )
    assert resume["resume_cursors"]["generic_web_research_v1"] == rich
    assert int(resume["acquisition"].get("pages_fetched") or 0) >= 3


def test_merge_shadow_qualified_payloads_preserves_primary_and_related() -> None:
    prior = [{
        "sito": "https://verisure.com",
        "employer_official_domain": "verisure.com",
        "azienda": "Verisure",
        "citta": "Milano",
        "vacancy_url": "https://careers.verisure.com/milano",
        "source_adapter_id": "structured_hiring_v1",
    }]
    new = [{
        "sito": "https://verisure.com",
        "employer_official_domain": "verisure.com",
        "azienda": "Verisure",
        "citta": "Brescia",
        "vacancy_url": "https://careers.verisure.com/brescia",
        "source_adapter_id": "structured_hiring_v1",
        "business_signals": [{"source_url": "https://careers.verisure.com/brescia", "evidence": "Sales Brescia"}],
    }]
    merged = merge_shadow_qualified_payloads(prior, new)
    assert len(merged) == 1
    primary = merged[0]
    assert primary["citta"] == "Milano"
    assert primary["vacancy_url"] == "https://careers.verisure.com/milano"
    related = primary.get("related_opportunities") or []
    assert len(related) == 1
    assert related[0]["vacancy_url"] == "https://careers.verisure.com/brescia"


def test_resume_cursor_starts_at_next_batch() -> None:
    accepted = dict(milano_rows()[0])
    rejected = {**milano_rows()[2], "place_id": "maps-reject"}
    pool = [{**rejected, "result_index": index, "place_id": f"maps-reject-{index}"} for index in range(15)]
    pool.extend([accepted, accepted])
    runner = _GrowingPoolRunner(pool)
    adapter = DigitalAuditAdapter(runner)
    first_request = AdapterDiscoveryRequest(**{
        **milano_request(count=5).__dict__,
        "technical_filters": {**dict(milano_request(count=5).technical_filters), "per_round_raw_cap": 15},
    })
    first = asyncio.run(adapter.discover(first_request))
    assert first.exhaustion.next_cursor is not None
    asyncio.run(adapter.discover(
        AdapterDiscoveryRequest(**{
            **first_request.__dict__,
            "cursor": first.exhaustion.next_cursor,
        })
    ))
    assert runner.calls[0]["intent"]["maps_start_index"] == 0
    assert runner.calls[1]["intent"]["maps_start_index"] == 15


def test_orchestrator_resume_preserves_prior_qualified_domains() -> None:
    accepted = dict(milano_rows()[0])
    rejected = {**milano_rows()[2], "place_id": "maps-reject"}
    pool = [{**rejected, "result_index": index, "place_id": f"maps-reject-{index}"} for index in range(15)]
    pool.extend([accepted])
    runner = _GrowingPoolRunner(pool)
    adapter = DigitalAuditAdapter(runner)
    registry = __import__("source_adapters.catalog", fromlist=["SourceCapabilityRegistry"]).SourceCapabilityRegistry((adapter,))

    async def run_once(*, cursor=None, remaining=5):
        request = milano_request(count=remaining)
        orchestrator = UniversalSourceOrchestrator(registry, max_seconds=30.0, max_rounds=1)
        return await orchestrator.run(
            request,
            resume_cursors={adapter.capability.adapter_id: cursor} if cursor else None,
        )

    first = asyncio.run(run_once(remaining=5))
    prior_domains = {lead.candidate.official_domain for lead in first.qualified_leads}
    cursor = first.adapter_progress[0].next_cursor if first.adapter_progress else None
    if cursor is None:
        pytest.skip("fixture exhausted in one batch")
    second = asyncio.run(run_once(cursor=cursor, remaining=max(1, 5 - first.progress.qualified_count)))
    resumed_domains = {lead.candidate.official_domain for lead in second.qualified_leads}
    assert prior_domains.isdisjoint(resumed_domains)
