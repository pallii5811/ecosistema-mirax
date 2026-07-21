"""Shared CommercialIntent contract — Python mirror of contracts/commercial_intent.schema.json."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None  # type: ignore

ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_CANDIDATES = (
    ROOT / "contracts" / "commercial_intent.schema.json",
    Path(__file__).resolve().parents[1] / "commercial_intent.schema.json",
    Path(__file__).resolve().parents[1].parent / "contracts" / "commercial_intent.schema.json",
)
SCHEMA_PATH = next((path for path in _SCHEMA_CANDIDATES if path.exists()), _SCHEMA_CANDIDATES[0])

SizeClass = Literal["micro", "small", "medium", "large", "enterprise"]
RequestMode = Literal[
    "explicit_demand",
    "seller_driven_lead_discovery",
    "event_based_discovery",
    "company_filter",
    "digital_audit",
    "procurement_discovery",
]
IntentStrength = Literal["direct", "strong_inferred", "moderate_inferred"]


DEFAULT_MIRAX_MARKET_SCOPE_POLICY: Dict[str, Any] = {
    "minimum_employees": 2,
    "maximum_employees": 249,
    "minimum_revenue_eur": None,
    "maximum_revenue_eur": 50_000_000,
    "allowed_size_classes": ["micro", "small", "medium"],
    "enterprise_opt_in": False,
    "exclude_public_companies": True,
    "exclude_state_controlled_major_operators": True,
    "exclude_global_enterprises": True,
    "exclude_large_corporate_groups": True,
    "exclude_famous_brands": True,
    "required_market_scope_confidence": 0.75,
}


@dataclass
class MarketScopePolicy:
    minimum_employees: Optional[int] = 2
    maximum_employees: Optional[int] = 249
    minimum_revenue_eur: Optional[float] = None
    maximum_revenue_eur: Optional[float] = 50_000_000
    allowed_size_classes: List[SizeClass] = field(
        default_factory=lambda: ["micro", "small", "medium"]
    )
    enterprise_opt_in: bool = False
    exclude_public_companies: bool = True
    exclude_state_controlled_major_operators: bool = True
    exclude_global_enterprises: bool = True
    exclude_large_corporate_groups: bool = True
    exclude_famous_brands: bool = True
    required_market_scope_confidence: float = 0.75

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CommercialHypothesis:
    id: str
    target_company_profile: Dict[str, Any]
    target_role: str
    buyer_problem: str
    observable_event: str
    required_relationship: str
    sources: List[str]
    false_positive_risks: List[str]
    expected_yield: Literal["high", "medium", "low"]
    expected_cost: Literal["low", "medium", "high"]
    intent_strength: IntentStrength

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CommercialIntentSpec:
    original_query: str
    normalized_goal: str
    request_mode: RequestMode
    seller_profile: Dict[str, Any]
    seller_offer: Dict[str, Any]
    problem_solved: Optional[str]
    buyer_need: Optional[str]
    target_company_profile: Dict[str, Any]
    target_role: Optional[str]
    geography: List[str]
    sectors: List[str]
    freshness: Optional[Dict[str, Any]]
    direct_demand_signals: List[str]
    inferred_fit_signals: List[str]
    observable_events: List[Dict[str, Any]]
    required_relationships: List[str]
    excluded_roles: List[str]
    evidence_policy: Dict[str, Any]
    source_requirements: Dict[str, Any]
    intent_strength_required: IntentStrength
    capability_status: Literal["supported", "supported_partial", "unavailable"]
    confidence: float
    clarification_required: bool
    commercial_hypotheses: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def load_schema() -> Dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def default_target_company_profile() -> Dict[str, Any]:
    return {"market_scope_policy": dict(DEFAULT_MIRAX_MARKET_SCOPE_POLICY)}


def ensure_market_scope_policy(profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(profile or {})
    policy = out.get("market_scope_policy")
    if not isinstance(policy, dict) or not policy:
        out["market_scope_policy"] = dict(DEFAULT_MIRAX_MARKET_SCOPE_POLICY)
    return out


def validate_commercial_intent(payload: Dict[str, Any]) -> None:
    if jsonschema is None:
        raise RuntimeError("jsonschema is required to validate CommercialIntentSpec")
    profile = payload.get("target_company_profile")
    if not isinstance(profile, dict) or not profile.get("market_scope_policy"):
        raise ValueError("target_company_profile.market_scope_policy is required")
    jsonschema.validate(instance=payload, schema=load_schema())


def normalize_commercial_intent(payload: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(payload)
    data["target_company_profile"] = ensure_market_scope_policy(
        data.get("target_company_profile") if isinstance(data.get("target_company_profile"), dict) else {}
    )
    validate_commercial_intent(data)
    return data
