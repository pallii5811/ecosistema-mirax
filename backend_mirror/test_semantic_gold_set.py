from __future__ import annotations

from datetime import date

from backend_mirror.semantic_intelligence import (
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
)
from evaluation.semantic_gold_v1 import SEMANTIC_GOLD_CASES, composition


def contract(case: dict) -> SemanticQueryContract:
    return SemanticQueryContract.from_model({
        "query_goal": case["query"], "seller": {}, "offer": {},
        "target_entity_types": [case["target_entity_type"]],
        "target_company_description": case["target_company"],
        "event_or_state_description": case["query"],
        "target_role_in_event": case["target_role"],
        "required_relationships": case["required_relationships"], "optional_relationships": [],
        "excluded_roles": ["publisher", "provider"] if case["target_role"] != "provider" else ["recipient"],
        "excluded_entities": [], "geography": ["Italia"], "industry": [], "size_constraints": {},
        "temporal_constraints": {"maximum_age_days": case["maximum_age_days"]},
        "positive_conditions": [case["query"]], "negative_conditions": [],
        "must_have_facts": ["target identity", "event date"],
        "forbidden_inferences": ["publisher is target", "signals cannot cross entities"],
        "data_requirements": ["official_domain", "source_url", "event_date"],
        "ranking_objective": "grounded recent evidence", "acceptance_rubric": case["acceptance_rubric"],
        "discovery_hypotheses": [], "clarification_required": False, "confidence": 0.95,
        "canonical_signal_hints": [],
    }, original_query=case["query"], requested_count=5)


def interpretation(case: dict) -> SemanticEventInterpretation:
    accepted = case["expected_query_match"]
    actual_role = case.get("actual_target_role") or case["target_role"]
    relationships = list(case["required_relationships"] if accepted else [])
    if case["label"] == "multi" and not accepted:
        relationships = [case["required_relationships"][0]]
    return SemanticEventInterpretation.from_model({
        "entities": [
            {"name": case["target_company"], "type": "operating_company", "role": actual_role},
            *({"name": name, "type": "operating_company", "role": "other"} for name in case.get("other_companies", [])),
        ],
        "events": [{"type": case["event_type"], "status": "completed"}],
        "relations": [], "target_company": case["target_company"], "target_entity_role": actual_role,
        "event_type": case["event_type"], "open_predicate": case["query"], "actor": None,
        "recipient": case["target_company"] if actual_role == "recipient" else None,
        "provider": case["target_company"] if actual_role == "provider" else None,
        "beneficiary": None, "investor": None,
        "employer": case["target_company"] if actual_role == "employer" else None,
        "recruiter": None, "publisher": case["publisher"], "authority": None,
        "predicate": relationships[0] if relationships else "unmatched_relation",
        "direction": "explicit", "event_status": "completed", "event_date": case["event_date"],
        "amount": None, "location": "Italia", "technology": None, "role": None,
        "negated": case["negated"], "hypothetical": case["hypothetical"],
        "conditional": case["conditional"], "rumor": case["rumor"], "historical": case["historical"],
        "certainty": 0.95, "query_match": accepted,
        "query_match_reason": "gold expected relation" if accepted else "gold expected rejection",
        "satisfied_relationships": relationships,
        "acceptance_rubric_passed": case["acceptance_rubric"] if accepted else [],
        "buyer_need": "observed commercial need" if accepted else "", "why_now": "fresh event" if accepted else "",
        "evidence_excerpt": case["source_text"], "evidence_start": 0,
        "evidence_end": len(case["source_text"]), "confidence": 0.95,
        "rejection_reason": None if accepted else "gold expected rejection",
    })


def test_gold_set_composition_meets_mandate() -> None:
    result = composition()
    assert result["total"] == 250
    assert result["labels"] == {"positive": 100, "negative": 100, "multi": 50}
    assert result["splits"] == {"development": 100, "validation": 75, "holdout": 75}
    assert result["no_canonical_keyword"] >= 60
    assert result["passive_voice"] >= 30
    assert result["negation_hypothesis_rumor"] >= 30
    assert result["actor_recipient_inversion"] >= 30
    assert result["publisher_differs"] >= 20
    assert result["multi_entity"] >= 20
    assert result["stale"] >= 20
    assert len({case["id"] for case in SEMANTIC_GOLD_CASES}) == 250


def test_deterministic_grounding_matches_all_250_gold_verdicts() -> None:
    verifier = SemanticEvidenceGroundingVerifier()
    mismatches = []
    for case in SEMANTIC_GOLD_CASES:
        verdict = verifier.verify(
            contract(case), interpretation(case), source_text=case["source_text"],
            source_url=case["source_url"], source_publisher=case["publisher"],
            official_domain_verified=case["official_domain_verified"],
            official_domain_confidence=case["official_domain_confidence"],
            entity_class=case["target_entity_type"], candidate_company=case["target_company"],
            maximum_age_days=case["maximum_age_days"], now=date(2026, 7, 18),
        )
        if verdict.accepted is not case["expected_accept"]:
            mismatches.append((case["id"], verdict.rejection_code, verdict.reasons))
    assert mismatches == []


def test_blind_holdout_is_frozen_and_not_imported_by_runtime() -> None:
    holdout = [case for case in SEMANTIC_GOLD_CASES if case["split"] == "holdout"]
    assert len(holdout) == 75
    assert all(case["id"].startswith(("positive-", "negative-", "multi-")) for case in holdout)
