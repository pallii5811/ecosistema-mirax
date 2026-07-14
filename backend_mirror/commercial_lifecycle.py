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


def _source_class(value: Any, source_url: str) -> str:
    requested = str(value or "").strip().lower()
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
            yield {
                "signal_type": signal_type,
                "source_url": source_url,
                "source_class": source_class,
                "source_publisher": canonical_domain(source_url),
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
    flags = {
        "is_media": bool(lead.get("is_media")) or bool(re.search(r"\b(media|giornale|quotidiano|rivista|news)\b", blob)),
        "is_directory": bool(lead.get("is_directory")) or bool(re.search(r"\b(directory|portale|elenco aziende)\b", blob)),
        "is_university": bool(lead.get("is_university")) or bool(re.search(r"\b(universit|ateneo|college)\b", blob)),
        "is_public_body": bool(lead.get("is_public_body")) or bool(re.search(r"\b(comune|ministero|regione|ente pubblico|asl|universit)\b", blob)),
        "is_global_brand": bool(lead.get("is_global_brand") or lead.get("enterprise_excluded")),
        "is_source_publisher": bool(lead.get("is_source_publisher")),
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
    target = canonical_plan.get("target") if isinstance(canonical_plan.get("target"), dict) else {}
    local_sme_required = bool(target.get("local_business_preference"))
    allowed_sme = {"micro", "small", "medium", "microimpresa", "piccola", "media", "pmi"}
    size_ok = not local_sme_required or size_class in allowed_sme
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
        "classification_verified": is_operating_buyer and size_ok,
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
    ),
    "official_growth_signals_v1": (
        {"schema_org_identity_match", "official_page_host_match"},
    ),
    "generic_web_research_v1": (
        {"schema_org_identity_match", "official_page_host_match"},
    ),
}


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
    domain = canonical_domain(lead.get("sito") or lead.get("website"))
    identity = lead.get("domain_verification") if isinstance(lead.get("domain_verification"), dict) else {}
    quality = lead.get("lead_quality_contract") if isinstance(lead.get("lead_quality_contract"), dict) else {}
    required_raw = canonical_plan.get("signal_policy", {}).get("required_signals") or []
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
    identity_positive = bool(
        domain
        and identity_url_domain == domain
        and str(identity.get("status") or "").lower() == "verified"
        and float(identity.get("confidence") or 0) >= 0.70
        and int(identity.get("score") or 0) >= 70
        and (legacy_identity_proof or source_adapter_identity_proof)
    )
    entity_classification = positive_entity_classification(lead, canonical_plan, identity_positive)
    match_mode = _required_signal_match_mode(canonical_plan)
    signal_verified = (
        bool(required.intersection(satisfied_required))
        if match_mode == "any"
        else bool(required) and required.issubset(satisfied_required)
    )
    relevant_signals = required.intersection(satisfied_required)
    relevant_evidence = [
        item for item in publishable_evidence
        if (canonical_signal_id(str(item["signal_type"])) or str(item["signal_type"])) in relevant_signals
    ]
    why_now = str(lead.get("why_now") or "").strip()
    why_now_present = len(why_now) >= 20 and not re.search(
        r"(?:opportunit[aà]\s+generica|potrebbe\s+avere\s+bisogno|azienda\s+interessante)",
        why_now,
        re.I,
    )
    gates = {
        "official_domain_verified": identity_positive,
        "buyer_fit_verified": float(quality.get("score") or 0) >= 82,
        "entity_operating_verified": entity_classification["classification_verified"],
        "relevant_buying_signal_present": signal_verified,
        "signal_semantically_linked_to_seller_offer": _causal_offer_link_verified(canonical_plan, relevant_signals),
        "evidence_supports_signal": evidence_contract_passed and bool(relevant_evidence),
        "source_url_verified": bool(relevant_evidence) and all(str(item["source_url"]).startswith(("http://", "https://")) for item in relevant_evidence),
        "source_publisher_known": bool(relevant_evidence) and all(bool(item["source_publisher"]) for item in relevant_evidence),
        "freshness_pass": bool(relevant_evidence) and all(_evidence_is_fresh(item, maximum_age_days) for item in relevant_evidence),
        "why_now_present": why_now_present,
        "audit_completed": audit_completed,
        "no_critical_contradictions": not unresolved_contradictions,
        "cost_within_budget": cost_within_budget,
    }
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
    }
    rejection_codes = list(dict.fromkeys(reason_codes[key] for key in failures))
    return {
        **gates,
        "publishable": not failures,
        "failures": failures,
        "rejection_codes": rejection_codes,
        "signal_match_mode": match_mode,
        "canonical_domain": domain,
        "evidence": publishable_evidence,
        "entity_resolution": {
            "legal_name": str(lead.get("legal_name") or lead.get("azienda") or lead.get("name") or "").strip(),
            "official_domain": domain,
            "resolution_method": identity.get("resolution_method"),
            "resolution_source": identity.get("resolution_source"),
            "confidence": identity.get("confidence"),
            "positive_signals": sorted(identity_evidence),
            "identity_source_url": identity.get("url"),
            "resolved_at": identity.get("resolved_at"),
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
    budget_rows = _execute_data(
        supabase.table("search_budget_state")
        .select("hard_cost_eur,committed_cost_eur,status")
        .eq("search_id", search_id)
        .limit(1)
        .execute()
    )
    budget = budget_rows[0] if budget_rows else {}
    try:
        cost_within_budget = bool(
            budget
            and float(budget.get("committed_cost_eur") or 0) <= float(budget.get("hard_cost_eur") or -1)
            and str(budget.get("status") or "").lower() not in {"halted", "failed"}
        )
    except (TypeError, ValueError):
        cost_within_budget = False
    released: List[Dict[str, Any]] = []
    for lead in leads:
        if not isinstance(lead, dict):
            continue
        gate = evaluate_publication_gate(lead, canonical_plan, cost_within_budget=cost_within_budget)
        domain = gate["canonical_domain"]
        if not domain:
            continue
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
            "stage": "qualified" if gate["publishable"] else "rejected",
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
            "buyer_offer_fit_score": min(1.0, float((lead.get("hotness_score") or 0)) / 100),
            "rejection_code": None if gate["publishable"] else gate["rejection_codes"][0],
            "rejection_detail": {
                "failed_gates": gate["failures"],
                "reason_codes": gate["rejection_codes"],
                "signal_match_mode": gate["signal_match_mode"],
            },
            "payload": lead,
            "updated_at": _iso_now(),
        }
        if existing:
            candidate_id = existing[0]["id"]
            rows = _execute_data(supabase.table("search_candidates").update(payload).eq("id", candidate_id).execute())
        else:
            rows = _execute_data(supabase.table("search_candidates").insert(payload).execute())
            candidate_id = rows[0]["id"] if rows else None
        if not candidate_id:
            continue
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
        if gate["publishable"] and shadow_mode:
            released.append(lead)
        elif gate["publishable"]:
            try:
                supabase.rpc("publish_search_candidate", {"p_candidate_id": candidate_id}).execute()
                released.append(lead)
            except Exception:
                continue
    return released
