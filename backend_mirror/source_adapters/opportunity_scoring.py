"""Transparent commercial opportunity scoring for canonical candidates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Dict, Iterable, Mapping, Optional, Tuple

from .contracts import OpportunityCandidate


@dataclass(frozen=True)
class ScoreComponent:
    name: str
    value: float
    weight: float
    contribution: float
    rationale: str
    missing: bool = False


@dataclass(frozen=True)
class OpportunityScore:
    total: float
    components: Tuple[ScoreComponent, ...]
    penalties: Mapping[str, float]
    missing_fields: Tuple[str, ...]
    critical_missing: Tuple[str, ...]
    top_tier: bool

    def explanation(self) -> Tuple[str, ...]:
        ranked = sorted(self.components, key=lambda item: item.contribution, reverse=True)
        reasons = [f"{item.name}={item.value:.2f} ({item.rationale})" for item in ranked[:5]]
        if self.penalties:
            reasons.append("penalties=" + ", ".join(f"{key}:{value:.2f}" for key, value in self.penalties.items()))
        if self.missing_fields:
            reasons.append("missing=" + ", ".join(self.missing_fields))
        return tuple(reasons)


WEIGHTS: Mapping[str, float] = {
    "buyer_fit": 0.17,
    "signal_strength": 0.16,
    "freshness": 0.12,
    "source_reliability": 0.10,
    "evidence_completeness": 0.12,
    "urgency": 0.08,
    "problem_offer_causality": 0.10,
    "commercial_value": 0.06,
    "contactability": 0.04,
    "confidence": 0.05,
}

_SOURCE_RELIABILITY = {
    "public_procurement_portal": 0.98,
    "official_registry": 0.98,
    "technology_audit": 0.94,
    "company_careers": 0.92,
    "official_company_website": 0.90,
    "ad_transparency_library": 0.90,
    "recognized_local_news": 0.68,
    "industry_publication": 0.72,
    "job_board": 0.76,
    "search_snippet": 0.35,
    "directory": 0.20,
}
_URGENT_SIGNALS = {
    "hiring", "hiring_operational", "tender_won", "contract_awarded",
    "active_advertising", "meta_ads_started", "google_ads_started",
    "new_location", "production_expansion", "seeking_supplier",
}


def _bounded(value: object, default: float = 0.0) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _latest_age(candidate: OpportunityCandidate, today: date) -> Optional[int]:
    values = [candidate.signal_date, *(item.published_at for item in candidate.evidence)]
    parsed = []
    for value in values:
        if not value:
            continue
        try:
            parsed.append(date.fromisoformat(str(value)[:10]))
        except ValueError:
            continue
    if not parsed:
        return None
    return max(0, (today - max(parsed)).days)


def _component(name: str, value: float, rationale: str, *, missing: bool = False) -> ScoreComponent:
    bounded = _bounded(value)
    weight = WEIGHTS[name]
    return ScoreComponent(name, bounded, weight, bounded * weight, rationale, missing)


def _source_score(candidate: OpportunityCandidate) -> Tuple[float, str]:
    if not candidate.evidence:
        return 0.0, "no evidence source"
    scores = [_SOURCE_RELIABILITY.get(item.source_class, 0.55) for item in candidate.evidence]
    independent = len({(item.source_publisher, item.source_url) for item in candidate.evidence})
    base = sum(scores) / len(scores)
    diversity_bonus = min(0.08, max(0, independent - 1) * 0.04)
    return min(1.0, base + diversity_bonus), f"{independent} independent source(s)"


def _evidence_completeness(candidate: OpportunityCandidate) -> Tuple[float, str]:
    if not candidate.evidence:
        return 0.0, "no evidence"
    fields = []
    for item in candidate.evidence:
        fields.append(sum(bool(value) for value in (
            item.signal_id, item.source_url, item.source_publisher, item.source_class,
            item.excerpt, item.published_at, item.extraction_method,
        )) / 7)
    return sum(fields) / len(fields), f"{len(candidate.evidence)} canonical evidence record(s)"


def _signal_strength(candidate: OpportunityCandidate) -> Tuple[float, str]:
    proof_levels = {str(item.provenance.get("proof_level") or "").lower() for item in candidate.evidence}
    if "direct" in proof_levels:
        return max(0.9, candidate.confidence), "direct observed event"
    if "strong_proxy" in proof_levels:
        return min(0.88, max(0.75, candidate.confidence)), "strong explicit proxy"
    if candidate.evidence:
        return min(0.85, max(0.55, sum(item.confidence for item in candidate.evidence) / len(candidate.evidence))), "explicit canonical evidence"
    return 0.0, "signal not evidenced"


def _commercial_value(candidate: OpportunityCandidate) -> Tuple[float, str, bool]:
    explicit = candidate.provenance.get("commercial_value_score")
    if explicit is not None:
        return _bounded(explicit), "explicit normalized commercial value", False
    amount = candidate.evidence[0].provenance.get("amount_eur") if candidate.evidence else None
    try:
        numeric = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        numeric = None
    if numeric is not None:
        normalized = min(1.0, 0.35 + (numeric / 500_000))
        return normalized, "verified event amount", False
    return 0.4, "commercial value not quantified", True


def score_opportunity(
    candidate: OpportunityCandidate,
    *,
    today: Optional[date] = None,
    freshness_horizon_days: Optional[int] = None,
) -> OpportunityScore:
    if freshness_horizon_days is None:
        try:
            freshness_horizon_days = int(candidate.provenance.get("freshness_horizon_days") or 90)
        except (TypeError, ValueError):
            freshness_horizon_days = 90
    if freshness_horizon_days <= 0:
        raise ValueError("freshness horizon must be positive")
    today = today or date.today()
    missing: list[str] = []
    critical: list[str] = []

    if candidate.buyer_fit is None:
        missing.append("buyer_fit")
        critical.append("buyer_fit")
    buyer_fit = _bounded(candidate.buyer_fit)

    signal_strength, signal_reason = _signal_strength(candidate)
    if not candidate.evidence:
        missing.append("evidence")
        critical.append("evidence")

    age = _latest_age(candidate, today)
    if age is None:
        freshness = 0.0
        freshness_reason = "signal date missing"
        missing.append("freshness")
        critical.append("freshness")
    else:
        freshness = max(0.0, 1.0 - age / freshness_horizon_days)
        freshness_reason = f"latest evidence {age} day(s) old"

    source_reliability, source_reason = _source_score(candidate)
    evidence_completeness, evidence_reason = _evidence_completeness(candidate)

    urgency_explicit = candidate.provenance.get("urgency_score")
    urgency = _bounded(urgency_explicit) if urgency_explicit is not None else (
        0.9 if candidate.signal_id in _URGENT_SIGNALS and freshness >= 0.7 else 0.65 if candidate.why_now else 0.3
    )
    urgency_reason = "explicit urgency" if urgency_explicit is not None else "signal class and freshness"

    causality_explicit = candidate.provenance.get("causality_score")
    if causality_explicit is None:
        causality = 0.65 if candidate.why_now else 0.0
        missing.append("explicit_problem_offer_causality")
        causality_reason = "why-now present; explicit causality not quantified" if candidate.why_now else "causality missing"
    else:
        causality = _bounded(causality_explicit)
        causality_reason = "explicit offer-to-problem relation"

    commercial_value, value_reason, value_missing = _commercial_value(candidate)
    if value_missing:
        missing.append("commercial_value")

    verified_contacts = sum(1 for item in candidate.contacts if item.verified)
    if verified_contacts:
        contactability = min(1.0, 0.75 + 0.1 * (verified_contacts - 1))
        contact_reason = f"{verified_contacts} verified contact(s)"
    elif candidate.contacts:
        contactability = 0.4
        contact_reason = "public contacts not verified"
    else:
        contactability = 0.0
        contact_reason = "no contact available"
        missing.append("contactability")

    components = (
        _component("buyer_fit", buyer_fit, "canonical buyer fit", missing=candidate.buyer_fit is None),
        _component("signal_strength", signal_strength, signal_reason, missing=not candidate.evidence),
        _component("freshness", freshness, freshness_reason, missing=age is None),
        _component("source_reliability", source_reliability, source_reason, missing=not candidate.evidence),
        _component("evidence_completeness", evidence_completeness, evidence_reason, missing=not candidate.evidence),
        _component("urgency", urgency, urgency_reason),
        _component("problem_offer_causality", causality, causality_reason, missing=causality_explicit is None),
        _component("commercial_value", commercial_value, value_reason, missing=value_missing),
        _component("contactability", contactability, contact_reason, missing=not candidate.contacts),
        _component("confidence", candidate.confidence, "adapter confidence"),
    )
    penalties: Dict[str, float] = {}
    if candidate.contradiction_flags:
        penalties["contradictions"] = min(0.35, 0.08 * len(candidate.contradiction_flags))
    if candidate.entity_class not in {"operating_company", "company_group"}:
        penalties["non_operating_entity"] = 0.40
        critical.append("operating_entity")
    if not candidate.official_domain:
        penalties["official_domain_missing"] = 0.40
        missing.append("official_domain")
        critical.append("official_domain")
    elif not candidate.official_domain_verified or candidate.official_domain_confidence < 0.70:
        penalties["official_domain_unverified"] = 0.40
        missing.append("official_domain_verification")
        critical.append("official_domain_verification")
    total = max(0.0, min(1.0, sum(item.contribution for item in components) - sum(penalties.values())))
    if critical:
        total = min(total, 0.49)
    critical_unique = tuple(dict.fromkeys(critical))
    return OpportunityScore(
        total=total,
        components=components,
        penalties=penalties,
        missing_fields=tuple(dict.fromkeys(missing)),
        critical_missing=critical_unique,
        top_tier=total >= 0.85 and not critical_unique and evidence_completeness >= 0.9 and source_reliability >= 0.85,
    )


def rank_opportunities(candidates: Iterable[OpportunityCandidate]) -> Tuple[Tuple[OpportunityCandidate, OpportunityScore], ...]:
    scored = [(candidate, score_opportunity(candidate)) for candidate in candidates]
    return tuple(sorted(scored, key=lambda item: (-item[1].total, item[0].canonical_company_name.casefold())))
