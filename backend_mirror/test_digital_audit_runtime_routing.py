"""Regression tests for Digital Audit runtime adapter routing (Search 746f1dcb…)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone

import pytest

from backend_mirror.source_adapters.catalog import (
    SourceAdapterRegistryMismatchError,
    SourceCapabilityRegistry,
    default_source_capability_registry,
)
from backend_mirror.source_adapters.contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    SourceCapability,
    SourceExhaustion,
)
from backend_mirror.source_adapters.digital_audit import DigitalAuditAdapter
from backend_mirror.source_adapters.generic_web import GenericWebResearchAdapter
from backend_mirror.source_adapters.orchestrator import UniversalSourceOrchestrator, request_from_plan
from backend_mirror.source_adapters.shadow_runtime import _mandatory_adapter_ids


MILANO_CANONICAL_PLAN = {
    "search_strategy": "maps",
    "raw_query": (
        "Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e "
        "assenza di strumenti di tracciamento pubblicitario."
    ),
    "target": {
        "industries": ["imprese di pulizia"],
        "geographies": ["Milano"],
        "entity_types": ["company"],
        "company_sizes": ["micro", "piccola", "media"],
        "local_business_preference": True,
        "required_attributes": ["sito web ufficiale attivo"],
        "excluded_attributes": [],
        "excluded_entities": [],
    },
    "signal_policy": {
        "required_signals": [
            "website_weakness",
            "missing_advertising_pixel",
            "missing_analytics",
        ],
        "optional_signals": [],
        "negative_signals": [],
        "minimum_signal_confidence": 0.75,
        "maximum_age_days_by_signal": {
            "website_weakness": 30,
            "missing_analytics": 14,
            "missing_advertising_pixel": 14,
        },
    },
    "source_policy": {
        "allowed_source_classes": ["technology_audit"],
        "preferred_source_classes": ["technology_audit"],
        "excluded_source_classes": ["search_snippet"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    },
    "ranking_policy": {
        "signal_match_mode": "any",
        "weight_buyer_fit": 0.25,
        "weight_signal_strength": 0.2,
        "weight_freshness": 0.15,
        "weight_evidence_confidence": 0.2,
        "weight_contactability": 0.1,
        "weight_need_gap": 0.1,
    },
    "evidence_policy": {
        "require_official_domain": True,
        "require_source_url": True,
        "require_observed_at": True,
        "minimum_evidence_confidence": 0.75,
        "corroboration_required_above_risk": 0.65,
    },
    "budget_policy": {"hard_cost_eur": 0.125, "target_cost_eur": 0.105},
    "schema_version": "1.0.0",
}


def _milano_request(*, count: int = 5) -> AdapterDiscoveryRequest:
    return request_from_plan(MILANO_CANONICAL_PLAN, requested_count=count, budget_eur=0.125)


def test_offline_reproduction_milano_routing_diagnostics(capsys) -> None:
    registry = default_source_capability_registry()
    request = _milano_request()
    digital = next(item for item in registry.capabilities() if item.adapter_id == "legacy_digital_audit_v1")
    coverage = registry.resolve(
        request,
        required_source_classes=("technology_audit",),
        allow_generic_fallback=False,
    )
    print("canonical selected adapters:", ["legacy_digital_audit_v1"])
    print("capability registry python:", [item.adapter_id for item in registry.capabilities()])
    print("geography requested:", list(request.geographies))
    print("geography supported:", list(digital.geographic_coverage))
    print("coverage decision:", coverage.status)
    print("adapter finali selezionati:", list(coverage.adapter_ids))
    print("coverage reasons:", list(coverage.reasons))
    print(
        "downgrade reason:",
        "legacy_digital_audit_v1:geography"
        if "legacy_digital_audit_v1:geography" in coverage.reasons
        else "none",
    )
    captured = capsys.readouterr()
    assert coverage.status == "supported"
    assert coverage.adapter_ids == ("legacy_digital_audit_v1",)
    assert "generic_web_research_v1" not in coverage.adapter_ids
    assert "legacy_digital_audit_v1:geography" not in coverage.reasons
    assert "Milano" in captured.out or request.geographies == ("Milano",)


def test_milano_is_accepted_by_digital_audit_registry() -> None:
    coverage = default_source_capability_registry().resolve(
        _milano_request(),
        required_source_classes=("technology_audit",),
        allow_generic_fallback=False,
    )
    assert coverage.status == "supported"
    assert coverage.adapter_ids == ("legacy_digital_audit_v1",)


def test_generic_web_is_not_selected_for_milano_digital_audit() -> None:
    coverage = default_source_capability_registry().resolve(_milano_request(), allow_generic_fallback=True)
    assert coverage.adapter_ids == ("legacy_digital_audit_v1",)
    assert "generic_web_research_v1" not in coverage.adapter_ids


def test_category_and_location_reach_maps_discovery() -> None:
    calls: list[dict] = []

    async def fake_runner(**kwargs):
        calls.append(kwargs)
        return []

    asyncio.run(DigitalAuditAdapter(fake_runner).discover(_milano_request(count=5)))
    assert len(calls) == 1
    assert calls[0]["category"] == "imprese di pulizia"
    assert calls[0]["location"] == "Milano"
    assert calls[0]["zone"] == "15"
    assert calls[0]["intent"]["maps_start_index"] == 0
    assert set(calls[0]["intent"]["required_signals"]) == {
        "website_weakness",
        "missing_advertising_pixel",
        "missing_analytics",
    }
    assert calls[0]["intent"]["signal_match_mode"] == "any"
    assert calls[0]["intent"]["source_adapter"] == "legacy_digital_audit_v1"


def test_signals_remain_unchanged_through_plan_boundary() -> None:
    mapped = _milano_request()
    assert mapped.signal_ids == (
        "website_weakness",
        "missing_advertising_pixel",
        "missing_analytics",
    )
    assert mapped.sectors == ("imprese di pulizia",)
    assert mapped.geographies == ("Milano",)


@dataclass
class _CountingDigitalAuditAdapter:
    calls: list[AdapterDiscoveryRequest] = field(default_factory=list)

    @property
    def capability(self) -> SourceCapability:
        return DigitalAuditAdapter.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        self.calls.append(request)
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=(),
            exhaustion=SourceExhaustion(True, "source", "fixture", True),
            operations=0,
            cost_eur=0.0,
            started_at=now,
            completed_at=now,
        )


def test_orchestrator_honors_mandatory_adapter_and_blocks_generic_fallback() -> None:
    adapter = _CountingDigitalAuditAdapter()
    registry = SourceCapabilityRegistry((adapter, GenericWebResearchAdapter()))
    result = asyncio.run(UniversalSourceOrchestrator(registry).run(
        _milano_request(count=5),
        required_source_classes=("technology_audit",),
        mandatory_adapter_ids=("legacy_digital_audit_v1",),
    ))
    assert result.coverage.status == "supported"
    assert result.coverage.adapter_ids == ("legacy_digital_audit_v1",)
    assert len(adapter.calls) == 1
    assert adapter.calls[0].requested_count == 5


@dataclass
class _BrokenGeographyDigitalAuditAdapter:
    @property
    def capability(self) -> SourceCapability:
        base = DigitalAuditAdapter.CAPABILITY
        return SourceCapability(
            **{
                **base.__dict__,
                "geographic_coverage": ("antarctica",),
            }
        )

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        raise AssertionError("broken adapter must not run when registry mismatches")


def test_registry_mismatch_raises_instead_of_silent_generic_fallback() -> None:
    registry = SourceCapabilityRegistry((
        _BrokenGeographyDigitalAuditAdapter(),
        GenericWebResearchAdapter(),
    ))
    with pytest.raises(SourceAdapterRegistryMismatchError, match="legacy_digital_audit_v1"):
        asyncio.run(UniversalSourceOrchestrator(registry).run(
            _milano_request(),
            mandatory_adapter_ids=("legacy_digital_audit_v1",),
        ))


def test_mandatory_adapter_ids_extracted_from_uqe_source_coverage() -> None:
    intent = {
        "uqe_plan": {
            "source_coverage": {"adapter_ids": ["legacy_digital_audit_v1"]},
            "source_plan": [{"execution_mode": "adapter", "adapter_ids": ["ignored_if_coverage_set"]}],
        },
    }
    assert _mandatory_adapter_ids(intent, MILANO_CANONICAL_PLAN) == ("legacy_digital_audit_v1",)


def test_mandatory_adapter_ids_fallback_to_source_plan_lanes() -> None:
    intent = {
        "uqe_plan": {
            "source_plan": [{
                "execution_mode": "adapter",
                "adapter_ids": ["legacy_digital_audit_v1"],
            }],
        },
    }
    assert _mandatory_adapter_ids(intent, MILANO_CANONICAL_PLAN) == ("legacy_digital_audit_v1",)
