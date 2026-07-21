"""Runtime bridge: persisted CommercialIntentSpec → worker canonical plan."""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from contracts.commercial_intent import (
    DEFAULT_MIRAX_MARKET_SCOPE_POLICY,
    ensure_market_scope_policy,
    normalize_commercial_intent,
)


def extract_persisted_spec(intent: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(intent, dict):
        return None
    progress = intent.get("progress") if isinstance(intent.get("progress"), dict) else {}
    for key in ("commercial_intent_spec",):
        raw = intent.get(key) or progress.get(key)
        if isinstance(raw, dict) and raw.get("original_query"):
            return dict(raw)
    return None


def extract_persisted_hypotheses(intent: Mapping[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(intent, dict):
        return []
    progress = intent.get("progress") if isinstance(intent.get("progress"), dict) else {}
    raw = intent.get("commercial_hypotheses") or progress.get("commercial_hypotheses")
    return list(raw) if isinstance(raw, list) else []


def extract_compiler_telemetry(intent: Mapping[str, Any]) -> Dict[str, Any]:
    if not isinstance(intent, dict):
        return {}
    progress = intent.get("progress") if isinstance(intent.get("progress"), dict) else {}
    raw = intent.get("intent_compiler_telemetry") or progress.get("intent_compiler_telemetry")
    return dict(raw) if isinstance(raw, dict) else {}


def spec_to_canonical_plan(spec: Mapping[str, Any]) -> Dict[str, Any]:
    """Map CommercialIntentSpec to legacy canonical plan consumed by lifecycle gates."""
    normalized = normalize_commercial_intent(dict(spec))
    profile = normalized.get("target_company_profile") or {}
    policy = profile.get("market_scope_policy") or DEFAULT_MIRAX_MARKET_SCOPE_POLICY
    direct = normalized.get("direct_demand_signals") or []
    inferred = normalized.get("inferred_fit_signals") or []
    required_signals = list(dict.fromkeys([*direct, *inferred]))
    return {
        "schema_version": "1.0.0",
        "raw_query": normalized.get("original_query") or normalized.get("normalized_goal") or "",
        "semantic_query_contract": {
            "query_goal": normalized.get("buyer_need") or normalized.get("normalized_goal"),
            "target_role_in_event": normalized.get("target_role"),
            "required_relationships": normalized.get("required_relationships") or [],
            "excluded_roles": normalized.get("excluded_roles") or [],
            "clarification_required": normalized.get("clarification_required", False),
            "confidence": normalized.get("confidence", 0),
        },
        "target": {
            "entity_types": profile.get("entity_types") or ["company"],
            "industries": profile.get("industries") or normalized.get("sectors") or [],
            "geographies": profile.get("geographies") or normalized.get("geography") or ["Italia"],
            "company_sizes": profile.get("company_sizes") or ["micro", "piccola", "media"],
            "local_business_preference": True,
            "required_attributes": profile.get("required_attributes") or [],
            "excluded_attributes": profile.get("excluded_attributes") or [],
            "excluded_entities": profile.get("excluded_entities") or [],
            "market_scope_policy": policy,
        },
        "signal_policy": {
            "required_signals": required_signals,
            "optional_signals": [],
            "negative_signals": [],
            "maximum_age_days_by_signal": {
                sig: (normalized.get("freshness") or {}).get("maximum_age_days") or 120
                for sig in required_signals
            },
            "minimum_signal_confidence": 0.7,
        },
        "source_policy": {
            "allowed_source_classes": (normalized.get("source_requirements") or {}).get("allowed_source_classes")
            or ["official_company_website", "company_careers"],
            "preferred_source_classes": ["official_company_website"],
            "excluded_source_classes": (normalized.get("source_requirements") or {}).get("excluded_source_classes")
            or ["search_snippet"],
            "minimum_independent_sources": (normalized.get("source_requirements") or {}).get("minimum_independent_sources")
            or 1,
            "primary_source_required_for": [],
        },
        "evidence_policy": normalized.get("evidence_policy") or {"minimum_evidence_confidence": 0.7},
        "seller": normalized.get("seller_profile") or {},
        "commercial_hypotheses": normalized.get("commercial_hypotheses") or [],
        "commercial_intent_spec": normalized,
        "request_mode": normalized.get("request_mode"),
    }


def resolve_authoritative_intent(intent: Mapping[str, Any]) -> Dict[str, Any]:
    """Prefer persisted CommercialIntentSpec; fail closed on divergent silent fallback."""
    spec = extract_persisted_spec(intent)
    if spec:
        return spec_to_canonical_plan(spec)
    if isinstance(intent, dict) and intent.get("commercial_intent_required"):
        raise ValueError("COMMERCIAL_INTENT_SPEC_MISSING")
    return {}
