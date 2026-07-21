"""Offer-to-Buyer-Need planner — profession-agnostic verifiable hypotheses."""
from __future__ import annotations

import re
from typing import Any, Dict, List

from contracts.commercial_intent import CommercialHypothesis, ensure_market_scope_policy


GENERIC_WHY_NOW = [
    {
        "event": "new facility or production site opening",
        "problem": "capital project triggers compliance, equipment and vendor selection",
        "relationship": "company_opening_or_expanding_facility",
        "sources": ["official_company_website", "recognized_local_news", "public_registry"],
        "risks": ["real-estate listing as buyer", "construction vendor as target"],
    },
    {
        "event": "public tender or regulatory compliance deadline",
        "problem": "mandated upgrade or certification window creates time-bound demand",
        "relationship": "company_subject_to_public_or_regulatory_requirement",
        "sources": ["public_procurement_portal", "official_company_website"],
        "risks": ["contracting authority as buyer", "advisor blog as evidence"],
    },
    {
        "event": "operational pain or downtime disclosed publicly",
        "problem": "observable performance gap aligned with seller outcome",
        "relationship": "company_experiencing_operational_gap",
        "sources": ["official_company_website", "industry_publication"],
        "risks": ["generic thought leadership", "hypothetical future need"],
    },
    {
        "event": "leadership or ownership transition",
        "problem": "new decision makers re-evaluate suppliers and processes",
        "relationship": "company_under_management_or_ownership_change",
        "sources": ["official_company_website", "public_registry", "recognized_local_news"],
        "risks": ["registry page without operating company", "advisor as target"],
    },
    {
        "event": "hiring for roles tied to the seller outcome",
        "problem": "workforce investment signals budget and priority for the problem space",
        "relationship": "employer_investing_in_relevant_capability",
        "sources": ["official_company_website", "verified_job_posting"],
        "risks": ["recruiter or job board as employer", "stale vacancy"],
    },
    {
        "event": "supplier change or contract end",
        "problem": "incumbent displacement creates replacement demand",
        "relationship": "company_ending_incumbent_supplier_relationship",
        "sources": ["official_company_website", "recognized_local_news"],
        "risks": ["former supplier page as buyer", "rumor without evidence"],
    },
]


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "hypothesis"


class OfferToBuyerNeedPlanner:
    def plan(self, intent: Dict[str, Any]) -> List[CommercialHypothesis]:
        offer = (
            (intent.get("seller_offer") or {}).get("description")
            or (intent.get("seller_profile") or {}).get("offer_description")
            or intent.get("problem_solved")
            or "commercial offer"
        )
        problems = list((intent.get("seller_profile") or {}).get("problems_solved") or [])
        if not problems and intent.get("problem_solved"):
            problems = [str(intent["problem_solved"])]
        if not problems:
            problems = [f"Operational gap addressable by {offer}"]

        base_profile = ensure_market_scope_policy(intent.get("target_company_profile"))
        is_explicit = intent.get("request_mode") == "explicit_demand"
        strength = "direct" if is_explicit else "strong_inferred"
        hypotheses: List[CommercialHypothesis] = []

        for index, template in enumerate(GENERIC_WHY_NOW):
            if len(hypotheses) >= 6:
                break
            problem = problems[index % len(problems)]
            hypotheses.append(
                CommercialHypothesis(
                    id=f"hyp-{_slug(template['relationship'])}-{index + 1}",
                    target_company_profile={
                        **base_profile,
                        "required_attributes": [
                            *(base_profile.get("required_attributes") or []),
                            problem,
                        ],
                    },
                    target_role=str(intent.get("target_role") or "commercial decision maker"),
                    buyer_problem=problem,
                    observable_event=template["event"],
                    required_relationship=template["relationship"],
                    sources=list(template["sources"]),
                    false_positive_risks=list(template["risks"]),
                    expected_yield="high" if index < 2 else "medium",
                    expected_cost="low" if index < 3 else "medium",
                    intent_strength=strength,
                )
            )
        return hypotheses
