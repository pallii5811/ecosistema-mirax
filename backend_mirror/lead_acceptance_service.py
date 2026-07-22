"""Backward-compatible shim — delegates to lead_acceptance package."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from lead_acceptance.models import EvaluationContext, OpportunityState
from lead_acceptance.publication import stamp_accepted_candidate
from lead_acceptance.service import LeadAcceptanceService

COMMERCIAL_EVENT_OPEN_DEMAND = OpportunityState.OPEN_DEMAND.value
COMMERCIAL_EVENT_SELECTION_IN_PROGRESS = OpportunityState.SELECTION_IN_PROGRESS.value
COMMERCIAL_EVENT_AWARDED_RECENTLY = OpportunityState.AWARDED_RECENTLY.value
COMMERCIAL_EVENT_IMPLEMENTATION_ACTIVE = OpportunityState.IMPLEMENTATION_ACTIVE.value
COMMERCIAL_EVENT_HISTORICAL_CASE_STUDY = OpportunityState.HISTORICAL_CASE_STUDY.value
COMMERCIAL_EVENT_INFERRED_FIT = OpportunityState.INFERRED_FIT.value

CRM_ACCEPTED_EVENT_STATES = {COMMERCIAL_EVENT_OPEN_DEMAND, COMMERCIAL_EVENT_SELECTION_IN_PROGRESS}
HIRING_ACCEPTED_EVENT_STATES = CRM_ACCEPTED_EVENT_STATES
FUNDING_ACCEPTED_EVENT_STATES = {COMMERCIAL_EVENT_OPEN_DEMAND, COMMERCIAL_EVENT_AWARDED_RECENTLY}


@dataclass(frozen=True)
class MarketScopePolicy:
    min_employees: int = 2
    max_employees: int = 249
    max_revenue_eur: int = 50_000_000
    enterprise_opt_in: bool = False
    require_verified_size: bool = False
    reject_listed: bool = True
    reject_global_brand: bool = True
    reject_public_majority_owned: bool = True


@dataclass
class LeadAcceptanceDecision:
    accepted: bool
    rejection_codes: List[str]
    company_identity: Dict[str, Any]
    official_domain: Optional[str]
    market_scope_status: str
    commercial_event_status: str
    query_fit: Dict[str, Any]
    target_role: Optional[str]
    intent_strength: str
    why_fit: Optional[str]
    why_now: Optional[str]
    evidence_status: Dict[str, Any]
    contactability_status: Dict[str, Any]
    confidence: float
    evaluated_at: str
    publication_gate: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def default_market_scope_policy(commercial_intent: Mapping[str, Any]) -> MarketScopePolicy:
    import re

    target = commercial_intent.get("target") if isinstance(commercial_intent.get("target"), dict) else {}
    raw_query = str(commercial_intent.get("raw_query") or "").lower()
    enterprise_opt_in = bool(
        re.search(r"\b(enterprise|multinazional|grande\s+gruppo|quotat[oa]|fortune)\b", raw_query)
        or "enterprise" in {str(v).lower() for v in target.get("company_sizes") or []}
    )
    return MarketScopePolicy(enterprise_opt_in=enterprise_opt_in)


def _adapt_decision(decision) -> LeadAcceptanceDecision:
    gate = decision.publication_gate or {}
    entity = gate.get("entity_classification") or {}
    contact = decision.candidate_payload.get("contatti") if isinstance(decision.candidate_payload.get("contatti"), dict) else {}
    phones = (
        contact.get("telefoni") or contact.get("phones")
        or decision.candidate_payload.get("telefono") or decision.candidate_payload.get("phone") or []
    )
    emails = (
        contact.get("email") or contact.get("emails")
        or decision.candidate_payload.get("email") or decision.candidate_payload.get("mail") or []
    )

    market_scope_status = decision.market_scope_status.value

    return LeadAcceptanceDecision(
        accepted=decision.accepted,
        rejection_codes=list(decision.rejection_codes),
        company_identity={
            "legal_name": gate.get("entity_resolution", {}).get("legal_name")
            or decision.candidate_payload.get("azienda")
            or decision.candidate_payload.get("name"),
            "official_domain": decision.official_domain,
            "entity_classification": entity,
            "resolution_method": gate.get("entity_resolution", {}).get("resolution_method"),
        },
        official_domain=decision.official_domain,
        market_scope_status=market_scope_status,
        commercial_event_status=decision.opportunity_state.value,
        query_fit={
            "buyer_fit_verified": gate.get("buyer_fit_verified"),
            "signal_verified": gate.get("relevant_buying_signal_present"),
            "semantic_authority_passed": gate.get("semantic_authority_passed"),
            "target_role": decision.target_role,
        },
        target_role=decision.target_role,
        intent_strength=decision.intent_strength,
        why_fit=decision.why_fit or None,
        why_now=decision.why_now or None,
        evidence_status={
            "evidence_supports_signal": gate.get("evidence_supports_signal"),
            "source_url_verified": gate.get("source_url_verified"),
            "freshness_pass": gate.get("freshness_pass"),
            "records": gate.get("evidence") or [],
        },
        contactability_status={
            "phones_available": bool(phones),
            "emails_available": bool(emails),
            "contact_extracted": bool(phones or emails),
        },
        confidence=decision.confidence,
        evaluated_at=decision.evaluated_at,
        publication_gate=gate,
    )


_service = LeadAcceptanceService()


def evaluate_lead(
    candidate: Mapping[str, Any],
    commercial_intent: Mapping[str, Any],
    *,
    market_scope_policy: Optional[MarketScopePolicy] = None,
    evidence_policy: Optional[Mapping[str, Any]] = None,
    cost_within_budget: bool = True,
) -> LeadAcceptanceDecision:
    _ = market_scope_policy, evidence_policy
    decision = _service.evaluate(
        candidate,
        commercial_intent,
        EvaluationContext(cost_within_budget=cost_within_budget, require_contact=False),
    )
    return _adapt_decision(decision)


def filter_accepted_candidates(
    candidates: Sequence[Mapping[str, Any]],
    commercial_intent: Mapping[str, Any],
    *,
    market_scope_policy: Optional[MarketScopePolicy] = None,
    cost_within_budget: bool = True,
) -> List[Dict[str, Any]]:
    accepted: List[Dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        decision = evaluate_lead(
            candidate,
            commercial_intent,
            market_scope_policy=market_scope_policy,
            cost_within_budget=cost_within_budget,
        )
        if decision.accepted:
            accepted.append(stamp_accepted_candidate(candidate, _service.evaluate(
                candidate, commercial_intent, EvaluationContext(cost_within_budget=cost_within_budget, require_contact=False)
            )))
    return accepted
