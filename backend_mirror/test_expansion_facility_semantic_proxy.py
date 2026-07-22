"""Seller-driven expansion facility semantic proxy."""
from __future__ import annotations

from backend_mirror.semantic_intelligence import (
    EXPANSION_FACILITY_RELATIONSHIP,
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
    apply_expansion_facility_proxy,
)


def _contract() -> SemanticQueryContract:
    return SemanticQueryContract.from_model(
        {
            "query_goal": "find expanding industrial PMI",
            "seller": {"description": "sistemi antincendio industriali"},
            "offer": {"description": "sistemi antincendio industriali"},
            "target_entity_types": ["operating_company"],
            "target_company_description": "PMI industriali",
            "event_or_state_description": "nuovo stabilimento",
            "target_role_in_event": "expanding_company",
            "required_relationships": [EXPANSION_FACILITY_RELATIONSHIP],
            "optional_relationships": [],
            "excluded_roles": ["publisher", "advisor", "recruiter"],
            "excluded_entities": [],
            "geography": ["Nord Italia"],
            "industry": ["manifatturiero"],
            "size_constraints": {},
            "temporal_constraints": {"maximum_age_days": 365},
            "positive_conditions": [],
            "negative_conditions": [],
            "must_have_facts": [],
            "forbidden_inferences": [],
            "data_requirements": [],
            "ranking_objective": "freshest expansion",
            "acceptance_rubric": [
                "expanding_company_grounded",
                f"{EXPANSION_FACILITY_RELATIONSHIP}_grounded",
            ],
            "discovery_hypotheses": [],
            "clarification_required": False,
            "confidence": 0.9,
            "canonical_signal_hints": ["production_expansion"],
        },
        original_query="Installiamo sistemi antincendio. Trovami PMI con nuovo stabilimento.",
        requested_count=3,
    )


def test_expansion_proxy_sets_query_match_without_seller_offer_on_page() -> None:
    source = (
        "Modena, 1 marzo 2026 — Elettromeccanica Tironi Spa ha inaugurato il nuovo stabilimento "
        "logistico a Modena, ampliando la capacità produttiva del gruppo."
    )
    interpretation = SemanticEventInterpretation.from_model(
        {
            "entities": [],
            "events": [],
            "relations": [],
            "target_company": "Elettromeccanica Tironi Spa",
            "target_entity_role": "publisher",
            "event_type": "news",
            "open_predicate": "",
            "actor": None,
            "recipient": None,
            "provider": None,
            "beneficiary": None,
            "investor": None,
            "employer": None,
            "recruiter": None,
            "publisher": "News",
            "authority": None,
            "predicate": "",
            "direction": "",
            "event_status": "observed",
            "event_date": "2026-03-01",
            "amount": None,
            "location": "Modena",
            "technology": None,
            "role": None,
            "negated": False,
            "hypothetical": False,
            "conditional": False,
            "rumor": False,
            "historical": False,
            "certainty": 0.9,
            "query_match": False,
            "query_match_reason": "page does not mention antincendio",
            "satisfied_relationships": [],
            "acceptance_rubric_passed": [],
            "buyer_need": "",
            "why_now": "",
            "evidence_excerpt": "",
            "evidence_start": -1,
            "evidence_end": -1,
            "confidence": 0.9,
            "rejection_reason": "no seller offer on page",
        }
    )
    enriched = apply_expansion_facility_proxy(_contract(), interpretation, source_text=source)
    assert enriched.query_match is True
    assert enriched.target_entity_role == "expanding_company"
    assert EXPANSION_FACILITY_RELATIONSHIP in enriched.satisfied_relationships
    assert "antincendio" not in (enriched.evidence_excerpt or "").casefold()

    verdict = SemanticEvidenceGroundingVerifier().verify(
        _contract(),
        enriched,
        source_text=source,
        source_url="https://www.tironi.com/news/elettromeccanica-tironi-inaugura-il-nuovo-stabilimento-logistico-a-modena/",
        source_publisher="Tironi",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company="Elettromeccanica Tironi Spa",
        maximum_age_days=400,
        identity_verification_deferred=False,
    )
    assert verdict.accepted, (verdict.rejection_code, verdict.reasons, verdict.checks)


def test_expansion_proxy_does_not_promote_publisher_about_another_company() -> None:
    """Unindustria article about Purina plant must not qualify Unindustria as expanding PMI."""
    source = (
        "UNINDUSTRIA — investimento di 560 mln a Mantova per nuovo stabilimento Purina "
        "dedicato al petfood e polo logistico."
    )
    interpretation = SemanticEventInterpretation.from_model(
        {
            "entities": [],
            "events": [],
            "relations": [],
            "target_company": "Unindustria",
            "target_entity_role": "publisher",
            "event_type": "news",
            "open_predicate": "",
            "actor": None,
            "recipient": None,
            "provider": None,
            "beneficiary": None,
            "investor": None,
            "employer": None,
            "recruiter": None,
            "publisher": "UNINDUSTRIA",
            "authority": None,
            "predicate": "",
            "direction": "",
            "event_status": "observed",
            "event_date": "2026-07-22",
            "amount": None,
            "location": "Mantova",
            "technology": None,
            "role": None,
            "negated": False,
            "hypothetical": False,
            "conditional": False,
            "rumor": False,
            "historical": False,
            "certainty": 0.9,
            "query_match": False,
            "query_match_reason": "",
            "satisfied_relationships": [],
            "acceptance_rubric_passed": [],
            "buyer_need": "",
            "why_now": "",
            "evidence_excerpt": "",
            "evidence_start": -1,
            "evidence_end": -1,
            "confidence": 0.9,
            "rejection_reason": "",
        }
    )
    enriched = apply_expansion_facility_proxy(
        _contract(),
        interpretation,
        source_text=source,
        candidate_company="Unindustria",
    )
    assert EXPANSION_FACILITY_RELATIONSHIP not in enriched.satisfied_relationships
    assert enriched.target_entity_role == "publisher"

    verdict = SemanticEvidenceGroundingVerifier().verify(
        _contract(),
        enriched,
        source_text=source,
        source_url="https://www.un-industria.it/",
        source_publisher="UNINDUSTRIA",
        official_domain_verified=True,
        official_domain_confidence=0.9,
        entity_class="operating_company",
        candidate_company="Unindustria",
        maximum_age_days=400,
        identity_verification_deferred=False,
    )
    assert verdict.accepted is False
    assert verdict.rejection_code in {
        "HYPOTHESIS_COMPATIBILITY_FAILED",
        "TARGET_ROLE_UNVERIFIED",
        "COMPANY_GROUNDING_FAILED",
        "EVENT_GROUNDING_FAILED",
    }


def test_expansion_proxy_accepts_subject_company_after_facility_phrase() -> None:
    source = (
        "INAUGURATO IL NUOVO STABILIMENTO E-POWERTRAIN - TEXA apre a Monastier di Treviso "
        "il nuovo sito produttivo dedicato alla mobilità elettrica."
    )
    interpretation = SemanticEventInterpretation.from_model(
        {
            "entities": [],
            "events": [],
            "relations": [],
            "target_company": "TEXA",
            "target_entity_role": "expanding_company",
            "event_type": "production_expansion",
            "open_predicate": "",
            "actor": None,
            "recipient": None,
            "provider": None,
            "beneficiary": None,
            "investor": None,
            "employer": None,
            "recruiter": None,
            "publisher": None,
            "authority": None,
            "predicate": "",
            "direction": "",
            "event_status": "observed",
            "event_date": "2025-06-01",
            "amount": None,
            "location": "Treviso",
            "technology": None,
            "role": None,
            "negated": False,
            "hypothetical": False,
            "conditional": False,
            "rumor": False,
            "historical": False,
            "certainty": 0.9,
            "query_match": False,
            "query_match_reason": "",
            "satisfied_relationships": [],
            "acceptance_rubric_passed": [],
            "buyer_need": "",
            "why_now": "",
            "evidence_excerpt": "",
            "evidence_start": -1,
            "evidence_end": -1,
            "confidence": 0.9,
            "rejection_reason": "",
        }
    )
    enriched = apply_expansion_facility_proxy(
        _contract(),
        interpretation,
        source_text=source,
        candidate_company="TEXA",
    )
    assert EXPANSION_FACILITY_RELATIONSHIP in enriched.satisfied_relationships
    assert "texa" in (enriched.evidence_excerpt or "").casefold()
