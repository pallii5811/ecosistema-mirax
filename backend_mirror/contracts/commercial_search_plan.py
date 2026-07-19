"""Canonical, fail-closed contract for MIRAX commercial research plans."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION = "1.0.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NumberRange(StrictModel):
    min: Optional[int] = Field(default=None, ge=0)
    max: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_order(self) -> "NumberRange":
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        return self


class MoneyRange(StrictModel):
    min: Optional[float] = Field(default=None, ge=0)
    max: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, pattern=r"^[A-Z]{3}$")

    @model_validator(mode="after")
    def validate_order(self) -> "MoneyRange":
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        return self


class Seller(StrictModel):
    offer_category: Optional[str] = Field(default=None, max_length=200)
    offer_description: str = Field(min_length=1, max_length=1000)
    products_or_services: List[str] = Field(max_length=100)
    problems_solved: List[str] = Field(max_length=100)
    sales_motion: Optional[str] = Field(default=None, max_length=200)
    preferred_buyer_roles: List[str] = Field(max_length=100)


class Target(StrictModel):
    entity_types: List[str] = Field(max_length=100)
    industries: List[str] = Field(max_length=100)
    company_sizes: List[str] = Field(max_length=100)
    employee_range: Optional[NumberRange] = None
    revenue_range: Optional[MoneyRange] = None
    geographies: List[str] = Field(max_length=100)
    local_business_preference: bool
    required_attributes: List[str] = Field(max_length=100)
    excluded_attributes: List[str] = Field(max_length=100)
    excluded_entities: List[str] = Field(max_length=100)


class CommercialHypothesis(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    buyer_problem: str = Field(min_length=1, max_length=1000)
    triggering_events: List[str] = Field(max_length=100)
    signals: List[str] = Field(max_length=100)
    implied_need: str = Field(min_length=1, max_length=1000)
    relevance_to_offer: str = Field(min_length=1, max_length=1000)
    confidence: float = Field(ge=0, le=1)


class SignalPolicy(StrictModel):
    required_signals: List[str] = Field(max_length=100)
    optional_signals: List[str] = Field(max_length=100)
    negative_signals: List[str] = Field(max_length=100)
    maximum_age_days_by_signal: Dict[str, int]
    minimum_signal_confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_ages(self) -> "SignalPolicy":
        if any(age < 1 or age > 3650 for age in self.maximum_age_days_by_signal.values()):
            raise ValueError("signal maximum age must be between 1 and 3650 days")
        return self


class SourcePolicy(StrictModel):
    preferred_source_classes: List[str] = Field(max_length=100)
    allowed_source_classes: List[str] = Field(max_length=100)
    excluded_source_classes: List[str] = Field(max_length=100)
    minimum_independent_sources: int = Field(ge=1, le=5)
    primary_source_required_for: List[str] = Field(max_length=100)


class EvidencePolicy(StrictModel):
    require_official_domain: bool
    require_source_url: bool
    require_observed_at: bool
    minimum_evidence_confidence: float = Field(ge=0, le=1)
    corroboration_required_above_risk: float = Field(ge=0, le=1)


class AuditPolicy(StrictModel):
    modules: List[str] = Field(max_length=100)
    crawl_depth: int = Field(ge=0, le=5)
    maximum_pages: int = Field(ge=1, le=100)
    collect_contacts: bool
    collect_social_profiles: bool
    detect_technologies: bool
    detect_commercial_signals: bool


class RankingPolicy(StrictModel):
    weight_buyer_fit: float = Field(ge=0, le=1)
    weight_signal_strength: float = Field(ge=0, le=1)
    weight_freshness: float = Field(ge=0, le=1)
    weight_evidence_confidence: float = Field(ge=0, le=1)
    weight_contactability: float = Field(ge=0, le=1)
    weight_need_gap: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_weight_sum(self) -> "RankingPolicy":
        total = sum(
            (
                self.weight_buyer_fit,
                self.weight_signal_strength,
                self.weight_freshness,
                self.weight_evidence_confidence,
                self.weight_contactability,
                self.weight_need_gap,
            )
        )
        if abs(total - 1.0) > 0.001:
            raise ValueError(f"ranking weights must sum to 1 (received {total})")
        return self


class BudgetPolicy(StrictModel):
    target_cost_eur: float = Field(ge=0)
    hard_cost_eur: float = Field(gt=0)
    maximum_search_calls: int = Field(ge=0, le=10_000)
    maximum_pages_opened: int = Field(ge=0, le=100_000)
    maximum_llm_evaluations: int = Field(ge=0, le=10_000)

    @model_validator(mode="after")
    def validate_budget_order(self) -> "BudgetPolicy":
        if self.target_cost_eur > self.hard_cost_eur:
            raise ValueError("target_cost_eur cannot exceed hard_cost_eur")
        return self


class Ambiguity(StrictModel):
    score: float = Field(ge=0, le=1)
    assumptions: List[str] = Field(max_length=100)
    unresolved_fields: List[str] = Field(max_length=100)


class PlannerMetadata(StrictModel):
    planner: Literal["llm", "heuristic_fallback", "repaired_llm"]
    prompt_version: str = Field(min_length=1, max_length=100)
    model: Optional[str] = Field(default=None, max_length=200)
    generated_at: datetime


class SemanticQueryContractModel(StrictModel):
    original_query: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    query_goal: str = Field(min_length=1, max_length=1000)
    seller: Dict[str, Any]
    offer: Dict[str, Any]
    target_entity_types: List[str] = Field(max_length=100)
    target_company_description: str = Field(min_length=1, max_length=2000)
    event_or_state_description: str = Field(min_length=1, max_length=2000)
    target_role_in_event: str = Field(min_length=1, max_length=200)
    required_relationships: List[str] = Field(max_length=100)
    optional_relationships: List[str] = Field(max_length=100)
    excluded_roles: List[str] = Field(max_length=100)
    excluded_entities: List[str] = Field(max_length=100)
    geography: List[str] = Field(max_length=100)
    industry: List[str] = Field(max_length=100)
    size_constraints: Dict[str, Any]
    temporal_constraints: Dict[str, Any]
    positive_conditions: List[str] = Field(max_length=100)
    negative_conditions: List[str] = Field(max_length=100)
    must_have_facts: List[str] = Field(max_length=100)
    forbidden_inferences: List[str] = Field(max_length=100)
    data_requirements: List[str] = Field(max_length=100)
    ranking_objective: str = Field(min_length=1, max_length=1000)
    acceptance_rubric: List[str] = Field(max_length=100)
    discovery_hypotheses: List[Dict[str, Any]] = Field(max_length=20)
    clarification_required: bool
    confidence: float = Field(ge=0, le=1)
    canonical_signal_hints: List[str] = Field(max_length=100)


class CommercialSearchPlan(StrictModel):
    schema_version: Literal["1.0.0"]
    search_id: str = Field(min_length=1, max_length=128)
    raw_query: str = Field(min_length=2, max_length=4000)
    language: str = Field(min_length=2, max_length=16)
    seller: Seller
    target: Target
    commercial_hypotheses: List[CommercialHypothesis] = Field(min_length=1, max_length=12)
    signal_policy: SignalPolicy
    source_policy: SourcePolicy
    evidence_policy: EvidencePolicy
    audit_policy: AuditPolicy
    ranking_policy: RankingPolicy
    budget_policy: BudgetPolicy
    ambiguity: Ambiguity
    planner_metadata: PlannerMetadata
    semantic_query_contract: Optional[SemanticQueryContractModel] = None

    @model_validator(mode="after")
    def validate_contract_invariants(self) -> "CommercialSearchPlan":
        list_groups = [
            self.seller.products_or_services,
            self.seller.problems_solved,
            self.seller.preferred_buyer_roles,
            self.target.entity_types,
            self.target.industries,
            self.target.company_sizes,
            self.target.geographies,
            self.signal_policy.required_signals,
            self.signal_policy.optional_signals,
            self.signal_policy.negative_signals,
            self.source_policy.preferred_source_classes,
            self.source_policy.allowed_source_classes,
            self.source_policy.excluded_source_classes,
        ]
        if any(len(values) != len(set(values)) for values in list_groups):
            raise ValueError("contract arrays must not contain duplicates")
        return self


def validate_commercial_search_plan(payload: object) -> CommercialSearchPlan:
    """Validate and normalize a plan; raises ValidationError on any drift."""
    return CommercialSearchPlan.model_validate(payload)
