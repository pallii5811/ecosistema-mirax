from __future__ import annotations

import asyncio
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

import pytest

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    DigitalAuditAdapter,
    DomainResolutionResult,
    GenericWebProviderResult,
    GenericWebResearchAdapter,
    GrowthProviderResult,
    GrowthSignalsAdapter,
    HiringAdapter,
    HiringProviderResult,
    ProcurementAdapter,
    ProcurementProviderResult,
    SourceCapabilityRegistry,
    UniversalSourceOrchestrator,
)


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _json(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _request(
    *,
    intent: str,
    signals: tuple[str, ...],
    query: str,
    count: int,
    geographies: tuple[str, ...] = ("italy",),
    sectors: tuple[str, ...] = (),
    mode: str = "all",
) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent=intent,
        signal_ids=signals,
        signal_match_mode=mode,  # type: ignore[arg-type]
        geographies=geographies,
        freshness_max_age_days=30,
        requested_count=count,
        budget_eur=0.125,
        query=query,
        sectors=sectors,
        technical_filters={"query_origin": "phase9_offline_unseen_query", "discovery_round": 1},
    )


def _digital_adapter() -> DigitalAuditAdapter:
    rows = _json("digital_audit_replay_v1.json")

    async def runner(**_kwargs):
        return rows

    return DigitalAuditAdapter(runner)


def _procurement_adapter() -> ProcurementAdapter:
    rows = _json("procurement_replay_v1.json")
    for row in rows:
        row["award_date"] = (date.today() - timedelta(days=int(row.pop("days_ago")))).isoformat()

    def provider(source_id: str):
        async def run(_request, _offset, _limit):
            return ProcurementProviderResult(tuple(row for row in rows if row["source_id"] == source_id), True, 0.0)
        return run

    async def resolver(_name, presented_url, _location, _budget):
        return DomainResolutionResult(
            url=presented_url, confidence=0.96, score=96,
            evidence=("company_tokens_in_host", "schema_org_identity_match"),
            resolution_source="fixture_identity", resolution_method="positive_page_identity",
        ) if presented_url else None

    return ProcurementAdapter(
        (provider("anac_opendata"), provider("ted_europa")),
        domain_resolver=resolver,
    )


def _hiring_adapter() -> HiringAdapter:
    payload = _json("hiring_adapter_replay_v1.json")
    rows = [*payload["negative"], *payload["positive"]]
    for row in rows:
        days = row.pop("days_ago")
        row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat() if days is not None else ""
        row["valid_through"] = (date.today() + timedelta(days=int(row.pop("valid_days")))).isoformat()
        if row.get("active") is True:
            row["active_evidence"] = "live_jobposting_page"
            row["active_verification_method"] = "fixture_http_200_jsonld_jobposting"

    async def provider(_request, _state, _limit):
        return HiringProviderResult(tuple(rows), True, 0.0, (), (), _state)

    return HiringAdapter((provider,))


def _growth_rows(group: str) -> list[dict]:
    payload = _json("growth_signals_replay_v1.json")
    rows = []
    for index, item in enumerate(payload[group], 1):
        row = {**payload["defaults"], **item}
        row["published_at"] = (date.today() - timedelta(days=int(row.pop("days_ago")))).isoformat()
        row.setdefault("geography", "Lombardia")
        row.setdefault("source_url", f"https://{row['official_domain']}/news/evento-{index}")
        row.setdefault("source_publisher", row["company_name"])
        rows.append(row)
    return rows


def _growth_adapter(group: str) -> GrowthSignalsAdapter:
    rows = [*_growth_rows("negative"), *_growth_rows(group)]

    async def provider(_request, _offset, _limit):
        return GrowthProviderResult(tuple(rows), True, 0.0)

    return GrowthSignalsAdapter((provider,))


def _multi_signal_growth_adapter() -> GrowthSignalsAdapter:
    rows = _growth_rows("marketing")
    for row in rows:
        row.update({
            "matched_signal_ids": ["investing_marketing", "expansion"],
            "evidence_excerpt": (
                f"{row['company_name']} ha avviato una nuova campagna pubblicitaria "
                "e inaugura una nuova sede a Milano."
            ),
        })

    async def provider(_request, _offset, _limit):
        return GrowthProviderResult(tuple(rows), True, 0.0)

    return GrowthSignalsAdapter((provider,))


def _generic_adapter() -> GenericWebResearchAdapter:
    payload = _json("generic_web_replay_v1.json")
    rows = []
    for group in ("negative", "positive"):
        for index, item in enumerate(payload[group], 1):
            row = {**payload["defaults"], **item}
            days = row.pop("days_ago")
            row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat() if days is not None else ""
            row.setdefault("source_url", f"https://{row['official_domain']}/news/fornitori-{index}")
            row.setdefault("source_publisher", row["company_name"])
            rows.append(row)

    async def provider(_request, offset, limit):
        return GenericWebProviderResult(tuple(rows[offset:offset + limit]), 0.0)

    return GenericWebResearchAdapter((provider,))


CASES: tuple[tuple[str, Callable[[], object], Callable[[int], AdapterDiscoveryRequest]], ...] = (
    (
        "digital_audit",
        _digital_adapter,
        lambda count: _request(
            intent="digital_audit", signals=("no_dmarc", "missing_instagram"), count=count,
            query="Rivenditori automobilistici indipendenti torinesi esposti su email e senza presenza Instagram",
            geographies=("Torino", "italy"), sectors=("concessionari auto",),
        ),
    ),
    (
        "procurement",
        _procurement_adapter,
        lambda count: _request(
            intent="public_procurement", signals=("tender_won",), count=count,
            query="Operatori piemontesi con commesse pubbliche edili aggiudicate nel mese corrente",
            geographies=("Torino", "Piemonte", "italy"), sectors=("lavori edili",),
        ),
    ),
    (
        "hiring",
        _hiring_adapter,
        lambda count: _request(
            intent="hiring", signals=("hiring_operational",), count=count,
            query="Piccole imprese italiane con selezioni attive per tecnici, operai o addetti di linea",
        ),
    ),
    (
        "marketing_investment",
        lambda: _growth_adapter("marketing"),
        lambda count: _request(
            intent="growth_signals", signals=("investing_marketing",), count=count, mode="any",
            query="PMI lombarde che hanno appena reso pubblica un'iniziativa paid media o un rebranding",
            geographies=("Lombardia", "italy"),
        ),
    ),
    (
        "expansion",
        lambda: _growth_adapter("expansion"),
        lambda count: _request(
            intent="growth_signals", signals=("expansion",), count=count, mode="any",
            query="Imprese lombarde con aperture, nuovi impianti o ampliamenti annunciati di recente",
            geographies=("Lombardia", "italy"),
        ),
    ),
    (
        "multi_signal",
        _multi_signal_growth_adapter,
        lambda count: _request(
            intent="growth_signals", signals=("investing_marketing", "expansion"), count=count,
            query="PMI lombarde che stanno contemporaneamente investendo in advertising e aprendo una nuova sede",
            geographies=("Lombardia", "italy"),
        ),
    ),
)


@pytest.mark.parametrize(("name", "adapter_factory", "request_factory"), CASES)
@pytest.mark.parametrize("count", (5, 20))
def test_structured_archetypes_reach_exact_qualified_count_offline(
    count: int,
    name: str,
    adapter_factory: Callable[[], object],
    request_factory: Callable[[int], AdapterDiscoveryRequest],
) -> None:
    adapter = adapter_factory()
    registry = SourceCapabilityRegistry((adapter,))  # type: ignore[arg-type]
    result = asyncio.run(UniversalSourceOrchestrator(registry, max_rounds=3).run(request_factory(count)))
    assert result.status == "completed_requested_count", name
    assert result.progress.requested_count == count
    assert result.progress.qualified_count == count
    assert result.progress.unique_entity_count == count
    assert result.progress.published_count == 0
    assert result.progress.rejected_count == 0
    assert len({lead.candidate.official_domain for lead in result.qualified_leads}) == count
    assert all(lead.candidate.evidence for lead in result.qualified_leads)
    assert all(lead.opportunity_value_score >= 0.55 for lead in result.qualified_leads)
    assert result.cost_eur == 0.0


def test_uncovered_signal_uses_declared_partial_fallback_and_never_fakes_twenty() -> None:
    request5 = _request(
        intent="commercial_search", signals=("seeking_supplier",), count=5,
        query="PMI lombarde che hanno pubblicato una ricerca di nuovi partner di fornitura",
        geographies=("Lombardia", "italy"), sectors=("manifattura",),
    )
    result5 = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((_generic_adapter(),)), max_rounds=2,
    ).run(request5))
    assert result5.coverage.status == "generic_fallback_partial"
    assert result5.status == "completed_requested_count"
    assert result5.progress.qualified_count == 5
    assert result5.limitations == ("generic_fallback_partial",)
    assert result5.cost_eur == 0.0

    request20 = AdapterDiscoveryRequest(**{**request5.__dict__, "requested_count": 20})
    result20 = asyncio.run(UniversalSourceOrchestrator(
        SourceCapabilityRegistry((_generic_adapter(),)), max_rounds=2,
    ).run(request20))
    assert result20.status != "completed_requested_count"
    assert result20.progress.qualified_count == 12
    assert result20.progress.requested_count == 20
    assert result20.limitations == ("generic_fallback_partial",)
    assert result20.cost_eur == 0.0
    assert all(not item.exhausted for item in result20.adapter_progress)
