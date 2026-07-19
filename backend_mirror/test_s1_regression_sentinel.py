"""S1 certified hiring-sales acquisition path — permanent regression sentinel.

Freeze contract: do not weaken sales acquisition duty proofs, domain proof
sealing, or semantic event/grounding schema versions used by S1.
"""
from __future__ import annotations

from backend_mirror.commercial_lifecycle import _trusted_source_adapter_identity
from backend_mirror.semantic_intelligence import (
    EVENT_SCHEMA_VERSION,
    GROUNDING_SCHEMA_VERSION,
    HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP,
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
    apply_hiring_relationship_proxy,
)
from backend_mirror.source_adapters.hiring_qualification import (
    QUALIFICATION_VALIDATOR_EPOCH,
    resolve_employer_identity,
)
from backend_mirror.source_adapters.hiring_semantic_bridge import (
    build_hiring_semantic_evidence_bundle,
    has_customer_acquisition_duty,
)


S1_BASE_SHA = "3e7b912b731bc79dfe6a7114068792f9ec961bd5"
S1_STAGING_RELEASE = "20260719_221346"


def _s1_contract() -> SemanticQueryContract:
    return SemanticQueryContract.from_model(
        {
            "query_goal": "Aziende lombarde che ampliano la squadra commerciale new business",
            "seller": {"description": "B2B"},
            "offer": {"description": "sales enablement"},
            "target_entity_types": ["operating_company"],
            "target_company_description": "employer hiring sales",
            "event_or_state_description": "active sales vacancy with customer acquisition duties",
            "target_role_in_event": "employer",
            "required_relationships": [HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP],
            "optional_relationships": [],
            "excluded_roles": ["recruiter", "publisher", "authority"],
            "excluded_entities": ["anonymous clients"],
            "geography": ["Lombardia"],
            "industry": [],
            "size_constraints": {},
            "temporal_constraints": {"maximum_age_days": 180},
            "positive_conditions": ["active vacancy", "customer acquisition duty"],
            "negative_conditions": ["customer care only", "title without duties"],
            "must_have_facts": ["employer", "vacancy url", "duty excerpt"],
            "forbidden_inferences": ["title alone proves acquisition"],
            "data_requirements": ["official_domain", "source_url", "event_date"],
            "ranking_objective": "freshest grounded employer",
            "acceptance_rubric": [
                "target_role_employer_grounded",
                "sales_customer_acquisition_team_expansion_by_target_company_grounded",
            ],
            "discovery_hypotheses": [],
            "clarification_required": False,
            "confidence": 0.95,
            "canonical_signal_hints": ["hiring_sales"],
        },
        original_query=(
            "Trova aziende lombarde che stanno ampliando la squadra "
            "incaricata di sviluppare nuovi clienti."
        ),
        requested_count=2,
    )


def test_s1_freeze_markers_are_documented() -> None:
    assert S1_BASE_SHA.startswith("3e7b912")
    assert S1_STAGING_RELEASE.startswith("20260719_")
    assert EVENT_SCHEMA_VERSION == "semantic-commercial-event-v4"
    assert GROUNDING_SCHEMA_VERSION == "semantic-grounding-v2"
    assert QUALIFICATION_VALIDATOR_EPOCH >= 14


def test_s1_vitalaire_duty_and_domain_proof_still_pass() -> None:
    duties = (
        "Acquisizione e sviluppo clienti: Individua e seleziona nuovi "
        "potenziali clienti e opportunità."
    )
    assert has_customer_acquisition_duty(duties)
    record = resolve_employer_identity(
        {
            "company_name": "IT10680-ITALIA VITALAIRE ITALIA S.P.A.",
            "hiring_organization_url": "https://www.airliquide.com/",
            "source_url": (
                "https://airliquidehr.wd3.myworkdayjobs.com/AirLiquideExternalCareers/"
                "job/trezzano---sales---vitalaire/commerciale---lombardia-nord_r10094218"
            ),
            "vacancy_source_domain": "airliquidehr.wd3.myworkdayjobs.com",
            "employer_is_direct": True,
            "active": True,
            "vacancy_title": "Commerciale - Lombardia Nord",
            "description": duties,
            "location": "Trezzano - Sales - Vitalaire",
        }
    )
    evidence = set(record.get("domain_verification_evidence") or ())
    assert {"employer_corporate_domain_resolved", "vacancy_source_verified"}.issubset(evidence)
    assert record.get("employer_official_domain") == "airliquide.com"
    assert _trusted_source_adapter_identity(
        {"source_adapter_id": "structured_hiring_v1"},
        {
            "adapter_id": "structured_hiring_v1",
            "resolution_source": "source_adapter",
            "resolution_method": "verified_source_adapter",
            "evidence": list(evidence),
        },
    )


def test_s1_title_only_commerciale_still_fails_duty_gate() -> None:
    assert not has_customer_acquisition_duty("Commerciale Lombardia")
    bundle = build_hiring_semantic_evidence_bundle(
        {
            "company_name": "Acme Spa",
            "vacancy_title": "Commerciale",
            "description": "Gestione e assistenza dei clienti già acquisiti.",
            "location": "Milano",
            "source_url": "https://careers.acme.test/job/1",
            "employer_official_domain": "acme.test",
            "employer_is_direct": True,
            "active": True,
        }
    )
    assert bundle.customer_acquisition_duty_proven is False


def test_s1_relationship_proxy_accepts_literal_acquisition_duty() -> None:
    from datetime import date

    contract = _s1_contract()
    text = (
        "Acme Spa cerca Business Developer. "
        "Sviluppare e acquisire nuovi clienti nel territorio assegnato."
    )
    interpretation = SemanticEventInterpretation.from_model(
        {
            "entities": [{"name": "Acme Spa", "type": "operating_company", "role": "employer"}],
            "events": [{"type": "active_job_opening", "status": "active"}],
            "relations": [],
            "target_company": "Acme Spa",
            "target_entity_role": "employer",
            "event_type": "active_job_opening",
            "open_predicate": "hiring sales",
            "actor": "Acme Spa",
            "employer": "Acme Spa",
            "predicate": "hires",
            "direction": "employer_to_role",
            "role": "Business Developer",
            "event_status": "active",
            "event_date": "2026-07-01",
            "location": "Milano, Lombardia",
            "evidence_excerpt": text[:120],
            "evidence_start": 0,
            "evidence_end": min(120, len(text)),
            "confidence": 0.95,
            "certainty": 0.95,
            "query_match": False,
            "why_now": "open vacancy",
            "buyer_need": "",
            "satisfied_relationships": [],
            "acceptance_rubric_passed": [],
            "schema_version": EVENT_SCHEMA_VERSION,
        }
    )
    meta = build_hiring_semantic_evidence_bundle(
        {
            "company_name": "Acme Spa",
            "vacancy_title": "Business Developer",
            "description": text,
            "location": "Milano, Lombardia",
            "published_at": "2026-07-01",
            "source_url": "https://careers.acme.test/bd",
            "employer_official_domain": "acme.test",
            "active": True,
            "employer_is_direct": True,
        }
    ).to_structured_metadata()
    enriched, early = apply_hiring_relationship_proxy(
        contract, interpretation, source_text=text, structured_metadata=meta,
    )
    assert early is None
    assert HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP in enriched.satisfied_relationships
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract,
        enriched,
        source_text=text,
        source_url="https://careers.acme.test/bd",
        source_publisher="careers.acme.test",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company="Acme Spa",
        maximum_age_days=180,
        now=date(2026, 7, 17),
        structured_metadata=meta,
    )
    assert verdict.accepted is True
    assert verdict.checks.get("customer_acquisition_duty_literal") is True
