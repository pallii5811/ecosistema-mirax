from __future__ import annotations

import asyncio
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend_mirror.contracts.source_registry import source_runtime_coverage
from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    DiscoveryCursor,
    ProcurementAdapter,
    ProcurementProviderResult,
)
from backend_mirror.source_adapters.catalog import default_source_capability_registry
from backend_mirror.ted_client import parse_ted_award_notice


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "procurement_replay_v1.json"


def fixture_rows() -> list[dict]:
    rows = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for row in rows:
        row["award_date"] = (date.today() - timedelta(days=int(row.pop("days_ago")))).isoformat()
    return rows


def request(*, count: int = 20, cursor: DiscoveryCursor | None = None) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="public_procurement",
        signal_ids=("tender_won",),
        signal_match_mode="all",
        geographies=("Torino", "Piemonte", "italy"),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=0.125,
        query="imprese edili a Torino che hanno vinto gare negli ultimi giorni",
        sectors=("imprese edili",),
        technical_filters={},
        cursor=cursor,
    )


def provider(source_id: str, *, exhausted: bool = True):
    async def _provider(_request, _offset, _limit):
        rows = tuple(row for row in fixture_rows() if row["source_id"] == source_id)
        return ProcurementProviderResult(rows, exhausted, 0.0)
    return _provider


def test_twenty_recent_winners_from_anac_and_ted_are_canonical() -> None:
    adapter = ProcurementAdapter((provider("anac_opendata"), provider("ted_europa")))
    result = asyncio.run(adapter.discover(request()))

    assert len(result.candidates) == 20
    assert len({candidate.canonical_company_name for candidate in result.candidates}) == 20
    assert len({candidate.provenance["award_id"] for candidate in result.candidates}) == 20
    assert result.cost_eur == 0
    assert result.exhaustion.reason == "requested_count_reached"
    assert all(candidate.official_domain for candidate in result.candidates)
    assert all(candidate.signal_id == "tender_won" for candidate in result.candidates)
    assert all(candidate.signal_date for candidate in result.candidates)
    assert all(candidate.evidence[0].source_url for candidate in result.candidates)
    assert all(candidate.evidence[0].source_publisher in {"ANAC", "TED Europa"} for candidate in result.candidates)
    assert all(candidate.evidence[0].provenance["authority"] != candidate.canonical_company_name for candidate in result.candidates)


def test_negative_records_are_rejected_with_specific_codes() -> None:
    result = asyncio.run(ProcurementAdapter((provider("anac_opendata"), provider("ted_europa"))).discover(request()))
    assert {
        "ENTITY_NOT_WINNER",
        "PUBLISHER_OR_AUTHORITY_AS_WINNER",
        "AWARD_STALE",
        "TARGET_FIT_MISMATCH",
        "GEOGRAPHY_MISMATCH",
    }.issubset(set(result.warnings))


def test_cursor_and_exhaustion_are_explicit() -> None:
    async def one_page(_request, offset, _limit):
        rows = fixture_rows()[offset:offset + 2]
        return ProcurementProviderResult(tuple(rows), False, 0.0)

    first = asyncio.run(ProcurementAdapter((one_page,)).discover(request(count=5)))
    assert first.exhaustion.exhausted is False
    assert first.exhaustion.next_cursor is not None
    assert first.exhaustion.next_cursor.value == "procurement:v1:20"

    with pytest.raises(ValueError, match="invalid procurement cursor"):
        asyncio.run(ProcurementAdapter((one_page,)).discover(request(count=5, cursor=DiscoveryCursor("bad"))))


def test_ted_parser_requires_award_and_explicit_winner() -> None:
    parsed = parse_ted_award_notice({
        "noticeType": "CAN",
        "noticeId": "123-2026",
        "title": "Contract award lavori edili",
        "awardDate": date.today().isoformat(),
        "winner": {"name": "Edil Test Srl", "vat": "IT123", "website": "https://ediltest.example"},
        "buyerName": "Comune Test",
        "region": "Piemonte",
    })
    assert parsed and parsed["winner_name"] == "Edil Test Srl"
    assert parsed["authority"] == "Comune Test"
    assert parse_ted_award_notice({"noticeType": "PIN", "title": "Prior information"}) is None
    assert parse_ted_award_notice({"noticeType": "CAN", "title": "Award without winner"}) is None


def test_runtime_binding_is_registered_without_claiming_other_adapters() -> None:
    ids = {item.adapter_id for item in default_source_capability_registry().capabilities()}
    assert ids == {
        "legacy_digital_audit_v1", "public_procurement_v1", "structured_hiring_v1",
        "official_growth_signals_v1",
        "generic_web_research_v1",
    }
    assert source_runtime_coverage("public_procurement_portal") == "supported"
    assert source_runtime_coverage("company_careers") == "supported"
