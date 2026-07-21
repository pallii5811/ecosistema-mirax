"""Lead acceptance domain models."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class OpportunityState(str, Enum):
    OPEN_DEMAND = "OPEN_DEMAND"
    SELECTION_IN_PROGRESS = "SELECTION_IN_PROGRESS"
    AWARDED_RECENTLY = "AWARDED_RECENTLY"
    IMPLEMENTATION_ACTIVE = "IMPLEMENTATION_ACTIVE"
    HISTORICAL_CASE_STUDY = "HISTORICAL_CASE_STUDY"
    INFERRED_FIT = "INFERRED_FIT"
    UNKNOWN = "UNKNOWN"


class MarketScopeStatus(str, Enum):
    IN_SCOPE = "IN_SCOPE"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"
    UNVERIFIED = "UNVERIFIED"


class ContactabilityStatus(str, Enum):
    DIRECT_PERSON_CONTACT = "DIRECT_PERSON_CONTACT"
    ROLE_CONTACT = "ROLE_CONTACT"
    COMPANY_CONTACT = "COMPANY_CONTACT"
    NO_PUBLIC_CONTACT = "NO_PUBLIC_CONTACT"


@dataclass
class GateResult:
    passed: bool
    confidence: float
    reasons: List[str] = field(default_factory=list)
    evidence: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class OpportunityClassification:
    state: OpportunityState
    subject_company: Optional[str] = None
    provider_company: Optional[str] = None
    predicate: Optional[str] = None
    object: Optional[str] = None
    event_date: Optional[str] = None
    excerpt: Optional[str] = None
    source_url: Optional[str] = None
    confidence: float = 0.0
    negated: bool = False
    hypothetical: bool = False
    completed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["state"] = self.state.value
        return data


@dataclass
class EvaluationContext:
    cost_within_budget: bool = True
    require_contact: bool = True
    shadow_mode: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LeadAcceptanceDecision:
    accepted: bool
    rejection_codes: List[str]

    query_fit: GateResult
    market_scope: GateResult
    opportunity_state: OpportunityState
    opportunity_detail: OpportunityClassification
    evidence_gate: GateResult
    identity_gate: GateResult
    contactability_gate: GateResult

    official_domain: Optional[str]
    employee_estimate: Optional[int]
    revenue_estimate_eur: Optional[float]
    ownership_status: Optional[str]
    parent_group: Optional[str]

    target_role: Optional[str]
    decision_maker_role: Optional[str]
    intent_strength: str

    why_fit: str
    why_now: str

    confidence: float
    evaluated_at: str

    candidate_payload: Dict[str, Any] = field(default_factory=dict)
    publication_gate: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "accepted": self.accepted,
            "rejection_codes": self.rejection_codes,
            "query_fit": self.query_fit.to_dict(),
            "market_scope": self.market_scope.to_dict(),
            "opportunity_state": self.opportunity_state.value,
            "opportunity_detail": self.opportunity_detail.to_dict(),
            "evidence_gate": self.evidence_gate.to_dict(),
            "identity_gate": self.identity_gate.to_dict(),
            "contactability_gate": self.contactability_gate.to_dict(),
            "official_domain": self.official_domain,
            "employee_estimate": self.employee_estimate,
            "revenue_estimate_eur": self.revenue_estimate_eur,
            "ownership_status": self.ownership_status,
            "parent_group": self.parent_group,
            "target_role": self.target_role,
            "decision_maker_role": self.decision_maker_role,
            "intent_strength": self.intent_strength,
            "why_fit": self.why_fit,
            "why_now": self.why_now,
            "confidence": self.confidence,
            "evaluated_at": self.evaluated_at,
        }


@dataclass
class PublicationResult:
    search_id: str
    published_count: int
    accepted_unique_count: int
    requested_count: int
    published_leads: List[Dict[str, Any]]
    stop_reason: str
    rejection_audit: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
