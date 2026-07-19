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
    candidate_to_lifecycle_shadow_payload,
    execute_source_adapter_shadow,
    serialize_shadow_qualified_leads,
    source_adapter_shadow_decision,
)
from cost_context import current_cost_governor


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
        "execution_runtime": "source_adapter_orchestrator",
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
        assert current_cost_governor() is not None
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


class _FakeRpcResponse:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class _FakePersistentClient:
    def __init__(self):
        self.calls = []

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        if name == "reserve_search_cost":
            return _FakeRpcResponse({
                "status": "reserved",
                "estimated_cost_eur": payload["p_estimated_cost_eur"],
            })
        return _FakeRpcResponse({"ok": True})


class _PaidFixtureAdapter(_FakeHiringAdapter):
    async def discover(self, request):
        governor = current_cost_governor()
        governor.reserve("fixture:paid:1", "web_search", 0.005, provider="fixture")
        governor.settle("fixture:paid:1", 0.005)
        return await super().discover(request)


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
    assert payloads[0]["legal_name"] is None
    assert payloads[0]["field_provenance"]["official_domain"]["status"] == "verified"
    assert payloads[0]["field_provenance"]["legal_name"]["status"] == "unavailable"
    assert payloads[0]["field_provenance"]["why_now"]["status"] == "inferred"
    assert payloads[0]["field_provenance"]["email"]["status"] == "verified"
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


def test_shadow_runtime_restores_cost_context_after_execution():
    adapter = _FakeHiringAdapter()
    assert current_cost_governor() is None
    asyncio.run(
        execute_source_adapter_shadow(
            _intent(), requested_count=1, registry=SourceCapabilityRegistry((adapter,)),
            environ=AUTHORIZED_ENV,
        )
    )
    assert current_cost_governor() is None


def test_shadow_runtime_requires_persistent_client_and_search_id_together():
    with pytest.raises(ValueError, match="provided together"):
        asyncio.run(
            execute_source_adapter_shadow(
                _intent(), requested_count=1,
                registry=SourceCapabilityRegistry((_FakeHiringAdapter(),)),
                environ=AUTHORIZED_ENV, search_id="00000000-0000-0000-0000-000000000001",
            )
        )


def test_shadow_runtime_persists_reservation_before_paid_adapter_operation():
    client = _FakePersistentClient()
    adapter = _PaidFixtureAdapter()
    asyncio.run(
        execute_source_adapter_shadow(
            _intent(), requested_count=1, registry=SourceCapabilityRegistry((adapter,)),
            environ=AUTHORIZED_ENV, persistent_client=client,
            search_id="00000000-0000-0000-0000-000000000001",
        )
    )
    names = [name for name, _payload in client.calls]
    assert names.index("initialize_search_budget") < names.index("reserve_search_cost")
    assert names.index("reserve_search_cost") < names.index("settle_search_cost")


def test_shadow_payload_lifts_company_size_from_evidence_provenance():
    published = datetime.now(timezone.utc).date().isoformat()
    domain_verification = {
        "status": "verified",
        "confidence": 0.96,
        "score": 96,
        "evidence": ("schema_org_identity_match", "official_page_host_match"),
        "resolution_source": "source_adapter",
        "resolution_method": "verified_source_adapter",
        "adapter_id": "structured_hiring_v1",
        "url": "https://acme-lombardia.test/",
    }
    candidate = OpportunityCandidate(
        canonical_company_name="Acme Lombardia Srl",
        company_identifiers={},
        official_domain="acme-lombardia.test",
        official_domain_verified=True,
        official_domain_confidence=0.96,
        entity_class="operating_company",
        geographies=("Milano, Lombardia, Italia",),
        buyer_fit=1.0,
        signal_id="hiring_sales",
        signal_date=published,
        evidence=(EvidenceRecord(
            signal_id="hiring_sales",
            source_url="https://acme-lombardia.test/jobs/sales-manager",
            source_publisher="Acme Lombardia Srl",
            source_class="company_careers",
            excerpt="Acme Lombardia ricerca un sales manager per Milano.",
            observed_at=published,
            published_at=published,
            extraction_method="schema_org_jobposting",
            confidence=0.96,
            provenance={"company_size": "small", "employee_count": 45, "vacancy_title": "Sales manager"},
        ),),
        why_now="Vacancy attiva per sales manager.",
        contacts=(ContactRecord("email", "hr@acme-lombardia.test", verified=True),),
        confidence=0.96,
        contradiction_flags=(),
        provenance={"domain_verification": domain_verification},
        adapter_id="structured_hiring_v1",
        adapter_version="1.0.0",
    )
    lead = candidate_to_lifecycle_shadow_payload(candidate, opportunity_value_score=0.85)
    plan = {
        **PLAN,
        "raw_query": "Trovami aziende in Lombardia che stanno assumendo commerciali, sales manager o business developer.",
        "target": {**PLAN["target"], "geographies": ["Lombardia"], "local_business_preference": True},
        "signal_policy": {
            **PLAN["signal_policy"],
            "required_signals": ["hiring_sales"],
            "maximum_age_days_by_signal": {"hiring_sales": 60},
        },
        "source_policy": {
            **PLAN["source_policy"],
            "allowed_source_classes": ["company_careers", "job_board"],
            "primary_source_required_for": [],
        },
    }
    gate = evaluate_publication_gate(lead, plan, cost_within_budget=True)
    assert lead["company_size_class"] == "small"
    assert lead["employee_count"] == 45
    assert "ENTITY_NOT_OPERATING" not in gate["rejection_codes"]
    assert gate["entity_classification"]["size_policy_passed"] is True
