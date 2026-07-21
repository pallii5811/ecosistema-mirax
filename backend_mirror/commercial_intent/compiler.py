"""Semantic compiler Tier 0/1/2 for CommercialIntentSpec."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from contracts.commercial_intent import (
    CommercialIntentSpec,
    default_target_company_profile,
    ensure_market_scope_policy,
    normalize_commercial_intent,
)
from contracts.signal_ontology import load_signal_ontology, match_query_signals

_EXPLICIT_DEMAND_RE = re.compile(
    r"\b(cercano|stanno\s+cercando|in\s+cerca\s+di|assumono|raccogliendo|bando\s+per|rfp\b)\b",
    re.I,
)
_SELLER_FRAME_RE = re.compile(
    r"\b(sono\s+un|sono\s+una|vendo\b|installo|installiamo|realizziamo|offro\b|consulente)\b",
    re.I,
)
_DIGITAL_AUDIT_RE = re.compile(r"\b(seo|pixel|gtm|digital\s+audit|website\s+weakness)\b", re.I)
_PROCUREMENT_RE = re.compile(r"\b(gara|appalto|procurement|bando\s+pubblico|mepa|ted)\b", re.I)
_ENTERPRISE_OPT_IN_RE = re.compile(r"\b(enterprise|multinazional|quotat[oa]|grande\s+gruppo)\b", re.I)
_COUNT_RE = re.compile(r"\b(\d{1,4})\b")
_LOCATION_RE = re.compile(r"\b(?:a|in|nel(?:la)?|lombardia|milano|torino|italia|piemonte|veneto)\b", re.I)


@dataclass
class CompilerTelemetry:
    compiler_tier: int = 0
    cache_hit: bool = False
    confidence: float = 0.0
    cost_eur: float = 0.0
    validation_errors: List[str] = field(default_factory=list)
    clarification_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "compiler_tier": self.compiler_tier,
            "cache_hit": self.cache_hit,
            "confidence": self.confidence,
            "cost_eur": self.cost_eur,
            "validation_errors": self.validation_errors,
            "clarification_required": self.clarification_required,
        }


class CommercialIntentCompiler:
    def __init__(self) -> None:
        self._cache: Dict[str, Dict[str, Any]] = {}

    def compile(
        self,
        query: str,
        user_context: dict | None = None,
    ) -> CommercialIntentSpec:
        telemetry = CompilerTelemetry()
        q = " ".join(str(query or "").split()).strip()
        cache_key = hashlib.sha256(json.dumps({"q": q, "ctx": user_context or {}}, sort_keys=True).encode()).hexdigest()
        if cache_key in self._cache:
            telemetry.cache_hit = True
            telemetry.compiler_tier = 0
            payload = self._cache[cache_key]
            return CommercialIntentSpec(**payload)

        hints = self._tier0_hints(q)
        spec_dict, telemetry = self._tier1_compile(q, hints, user_context or {}, telemetry)
        if telemetry.confidence < 0.82 or telemetry.clarification_required:
            spec_dict, telemetry = self._tier2_refine(q, spec_dict, telemetry)

        try:
            spec_dict = normalize_commercial_intent(spec_dict)
        except Exception as exc:
            telemetry.validation_errors.append(str(exc))
            raise

        self._cache[cache_key] = spec_dict
        return CommercialIntentSpec(**spec_dict)

    def _tier0_hints(self, query: str) -> Dict[str, Any]:
        count_match = _COUNT_RE.search(query)
        return {
            "possible_explicit_demand": bool(_EXPLICIT_DEMAND_RE.search(query)),
            "possible_seller_frame": bool(_SELLER_FRAME_RE.search(query)),
            "possible_digital_audit": bool(_DIGITAL_AUDIT_RE.search(query)),
            "possible_procurement": bool(_PROCUREMENT_RE.search(query)),
            "requested_count": int(count_match.group(1)) if count_match else None,
            "location_hint": "Italia" if _LOCATION_RE.search(query) else None,
        }

    def _tier1_compile(
        self,
        query: str,
        hints: Dict[str, Any],
        user_context: Dict[str, Any],
        telemetry: CompilerTelemetry,
    ) -> tuple[Dict[str, Any], CompilerTelemetry]:
        telemetry.compiler_tier = 1
        request_mode = "company_filter"
        if hints["possible_procurement"]:
            request_mode = "procurement_discovery"
        elif hints["possible_digital_audit"]:
            request_mode = "digital_audit"
        elif hints["possible_explicit_demand"]:
            request_mode = "explicit_demand"
        elif hints["possible_seller_frame"]:
            request_mode = "seller_driven_lead_discovery"

        seller_offer = self._extract_offer(query) if hints["possible_seller_frame"] else None
        profile = default_target_company_profile()
        if _ENTERPRISE_OPT_IN_RE.search(query):
            profile["market_scope_policy"]["enterprise_opt_in"] = True

        explicit_signals = match_query_signals(query)
        direct_signals: List[str] = list(explicit_signals) if request_mode in {
            "explicit_demand", "procurement_discovery", "digital_audit",
        } else []
        inferred_signals: List[str] = list(explicit_signals) if request_mode not in {
            "explicit_demand", "procurement_discovery", "digital_audit",
        } else []
        relationship_aliases = {
            "production_expansion": "company_opening_or_expanding_facility",
            "supplier_search": "target_company_seeking_supplier",
            "funding": "startup_raising_or_receiving_investment",
        }
        if "technology_adoption" in explicit_signals and re.search(r"\bcrm\b", query, re.I):
            relationship_aliases["technology_adoption"] = "target_company_seeking_crm_solution"
        required_relationships = [relationship_aliases.get(signal, f"company_has_{signal}") for signal in explicit_signals]
        ontology = load_signal_ontology()["signals"]
        observable_events = [
            {
                "id": f"event-{signal}",
                "description": str(ontology[signal]["description"]),
                "triggering_phrases": [],
                "signals": [signal],
                "implied_need": seller_offer,
            }
            for signal in explicit_signals
        ]
        allowed_sources = list(dict.fromkeys(
            source
            for signal in explicit_signals
            for source in (
                ontology[signal].get("preferred_source_classes")
                or ontology[signal].get("likely_source_classes")
                or ()
            )
        )) or ["official_company_website"]

        confidence = 0.88 if request_mode != "company_filter" else 0.72
        if not seller_offer and request_mode == "seller_driven_lead_discovery":
            confidence = 0.68
            telemetry.clarification_required = True

        telemetry.confidence = confidence
        spec = {
            "original_query": query,
            "normalized_goal": query[:500],
            "request_mode": request_mode,
            "seller_profile": {
                "offer_description": seller_offer,
                "problems_solved": [f"Operational gap addressable by {seller_offer}"] if seller_offer else [],
            },
            "seller_offer": {"description": seller_offer, "category": None},
            "problem_solved": seller_offer,
            "buyer_need": self._buyer_need(query, request_mode, seller_offer),
            "target_company_profile": profile,
            "target_role": self._target_role(query, request_mode),
            "geography": [hints["location_hint"]] if hints.get("location_hint") else ["Italia"],
            "sectors": [],
            "freshness": {"maximum_age_days": 120},
            "direct_demand_signals": direct_signals,
            "inferred_fit_signals": inferred_signals,
            "observable_events": observable_events,
            "required_relationships": required_relationships,
            "excluded_roles": ["publisher", "recruiter", "vendor", "investor"],
            "evidence_policy": {"minimum_evidence_confidence": 0.7},
            "source_requirements": {"allowed_source_classes": allowed_sources},
            "intent_strength_required": "direct" if request_mode == "explicit_demand" else "strong_inferred",
            "capability_status": "supported",
            "confidence": confidence,
            "clarification_required": telemetry.clarification_required,
            "commercial_hypotheses": [],
        }
        if user_context.get("market_scope_policy"):
            spec["target_company_profile"]["market_scope_policy"] = user_context["market_scope_policy"]
        return spec, telemetry

    def _tier2_refine(
        self,
        query: str,
        spec: Dict[str, Any],
        telemetry: CompilerTelemetry,
    ) -> tuple[Dict[str, Any], CompilerTelemetry]:
        telemetry.compiler_tier = 2
        telemetry.cost_eur = 0.001
        if not spec.get("seller_offer", {}).get("description") and _SELLER_FRAME_RE.search(query):
            offer = self._extract_offer(query) or "offerta commerciale"
            spec["seller_offer"]["description"] = offer
            spec["seller_profile"]["offer_description"] = offer
            spec["problem_solved"] = offer
            telemetry.clarification_required = False
            telemetry.confidence = max(telemetry.confidence, 0.84)
        if len(spec.get("required_relationships") or []) > 1:
            telemetry.clarification_required = True
            telemetry.confidence = min(telemetry.confidence, 0.75)
        spec["confidence"] = telemetry.confidence
        spec["clarification_required"] = telemetry.clarification_required
        return spec, telemetry

    @staticmethod
    def _extract_offer(query: str) -> Optional[str]:
        for pattern in (
            r"\b(?:installo|installiamo|realizziamo|offro|vendo)\s+(.+?)(?:\.|,|\?|$)",
            r"\bconsulente\s+(.+?)(?:\.|,|\?|$)",
        ):
            match = re.search(pattern, query, re.I)
            if match:
                return match.group(1).strip()[:200]
        return None

    @staticmethod
    def _buyer_need(query: str, mode: str, offer: Optional[str]) -> Optional[str]:
        if mode == "explicit_demand":
            return query[:300]
        if offer:
            return f"Organisations that may need {offer}"
        return None

    @staticmethod
    def _target_role(query: str, mode: str) -> Optional[str]:
        if re.search(r"\bcrm\b", query, re.I):
            return "sales/marketing leadership"
        if re.search(r"\b(assum|hiring)\b", query, re.I):
            return "hr/talent leadership"
        if mode == "seller_driven_lead_discovery":
            return "operations/facility leadership"
        return None
