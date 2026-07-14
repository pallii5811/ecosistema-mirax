from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest

from backend_mirror.contracts.source_registry import source_runtime_coverage
from backend_mirror.source_adapters import AdapterDiscoveryRequest, DiscoveryCursor
from backend_mirror.source_adapters.hiring import (
    HiringAdapter,
    HiringProviderResult,
    _default_hiring_provider,
    _validate_record,
    parse_hiring_page,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hiring_adapter_replay_v1.json"


def fixture_rows() -> tuple[list[dict], list[dict]]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for row in [*payload["positive"], *payload["negative"]]:
        days = row.pop("days_ago")
        row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat() if days is not None else ""
        row["valid_through"] = (date.today() + timedelta(days=int(row.pop("valid_days")))).isoformat()
    return payload["positive"], payload["negative"]


def request(*, count: int = 20, budget: float = 0.125, cursor: DiscoveryCursor | None = None) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=("hiring_operational",),
        signal_match_mode="all",
        geographies=("italy",),
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=budget,
        query="Trovami PMI italiane che stanno assumendo personale operativo",
        sectors=(),
        technical_filters={},
        cursor=cursor,
    )


def fixture_provider(*, exhausted: bool = True, cost: float = 0.0):
    async def _provider(_request, _offset, _limit):
        positive, negative = fixture_rows()
        return HiringProviderResult(tuple([*negative, *positive]), exhausted, cost)
    return _provider


def test_twenty_sme_operational_vacancies_are_canonical_and_deduplicated() -> None:
    result = asyncio.run(HiringAdapter((fixture_provider(),)).discover(request()))
    assert len(result.candidates) == 20
    assert len({candidate.official_domain for candidate in result.candidates}) == 20
    assert all(candidate.signal_id == "hiring_operational" for candidate in result.candidates)
    assert all(candidate.signal_date for candidate in result.candidates)
    assert all(candidate.entity_class == "operating_company" for candidate in result.candidates)
    assert all(candidate.evidence[0].source_url for candidate in result.candidates)
    assert all(candidate.evidence[0].provenance["vacancy_title"] for candidate in result.candidates)
    assert result.cost_eur == 0
    assert result.exhaustion.reason == "requested_count_reached"


def test_invalid_hiring_sources_are_rejected_before_candidate_promotion() -> None:
    result = asyncio.run(HiringAdapter((fixture_provider(),)).discover(request()))
    expected = {row["expected_rejection"] for row in fixture_rows()[1]}
    assert expected.issubset(set(result.warnings))
    assert not any(candidate.canonical_company_name.endswith("Enterprise Fixture Spa") for candidate in result.candidates)


@pytest.mark.parametrize(
    ("updates", "expected"),
    [
        ({"active": False}, "VACANCY_NOT_CONFIRMED_ACTIVE"),
        ({"official_domain_verified": False}, "OFFICIAL_DOMAIN_UNVERIFIED"),
        ({"official_domain": ""}, "OFFICIAL_DOMAIN_UNRESOLVED"),
        ({"company_size": "", "employee_count": None}, "SME_STATUS_UNVERIFIED"),
        ({"entity_class": "publisher"}, "NON_OPERATING_ENTITY"),
    ],
)
def test_each_qualification_boundary_fails_closed(updates, expected) -> None:
    row = fixture_rows()[0][0]
    row.update(updates)
    assert _validate_record(row, request(), date.today()) == (False, expected)


def test_specialized_hiring_signal_requires_a_coherent_role() -> None:
    row = fixture_rows()[0][0]
    sales_request = replace(request(), signal_ids=("hiring_sales",), query="PMI italiane che assumono sales")
    assert _validate_record(row, sales_request, date.today()) == (False, "HIRING_ROLE_MISMATCH")
    row.update({"vacancy_title": "Sales account", "evidence": "Ricerca un sales account. Candidati."})
    assert _validate_record(row, sales_request, date.today()) == (True, "")


def test_schema_org_and_individual_vacancy_parsers_are_fail_closed() -> None:
    structured = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Operaio specializzato",
        "datePosted": date.today().isoformat(),
        "validThrough": (date.today() + timedelta(days=30)).isoformat(),
        "url": "https://parser-fixture.test/jobs/operaio-specializzato",
        "jobLocation": {"address": {"addressLocality": "Torino", "addressCountry": "IT"}},
        "hiringOrganization": {
            "name": "Parser Fixture Srl",
            "sameAs": "https://parser-fixture.test",
            "numberOfEmployees": 42,
        },
        "description": "Parser Fixture assume un operaio specializzato. Invia la candidatura.",
    }
    html = f'<script type="application/ld+json">{json.dumps(structured)}</script>'
    parsed = parse_hiring_page(html, "https://parser-fixture.test/jobs/operaio-specializzato")
    assert len(parsed) == 1
    assert parsed[0]["location"] == "Torino, IT"
    assert parsed[0]["company_size"] == "small"
    assert parsed[0]["source_class"] == "company_careers"

    individual = f"""
      <meta property="og:site_name" content="Markup Fixture Srl">
      <meta property="article:published_time" content="{date.today().isoformat()}">
      <h1>Tecnico manutentore</h1>
      <p>Sede di lavoro: Torino</p>
      <p>Posizione aperta. Invia la candidatura.</p>
    """
    assert parse_hiring_page(individual, "https://markup-fixture.test/jobs/tecnico-manutentore")
    assert parse_hiring_page(individual, "https://markup-fixture.test/lavora-con-noi") == []
    assert parse_hiring_page("<h1>Lavora con noi</h1>", "https://markup-fixture.test/careers") == []


def test_cursor_and_hard_cost_cap_are_enforced_before_promotion() -> None:
    result = asyncio.run(HiringAdapter((fixture_provider(exhausted=False),)).discover(request(count=5)))
    assert result.exhaustion.next_cursor
    assert result.exhaustion.next_cursor.value == "hiring:v1:20"
    with pytest.raises(ValueError, match="invalid hiring cursor"):
        asyncio.run(HiringAdapter((fixture_provider(),)).discover(request(cursor=DiscoveryCursor("bad"))))
    with pytest.raises(RuntimeError, match="HARD_COST_CAP"):
        asyncio.run(HiringAdapter((fixture_provider(cost=0.126),)).discover(request(budget=0.125)))


def test_default_provider_reserves_before_every_query_and_never_exceeds_budget(monkeypatch) -> None:
    calls: list[str] = []

    def fake_search(query, _limit, *, cost_scope):
        assert cost_scope.startswith("hiring-adapter:")
        calls.append(query)
        return []

    class EmptyClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_urls_http", fake_search)
    monkeypatch.setattr("httpx.AsyncClient", EmptyClient)
    one = asyncio.run(_default_hiring_provider(request(budget=0.009), 0, 20))
    assert len(calls) == 1
    assert one.cost_eur == 0.005
    calls.clear()
    none = asyncio.run(_default_hiring_provider(request(budget=0.004), 0, 20))
    assert calls == []
    assert none.cost_eur == 0


def test_registry_binds_both_hiring_source_classes_to_real_runtime() -> None:
    from backend_mirror.source_adapters.catalog import default_source_capability_registry

    ids = {item.adapter_id for item in default_source_capability_registry().capabilities()}
    assert ids == {
        "legacy_digital_audit_v1", "public_procurement_v1", "structured_hiring_v1",
        "official_growth_signals_v1",
    }
    assert source_runtime_coverage("company_careers") == "supported"
    assert source_runtime_coverage("job_board") == "supported"
