from __future__ import annotations

import json
from datetime import date

import pytest

from backend_mirror.agents.structured_lanes import extract_jobposting_leads, resolve_hiring_employer_domains
from backend_mirror.commercial_lifecycle import evaluate_publication_gate, plan_requires_explicit_size_constraint
from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.hiring import (
    _location_matches,
    _validate_record,
)


REXEL_JSONLD = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "OWN BRAND BUSINESS DEVELOPER ITALY",
  "datePosted": "2026-06-10",
  "validThrough": "2026-09-30",
  "url": "https://careers.rexel.com/en/job/own-brand-business-developer-italy-in-sesto-san-giovanni-lombardia-italy-jid-2752",
  "hiringOrganization": {
    "@type": "Organization",
    "name": "Rexel",
    "sameAs": "https://www.rexel.com",
    "url": "https://www.rexel.com"
  },
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Sesto San Giovanni",
      "addressRegion": "Lombardia",
      "addressCountry": "IT"
    }
  },
  "description": "Rexel is hiring a business developer for the Italian market."
}
</script></head><body></body></html>
"""

HIRING_SALES_PLAN = {
    "schema_version": "1.0.0",
    "raw_query": (
        "Trovami aziende in Lombardia che stanno assumendo commerciali, "
        "sales manager o business developer."
    ),
    "target": {
        "entity_types": ["company"],
        "geographies": ["Lombardia"],
        "local_business_preference": False,
        "required_attributes": [],
    },
    "signal_policy": {
        "required_signals": ["hiring_sales"],
        "maximum_age_days_by_signal": {"hiring_sales": 60},
    },
    "source_policy": {
        "allowed_source_classes": ["company_careers", "job_board"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    },
    "evidence_policy": {"minimum_evidence_confidence": 0.75},
    "commercial_hypotheses": [{
        "signals": ["hiring_sales"],
        "buyer_problem": "La crescita commerciale richiede nuove figure di vendita.",
        "implied_need": "Servizi per accelerare pipeline commerciale.",
        "relevance_to_offer": "Vacancy sales verificata.",
        "triggering_events": ["vacancy sales attiva"],
    }],
    "seller": {
        "offer_category": "b2b",
        "products_or_services": ["sales intelligence"],
        "problems_solved": ["pipeline growth"],
        "preferred_buyer_roles": ["titolare"],
    },
}

HIRING_SALES_PMI_PLAN = {
    **HIRING_SALES_PLAN,
    "raw_query": "Trovami PMI in Lombardia che stanno assumendo commerciali.",
}


def _request(**overrides) -> AdapterDiscoveryRequest:
    base = dict(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia",),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=0.125,
        query=HIRING_SALES_PLAN["raw_query"],
        sectors=(),
        technical_filters={},
        cursor=None,
    )
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def _rexel_lead() -> dict:
    leads = extract_jobposting_leads(
        REXEL_JSONLD,
        "https://careers.rexel.com/en/job/own-brand-business-developer-italy-in-sesto-san-giovanni-lombardia-italy-jid-2752",
    )
    assert len(leads) == 1
    return leads[0]


def test_plan_without_size_constraint_does_not_require_size_policy():
    assert plan_requires_explicit_size_constraint(HIRING_SALES_PLAN) is False
    assert plan_requires_explicit_size_constraint(HIRING_SALES_PMI_PLAN) is True


def test_rexel_careers_resolves_corporate_domain():
    resolved = resolve_hiring_employer_domains(
        employer_name="Rexel",
        organization_website="https://www.rexel.com",
        vacancy_url="https://careers.rexel.com/en/job/own-brand-business-developer-italy-jid-2752",
        source_url="https://careers.rexel.com/en/job/own-brand-business-developer-italy-jid-2752",
    )
    assert resolved["employer_official_domain"] == "rexel.com"
    assert resolved["vacancy_source_domain"] == "careers.rexel.com"
    assert resolved["official_domain_verified"] is True
    assert "careers_subdomain_corporate_link" in resolved["domain_verification_evidence"]


def test_rexel_jsonld_record_uses_corporate_domain_not_careers_host():
    lead = _rexel_lead()
    assert lead["employer_official_domain"] == "rexel.com"
    assert lead["vacancy_source_domain"] == "careers.rexel.com"
    assert "careers.rexel.com" in lead["source_url"]
    assert lead["website"] == "https://rexel.com"


def test_milano_and_lombard_provinces_match_geography_filter():
    assert _location_matches("Milano, Lombardia, Italia", ("Lombardia",)) is True
    assert _location_matches("Bergamo, Italy", ("Lombardia",)) is True
    assert _location_matches("Sesto San Giovanni, Lombardia, Italy", ("Lombardia",)) is True
    assert _location_matches("Roma, Lazio, Italia", ("Lombardia",)) is False


def test_rexel_record_passes_adapter_validation_for_hiring_sales():
    lead = _rexel_lead()
    ok, rejection = _validate_record(lead, _request(), date(2026, 7, 15))
    assert ok, rejection


def test_enterprise_passes_when_query_has_no_size_constraint():
    lead = {
        "legal_name": "Rexel",
        "azienda": "Rexel",
        "entity_type": "company",
        "company_size_class": "enterprise",
        "operating_company_probability": 0.95,
        "employer_is_direct": True,
        "domain_verification": {
            "status": "verified",
            "confidence": 0.96,
            "score": 96,
            "evidence": ("careers_subdomain_corporate_link", "vacancy_source_verified"),
            "resolution_source": "source_adapter",
            "resolution_method": "verified_source_adapter",
            "adapter_id": "structured_hiring_v1",
            "url": "https://rexel.com/",
        },
        "source_adapter_id": "structured_hiring_v1",
        "lead_quality_contract": {"score": 100},
        "why_now": "Vacancy attiva.",
        "business_signals": [{
            "type": "hiring_sales",
            "status": "verified",
            "confidence": 0.96,
            "source_url": "https://careers.rexel.com/en/job/2752",
            "source_class": "company_careers",
            "source_publisher": "careers.rexel.com",
            "evidence": "Rexel cerca business developer",
            "observed_at": "2026-07-15T10:00:00+00:00",
            "published_at": "2026-06-10",
        }],
        "matched_signals": ["hiring_sales"],
        "technical_report": {"audit_status": "complete"},
        "last_audited_at": "2026-07-15T10:00:00+00:00",
        "sito": "https://rexel.com",
    }
    gate = evaluate_publication_gate(lead, HIRING_SALES_PLAN, cost_within_budget=True)
    assert "ENTITY_NOT_OPERATING" not in gate["rejection_codes"]
    assert gate["entity_operating_verified"] is True


def test_unknown_size_passes_without_explicit_size_constraint():
    lead = {
        "legal_name": "Acme Srl",
        "entity_type": "company",
        "company_size_class": "unknown",
        "operating_company_probability": 0.95,
        "employer_is_direct": True,
        "domain_verification": {
            "status": "verified",
            "confidence": 0.96,
            "score": 96,
            "evidence": ("schema_org_identity_match", "vacancy_source_verified"),
            "resolution_source": "source_adapter",
            "resolution_method": "verified_source_adapter",
            "adapter_id": "structured_hiring_v1",
            "url": "https://acme.test/",
        },
        "source_adapter_id": "structured_hiring_v1",
        "lead_quality_contract": {"score": 100},
        "why_now": "Vacancy attiva.",
        "business_signals": [{
            "type": "hiring_sales",
            "status": "verified",
            "confidence": 0.96,
            "source_url": "https://acme.test/jobs/sales",
            "source_class": "company_careers",
            "source_publisher": "acme.test",
            "evidence": "Acme cerca commerciale",
            "observed_at": "2026-07-15T10:00:00+00:00",
            "published_at": "2026-07-10",
        }],
        "matched_signals": ["hiring_sales"],
        "technical_report": {"audit_status": "complete"},
        "last_audited_at": "2026-07-15T10:00:00+00:00",
        "sito": "https://acme.test",
    }
    gate = evaluate_publication_gate(lead, HIRING_SALES_PLAN, cost_within_budget=True)
    assert gate["entity_operating_verified"] is True


def test_enterprise_fails_with_explicit_pmi_query():
    lead = {
        "legal_name": "Rexel",
        "entity_type": "company",
        "company_size_class": "enterprise",
        "operating_company_probability": 0.95,
        "employer_is_direct": True,
        "domain_verification": {
            "status": "verified",
            "confidence": 0.96,
            "score": 96,
            "evidence": ("careers_subdomain_corporate_link", "vacancy_source_verified"),
            "resolution_source": "source_adapter",
            "resolution_method": "verified_source_adapter",
            "adapter_id": "structured_hiring_v1",
            "url": "https://rexel.com/",
        },
        "source_adapter_id": "structured_hiring_v1",
        "lead_quality_contract": {"score": 100},
        "why_now": "Vacancy attiva.",
        "business_signals": [{
            "type": "hiring_sales",
            "status": "verified",
            "confidence": 0.96,
            "source_url": "https://careers.rexel.com/en/job/2752",
            "source_class": "company_careers",
            "source_publisher": "careers.rexel.com",
            "evidence": "Rexel cerca business developer",
            "observed_at": "2026-07-15T10:00:00+00:00",
            "published_at": "2026-06-10",
        }],
        "matched_signals": ["hiring_sales"],
        "technical_report": {"audit_status": "complete"},
        "last_audited_at": "2026-07-15T10:00:00+00:00",
        "sito": "https://rexel.com",
    }
    gate = evaluate_publication_gate(lead, HIRING_SALES_PMI_PLAN, cost_within_budget=True)
    assert "ENTITY_NOT_OPERATING" in gate["rejection_codes"]


def test_recruiter_without_employer_is_rejected():
    record = {
        "company_name": "Agenzia di selezione Headhunter Fixture",
        "vacancy_title": "Commerciale",
        "location": "Milano, Lombardia, Italia",
        "published_at": "2026-07-10",
        "active": True,
        "source_url": "https://headhunter-fixture.test/jobs/commerciale",
        "source_class": "company_careers",
        "employer_is_direct": False,
        "official_domain_verified": True,
        "employer_official_domain": "headhunter-fixture.test",
        "entity_class": "operating_company",
        "evidence": "Selezione commerciale per cliente riservato",
    }
    ok, rejection = _validate_record(record, _request(), date(2026, 7, 15))
    assert ok is False
    assert rejection == "RECRUITER_WITHOUT_EMPLOYER"


def test_anonymous_vacancy_is_rejected():
    record = {
        "company_name": "Confidential employer",
        "vacancy_title": "Sales manager",
        "location": "Milano, Lombardia, Italia",
        "published_at": "2026-07-10",
        "active": True,
        "source_url": "https://anon-fixture.test/jobs/sales-manager",
        "source_class": "company_careers",
        "employer_is_direct": True,
        "official_domain_verified": True,
        "employer_official_domain": "anon-fixture.test",
        "entity_class": "operating_company",
        "evidence": "Sales manager opportunity",
    }
    ok, rejection = _validate_record(record, _request(), date(2026, 7, 15))
    assert ok is False
    assert rejection == "HIRING_COMPANY_MISSING"


def test_stale_vacancy_is_rejected():
    lead = _rexel_lead()
    lead["published_at"] = "2025-01-01"
    lead["evidence_date"] = "2025-01-01"
    ok, rejection = _validate_record(lead, _request(), date(2026, 7, 15))
    assert ok is False
    assert rejection == "VACANCY_STALE"
