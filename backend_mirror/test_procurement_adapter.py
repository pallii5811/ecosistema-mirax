from __future__ import annotations

import asyncio
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend_mirror.contracts.source_registry import source_runtime_coverage
from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    DomainResolutionResult,
    DiscoveryCursor,
    ProcurementAdapter,
    ProcurementProviderResult,
)
from backend_mirror.source_adapters.catalog import default_source_capability_registry
from backend_mirror.source_adapters.procurement import _ted_provider
from backend_mirror.ted_client import parse_ted_award_notice


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "procurement_replay_v1.json"


def fixture_rows() -> list[dict]:
    rows = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for row in rows:
        row["award_date"] = (date.today() - timedelta(days=int(row.pop("days_ago")))).isoformat()
    return rows


def request(*, count: int = 20, budget: float = 0.125, cursor: DiscoveryCursor | None = None) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="public_procurement",
        signal_ids=("tender_won",),
        signal_match_mode="all",
        geographies=("Torino", "Piemonte", "italy"),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=budget,
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


async def verified_domain(_name, presented_url, _location, _budget):
    return DomainResolutionResult(
        url=presented_url,
        confidence=0.96,
        score=96,
        evidence=("company_tokens_in_host", "schema_org_identity_match"),
        resolution_source="fixture_identity",
        resolution_method="positive_page_identity",
    ) if presented_url else None


def adapter(providers):
    return ProcurementAdapter(providers, domain_resolver=verified_domain)


def test_twenty_recent_winners_from_anac_and_ted_are_canonical() -> None:
    subject = adapter((provider("anac_opendata"), provider("ted_europa")))
    result = asyncio.run(subject.discover(request()))

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
    result = asyncio.run(adapter((provider("anac_opendata"), provider("ted_europa"))).discover(request()))
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

    first = asyncio.run(adapter((one_page,)).discover(request(count=5)))
    assert first.exhaustion.exhausted is False
    assert first.exhaustion.next_cursor is not None
    assert first.exhaustion.next_cursor.value == "procurement:v1:20"

    with pytest.raises(ValueError, match="invalid procurement cursor"):
        asyncio.run(adapter((one_page,)).discover(request(count=5, cursor=DiscoveryCursor("bad"))))


def test_missing_anac_domain_requires_positive_resolution_and_budget() -> None:
    rows = fixture_rows()[:2]
    for row in rows:
        row["official_domain"] = ""

    async def one_provider(_request, _offset, _limit):
        return ProcurementProviderResult(tuple(rows), True, 0.0)

    calls = []

    async def resolver(name, _presented, _location, budget):
        calls.append((name, budget))
        return DomainResolutionResult(
            url=f"https://{name.lower().replace(' ', '-')}.example",
            confidence=0.94,
            score=94,
            evidence=("company_tokens_in_host", "schema_org_identity_match"),
            resolution_source="serp_identity",
            resolution_method="positive_page_identity",
            cost_eur=0.005,
        )

    result = asyncio.run(ProcurementAdapter((one_provider,), domain_resolver=resolver).discover(
        request(count=2, budget=0.005),
    ))
    assert len(result.candidates) == 1
    assert result.candidates[0].official_domain_verified is True
    assert result.candidates[0].official_domain_confidence == 0.94
    assert result.cost_eur == 0.005
    assert len(calls) == 1
    assert "DOMAIN_RESOLUTION_BUDGET_EXHAUSTED" in result.warnings


def test_unverified_domain_resolution_never_promotes_candidate() -> None:
    row = fixture_rows()[0]
    row["official_domain"] = ""

    async def one_provider(_request, _offset, _limit):
        return ProcurementProviderResult((row,), True, 0.0)

    async def unresolved(*_args):
        return None

    result = asyncio.run(ProcurementAdapter((one_provider,), domain_resolver=unresolved).discover(request(count=1)))
    assert result.candidates == ()
    assert "OFFICIAL_DOMAIN_UNRESOLVED" in result.warnings


def test_country_only_target_rejects_foreign_ted_before_domain_cost() -> None:
    italian, foreign = fixture_rows()[0], fixture_rows()[1]
    italian.update({"source_id": "ted_europa", "geography": "ITC4 Lombardia", "official_domain": "https://italian.example"})
    foreign.update({"source_id": "ted_europa", "geography": "FR France", "official_domain": "https://foreign.example"})

    async def one_provider(_request, _offset, _limit):
        return ProcurementProviderResult((foreign, italian), True, 0.0)

    calls = []

    async def resolver(name, presented_url, _location, _budget):
        calls.append(name)
        return await verified_domain(name, presented_url, _location, _budget)

    italy_only = AdapterDiscoveryRequest(
        intent="public_procurement", signal_ids=("tender_won",), signal_match_mode="all",
        geographies=("Italia",), freshness_max_age_days=30, requested_count=5,
        budget_eur=0.125, query="imprese edili italiane", sectors=("imprese edili",),
        technical_filters={},
    )
    result = asyncio.run(ProcurementAdapter((one_provider,), domain_resolver=resolver).discover(italy_only))

    assert [candidate.canonical_company_name for candidate in result.candidates] == [italian["winner_name"]]
    assert calls == [italian["winner_name"]]
    assert "GEOGRAPHY_MISMATCH" in result.warnings


def test_anac_records_are_intrinsically_italian_for_country_only_target() -> None:
    row = fixture_rows()[0]
    row.update({"source_id": "anac_opendata", "geography": "Lombardia", "official_domain": "https://anac-winner.example"})

    async def one_provider(_request, _offset, _limit):
        return ProcurementProviderResult((row,), True, 0.0)

    italy_only = AdapterDiscoveryRequest(
        intent="public_procurement", signal_ids=("tender_won",), signal_match_mode="all",
        geographies=("Italia",), freshness_max_age_days=30, requested_count=1,
        budget_eur=0.125, query="imprese edili italiane", sectors=("imprese edili",),
        technical_filters={},
    )
    result = asyncio.run(adapter((one_provider,)).discover(italy_only))
    assert len(result.candidates) == 1


def test_ted_provider_keeps_country_in_discovery_query(monkeypatch) -> None:
    captured = {}

    async def fake_discover(keywords, *, location, page, limit):
        captured.update({"keywords": keywords, "location": location, "page": page, "limit": limit})
        return {"records": [], "exhausted": True, "cost_eur": 0.0}

    monkeypatch.setattr("backend_mirror.ted_client.discover_ted_awards", fake_discover)
    italy_only = AdapterDiscoveryRequest(
        intent="public_procurement", signal_ids=("tender_won",), signal_match_mode="all",
        geographies=("Italia",), freshness_max_age_days=30, requested_count=5,
        budget_eur=0.125, query="imprese edili italiane", sectors=("edilizia",),
        technical_filters={},
    )
    asyncio.run(_ted_provider(italy_only, 0, 20))
    assert captured["location"] == "Italia"


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
