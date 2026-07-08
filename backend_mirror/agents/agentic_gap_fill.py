"""
Phase 5.3 — Agentic gap-fill: WebResearcher + DataExtractor quando Maps non basta.
Streaming incrementale: publish ogni N lead validi.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import zlib
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set
from urllib.parse import urlparse

logger = logging.getLogger("agentic_gap_fill")

AGENTIC_TIMEOUT_SEC = int(os.getenv("AGENTIC_GAP_FILL_TIMEOUT_SEC", "7200") or "7200")
STREAM_BATCH_SIZE = int(os.getenv("AGENTIC_STREAM_BATCH_SIZE", "1") or "1")
AGENTIC_MAX_SCRAPE_PAGES = int(os.getenv("AGENTIC_MAX_SCRAPE_PAGES", "0") or "0")
AGENTIC_PAGE_BUDGET_FACTOR = float(os.getenv("AGENTIC_PAGE_BUDGET_FACTOR", "5") or "5")
AGENTIC_PAGE_BUDGET_MIN = int(os.getenv("AGENTIC_PAGE_BUDGET_MIN", "50") or "50")
AGENTIC_PAGE_BUDGET_HARD_CAP = int(os.getenv("AGENTIC_PAGE_BUDGET_HARD_CAP", "20000") or "20000")
AGENTIC_MAX_EMPTY_ROUNDS = int(os.getenv("AGENTIC_MAX_EMPTY_ROUNDS", "3") or "3")


def compute_agentic_page_budget(remaining_target: int) -> int:
    """Return a target-aware budget while preserving an explicit ops override."""
    if AGENTIC_MAX_SCRAPE_PAGES > 0:
        return min(AGENTIC_PAGE_BUDGET_HARD_CAP, AGENTIC_MAX_SCRAPE_PAGES)
    target = max(1, int(remaining_target or 1))
    dynamic = max(AGENTIC_PAGE_BUDGET_MIN, int(target * AGENTIC_PAGE_BUDGET_FACTOR))
    return min(AGENTIC_PAGE_BUDGET_HARD_CAP, dynamic)


def build_agentic_exhaustion_message(found: int, requested: int) -> str:
    return (
        f"Ricerca esaurita: trovati {found} lead su {requested} richiesti. "
        "Il web non offre altri risultati validi per questa nicchia."
    )


def build_agentic_completion_message(found: int, requested: int, stop_reason: str) -> str:
    if found >= requested:
        return f"Target raggiunto: trovati {found} lead verificabili su {requested} richiesti."
    if stop_reason == "sources_exhausted":
        return build_agentic_exhaustion_message(found, requested)
    if stop_reason == "time_budget":
        return (
            f"Ricerca parziale: trovati {found} lead su {requested}. "
            "Il job ha raggiunto il budget temporale e puo essere ripreso."
        )
    return (
        f"Ricerca parziale: trovati {found} lead su {requested}. "
        "Raggiunto il budget di esplorazione configurato; le fonti non sono dichiarate esaurite."
    )


def build_mirax_query_plan_from_job(
    intent: Optional[Dict[str, Any]],
    category: str,
    location: str,
    *,
    original_query: Optional[str] = None,
) -> Dict[str, Any]:
    """Costruisce MiraxQueryPlan dict dai metadati job worker."""
    intent = intent if isinstance(intent, dict) else {}
    signals: List[str] = []
    for s in intent.get("signals") or []:
        if isinstance(s, dict) and s.get("type"):
            signals.append(str(s["type"]))
        elif isinstance(s, str) and s.strip():
            signals.append(s.strip())
    for s in intent.get("required_signals") or []:
        if isinstance(s, str) and s.strip() and s not in signals:
            signals.append(s.strip())

    hiring_roles: List[str] = []
    for role in intent.get("hiring_roles") or []:
        if isinstance(role, str) and role.strip() and role.strip() not in hiring_roles:
            hiring_roles.append(role.strip())
    target_profile = intent.get("target_profile") if isinstance(intent.get("target_profile"), dict) else {}
    for role in target_profile.get("roles") or []:
        if isinstance(role, str) and role.strip() and role.strip() not in hiring_roles:
            hiring_roles.append(role.strip())
    for signal in intent.get("signals") or []:
        params = signal.get("params") if isinstance(signal, dict) and isinstance(signal.get("params"), dict) else {}
        role = params.get("role")
        if isinstance(role, str) and role.strip() and role.strip() not in hiring_roles:
            hiring_roles.append(role.strip())

    uqe_plan = intent.get("uqe_plan") if isinstance(intent.get("uqe_plan"), dict) else {}
    commercial_hypothesis = (
        uqe_plan.get("commercial_hypothesis")
        if isinstance(uqe_plan.get("commercial_hypothesis"), dict)
        else intent.get("commercial_hypothesis")
        if isinstance(intent.get("commercial_hypothesis"), dict)
        else {}
    )
    ranking_policy = (
        uqe_plan.get("ranking_policy")
        if isinstance(uqe_plan.get("ranking_policy"), dict)
        else intent.get("ranking_policy")
        if isinstance(intent.get("ranking_policy"), dict)
        else {}
    )
    for role in commercial_hypothesis.get("hiring_roles") or []:
        if isinstance(role, str) and role.strip() and role.strip() not in hiring_roles:
            hiring_roles.append(role.strip())

    tech = intent.get("tech_profile") if isinstance(intent.get("tech_profile"), dict) else {}
    technical_filters: Dict[str, Any] = {}
    for key in tech.get("missing") or []:
        k = str(key).lower().strip()
        if k == "meta_pixel":
            technical_filters["has_meta_pixel"] = False
        elif k in ("gtm", "google_tag_manager"):
            technical_filters["has_gtm"] = False
        elif k in ("ga4", "google_analytics"):
            technical_filters["has_google_analytics"] = False
        elif k == "ssl":
            technical_filters["has_ssl"] = False
        else:
            technical_filters.setdefault("technologies", [])
            if isinstance(technical_filters["technologies"], list):
                technical_filters["technologies"].append(k)
    for key in tech.get("has") or []:
        k = str(key).lower().strip()
        if k == "meta_pixel":
            technical_filters["has_meta_pixel"] = True
        elif k in ("gtm", "google_tag_manager"):
            technical_filters["has_gtm"] = True

    query = (
        original_query
        or intent.get("original_query")
        or intent.get("query")
        or uqe_plan.get("original_query")
        or intent.get("intent_summary")
        or f"{category} {location}".strip()
    )

    strategy = str(
        intent.get("search_strategy")
        or uqe_plan.get("search_strategy")
        or "hybrid"
    ).strip()

    return {
        "original_query": str(query).strip(),
        "search_strategy": strategy,
        "sector": str(uqe_plan.get("sector") or category or "").strip(),
        "location": str(uqe_plan.get("location") or location or "").strip(),
        "required_signals": signals,
        "hiring_roles": hiring_roles,
        "research_questions": uqe_plan.get("research_questions") or intent.get("research_questions") or [],
        "source_plan": uqe_plan.get("source_plan") or intent.get("source_plan") or [],
        "commercial_hypothesis": commercial_hypothesis,
        "ranking_policy": ranking_policy,
        "evidence_policy": uqe_plan.get("evidence_policy") or intent.get("evidence_policy") or {
            "require_source_url": True,
            "require_official_domain": True,
            "min_signal_confidence": 0.7,
        },
        "technical_filters": technical_filters,
        "extraction_schema": uqe_plan.get("extraction_schema") or [
            "email", "telefono", "sito", "azienda", "fatturato", "partita_iva",
            "linkedin", "instagram", "facebook", "decision_maker", "evidence",
            "evidence_date", "source_url", "why_now", "pitch_angle",
        ],
        "confidence": float(intent.get("confidence") or uqe_plan.get("confidence") or 0.5),
        "intent_summary": str(intent.get("intent_summary") or uqe_plan.get("intent_summary") or query).strip(),
        "parse_source": "worker",
    }


def _normalize_domain(url: str) -> str:
    from .portal_blacklist import normalize_domain
    return normalize_domain(url)


def _normalize_signal_name(value: Any) -> str:
    signal = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "funding": "funding_received",
        "financing": "funding_received",
        "tender": "tender_won",
        "public_tender": "tender_won",
        "assunzioni": "hiring",
        "job_opening": "hiring",
    }
    return aliases.get(signal, signal)


def _satisfied_required_signals(required: Set[str], matched: Set[str]) -> Set[str]:
    equivalents = {
        "sector_investment": {"sector_investment", "funding_received", "expansion"},
        "investing_marketing": {"investing_marketing", "meta_ads_started", "google_ads_started"},
        "crm_change": {"crm_change", "tech_migration"},
        "expansion": {"expansion", "new_location", "new_company"},
    }
    return {
        signal
        for signal in required
        if matched.intersection(equivalents.get(signal, {signal}))
    }


# ponytail: substring match on normalized host — upgrade path: shared portal_blacklist roots only
_IRON_DOME_PORTAL_ROOTS = (
    "github.", "gitlab.", "stackoverflow.", "medium.", "linkedin.com", "indeed.it", "infojobs.it",
)
_IRON_DOME_GIANT_ROOTS = (
    "amazon.", "google.", "apple.", "microsoft.", "brave.com", "mozilla.", "nttdata.", "bendingspoons.",
)


def _iron_dome_blocked_host(domain: str) -> bool:
    d = (domain or "").lower().strip()
    if not d:
        return True
    for root in _IRON_DOME_PORTAL_ROOTS + _IRON_DOME_GIANT_ROOTS:
        if root in d:
            return True
    return False


def is_valid_b2b_lead(name: str, url: str) -> bool:
    """
    Iron Dome — filtro programmatico zero-tolerance.
    False = scarta in silenzio (log [IRON DOME]) senza bloccare il worker.
    """
    from .domain_resolver import validate_url_reachable
    from .portal_blacklist import is_blacklisted_name, normalize_domain

    label = (name or "").strip()
    target = (url or "").strip()
    if not label or len(label) < 2:
        logger.info("[IRON DOME] Rejected: %s", target or label)
        return False
    if is_blacklisted_name(label):
        logger.info("[IRON DOME] Rejected: %s", target or label)
        return False
    if not target:
        logger.info("[IRON DOME] Rejected: %s", target or label)
        return False

    domain = normalize_domain(target)
    if _iron_dome_blocked_host(domain):
        logger.info("[IRON DOME] Rejected: %s", target)
        return False

    candidate = target if target.startswith("http") else f"https://{domain}"
    if not validate_url_reachable(candidate):
        logger.info("[IRON DOME] Rejected: %s", candidate)
        return False
    return True


def prepare_agentic_extracted_item(
    extracted: Dict[str, Any],
    *,
    location: str = "",
) -> Optional[Dict[str, Any]]:
    """
    USE pipeline: risolve dominio ufficiale se assente/portale.
    Ritorna None se il lead non ha un sito scrapabile.
    """
    if not isinstance(extracted, dict):
        return None
    name = str(extracted.get("name") or "").strip()
    if not name or len(name) < 2:
        return None

    from .domain_resolver import resolve_company_identity
    from .portal_blacklist import is_blacklisted_name

    if is_blacklisted_name(name):
        return None

    out = dict(extracted)
    required = {
        _normalize_signal_name(value)
        for value in out.get("_required_signals") or []
        if _normalize_signal_name(value)
    }
    matched = {
        _normalize_signal_name(value)
        for value in out.get("matched_signals") or []
        if _normalize_signal_name(value)
    }
    if required:
        satisfied = _satisfied_required_signals(required, matched)
        match_mode = str(out.get("_signal_match_mode") or "all").strip().lower()
        signal_ok = bool(satisfied) if match_mode == "any" else len(satisfied) == len(required)
        if not signal_ok:
            logger.info("prepare_agentic: evidence does not match required signals for %r", name[:60])
            return None
    ranking_policy = out.get("_ranking_policy") if isinstance(out.get("_ranking_policy"), dict) else {}
    evidence_date = str(out.get("evidence_date") or "").strip()
    if evidence_date:
        try:
            parsed_date = datetime.fromisoformat(evidence_date.replace("Z", "+00:00"))
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            max_age_days = max(1, int(ranking_policy.get("max_signal_age_days") or 180))
            age_days = (datetime.now(timezone.utc) - parsed_date).total_seconds() / 86400
            if age_days > max_age_days:
                logger.info("prepare_agentic: stale evidence (%sd) for %r", round(age_days), name[:60])
                return None
        except (TypeError, ValueError):
            pass
    website = str(out.get("website") or "").strip()
    identity = resolve_company_identity(name, website, location)
    if not identity:
        logger.info("prepare_agentic: no resolvable domain for %r", name[:60])
        return None
    out["website"] = str(identity.get("url") or "")
    out["domain_verification"] = identity
    out["matched_signals"] = sorted(matched)
    return out


def lead_dedupe_key(name: str = "", website: str = "", azienda: str = "") -> str:
    domain = _normalize_domain(website)
    if domain:
        return f"web:{domain}"
    label = (name or azienda or "").lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", label).strip("-")[:50]
    return f"name:{slug}" if slug else ""


def existing_dedupe_keys(results: List[Dict[str, Any]]) -> Set[str]:
    keys: Set[str] = set()
    for row in results or []:
        if not isinstance(row, dict):
            continue
        k = lead_dedupe_key(
            str(row.get("nome") or ""),
            str(row.get("sito") or row.get("website") or ""),
            str(row.get("azienda") or ""),
        )
        if k:
            keys.add(k)
        name_only = lead_dedupe_key(
            str(row.get("nome") or ""),
            "",
            str(row.get("azienda") or ""),
        )
        if name_only:
            keys.add(name_only)
    return keys


def _infer_hiring_title(extracted: Dict[str, Any]) -> str:
    """Deriva titolo job da hiring_title o evidence."""
    explicit = str(extracted.get("hiring_title") or "").strip()
    if explicit and len(explicit) >= 4:
        return explicit[:200]
    evidence = str(extracted.get("evidence") or "")
    for pattern in (
        r"(?:assume|cerca|ricerca|posizione aperta per|offerta di lavoro(?: per)?)\s+([^.]{4,80})",
        r"(?:Sviluppatore|Developer|Programmatore|Backend|Frontend|Software Engineer)[^.]{0,60}",
    ):
        m = re.search(pattern, evidence, re.I)
        if m:
            title = (m.group(1) if m.lastindex else m.group(0)).strip()
            if len(title) >= 4:
                return title[:200]
    return "Posizione aperta"


def extracted_to_lead_stub(
    extracted: Dict[str, Any],
    *,
    category: str,
    location: str,
) -> Dict[str, Any]:
    name = str(extracted.get("name") or "").strip()
    website = str(extracted.get("website") or "").strip()
    if website and "://" not in website:
        website = f"https://{website}"

    evidence = str(extracted.get("evidence") or "").strip()
    source_url = str(extracted.get("source_url") or "").strip()
    evidence_date = str(extracted.get("evidence_date") or "").strip()
    observed_at = datetime.now(timezone.utc).isoformat()

    signals = extracted.get("matched_signals")
    signal_list = [str(s).lower().strip() for s in signals] if isinstance(signals, list) else []
    ev_lower = evidence.lower()
    has_hiring = "hiring" in signal_list or any(
        kw in ev_lower
        for kw in ("assume", "assunzion", "lavora con noi", "careers", "posizione aperta", "cerca sviluppat")
    )
    has_new_company = "new_company" in signal_list or any(
        kw in ev_lower
        for kw in (
            "costituz",
            "nuova azienda",
            "nuova impresa",
            "appena fondata",
            "iscrizion",
            "startup",
            "nuova societ",
        )
    )
    has_funding = "funding_received" in signal_list or any(
        kw in ev_lower
        for kw in ("finanziament", "round di", "investimento", "capitale", "seed", "serie a", "fondo")
    )

    business_signals: List[Dict[str, Any]] = []
    business_hiring_jobs: Optional[List[Dict[str, str]]] = None
    _confirmed_signal_label = "Nuova Azienda / Finanziamento"

    if has_hiring and evidence:
        job_title = _infer_hiring_title(extracted)
        business_hiring_jobs = [
            {
                "title": job_title,
                "source": "agentic_web_search",
                "url": source_url or website or "",
                "published_at": evidence_date or None,
            }
        ]
        business_signals.append(
            {
                "type": "hiring",
                "status": "confirmed",
                "label": "Assunzioni",
                "source": "agentic_web_search",
                "confidence": 0.85,
                "evidence": evidence[:300],
            }
        )

    if has_new_company:
        business_signals.append(
            {
                "type": "new_company",
                "status": "confirmed",
                "label": _confirmed_signal_label,
                "source": "agentic_web_search",
                "confidence": 0.88,
                "evidence": evidence[:300] if evidence else None,
            }
        )

    if has_funding:
        business_signals.append(
            {
                "type": "funding_received",
                "status": "confirmed",
                "label": _confirmed_signal_label,
                "source": "agentic_web_search",
                "confidence": 0.88,
                "evidence": evidence[:300] if evidence else None,
            }
        )

    structured_signal = extracted.get("structured_signal")
    if isinstance(structured_signal, dict) and structured_signal.get("type"):
        structured_type = str(structured_signal.get("type"))
        business_signals = [s for s in business_signals if str(s.get("type")) != structured_type]
        business_signals.append(dict(structured_signal))

    if not business_signals:
        for s in signal_list:
            if s in {"hiring", "new_company", "funding_received"}:
                continue
            business_signals.append(
                {"type": s, "label": s, "source": "agentic_web_search", "confidence": 0.75}
            )

    city = str(extracted.get("city") or extracted.get("citta") or extracted.get("localita") or "").strip()
    try:
        from entity_matcher import resolve_lead_city
        resolved_city = resolve_lead_city(city or None, None, location if city else None)
    except ImportError:
        resolved_city = city or "N/A"

    stub: Dict[str, Any] = {
        "azienda": name or "N/A",
        "nome": name,
        "sito": website or None,
        "website": website or None,
        "citta": resolved_city,
        "categoria": category or "",
        "category": category or "",
        "tech_stack": ["Verifica in corso"],
        "technical_report": {
            "source": "agentic_web_search",
            "agentic_evidence": evidence[:300],
            "agentic_source_url": source_url,
            "domain_verification": extracted.get("domain_verification"),
        },
        "business_signals": business_signals or None,
        "source": "agentic_web_search",
        "source_lane": extracted.get("source_lane") or (
            "anac_structured" if isinstance(structured_signal, dict) else "web_research"
        ),
        "agentic_evidence": evidence[:300],
        "agentic_source_url": source_url,
        "agentic_evidence_records": [
            {
                "claim": evidence[:300],
                "source_url": source_url,
                "matched_signals": signal_list,
                "evidence_date": evidence_date or None,
                "observed_at": observed_at,
                "domain_verification_status": (
                    extracted.get("domain_verification") or {}
                ).get("status") if isinstance(extracted.get("domain_verification"), dict) else None,
            }
        ],
        "matched_signals": signal_list,
        "lead_object_version": 2,
        "audit_version": 2,
    }
    if business_hiring_jobs:
        stub["business_hiring_jobs"] = business_hiring_jobs
    if extracted.get("partita_iva"):
        stub["partita_iva"] = str(extracted.get("partita_iva")).strip()

    required_signals = {
        _normalize_signal_name(value)
        for value in extracted.get("_required_signals") or []
        if _normalize_signal_name(value)
    }
    matched_normalized = {_normalize_signal_name(value) for value in signal_list if _normalize_signal_name(value)}
    satisfied_signals = _satisfied_required_signals(required_signals, matched_normalized)
    signal_match_mode = str(extracted.get("_signal_match_mode") or "all").strip().lower()
    coverage = (
        1.0 if signal_match_mode == "any" and satisfied_signals else
        len(satisfied_signals) / len(required_signals)
        if required_signals else 1.0
    )
    verification = extracted.get("domain_verification") if isinstance(extracted.get("domain_verification"), dict) else {}
    domain_confidence = float(verification.get("confidence") or 0.0)
    evidence_confidence = 1.0 if evidence and source_url else 0.5 if evidence else 0.0
    query_match_score = round((coverage * 0.6 + domain_confidence * 0.25 + evidence_confidence * 0.15) * 100)
    stub["query_match_score"] = max(0, min(100, query_match_score))
    identity_status = str(verification.get("status") or "")
    stub["query_match_status"] = (
        "verified"
        if coverage >= 1.0 and identity_status == "verified" and evidence_confidence >= 1.0
        else "probable"
        if coverage >= 1.0 and identity_status == "probable" and evidence_confidence >= 1.0
        else "partial"
        if coverage > 0
        else "contextual"
    )
    stub["required_signals"] = sorted(required_signals)
    ranking_policy = extracted.get("_ranking_policy") if isinstance(extracted.get("_ranking_policy"), dict) else {}
    weights = ranking_policy.get("weights") if isinstance(ranking_policy.get("weights"), dict) else {}
    default_weights = {
        "intent_fit": 0.25,
        "signal_strength": 0.30,
        "recency": 0.20,
        "evidence_quality": 0.15,
        "contactability": 0.10,
    }
    normalized_weights = {
        key: max(0.0, float(weights.get(key) or value))
        for key, value in default_weights.items()
    }
    weight_total = sum(normalized_weights.values()) or 1.0
    normalized_weights = {key: value / weight_total for key, value in normalized_weights.items()}

    try:
        max_age_days = max(1, int(ranking_policy.get("max_signal_age_days") or 180))
    except (TypeError, ValueError):
        max_age_days = 180
    recency_score = 0.35
    if evidence_date:
        try:
            parsed_date = datetime.fromisoformat(evidence_date.replace("Z", "+00:00"))
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            age_days = max(0.0, (datetime.now(timezone.utc) - parsed_date).total_seconds() / 86400)
            recency_score = max(0.0, 1.0 - age_days / max_age_days)
        except (TypeError, ValueError):
            recency_score = 0.35

    hypothesis = extracted.get("_commercial_hypothesis") if isinstance(extracted.get("_commercial_hypothesis"), dict) else {}
    role_terms = [str(role).lower() for role in hypothesis.get("hiring_roles") or [] if str(role).strip()]
    signal_blob = f"{extracted.get('hiring_title') or ''} {evidence}".lower()
    role_match = any(role in signal_blob for role in role_terms)
    commercial_specificity = any(
        token in signal_blob
        for token in ("outbound", "prospecting", "new business", "nuovi clienti", "pipeline", "lead generation")
    )
    signal_strength = 1.0 if role_match and commercial_specificity else 0.85 if role_match or commercial_specificity else 0.65
    evidence_quality = 1.0 if evidence and source_url and evidence_date else 0.8 if evidence and source_url else 0.4
    contactability = min(1.0, 0.45 + domain_confidence * 0.55)
    hotness = round(100 * (
        normalized_weights["intent_fit"] * coverage
        + normalized_weights["signal_strength"] * signal_strength
        + normalized_weights["recency"] * recency_score
        + normalized_weights["evidence_quality"] * evidence_quality
        + normalized_weights["contactability"] * contactability
    ))
    stub["hotness_score"] = max(0, min(100, hotness))
    stub["lead_temperature"] = "hot" if hotness >= 80 else "warm" if hotness >= 65 else "contextual"
    stub["why_now"] = str(extracted.get("why_now") or evidence)[:300]
    buyer_pains = [str(value) for value in hypothesis.get("buyer_pains") or [] if str(value).strip()]
    offer = str(hypothesis.get("offer") or "").strip()
    default_pitch = f"{offer}: {buyer_pains[0]}" if offer and buyer_pains else offer
    stub["pitch_angle"] = str(extracted.get("pitch_angle") or default_pitch)[:300]
    return stub


async def run_agentic_discovery(plan: Dict[str, Any], remaining_target: int) -> List[Dict[str, Any]]:
    """WebResearcher → DataExtractor (batch finale — legacy)."""
    collected: List[Dict[str, Any]] = []

    def _collect(batch: List[Dict[str, Any]]) -> None:
        collected.extend(batch)

    await run_agentic_discovery_streaming(
        plan,
        remaining_target,
        on_batch=_collect,
        batch_size=remaining_target,
    )
    return collected


OnBatchCallback = Callable[[List[Dict[str, Any]]], None]
OnCheckpointCallback = Callable[[Dict[str, Any]], None]


def _checkpoint_plan_signature(plan: Dict[str, Any]) -> str:
    payload = {
        "query": plan.get("original_query"),
        "sector": plan.get("sector"),
        "location": plan.get("location"),
        "signals": sorted(str(value) for value in plan.get("required_signals") or []),
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:24]


def encode_agentic_checkpoint(
    plan: Dict[str, Any],
    *,
    round_idx: int,
    pages_scraped: int,
    seen_urls: Set[str],
    stop_reason: str,
) -> Dict[str, Any]:
    urls = "\n".join(sorted(seen_urls)).encode("utf-8")
    compressed = base64.b64encode(zlib.compress(urls, level=6)).decode("ascii") if urls else ""
    return {
        "version": 1,
        "plan_signature": _checkpoint_plan_signature(plan),
        "round_idx": max(0, int(round_idx)),
        "pages_scraped": max(0, int(pages_scraped)),
        "seen_urls_zlib": compressed,
        "seen_url_count": len(seen_urls),
        "stop_reason": stop_reason,
    }


def decode_agentic_checkpoint(plan: Dict[str, Any], raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("plan_signature") != _checkpoint_plan_signature(plan):
        return {"round_idx": 0, "pages_scraped": 0, "seen_urls": set()}
    seen_urls: Set[str] = set()
    encoded = str(raw.get("seen_urls_zlib") or "")
    if encoded:
        try:
            if len(encoded) > 12_000_000:
                raise ValueError("checkpoint payload too large")
            decompressor = zlib.decompressobj()
            decoded = base64.b64decode(encoded, validate=True)
            unpacked_bytes = decompressor.decompress(decoded, 8_000_000)
            if decompressor.unconsumed_tail:
                raise ValueError("checkpoint expands beyond limit")
            unpacked = unpacked_bytes.decode("utf-8")
            seen_urls = {line for line in unpacked.splitlines() if line}
            if len(seen_urls) > 50_000:
                raise ValueError("checkpoint contains too many URLs")
        except (ValueError, zlib.error, UnicodeDecodeError, binascii.Error):
            seen_urls = set()
    return {
        "round_idx": max(0, int(raw.get("round_idx") or 0)),
        "pages_scraped": max(0, int(raw.get("pages_scraped") or 0)),
        "seen_urls": seen_urls,
    }


async def run_agentic_discovery_streaming(
    plan: Dict[str, Any],
    remaining_target: int,
    *,
    on_batch: Optional[OnBatchCallback] = None,
    existing_keys: Optional[Set[str]] = None,
    batch_size: int = STREAM_BATCH_SIZE,
    stats_out: Optional[Dict[str, Any]] = None,
    checkpoint: Optional[Dict[str, Any]] = None,
    on_checkpoint: Optional[OnCheckpointCallback] = None,
) -> List[Dict[str, Any]]:
    """
    Pipeline streaming long-running: nuove query → scrape → estrai fino a target o esaurimento SERP.
    on_batch riceve lead grezzi estratti (pre-audit worker).
    """
    if remaining_target <= 0:
        if stats_out is not None:
            stats_out.update({"pages_scraped": 0, "exhausted": False, "found": 0, "target": 0})
        return []

    from .web_researcher import WebResearcher
    from .data_extractor import DataExtractor

    seen = set(existing_keys or [])
    raw_signals_by_key: Dict[str, Set[str]] = {}
    all_leads: List[Dict[str, Any]] = []
    pending_flush: List[Dict[str, Any]] = []
    batch_size = max(1, min(batch_size, 20))
    restored = decode_agentic_checkpoint(plan, checkpoint)
    pages_scraped = int(restored["pages_scraped"])
    round_idx = int(restored["round_idx"])
    page_budget = pages_scraped + compute_agentic_page_budget(remaining_target)
    shared_seen_urls: Set[str] = set(restored["seen_urls"])
    empty_rounds = 0
    stop_reason = "target_reached"

    extractor = DataExtractor(plan, [])
    query_yield: Dict[str, Dict[str, int]] = {}
    base_search_queries: Optional[List[str]] = None
    search_query_generation_calls = 0

    def _update_runtime_stats(reason: str) -> None:
        if stats_out is None:
            return
        stats_out.update(
            {
                "pages_scraped": pages_scraped,
                "found": len(all_leads),
                "target": remaining_target,
                "rounds": round_idx,
                "page_budget": page_budget,
                "stop_reason": reason,
                "unique_urls": len(shared_seen_urls),
                "structured_found": structured_found,
                "search_query_generation_calls": search_query_generation_calls,
                "extraction": extractor.telemetry_snapshot(),
                "query_yield": dict(
                    sorted(
                        query_yield.items(),
                        key=lambda item: (item[1]["leads"], -item[1]["pages"]),
                        reverse=True,
                    )[:20]
                ),
            }
        )

    def _flush_pending() -> None:
        nonlocal pending_flush
        if not pending_flush or not on_batch:
            pending_flush = []
            return
        try:
            on_batch(list(pending_flush))
        except Exception as exc:
            logger.warning("on_batch callback failed: %s", exc)
        pending_flush = []

    def _save_checkpoint(reason: str) -> None:
        if not on_checkpoint:
            return
        try:
            on_checkpoint(
                encode_agentic_checkpoint(
                    plan,
                    round_idx=round_idx,
                    pages_scraped=pages_scraped,
                    seen_urls=shared_seen_urls,
                    stop_reason=reason,
                )
            )
        except Exception as exc:
            logger.warning("agentic checkpoint callback failed: %s", exc)

    structured_found = 0
    try:
        from .structured_lanes import discover_structured_leads

        structured = await asyncio.wait_for(
            discover_structured_leads(plan, remaining_target),
            timeout=min(180.0, max(30.0, remaining_target * 0.2)),
        )
        for item in structured:
            if len(all_leads) >= remaining_target or not isinstance(item, dict):
                break
            item_name = str(item.get("name") or "").strip()
            item_url = str(item.get("website") or "").strip()
            key = lead_dedupe_key(item_name, item_url, item_name)
            if not key:
                continue
            item_signals = {
                _normalize_signal_name(value)
                for value in item.get("matched_signals") or []
                if _normalize_signal_name(value)
            }
            if key in seen:
                if not item_signals.difference(raw_signals_by_key.get(key, set())):
                    continue
                raw_signals_by_key.setdefault(key, set()).update(item_signals)
                pending_flush.append(item)
                if len(pending_flush) >= batch_size:
                    _flush_pending()
                continue
            seen.add(key)
            raw_signals_by_key[key] = set(item_signals)
            all_leads.append(item)
            pending_flush.append(item)
            structured_found += 1
            if len(pending_flush) >= batch_size:
                _flush_pending()
        if pending_flush:
            _flush_pending()
        _update_runtime_stats("round_complete")
        _save_checkpoint("round_complete")
    except asyncio.TimeoutError:
        logger.warning("structured discovery lanes timed out; continuing with web research")
    except Exception as exc:
        logger.warning("structured discovery lanes failed: %s", exc)

    while len(all_leads) < remaining_target and pages_scraped < page_budget:
        round_idx += 1
        pages_left = page_budget - pages_scraped
        max_queries = min(7, max(3, pages_left // 6))
        max_urls = min(25, max(5, pages_left))
        round_plan = dict(plan)
        round_plan["_discovery_round"] = round_idx
        if base_search_queries:
            round_plan["_search_queries_override"] = base_search_queries

        researcher = WebResearcher(
            round_plan,
            max_queries=max_queries,
            max_urls_per_query=max_urls,
            seen_urls=shared_seen_urls,
        )
        pages_this_round = 0
        leads_before_round = len(all_leads)

        async for page in researcher.iter_scraped_pages():
            pages_scraped += 1
            pages_this_round += 1
            if len(all_leads) >= remaining_target:
                break
            if pages_scraped > page_budget:
                break
            try:
                extracted = await extractor.extract_page(page)
            except Exception as exc:
                logger.warning(
                    "extract_page failed url=%s: %s",
                    str(page.get("url", ""))[:80],
                    exc,
                )
                continue

            query_source = str(page.get("query_source") or "unknown")[:240]
            query_metrics = query_yield.setdefault(query_source, {"pages": 0, "leads": 0})
            query_metrics["pages"] += 1
            query_metrics["leads"] += len(extracted)
            _update_runtime_stats("running")

            for item in extracted:
                if len(all_leads) >= remaining_target:
                    break
                if not isinstance(item, dict):
                    continue
                item_name = str(item.get("name") or "").strip()
                item_url = str(item.get("website") or "").strip()
                key = lead_dedupe_key(item_name, item_url, item_name)
                if not key:
                    continue
                item_signals = {
                    _normalize_signal_name(value)
                    for value in item.get("matched_signals") or []
                    if _normalize_signal_name(value)
                }
                if key in seen:
                    if not item_signals.difference(raw_signals_by_key.get(key, set())):
                        continue
                    raw_signals_by_key.setdefault(key, set()).update(item_signals)
                    pending_flush.append(item)
                    if len(pending_flush) >= batch_size:
                        _flush_pending()
                    continue
                seen.add(key)
                raw_signals_by_key[key] = set(item_signals)
                all_leads.append(item)
                pending_flush.append(item)
                if len(pending_flush) >= batch_size:
                    _flush_pending()

        if not base_search_queries and researcher.generated_base_queries:
            base_search_queries = list(researcher.generated_base_queries)
            search_query_generation_calls += 1

        if pending_flush:
            _flush_pending()

        _save_checkpoint("round_complete")
        if len(all_leads) >= remaining_target:
            break
        if pages_scraped >= page_budget:
            stop_reason = "page_budget"
            break
        if pages_this_round == 0 or len(all_leads) == leads_before_round:
            empty_rounds += 1
        else:
            empty_rounds = 0
        if empty_rounds >= max(1, AGENTIC_MAX_EMPTY_ROUNDS):
            stop_reason = "sources_exhausted"
            logger.info("agentic discovery: no pages round=%s — stop", round_idx)
            break

    if len(all_leads) >= remaining_target:
        stop_reason = "target_reached"
    elif pages_scraped >= page_budget:
        stop_reason = "page_budget"
    exhausted = stop_reason == "sources_exhausted" and len(all_leads) < remaining_target
    _save_checkpoint(stop_reason)
    if stats_out is not None:
        _update_runtime_stats(stop_reason)
        stats_out["exhausted"] = exhausted
    if exhausted:
        logger.info(
            "agentic discovery exhausted: found=%s target=%s pages=%s",
            len(all_leads),
            remaining_target,
            pages_scraped,
        )

    return all_leads


def run_agentic_discovery_sync(plan: Dict[str, Any], remaining_target: int) -> List[Dict[str, Any]]:
    return asyncio.run(run_agentic_discovery(plan, remaining_target))


def _self_check() -> None:
    assert _iron_dome_blocked_host("github.com") is True
    assert _iron_dome_blocked_host("brave.com") is True
    assert _iron_dome_blocked_host("agenziaweb.it") is False
    # ponytail: no network — HTTP check mocked via empty url rejection
    assert is_valid_b2b_lead("Brave", "https://github.com/brave/brave-core") is False
    assert is_valid_b2b_lead("BioPlast", "") is False


if __name__ == "__main__":
    _self_check()
    print("agentic_gap_fill self-check OK")
