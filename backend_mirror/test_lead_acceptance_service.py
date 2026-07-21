"""Offline replay and regression tests for LeadAcceptanceService."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

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
    assert decision.market_scope_status == "IN_SCOPE"
    assert not decision.rejection_codes


def test_size_unverified_rejects():
    lead = _base_lead()
    lead.pop("employee_count", None)
    lead["company_size_class"] = "unknown"
    decision = evaluate_lead(lead, PLAN, cost_within_budget=True)
    assert decision.accepted is False
    assert "SIZE_UNVERIFIED" in decision.rejection_codes


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
