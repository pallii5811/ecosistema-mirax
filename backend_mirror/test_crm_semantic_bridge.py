"""Fail-closed CRM seeking detectors + grounding bridge smoke checks."""

from __future__ import annotations

from datetime import date

from backend_mirror.semantic_intelligence import (
    CRM_SEEKING_RELATIONSHIP,
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
)
from backend_mirror.source_adapters.crm_semantic_bridge import (
    find_crm_seeking_evidence,
    looks_crm_guide,
)


def _crm_contract() -> SemanticQueryContract:
    return SemanticQueryContract.from_model(
        {
            "query_goal": "Aziende che cercano un CRM",
            "seller": {"description": "CRM"},
            "offer": {"description": "CRM"},
            "target_entity_types": ["operating_company"],
            "target_company_description": "buyer",
            "event_or_state_description": "azienda cerca o adotta CRM",
            "target_role_in_event": "buyer",
            "required_relationships": [CRM_SEEKING_RELATIONSHIP],
            "optional_relationships": [],
            "excluded_roles": ["publisher"],
            "excluded_entities": [],
            "geography": ["Italia"],
            "industry": [],
            "size_constraints": {},
            "temporal_constraints": {"maximum_age_days": 180},
            "positive_conditions": ["adotta CRM"],
            "negative_conditions": ["guida"],
            "must_have_facts": [],
            "forbidden_inferences": [],
            "data_requirements": [],
            "ranking_objective": "fresh",
            "acceptance_rubric": ["buyer_grounded", f"{CRM_SEEKING_RELATIONSHIP}_grounded"],
            "discovery_hypotheses": [],
            "clarification_required": False,
            "confidence": 0.9,
            "canonical_signal_hints": ["technology_adoption"],
        },
        original_query="Trovami aziende che stanno cercando un nuovo CRM.",
        requested_count=2,
    )


def test_find_crm_seeking_adoption_span() -> None:
    text = "Nel 2025 Tec Med adotta la piattaforma CRM Veeva per la rete commerciale."
    excerpt, start, end = find_crm_seeking_evidence(text)
    assert excerpt and start >= 0 and text[start:end] == excerpt
    assert "crm" in excerpt.casefold()


def test_guide_rejected() -> None:
    text = "Come si sceglie un CRM: guida completa per le PMI italiane."
    assert looks_crm_guide(text)
    excerpt, start, _ = find_crm_seeking_evidence(text)
    assert excerpt is None and start < 0


def test_crm_bridge_forces_seeking_and_query_match() -> None:
    text = (
        "Autoguidovie Spa sceglie la piattaforma CRM Dynamics per digitalizzare "
        "il processo commerciale. Pubblicato il 12 marzo 2025."
    )
    excerpt, start, end = find_crm_seeking_evidence(text)
    assert excerpt and start >= 0
    interpretation = SemanticEventInterpretation.from_model(
        {
            "entities": [{"name": "Autoguidovie Spa", "type": "operating_company", "role": "buyer"}],
            "events": [{"type": "technology_adoption", "status": "observed"}],
            "relations": [],
            "target_company": "Autoguidovie Spa",
            "target_entity_role": "buyer",
            "event_type": "technology_adoption",
            "open_predicate": "adopts CRM",
            "actor": "Autoguidovie Spa",
            "recipient": None,
            "provider": None,
            "beneficiary": None,
            "investor": None,
            "employer": None,
            "recruiter": None,
            "publisher": "news",
            "authority": None,
            "predicate": "adopts",
            "direction": "buyer_to_platform",
            "event_status": "observed",
            "event_date": "2025-03-12",
            "amount": None,
            "location": "Italia",
            "technology": "CRM",
            "role": None,
            "negated": False,
            "hypothetical": False,
            "conditional": False,
            "rumor": False,
            "historical": False,
            "certainty": 0.85,
            "query_match": False,
            "query_match_reason": "cercando vs sceglie",
            "satisfied_relationships": [],
            "acceptance_rubric_passed": ["buyer_grounded"],
            "buyer_need": "CRM",
            "why_now": "adoption",
            "evidence_excerpt": excerpt,
            "evidence_start": start,
            "evidence_end": end,
            "confidence": 0.85,
            "rejection_reason": None,
        }
    )
    verdict = SemanticEvidenceGroundingVerifier().verify(
        _crm_contract(),
        interpretation,
        source_text=text,
        source_url="https://news.example.it/autoguidovie-crm",
        source_publisher="Example News",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company="Autoguidovie Spa",
        maximum_age_days=180,
        now=date(2025, 6, 1),
        structured_metadata={"published_at": "2025-03-12"},
    )
    assert verdict.accepted, (verdict.rejection_code, verdict.reasons, verdict.checks)
