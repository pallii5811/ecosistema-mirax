"""Fail-closed persistence for candidate -> evidence -> publication lifecycle."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

from contracts.signal_ontology import canonical_signal_id
from contracts.source_registry import load_source_registry
from careers_host import is_careers_only_host

_EXPLICIT_SIZE_CONSTRAINT_RE = re.compile(
    r"\b(?:"
    r"pmi|sme|microimprese?|"
    r"piccol[ae]\s+(?:imprese|aziende|impresa|azienda)|"
    r"medie\s+(?:imprese|aziende)|"
    r"piccola\s+(?:impresa|azienda)|"
    r"media\s+(?:impresa|azienda)|"
    r"multinazional[ei]|grande\s+gruppo"
    r")\b",
    re.I,
)

def plan_requires_explicit_size_constraint(canonical_plan: Dict[str, Any]) -> bool:
    """Size policy applies only when the user query or attributes ask for it."""
    raw_query = str(canonical_plan.get("raw_query") or "")
    if _EXPLICIT_SIZE_CONSTRAINT_RE.search(raw_query):
        return True
    target = canonical_plan.get("target") if isinstance(canonical_plan.get("target"), dict) else {}
    for item in target.get("required_attributes") or []:
        if _EXPLICIT_SIZE_CONSTRAINT_RE.search(str(item or "")):
            return True
    return False


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_domain(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if not re.match(r"^https?://", raw, re.I):
        raw = f"https://{raw}"
    try:
        host = (urlparse(raw).hostname or "").lower().strip(".")
    except ValueError:
        return ""
    if host.startswith("www."):
        host = host[4:]
    return host if "." in host and " " not in host else ""


_SOURCE_CLASS_ALIASES = {
  # Semantic adapters emit recognized_news; lifecycle registry uses industry_publication.
    "recognized_news": "industry_publication",
    "generic_web_research": "industry_publication",
}


def _source_class(value: Any, source_url: str) -> str:
    requested = str(value or "").strip().lower()
    requested = _SOURCE_CLASS_ALIASES.get(requested, requested)
    registry = load_source_registry()
    if requested in registry:
        return requested
    domain = canonical_domain(source_url)
    if domain in {"google.com", "google.it", "bing.com", "search.yahoo.com"} or "/search?" in source_url:
        return "search_snippet"
    if any(term in domain for term in ("anac", "acquistinretepa", "ted.europa")):
        return "public_procurement_portal"
    if any(term in domain for term in ("indeed", "linkedin", "infojobs")):
        return "job_board"
    return "unknown_source"


def _valid_observed_at(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _evidence_is_fresh(item: Dict[str, Any], maximum_age_days: Dict[str, Any]) -> bool:
    observed = _valid_observed_at(item.get("observed_at"))
    if not observed:
        return False
    signal_id = canonical_signal_id(str(item.get("signal_type") or "")) or str(item.get("signal_type") or "")
    try:
        max_age = max(1, int(maximum_age_days.get(signal_id) or 365))
        parsed = datetime.fromisoformat(observed)
        return (datetime.now(timezone.utc) - parsed).total_seconds() <= max_age * 86400
    except (TypeError, ValueError):
        return False


def _iter_signal_evidence(lead: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    top_url = str(lead.get("source_url") or "").strip()
    top_excerpt = str(lead.get("evidence") or lead.get("why_now") or "").strip()
    top_date = _valid_observed_at(lead.get("evidence_date") or lead.get("last_audited_at"))
    for signal in lead.get("business_signals") or []:
        if not isinstance(signal, dict):
            continue
        signal_type = str(signal.get("type") or signal.get("signalType") or "").strip()
        source_url = str(signal.get("source_url") or signal.get("sourceUrl") or top_url).strip()
        excerpt = str(signal.get("evidence") or signal.get("description") or top_excerpt).strip()
        observed_at = _valid_observed_at(signal.get("observed_at") or signal.get("date") or top_date)
        published_at = _valid_observed_at(signal.get("published_at") or signal.get("publication_date"))
        status = str(signal.get("status") or "confirmed").strip().lower()
        confidence = float(signal.get("confidence") or lead.get("signal_confidence") or 0.8)
        if signal_type and source_url and observed_at and excerpt:
            source_class = _source_class(signal.get("source_class") or signal.get("source_type"), source_url)
            publisher = str(signal.get("source_publisher") or "").strip() or canonical_domain(source_url)
            yield {
                "signal_type": signal_type,
                "source_url": source_url,
                "source_class": source_class,
                "source_publisher": publisher,
                "excerpt": excerpt,
                "observed_at": observed_at,
                "published_at": published_at,
                "confidence": max(0.0, min(1.0, confidence / 100 if confidence > 1 else confidence)),
                "fact_type": "observed_fact" if status in {"confirmed", "verified"} else "commercial_inference",
                "claim_type": "buying_signal",
                "claim_value": excerpt,
                "retrieval_method": str(signal.get("retrieval_method") or "http_fetch"),
                "verification_status": "confirmed" if status in {"confirmed", "verified"} else "unverified",
                "contradiction_status": str(signal.get("contradiction_status") or "none"),
                "contradiction_detail": signal.get("contradiction_detail") if isinstance(signal.get("contradiction_detail"), dict) else {},
            }
    if top_url and top_excerpt and top_date:
        for raw_signal in lead.get("matched_signals") or lead.get("required_signals") or ["company_identity"]:
            yield {
                "signal_type": str(raw_signal),
                "source_url": top_url,
                "source_class": _source_class(lead.get("source_class") or lead.get("source_lane"), top_url),
                "source_publisher": canonical_domain(top_url),
                "excerpt": top_excerpt,
                "observed_at": top_date,
                "published_at": _valid_observed_at(lead.get("published_at") or lead.get("publication_date")),
                "confidence": float(lead.get("signal_confidence") or 0.8),
                "fact_type": "observed_fact",
                "claim_type": "buying_signal",
                "claim_value": top_excerpt,
                "retrieval_method": str(lead.get("retrieval_method") or "http_fetch"),
                "verification_status": "confirmed",
                "contradiction_status": str(lead.get("contradiction_status") or "none"),
                "contradiction_detail": lead.get("contradiction_detail") if isinstance(lead.get("contradiction_detail"), dict) else {},
            }


def evidence_records(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in _iter_signal_evidence(lead):
        key = (item["signal_type"], item["source_url"], item["claim_value"])
        if key in seen:
            continue
        seen.add(key)
        item["content_hash"] = hashlib.sha256(
            json.dumps(key, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        out.append(item)
    primary_classes = {
        "official_company_website", "official_registry", "public_procurement_portal",
        "municipal_register", "company_careers", "technology_audit", "ad_transparency_library",
    }
    publishers_by_signal: Dict[str, set[str]] = {}
    for item in out:
        signal_id = canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])
        publishers_by_signal.setdefault(signal_id, set()).add(str(item["source_publisher"]))
    for item in out:
        signal_id = canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])
        if len(publishers_by_signal.get(signal_id, set())) >= 2:
            item["verification_status"] = "corroborated"
        elif item["source_class"] in primary_classes:
            item["verification_status"] = "primary_source_verified"
        else:
            item["verification_status"] = "single_source"
        item["fact_category"] = str(item["fact_type"]).upper()
    return out


def _required_signal_match_mode(canonical_plan: Dict[str, Any]) -> str:
    """Preserve explicit OR semantics without weakening explicit AND queries."""
    query = str(canonical_plan.get("raw_query") or "").lower()
    if re.search(r"\b(?:o|oppure|or)\b", query):
        return "any"
    return "all"


_SEO_GROUP_SIGNALS = frozenset({"website_weakness", "seo_errors", "site_stale"})
_TRACKING_ABSENCE_SIGNALS = frozenset({
    "missing_advertising_pixel", "missing_analytics", "no_pixel", "no_gtm",
})
_DIGITAL_AUDIT_ADAPTER_ID = "legacy_digital_audit_v1"


def _signal_groups_from_plan(canonical_plan: Dict[str, Any]) -> Optional[List[List[str]]]:
    technical = canonical_plan.get("technical_filters") if isinstance(canonical_plan.get("technical_filters"), dict) else {}
    groups = technical.get("signal_groups")
    if isinstance(groups, list) and groups:
        return [[str(item) for item in group] for group in groups if isinstance(group, (list, tuple))]
    signals = canonical_plan.get("signal_policy", {}).get("required_signals") or []
    seo = [str(item) for item in signals if str(item) in _SEO_GROUP_SIGNALS]
    tracking = [str(item) for item in signals if str(item) in _TRACKING_ABSENCE_SIGNALS]
    if seo and tracking:
        return [seo, tracking]
    return None


def _signal_groups_satisfied(groups: List[List[str]], observed: set[str]) -> bool:
    for group in groups:
        if not any(str(signal) in observed for signal in group):
            return False
    return True


def _required_digital_audit_signals_satisfied(
    canonical_plan: Dict[str, Any],
    observed: set[str],
) -> bool:
    """Validate Digital Audit signal intent for grouped and single-lane plans."""
    groups = _signal_groups_from_plan(canonical_plan)
    if groups:
        return _signal_groups_satisfied(groups, observed)
    required = {
        canonical_signal_id(str(value)) or str(value)
        for value in canonical_plan.get("signal_policy", {}).get("required_signals") or ()
    }
    if not required:
        return False
    if _required_signal_match_mode(canonical_plan) == "any":
        return bool(required.intersection(observed))
    return required.issubset(observed)


def _geography_matches_target(lead: Dict[str, Any], canonical_plan: Dict[str, Any]) -> bool:
    target = canonical_plan.get("target") if isinstance(canonical_plan.get("target"), dict) else {}
    geographies = [str(item).strip().lower() for item in target.get("geographies") or [] if str(item).strip()]
    if not geographies:
        return True
    if str(lead.get("source_adapter_id") or "") == "structured_hiring_v1":
        try:
            from source_adapters.hiring_qualification import evaluate_vacancy_geography
        except ImportError:  # package-mode tests
            from backend_mirror.source_adapters.hiring_qualification import evaluate_vacancy_geography
        return bool(evaluate_vacancy_geography(
            location=str(lead.get("citta") or lead.get("location") or ""),
            title=str(lead.get("vacancy_title") or lead.get("hiring_title") or ""),
            address_locality=str(lead.get("address_locality") or ""),
            address_region=str(lead.get("address_region") or ""),
            address_country=str(lead.get("address_country") or ""),
            additional_locations=lead.get("additional_locations") or (),
            source_url=str(lead.get("vacancy_url") or ""),
            geographies=geographies,
        ))
    requested_evidence = {
        str(item).strip().casefold()
        for item in lead.get("requested_geographies") or ()
        if str(item).strip()
    }
    if lead.get("geography_match") is True and requested_evidence.intersection(geographies):
        return True
    if str(lead.get("geography_rejection_code") or "") in {"GEO_OUT_OF_SCOPE", "GEO_UNVERIFIED"}:
        return False
    # Compatibility fallback for payloads created before acquisition
    # provenance was persisted.  Exact locality equality remains valid for any
    # municipality string; no internal registration is required.
    values = [
        str(lead.get(key) or "").strip().casefold()
        for key in ("address_locality", "municipality", "citta", "city", "location")
        if str(lead.get(key) or "").strip()
    ]
    return any(geo == value for geo in geographies for value in values)


def _is_category_scoped_digital_audit(lead: Dict[str, Any], canonical_plan: Dict[str, Any]) -> bool:
    adapter_id = str(lead.get("source_adapter_id") or "").strip()
    if adapter_id == _DIGITAL_AUDIT_ADAPTER_ID:
        return True
    source_policy = canonical_plan.get("source_policy") if isinstance(canonical_plan.get("source_policy"), dict) else {}
    allowed = {str(item) for item in source_policy.get("allowed_source_classes") or ()}
    return adapter_id == _DIGITAL_AUDIT_ADAPTER_ID and "technology_audit" in allowed


def _evaluate_category_scoped_digital_audit_buyer_fit(
    lead: Dict[str, Any],
    canonical_plan: Dict[str, Any],
    *,
    identity_positive: bool,
    observed_signals: set[str],
    publishable_evidence: List[Dict[str, Any]],
    unresolved_contradictions: set[str],
) -> Dict[str, Any]:
    """Deterministic buyer fit for category-scoped Digital Audit adapter leads."""
    target = canonical_plan.get("target") if isinstance(canonical_plan.get("target"), dict) else {}
    entity_types = {str(item).strip().lower() for item in target.get("entity_types") or ("company",)}
    entity_type = str(lead.get("entity_type") or lead.get("organization_type") or "company").lower()
    groups = _signal_groups_from_plan(canonical_plan)
    matched = {
        canonical_signal_id(str(value)) or str(value)
        for value in lead.get("matched_signals") or ()
    } | observed_signals
    evidence_signals = {
        canonical_signal_id(str(item.get("signal_type"))) or str(item.get("signal_type"))
        for item in publishable_evidence
    }
    checks = {
        "entity_type_company": entity_type in entity_types or entity_type == "company",
        "target_category_present": bool(target.get("industries")),
        "adapter_category_verified": bool(matched),
        "geography_matches_target": _geography_matches_target(lead, canonical_plan),
        "official_domain_verified": identity_positive,
        "signal_groups_verified": _required_digital_audit_signals_satisfied(canonical_plan, matched),
        "evidence_verifiable": bool(publishable_evidence) and bool(evidence_signals.intersection(matched)),
        "no_critical_contradictions": not unresolved_contradictions,
    }
    # Geography is an independent hard gate.  Keeping it outside buyer fit
    # preserves a precise GEO_* rejection instead of collapsing a location
    # evidence problem into NO_BUYER_FIT.
    passed = all(value for key, value in checks.items() if key != "geography_matches_target")
    score = round(
        70.0
        + (10.0 if checks["signal_groups_verified"] else 0.0)
        + (8.0 if checks["geography_matches_target"] else 0.0)
        + (8.0 if checks["official_domain_verified"] else 0.0)
        + (4.0 if checks["evidence_verifiable"] else 0.0),
        2,
    )
    if passed:
        score = max(score, 88.0)
    return {
        "pass": passed,
        "score": score,
        "method": "category_scoped_digital_audit_deterministic",
        "evidence": checks,
        "target_category": list(target.get("industries") or ()),
        "requested_category": str(lead.get("categoria") or lead.get("category") or "").strip() or None,
        "geography": lead.get("citta") or lead.get("city"),
        "required_signal_groups": groups or [],
        "verified_signals": sorted(matched),
    }


def _causal_offer_link_verified(canonical_plan: Dict[str, Any], matched_signals: set[str]) -> bool:
    seller = canonical_plan.get("seller") if isinstance(canonical_plan.get("seller"), dict) else {}
    if not (
        str(seller.get("offer_category") or "").strip()
        and seller.get("products_or_services")
        and seller.get("problems_solved")
        and seller.get("preferred_buyer_roles")
    ):
        return False
    generic = re.compile(
        r"necessit[aà]\s+(?:commerciale\s+)?implicita|bisogno\s+da\s+(?:confermare|verificare)|"
        r"coerenza\s+(?:da\s+validare|con\s+l[' ]?obiettivo)|richiesta\s+dell[' ]?utente",
        re.I,
    )
    for hypothesis in canonical_plan.get("commercial_hypotheses") or []:
        if not isinstance(hypothesis, dict):
            continue
        hypothesis_signals = {
            canonical_signal_id(str(value)) or str(value)
            for value in hypothesis.get("signals") or []
        }
        causal_fields = [
            str(hypothesis.get("buyer_problem") or "").strip(),
            str(hypothesis.get("implied_need") or "").strip(),
            str(hypothesis.get("relevance_to_offer") or "").strip(),
        ]
        if (
            hypothesis_signals.intersection(matched_signals)
            and hypothesis.get("triggering_events")
            and all(len(value) >= 12 and not generic.search(value) for value in causal_fields)
        ):
            return True
    return False


def positive_entity_classification(
    lead: Dict[str, Any],
    canonical_plan: Dict[str, Any],
    identity_positive: bool,
) -> Dict[str, Any]:
    name = str(lead.get("legal_name") or lead.get("azienda") or lead.get("name") or "").strip()
    entity_type = str(lead.get("entity_type") or lead.get("organization_type") or "company").lower()
    blob = " ".join(
        str(lead.get(key) or "")
        for key in ("entity_type", "organization_type", "categoria", "category", "source_class")
    ).lower()
    recruiter_blob = " ".join(
        str(lead.get(key) or "")
        for key in ("legal_name", "azienda", "name", "source_publisher", "entity_type")
    ).lower()
    flags = {
        "is_media": bool(lead.get("is_media")) or bool(re.search(r"\b(media|giornale|quotidiano|rivista|news)\b", blob)),
        "is_directory": bool(lead.get("is_directory")) or bool(re.search(r"\b(directory|portale|elenco aziende)\b", blob)),
        "is_university": bool(lead.get("is_university")) or bool(re.search(r"\b(universit|ateneo|college)\b", blob)),
        "is_public_body": bool(lead.get("is_public_body")) or bool(re.search(r"\b(comune|ministero|regione|ente pubblico|asl|universit)\b", blob)),
        "is_global_brand": bool(lead.get("is_global_brand") or lead.get("enterprise_excluded")),
        "is_source_publisher": bool(lead.get("is_source_publisher")),
        "is_recruiter": bool(lead.get("is_recruiter")) or bool(
            re.search(r"\b(?:agenzia di selezione|headhunter|recruiter|staffing agency|consulting group)\b", recruiter_blob)
            and lead.get("employer_is_direct") is False
        ),
    }
    raw_size = str(
        lead.get("company_size_class") or lead.get("company_size") or lead.get("dimensione_azienda") or ""
    ).strip().lower()
    employees = lead.get("employee_count") or lead.get("employees") or lead.get("dipendenti_stimati")
    try:
        employee_count = int(re.sub(r"\D+", "", str(employees))) if employees is not None else None
    except (TypeError, ValueError):
        employee_count = None
    if raw_size:
        size_class = raw_size
    elif employee_count is not None:
        size_class = "micro" if employee_count < 10 else "small" if employee_count < 50 else "medium" if employee_count < 250 else "large"
    else:
        size_class = "unknown"
    # Operating-company identity and market scope are separate gates. Missing
    # size evidence must not turn a verified operating company into a
    # non-operating entity; MarketScopeResolver classifies it as LIKELY_SME or
    # AMBIGUOUS_CORPORATE using positive corporate evidence.
    size_ok = size_class not in {"enterprise", "large", "multinational", "global_enterprise"}
    disqualifying = any(flags.values())
    operating_probability = float(lead.get("operating_company_probability") or (0.9 if identity_positive and not disqualifying else 0.0))
    is_operating_buyer = bool(identity_positive and operating_probability >= 0.75 and not disqualifying and entity_type not in {"person", "publisher"})
    domain_verification = lead.get("domain_verification") if isinstance(lead.get("domain_verification"), dict) else {}
    return {
        **flags,
        "entity_type": entity_type,
        "operating_company_probability": max(0.0, min(1.0, operating_probability)),
        "official_domain_confidence": float(domain_verification.get("confidence") or 0.0),
        "company_size_class": size_class,
        "local_presence": {
            "city": lead.get("citta") or lead.get("city"),
            "address": lead.get("indirizzo") or lead.get("address"),
            "verified": bool(lead.get("citta") or lead.get("city") or lead.get("indirizzo") or lead.get("address")),
        },
        "is_operating_buyer": is_operating_buyer,
        "classification_verified": is_operating_buyer,
        "size_policy_passed": size_ok,
        "name": name,
    }


_TRUSTED_SOURCE_ADAPTER_DOMAIN_PROOFS = {
    "legacy_digital_audit_v1": (
        {"maps_business_website", "direct_website_audit"},
    ),
    "structured_hiring_v1": (
        {"schema_org_identity_match"},
        {"company_careers_host_match", "legal_name_in_page"},
        {"employer_corporate_domain_resolved", "vacancy_source_verified"},
        {"careers_subdomain_corporate_link", "vacancy_source_verified"},
    ),
    "official_growth_signals_v1": (
        {"schema_org_identity_match", "official_page_host_match"},
    ),
    "generic_web_research_v1": (
        {"schema_org_identity_match", "official_page_host_match"},
    ),
}


def _free_owned_host_identity(lead: Dict[str, Any], identity: Dict[str, Any], domain: str) -> bool:
    """generic_web post-semantic identity via owned-host verification (no paid SERP)."""
    if str(lead.get("source_adapter_id") or "").strip() != "generic_web_research_v1":
        return False
    if str(identity.get("adapter_id") or "").strip() not in {"", "generic_web_research_v1"}:
        return False
    if str(identity.get("status") or "").lower() != "verified":
        return False
    method = str(identity.get("resolution_method") or "")
    # cache_lookup replays a prior free_owned_host_verification. Rejecting it
    # failed Latterie Vicentine publication after orchestrator already qualified
    # the lead (antincendio canary e8ab8d94).
    if method not in {"free_owned_host_verification", "cache_lookup"}:
        return False
    if not domain or canonical_domain(identity.get("url")) != domain:
        return False
    evidence = {str(value) for value in identity.get("evidence") or ()}
    return bool(
        evidence.intersection({"company_tokens_in_host", "legal_name_in_page", "official_site_markers"})
        or "free_owned_host_candidate" in evidence
    )


def _trusted_source_adapter_identity(lead: Dict[str, Any], identity: Dict[str, Any]) -> bool:
    """Accept adapter identity only when the adapter and its proof contract agree."""
    adapter_id = str(lead.get("source_adapter_id") or "").strip()
    if adapter_id not in _TRUSTED_SOURCE_ADAPTER_DOMAIN_PROOFS:
        return False
    if str(identity.get("adapter_id") or "").strip() != adapter_id:
        return False
    if str(identity.get("resolution_source") or "") != "source_adapter":
        return False
    if str(identity.get("resolution_method") or "") != "verified_source_adapter":
        return False
    evidence = {str(value) for value in identity.get("evidence") or []}
    return any(
        required.issubset(evidence)
        for required in _TRUSTED_SOURCE_ADAPTER_DOMAIN_PROOFS[adapter_id]
    )


def evaluate_publication_gate(
    lead: Dict[str, Any],
    canonical_plan: Dict[str, Any],
    *,
    cost_within_budget: bool = False,
) -> Dict[str, Any]:
    from lead_acceptance_service import default_market_scope_policy, evaluate_lead

    decision = evaluate_lead(
        lead,
        canonical_plan,
        market_scope_policy=default_market_scope_policy(canonical_plan),
        cost_within_budget=cost_within_budget,
    )
    gate = dict(decision.publication_gate or {})
    gate.update(
        {
            "publishable": decision.accepted,
            "failures": [] if decision.accepted else (gate.get("failures") or ["lead_acceptance_rejected"]),
            "rejection_codes": decision.rejection_codes,
            "canonical_domain": decision.official_domain or gate.get("canonical_domain"),
            "market_scope_status": decision.market_scope_status,
            "commercial_event_status": decision.commercial_event_status,
            "intent_strength": decision.intent_strength,
            "lead_acceptance": decision.to_dict(),
        }
    )
    return gate


def _evaluate_publication_gate_core(
    lead: Dict[str, Any],
    canonical_plan: Dict[str, Any],
    *,
    cost_within_budget: bool = False,
) -> Dict[str, Any]:
    domain = canonical_domain(
        lead.get("official_domain")
        or lead.get("employer_official_domain")
        or lead.get("sito")
        or lead.get("website")
    )
    if domain and is_careers_only_host(domain):
        domain = ""
    identity = lead.get("domain_verification") if isinstance(lead.get("domain_verification"), dict) else {}
    quality = lead.get("lead_quality_contract") if isinstance(lead.get("lead_quality_contract"), dict) else {}
    semantic_contract = (
        canonical_plan.get("semantic_query_contract")
        if isinstance(canonical_plan.get("semantic_query_contract"), dict)
        else None
    )
    required_raw = canonical_plan.get("signal_policy", {}).get("required_signals") or []
    if not required_raw and semantic_contract is not None:
        required_raw = semantic_contract.get("required_relationships") or []
    required = {canonical_signal_id(str(value)) or str(value) for value in required_raw}
    records = evidence_records(lead)
    observed = {
        canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])
        for item in records
        if item["fact_type"] == "observed_fact"
    }
    contradictory_signals = {
        canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])
        for item in records
        if item.get("contradiction_status") in {"suspected", "confirmed"}
    }
    resolved_contradictions = {
        canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])
        for item in records
        if item.get("verification_status") == "corroborated"
        and (item.get("contradiction_detail") or {}).get("resolution_status") == "resolved"
    }
    unresolved_contradictions = contradictory_signals - resolved_contradictions
    observed -= unresolved_contradictions
    evidence_blob = " ".join(
        str(value or "") for value in (
            lead.get("evidence"), lead.get("hiring_title"), lead.get("why_now"),
            *(item.get("excerpt") for item in records),
        )
    ).lower()
    hiring_role_patterns = {
        "hiring_operational": r"\b(autist|operai|tecnic|magazzin|hse|sicurezza|cantiere|installator|manutentor)",
        "hiring_sales": r"\b(sdr|bdr|sales|commercial|business development|account manager|outbound)",
        "hiring_marketing": r"\b(marketing|growth|ecommerce|seo|social media|advertising)",
        "hiring_technology": r"\b(developer|sviluppator|software|data engineer|cyber|it manager|cloud)",
    }
    satisfied_required = set(observed)
    if "hiring" in observed:
        for specialized, pattern in hiring_role_patterns.items():
            if re.search(pattern, evidence_blob, re.I):
                satisfied_required.add(specialized)
    evidence_policy = canonical_plan.get("evidence_policy") or {}
    source_policy = canonical_plan.get("source_policy") or {}
    allowed_sources = set(source_policy.get("allowed_source_classes") or [])
    maximum_age_days = canonical_plan.get("signal_policy", {}).get("maximum_age_days_by_signal") or {}
    minimum_confidence = float(evidence_policy.get("minimum_evidence_confidence") or 0.7)
    publishable_evidence = [
        item for item in records
        if item["fact_type"] == "observed_fact"
        and item["verification_status"] in {"single_source", "primary_source_verified", "corroborated"}
        and item["confidence"] >= minimum_confidence
        and item["source_class"] in allowed_sources
        and item["source_class"] not in {"search_snippet", "generic_blog", "directory", "unknown_source"}
        and str(item["source_url"]).startswith(("http://", "https://"))
        and bool(item["source_publisher"])
        and bool(item["observed_at"])
        and _evidence_is_fresh(item, maximum_age_days)
        and item["contradiction_status"] == "none"
    ]
    minimum_sources = max(1, int(source_policy.get("minimum_independent_sources") or 1))
    independent_publishers = {item["source_publisher"] for item in publishable_evidence}
    primary_classes = {
        "official_company_website", "official_registry", "public_procurement_portal",
        "municipal_register", "company_careers", "technology_audit", "ad_transparency_library",
    }
    primary_required = {
        canonical_signal_id(str(value)) or str(value)
        for value in source_policy.get("primary_source_required_for") or []
    }
    primary_satisfied = {
        canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])
        for item in publishable_evidence
        if item["source_class"] in primary_classes
    }
    evidence_contract_passed = (
        bool(publishable_evidence)
        and len(independent_publishers) >= minimum_sources
        and primary_required.intersection(observed).issubset(primary_satisfied)
    )
    report = lead.get("technical_report") if isinstance(lead.get("technical_report"), dict) else {}
    audit_completed = bool(lead.get("last_audited_at")) and report.get("audit_status") not in {
        "pending", "retryable_error", "error"
    }
    identity_evidence = {str(value) for value in identity.get("evidence") or []}
    identity_url_domain = canonical_domain(identity.get("url"))
    ownership_proof = bool(
        identity_evidence.intersection({"company_tokens_in_host", "schema_org_identity_match"})
    )
    legacy_identity_proof = bool(
        str(identity.get("resolution_source") or "") in {"extracted_website", "serp_identity"}
        and str(identity.get("resolution_method") or "") == "positive_page_identity"
        and len(identity_evidence) >= 2
        and ownership_proof
    )
    source_adapter_identity_proof = _trusted_source_adapter_identity(lead, identity)
    free_owned_identity_proof = _free_owned_host_identity(lead, identity, domain)
    identity_positive = bool(
        domain
        and identity_url_domain == domain
        and str(identity.get("status") or "").lower() == "verified"
        and float(identity.get("confidence") or 0) >= 0.70
        and int(identity.get("score") or 0) >= 70
        and (legacy_identity_proof or source_adapter_identity_proof or free_owned_identity_proof)
    )
    entity_classification = positive_entity_classification(lead, canonical_plan, identity_positive)
    groups = _signal_groups_from_plan(canonical_plan)
    match_mode = _required_signal_match_mode(canonical_plan)
    if groups:
        signal_verified = _signal_groups_satisfied(groups, satisfied_required)
    elif match_mode == "any":
        signal_verified = bool(required.intersection(satisfied_required))
    else:
        signal_verified = bool(required) and required.issubset(satisfied_required)
    relevant_signals = required.intersection(satisfied_required) if not groups else satisfied_required
    relevant_evidence = [
        item for item in publishable_evidence
        if (canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])) in relevant_signals
    ]
    why_now = str(lead.get("why_now") or "").strip()
    why_now_present = len(why_now) >= 20 and not re.search(
        r"(?:opportunit[aÃ ]\s+generica|potrebbe\s+avere\s+bisogno|azienda\s+interessante)",
        why_now,
        re.I,
    )
    digital_audit_fit = None
    if _is_category_scoped_digital_audit(lead, canonical_plan):
        digital_audit_fit = _evaluate_category_scoped_digital_audit_buyer_fit(
            lead,
            canonical_plan,
            identity_positive=identity_positive,
            observed_signals=observed,
            publishable_evidence=publishable_evidence,
            unresolved_contradictions=unresolved_contradictions,
        )
    buyer_fit_score = (
        float(digital_audit_fit["score"])
        if digital_audit_fit is not None
        else float(quality.get("score") or 0)
    )
    buyer_fit_verified = (
        bool(digital_audit_fit["pass"])
        if digital_audit_fit is not None
        else buyer_fit_score >= 82
    )
    entity_operating_verified = entity_classification["classification_verified"]
    if digital_audit_fit is not None and digital_audit_fit["pass"]:
        entity_operating_verified = True
    causal_offer_link = _causal_offer_link_verified(canonical_plan, relevant_signals)
    if digital_audit_fit is not None and digital_audit_fit["pass"]:
        causal_offer_link = True
    semantic_grounding = (
        lead.get("semantic_grounding")
        if isinstance(lead.get("semantic_grounding"), dict)
        else report.get("semantic_grounding")
        if isinstance(report.get("semantic_grounding"), dict)
        else {}
    )
    semantic_authority_passed = (
        True if semantic_contract is None else semantic_grounding.get("accepted") is True
    )
    if semantic_authority_passed and semantic_contract is not None and relevant_evidence:
        # The common semantic gate has already verified query relationship,
        # role, evidence offsets and rubric.  Do not force a dynamic open-world
        # predicate back through the legacy closed-catalog offer linker.
        causal_offer_link = True
    gates = {
        "official_domain_verified": identity_positive,
        "buyer_fit_verified": buyer_fit_verified,
        "entity_operating_verified": entity_operating_verified,
        "relevant_buying_signal_present": signal_verified,
        "signal_semantically_linked_to_seller_offer": causal_offer_link,
        "evidence_supports_signal": evidence_contract_passed and bool(relevant_evidence),
        "source_url_verified": bool(relevant_evidence) and all(str(item["source_url"]).startswith(("http://", "https://")) for item in relevant_evidence),
        "source_publisher_known": bool(relevant_evidence) and all(bool(item["source_publisher"]) for item in relevant_evidence),
        "freshness_pass": bool(relevant_evidence) and all(_evidence_is_fresh(item, maximum_age_days) for item in relevant_evidence),
        "why_now_present": why_now_present,
        "audit_completed": audit_completed,
        "no_critical_contradictions": not unresolved_contradictions,
        "cost_within_budget": cost_within_budget,
        "semantic_authority_passed": semantic_authority_passed,
    }
    if str(lead.get("source_adapter_id") or "") in {"structured_hiring_v1", _DIGITAL_AUDIT_ADAPTER_ID}:
        gates["geography_matches_target"] = _geography_matches_target(lead, canonical_plan)
    failures = [key for key, passed in gates.items() if not passed]
    reason_codes = {
        "official_domain_verified": "OFFICIAL_DOMAIN_UNRESOLVED",
        "buyer_fit_verified": "NO_BUYER_FIT",
        "entity_operating_verified": "ENTITY_NOT_OPERATING",
        "relevant_buying_signal_present": "NO_RELEVANT_SIGNAL",
        "signal_semantically_linked_to_seller_offer": "NO_PROBLEM_FIT",
        "evidence_supports_signal": "EVIDENCE_MISMATCH",
        "source_url_verified": "SOURCE_NOT_VERIFIABLE",
        "source_publisher_known": "SOURCE_NOT_VERIFIABLE",
        "freshness_pass": "SIGNAL_NOT_FRESH",
        "why_now_present": "NO_PROBLEM_FIT",
        "audit_completed": "SOURCE_NOT_VERIFIABLE",
        "no_critical_contradictions": "CRITICAL_CONTRADICTION",
        "cost_within_budget": "COST_GATE_FAILED",
        "semantic_authority_passed": "SEMANTIC_QUERY_MISMATCH",
        "geography_matches_target": "GEO_OUT_OF_SCOPE",
    }
    geography_rejection = str(lead.get("geography_rejection_code") or "").strip()
    if "geography_matches_target" in failures:
        reason_codes["geography_matches_target"] = (
            geography_rejection
            if geography_rejection in {"GEO_OUT_OF_SCOPE", "GEO_UNVERIFIED"}
            else "GEO_UNVERIFIED"
        )
    rejection_codes = list(dict.fromkeys(reason_codes[key] for key in failures))
    buyer_fit_detail = {
        "buyer_fit_method": digital_audit_fit["method"] if digital_audit_fit else "lead_quality_contract_score",
        "buyer_fit_evidence": digital_audit_fit["evidence"] if digital_audit_fit else {"score": buyer_fit_score},
        "buyer_fit_score": buyer_fit_score,
        "buyer_fit_pass": buyer_fit_verified,
    }
    return {
        **gates,
        **buyer_fit_detail,
        "publishable": not failures,
        "failures": failures,
        "rejection_codes": rejection_codes,
        "signal_match_mode": match_mode,
        "canonical_domain": domain,
        "evidence": publishable_evidence,
        "digital_audit_buyer_fit": digital_audit_fit,
        "entity_resolution": {
            "legal_name": str(lead.get("legal_name") or lead.get("azienda") or lead.get("name") or "").strip(),
            "official_domain": domain,
            "resolution_method": identity.get("resolution_method"),
            "resolution_source": identity.get("resolution_source"),
            "confidence": identity.get("confidence"),
            "positive_signals": sorted(identity_evidence),
            "identity_source_url": identity.get("url"),
            # ponytail: adapters must set resolved_at; fallback keeps DB identity gate insertable
            "resolved_at": identity.get("resolved_at") or (_iso_now() if identity_positive else None),
        },
        "entity_classification": entity_classification,
        "contradiction_resolution": {
            "detected_signals": sorted(contradictory_signals),
            "resolved_signals": sorted(resolved_contradictions),
            "unresolved_signals": sorted(unresolved_contradictions),
        },
    }


def _execute_data(response: Any) -> List[Dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


class _Response:
    def __init__(self, data: Any):
        self.data = data


def _candidate_stage(gate: Dict[str, Any], *, shadow_mode: bool) -> str:
    if not gate["publishable"]:
        return "rejected"
    method = str(gate["entity_resolution"].get("resolution_method") or "")
    if shadow_mode and method in {"verified_source_adapter", "free_owned_host_verification"}:
        return "evidence_verified"
    return "qualified"


def _persist_gated_lead(
    supabase: Any,
    *,
    search_id: str,
    user_id: Optional[str],
    lead: Dict[str, Any],
    gate: Dict[str, Any],
    shadow_mode: bool,
) -> Optional[Dict[str, Any]]:
    domain = gate.get("canonical_domain")
    if not domain:
        return None
    existing = _execute_data(
        supabase.table("search_candidates")
        .select("id")
        .eq("search_id", search_id)
        .eq("canonical_domain", domain)
        .limit(1)
        .execute()
    )
    payload = {
        "search_id": search_id,
        "user_id": user_id,
        "canonical_domain": domain,
        "entity_name": str(lead.get("azienda") or lead.get("name") or lead.get("nome") or domain)[:300],
        "entity_type": gate["entity_classification"]["entity_type"],
        "stage": _candidate_stage(gate, shadow_mode=shadow_mode),
        "official_domain_verified": gate["official_domain_verified"],
        "legal_name": gate["entity_resolution"]["legal_name"][:300] or None,
        "entity_resolution_method": gate["entity_resolution"]["resolution_method"],
        "entity_resolution_confidence": gate["entity_resolution"]["confidence"],
        "positive_identity_signals": gate["entity_resolution"]["positive_signals"],
        "identity_source_url": gate["entity_resolution"]["identity_source_url"],
        "identity_resolved_at": gate["entity_resolution"]["resolved_at"],
        "operating_company_probability": gate["entity_classification"]["operating_company_probability"],
        "official_domain_confidence": gate["entity_classification"]["official_domain_confidence"],
        "company_size_class": gate["entity_classification"]["company_size_class"],
        "local_presence": gate["entity_classification"]["local_presence"],
        "is_media": gate["entity_classification"]["is_media"],
        "is_directory": gate["entity_classification"]["is_directory"],
        "is_university": gate["entity_classification"]["is_university"],
        "is_public_body": gate["entity_classification"]["is_public_body"],
        "is_global_brand": gate["entity_classification"]["is_global_brand"],
        "is_source_publisher": gate["entity_classification"]["is_source_publisher"],
        "is_operating_buyer": gate["entity_classification"]["is_operating_buyer"],
        "target_fit_verified": gate["buyer_fit_verified"],
        "signal_verified": gate["relevant_buying_signal_present"],
        "evidence_policy_passed": gate["evidence_supports_signal"],
        "audit_completed": gate["audit_completed"],
        "buyer_offer_fit_score": min(1.0, float(gate.get("buyer_fit_score") or 0) / 100),
        "rejection_code": None if gate["publishable"] else gate["rejection_codes"][0],
        "rejection_detail": {
            "failed_gates": gate["failures"],
            "reason_codes": gate["rejection_codes"],
            "signal_match_mode": gate["signal_match_mode"],
            "buyer_fit_method": gate.get("buyer_fit_method"),
            "buyer_fit_evidence": gate.get("buyer_fit_evidence"),
            "buyer_fit_score": gate.get("buyer_fit_score"),
            "buyer_fit_pass": gate.get("buyer_fit_pass"),
        },
        "payload": lead,
        "updated_at": _iso_now(),
    }
    if existing:
        candidate_id = existing[0]["id"]
        _execute_data(supabase.table("search_candidates").update(payload).eq("id", candidate_id).execute())
    else:
        rows = _execute_data(supabase.table("search_candidates").insert(payload).execute())
        candidate_id = rows[0]["id"] if rows else None
    if not candidate_id:
        return None
    for evidence in gate["evidence"]:
        evidence_payload = {
            "search_id": search_id,
            "candidate_id": candidate_id,
            "signal_type": canonical_signal_id(evidence["signal_type"]) or evidence["signal_type"],
            "fact_type": evidence["fact_type"],
            "source_url": evidence["source_url"],
            "source_class": evidence["source_class"],
            "claim_type": evidence["claim_type"],
            "claim_value": evidence["claim_value"][:4000],
            "source_publisher": evidence["source_publisher"],
            "published_at": evidence["published_at"],
            "retrieval_method": evidence["retrieval_method"],
            "verification_status": evidence["verification_status"],
            "contradiction_status": evidence["contradiction_status"],
            "contradiction_detail": evidence.get("contradiction_detail") or {},
            "evidence_excerpt": evidence["excerpt"][:2000],
            "observed_at": evidence["observed_at"],
            "confidence": evidence["confidence"],
            "is_primary_source": evidence["source_class"] in {
                "official_company_website", "official_registry", "public_procurement_portal",
                "municipal_register", "company_careers", "technology_audit", "ad_transparency_library",
            },
            "content_hash": evidence["content_hash"],
        }
        try:
            supabase.table("search_evidence").upsert(
                evidence_payload,
                on_conflict="candidate_id,signal_type,source_url,content_hash",
            ).execute()
        except Exception:
            pass
    if not gate["publishable"]:
        return None
    if shadow_mode:
        stamped = dict(lead)
        stamped["_lead_acceptance"] = gate.get("lead_acceptance")
        stamped["_lead_acceptance_authority"] = "LeadAcceptanceService"
        stamped["market_scope_status"] = gate.get("market_scope_status")
        return stamped
    try:
        supabase.rpc("publish_search_candidate", {"p_candidate_id": candidate_id}).execute()
        stamped = dict(lead)
        stamped["_lead_acceptance"] = gate.get("lead_acceptance")
        stamped["_lead_acceptance_authority"] = "LeadAcceptanceService"
        stamped["market_scope_status"] = gate.get("market_scope_status")
        return stamped
    except Exception:
        return None


def persist_and_publish_candidates(
    supabase: Any,
    *,
    search_id: str,
    user_id: Optional[str],
    leads: List[Dict[str, Any]],
    canonical_plan: Dict[str, Any],
    shadow_mode: bool = False,
) -> List[Dict[str, Any]]:
    """Persist candidates behind the canonical gate.

    Production returns only rows published by the atomic RPC. Evaluation
    shadows may persist a nullable-owner candidate and return only qualified
    payloads, but must never invoke the publication RPC.
    """
    if not user_id and not shadow_mode:
        return []
    from lead_acceptance.publication import evaluate_and_publish

    raw_query = str(canonical_plan.get("raw_query") or "")
    require_contact = bool(
        re.search(r"\b(?:contatto|contatti|email|telefono|phone)\b", raw_query, re.I)
    )
    result = evaluate_and_publish(
        search_id,
        leads,
        canonical_plan,
        requested_count=max(len(leads), 1),
        supabase=supabase,
        user_id=user_id,
        shadow_mode=shadow_mode,
        require_contact=require_contact,
    )
    return result.published_leads
