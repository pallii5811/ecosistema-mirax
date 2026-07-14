import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from commercial_lifecycle import evaluate_publication_gate
from source_adapters.catalog import SourceCapabilityRegistry
from source_adapters.contracts import (
    AdapterExecutionResult,
    ContactRecord,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceExhaustion,
)
from source_adapters.shadow_runtime import (
    execute_source_adapter_shadow,
    serialize_shadow_qualified_leads,
    source_adapter_shadow_decision,
)


HERE = Path(__file__).resolve().parent
PLAN = json.loads((HERE.parent / "contracts/fixtures/commercial-search-plan.valid.json").read_text(encoding="utf-8"))
AUTHORIZED_ENV = {
    "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1",
    "MIRAX_SEARCH_DISABLED": "0",
    "MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": "0.02",
}


def _intent():
    return {
        "lifecycle_stage": "v5_shadow",
        "customer_visible": False,
        "prepare_only": False,
        "execution_authorized": True,
        "source_adapter_shadow": True,
        "uqe_plan": {"canonical_plan": PLAN},
    }


def _candidate():
    published = datetime.now(timezone.utc).date().isoformat()
    domain_verification = {
        "status": "verified",
        "confidence": 0.95,
        "score": 95,
        "evidence": ("company_careers_host_match", "legal_name_in_page"),
        "resolution_source": "source_adapter",
        "resolution_method": "verified_source_adapter",
        "adapter_id": "structured_hiring_v1",
        "url": "https://alfa-logistica.example/",
    }
    return OpportunityCandidate(
        canonical_company_name="Alfa Logistica Srl",
        company_identifiers={"domain": "alfa-logistica.example"},
        official_domain="alfa-logistica.example",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        geographies=("Lombardia",),
        buyer_fit=0.95,
        signal_id="hiring_operational",
        signal_date=published,
        evidence=(EvidenceRecord(
            signal_id="hiring_operational",
            source_url="https://alfa-logistica.example/careers/autista-lombardia",
            source_publisher="Alfa Logistica Srl",
            source_class="company_careers",
            excerpt="Alfa Logistica seleziona un autista operativo per la sede lombarda.",
            observed_at=published,
            published_at=published,
            extraction_method="official_careers_page",
            confidence=0.95,
            provenance={"proof_level": "direct"},
        ),),
        why_now="La vacancy operativa recente aumenta l'esposizione al rischio della PMI e richiede coperture aggiornate.",
        contacts=(ContactRecord("email", "hr@alfa-logistica.example", verified=True),),
        confidence=0.95,
        contradiction_flags=(),
        provenance={
            "company_size": "small",
            "domain_verification": domain_verification,
            "urgency_score": 0.9,
            "causality_score": 0.9,
            "commercial_value_score": 0.8,
        },
        adapter_id="structured_hiring_v1",
        adapter_version="1.0.0",
    )


class _FakeHiringAdapter:
    capability = SourceCapability(
        adapter_id="structured_hiring_v1",
        adapter_version="1.0.0",
        supported_intents=("commercial_search",),
        supported_signals=("hiring_operational",),
        source_classes=("company_careers",),
        geographic_coverage=("global",),
        freshness_max_age_days=30,
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

    def __init__(self):
        self.budgets = []

    async def discover(self, request):
        self.budgets.append(request.budget_eur)
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=(_candidate(),),
            exhaustion=SourceExhaustion(True, "source", "fixture exhausted", True),
            operations=1,
            cost_eur=0.01,
            started_at=now,
            completed_at=now,
        )


def test_shadow_runtime_is_default_off_and_fail_closed():
    assert source_adapter_shadow_decision(_intent(), environ={}).reason == "SOURCE_ADAPTER_SHADOW_DISABLED"
    assert source_adapter_shadow_decision(_intent(), environ={
        "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1", "MIRAX_SEARCH_DISABLED": "1",
    }).reason == "MIRAX_SEARCH_DISABLED"
    unauthorized = _intent()
    unauthorized["execution_authorized"] = False
    assert source_adapter_shadow_decision(unauthorized, environ=AUTHORIZED_ENV).reason == "SOURCE_ADAPTER_SHADOW_NOT_AUTHORIZED"
    assert source_adapter_shadow_decision(_intent(), environ=AUTHORIZED_ENV).enabled is True


def test_authorized_shadow_executes_under_cap_and_never_publishes():
    adapter = _FakeHiringAdapter()
    result = asyncio.run(
        execute_source_adapter_shadow(
            _intent(),
            requested_count=1,
            registry=SourceCapabilityRegistry((adapter,)),
            environ=AUTHORIZED_ENV,
        )
    )
    assert result.progress.qualified_count == 1
    assert result.progress.published_count == 0
    assert result.cost_eur == pytest.approx(0.01)
    assert adapter.budgets == [pytest.approx(0.02)]

    payloads = serialize_shadow_qualified_leads(result)
    assert len(payloads) == 1
    assert payloads[0]["customer_visible"] is False
    gate = evaluate_publication_gate(payloads[0], PLAN, cost_within_budget=True)
    assert gate["publishable"] is True


def test_shadow_hard_cap_is_clamped_to_absolute_maximum():
    adapter = _FakeHiringAdapter()
    env = dict(AUTHORIZED_ENV)
    env["MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR"] = "999"
    asyncio.run(
        execute_source_adapter_shadow(
            _intent(), requested_count=1, registry=SourceCapabilityRegistry((adapter,)), environ=env,
        )
    )
    assert adapter.budgets == [pytest.approx(0.125)]
