"""Single authorized publication path for accepted leads."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from commercial_lifecycle import canonical_domain, evaluate_publication_gate

from .models import EvaluationContext, LeadAcceptanceDecision, PublicationResult
from .service import LeadAcceptanceService


def stamp_accepted_candidate(
    candidate: Dict[str, Any],
    decision: LeadAcceptanceDecision,
) -> Dict[str, Any]:
    stamped = dict(candidate)
    stamped["_lead_acceptance"] = decision.to_dict()
    stamped["_lead_acceptance_authority"] = "LeadAcceptanceService"
    stamped["market_scope_status"] = decision.market_scope_status.value
    return stamped


def _budget_allows(supabase: Any, search_id: str) -> bool:
    from commercial_lifecycle import _execute_data

    budget_rows = _execute_data(
        supabase.table("search_budget_state")
        .select("hard_cost_eur,committed_cost_eur,status")
        .eq("search_id", search_id)
        .limit(1)
        .execute()
    )
    budget = budget_rows[0] if budget_rows else {}
    try:
        return bool(
            budget
            and float(budget.get("committed_cost_eur") or 0) <= float(budget.get("hard_cost_eur") or -1)
            and str(budget.get("status") or "").lower() not in {"halted", "failed"}
        )
    except (TypeError, ValueError):
        return False


def publish_accepted_leads(
    search_id: str,
    decisions: Sequence[LeadAcceptanceDecision],
    requested_count: int,
    *,
    supabase: Any = None,
    user_id: Optional[str] = None,
    canonical_plan: Optional[Dict[str, Any]] = None,
    shadow_mode: bool = False,
    cost_within_budget: bool = True,
) -> PublicationResult:
    """Publish only accepted=True leads up to requested_count unique domains."""
    accepted = [d for d in decisions if d.accepted]
    seen: set[str] = set()
    unique: List[LeadAcceptanceDecision] = []
    rejection_audit: List[Dict[str, Any]] = []

    for decision in accepted:
        domain = canonical_domain(decision.official_domain)
        if not domain or domain in seen:
            rejection_audit.append({
                "official_domain": decision.official_domain,
                "rejection_codes": ["DUPLICATE_DOMAIN"],
                "accepted": False,
            })
            continue
        seen.add(domain)
        unique.append(decision)
        if len(unique) >= max(0, int(requested_count)):
            break

    for decision in decisions:
        if not decision.accepted:
            rejection_audit.append({
                "official_domain": decision.official_domain,
                "rejection_codes": decision.rejection_codes,
                "accepted": False,
            })

    published_leads: List[Dict[str, Any]] = []
    if supabase is not None and canonical_plan is not None and (user_id or shadow_mode):
        from commercial_lifecycle import _persist_gated_lead

        for decision in unique:
            lead = decision.candidate_payload
            gate = evaluate_publication_gate(lead, canonical_plan, cost_within_budget=cost_within_budget)
            gate["publishable"] = decision.accepted
            gate["lead_acceptance"] = decision.to_dict()
            stamped = _persist_gated_lead(
                supabase,
                search_id=search_id,
                user_id=user_id,
                lead=lead,
                gate=gate,
                shadow_mode=shadow_mode,
            )
            if stamped:
                published_leads.append(stamped)

    stop_reason = "COMPLETED_REQUESTED_COUNT" if len(unique) >= requested_count else "PARTIAL_BATCH"
    if not unique and not accepted:
        stop_reason = "NO_ACCEPTED_LEADS"

    return PublicationResult(
        search_id=search_id,
        published_count=len(published_leads) if published_leads else len(unique),
        accepted_unique_count=len(unique),
        requested_count=requested_count,
        published_leads=published_leads or [stamp_accepted_candidate(d.candidate_payload, d) for d in unique],
        stop_reason=stop_reason,
        rejection_audit=rejection_audit,
    )


def evaluate_and_publish(
    search_id: str,
    candidates: Sequence[Dict[str, Any]],
    intent: Dict[str, Any],
    requested_count: int,
    *,
    supabase: Any = None,
    user_id: Optional[str] = None,
    shadow_mode: bool = False,
    cost_within_budget: Optional[bool] = None,
    require_contact: bool = False,
) -> PublicationResult:
    """Evaluate candidates then publish through the single authorized path."""
    service = LeadAcceptanceService()
    if cost_within_budget is None and supabase is not None:
        cost_within_budget = _budget_allows(supabase, search_id)
    elif cost_within_budget is None:
        cost_within_budget = False

    ctx = EvaluationContext(
        cost_within_budget=bool(cost_within_budget),
        require_contact=require_contact,
        shadow_mode=shadow_mode,
    )
    decisions = [
        service.evaluate(candidate, intent, ctx)
        for candidate in candidates
        if isinstance(candidate, dict)
    ]
    return publish_accepted_leads(
        search_id,
        decisions,
        requested_count,
        supabase=supabase,
        user_id=user_id,
        canonical_plan=intent,
        shadow_mode=shadow_mode,
        cost_within_budget=bool(cost_within_budget),
    )
