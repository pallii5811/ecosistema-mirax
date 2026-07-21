"""Offer-to-Buyer-Need planner — profession-agnostic verifiable hypotheses."""
from __future__ import annotations

import re
from typing import Any, Dict, List

from contracts.commercial_intent import CommercialHypothesis, ensure_market_scope_policy


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
        events = [item for item in intent.get("observable_events") or [] if isinstance(item, dict)]
        signals = list(dict.fromkeys([
            *[str(item) for item in intent.get("direct_demand_signals") or [] if str(item)],
            *[str(item) for item in intent.get("inferred_fit_signals") or [] if str(item)],
            *[
                str(signal)
                for event in events
                for signal in event.get("signals") or []
                if str(signal)
            ],
        ]))
        relationships = [str(item) for item in intent.get("required_relationships") or [] if str(item)]
        # No evidence-bearing event/relation means no hypothesis.  Returning an
        # empty plan is safer than inventing unrelated generic plays.
        if not events and not signals and not relationships:
            return []
        sources = list(
            (intent.get("source_requirements") or {}).get("allowed_source_classes")
            or ["official_company_website", "recognized_news"]
        )
        seeds = events or [{
            "id": signals[0] if signals else relationships[0],
            "description": intent.get("buyer_need") or problems[0],
            "signals": signals,
        }]
        for index, event in enumerate(seeds[:6]):
            event_signals = [str(item) for item in event.get("signals") or signals if str(item)]
            relationship = relationships[min(index, len(relationships) - 1)] if relationships else (
                f"company_has_{event_signals[0]}" if event_signals else "company_has_observed_event"
            )
            event_description = str(event.get("description") or event.get("id") or relationship)
            problem = problems[index % len(problems)]
            hypothesis_id = f"hyp-{_slug(str(event.get('id') or relationship))}-{index + 1}"
            hypotheses.append(
                CommercialHypothesis(
                    id=hypothesis_id,
                    hypothesis_id=hypothesis_id,
                    buyer_archetype=str(intent.get("buyer_need") or "target operating company"),
                    target_company_profile={
                        **base_profile,
                        "required_attributes": [
                            *(base_profile.get("required_attributes") or []),
                            problem,
                        ],
                    },
                    target_role=str(intent.get("target_role") or "commercial decision maker"),
                    buyer_problem=problem,
                    expected_outcome=str(offer),
                    observable_event=event_description,
                    observable_event_types=event_signals or [str(event.get("id") or relationship)],
                    required_relationship=relationship,
                    required_relationships=[relationship],
                    allowed_signal_families=event_signals,
                    excluded_signal_families=[str(item) for item in intent.get("excluded_signals") or []],
                    sources=sources,
                    source_classes=sources,
                    evidence_claim_type="DIRECT_DEMAND" if is_explicit else "OBSERVED_EVENT",
                    query_templates=[event_description],
                    false_positive_risks=[
                        "publisher or intermediary selected as target",
                        "commercial inference presented as explicit demand",
                    ],
                    expected_yield="high" if is_explicit else "medium",
                    expected_cost="low",
                    intent_strength=strength,
                )
            )
        return hypotheses
