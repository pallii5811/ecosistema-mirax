from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from backend_mirror.contracts.source_registry import source_runtime_coverage
from backend_mirror.source_adapters import AdapterDiscoveryRequest, DigitalAuditAdapter
from backend_mirror.source_adapters.catalog import default_source_capability_registry


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "digital_audit_replay_v1.json"


def fixture_rows() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def request(*, signals: tuple[str, ...] = ("no_pixel", "no_dmarc", "missing_instagram"), mode: str = "all", count: int = 20) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="digital_audit",
        signal_ids=signals,
        signal_match_mode=mode,  # type: ignore[arg-type]
        geographies=("Torino", "italy"),
        freshness_max_age_days=1,
        requested_count=count,
        budget_eur=0,
        query="concessionari auto a Torino senza DMARC e senza Instagram",
        sectors=("concessionari auto",),
        technical_filters={"has_dmarc": False, "has_instagram": False},
    )


def test_twenty_fixture_replay_preserves_legacy_results_and_canonicalizes() -> None:
    calls: list[dict] = []

    async def fake_runner(**kwargs):
        calls.append(kwargs)
        return fixture_rows()

    result = asyncio.run(DigitalAuditAdapter(fake_runner).discover(request()))

    assert len(fixture_rows()) == 20
    assert len(result.candidates) == 20
    assert result.exhaustion.reason == "requested_count_reached"
    assert result.cost_eur == 0
    assert calls == [{
        "category": "concessionari auto",
        "location": "Torino",
        "zone": "20",
        "intent": {
            "required_signals": ["no_pixel", "no_dmarc", "missing_instagram"],
            "technical_filters": {"has_dmarc": False, "has_instagram": False},
            "signal_match_mode": "all",
            "source_adapter": "legacy_digital_audit_v1",
        },
    }]
    assert len({candidate.official_domain for candidate in result.candidates}) == 20
    assert all(candidate.entity_class == "operating_company" for candidate in result.candidates)
    assert all({item.signal_id for item in candidate.evidence} == {"no_pixel", "no_dmarc", "missing_instagram"} for candidate in result.candidates)
    assert all(candidate.contacts for candidate in result.candidates)
    assert all(candidate.adapter_id == "legacy_digital_audit_v1" for candidate in result.candidates)


def test_failed_audit_cannot_prove_negative_technical_signal() -> None:
    raw = fixture_rows()[0]
    raw.update({"website_error": "Timeout", "website_has_html": False})

    async def fake_runner(**_kwargs):
        return [raw]

    all_result = asyncio.run(DigitalAuditAdapter(fake_runner).discover(request(count=1)))
    assert all_result.candidates == ()

    identity_result = asyncio.run(DigitalAuditAdapter(fake_runner).discover(request(signals=("company_identity",), count=1)))
    assert len(identity_result.candidates) == 1
    assert identity_result.candidates[0].signal_id == "company_identity"


def test_any_mode_and_domain_dedup_are_deterministic() -> None:
    rows = fixture_rows()[:2]
    duplicate = dict(rows[0], business_name="Duplicate trading name", result_index=99)
    rows.append(duplicate)
    rows[1] = dict(rows[1], meta_pixel=True, audit={**rows[1]["audit"], "has_facebook_pixel": True})

    async def fake_runner(**_kwargs):
        return rows

    result = asyncio.run(DigitalAuditAdapter(fake_runner).discover(request(signals=("no_pixel", "no_dmarc"), mode="any", count=3)))
    assert len(result.candidates) == 2
    assert result.exhaustion.exhausted is True


def test_runtime_registry_and_source_bindings_are_truthful() -> None:
    capabilities = default_source_capability_registry().capabilities()
    assert [item.adapter_id for item in capabilities] == ["legacy_digital_audit_v1"]
    assert source_runtime_coverage("technology_audit") == "supported"
    assert source_runtime_coverage("google_business_maps") == "supported"
    assert source_runtime_coverage("public_procurement_portal") == "unsupported"


def test_legacy_hard_cap_and_required_target_are_enforced_before_runner() -> None:
    async def forbidden_runner(**_kwargs):
        raise AssertionError("runner must not be called")

    with pytest.raises(ValueError, match="requested_count"):
        asyncio.run(DigitalAuditAdapter(forbidden_runner).discover(request(count=201)))
    missing_sector = AdapterDiscoveryRequest(**{**request(count=1).__dict__, "sectors": ()})
    with pytest.raises(ValueError, match="category and geography"):
        asyncio.run(DigitalAuditAdapter(forbidden_runner).discover(missing_sector))
