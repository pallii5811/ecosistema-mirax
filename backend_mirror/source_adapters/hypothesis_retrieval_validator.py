"""Fail-closed validation for hypothesis-bound retrieval operations.

The validator runs before a provider call.  It deliberately reasons over the
canonical signal/relationship metadata rather than seller professions or exact
user-query strings.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Mapping, Sequence, Tuple


class EvidenceClaimType(str, Enum):
    DIRECT_DEMAND = "DIRECT_DEMAND"
    SELECTION_PROCESS = "SELECTION_PROCESS"
    OBSERVED_EVENT = "OBSERVED_EVENT"
    COMPANY_ATTRIBUTE = "COMPANY_ATTRIBUTE"
    MARKET_SCOPE = "MARKET_SCOPE"
    IDENTITY = "IDENTITY"
    CONTACT = "CONTACT"
    COMMERCIAL_INFERENCE = "COMMERCIAL_INFERENCE"


@dataclass(frozen=True)
class RetrievalValidation:
    accepted: bool
    code: str = ""
    reasons: Tuple[str, ...] = ()


_CROSS_INTENT_TERMS = {
    "funding": ("funding", "round", "seed round", "ha raccolto", "venture capital"),
    "procurement": ("procurement", "appalto", "bando", "gara", "aggiudicazione"),
    "hiring": ("hiring", "assume", "assunzione", "posizioni aperte", "job posting"),
    "technology": ("crm", "erp", "migrazione", "software", "piattaforma"),
    "expansion": ("stabilimento", "ampliamento", "nuova sede", "capacita produttiva"),
    "marketing": ("seo", "advertising", "pixel", "gtm", "marketing"),
}

_SUPPORT_TERMS = {
    "funding": ("funding", "round", "raccolto", "finanziamento", "investimento"),
    "procurement": ("gara", "appalto", "bando", "rfp", "procurement", "fornitore"),
    "hiring": ("assume", "assunzione", "posizioni aperte", "job", "career", "hiring"),
    "technology": ("adotta", "sceglie", "implementa", "migrazione", "crm", "erp", "piattaforma"),
    "expansion": ("stabilimento", "ampliamento", "espansione", "nuova sede", "impianto", "capacita produttiva"),
    "marketing": ("seo", "advertising", "pixel", "gtm", "analytics", "marketing", "sito"),
}

_ROLE_ALIASES = {
    "investor": ("investor", "investitore", "fondo", "venture capital"),
    "publisher": ("publisher", "editore", "testata", "giornale"),
    "association": ("association", "associazione"),
    "recruiter": ("recruiter", "agenzia per il lavoro", "headhunter"),
    "vendor": ("vendor", "fornitore"),
}


def _items(value: Any) -> Tuple[str, ...]:
    if isinstance(value, str):
        return (value.strip().casefold(),) if value.strip() else ()
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        return tuple(str(item).strip().casefold() for item in value if str(item).strip())
    return ()


def _families(text: str) -> set[str]:
    low = text.casefold()
    # Disambiguate multi-word event phrases before token-family detection.
    # "assume la guida" is a leadership appointment, not a vacancy; an
    # "investimento media/marketing" is advertising, not a capital round.
    low = re.sub(r"\bassume\s+la\s+guida\b", "nomina leadership", low)
    low = re.sub(r"\binvestimento\s+(?:media|marketing|pubblicitario)\b", "campagna marketing", low)
    found: set[str] = set()
    for family, terms in _CROSS_INTENT_TERMS.items():
        if any(re.search(rf"(?<![-\w]){re.escape(term)}\b", low) for term in terms):
            found.add(family)
    return found


def _signal_family(signal: str) -> str:
    low = signal.casefold()
    if "fund" in low or "financ" in low or "capital_invest" in low:
        return "funding"
    if "tender" in low or "procurement" in low or "contract_award" in low:
        return "procurement"
    if "hiring" in low or "vacancy" in low:
        return "hiring"
    if "technology" in low or "crm" in low or "software" in low:
        return "technology"
    if "expansion" in low or "location" in low or "facility" in low:
        return "expansion"
    if any(token in low for token in ("marketing", "advert", "website", "seo", "pixel", "analytics")):
        return "marketing"
    return low


def _source_family(source: str) -> str:
    low = source.casefold()
    aliases = {
        "recognized_local_news": "recognized_news",
        "public_procurement_portal": "procurement_registry",
        "municipal_register": "institutional_source",
        "verified_job_posting": "job_board",
    }
    return aliases.get(low, low)


class HypothesisRetrievalValidator:
    """Reject cross-intent strategies before any paid provider invocation."""

    def validate(self, strategy: Any, hypotheses: Sequence[Mapping[str, Any]]) -> RetrievalValidation:
        hypothesis_id = str(getattr(strategy, "hypothesis_id", "") or "").strip()
        if not hypothesis_id:
            return RetrievalValidation(False, "STRATEGY_INTENT_LEAKAGE", ("missing_hypothesis_id",))
        hypothesis = next(
            (item for item in hypotheses if str(item.get("hypothesis_id") or item.get("id") or "") == hypothesis_id),
            None,
        )
        if hypothesis is None:
            return RetrievalValidation(False, "STRATEGY_INTENT_LEAKAGE", ("unknown_hypothesis_id",))

        signal = str(getattr(strategy, "signal_type", "") or "").strip().casefold()
        allowed = set(_items(hypothesis.get("allowed_signal_families") or hypothesis.get("signals")))
        excluded = set(_items(hypothesis.get("excluded_signal_families")))
        reasons = []
        if not signal or (allowed and signal not in allowed):
            reasons.append("signal_not_allowed")
        if signal in excluded:
            reasons.append("signal_explicitly_excluded")

        event_type = str(getattr(strategy, "event_type", "") or "").strip().casefold()
        supported_events = set(_items(
            hypothesis.get("observable_event_types") or hypothesis.get("triggering_events") or allowed
        ))
        if not event_type:
            reasons.append("missing_event_type")
        elif supported_events and event_type not in supported_events and signal not in supported_events:
            reasons.append("event_not_supported")

        source_class = _source_family(str(getattr(strategy, "source_class", "") or "").strip())
        allowed_sources = {_source_family(item) for item in _items(hypothesis.get("source_classes"))}
        if allowed_sources and source_class not in allowed_sources:
            reasons.append("source_class_not_allowed")

        required_role = str(getattr(strategy, "required_target_role", "") or "").strip().casefold()
        if not required_role:
            reasons.append("missing_target_role")
        prohibited_roles = set(_items(getattr(strategy, "prohibited_roles", ())))
        if required_role and required_role in prohibited_roles:
            reasons.append("target_role_prohibited")

        query = str(getattr(strategy, "search_query", "") or "").strip()
        justification = str(getattr(strategy, "semantic_justification", "") or "").strip()
        if not query:
            reasons.append("empty_query")
        if not justification:
            reasons.append("missing_semantic_justification")

        query_families = _families(query)
        allowed_families = {_signal_family(item) for item in allowed}
        active_family = _signal_family(signal)
        allowed_families.add(active_family)
        leaked = query_families - allowed_families
        if leaked:
            reasons.append("cross_intent_query_terms:" + ",".join(sorted(leaked)))
        positive_query = re.sub(r"(?:^|\s)-[^\s]+", " ", query.casefold())
        support_terms = _SUPPORT_TERMS.get(active_family, ())
        if support_terms and not any(term in positive_query for term in support_terms):
            reasons.append("query_does_not_support_event")
        for role in prohibited_roles:
            role_terms = _ROLE_ALIASES.get(role, (role.replace("_", " "),))
            if any(re.search(rf"\b{re.escape(term)}\b", positive_query) for term in role_terms):
                reasons.append(f"prohibited_role_in_query:{role}")

        if reasons:
            return RetrievalValidation(False, "STRATEGY_INTENT_LEAKAGE", tuple(reasons))
        return RetrievalValidation(True)
