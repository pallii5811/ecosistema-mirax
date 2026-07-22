"""Offline replay and regression tests for LeadAcceptanceService."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from lead_acceptance.models import EvaluationContext
from lead_acceptance.service import LeadAcceptanceService
from lead_acceptance_service import (
    COMMERCIAL_EVENT_IMPLEMENTATION_ACTIVE,
    evaluate_lead,
)

HERE = Path(__file__).resolve().parent
FIXTURE_CANDIDATES = [
    HERE / "contracts/fixtures/commercial-search-plan.valid.json",
    HERE.parent / "contracts/fixtures/commercial-search-plan.valid.json",
]
PLAN = json.loads(next(path for path in FIXTURE_CANDIDATES if path.is_file()).read_text(encoding="utf-8"))

CRM_PLAN = {
    "schema_version": "1.0.0",
    "raw_query": "Trovami aziende che stanno cercando un nuovo CRM",
    "semantic_query_contract": {
        "query_goal": "Find companies actively seeking a new CRM",
        "target_role_in_event": "buyer",
        "required_relationships": ["target_company_seeking_crm_solution"],
        "excluded_roles": ["publisher", "recruiter", "vendor"],
        "clarification_required": False,
        "confidence": 0.92,
    },
    "signal_policy": {
        "required_signals": ["crm_detected"],
        "optional_signals": [],
        "negative_signals": [],
        "maximum_age_days_by_signal": {"crm_detected": 180},
        "minimum_signal_confidence": 0.7,
    },
    "source_policy": {
        "allowed_source_classes": ["official_company_website", "recognized_local_news", "industry_publication"],
        "preferred_source_classes": ["official_company_website"],
        "excluded_source_classes": ["search_snippet"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    },
    "evidence_policy": {
        "require_official_domain": True,
        "require_source_url": True,
        "require_observed_at": True,
        "minimum_evidence_confidence": 0.7,
    },
    "seller": {},
    "commercial_hypotheses": [],
    "target": {
        "entity_types": ["company"],
        "industries": [],
        "geographies": ["Italia"],
        "company_sizes": ["micro", "piccola", "media"],
        "local_business_preference": False,
        "required_attributes": [],
        "excluded_attributes": [],
        "excluded_entities": [],
    },
}


def _base_lead(**overrides):
    lead = {
        "azienda": "Alfa Logistica Srl",
        "sito": "https://www.alfalogistica.example/",
        "employee_count": 45,
        "source_url": "https://www.alfalogistica.example/lavora-con-noi",
        "evidence": "Alfa Logistica cerca nuovi autisti per la sede lombarda",
        "why_now": "L'apertura di nuove posizioni operative aumenta oggi l'esposizione assicurativa della PMI.",
        "evidence_date": "2026-07-10T00:00:00Z",
        "matched_signals": ["hiring_operational"],
        "business_signals": [{
            "type": "hiring_operational",
            "status": "verified",
            "confidence": 0.9,
            "source_url": "https://www.alfalogistica.example/lavora-con-noi",
            "evidence": "Alfa Logistica cerca nuovi autisti per la sede lombarda",
            "observed_at": "2026-07-10T00:00:00Z",
            "published_at": "2026-07-10T00:00:00Z",
            "source_class": "official_company_website",
            "source_publisher": "alfalogistica.example",
        }],
        "domain_verification": {
            "url": "https://www.alfalogistica.example/",
            "status": "verified",
            "confidence": 0.9,
            "score": 90,
            "resolution_method": "positive_page_identity",
            "resolution_source": "extracted_website",
            "evidence": ["company_tokens_in_host", "schema_org_identity_match"],
        },
        "lead_quality_contract": {"score": 88},
        "last_audited_at": "2026-07-10T00:00:00Z",
        "technical_report": {"audit_status": "completed"},
        "semantic_grounding": {"accepted": True, "confidence": 0.9, "target_entity_role": "employer"},
        "contatti": {"email": "info@alfalogistica.example", "telefoni": ["+390212345678"]},
    }
    lead.update(overrides)
    return lead


def test_trenord_rejected_for_crm_query():
    lead = _base_lead(
        azienda="Trenord",
        sito="https://trenord.it/",
        employee_count=3500,
        evidence="Trenord ha già implementato Salesforce CRM in produzione su tutta la rete.",
        why_now="Il CRM enterprise è già in produzione e non c'è selezione attiva.",
        matched_signals=["crm_detected"],
        business_signals=[{
            "type": "crm_detected",
            "status": "verified",
            "confidence": 0.9,
            "source_url": "https://trenord.it/innovazione",
            "evidence": "Trenord ha già implementato Salesforce CRM in produzione su tutta la rete.",
            "observed_at": "2026-07-10T00:00:00Z",
            "published_at": "2026-07-10T00:00:00Z",
            "source_class": "official_company_website",
            "source_publisher": "trenord.it",
        }],
        semantic_grounding={"accepted": True, "confidence": 0.88, "target_entity_role": "buyer"},
        domain_verification={
            "url": "https://trenord.it/",
            "status": "verified",
            "confidence": 0.85,
            "score": 85,
            "resolution_method": "free_owned_host_verification",
            "resolution_source": "name_or_evidence_host_candidate",
            "evidence": ["company_tokens_in_host", "legal_name_in_page", "free_owned_host_candidate"],
        },
        source_adapter_id="generic_web_research_v1",
    )
    decision = evaluate_lead(lead, CRM_PLAN, cost_within_budget=True)
    assert decision.accepted is False
    assert "COMPANY_OUT_OF_MARKET_SCOPE" in decision.rejection_codes
    assert decision.commercial_event_status in {
        COMMERCIAL_EVENT_IMPLEMENTATION_ACTIVE,
        "AWARDED_RECENTLY",
        "SELECTION_IN_PROGRESS",
    } or "CLOSED_COMMERCIAL_OPPORTUNITY" in decision.rejection_codes


def test_pwc_rejected_as_global_enterprise():
    lead = _base_lead(
        azienda="PwC Italy",
        sito="https://pwc.com/",
        employee_count=50000,
        evidence="PwC assume sviluppatori software a Milano.",
        why_now="PwC ha aperto posizioni tech a Milano.",
        matched_signals=["hiring_technology"],
        semantic_grounding={"accepted": True, "confidence": 0.9, "target_entity_role": "employer"},
        domain_verification={
            "url": "https://pwc.com/",
            "status": "verified",
            "confidence": 0.95,
            "score": 95,
            "resolution_method": "verified_source_adapter",
            "resolution_source": "source_adapter",
            "adapter_id": "structured_hiring_v1",
            "evidence": ["schema_org_identity_match"],
        },
        source_adapter_id="structured_hiring_v1",
        employer_official_domain="pwc.com",
    )
    hiring_plan = copy.deepcopy(PLAN)
    hiring_plan["raw_query"] = "PMI che assumono sviluppatori software"
    hiring_plan["signal_policy"]["required_signals"] = ["hiring_technology"]
    decision = evaluate_lead(lead, hiring_plan, cost_within_budget=True)
    assert decision.accepted is False
    assert "GLOBAL_ENTERPRISE" in decision.rejection_codes or "COMPANY_OUT_OF_MARKET_SCOPE" in decision.rejection_codes


def test_abbott_rejected_as_global_enterprise():
    lead = _base_lead(
        azienda="Abbott",
        sito="https://abbott.com/",
        employee_count=115000,
        evidence="Abbott assume ingegneri a Milano.",
        matched_signals=["hiring_technology"],
        domain_verification={
            "url": "https://abbott.com/",
            "status": "verified",
            "confidence": 0.95,
            "score": 95,
            "resolution_method": "verified_source_adapter",
            "resolution_source": "source_adapter",
            "adapter_id": "structured_hiring_v1",
            "evidence": ["schema_org_identity_match"],
        },
        source_adapter_id="structured_hiring_v1",
        employer_official_domain="abbott.com",
    )
    hiring_plan = copy.deepcopy(PLAN)
    hiring_plan["signal_policy"]["required_signals"] = ["hiring_technology"]
    decision = evaluate_lead(lead, hiring_plan, cost_within_budget=True)
    assert decision.accepted is False
    assert "GLOBAL_ENTERPRISE" in decision.rejection_codes or "COMPANY_OUT_OF_MARKET_SCOPE" in decision.rejection_codes


def test_pmi_accept_fixture_passes_when_fully_verified():
    lead = _base_lead()
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    assert decision.accepted is True
    assert decision.market_scope_status == "CONFIRMED_SME"
    assert not decision.rejection_codes


def test_local_srl_without_employee_count_is_publishable_likely_sme():
    lead = _base_lead()
    lead.pop("employee_count", None)
    lead["company_size_class"] = "unknown"
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    assert decision.accepted is True
    assert decision.market_scope_status == "LIKELY_SME"
    assert "SIZE_UNVERIFIED" not in decision.rejection_codes


def test_non_famous_manufacturer_with_relevant_event_accepts_without_headcount():
    plan = copy.deepcopy(PLAN)
    plan["raw_query"] = "PMI manifatturiere con ampliamenti produttivi recenti e contatto pubblico"
    plan["signal_policy"]["required_signals"] = ["production_expansion"]
    plan["commercial_hypotheses"] = [{
        "id": "industrial-expansion",
        "buyer_problem": "Il nuovo reparto produttivo richiede servizi industriali aggiornati.",
        "triggering_events": ["nuovo reparto produttivo documentato"],
        "signals": ["production_expansion"],
        "implied_need": "Verifica degli impianti e dei servizi del nuovo reparto.",
        "relevance_to_offer": "L'espansione rende attuale la verifica degli impianti industriali.",
        "confidence": 0.9,
    }]
    lead = _base_lead(
        azienda="Officine Lombarde Srl",
        sito="https://officinelombarde.example/",
        company_size_class="unknown",
        source_url="https://officinelombarde.example/news/ampliamento-2026",
        evidence="Officine Lombarde ha inaugurato il nuovo reparto produttivo a Brescia il 10 luglio 2026.",
        why_now="Il nuovo reparto produttivo rende attuale una verifica degli impianti; inferenza commerciale.",
        matched_signals=["production_expansion"],
        business_signals=[{
            "type": "production_expansion",
            "status": "verified",
            "confidence": 0.92,
            "source_url": "https://officinelombarde.example/news/ampliamento-2026",
            "evidence": "Officine Lombarde ha inaugurato il nuovo reparto produttivo a Brescia il 10 luglio 2026.",
            "observed_at": "2026-07-10T00:00:00Z",
            "published_at": "2026-07-10T00:00:00Z",
            "source_class": "official_company_website",
            "source_publisher": "officinelombarde.example",
        }],
        domain_verification={
            "url": "https://officinelombarde.example/",
            "status": "verified",
            "confidence": 0.93,
            "score": 93,
            "resolution_method": "positive_page_identity",
            "resolution_source": "extracted_website",
            "evidence": ["company_tokens_in_host", "schema_org_identity_match"],
        },
        contatti={"email": "info@officinelombarde.example", "telefoni": ["+390301234567"]},
        semantic_grounding={"accepted": True, "confidence": 0.9, "target_entity_role": "expanding_company"},
    )
    lead.pop("employee_count", None)
    decision = evaluate_lead(lead, plan, cost_within_budget=True)
    assert decision.accepted is True
    assert decision.market_scope_status == "LIKELY_SME"


@pytest.mark.parametrize(
    "overrides",
    [
        {"azienda": "Global Operations Italia", "sito": "https://globalops.example/", "is_multinational": True},
        {"azienda": "Controllata Locale Srl", "sito": "https://controllata.example/", "parent_group": "Worldwide Corporation"},
        {"azienda": "Societa Mercati SpA", "sito": "https://mercati.example/", "is_listed": True},
    ],
)
def test_positive_enterprise_indicators_reject_without_employee_count(overrides):
    lead = _base_lead(**overrides, company_size_class="unknown")
    lead.pop("employee_count", None)
    lead["domain_verification"] = {**lead["domain_verification"], "url": lead["sito"]}
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    assert decision.accepted is False
    assert decision.market_scope_status == "ENTERPRISE"
    assert "COMPANY_OUT_OF_MARKET_SCOPE" in decision.rejection_codes or "GLOBAL_ENTERPRISE" in decision.rejection_codes


def test_conflicting_corporate_signals_are_held():
    lead = _base_lead(company_size_class="unknown", ownership_unresolved=True)
    lead.pop("employee_count", None)
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    assert decision.accepted is False
    assert decision.market_scope_status == "AMBIGUOUS_CORPORATE"
    assert "AMBIGUOUS_CORPORATE" in decision.rejection_codes


def test_top_level_public_contact_satisfies_contact_gate_for_likely_sme():
    lead = _base_lead(company_size_class="unknown", email="info@alfalogistica.example")
    lead.pop("employee_count", None)
    lead.pop("contatti", None)
    decision = LeadAcceptanceService().evaluate(
        lead,
        PLAN,
        EvaluationContext(cost_within_budget=True, require_contact=True),
    )
    assert decision.accepted is True
    assert decision.market_scope_status.value == "LIKELY_SME"
    assert decision.contactability_gate.passed is True


@pytest.mark.parametrize("name,domain", [("Trenord", "trenord.it"), ("PwC Italy", "pwc.com"), ("Abbott", "abbott.com")])
def test_known_large_entities_still_reject_without_headcount_via_general_indicators(name, domain):
    lead = _base_lead(
        azienda=name,
        sito=f"https://{domain}/",
        company_size_class="unknown",
        domain_verification={**_base_lead()["domain_verification"], "url": f"https://{domain}/"},
    )
    lead.pop("employee_count", None)
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    assert decision.accepted is False
    assert decision.market_scope_status == "ENTERPRISE"


@pytest.mark.parametrize(
    "name,domain,employees,expected_codes",
    [
        ("Startup Micro Srl", "startupmicro.example", 12, []),
        ("Publisher Daily", "publisher.example", 30, ["COMPANY_OUT_OF_MARKET_SCOPE"]),
        ("Recruiter Agency", "recruiter.example", 18, ["ACTOR_DIRECTION_INVERSION"]),
    ],
)
def test_fixture_matrix(name, domain, employees, expected_codes):
    lead = _base_lead(azienda=name, sito=f"https://{domain}/", employee_count=employees)
    lead["domain_verification"] = {
        **lead["domain_verification"],
        "url": f"https://{domain}/",
    }
    lead["source_url"] = f"https://{domain}/careers"
    if "Publisher" in name:
        lead["is_source_publisher"] = True
        lead["entity_classification"] = {"is_source_publisher": True, "is_media": True}
    if "Recruiter" in name:
        lead["is_recruiter"] = True
        lead["semantic_grounding"]["target_entity_role"] = "recruiter"
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    if expected_codes:
        assert decision.accepted is False
        for code in expected_codes:
            assert code in decision.rejection_codes
    else:
        assert decision.accepted is True


def test_persist_and_publish_requires_lead_acceptance_service(monkeypatch):
    from commercial_lifecycle import persist_and_publish_candidates

    calls = {"evaluate": 0}
    original = evaluate_lead

    def tracked_evaluate(*args, **kwargs):
        calls["evaluate"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr("lead_acceptance_service.evaluate_lead", tracked_evaluate)

    class _FakeQuery:
        def __init__(self, table):
            self.table = table
            self.operation = "select"

        def select(self, *_a, **_k):
            self.operation = "select"
            return self

        def eq(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def insert(self, payload):
            self.operation = "insert"
            self.payload = payload
            return self

        def update(self, payload):
            self.operation = "update"
            return self

        def upsert(self, *_a, **_k):
            return self

        def execute(self):
            from commercial_lifecycle import _Response

            if self.operation == "select":
                if self.table == "search_budget_state":
                    return _Response([{"hard_cost_eur": 1.0, "committed_cost_eur": 0.1, "status": "active"}])
                return _Response([])
            if self.operation == "insert":
                return _Response([{"id": "cand-1"}])
            return _Response([])

    class _FakeSupabase:
        def table(self, name):
            return _FakeQuery(name)

        def rpc(self, *_a, **_k):
            class _Rpc:
                def execute(self):
                    from commercial_lifecycle import _Response

                    return _Response([])
            return _Rpc()

    released = persist_and_publish_candidates(
        _FakeSupabase(),
        search_id="search-1",
        user_id="user-1",
        leads=[_base_lead()],
        canonical_plan=PLAN,
    )
    assert calls["evaluate"] >= 1
    assert released and released[0].get("_lead_acceptance_authority") == "LeadAcceptanceService"
    assert released[0].get("market_scope_status") == "CONFIRMED_SME"
