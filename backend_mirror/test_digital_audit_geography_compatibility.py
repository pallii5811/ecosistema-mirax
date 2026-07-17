from __future__ import annotations

import asyncio

import pytest

from backend_mirror.source_adapters import AdapterDiscoveryRequest, DigitalAuditAdapter
from backend_mirror.source_adapters.digital_audit_partition_policy import controlled_geography_partitions


LOCALITIES = (
    "Milano", "Rho", "Legnano", "Sesto San Giovanni", "Busto Arsizio",
    "Canicattì", "Rocca di Papa", "San Donà di Piave", "Aosta", "Torino",
    "Bolzano", "Trieste", "Genova", "Bologna", "Firenze", "Perugia",
    "Ancona", "L'Aquila", "Campobasso", "Napoli", "Bari", "Potenza",
    "Catanzaro", "Palermo", "Cagliari", "Localita Arbitraria ZXQ 42",
)


def request_for(location: str) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="digital_audit",
        signal_ids=("website_weakness",),
        signal_match_mode="all",
        geographies=(location,),
        freshness_max_age_days=1,
        requested_count=37,
        budget_eur=0,
        query=f"Imprese di pulizia a {location} con errori SEO.",
        sectors=("imprese di pulizia",),
        technical_filters={"compatibility_marker": "preserved"},
    )


@pytest.mark.parametrize("location", LOCALITIES)
def test_exact_locality_reaches_legacy_runner_unchanged(location: str) -> None:
    calls: list[dict] = []

    async def runner(**kwargs):
        calls.append(kwargs)
        return []

    result = asyncio.run(DigitalAuditAdapter(runner).discover(request_for(location)))

    assert calls[0]["category"] == "imprese di pulizia"
    assert calls[0]["location"] == location
    assert calls[0]["intent"]["technical_filters"] == {"compatibility_marker": "preserved"}
    assert result.adapter_id == "legacy_digital_audit_v1"
    assert result.telemetry["acquisition"]["requested_qualified_count"] == 37


def test_no_generic_fallback_and_route_remains_legacy_digital_audit() -> None:
    capability = DigitalAuditAdapter.CAPABILITY
    assert capability.adapter_id == "legacy_digital_audit_v1"
    assert capability.discovery_mode == "discovery_first"
    assert "generic_fallback" not in capability.supported_intents


def test_frozen_cursor_partition_counts_are_unchanged() -> None:
    assert len(controlled_geography_partitions("Milano")) == 9
    assert len(controlled_geography_partitions("Lombardia")) == 12
    assert controlled_geography_partitions("Localita Arbitraria ZXQ 42") == ("Localita Arbitraria ZXQ 42",)
