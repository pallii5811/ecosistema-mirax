"""Offline dispatcher tests for authoritative SourceAdapter canary execution."""

from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, List

import pytest

from source_adapters.contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    SourceCapability,
    SourceExhaustion,
)
from source_adapters.orchestrator import UniversalSourceOrchestrator
from source_adapters.shadow_runtime import (
    EXECUTION_RUNTIME_SOURCE_ADAPTER,
    source_adapter_orchestrator_requested,
    source_adapter_shadow_decision,
)


def _source_adapter_shadow_is_requested(intent: Any) -> bool:
    import os

    os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
    os.environ.setdefault("SUPABASE_KEY", "test-service-role-key")
    from worker_supabase import _source_adapter_shadow_is_requested as requested

    return requested(intent)


AUTHORIZED_ENV = {
    "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1",
    "MIRAX_SEARCH_DISABLED": "0",
}


def _shadow_intent(**overrides: Any) -> dict:
    base = {
        "lifecycle_stage": "v5_shadow",
        "customer_visible": False,
        "prepare_only": False,
        "execution_authorized": True,
        "execution_runtime": EXECUTION_RUNTIME_SOURCE_ADAPTER,
        "mandatory_adapter_ids": ["structured_hiring_v1", "generic_web_research_v1"],
        "uqe_plan": {
            "canonical_plan": {
                "budget_policy": {"hard_cost_eur": 0.05},
                "signal_policy": {"required_signals": ["hiring_sales"]},
                "target": {"geographies": ["Lombardia"]},
            },
            "source_coverage": {
                "adapter_ids": ["structured_hiring_v1", "generic_web_research_v1"],
            },
        },
    }
    base.update(overrides)
    return base


def _capability(adapter_id: str) -> SourceCapability:
    return SourceCapability(
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        supported_intents=("commercial_search", "hiring"),
        supported_signals=("hiring_sales",),
        source_classes=("company_careers", "web"),
        geographic_coverage=("global",),
        freshness_max_age_days=90,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=10,
        max_results_per_run=10,
        estimated_cost_eur_per_operation=0.01,
        authentication_requirements=(),
        rate_limit_per_minute=60,
        provenance_guarantees=("official_domain",),
        evidence_guarantees=("vacancy",),
        exhaustion_semantics="source",
    )


def test_execution_runtime_requests_orchestrator():
    assert source_adapter_orchestrator_requested(_shadow_intent()) is True
    assert source_adapter_orchestrator_requested({
        "lifecycle_stage": "v5_shadow",
        "source_adapter_shadow": True,
    }) is True
    assert source_adapter_orchestrator_requested({}) is False
    assert _source_adapter_shadow_is_requested(_shadow_intent()) is True
    assert _source_adapter_shadow_is_requested({
        "lifecycle_stage": "v5_shadow",
        "customer_visible": False,
    }) is False


def test_production_legacy_without_execution_runtime_unchanged():
    assert _source_adapter_shadow_is_requested({
        "lifecycle_stage": "customer_search",
        "search_mode": "agentic_only",
        "customer_visible": True,
    }) is False
    assert source_adapter_orchestrator_requested({
        "lifecycle_stage": "customer_search",
        "source_adapter_shadow": True,
    }) is False
    assert source_adapter_shadow_decision(
        {"lifecycle_stage": "customer_search", "source_adapter_shadow": True},
        environ=AUTHORIZED_ENV,
    ).reason == "SOURCE_ADAPTER_RUNTIME_NOT_REQUESTED"


def test_shadow_decision_requires_env_and_auth():
    intent = _shadow_intent()
    assert source_adapter_shadow_decision(intent, environ={}).reason == "SOURCE_ADAPTER_SHADOW_DISABLED"
    blocked = _shadow_intent(execution_authorized=False)
    assert source_adapter_shadow_decision(blocked, environ=AUTHORIZED_ENV).reason == (
        "SOURCE_ADAPTER_SHADOW_NOT_AUTHORIZED"
    )
    assert source_adapter_shadow_decision(intent, environ=AUTHORIZED_ENV).enabled is True


def test_worker_branch_blocks_silent_agentic_fallback():
    import worker_supabase

    source = inspect.getsource(worker_supabase.main)
    branch = source.split("# The v5 source-adapter path is an isolated evaluation lane.", 1)[1]
    branch = branch.split("if not _agentic_only:", 1)[0]
    assert "SOURCE_ADAPTER_RUNTIME_NOT_EXECUTED" in branch
    assert "fallback_used" in branch
    assert "actual_execution_runtime" in branch
    assert "_agentic_gap_fill_safe" not in branch
    assert "_run_core_scraper" not in branch


def test_mandatory_adapter_order_is_sequential():
    call_order: List[str] = []

    class _FakeAdapter:
        def __init__(self, adapter_id: str):
            self.capability = _capability(adapter_id)

        async def discover(self, request):  # noqa: ANN001
            call_order.append(self.capability.adapter_id)
            now = datetime.now(timezone.utc).isoformat()
            return AdapterExecutionResult(
                adapter_id=self.capability.adapter_id,
                adapter_version=self.capability.adapter_version,
                candidates=(),
                exhaustion=SourceExhaustion(True, "source", "test_done", True),
                operations=1,
                cost_eur=0.01,
                started_at=now,
                completed_at=now,
                telemetry={"provider_queries": 1, "acquisition": {}},
            )

    class _Registry:
        def __init__(self):
            self._adapters = {
                "structured_hiring_v1": _FakeAdapter("structured_hiring_v1"),
                "generic_web_research_v1": _FakeAdapter("generic_web_research_v1"),
            }

        def adapter(self, adapter_id: str):
            return self._adapters[adapter_id]

    request = AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="any",
        geographies=("Lombardia",),
        freshness_max_age_days=90,
        requested_count=2,
        budget_eur=0.05,
        query="test",
        sectors=(),
        technical_filters={},
    )
    orch = UniversalSourceOrchestrator(_Registry(), max_rounds=3, max_seconds=5)

    async def _qualifier(candidate):  # noqa: ANN001
        return SimpleNamespace(
            qualified=False,
            audited=False,
            evidence_verified=False,
            rejection_code="X",
        )

    orch.qualifier = _qualifier
    result = asyncio.run(
        orch.run(
            request,
            mandatory_adapter_ids=("structured_hiring_v1", "generic_web_research_v1"),
        )
    )
    assert call_order[0] == "structured_hiring_v1"
    assert "generic_web_research_v1" in call_order
    assert call_order.index("structured_hiring_v1") < call_order.index("generic_web_research_v1")
    assert result.coverage.adapter_ids[0] == "structured_hiring_v1"


def test_settle_never_clamps_provider_actual():
    from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor

    governor = ResearchCostGovernor.from_plan(
        {"canonical_plan": {"budget_policy": {"target_cost_eur": 0.04, "hard_cost_eur": 0.05}}},
        2,
    )
    governor.reserve("a", "web_search", 0.03)
    governor.settle("a", 0.03)
    governor.reserve("b", "web_search", 0.02)
    with pytest.raises(ResearchBudgetExceeded):
        governor.settle("b", 0.025)
    assert governor.snapshot()["committed_cost_eur"] == pytest.approx(0.055)
