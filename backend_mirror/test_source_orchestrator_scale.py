from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone

import pytest

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    ContactRecord,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceCapabilityRegistry,
    SourceExhaustion,
    UniversalSourceOrchestrator,
)


class ScaleShardAdapter:
    def __init__(self, shard: int, *, total: int = 1_200, page_size: int = 500, call_cost: float = 0.005) -> None:
        self.shard = shard
        self.total = total
        self.page_size = page_size
        self.call_cost = call_cost
        self.cursor_offsets: list[int] = []
        self._capability = SourceCapability(
            adapter_id=f"scale_shard_{shard}",
            adapter_version="1.0.0",
            supported_intents=("scale_validation",),
            supported_signals=("verified_growth_event",),
            source_classes=("official_company_website",),
            geographic_coverage=("global",),
            freshness_max_age_days=1,
            discovery_mode="discovery_first",
            supports_pagination=True,
            supports_cursor_resume=True,
            max_results_per_page=page_size,
            max_results_per_run=None,
            estimated_cost_eur_per_operation=call_cost,
            authentication_requirements=(),
            rate_limit_per_minute=120,
            provenance_guarantees=("shard", "cursor", "entity"),
            evidence_guarantees=("official_source", "date", "excerpt"),
            exhaustion_semantics="partition",
        )

    @property
    def capability(self) -> SourceCapability:
        return self._capability

    def _offset(self, cursor: DiscoveryCursor | None) -> int:
        if cursor is None:
            return 0
        prefix = f"scale:{self.capability.adapter_id}:"
        if not cursor.value.startswith(prefix):
            raise ValueError("invalid scale cursor")
        return int(cursor.value.removeprefix(prefix))

    def _entity_id(self, index: int) -> str:
        if index < 20:
            return f"shared-{index:04d}"
        return f"shard-{self.shard}-{index:05d}"

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        offset = self._offset(request.cursor)
        self.cursor_offsets.append(offset)
        limit = min(self.page_size, request.requested_count, max(0, self.total - offset))
        today = date.today().isoformat()
        candidates = []
        for index in range(offset, offset + limit):
            entity_id = self._entity_id(index)
            domain = f"{entity_id}.scale.test"
            evidence = EvidenceRecord(
                signal_id="verified_growth_event",
                source_url=f"https://{domain}/news/event-{index}",
                source_publisher=f"Scale Company {entity_id}",
                source_class="official_company_website",
                excerpt=f"Scale Company {entity_id} announces a verified growth event.",
                observed_at=today,
                published_at=today,
                extraction_method="offline_scale_fixture",
                confidence=0.95,
                provenance={"proof_level": "direct", "shard": self.shard, "offset": index},
            )
            candidates.append(OpportunityCandidate(
                canonical_company_name=f"Scale Company {entity_id}",
                company_identifiers={"fixture_id": entity_id},
                official_domain=domain,
                entity_class="operating_company",
                geographies=("italy",),
                buyer_fit=0.95,
                signal_id="verified_growth_event",
                signal_date=today,
                evidence=(evidence,),
                why_now="Verified recent expansion creates an immediate commercial need.",
                contacts=(ContactRecord("email", f"sales@{domain}", evidence.source_url, True),),
                confidence=0.95,
                contradiction_flags=(),
                provenance={"urgency_score": 0.9, "causality_score": 0.9, "commercial_value_score": 0.8},
                adapter_id=self.capability.adapter_id,
                adapter_version=self.capability.adapter_version,
                official_domain_verified=True,
                official_domain_confidence=0.95,
            ))
        next_offset = offset + limit
        exhausted = next_offset >= self.total
        cursor = None if exhausted else DiscoveryCursor(
            f"scale:{self.capability.adapter_id}:{next_offset}",
            partition=self.capability.adapter_id,
        )
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=exhausted,
                scope="partition",
                reason="partition_exhausted" if exhausted else "next_page_available",
                authoritative=True,
                next_cursor=cursor,
            ),
            operations=len(candidates),
            cost_eur=self.call_cost if candidates else 0.0,
            started_at=now,
            completed_at=now,
        )


def request(count: int, *, budget: float = 0.125, cursor: DiscoveryCursor | None = None) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="scale_validation",
        signal_ids=("verified_growth_event",),
        signal_match_mode="all",
        geographies=("italy",),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=budget,
        query="PMI italiane con un evento di crescita recente e verificato",
        sectors=(),
        technical_filters={"query_origin": "offline_scale"},
        cursor=cursor,
    )


@pytest.mark.parametrize("count", (100, 500, 5_000))
def test_scale_reaches_exact_qualified_count_with_monotonic_progress(count: int) -> None:
    adapters = tuple(ScaleShardAdapter(index) for index in range(5))
    snapshots = []
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry(adapters), max_rounds=5, max_seconds=60,
    ).run(request(count), progress_callback=snapshots.append))
    assert result.status == "completed_requested_count"
    assert result.progress.qualified_count == count
    assert result.progress.unique_entity_count == count
    assert len(result.qualified_leads) == count
    assert len({lead.candidate.official_domain for lead in result.qualified_leads}) == count
    assert result.progress.published_count == 0
    assert result.cost_eur <= 0.125
    assert snapshots
    assert snapshots[-1].qualified_count == count
    assert [item.qualified_count for item in snapshots] == sorted(item.qualified_count for item in snapshots)
    assert [item.raw_candidate_count for item in snapshots] == sorted(item.raw_candidate_count for item in snapshots)
    if count == 5_000:
        assert result.progress.raw_candidate_count > result.progress.unique_entity_count
        assert sum(item.calls for item in result.adapter_progress) >= 11
        assert all(adapter.cursor_offsets[:2] == [0, 500] for adapter in adapters)


def test_hard_budget_stops_before_unreserved_second_call() -> None:
    adapter = ScaleShardAdapter(0, total=5_000)
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((adapter,)), max_rounds=10,
    ).run(request(1_000, budget=0.009)))
    assert result.status == "partial_budget_exhausted"
    assert result.cost_eur == 0.005
    assert result.progress.qualified_count == 500
    assert adapter.cursor_offsets == [0]


def test_resume_cursor_continues_without_replaying_previous_page() -> None:
    first_adapter = ScaleShardAdapter(0, total=1_200)
    first = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((first_adapter,)), max_rounds=3,
    ).run(request(700)))
    cursor = first.adapter_progress[0].next_cursor
    assert cursor is not None
    assert first_adapter.cursor_offsets == [0, 500]

    resumed_adapter = ScaleShardAdapter(0, total=1_200)
    resumed = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((resumed_adapter,)), max_rounds=2,
    ).run(request(300), resume_cursors={resumed_adapter.capability.adapter_id: cursor}))
    first_domains = {lead.candidate.official_domain for lead in first.qualified_leads}
    resumed_domains = {lead.candidate.official_domain for lead in resumed.qualified_leads}
    assert resumed.status == "completed_requested_count"
    assert resumed_adapter.cursor_offsets == [700]
    assert first_domains.isdisjoint(resumed_domains)


def test_authoritative_partition_exhaustion_is_truthful() -> None:
    adapter = ScaleShardAdapter(0, total=600)
    result = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((adapter,)), max_rounds=5,
    ).run(request(1_000)))
    assert result.status == "partial_sources_exhausted"
    assert result.progress.qualified_count == 600
    assert result.progress.requested_count == 1_000
    assert result.adapter_progress[0].exhausted is True
    assert result.cost_eur == 0.010


def test_resume_cursor_contract_rejects_ambiguous_or_unknown_adapter() -> None:
    adapters = (ScaleShardAdapter(0), ScaleShardAdapter(1))
    cursor = DiscoveryCursor("scale:scale_shard_0:100", partition="scale_shard_0")
    with pytest.raises(ValueError, match="ambiguous"):
        asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry(adapters)).run(request(10, cursor=cursor)))
    with pytest.raises(ValueError, match="unselected"):
        asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry(adapters)).run(
            request(10), resume_cursors={"not_selected": cursor},
        ))
