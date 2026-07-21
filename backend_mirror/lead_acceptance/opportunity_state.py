"""Commercial opportunity state classification."""
from __future__ import annotations

import re
from typing import Any, Mapping, Set

from .models import OpportunityClassification, OpportunityState

_PUBLISHER_ROLES = {
    "publisher", "recruiter", "investor", "lender", "vendor", "seller",
    "provider", "job_board", "directory", "advisor", "authority",
}

CRM_ACCEPTED = {OpportunityState.OPEN_DEMAND, OpportunityState.SELECTION_IN_PROGRESS}
HIRING_ACCEPTED = {OpportunityState.OPEN_DEMAND, OpportunityState.SELECTION_IN_PROGRESS}
FUNDING_ACCEPTED = {OpportunityState.OPEN_DEMAND, OpportunityState.AWARDED_RECENTLY}
SELLER_ACCEPTED = {
    OpportunityState.INFERRED_FIT,
    OpportunityState.OPEN_DEMAND,
    OpportunityState.SELECTION_IN_PROGRESS,
}


def accepted_states_for_intent(intent: Mapping[str, Any]) -> Set[OpportunityState]:
    query = str(intent.get("raw_query") or intent.get("original_query") or "").lower()
    contract = intent.get("semantic_query_contract")
    rel_blob = ""
    if isinstance(contract, dict):
        rel_blob = " ".join(str(r) for r in contract.get("required_relationships") or []).lower()
    required = {str(v).lower() for v in (intent.get("signal_policy") or {}).get("required_signals") or []}
    if "crm" in query or "crm" in rel_blob:
        return set(CRM_ACCEPTED)
    if any(s.startswith("hiring") for s in required) or "hiring" in rel_blob:
        return set(HIRING_ACCEPTED)
    if any(k in query for k in ("funding", "finanz", "round")) or "funding" in required:
        return set(FUNDING_ACCEPTED)
    seller = intent.get("seller_profile") or intent.get("seller")
    if isinstance(seller, dict) and (seller.get("offer_description") or seller.get("products_or_services")):
        return set(SELLER_ACCEPTED)
    return set(SELLER_ACCEPTED) | {OpportunityState.AWARDED_RECENTLY}


def classify_opportunity(
    candidate: Mapping[str, Any],
    intent: Mapping[str, Any],
) -> OpportunityClassification:
    semantic = candidate.get("semantic_grounding")
    if not isinstance(semantic, dict):
        report = candidate.get("technical_report")
        semantic = report.get("semantic_grounding") if isinstance(report, dict) else {}
    if not isinstance(semantic, dict):
        semantic = {}

    blob = " ".join(
        str(candidate.get(k) or "")
        for k in ("evidence", "why_now", "hiring_title", "semantic_summary", "intent_summary")
    )
    excerpt = str(candidate.get("evidence") or blob[:500]).strip()
    source_url = str(candidate.get("source_url") or "").strip() or None
    event_date = str(candidate.get("evidence_date") or candidate.get("last_audited_at") or "").strip() or None

    negated = bool(semantic.get("negated"))
    hypothetical = bool(semantic.get("hypothetical") or semantic.get("conditional"))
    completed = bool(semantic.get("historical") or semantic.get("event_status") in {"stale", "completed", "historical"})

    subject = str(candidate.get("azienda") or candidate.get("legal_name") or candidate.get("name") or "").strip() or None
    provider = None
    provider_match = re.search(r"\b(?:sceglie|affida|seleziona|choose[sd]?)\s+([A-Z][A-Za-z0-9.&\-\s]{2,40})", blob, re.I)
    if provider_match:
        provider = provider_match.group(1).strip()

    state = OpportunityState.UNKNOWN
    if negated or hypothetical or completed:
        state = OpportunityState.HISTORICAL_CASE_STUDY
    elif re.search(r"\bimplementat\w*\b", blob, re.I) and re.search(r"\b(crm|salesforce|hubspot|gestionale)\b", blob, re.I):
        state = OpportunityState.IMPLEMENTATION_ACTIVE
    elif re.search(r"\b(gi[aà]\s+implementat|in\s+produzione|rollout\s+completat|already\s+using)\b", blob, re.I):
        state = OpportunityState.IMPLEMENTATION_ACTIVE
    elif re.search(r"\b(aggiudicat|awarded|vinto\s+la\s+gara|sceglie|affida\s+a)\b", blob, re.I):
        state = OpportunityState.AWARDED_RECENTLY
    elif re.search(r"\b(selezione|valutando|in\s+cerca\s+di|seeking|rfp|bando)\b", blob, re.I):
        state = OpportunityState.SELECTION_IN_PROGRESS
    elif re.search(r"\b(cercano|assumono|hiring|open\s+role|raccogliendo|raising)\b", blob, re.I):
        state = OpportunityState.OPEN_DEMAND
    else:
        matched = {str(v).lower() for v in candidate.get("matched_signals") or []}
        if matched:
            state = OpportunityState.OPEN_DEMAND
        else:
            seller = intent.get("seller_profile") or intent.get("seller")
            if isinstance(seller, dict) and seller.get("offer_description"):
                state = OpportunityState.INFERRED_FIT
            else:
                state = OpportunityState.UNKNOWN

    role = str(semantic.get("target_entity_role") or semantic.get("target_role") or "").lower()
    if role in _PUBLISHER_ROLES:
        state = OpportunityState.HISTORICAL_CASE_STUDY

    confidence = float(semantic.get("confidence") or 0.7)
    return OpportunityClassification(
        state=state,
        subject_company=subject,
        provider_company=provider,
        predicate="commercial_event",
        object=str(intent.get("buyer_need") or intent.get("normalized_goal") or "")[:200] or None,
        event_date=event_date,
        excerpt=excerpt[:2000] if excerpt else None,
        source_url=source_url,
        confidence=confidence,
        negated=negated,
        hypothetical=hypothetical,
        completed=completed,
    )


def opportunity_accepted(state: OpportunityState, intent: Mapping[str, Any]) -> bool:
    return state in accepted_states_for_intent(intent)
