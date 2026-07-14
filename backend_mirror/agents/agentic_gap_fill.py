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

from .hiring_evidence import (
    has_concrete_operational_hiring_evidence,
    operational_hiring_evidence_priority,
)

logger = logging.getLogger("agentic_gap_fill")

AGENTIC_TIMEOUT_SEC = int(os.getenv("AGENTIC_GAP_FILL_TIMEOUT_SEC", "7200") or "7200")
STREAM_BATCH_SIZE = int(os.getenv("AGENTIC_STREAM_BATCH_SIZE", "1") or "1")
AGENTIC_MAX_SCRAPE_PAGES = int(os.getenv("AGENTIC_MAX_SCRAPE_PAGES", "0") or "0")
AGENTIC_PAGE_BUDGET_FACTOR = float(os.getenv("AGENTIC_PAGE_BUDGET_FACTOR", "12") or "12")
AGENTIC_PAGE_BUDGET_MIN = int(os.getenv("AGENTIC_PAGE_BUDGET_MIN", "80") or "80")
AGENTIC_PAGE_BUDGET_HARD_CAP = int(os.getenv("AGENTIC_PAGE_BUDGET_HARD_CAP", "100000") or "100000")
AGENTIC_MAX_EMPTY_ROUNDS = int(os.getenv("AGENTIC_MAX_EMPTY_ROUNDS", "5") or "5")
AGENTIC_MAX_QUERIES_PER_ROUND = int(os.getenv("AGENTIC_MAX_QUERIES_PER_ROUND", "12") or "12")
AGENTIC_MAX_URLS_PER_QUERY = int(os.getenv("AGENTIC_MAX_URLS_PER_QUERY", "40") or "40")
AGENTIC_REQUIRE_SEARCH_PROVIDER = os.getenv("AGENTIC_REQUIRE_SEARCH_PROVIDER", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def compute_agentic_page_budget(remaining_target: int) -> int:
    """Return a target-aware budget while preserving an explicit ops override."""
    if AGENTIC_MAX_SCRAPE_PAGES > 0:
        return min(AGENTIC_PAGE_BUDGET_HARD_CAP, AGENTIC_MAX_SCRAPE_PAGES)
    target = max(1, int(remaining_target or 1))
    dynamic = max(AGENTIC_PAGE_BUDGET_MIN, int(target * AGENTIC_PAGE_BUDGET_FACTOR))
    return min(AGENTIC_PAGE_BUDGET_HARD_CAP, dynamic)


def rank_pages_for_extraction(
    pages: List[Dict[str, Any]],
    plan: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Rank a bounded buffer of acquired pages before scarce LLM extraction."""
    required = {
        str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
        for value in plan.get("required_signals") or []
        if str(value or "").strip()
    }
    if "hiring_operational" not in required:
        return list(pages)
    indexed = list(enumerate(pages))
    indexed.sort(
        key=lambda item: (
            -operational_hiring_evidence_priority(
                str(item[1].get("raw_text") or ""),
                str(item[1].get("url") or ""),
            ),
            item[0],
        )
    )
    return [page for _, page in indexed]


async def _ranked_page_stream(page_stream: Any, plan: Dict[str, Any]):
    """Rank acquired pages in bounded windows without provider activity."""
    try:
        configured_window = int(os.getenv("MIRAX_SOURCE_RANK_WINDOW", "8") or "8")
    except (TypeError, ValueError):
        configured_window = 8
    window = max(1, min(64, configured_window))
    buffered: List[Dict[str, Any]] = []
    async for page in page_stream:
        buffered.append(page)
        if len(buffered) >= window:
            for ranked in rank_pages_for_extraction(buffered, plan):
                yield ranked
            buffered.clear()
    for ranked in rank_pages_for_extraction(buffered, plan):
        yield ranked


def build_agentic_exhaustion_message(found: int, requested: int) -> str:
    return (
        f"Ricerca esaurita: trovati {found} lead su {requested} richiesti. "
        "Il web non offre altri risultati validi per questa nicchia."
    )


def build_agentic_completion_message(found: int, requested: int, stop_reason: str) -> str:
    if found >= requested:
        return f"Target raggiunto: trovati {found} lead verificabili su {requested} richiesti."
    if stop_reason == "provider_unavailable":
        return (
            "Ricerca non eseguita: provider search/AI non disponibile. "
            "Configura SERPER_API_KEY o BRAVE_SEARCH_API_KEY oppure riabilita un provider AI con budget cap."
        )
    if stop_reason == "provider_rate_limited":
        return (
            "Ricerca interrotta: provider AI/search in rate-limit o credito insufficiente. "
            "Nessun retry costoso eseguito dopo il blocco provider."
        )
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
    canonical_plan = uqe_plan.get("canonical_plan") if isinstance(uqe_plan.get("canonical_plan"), dict) else {}
    previous_stats = intent.get("agentic_stats") if isinstance(intent.get("agentic_stats"), dict) else {}
    previous_cost = previous_stats.get("cost_governor") if isinstance(previous_stats.get("cost_governor"), dict) else {}
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
        "canonical_plan": canonical_plan,
        "_prior_cost_eur": float(previous_cost.get("committed_cost_eur") or 0.0),
    }


def _normalize_domain(url: str) -> str:
    from .portal_blacklist import normalize_domain
    return normalize_domain(url)


def _normalize_signal_name(value: Any) -> str:
    signal = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if signal.startswith("hiring_"):
        return "hiring"
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
    try:
        from .portal_blacklist import is_blacklisted_domain

        if is_blacklisted_domain(d):
            return True
    except Exception:
        pass
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
    from .portal_blacklist import is_blacklisted_domain, is_blacklisted_name, normalize_domain

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


def _name_tokens_for_evidence(name: str) -> List[str]:
    stop = {
        "srl", "sr", "spa", "s", "p", "a", "group", "italia", "italy", "the", "and",
        "societa", "società", "cooperativa", "company",
    }
    tokens = []
    for token in re.findall(r"[a-z0-9à-öø-ÿ]+", (name or "").lower()):
        if len(token) >= 4 and token not in stop:
            tokens.append(token)
    return tokens[:6]


def _portal_evidence_mentions_company(name: str, extracted: Dict[str, Any]) -> bool:
    haystack = " ".join(
        str(extracted.get(key) or "")
        for key in ("evidence", "signal_detail", "why_now", "source_url")
    ).lower()
    tokens = _name_tokens_for_evidence(name)
    if not tokens:
        return False
    return any(token in haystack for token in tokens)


_NON_TARGET_ORG_PATTERNS = tuple(
    re.compile(pattern, re.I)
    for pattern in (
        r"^\s*(business|sales|account|inside)\s+(development|representative|executive)\s*$",
        r"^\s*(commerciale|venditore|sales|marketing|developer|sviluppatore)\s*$",
        r"\b(comune|municipio|regione|provincia|ministero|agenzia\s+delle\s+entrate)\b",
        r"\b(universit[aà]|politecnico|ospedale|asl|ats|azienda\s+sanitaria)\b",
        r"\b(camera\s+di\s+commercio|registro\s+imprese|infocamere|anac)\b",
        r"\b(associazione\s+di\s+categoria|confindustria|confcommercio|confartigianato)\b",
    )
)
_ACTIVE_HIRING_EVIDENCE_RE = re.compile(
    r"\b(ricerca|cerchiamo|cerca|assume|assunzion|seleziona|selezioni|"
    r"posizion[ei]\s+apert[ae]|opportunit[aà]\s+lavorativ|lavora\s+con\s+noi|"
    r"jobs?|careers?|stage\s+con\s+finalit[aà]\s+di\s+inserimento|"
    r"partita\s+iva|contratto|candidati|invia\s+la\s+tua\s+candidatura)\b",
    re.I,
)
_STALE_HIRING_CONTEXT_RE = re.compile(
    r"\b(career\s+story|storia|intervista|case\s+study|articolo|blog|press|news)\b",
    re.I,
)
_ACTIVE_MARKETING_INVESTMENT_RE = re.compile(
    r"\b(meta\s+ads?|facebook\s+ads?|google\s+ads?|ad\s+library|inserzion[ei]\s+attiv[ae]|"
    r"campagn[ae]\s+(?:marketing|pubblicitarie|ads?)|landing\s+page|lead\s+ads?|"
    r"budget\s+(?:marketing|ads?|pubblicit[aà])|paid\s+media|remarketing|"
    r"pixel|conversion\s+tracking|richiedi\s+(?:demo|preventivo|informazioni))\b",
    re.I,
)
_NEGATIVE_MARKETING_ONLY_RE = re.compile(
    r"\b(no|non|senza|manca|assente|nessun[oa]?)\s+"
    r"(?:meta\s+)?(?:pixel|ads?|campagn[ae]|tracking|conversioni?|pubblicit[aÃ ])\b",
    re.I,
)
_STRONG_ACTIVE_MARKETING_RE = re.compile(
    r"\b(meta\s+ads?|facebook\s+ads?|google\s+ads?|ad\s+library|libreria\s+inserzion[ei]|"
    r"inserzion[ei]\s+attiv[ae]|campagn[ae]\s+(?:marketing|pubblicitarie|ads?)|"
    r"budget\s+(?:marketing|ads?|pubblicit[aÃ ])|paid\s+media|remarketing|"
    r"lead\s+ads?|conversion\s+tracking|landing\s+page\s+(?:ads?|campagn[ae]|lead|conversion))\b",
    re.I,
)
_MARKETING_SERVICE_PROVIDER_RE = re.compile(
    r"\b("
    r"agenzia\s+(?:web|marketing|digital|social|seo|comunicazione)|"
    r"web\s+agency|digital\s+agency|seo\s+agency|marketing\s+agency|"
    r"servizi\s+(?:di\s+)?(?:web\s+)?marketing|consulenza\s+(?:web\s+)?marketing|"
    r"gestione\s+(?:pagina\s+facebook|social|campagne|google\s+ads|facebook\s+ads|meta\s+ads)|"
    r"social\s+media\s+marketing|performance\s+marketing|"
    r"corso\s+(?:di\s+)?marketing|guida\s+(?:a|al|alla|su)|"
    r"come\s+funziona|cos['’]?\s*[eè]"
    r")\b",
    re.I,
)
_MARKETING_CLIENT_EVIDENCE_RE = re.compile(
    r"\b(case\s+study|success\s+story|portfolio|risultati\s+ottenuti|"
    r"abbiamo\s+(?:aiutato|realizzato|gestito)|campagna\s+per)\b",
    re.I,
)


def _has_active_marketing_investment_evidence(text: str) -> bool:
    """Positive spend/funnel evidence only; do not treat "no pixel" as spend."""
    blob = re.sub(r"\s+", " ", text or "").strip()
    if not blob:
        return False
    if _STRONG_ACTIVE_MARKETING_RE.search(blob):
        return True
    has_cta = re.search(r"\brichiedi\s+(?:demo|preventivo|informazioni)\b", blob, re.I)
    has_funnel = re.search(r"\b(ads?|campagn[ae]|paid|funnel|conversion|landing)\b", blob, re.I)
    if has_cta and has_funnel and not _NEGATIVE_MARKETING_ONLY_RE.search(blob):
        return True
    return False


def _looks_like_marketing_provider_noise(text: str) -> bool:
    blob = re.sub(r"[^0-9A-Za-zÀ-ÿ]+", " ", text or "").strip()
    blob = re.sub(r"\s+", " ", blob)
    if not blob:
        return False
    if not _MARKETING_SERVICE_PROVIDER_RE.search(blob):
        return False
    return not _MARKETING_CLIENT_EVIDENCE_RE.search(blob)


def _looks_like_non_target_org_name(name: str) -> bool:
    label = (name or "").strip()
    if not label:
        return True
    if len(label) < 3:
        return True
    return any(rx.search(label) for rx in _NON_TARGET_ORG_PATTERNS)


def _quality_contract_snapshot(
    *,
    evidence: str,
    source_url: str,
    website: str,
    required: Set[str],
    satisfied: Set[str],
    match_mode: str,
    identity: Dict[str, Any],
) -> Dict[str, Any]:
    coverage = (
        1.0
        if match_mode == "any" and satisfied
        else len(satisfied) / len(required)
        if required
        else 1.0
    )
    identity_status = str(identity.get("status") or "").strip().lower()
    identity_confidence = float(identity.get("confidence") or 0.0)
    source_present = bool(source_url)
    website_present = bool(website)
    evidence_present = len((evidence or "").strip()) >= 10
    score = round(
        100
        * (
            0.32 * min(1.0, coverage)
            + 0.26 * (1.0 if identity_status == "verified" else 0.75 if identity_status == "probable" else 0.0)
            + 0.18 * min(1.0, identity_confidence)
            + 0.14 * (1.0 if evidence_present else 0.0)
            + 0.10 * (1.0 if source_present and website_present else 0.5 if source_present or website_present else 0.0)
        )
    )
    return {
        "version": 1,
        "score": max(0, min(100, score)),
        "evidence_present": evidence_present,
        "source_url_present": source_present,
        "official_domain_present": website_present,
        "domain_status": identity_status or None,
        "domain_confidence": round(identity_confidence, 3),
        "required_signals": sorted(required),
        "satisfied_signals": sorted(satisfied),
        "signal_coverage": round(min(1.0, coverage), 3),
        "policy": "PMI/local-business-first; reject famous enterprises, portals, generic roles and non-target public entities.",
    }


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
    from .portal_blacklist import is_blacklisted_domain, is_blacklisted_name, is_source_portal_url, normalize_domain

    if is_blacklisted_name(name) or _looks_like_non_target_org_name(name):
        return None

    out = dict(extracted)
    source_url = str(out.get("source_url") or "").strip()
    evidence = str(out.get("evidence") or "").strip()
    if len(evidence) < 10:
        logger.info("prepare_agentic: missing/weak evidence for %r", name[:60])
        return None
    if is_source_portal_url(source_url) and not _portal_evidence_mentions_company(name, out):
        logger.info("prepare_agentic: portal evidence does not mention company %r", name[:60])
        return None
    required = {
        _normalize_signal_name(value)
        for value in out.get("_required_signals") or []
        if _normalize_signal_name(value)
    }
    canonical_required = {
        str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
        for value in out.get("_required_signals") or []
        if str(value or "").strip()
    }
    matched = {
        _normalize_signal_name(value)
        for value in out.get("matched_signals") or []
        if _normalize_signal_name(value)
    }
    if required:
        satisfied = _satisfied_required_signals(required, matched)
        match_mode = str(out.get("_signal_match_mode") or "all").strip().lower()
        if "hiring" in required and "hiring" not in matched:
            logger.info("prepare_agentic: required hiring signal missing for %r", name[:60])
            return None
        if "investing_marketing" in required and not matched.intersection(
            {"investing_marketing", "meta_ads_started", "google_ads_started"}
        ):
            logger.info("prepare_agentic: required marketing investment signal missing for %r", name[:60])
            return None
        signal_ok = bool(satisfied) if match_mode == "any" else len(satisfied) == len(required)
        if not signal_ok:
            logger.info("prepare_agentic: evidence does not match required signals for %r", name[:60])
            return None
        if "investing_marketing" in satisfied or "investing_marketing" in required:
            marketing_blob = " ".join(
                str(value or "")
                for value in (
                    out.get("signal_detail"),
                    evidence,
                    source_url,
                    out.get("why_now"),
                    out.get("pitch_angle"),
                )
            )
            if not _has_active_marketing_investment_evidence(marketing_blob):
                logger.info("prepare_agentic: weak marketing investment evidence for %r", name[:60])
                return None
            if _looks_like_marketing_provider_noise(marketing_blob):
                logger.info("prepare_agentic: marketing provider page noise for %r", name[:60])
                return None
        if "hiring" in satisfied or "hiring" in required:
            hiring_blob = " ".join(
                str(value or "")
                for value in (
                    out.get("hiring_title"),
                    evidence,
                    out.get("why_now"),
                )
            )
            active_hiring = bool(_ACTIVE_HIRING_EVIDENCE_RE.search(hiring_blob))
            stale_context = bool(_STALE_HIRING_CONTEXT_RE.search(hiring_blob))
            years = [int(value) for value in re.findall(r"\b20\d{2}\b", hiring_blob)]
            current_year = datetime.now(timezone.utc).year
            old_year_only = bool(years) and max(years) < current_year - 1
            if not active_hiring or (stale_context and old_year_only):
                logger.info("prepare_agentic: weak/stale hiring evidence for %r", name[:60])
                return None
            if (
                "hiring_operational" in canonical_required
                and not has_concrete_operational_hiring_evidence(hiring_blob)
            ):
                logger.info(
                    "prepare_agentic: no concrete operational vacancy evidence for %r",
                    name[:60],
                )
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
    if not website and source_url and not is_source_portal_url(source_url):
        source_domain = normalize_domain(source_url)
        if source_domain and not is_blacklisted_domain(source_domain):
            parsed_source = urlparse(source_url if "://" in source_url else f"https://{source_url}")
            if parsed_source.netloc:
                website = f"{parsed_source.scheme or 'https'}://{parsed_source.netloc}/"
    identity = resolve_company_identity(name, website, location)
    if not identity:
        logger.info("prepare_agentic: no resolvable domain for %r", name[:60])
        return None
    resolved_website = str(identity.get("url") or "")
    resolved_domain = normalize_domain(resolved_website)
    if _iron_dome_blocked_host(resolved_domain) or is_blacklisted_domain(resolved_domain) or is_blacklisted_name(name):
        logger.info("prepare_agentic: rejected blacklisted resolved identity %r %s", name[:60], resolved_domain)
        return None
    identity_status = str(identity.get("status") or "").strip().lower()
    if identity_status != "verified":
        logger.info("prepare_agentic: weak domain identity %r status=%s", name[:60], identity_status)
        return None
    contract = _quality_contract_snapshot(
        evidence=evidence,
        source_url=source_url,
        website=resolved_website,
        required=required,
        satisfied=satisfied if required else matched,
        match_mode=match_mode if required else "all",
        identity=identity,
    )
    min_contract_score = 82 if required else 70
    if contract["score"] < min_contract_score:
        logger.info("prepare_agentic: quality contract failed %r score=%s", name[:60], contract["score"])
        return None
    out["website"] = resolved_website
    out["domain_verification"] = identity
    out["lead_quality_contract"] = contract
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
    has_marketing_investment = bool(
        {"investing_marketing", "meta_ads_started", "google_ads_started"} & set(signal_list)
    ) and _has_active_marketing_investment_evidence(
        " ".join(
            str(value or "")
            for value in (
                evidence,
                extracted.get("signal_detail"),
                extracted.get("why_now"),
                extracted.get("pitch_angle"),
            )
        )
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

    if has_marketing_investment:
        business_signals.append(
            {
                "type": "investing_marketing",
                "status": "confirmed",
                "label": "Investimento marketing verificato",
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
            if s in {"hiring", "new_company", "funding_received", "investing_marketing", "meta_ads_started", "google_ads_started"}:
                continue
            business_signals.append(
                {
                    "type": s,
                    "status": "confirmed" if evidence else "contextual",
                    "label": s,
                    "source": "agentic_web_search",
                    "confidence": 0.75 if evidence else 0.45,
                    "evidence": evidence[:300] if evidence else None,
                }
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
        # Canonical evidence fields. Identity remains in technical_report
        # until the audit boundary validates ownership and promotes it; the
        # publication gate must not infer evidence from presentation fields.
        "source_url": source_url,
        "source_class": (
            str((extracted.get("source_types") or [""])[0]).strip()
            if isinstance(extracted.get("source_types"), list)
            else str(extracted.get("source_class") or "").strip()
        ),
        "evidence": evidence,
        "evidence_date": evidence_date or None,
        "retrieval_method": str(extracted.get("retrieval_method") or "http_fetch"),
        "business_signals": business_signals or None,
        "source": "agentic_web_search",
        "source_lane": extracted.get("source_lane") or (
            "anac_structured" if isinstance(structured_signal, dict) else "web_research"
        ),
        "source_types": list(extracted.get("source_types") or [])[:10],
        "query_source": str(extracted.get("query_source") or "")[:500],
        "source_publisher": str(extracted.get("source_publisher") or "")[:255],
        "source_observation_date": str(extracted.get("source_observation_date") or observed_at)[:40],
        "agentic_evidence": evidence[:300],
        "agentic_source_url": source_url,
        "agentic_evidence_records": [
            {
                "claim": evidence[:300],
                "source_url": source_url,
                "matched_signals": signal_list,
                "evidence_date": evidence_date or None,
                "observed_at": observed_at,
                "source_lane": extracted.get("source_lane") or "web_research",
                "source_types": list(extracted.get("source_types") or [])[:10],
                "query": str(extracted.get("query_source") or "")[:500],
                "domain_verification_status": (
                    extracted.get("domain_verification") or {}
                ).get("status") if isinstance(extracted.get("domain_verification"), dict) else None,
            }
        ],
        "matched_signals": signal_list,
        "lead_object_version": 2,
        "audit_version": 2,
    }
    for canonical_field in (
        "legal_name", "entity_type", "organization_type", "company_size_class",
        "company_size", "employee_count", "employees", "dipendenti_stimati",
        "operating_company_probability", "is_media", "is_directory",
        "is_university", "is_public_body", "is_global_brand",
        "is_source_publisher", "enterprise_excluded",
    ):
        if extracted.get(canonical_field) is not None:
            stub[canonical_field] = extracted.get(canonical_field)
    canonical_source_class = str(stub.get("source_class") or "").strip()
    for signal in business_signals:
        if not isinstance(signal, dict):
            continue
        signal.setdefault("source_url", source_url)
        signal.setdefault("source_class", canonical_source_class)
        signal.setdefault("observed_at", observed_at)
        signal.setdefault("published_at", evidence_date or None)
        signal.setdefault("retrieval_method", stub["retrieval_method"])
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
    if isinstance(extracted.get("lead_quality_contract"), dict):
        stub["lead_quality_contract"] = extracted.get("lead_quality_contract")
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
    stub["signal_match_mode"] = signal_match_mode
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

    def _collect(batch: List[Dict[str, Any]]) -> int:
        collected.extend(batch)
        return len(batch)

    await run_agentic_discovery_streaming(
        plan,
        remaining_target,
        on_batch=_collect,
        batch_size=remaining_target,
    )
    return collected


OnBatchCallback = Callable[[List[Dict[str, Any]]], Optional[int]]
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
    cost_client: Any = None,
    search_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Pipeline streaming long-running: nuove query → scrape → estrai fino a target o esaurimento SERP.
    on_batch riceve lead grezzi estratti (pre-audit worker).
    """
    if remaining_target <= 0:
        if stats_out is not None:
            stats_out.update({"pages_scraped": 0, "exhausted": False, "found": 0, "target": 0})
        return []

    from .web_researcher import WebResearcher, _required_source_lane_count
    from .data_extractor import DataExtractor

    seen = set(existing_keys or [])
    raw_signals_by_key: Dict[str, Set[str]] = {}
    all_leads: List[Dict[str, Any]] = []
    pending_flush: List[Dict[str, Any]] = []
    accepted_leads = 0
    batch_size = max(1, min(batch_size, 20))
    restored = decode_agentic_checkpoint(plan, checkpoint)
    pages_scraped = int(restored["pages_scraped"])
    round_idx = int(restored["round_idx"])
    page_budget = pages_scraped + compute_agentic_page_budget(remaining_target)
    shared_seen_urls: Set[str] = set(restored["seen_urls"])
    empty_rounds = 0
    stop_reason = "target_reached"

    from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor
    cost_governor = ResearchCostGovernor.from_plan(
        plan,
        remaining_target,
        persistent_client=cost_client,
        search_id=search_id,
    )
    from cost_context import set_current_cost_governor
    set_current_cost_governor(cost_governor)
    extractor = DataExtractor(plan, [], cost_governor=cost_governor)
    strict_marketing_signal = bool(
        {
            _normalize_signal_name(value)
            for value in plan.get("required_signals") or []
            if _normalize_signal_name(value)
        }.intersection({"investing_marketing", "meta_ads_started", "google_ads_started"})
    )
    query_yield: Dict[str, Dict[str, Any]] = {}
    base_search_queries: Optional[List[str]] = None
    search_query_generation_calls = 0

    def _effective_found() -> int:
        return accepted_leads if on_batch else len(all_leads)

    def _update_runtime_stats(reason: str) -> None:
        if stats_out is None:
            return
        stats_out.update(
            {
                "pages_scraped": pages_scraped,
                "found": _effective_found(),
                "raw_found": len(all_leads),
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
                "cost_governor": cost_governor.snapshot(),
            }
        )

    def _flush_pending() -> None:
        nonlocal pending_flush, accepted_leads
        if not pending_flush or not on_batch:
            pending_flush = []
            return
        try:
            accepted = on_batch(list(pending_flush))
            if isinstance(accepted, int) and accepted > 0:
                accepted_leads += accepted
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
    if AGENTIC_REQUIRE_SEARCH_PROVIDER:
        try:
            from .search_serp import search_provider_status

            provider_status = search_provider_status()
            if not provider_status.get("configured"):
                stop_reason = "provider_unavailable"
                if stats_out is not None:
                    stats_out.update(
                        {
                            "pages_scraped": pages_scraped,
                            "found": 0,
                            "raw_found": 0,
                            "target": remaining_target,
                            "rounds": round_idx,
                            "page_budget": page_budget,
                            "stop_reason": stop_reason,
                            "unique_urls": len(shared_seen_urls),
                            "structured_found": 0,
                            "search_query_generation_calls": 0,
                            "extraction": extractor.telemetry_snapshot(),
                            "query_yield": {},
                            "provider_status": provider_status,
                            "exhausted": True,
                        }
                    )
                logger.error("agentic discovery blocked: search provider unavailable status=%s", provider_status)
                return []
        except Exception as exc:
            logger.warning("provider status check failed: %s", exc)
    planned_lanes = {
        str(lane.get("lane") or "").strip().lower()
        for lane in plan.get("source_plan") or []
        if isinstance(lane, dict)
    }
    # A canonical job_market lane already owns hiring discovery. Running the
    # legacy structured lane first duplicates paid searches and can starve the
    # remaining required source lanes under a small hard cap.
    run_structured_lanes = "job_market" not in planned_lanes
    structured_reservation_active = False
    structured_reservation_eur = 0.0
    normalized_required = {
        _normalize_signal_name(value) for value in plan.get("required_signals") or []
    }
    if "hiring" in normalized_required and run_structured_lanes:
        structured_queries = min(10, max(2, len(plan.get("hiring_roles") or []) * 2))
        structured_reservation_eur = structured_queries * 0.005
        try:
            structured_reservation = cost_governor.reserve(
                "structured:hiring-search", "search_jobs", structured_reservation_eur
            )
            structured_reservation_active = structured_reservation.status == "reserved"
            if not structured_reservation_active:
                run_structured_lanes = False
        except ResearchBudgetExceeded:
            run_structured_lanes = False
            logger.info("structured hiring lane skipped: insufficient hard budget")
    try:
        from .structured_lanes import discover_structured_leads

        structured = (
            await asyncio.wait_for(
                discover_structured_leads(plan, remaining_target),
                timeout=min(180.0, max(30.0, remaining_target * 0.2)),
            )
            if run_structured_lanes
            else []
        )
        for item in structured:
            if _effective_found() >= remaining_target or not isinstance(item, dict):
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

    if structured_reservation_active:
        try:
            cost_governor.settle(
                "structured:hiring-search",
                structured_reservation_eur,
                metadata={"outcome": "completed", "leads_found": structured_found},
            )
        except ResearchBudgetExceeded:
            stop_reason = "budget_exhausted"
            _save_checkpoint(stop_reason)
            if stats_out is not None:
                _update_runtime_stats(stop_reason)
                stats_out["exhausted"] = True
            return all_leads

    while _effective_found() < remaining_target and pages_scraped < page_budget:
        round_idx += 1
        pages_left = page_budget - pages_scraped
        target_left = max(1, remaining_target - _effective_found())
        if target_left <= 25:
            desired_queries = 7
        elif target_left <= 200:
            desired_queries = 10
        else:
            desired_queries = 12
        max_queries = min(
            max(3, AGENTIC_MAX_QUERIES_PER_ROUND),
            max(3, desired_queries, min(max(3, AGENTIC_MAX_QUERIES_PER_ROUND), max(1, pages_left // 6))),
        )
        max_urls = max(
            1,
            min(
                max(1, AGENTIC_MAX_URLS_PER_QUERY),
                max(1, (pages_left + max(max_queries, 1) - 1) // max(max_queries, 1)),
            ),
        )
        # Reserve before scheduling external operations. Scale the research
        # breadth down when the remaining hard budget cannot cover the plan.
        search_unit_cost = max(0.0, float(os.getenv("MIRAX_SERP_COST_EUR_PER_QUERY", "0.005") or "0.005"))
        crawl_unit_cost = max(0.0, float(os.getenv("MIRAX_CRAWL_COST_EUR_PER_PAGE", "0.0002") or "0.0002"))
        required_lane_queries = _required_source_lane_count(plan)
        if required_lane_queries > 0 and round_idx == 1:
            # Phase A is evidence breadth, not crawl breadth: schedule at most
            # one page per query until every required semantic lane has run.
            max_urls = 1
        minimum_lane_cost = required_lane_queries * (search_unit_cost + crawl_unit_cost)
        if required_lane_queries > 0 and cost_governor.remaining_eur + 1e-9 < minimum_lane_cost:
            stop_reason = "insufficient_budget_for_required_lane_coverage"
            logger.error(
                "required source lanes cannot execute within remaining budget lanes=%s remaining=%.6f minimum=%.6f",
                required_lane_queries,
                cost_governor.remaining_eur,
                minimum_lane_cost,
            )
            break
        crawl_reserve = max_urls * max_queries * crawl_unit_cost
        affordable_queries = int(max(0.0, cost_governor.remaining_eur - crawl_reserve) / max(search_unit_cost, 0.000001))
        max_queries = min(max_queries, affordable_queries)
        if required_lane_queries > 0 and max_queries < required_lane_queries:
            # Recalculate using the minimum one-page crawl allocation per lane;
            # broad crawling may shrink, required semantic coverage may not.
            affordable_queries = int(
                max(0.0, cost_governor.remaining_eur - required_lane_queries * crawl_unit_cost)
                / max(search_unit_cost, 0.000001)
            )
            if affordable_queries < required_lane_queries:
                stop_reason = "insufficient_budget_for_required_lane_coverage"
                break
            max_queries = required_lane_queries
        if max_queries <= 0:
            stop_reason = "budget_exhausted"
            break
        max_urls = max(1, min(max_urls, int(max(crawl_unit_cost, cost_governor.remaining_eur - max_queries * search_unit_cost) / (max_queries * max(crawl_unit_cost, 0.000001)))))
        try:
            search_reservation = cost_governor.reserve(
                f"search-round:{round_idx}", "search_web", max_queries * search_unit_cost
            )
            crawl_reservation = cost_governor.reserve(
                f"crawl-round:{round_idx}", "open_page", max_queries * max_urls * crawl_unit_cost
            )
            if search_reservation.status != "reserved" or crawl_reservation.status != "reserved":
                if search_reservation.status == "reserved":
                    cost_governor.release(f"search-round:{round_idx}", error_code="DUPLICATE_ROUND")
                if crawl_reservation.status == "reserved":
                    cost_governor.release(f"crawl-round:{round_idx}", error_code="DUPLICATE_ROUND")
                stop_reason = "duplicate_round_prevented"
                break
        except ResearchBudgetExceeded:
            stop_reason = "budget_exhausted"
            break
        round_plan = dict(plan)
        round_plan["_discovery_round"] = round_idx
        round_plan["_remaining_target"] = target_left
        round_plan["_requested_target"] = remaining_target
        round_plan["_page_budget"] = page_budget
        round_plan["_max_total_urls"] = pages_left
        if base_search_queries:
            round_plan["_search_queries_override"] = base_search_queries

        researcher = WebResearcher(
            round_plan,
            max_queries=max_queries,
            max_urls_per_query=max_urls,
            max_total_urls=pages_left,
            seen_urls=shared_seen_urls,
            cost_governor=cost_governor,
        )
        pages_this_round = 0
        leads_before_round = _effective_found()
        target_reached_in_round = False

        async for page in _ranked_page_stream(researcher.iter_scraped_pages(), round_plan):
            if _effective_found() >= remaining_target:
                target_reached_in_round = True
                break
            pages_scraped += 1
            pages_this_round += 1
            if pages_scraped > page_budget:
                break
            try:
                extracted = await extractor.extract_page(page)
            except ResearchBudgetExceeded:
                stop_reason = "budget_exhausted"
                break
            except Exception as exc:
                logger.warning(
                    "extract_page failed url=%s: %s",
                    str(page.get("url", ""))[:80],
                    exc,
                )
                continue
            if strict_marketing_signal and int(extractor.telemetry.get("llm_budget_exhausted") or 0):
                stop_reason = "budget_exhausted"
                logger.warning(
                    "agentic discovery strict marketing stop: LLM budget exhausted after %s pages",
                    pages_scraped,
                )
                break

            query_source = str(page.get("query_source") or "unknown")[:240]
            query_metrics = query_yield.setdefault(
                query_source,
                {
                    "pages": 0,
                    "leads": 0,
                    "source_lane": str(page.get("source_lane") or "supplemental")[:120],
                    "source_types": list(page.get("source_types") or [])[:10],
                    "expected_signals": list(page.get("expected_signals") or [])[:20],
                    "source_urls": [],
                    "source_observations": [],
                },
            )
            query_metrics["pages"] += 1
            query_metrics["leads"] += len(extracted)
            page_url = str(page.get("url") or "").strip()
            if page_url and page_url not in query_metrics["source_urls"]:
                query_metrics["source_urls"].append(page_url[:1000])
                query_metrics["source_urls"] = query_metrics["source_urls"][:25]
                query_metrics["source_observations"].append(
                    {
                        "url": page_url[:1000],
                        "observed_at": str(page.get("observed_at") or "")[:40] or None,
                    }
                )
                query_metrics["source_observations"] = query_metrics["source_observations"][:25]
            _update_runtime_stats("running")

            for item in extracted:
                if _effective_found() >= remaining_target:
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
                    if _effective_found() >= remaining_target:
                        target_reached_in_round = True
                        break

            if target_reached_in_round:
                break

        for execution in researcher.query_execution_log:
            executed_query = str(execution.get("query") or "unknown")[:240]
            query_metrics = query_yield.setdefault(
                executed_query,
                {
                    "pages": 0,
                    "leads": 0,
                    "source_lane": str(execution.get("source_lane") or "supplemental")[:120],
                    "source_types": list(execution.get("source_types") or [])[:10],
                    "expected_signals": list(execution.get("expected_signals") or [])[:20],
                    "source_urls": [],
                    "source_observations": [],
                },
            )
            query_metrics["query_status"] = str(execution.get("status") or "unknown")[:40]
            query_metrics["urls_discovered"] = int(execution.get("urls_discovered") or 0)
            for source_url in execution.get("urls_scheduled") or []:
                normalized_url = str(source_url).strip()[:1000]
                if normalized_url and normalized_url not in query_metrics["source_urls"]:
                    query_metrics["source_urls"].append(normalized_url)
            query_metrics["source_urls"] = query_metrics["source_urls"][:25]

        try:
            cost_governor.settle(
                f"search-round:{round_idx}",
                researcher.search_queries_executed * search_unit_cost,
                metadata={"queries_executed": researcher.search_queries_executed},
            )
            cost_governor.settle(
                f"crawl-round:{round_idx}",
                researcher.pages_scheduled * crawl_unit_cost,
                metadata={"pages_scheduled": researcher.pages_scheduled, "pages_yielded": pages_this_round},
            )
        except ResearchBudgetExceeded:
            stop_reason = "budget_exhausted"

        if researcher.cost_failure:
            stop_reason = "budget_exhausted"
        missing_required_source_signals = sorted(
            researcher.required_source_signals.difference(
                researcher.executed_required_signals
            )
        )
        if missing_required_source_signals:
            stop_reason = "incomplete_required_signal_lane_execution"
            logger.error(
                "required source lane execution incomplete missing_signals=%s executed_signals=%s",
                missing_required_source_signals,
                sorted(researcher.executed_required_signals),
            )

        if not base_search_queries and researcher.generated_base_queries:
            base_search_queries = list(researcher.generated_base_queries)
            search_query_generation_calls += 1

        if pending_flush:
            _flush_pending()
            if _effective_found() >= remaining_target:
                target_reached_in_round = True

        _save_checkpoint("round_complete")
        if stop_reason == "budget_exhausted":
            break
        if target_reached_in_round or _effective_found() >= remaining_target:
            break
        if pages_scraped >= page_budget:
            stop_reason = "page_budget"
            break
        if pages_this_round == 0 or _effective_found() == leads_before_round:
            empty_rounds += 1
        else:
            empty_rounds = 0
        empty_round_limit = max(1, AGENTIC_MAX_EMPTY_ROUNDS)
        missing_after_round = max(0, remaining_target - _effective_found())
        if _effective_found() > 0 and missing_after_round <= max(2, int(remaining_target * 0.25)):
            empty_round_limit += 3
        if empty_rounds >= empty_round_limit:
            try:
                from .search_serp import search_provider_status

                provider_status = search_provider_status()
                if provider_status.get("openai_rate_limited"):
                    stop_reason = "provider_rate_limited"
                    if stats_out is not None:
                        stats_out["provider_status"] = provider_status
                elif AGENTIC_REQUIRE_SEARCH_PROVIDER and not provider_status.get("configured"):
                    stop_reason = "provider_unavailable"
                    if stats_out is not None:
                        stats_out["provider_status"] = provider_status
                else:
                    stop_reason = "sources_exhausted"
            except Exception:
                stop_reason = "sources_exhausted"
            logger.info("agentic discovery: no pages round=%s — stop", round_idx)
            break

    if _effective_found() >= remaining_target:
        stop_reason = "target_reached"
    elif pages_scraped >= page_budget:
        stop_reason = "page_budget"
    exhausted = stop_reason in {"sources_exhausted", "provider_unavailable", "provider_rate_limited", "budget_exhausted"} and _effective_found() < remaining_target
    _save_checkpoint(stop_reason)
    if stats_out is not None:
        _update_runtime_stats(stop_reason)
        stats_out["exhausted"] = exhausted
    if exhausted:
        logger.info(
            "agentic discovery exhausted: found=%s target=%s pages=%s",
            _effective_found(),
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
