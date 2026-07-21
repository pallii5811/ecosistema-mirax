"""Market scope resolver — general rules, not name-only blacklists."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Tuple

from commercial_lifecycle import canonical_domain

from .models import GateResult, MarketScopeStatus

_GLOBAL_ENTERPRISE_DOMAINS = {
    "pwc.com", "abbott.com", "microsoft.com", "google.com", "amazon.com",
    "apple.com", "accenture.com", "deloitte.com", "ey.com", "kpmg.com",
    "mckinsey.com", "bcg.com", "bain.com",
}

_STATE_OPERATOR_DOMAINS = {
    "trenord.it", "trenitalia.it", "fsitaliane.it", "poste.it",
    "eni.com", "enel.com", "ferrovienord.it", "telecomitalia.it",
}

_BIG_FOUR_RE = re.compile(r"\b(pwc|deloitte|kpmg|ernst\s*&?\s*young|ey\b)\b", re.I)
_LISTED_RE = re.compile(r"\b(quotat[oa]|listed|nyse|nasdaq|borsa\s+italiana)\b", re.I)


def _policy_from_intent(intent: Mapping[str, Any]) -> Dict[str, Any]:
    profile = intent.get("target_company_profile") if isinstance(intent.get("target_company_profile"), dict) else {}
    policy = profile.get("market_scope_policy") if isinstance(profile.get("market_scope_policy"), dict) else {}
    if policy:
        return policy
    return {
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


def _employee_count(candidate: Mapping[str, Any]) -> Optional[int]:
    for key in ("employee_count", "employees", "dipendenti_stimati", "headcount"):
        raw = candidate.get(key)
        if raw is None:
            continue
        try:
            return int(re.sub(r"\D+", "", str(raw)) or "0") or None
        except (TypeError, ValueError):
            continue
    entity = candidate.get("entity_classification")
    if isinstance(entity, dict) and entity.get("employee_count") is not None:
        try:
            return int(entity["employee_count"])
        except (TypeError, ValueError):
            return None
    return None


def _revenue_eur(candidate: Mapping[str, Any]) -> Optional[float]:
    for key in ("revenue_eur", "fatturato_eur", "annual_revenue_eur"):
        raw = candidate.get(key)
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def _size_class(candidate: Mapping[str, Any], employees: Optional[int]) -> str:
    raw = str(
        candidate.get("company_size_class")
        or candidate.get("company_size")
        or (candidate.get("entity_classification") or {}).get("company_size_class")
        or ""
    ).lower()
    if raw:
        return raw
    if employees is None:
        return "unknown"
    if employees < 10:
        return "micro"
    if employees < 50:
        return "small"
    if employees < 250:
        return "medium"
    if employees < 1000:
        return "large"
    return "enterprise"


def resolve_market_scope(
    candidate: Mapping[str, Any],
    intent: Mapping[str, Any],
) -> Tuple[MarketScopeStatus, GateResult, Optional[int], Optional[float]]:
    policy = _policy_from_intent(intent)
    if policy.get("enterprise_opt_in"):
        return MarketScopeStatus.IN_SCOPE, GateResult(True, 1.0, ["enterprise_opt_in"]), _employee_count(candidate), _revenue_eur(candidate)

    domain = canonical_domain(
        candidate.get("official_domain")
        or candidate.get("employer_official_domain")
        or candidate.get("sito")
        or candidate.get("website")
    )
    name = str(candidate.get("azienda") or candidate.get("legal_name") or candidate.get("name") or "")
    blob = f"{name} {domain}".lower()
    employees = _employee_count(candidate)
    revenue = _revenue_eur(candidate)
    size_class = _size_class(candidate, employees)
    reasons: List[str] = []
    authoritative_hits = 0
    support_hits = 0

    if employees is not None:
        authoritative_hits += 1
        min_e = policy.get("minimum_employees")
        max_e = policy.get("maximum_employees")
        if min_e is not None and employees < int(min_e):
            reasons.append("EMPLOYEES_BELOW_MINIMUM")
        if max_e is not None and employees > int(max_e):
            reasons.append("EMPLOYEES_ABOVE_MAXIMUM")
    elif size_class in {"unknown", ""}:
        # Exact headcount missing is only a hard fail when size class is also unknown.
        # A known PMI class (micro/small/medium) is enough to keep the lead in
        # market-scope evaluation; enterprise still fails via SIZE_CLASS_OUT_OF_SCOPE.
        reasons.append("SIZE_UNVERIFIED")

    if revenue is not None:
        authoritative_hits += 1
        max_r = policy.get("maximum_revenue_eur")
        if max_r is not None and revenue > float(max_r):
            reasons.append("REVENUE_ABOVE_MAXIMUM")

    allowed = {str(v).lower() for v in policy.get("allowed_size_classes") or []}
    if size_class in allowed:
        support_hits += 1
    elif size_class in {"large", "enterprise"}:
        reasons.append("SIZE_CLASS_OUT_OF_SCOPE")

    if policy.get("exclude_global_enterprises") and domain in _GLOBAL_ENTERPRISE_DOMAINS:
        reasons.append("GLOBAL_ENTERPRISE")
    if policy.get("exclude_state_controlled_major_operators") and domain in _STATE_OPERATOR_DOMAINS:
        reasons.append("STATE_CONTROLLED_OPERATOR")
    if policy.get("exclude_public_companies") and (candidate.get("is_listed") or _LISTED_RE.search(blob)):
        reasons.append("PUBLIC_COMPANY")
    if policy.get("exclude_famous_brands") and _BIG_FOUR_RE.search(blob):
        reasons.append("GLOBAL_ENTERPRISE")

    entity = candidate.get("entity_classification") if isinstance(candidate.get("entity_classification"), dict) else {}
    if entity.get("is_global_brand") or candidate.get("enterprise_excluded"):
        reasons.append("GLOBAL_ENTERPRISE")
    if entity.get("is_public_body"):
        reasons.append("STATE_CONTROLLED_OPERATOR")
    if entity.get("is_media") or entity.get("is_directory"):
        reasons.append("NON_OPERATING_ENTITY")

    parent = str(candidate.get("parent_group") or candidate.get("controlling_group") or "").strip()
    if parent and policy.get("exclude_large_corporate_groups"):
        support_hits += 1
        if re.search(r"\b(group|gruppo|holding|international|global)\b", parent, re.I):
            reasons.append("LARGE_CORPORATE_GROUP")

    out_codes = list(dict.fromkeys(reasons))
    if "SIZE_UNVERIFIED" in out_codes and len(out_codes) == 1:
        status = MarketScopeStatus.UNVERIFIED
        passed = False
    elif any(code in out_codes for code in (
        "GLOBAL_ENTERPRISE", "STATE_CONTROLLED_OPERATOR", "EMPLOYEES_ABOVE_MAXIMUM",
        "REVENUE_ABOVE_MAXIMUM", "SIZE_CLASS_OUT_OF_SCOPE", "PUBLIC_COMPANY",
        "LARGE_CORPORATE_GROUP", "NON_OPERATING_ENTITY", "EMPLOYEES_BELOW_MINIMUM",
    )):
        status = MarketScopeStatus.OUT_OF_SCOPE
        passed = False
    elif authoritative_hits >= 1 or support_hits >= 1:
        # One support hit is enough when size class is an allowed PMI band
        # (or another non-contradictory support signal). Exact headcount remains
        # preferred and still raises authoritative_hits when present.
        status = MarketScopeStatus.IN_SCOPE
        passed = True
        out_codes = []
    else:
        status = MarketScopeStatus.UNVERIFIED
        passed = False
        if "SIZE_UNVERIFIED" not in out_codes:
            out_codes.append("SIZE_UNVERIFIED")

    confidence = min(1.0, 0.5 + 0.25 * authoritative_hits + 0.15 * support_hits)
    if not passed:
        confidence = min(confidence, float(policy.get("required_market_scope_confidence") or 0.75) - 0.01)

    gate = GateResult(passed=passed, confidence=confidence, reasons=out_codes)
    return status, gate, employees, revenue
