"""Market-scope resolver based on positive enterprise evidence.

Missing headcount is not enterprise evidence.  A real, contactable company
with a verified-domain candidate and no corporate exclusion signal can be a
LIKELY_SME; identity and contact authenticity remain independent hard gates.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

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
_LISTED_RE = re.compile(r"\b(quotat[oa]|listed|nyse|nasdaq|borsa\s+italiana|euronext)\b", re.I)
_GLOBAL_PARENT_RE = re.compile(
    r"\b(global|worldwide|multinational|international\s+plc|inc\.|corporation|holdings?\s+plc)\b",
    re.I,
)
_ENTERPRISE_SIZE_CLASSES = {"enterprise", "multinational", "global_enterprise"}
_SME_SIZE_CLASSES = {"micro", "small", "medium", "piccola", "media", "pmi", "startup"}


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
    entity = candidate.get("entity_classification") if isinstance(candidate.get("entity_classification"), dict) else {}
    raw = str(
        candidate.get("company_size_class")
        or candidate.get("company_size")
        or entity.get("company_size_class")
        or ""
    ).strip().lower()
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


def _mapping_candidates(candidate: Mapping[str, Any]) -> Iterable[Mapping[str, Any]]:
    yield candidate
    for key in ("entity_classification", "market_scope", "ownership"):
        value = candidate.get(key)
        if isinstance(value, Mapping):
            yield value
    report = candidate.get("technical_report")
    if isinstance(report, Mapping):
        yield report
        for key in ("entity_classification", "market_scope", "ownership"):
            value = report.get(key)
            if isinstance(value, Mapping):
                yield value


def _truthy_flag(candidate: Mapping[str, Any], *keys: str) -> bool:
    for mapping in _mapping_candidates(candidate):
        for key in keys:
            value = mapping.get(key)
            if value is True or str(value or "").strip().lower() in {"1", "true", "yes", "listed", "public"}:
                return True
    return False


def _numeric(candidate: Mapping[str, Any], *keys: str) -> Optional[float]:
    for mapping in _mapping_candidates(candidate):
        for key in keys:
            value = mapping.get(key)
            if value is None:
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return None


def _domain_is(domain: str, known: set[str]) -> bool:
    return any(domain == item or domain.endswith(f".{item}") for item in known)


def _has_public_company_contact(candidate: Mapping[str, Any]) -> bool:
    contacts = candidate.get("contatti") if isinstance(candidate.get("contatti"), Mapping) else {}
    values: List[Any] = [
        candidate.get("email"), candidate.get("mail"), candidate.get("telefono"), candidate.get("phone"),
        candidate.get("contact_page_url"), candidate.get("contact_form_url"), candidate.get("linkedin"),
        contacts.get("email"), contacts.get("emails"), contacts.get("telefono"), contacts.get("telefoni"),
        contacts.get("phone"), contacts.get("phones"), contacts.get("contact_page_url"), contacts.get("linkedin"),
    ]
    for value in values:
        if isinstance(value, (list, tuple, set)) and any(str(item or "").strip() for item in value):
            return True
        if isinstance(value, str) and value.strip():
            return True
    return False


def _result(
    status: MarketScopeStatus,
    *,
    passed: bool,
    confidence: float,
    reasons: List[str],
    indicators: List[str],
    employees: Optional[int],
    revenue: Optional[float],
) -> Tuple[MarketScopeStatus, GateResult, Optional[int], Optional[float]]:
    gate = GateResult(
        passed=passed,
        confidence=confidence,
        reasons=list(dict.fromkeys(reasons)),
        evidence=[{
            "claim_type": "MARKET_SCOPE",
            "status": status.value,
            "indicators": list(dict.fromkeys(indicators)),
        }],
    )
    return status, gate, employees, revenue


class MarketScopeResolver:
    """Classify contactable buyers without treating missing headcount as rejection."""

    def resolve(
        self,
        candidate: Mapping[str, Any],
        intent: Mapping[str, Any],
    ) -> Tuple[MarketScopeStatus, GateResult, Optional[int], Optional[float]]:
        policy = _policy_from_intent(intent)
        employees = _employee_count(candidate)
        revenue = _revenue_eur(candidate)
        if policy.get("enterprise_opt_in"):
            return _result(
                MarketScopeStatus.ENTERPRISE,
                passed=True,
                confidence=1.0,
                reasons=["ENTERPRISE_OPT_IN"],
                indicators=["enterprise_opt_in"],
                employees=employees,
                revenue=revenue,
            )

        domain = canonical_domain(
            candidate.get("official_domain")
            or candidate.get("employer_official_domain")
            or candidate.get("sito")
            or candidate.get("website")
        )
        name = str(candidate.get("azienda") or candidate.get("legal_name") or candidate.get("name") or "").strip()
        entity = candidate.get("entity_classification") if isinstance(candidate.get("entity_classification"), Mapping) else {}
        size_class = _size_class(candidate, employees)
        ownership = str(candidate.get("ownership_status") or candidate.get("forma_giuridica") or "").strip()
        parent = str(candidate.get("parent_group") or candidate.get("controlling_group") or "").strip()
        corporate_blob = " ".join((name, domain, ownership, parent, str(candidate.get("listed_status") or "")))
        enterprise: List[str] = []
        ambiguous: List[str] = []
        confirmed: List[str] = []

        if policy.get("exclude_global_enterprises") and _domain_is(domain, _GLOBAL_ENTERPRISE_DOMAINS):
            enterprise.append("GLOBAL_ENTERPRISE")
        if policy.get("exclude_state_controlled_major_operators") and _domain_is(domain, _STATE_OPERATOR_DOMAINS):
            enterprise.append("STATE_CONTROLLED_OPERATOR")
        if policy.get("exclude_public_companies") and (
            _truthy_flag(candidate, "is_listed", "public_company", "is_public_company")
            or bool(candidate.get("stock_ticker"))
            or bool(candidate.get("investor_relations_url"))
            or _LISTED_RE.search(corporate_blob)
        ):
            enterprise.append("PUBLIC_COMPANY")
        if policy.get("exclude_famous_brands") and (
            _BIG_FOUR_RE.search(corporate_blob)
            or _truthy_flag(candidate, "is_global_brand", "famous_brand", "is_dominant_brand")
        ):
            enterprise.append("GLOBAL_ENTERPRISE")
        if _truthy_flag(
            candidate,
            "is_multinational", "multinational", "is_global_enterprise", "global_operations",
            "is_major_bank", "is_major_telco", "is_major_utility", "is_national_operator",
            "enterprise_excluded",
        ):
            enterprise.append("GLOBAL_ENTERPRISE")
        countries = _numeric(candidate, "operating_countries_count", "countries_count", "global_country_count")
        if countries is not None and countries >= 5:
            enterprise.append("GLOBAL_ENTERPRISE")
        if entity.get("is_public_body"):
            enterprise.append("STATE_CONTROLLED_OPERATOR")
        if entity.get("is_media") or entity.get("is_directory"):
            enterprise.append("NON_OPERATING_ENTITY")

        if employees is not None:
            if 2 <= employees <= 249:
                confirmed.append("EMPLOYEE_COUNT_SME")
            elif employees >= 1000:
                enterprise.append("EMPLOYEES_ENTERPRISE_SCALE")
            else:
                ambiguous.append("EMPLOYEE_COUNT_CORPORATE_BOUNDARY")
        if revenue is not None:
            if revenue <= 50_000_000:
                confirmed.append("REVENUE_SME_RANGE")
            elif revenue >= 250_000_000:
                enterprise.append("REVENUE_ENTERPRISE_SCALE")
            else:
                ambiguous.append("REVENUE_CORPORATE_BOUNDARY")
        if size_class in _SME_SIZE_CLASSES:
            confirmed.append("SIZE_CLASS_SME")
        elif size_class in _ENTERPRISE_SIZE_CLASSES:
            enterprise.append("SIZE_CLASS_ENTERPRISE")
        elif size_class == "large":
            ambiguous.append("SIZE_CLASS_LARGE_UNRESOLVED")

        large_parent = _truthy_flag(candidate, "parent_group_is_large", "controlled_by_global_group", "global_parent")
        if parent and (large_parent or _GLOBAL_PARENT_RE.search(parent)):
            enterprise.append("LARGE_CORPORATE_GROUP")
        elif parent and not _truthy_flag(candidate, "parent_group_is_sme", "independent_company"):
            ambiguous.append("PARENT_GROUP_UNRESOLVED")
        if _truthy_flag(candidate, "corporate_signals_conflicting", "ownership_unresolved", "ownership_conflict"):
            ambiguous.append("CORPORATE_SIGNALS_CONTRADICTORY")

        if enterprise:
            return _result(
                MarketScopeStatus.ENTERPRISE,
                passed=False,
                confidence=0.96,
                reasons=enterprise,
                indicators=enterprise + confirmed + ambiguous,
                employees=employees,
                revenue=revenue,
            )
        if ambiguous:
            return _result(
                MarketScopeStatus.AMBIGUOUS_CORPORATE,
                passed=False,
                confidence=0.5,
                reasons=["MARKET_SCOPE_AMBIGUOUS", *ambiguous],
                indicators=confirmed + ambiguous,
                employees=employees,
                revenue=revenue,
            )
        if confirmed:
            return _result(
                MarketScopeStatus.CONFIRMED_SME,
                passed=True,
                confidence=min(0.98, 0.82 + 0.05 * len(set(confirmed))),
                reasons=["CONFIRMED_SME"],
                indicators=confirmed,
                employees=employees,
                revenue=revenue,
            )

        likely_requirements: List[str] = []
        if not name:
            likely_requirements.append("COMPANY_NAME_REQUIRED_FOR_LIKELY_SME")
        if not domain:
            likely_requirements.append("OFFICIAL_DOMAIN_REQUIRED_FOR_LIKELY_SME")
        if not _has_public_company_contact(candidate):
            likely_requirements.append("PUBLIC_CONTACT_REQUIRED_FOR_LIKELY_SME")
        if likely_requirements:
            return _result(
                MarketScopeStatus.AMBIGUOUS_CORPORATE,
                passed=False,
                confidence=0.4,
                reasons=["MARKET_SCOPE_AMBIGUOUS", *likely_requirements],
                indicators=likely_requirements,
                employees=employees,
                revenue=revenue,
            )
        return _result(
            MarketScopeStatus.LIKELY_SME,
            passed=True,
            confidence=0.72,
            reasons=["LIKELY_SME_NO_ENTERPRISE_INDICATORS"],
            indicators=["REAL_COMPANY", "OFFICIAL_DOMAIN_PRESENT", "PUBLIC_COMPANY_CONTACT", "NO_ENTERPRISE_INDICATORS"],
            employees=employees,
            revenue=revenue,
        )


_RESOLVER = MarketScopeResolver()


def resolve_market_scope(
    candidate: Mapping[str, Any],
    intent: Mapping[str, Any],
) -> Tuple[MarketScopeStatus, GateResult, Optional[int], Optional[float]]:
    return _RESOLVER.resolve(candidate, intent)
