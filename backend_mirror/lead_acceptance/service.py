"""Unified lead acceptance service."""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from commercial_lifecycle import positive_entity_classification

from .contactability import evaluate_contactability
from .evidence import evaluate_evidence
from .identity import evaluate_identity
from .market_scope import resolve_market_scope
from .models import (
    EvaluationContext,
    GateResult,
    LeadAcceptanceDecision,
    MarketScopeStatus,
    OpportunityState,
    iso_now,
)
from .opportunity_state import accepted_states_for_intent, classify_opportunity, opportunity_accepted
from .query_fit import evaluate_query_fit

_PUBLISHER_ROLES = {
    "publisher", "recruiter", "investor", "lender", "funder", "vendor",
    "seller", "provider", "job_board", "directory", "advisor", "authority",
}

def _map_market_rejection(reasons: List[str]) -> List[str]:
    mapped: List[str] = []
    for reason in reasons:
        if reason == "GLOBAL_ENTERPRISE":
            mapped.append("GLOBAL_ENTERPRISE")
        elif reason == "SIZE_UNVERIFIED":
            mapped.append("SIZE_UNVERIFIED")
        elif reason in {
            "STATE_CONTROLLED_OPERATOR", "EMPLOYEES_ABOVE_MAXIMUM", "EMPLOYEES_BELOW_MINIMUM",
            "REVENUE_ABOVE_MAXIMUM", "SIZE_CLASS_OUT_OF_SCOPE", "PUBLIC_COMPANY",
            "LARGE_CORPORATE_GROUP", "NON_OPERATING_ENTITY", "EMPLOYEES_ENTERPRISE_SCALE",
            "REVENUE_ENTERPRISE_SCALE", "SIZE_CLASS_ENTERPRISE",
        }:
            mapped.append("COMPANY_OUT_OF_MARKET_SCOPE")
        elif reason in {
            "MARKET_SCOPE_AMBIGUOUS", "EMPLOYEE_COUNT_CORPORATE_BOUNDARY",
            "REVENUE_CORPORATE_BOUNDARY", "SIZE_CLASS_LARGE_UNRESOLVED",
            "PARENT_GROUP_UNRESOLVED", "CORPORATE_SIGNALS_CONTRADICTORY",
            "COMPANY_NAME_REQUIRED_FOR_LIKELY_SME", "OFFICIAL_DOMAIN_REQUIRED_FOR_LIKELY_SME",
            "PUBLIC_CONTACT_REQUIRED_FOR_LIKELY_SME",
        }:
            mapped.append("AMBIGUOUS_CORPORATE")
        else:
            mapped.append(reason)
    return list(dict.fromkeys(mapped))


def _intent_strength(state: OpportunityState, semantic: Mapping[str, Any]) -> str:
    if state in {OpportunityState.OPEN_DEMAND, OpportunityState.SELECTION_IN_PROGRESS}:
        return "direct"
    if state == OpportunityState.INFERRED_FIT:
        return "strong_inferred"
    if float(semantic.get("confidence") or 0) >= 0.8:
        return "strong_inferred"
    return "moderate_inferred"


class LeadAcceptanceService:
    def evaluate(
        self,
        candidate: Mapping[str, Any],
        intent: Mapping[str, Any],
        context: Optional[EvaluationContext] = None,
    ) -> LeadAcceptanceDecision:
        ctx = context or EvaluationContext()
        query_fit, publication_gate = evaluate_query_fit(
            candidate, intent, cost_within_budget=ctx.cost_within_budget
        )
        rejection_codes = list(publication_gate.get("rejection_codes") or [])
        if not query_fit.passed:
            rejection_codes.extend(r for r in query_fit.reasons if r not in rejection_codes)

        identity_gate, domain, ownership, parent = evaluate_identity(candidate, intent, publication_gate)
        if not identity_gate.passed:
            rejection_codes.extend(identity_gate.reasons)

        market_status, market_gate, employees, revenue = resolve_market_scope(candidate, intent)
        if not market_gate.passed:
            rejection_codes.extend(_map_market_rejection(market_gate.reasons))

        opportunity_detail = classify_opportunity(candidate, intent)
        opportunity_state = opportunity_detail.state
        if not opportunity_accepted(opportunity_state, intent):
            rejection_codes.append("CLOSED_COMMERCIAL_OPPORTUNITY")

        evidence_gate = evaluate_evidence(candidate, publication_gate)
        if not evidence_gate.passed and not publication_gate.get("publishable"):
            rejection_codes.extend(evidence_gate.reasons)

        contact_gate, _contact_status, decision_role = evaluate_contactability(
            candidate, intent, require_contact=ctx.require_contact
        )
        if not contact_gate.passed:
            rejection_codes.extend(contact_gate.reasons)

        semantic = candidate.get("semantic_grounding")
        if not isinstance(semantic, dict):
            report = candidate.get("technical_report")
            semantic = report.get("semantic_grounding") if isinstance(report, dict) else {}
        if not isinstance(semantic, dict):
            semantic = {}

        contract = intent.get("semantic_query_contract")
        target_role = None
        if isinstance(contract, dict):
            target_role = str(contract.get("target_role_in_event") or "").strip() or None
        if not target_role:
            target_role = str(semantic.get("target_entity_role") or semantic.get("target_role") or "").strip() or None

        role = str(target_role or "").lower()
        if role in _PUBLISHER_ROLES:
            rejection_codes.append("ACTOR_DIRECTION_INVERSION")

        entity = publication_gate.get("entity_classification") or positive_entity_classification(
            dict(candidate), dict(intent), bool(publication_gate.get("official_domain_verified"))
        )
        if entity.get("is_recruiter") or entity.get("is_source_publisher"):
            rejection_codes.append("ACTOR_DIRECTION_INVERSION")
        if entity.get("is_media") or entity.get("is_directory"):
            rejection_codes.append("COMPANY_OUT_OF_MARKET_SCOPE")

        mandatory_gates = [identity_gate, market_gate, evidence_gate, contact_gate]
        market_ok = market_gate.passed
        opportunity_ok = opportunity_accepted(opportunity_state, intent)

        rejection_codes = list(dict.fromkeys(code for code in rejection_codes if code))
        accepted = bool(publication_gate.get("publishable")) and market_ok and opportunity_ok and not rejection_codes

        why_fit = str(candidate.get("why_fit") or candidate.get("intent_summary") or "").strip()
        why_now = str(candidate.get("why_now") or opportunity_detail.excerpt or "").strip()

        raw_conf = semantic.get("confidence")
        if raw_conf is not None:
            confidence = float(raw_conf)
        else:
            score = float(publication_gate.get("buyer_fit_score") or 0)
            confidence = score / 100.0 if score > 1 else score

        gate_confidences = [g.confidence for g in mandatory_gates if g.confidence]
        if gate_confidences:
            confidence = min(confidence, sum(gate_confidences) / len(gate_confidences))

        return LeadAcceptanceDecision(
            accepted=accepted,
            rejection_codes=rejection_codes,
            query_fit=query_fit,
            market_scope=market_gate,
            market_scope_status=market_status,
            opportunity_state=opportunity_state,
            opportunity_detail=opportunity_detail,
            evidence_gate=evidence_gate,
            identity_gate=identity_gate,
            contactability_gate=contact_gate,
            official_domain=domain,
            employee_estimate=employees,
            revenue_estimate_eur=revenue,
            ownership_status=ownership,
            parent_group=parent,
            target_role=target_role,
            decision_maker_role=decision_role,
            intent_strength=_intent_strength(opportunity_state, semantic),
            why_fit=why_fit,
            why_now=why_now,
            confidence=confidence,
            evaluated_at=iso_now(),
            candidate_payload=dict(candidate),
            publication_gate=publication_gate,
        )
