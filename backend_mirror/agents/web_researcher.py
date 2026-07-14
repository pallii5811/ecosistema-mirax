"""
Phase 5.1 — WebResearcher: LLM query generation + Google search + Playwright scrape.
Isolato dal worker legacy (Strangler Fig).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor
from bs4 import BeautifulSoup
from url_safety import assert_safe_public_url, install_playwright_ssrf_guard

logger = logging.getLogger("web_researcher")

DEFAULT_MAX_QUERIES = 7
DISCOVERY_MAX_QUERIES = int(os.getenv("AGENTIC_DISCOVERY_MAX_QUERIES", "12") or "12")
DEFAULT_MAX_URLS_PER_QUERY = 25
DISCOVERY_MAX_URLS_PER_QUERY = int(os.getenv("AGENTIC_DISCOVERY_MAX_URLS_PER_QUERY", "60") or "60")
DEFAULT_MAX_TEXT_CHARS = 5000
DEFAULT_PAGE_TIMEOUT_MS = int(os.getenv("AGENTIC_PAGE_TIMEOUT_MS", "8_000").replace("_", "") or "8000")
DEFAULT_NAV_TIMEOUT_MS = int(os.getenv("AGENTIC_NAV_TIMEOUT_MS", "12_000").replace("_", "") or "12000")

SKIP_URL_PATTERNS = (
    r"google\.(com|it)",
    r"youtube\.com",
    r"facebook\.com/(login|share)",
    r"instagram\.com",
    r"twitter\.com",
    r"x\.com",
    r"linkedin\.com/(login|signup)",
    r"wikipedia\.org",
    r"amazon\.",
    r"ebay\.",
    r"github\.com",
    r"medium\.com",
    r"trustpilot\.",
    r"tripadvisor\.",
    r"wikipedia\.",
    r"regione\.[a-z]",
    r"\.regione\.",
    r"camcom\.",
    r"infocamere\.",
    r"registroimprese\.",
    r"ospedale",
    r"asl\.",
    r"ats-",
    r"unicusano\.it",
    r"youtrend\.it",
    r"jobcentre\.it",
    r"prontopro\.it",
    r"ojs\.sijm\.it",
    r"karon\.it/pubblicazioni",
    r"/blog/",
    r"/guide/",
    r"/guida/",
    r"/pubblicazioni/",
    r"/allegato\.php",
    r"/chi-e-",
    r"/social-media-marketing/",
    r"/gestione-social",
    r"/gestione-pagina",
    r"/gestione-campagne",
    r"/gestione-google-ads",
    r"/gestione-facebook-ads",
    r"/agenzia-.*marketing/",
    r"/banner-design",
    r"\.(csv|xls|xlsx|pdf|zip)(\?|$)",
)

# Sempre appendere alle query generate (Iron Dome — escludi code host)
QUERY_CODE_EXCLUSIONS = "-site:github.com -site:medium.com"
SALES_INTEL_BIG_BRAND_EXCLUSIONS = (
    '-Canonical -Factorial -"Jet HR" -Personio -Salesforce -HubSpot '
    '-Amazon -Google -Microsoft -Oracle -SAP -Accenture -Deloitte -KPMG -PwC '
    '-Nike -Ferrari -Uniqlo -Primark -"Urban Outfitters" -IKEA -Zara -H&M '
    '-Mediaset -Iliad -Acer -MD -Pepco'
)
MARKETING_SIGNAL_NOISE_EXCLUSIONS = (
    '-blog -guida -"cos\'è" -"come funziona" -università -university '
    '-site:unicusano.it -site:youtrend.it -site:ojs.sijm.it -site:karon.it '
    '-site:wikipedia.org -site:facebook.com -site:linkedin.com'
)
MARKETING_SIGNAL_NOISE_EXCLUSIONS = (
    MARKETING_SIGNAL_NOISE_EXCLUSIONS
    + ' -agenzia -"web agency" -"digital agency" -consulenza -servizi -corso'
    + ' -"social media marketing" -"web marketing" -"performance marketing"'
)
MARKETING_CASE_STUDY_EXCLUSIONS = (
    '-"cos\'Ã¨" -"come funziona" -universitÃ  -university -corso '
    '-site:unicusano.it -site:youtrend.it -site:ojs.sijm.it -site:karon.it '
    '-site:wikipedia.org -site:facebook.com -site:linkedin.com'
)
SMB_BUYER_CONTEXT = '("PMI" OR "piccole medie imprese" OR "Srl" OR "azienda italiana" OR "scaleup italiana" OR "agenzia")'

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _plan_str(plan: Dict[str, Any], key: str, default: str = "") -> str:
    val = plan.get(key)
    if val is None:
        return default
    return str(val).strip()


def _should_skip_url(url: str) -> bool:
    if not url or not url.startswith("http"):
        return True
    low = url.lower()
    parsed = urlparse(low)
    path = parsed.path or ""
    if re.search(r"\.(csv|xls|xlsx|pdf|zip|rar|7z)$", path):
        return True
    for pat in SKIP_URL_PATTERNS:
        if re.search(pat, low):
            return True
    return False


def _normalize_google_href(href: str) -> Optional[str]:
    if not href:
        return None
    if href.startswith("/url?"):
        qs = parse_qs(urlparse(href).query)
        target = qs.get("q", [None])[0]
        return unquote(target) if target else None
    if href.startswith("http"):
        return href
    return None


def extract_main_text(html: str, max_chars: int = DEFAULT_MAX_TEXT_CHARS) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    for tag_name in ("nav", "footer", "header", "aside", "form"):
        for tag in soup.find_all(tag_name):
            tag.decompose()
    for tag in soup.find_all(attrs={"role": re.compile(r"navigation|banner|contentinfo", re.I)}):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.body
    if not main:
        text = soup.get_text(separator="\n", strip=True)
    else:
        text = main.get_text(separator="\n", strip=True)

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    compact = "\n".join(lines)
    compact = re.sub(r"\n{3,}", "\n\n", compact)
    if len(compact) > max_chars:
        compact = compact[: max_chars - 3].rstrip() + "..."
    return compact


def _harden_search_query(query: str) -> str:
    """Applica esclusioni code host obbligatorie a ogni query Boolean."""
    q = re.sub(r"\s+", " ", (query or "").strip())
    if not q:
        return q
    for token in QUERY_CODE_EXCLUSIONS.split():
        q = re.sub(re.escape(token), "", q, flags=re.IGNORECASE)
    q = re.sub(r"\s+", " ", q).strip()
    suffix = f" {QUERY_CODE_EXCLUSIONS}"
    max_len = 500
    if len(q) + len(suffix) <= max_len:
        return f"{q}{suffix}"
    kept: List[str] = []
    for token in q.split():
        candidate = " ".join([*kept, token]).strip()
        if len(candidate) + len(suffix) > max_len:
            break
        kept.append(token)
    return f"{' '.join(kept).rstrip()}{suffix}"


def _finalize_search_queries(queries: List[str], *, max_queries: int = DEFAULT_MAX_QUERIES) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for raw in queries:
        qn = _harden_search_query(raw)
        if not qn:
            continue
        key = qn.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(qn)
        if len(out) >= max_queries:
            break
    return out


def _is_sales_intelligence_seller_query(plan: Dict[str, Any]) -> bool:
    """True when the user sells lead-gen/sales-intelligence software/services."""
    hypothesis = plan.get("commercial_hypothesis") if isinstance(plan.get("commercial_hypothesis"), dict) else {}
    blob = " ".join(
        str(value or "")
        for value in (
            plan.get("original_query"),
            plan.get("query"),
            hypothesis.get("offer"),
            hypothesis.get("target_profile"),
            " ".join(str(v) for v in hypothesis.get("buying_signals") or []),
        )
    ).lower()
    return bool(
        re.search(r"\b(lead\s*generation|leadgen|sales intelligence|prospecting|outbound|pipeline)\b", blob)
        and re.search(r"\b(vendere|vendo|software|servizio|piattaforma|tool)\b", blob)
    )


def _sales_intel_smb_queries(location: str) -> List[str]:
    """High-intent discovery lanes for users selling sales-intel/lead-gen."""
    loc = location or "Italia"
    neg = SALES_INTEL_BIG_BRAND_EXCLUSIONS
    smb = SMB_BUYER_CONTEXT
    current_year = datetime.now(timezone.utc).year
    return [
        f'site:.it "lavora con noi" SDR PMI {loc} {neg}',
        f'site:.it "lavora con noi" "Business Developer" Srl {loc} {neg}',
        f'site:.it "posizioni aperte" commerciale Srl {loc} {neg}',
        f'site:.it "Sales Account" "lavora con noi" Srl {loc} {neg}',
        f'site:.it "partner commerciali" PMI {loc} {current_year} {neg}',
        f'site:.it "nuova sede" "Srl" commerciale {loc} {neg}',
        f'site:.it "Google Ads" "Srl" vendite {loc} {neg}',
        f'site:.it "richiedi demo" CRM Srl {loc} {neg}',
    ]


def _role_or_clause(roles: List[str], fallback: str) -> str:
    clean: List[str] = []
    seen: Set[str] = set()
    for role in roles[:8]:
        val = re.sub(r"\s+", " ", str(role or "").strip())
        if not val:
            continue
        key = val.lower()
        if key in seen:
            continue
        seen.add(key)
        clean.append(f'"{val}"' if " " in val else val)
    if not clean:
        clean = [f'"{fallback}"' if " " in fallback else fallback]
    return "(" + " OR ".join(clean[:8]) + ")"


def _queries_for_discovery_round(
    queries: List[str],
    plan: Dict[str, Any],
    *,
    max_queries: int,
) -> List[str]:
    """Make every discovery round explore a genuinely different SERP slice."""
    try:
        round_idx = max(1, int(plan.get("_discovery_round") or 1))
    except (TypeError, ValueError):
        round_idx = 1
    base = _finalize_search_queries(queries, max_queries=max_queries)
    if round_idx <= 1:
        return base

    current_year = datetime.now(timezone.utc).year
    is_sales_hiring = _is_sales_intelligence_seller_query(plan)
    suffixes = (
        f'({current_year} OR {current_year - 1} OR "ultimo anno")',
        '("lavora con noi" OR careers OR "posizioni aperte")'
        if is_sales_hiring
        else '("comunicato stampa" OR newsroom OR notizie)',
        '("sales" OR commerciale OR outbound OR prospecting)'
        if is_sales_hiring
        else '(provincia OR regione OR Italia)',
        '(intitle:careers OR intitle:jobs OR "join us")'
        if is_sales_hiring
        else '(filetype:pdf OR intitle:news OR intitle:careers)',
    )
    suffix = suffixes[(round_idx - 2) % len(suffixes)]
    cycle = (round_idx - 2) // len(suffixes)
    diversified: List[str] = []
    for query in base:
        clean = query.replace(QUERY_CODE_EXCLUSIONS, "").strip()
        oldest_year = max(2010, datetime.now(timezone.utc).year - cycle * 2)
        page_hint = f" after:{oldest_year}-01-01" if cycle else ""
        diversified.append(f"{clean} {suffix}{page_hint}")
    return _finalize_search_queries(diversified, max_queries=max_queries)


def _signal_boolean_queries(plan: Dict[str, Any]) -> List[str]:
    """Query Boolean mirate al required_signal (USE)."""
    signals_raw = plan.get("required_signals") or []
    sig_set = {str(s).lower().strip().replace("-", "_") for s in signals_raw}
    sector = _plan_str(plan, "sector") or "piccole medie imprese italiane"
    location = _plan_str(plan, "location") or "Italia"
    original = _plan_str(plan, "original_query")
    orig_low = original.lower()
    hypothesis = plan.get("commercial_hypothesis") if isinstance(plan.get("commercial_hypothesis"), dict) else {}
    hypothesis_roles = [
        str(value).strip()
        for value in hypothesis.get("hiring_roles") or []
        if str(value).strip()
    ]

    role = ""
    if re.search(r"\b(commercialist\w*|ragionier\w*|contabil\w*)\b", orig_low):
        role = "commercialista"
    elif re.search(r"\b(developer|sviluppator\w*|programmat\w*|software\s+engineer|data\s+engineer|cybersecurity)\b", orig_low):
        role = "developer"
    elif re.search(r"\b(marketing|seo|ads)\b", orig_low):
        role = "marketing"

    queries: List[str] = []
    if sig_set.intersection({"hiring", "hiring_operational", "hiring_technology", "hiring_sales", "hiring_marketing"}):
        if hypothesis_roles and _is_sales_intelligence_seller_query(plan):
            queries.append(
                '(site:indeed.it OR site:infojobs.it) '
                f'("SDR" OR "BDR" OR "Inside Sales") (outbound OR prospecting) {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                '("Sales Development Representative" OR "Business Developer") '
                f'(pipeline OR "new business" OR "sviluppo nuovi clienti") {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                'site:.it (careers OR "lavora con noi") '
                f'(SDR OR BDR OR "Business Developer") {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'("Sales Account" OR "Account Executive") ("new business" OR outbound OR prospecting) {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'("Business Development Representative" OR BDR) ("pipeline" OR prospecting) {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'("Inside Sales" OR "Sales Development") ("lavora con noi" OR careers) {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'site:linkedin.com/jobs ("SDR" OR "Business Developer" OR "Sales Account") {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'("Junior Sales" OR "Sales Specialist") (outbound OR "sviluppo commerciale") {location} {SMB_BUYER_CONTEXT} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
        elif hypothesis_roles:
            role_clause = _role_or_clause(hypothesis_roles, role)
            queries.append(
                f'(site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs) {role_clause} {location} '
                f'("Srl" OR "PMI" OR "azienda") {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'site:.it ("lavora con noi" OR careers OR "posizioni aperte") {role_clause} '
                f'("Srl" OR "PMI" OR "azienda") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'{role_clause} ("assume" OR "ricerca personale" OR "cerca") '
                f'("Srl" OR "PMI" OR "azienda") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
        else:
            # An unspecified hiring query must not silently become a developer
            # search. Prefer identifiable official SME career pages, then job
            # boards constrained to company-bearing vacancy pages.
            role_clause = f'"{role}"' if role else '("ruoli aperti" OR assunzioni OR "ricerca personale")'
            queries.append(
                f'site:.it ("lavora con noi" OR careers OR "posizioni aperte") '
                f'{role_clause} '
                f'("Srl" OR "PMI" OR azienda) {location} '
                f'-site:indeed.it -site:infojobs.it -site:linkedin.com {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
            queries.append(
                f'(site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs) '
                f'{role_clause} ("Srl" OR "PMI" OR azienda) (assunzioni OR "posizioni aperte") '
                f'{location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
            )
    if sig_set & {"funding", "funding_received", "sector_investment"}:
        queries.append(f'site:startupitalia.eu OR site:italian.tech "round di finanziamento" {sector}')
    if "expansion" in sig_set:
        queries.append(f'("nuova sede" OR ampliamento OR "nuova apertura" OR "cresce") ("Srl" OR "PMI" OR "azienda") {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
        queries.append(f'("assume" OR "aumenta organico" OR "potenzia") ("Srl" OR "PMI" OR "azienda") {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
    if "production_expansion" in sig_set:
        queries.append(
            f'("ampliamento produttivo" OR "nuovo stabilimento" OR "nuovo impianto" OR "aumento capacità produttiva") '
            f'("Srl" OR "PMI" OR impresa) {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
        )
        queries.append(
            f'site:.it (news OR comunicati OR newsroom) (stabilimento OR impianto OR "linea produttiva") '
            f'(ampliamento OR investimento OR espansione) {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
        )
    if "new_location" in sig_set:
        queries.append(
            f'("nuova sede" OR "apertura filiale" OR inaugura OR trasferimento) '
            f'("Srl" OR "PMI" OR impresa OR studio) {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
        )
    if sig_set & {"investing_marketing", "meta_ads_started", "google_ads_started"}:
        neg = f"{SALES_INTEL_BIG_BRAND_EXCLUSIONS} {MARKETING_SIGNAL_NOISE_EXCLUSIONS}"
        case_neg = f"{SALES_INTEL_BIG_BRAND_EXCLUSIONS} {MARKETING_CASE_STUDY_EXCLUSIONS}"
        queries.append(
            f'site:.it ("Meta Ads" OR "Facebook Ads" OR "Google Ads" OR "paid media") '
            f'("Srl" OR "PMI" OR "piccole medie imprese" OR "azienda") {location} {neg}'
        )
        queries.append(
            f'site:.it ("inserzioni attive" OR "Libreria Inserzioni" OR "conversion tracking" OR "lead ads") '
            f'("Srl" OR "azienda" OR "PMI") {location} {neg}'
        )
        queries.append(
            f'("case study" OR "success story") ("Google Ads" OR "Meta Ads" OR "performance marketing") '
            f'("cliente" OR "risultati" OR "fatturato" OR "lead") {location} {case_neg}'
        )
        queries.append(
            f'("caso studio" OR "case history") ("campagne Google Ads" OR "campagne Meta Ads") '
            f'("cliente" OR "risultati") {location} {case_neg}'
        )
        queries.append(
            f'site:.it ("landing page" OR "richiedi preventivo" OR "richiedi informazioni") '
            f'("Meta Pixel" OR "Google Tag Manager" OR "conversioni") {location} {neg}'
        )
    if sig_set & {"seeking_supplier"}:
        queries.append(
            f'("cerchiamo fornitori" OR "albo fornitori" OR "manifestazione di interesse" OR "richiesta preventivo") {sector} {location}'
        )
    if sig_set & {"new_product", "market_entry", "executive_change", "investing_expansion"}:
        queries.append(
            f'("nuovo prodotto" OR "nuovo mercato" OR "nuova partnership" OR "accordo commerciale") {sector} {location}'
        )
        queries.append(
            f'(fiera OR expo OR webinar OR stand OR sponsor) {sector} {location}'
        )
    if sig_set.intersection({"tender_won", "contract_awarded"}):
        queries.append(f'site:anac.gov.it OR "comunicato stampa" "aggiudicazione appalto" {location}')
        queries.append(f'("gara aggiudicata" OR "appalto aggiudicato" OR "contratto affidato") ("Srl" OR "impresa") {sector} {location}')
    if sig_set & {"new_company", "registry_change"}:
        queries.append(f'"nuova apertura" OR "costituzione società" {sector} {location}')
        queries.append(f'("nuova apertura" OR "nuova attività" OR "costituzione società" OR "nasce") ("Srl" OR "startup" OR "impresa") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
        queries.append(f'("apre" OR "inaugura" OR "nuova sede") ("negozio" OR "studio" OR "azienda" OR "ecommerce") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
    if sig_set & {"site_stale", "no_pixel", "no_gtm"}:
        queries.append(f'site:.it ("copyright 2019" OR "copyright 2020" OR "copyright 2021") ("Srl" OR "azienda" OR "negozio" OR "hotel" OR "ristorante") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
        queries.append(f'site:.it ("sito in costruzione" OR "coming soon" OR "under construction") ("Srl" OR "azienda") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
        queries.append(f'site:.it ("richiedi preventivo" OR "prenota" OR "contattaci") ("Srl" OR "azienda") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}')
    if sig_set & {"regulatory", "regulatory_change"}:
        queries.append(f'("certificazione" OR "sicurezza sul lavoro" OR "adeguamento normativo" OR compliance) ("Srl" OR "PMI" OR "azienda") {location}')
        queries.append(
            f'(site:gazzettaufficiale.it OR site:gov.it OR site:regione.it) '
            f'("nuovi requisiti" OR obbligo OR adeguamento OR autorizzazione) {sector} {location}'
        )
    if sig_set & {"tech_migration", "technology_migration"}:
        queries.append(f'"digital transformation" OR "migrazione cloud" {sector} {location}')
        queries.append(
            f'("migrazione ERP" OR "nuovo CRM" OR "nuova piattaforma" OR "sostituzione gestionale") '
            f'("Srl" OR "PMI" OR azienda) {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
        )
    if "cybersecurity_exposure" in sig_set:
        queries.append(
            f'site:.it (ecommerce OR e-commerce OR webmail OR "area clienti") '
            f'("Srl" OR "PMI" OR azienda) {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
        )
        queries.append(
            f'("vulnerabilità" OR "rischio cyber" OR "sicurezza informatica" OR "servizi esposti") '
            f'("Srl" OR "PMI" OR azienda) {sector} {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}'
        )
    return queries


_LANE_QUERY_CONTEXT: Dict[str, str] = {
    "public_registry": '(site:registroimprese.it OR site:infocamere.it OR site:camcom.it)',
    "public_procurement": '(site:anac.gov.it OR site:ted.europa.eu OR "albo pretorio")',
    "job_market": '(site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs OR "lavora con noi")',
    "funding": '(site:startupitalia.eu OR site:italian.tech OR "round di finanziamento" OR investitori)',
    "company_web": '(site:.it "chi siamo" OR site:.it newsroom OR site:.it careers)',
    "news": '("comunicato stampa" OR newsroom OR "stampa locale")',
    "technology": '("case study" OR migrazione OR implementazione OR "nuovo software")',
    "real_estate": '("nuova sede" OR trasferimento OR ampliamento OR "nuova apertura")',
    "regulatory": '(site:gazzettaufficiale.it OR site:gov.it OR site:regione.it OR autorizzazione OR obbligo)',
    "ads": '("Meta Ad Library" OR "Google Ads" OR "inserzioni attive" OR "campagna" OR "landing page")',
    "reviews": '("recensioni" OR "Trustpilot" OR "Google reviews" OR "stelle" OR "lamentano")',
    "events": '("fiera" OR "evento" OR "webinar" OR "expo" OR "stand" OR sponsor)',
    "marketplace": '("partner directory" OR marketplace OR "app marketplace" OR integrazione OR directory)',
    "partnerships": '("nuova partnership" OR "accordo commerciale" OR "partner commerciale" OR "rete vendita" OR "canale vendita")',
    "compliance": '("certificazione" OR "obbligo" OR "adeguamento" OR normativa OR compliance OR "albo fornitori")',
    "web_evidence": '(evidenza OR annuncio OR comunicato OR registro)',
}

_LANE_SCOPE_HINTS: Dict[str, re.Pattern[str]] = {
    "job_market": re.compile(r"indeed|infojobs|linkedin\.com/jobs|lavora\s+con\s+noi|careers?|posizioni\s+aperte", re.I),
    "public_procurement": re.compile(r"anac|ted\.europa|appalto|gara\s+aggiudicata|contratto\s+affidato|albo\s+pretorio", re.I),
    "web_evidence": re.compile(r"\bsite:|https?://|sito\s+ufficiale|newsroom|comunicato", re.I),
    "company_web": re.compile(r"\bsite:|https?://|chi\s+siamo|careers?|newsroom", re.I),
}


def _source_plan_query_specs(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    source_plan = plan.get("source_plan")
    if not isinstance(source_plan, list):
        return []
    original = _plan_str(plan, "original_query")
    sector = _plan_str(plan, "sector")
    location = _plan_str(plan, "location") or "Italia"
    rows = [row for row in source_plan if isinstance(row, dict)]
    rows.sort(key=lambda row: float(row.get("priority") or 0), reverse=True)
    row_specs: List[List[Dict[str, Any]]] = []
    for row in rows:
        lane = str(row.get("lane") or "web_evidence")
        lane_context = _LANE_QUERY_CONTEXT.get(lane, _LANE_QUERY_CONTEXT["web_evidence"])
        templates = row.get("query_templates")
        if not isinstance(templates, list) or not templates:
            templates = [original]
        specs: List[Dict[str, Any]] = []
        for template in templates[:2]:
            query = str(template or original).strip()
            query = (
                query.replace("{query}", original)
                .replace("{sector}", sector)
                .replace("{location}", location)
            )
            if not query:
                continue
            scope_hint = _LANE_SCOPE_HINTS.get(lane)
            if lane_context.lower() not in query.lower() and not (scope_hint and scope_hint.search(query)):
                query = f"{query} {lane_context}"
            specs.append({
                "query": query,
                "lane": lane,
                "expected_signals": [
                    str(value).strip().lower().replace("-", "_")
                    for value in row.get("expected_evidence") or []
                    if str(value).strip()
                ],
                "source_types": [str(value).strip() for value in row.get("source_types") or [] if str(value).strip()],
            })
        if specs:
            row_specs.append(specs)

    # Coverage first: take one executable query from every selected lane before
    # spending a second query on a high-priority lane. This prevents two hiring
    # templates from crowding procurement/expansion out of a small canary budget.
    ordered: List[Dict[str, Any]] = []
    for template_index in range(2):
        for specs in row_specs:
            if template_index < len(specs):
                ordered.append(specs[template_index])
    required_lane_count = sum(1 for specs in row_specs if specs[0].get("expected_signals"))
    query_cap = max(DISCOVERY_MAX_QUERIES, required_lane_count)
    return ordered[:query_cap]


def _source_plan_queries(plan: Dict[str, Any]) -> List[str]:
    return [str(spec["query"]) for spec in _source_plan_query_specs(plan)]


def _required_source_lane_count(plan: Dict[str, Any]) -> int:
    return len(_required_source_signals(plan))


def _required_source_signals(plan: Dict[str, Any]) -> Set[str]:
    required = {
        str(value).strip().lower().replace("-", "_")
        for value in plan.get("required_signals") or []
        if str(value).strip()
    }
    covered: Set[str] = set()
    for spec in _source_plan_query_specs(plan):
        signals = {str(value) for value in spec.get("expected_signals") or []}
        covered.update(signals.intersection(required))
    return covered


def _query_source_metadata(plan: Dict[str, Any], query: str) -> Dict[str, Any]:
    # Discovery-round suffixes are inserted before the standard exclusions.
    # Compare the stable query core, otherwise rounds 2+ silently lose their
    # source lane and expected-signal lineage.
    hardened_query = re.sub(
        r"\s+", " ", _harden_search_query(query).replace(QUERY_CODE_EXCLUSIONS, "")
    ).strip().lower()
    for spec in _source_plan_query_specs(plan):
        hardened_spec = re.sub(
            r"\s+", " ",
            _harden_search_query(str(spec.get("query") or "")).replace(QUERY_CODE_EXCLUSIONS, ""),
        ).strip().lower()
        if hardened_spec and (hardened_query == hardened_spec or hardened_spec in hardened_query):
            return {
                "source_lane": str(spec.get("lane") or "web_evidence"),
                "expected_signals": list(spec.get("expected_signals") or []),
                "source_types": list(spec.get("source_types") or []),
            }
    return {"source_lane": "supplemental", "expected_signals": [], "source_types": []}


def _heuristic_search_queries(plan: Dict[str, Any]) -> List[str]:
    """Fallback offline — Boolean per signal + query B2B."""
    original = _plan_str(plan, "original_query")
    sector = _plan_str(plan, "sector")
    location = _plan_str(plan, "location") or "Italia"
    signals = plan.get("required_signals") or []
    orig_low = original.lower()

    # Interleave explicit signal queries with source-plan lanes. This guarantees
    # that a long source plan cannot crowd the user's primary constraint out of
    # the seven-query SERP budget.
    source_queries = _source_plan_queries(plan)
    signal_queries = _signal_boolean_queries(plan)
    required_lane_count = _required_source_lane_count(plan)
    # Required source lanes are executable obligations, not suggestions. Put
    # one query per required signal first; then interleave supplemental signal
    # and second-template queries for recall.
    queries: List[str] = list(source_queries[:required_lane_count])
    remaining_source_queries = source_queries[required_lane_count:]
    for index in range(max(len(remaining_source_queries), len(signal_queries))):
        if index < len(signal_queries):
            queries.append(signal_queries[index])
        if index < len(remaining_source_queries):
            queries.append(remaining_source_queries[index])

    seller_sales_intel = _is_sales_intelligence_seller_query(plan)
    accountant_seller = bool(re.search(r"\b(commercialist\w*|ragionier\w*|contabil\w*)\b", orig_low))
    if accountant_seller:
        # A seller profession is not a hiring role. Keep discovery anchored to
        # registry/company/news lanes and observable corporate events; generic
        # "nuova apertura" SERPs otherwise over-index on retail careers and
        # famous chains before the extractor sees a valid SME.
        queries = [
            *source_queries,
            f'(site:registroimprese.it OR site:infocamere.it OR site:camcom.it) '
            f'("nuova impresa" OR "variazione societaria" OR "nuova sede") {location}',
            f'("nuova sede" OR "nuova apertura" OR "costituita nel") '
            f'("Srl" OR "PMI") {location} {SALES_INTEL_BIG_BRAND_EXCLUSIONS}',
        ]
    if seller_sales_intel:
        # Broad SERPs over-index on famous SaaS/enterprise brands. Put
        # PMI/local-first, evidence-rich lanes before any source-plan/LLM query.
        queries = [*_sales_intel_smb_queries(location), *queries]

    if re.search(r"\b(python|programmatore|developer|sviluppat\w*)\b", orig_low):
        queries.extend([
            f'site:indeed.it OR site:infojobs.it "sviluppatore Python" {location}',
            f'piccole medie imprese {location} lavora con noi sviluppatore backend -pmi.com',
        ])
    elif not seller_sales_intel and not accountant_seller and re.search(r"\b(potenziali clienti|vendere)\b", orig_low):
        queries.extend([
            f'"nuova apertura" OR "costituzione società" {location}',
            f'site:startupitalia.eu "round di finanziamento" {location}',
        ])
    elif not queries and re.search(r"\b(sono\s+un|freelanc|clienti|potrebbero\s+aver\s+bisogno)\b", orig_low):
        queries.extend([
            f'piccole medie imprese {location} in crescita assume {datetime.now(timezone.utc).year} site:.it -pmi.com',
            f'site:startupitalia.eu funding round {location}',
        ])
    elif not queries:
        parts = [p for p in [sector, location] if p and p.lower() not in {"agentic ai", "pmi", "aziende", "aziende in crescita"}]
        base = " ".join(dict.fromkeys(" ".join(parts).split())) or f"aziende {location}"
        queries.extend([
            f"{base} investimento espansione {datetime.now(timezone.utc).year}",
            f"{base} lavora con noi careers",
        ])

    if "hiring" in signals and not any("indeed" in q for q in queries):
        queries.append(f'site:indeed.it OR site:infojobs.it "{sector or "piccole medie imprese italiane"}" Italia -pmi.com')

    return _finalize_search_queries(
        queries,
        max_queries=max(DISCOVERY_MAX_QUERIES, required_lane_count),
    )


B2B_SYSTEM_PROMPT = """Sei un Universal Web Researcher B2B evidence-first per MIRAX.

La query originale e il vincolo dominante. Distingui sempre il prodotto venduto
dal settore dell'acquirente. Usa commercial_hypothesis per cercare fatti, non
come prova. Ottimizza per lead caldi: intent fit, specificita del segnale,
recenza, qualita della fonte e possibilita di contatto.

Genera query di ricerca Boolean mirate alle FONTI GIUSTE in base a required_signals nel MiraxQueryPlan:

- hiring → OBBLIGATORIO: site:indeed.it OR site:infojobs.it "[ruolo]" Italia
- funding_received / expansion → site:startupitalia.eu OR site:italian.tech "round di finanziamento" [settore]
- tender_won → site:anac.gov.it OR "comunicato stampa" "aggiudicazione appalto" [città]
- new_company → "nuova apertura" OR "costituzione società" [settore] [città]
- tech_migration → "digital transformation" OR "migrazione cloud" [settore]
- registry_change → "nuova sede", "costituzione società", "apre", "inaugura" con PMI/Srl
- site_stale / no_pixel / no_gtm → audit su sito ufficiale, copyright vecchio, tracking assente, CTA/funnel
- regulatory → certificazioni, sicurezza sul lavoro, adeguamenti normativi e compliance

Miniere d'oro da usare quando coerenti con source_plan o required_signals:
- ads attivi e landing page: Meta Ad Library, Google Ads, campagne, CTA commerciali
- ricerca fornitori: albo fornitori, manifestazione di interesse, richieste preventivo, bandi
- crescita commerciale: fiere, eventi, webinar, partnership, rete vendita, nuovi mercati
- pain pubblici: recensioni, Trustpilot, Google reviews e complaint solo se la query/source_plan li richiede

REGOLE IRON DOME:
- Ogni query DEVE includere: -site:github.com -site:medium.com
- Se l'utente vende lead generation, sales intelligence o outbound, cerca PMI,
  Srl, agenzie, studi e scaleup non famose. Escludi colossi, brand gia noti
  ed enterprise salvo richiesta esplicita.
- NON cercare la professione dell'utente letteralmente — cerca aziende con SEGNALI DI BISOGNO.
- NON query generiche ("aziende informatica Italia").
- Genera il numero richiesto di query diverse, operatori Boolean (site:, OR, virgolette).
- Segui source_plan, research_questions ed evidence_policy quando presenti.
- Per seller intent usa buying_signals e hiring_roles della commercial_hypothesis.
- Le query devono cercare il FATTO osservabile, non il nome del software venduto.
- Scegli fonti verticali, registri e fonti primarie prima del web generico.
- Non imporre paese, dimensione o forma giuridica se l'utente non li richiede."""



class WebResearcher:
    """
    Agente ricercatore web autonomo.
    Input: MiraxQueryPlan (dict).
    Output: [{ url, raw_text, query_source }, ...]
    """

    def __init__(
        self,
        plan: Dict[str, Any],
        *,
        max_queries: int = DEFAULT_MAX_QUERIES,
        max_urls_per_query: int = DEFAULT_MAX_URLS_PER_QUERY,
        max_total_urls: Optional[int] = None,
        max_text_chars: int = DEFAULT_MAX_TEXT_CHARS,
        page_timeout_ms: int = DEFAULT_PAGE_TIMEOUT_MS,
        seen_urls: Optional[Set[str]] = None,
        cost_governor: Optional[ResearchCostGovernor] = None,
    ) -> None:
        if not isinstance(plan, dict):
            raise ValueError("plan must be a dict (MiraxQueryPlan)")
        self.plan = plan
        required_lane_count = _required_source_lane_count(plan)
        # The caller reserves cost for exactly ``max_queries``.  Silently
        # raising an affordable one-query round to three queries breaks the
        # reserve-before-execute contract and can settle above the hard cap.
        # Required semantic lanes inform planning, but they must never raise
        # the number of paid calls above the caller's reserved breadth.
        requested_query_count = max(1, int(max_queries))
        configured_query_cap = max(1, DISCOVERY_MAX_QUERIES, required_lane_count)
        self.max_queries = max(1, min(requested_query_count, configured_query_cap))
        self.max_urls_per_query = max(1, min(max_urls_per_query, max(1, DISCOVERY_MAX_URLS_PER_QUERY)))
        if max_total_urls is None:
            try:
                raw_total = int(plan.get("_max_total_urls") or 0)
                max_total_urls = raw_total if raw_total > 0 else None
            except (TypeError, ValueError):
                max_total_urls = None
        self.max_total_urls = (
            max(1, int(max_total_urls))
            if max_total_urls is not None
            else self.max_urls_per_query * self.max_queries
        )
        self.max_text_chars = max_text_chars
        self.page_timeout_ms = page_timeout_ms
        self.seen_urls = seen_urls if seen_urls is not None else set()
        self.cost_governor = cost_governor
        self.generated_base_queries: List[str] = []
        self.search_queries_executed = 0
        self.pages_scheduled = 0
        self.cost_failure = False
        self.required_source_signals = _required_source_signals(plan)
        self.executed_required_signals: Set[str] = set()
        self.executed_source_lanes: Set[str] = set()
        self.query_execution_log: List[Dict[str, Any]] = []
        try:
            self.scrape_workers = max(1, min(8, int(os.getenv("AGENTIC_SCRAPE_WORKERS", "4") or "4")))
        except ValueError:
            self.scrape_workers = 4

    async def generate_search_queries(self) -> List[str]:
        override = self.plan.get("_search_queries_override")
        if isinstance(override, list):
            self.generated_base_queries = _finalize_search_queries(
                [str(value) for value in override if str(value).strip()],
                max_queries=self.max_queries,
            )
            return _queries_for_discovery_round(
                self.generated_base_queries,
                self.plan,
                max_queries=self.max_queries,
            )
        deterministic = _heuristic_search_queries(self.plan)
        llm_queries = (
            []
            if len(deterministic) >= self.max_queries
            else await _llm_search_queries(self.plan, self.max_queries, self.cost_governor)
        )
        self.generated_base_queries = _finalize_search_queries(
            [*deterministic, *llm_queries],
            max_queries=self.max_queries,
        )
        return _queries_for_discovery_round(
            self.generated_base_queries,
            self.plan,
            max_queries=self.max_queries,
        )

    async def _discover_urls_for_query(self, query: str) -> List[str]:
        """HTTP SERP (Bing/DDG) first, Playwright Google as fallback."""
        try:
            from .search_serp import search_urls_http, DEFAULT_SERP_TARGET

            serp_target = max(self.max_urls_per_query, DEFAULT_SERP_TARGET)
            urls = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: search_urls_http(query, serp_target),
            )
            if urls:
                logger.info("HTTP SERP: %s urls for query=%r", len(urls), query[:70])
                return urls
        except ResearchBudgetExceeded:
            raise
        except Exception as exc:
            logger.warning("HTTP SERP failed query=%r: %s", query[:70], exc)
        return await self._search_google_playwright(query)

    async def _discover_url_jobs(
        self,
        queries: List[str],
    ) -> List[tuple[str, str, Dict[str, Any]]]:
        """Discover URLs without allowing an early lane to starve required lanes.

        Required source queries are all executed before discovery may stop at the
        global URL cap.  When the cap can hold one URL per still-missing signal,
        capacity is reserved for those signals instead of being consumed by the
        first high-yield SERP.
        """
        url_jobs: List[tuple[str, str, Dict[str, Any]]] = []
        url_job_limit = max(1, min(self.max_total_urls, self.max_urls_per_query * self.max_queries))

        for query in queries:
            # This is the last deterministic boundary before a provider call.
            # The round-level reservation authorizes exactly ``max_queries``;
            # never rely on generated-query truncation or end-of-round
            # settlement to enforce that authorization.
            if self.search_queries_executed >= self.max_queries:
                logger.info(
                    "query reservation exhausted: authorized=%s executed=%s",
                    self.max_queries,
                    self.search_queries_executed,
                )
                break
            metadata = _query_source_metadata(self.plan, query)
            expected = {
                str(value).strip().lower().replace("-", "_")
                for value in metadata.get("expected_signals") or []
                if str(value).strip()
            }.intersection(self.required_source_signals)
            missing_before = self.required_source_signals.difference(self.executed_required_signals)
            query_is_required = bool(expected.intersection(missing_before))

            if len(url_jobs) >= url_job_limit and not query_is_required:
                if self.required_source_signals.issubset(self.executed_required_signals):
                    break

            try:
                # Count the paid attempt for settlement even if the provider
                # subsequently raises. Semantic coverage is recorded only when
                # the query call itself completes.
                self.search_queries_executed += 1
                if self.search_queries_executed > self.max_queries:
                    raise ResearchBudgetExceeded("query execution exceeds reserved query count")
                found = await self._discover_urls_for_query(query)
                self.executed_required_signals.update(expected)
                self.executed_source_lanes.add(str(metadata.get("source_lane") or "supplemental"))

                missing_after = self.required_source_signals.difference(self.executed_required_signals)
                reserved_slots = min(len(missing_after), max(0, url_job_limit - len(url_jobs)))
                capacity = max(0, url_job_limit - len(url_jobs) - reserved_slots)
                per_query_limit = min(self.max_urls_per_query, capacity)
                added = 0
                scheduled_urls: List[str] = []
                for url in found:
                    if added >= per_query_limit:
                        break
                    key = url.lower().rstrip("/")
                    if key in self.seen_urls:
                        continue
                    self.seen_urls.add(key)
                    url_jobs.append((url, query, metadata))
                    scheduled_urls.append(url)
                    added += 1
                self.query_execution_log.append(
                    {
                        "query": query[:500],
                        "status": "completed",
                        "source_lane": str(metadata.get("source_lane") or "supplemental"),
                        "source_types": list(metadata.get("source_types") or []),
                        "expected_signals": sorted(expected),
                        "urls_discovered": len(found),
                        "urls_scheduled": scheduled_urls[: self.max_urls_per_query],
                    }
                )
            except ResearchBudgetExceeded:
                raise
            except Exception as exc:
                logger.warning("search failed query=%r: %s", query[:80], exc)
                self.query_execution_log.append(
                    {
                        "query": query[:500],
                        "status": "failed",
                        "source_lane": str(metadata.get("source_lane") or "supplemental"),
                        "source_types": list(metadata.get("source_types") or []),
                        "expected_signals": sorted(expected),
                        "urls_discovered": 0,
                        "urls_scheduled": [],
                        "error_class": type(exc).__name__,
                    }
                )

            if (
                len(url_jobs) >= url_job_limit
                and self.required_source_signals.issubset(self.executed_required_signals)
            ):
                break

        return url_jobs

    async def _search_google_playwright(self, query: str) -> List[str]:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright not installed")
            return await _search_google_optional_lib(query, self.max_urls_per_query)

        urls: List[str] = []
        seen: Set[str] = set()

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-blink-features=AutomationControlled",
                    ],
                )
                context = await browser.new_context(
                    user_agent=USER_AGENT,
                    locale="it-IT",
                    viewport={"width": 1280, "height": 720},
                )
                page = await context.new_page()
                await install_playwright_ssrf_guard(page)
                search_url = f"https://www.google.com/search?q={quote_plus(query)}&hl=it&num=15"
                try:
                    await page.goto(search_url, timeout=DEFAULT_NAV_TIMEOUT_MS, wait_until="domcontentloaded")
                    await page.wait_for_timeout(1500)
                except Exception as exc:
                    logger.warning("google SERP navigation failed query=%r: %s", query[:80], exc)
                    await browser.close()
                    return await _search_google_optional_lib(query, self.max_urls_per_query)

                anchors = await page.query_selector_all("a[href]")
                for a in anchors:
                    if len(urls) >= self.max_urls_per_query:
                        break
                    try:
                        href = await a.get_attribute("href")
                    except Exception:
                        continue
                    normalized = _normalize_google_href(href or "")
                    if not normalized or _should_skip_url(normalized):
                        continue
                    key = normalized.lower().rstrip("/")
                    if key in seen:
                        continue
                    seen.add(key)
                    urls.append(normalized)

                await browser.close()
        except Exception as exc:
            logger.warning("playwright google search failed: %s", exc)
            return await _search_google_optional_lib(query, self.max_urls_per_query)

        return urls

    async def _scrape_url(self, page: Any, url: str) -> Optional[str]:
        try:
            assert_safe_public_url(url)
            await page.goto(url, timeout=self.page_timeout_ms, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            await page.wait_for_timeout(600)
            html = await page.content()
            text = extract_main_text(html, self.max_text_chars)
            return text if len(text) >= 80 else None
        except Exception as exc:
            logger.warning("scrape skipped url=%s: %s", url[:120], exc)
            return None

    async def run(self) -> List[Dict[str, str]]:
        """
        Pipeline completa: genera query → cerca → scrape.
        Non solleva eccezioni fatali — ritorna lista (anche vuota).
        """
        results: List[Dict[str, str]] = []
        seen_urls = self.seen_urls

        try:
            queries = await self.generate_search_queries()
        except ResearchBudgetExceeded:
            raise
        except Exception as exc:
            logger.warning("generate_search_queries failed: %s", exc)
            queries = _heuristic_search_queries(self.plan)

        if not queries:
            logger.info("no search queries generated")
            return results

        url_jobs = await self._discover_url_jobs(queries)

        if not url_jobs:
            logger.info("no URLs discovered from search")
            return results
        self.pages_scheduled = len(url_jobs)

        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright missing — cannot scrape pages")
            return [
                {"url": u, "raw_text": "", "query_source": q, **metadata}
                for u, q, metadata in url_jobs[:15]
            ]

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                    ],
                )
                context = await browser.new_context(user_agent=USER_AGENT, locale="it-IT")
                page = await context.new_page()
                await install_playwright_ssrf_guard(page)

                for url, query_source, query_metadata in url_jobs:
                    text = await self._scrape_url(page, url)
                    if text:
                        results.append(
                            {
                                "url": url,
                                "raw_text": text,
                                "query_source": query_source,
                                **query_metadata,
                            }
                        )
                await browser.close()
        except Exception as exc:
            logger.warning("playwright scrape batch failed: %s", exc)

        return results

    async def iter_scraped_pages(self):
        """
        Async generator: genera query → cerca URL → scrape una pagina alla volta.
        Usato dal gap-fill streaming (publish incrementale).
        """
        seen_urls = self.seen_urls

        try:
            queries = await self.generate_search_queries()
        except ResearchBudgetExceeded:
            self.cost_failure = True
            logger.error("cost governor stopped query generation")
            return
        except Exception as exc:
            logger.warning("generate_search_queries failed: %s", exc)
            queries = _heuristic_search_queries(self.plan)

        if not queries:
            logger.info("no search queries generated")
            return

        try:
            url_jobs = await self._discover_url_jobs(queries)
        except ResearchBudgetExceeded:
            self.cost_failure = True
            logger.error("cost governor stopped web search")
            return

        if not url_jobs:
            logger.info("no URLs discovered from search")
            return
        self.pages_scheduled = len(url_jobs)

        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.warning("playwright missing — cannot scrape pages")
            for u, q, metadata in url_jobs[:15]:
                yield {"url": u, "raw_text": "", "query_source": q, **metadata}
            return

        try:
            playwright = await async_playwright().start()
            browser = await playwright.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                ],
            )
            context = await browser.new_context(user_agent=USER_AGENT, locale="it-IT")
            sem = asyncio.Semaphore(self.scrape_workers)
            tasks: List[asyncio.Task[Optional[Dict[str, str]]]] = []

            async def _scrape_job(
                url: str,
                query_source: str,
                query_metadata: Dict[str, Any],
            ) -> Optional[Dict[str, Any]]:
                async with sem:
                    page = await context.new_page()
                    try:
                        await install_playwright_ssrf_guard(page)
                        text = await self._scrape_url(page, url)
                        if not text:
                            return None
                        return {
                            "url": url,
                            "raw_text": text,
                            "query_source": query_source,
                            "observed_at": datetime.now(timezone.utc).isoformat(),
                            **query_metadata,
                        }
                    finally:
                        await page.close()

            tasks = [
                asyncio.create_task(_scrape_job(url, source, metadata))
                for url, source, metadata in url_jobs
            ]
            try:
                for task in asyncio.as_completed(tasks):
                    item = await task
                    if item:
                        yield item
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                if tasks:
                    try:
                        await asyncio.wait_for(
                            asyncio.gather(*tasks, return_exceptions=True),
                            timeout=5.0,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "playwright scrape stream cleanup timed out; continuing after target reached"
                        )
                try:
                    await asyncio.wait_for(context.close(), timeout=5.0)
                except Exception as exc:
                    logger.warning("playwright context close failed: %s", exc)
                try:
                    await asyncio.wait_for(browser.close(), timeout=5.0)
                except Exception as exc:
                    logger.warning("playwright browser close failed: %s", exc)
                try:
                    await asyncio.wait_for(playwright.stop(), timeout=5.0)
                except Exception as exc:
                    logger.warning("playwright stop failed: %s", exc)
        except Exception as exc:
            logger.warning("playwright scrape stream failed: %s", exc)


async def _search_google_optional_lib(query: str, limit: int) -> List[str]:
    """Fallback opzionale googlesearch-python se installato."""
    try:
        from googlesearch import search as gsearch  # type: ignore
    except ImportError:
        return []

    urls: List[str] = []
    try:
        for url in gsearch(query, num_results=limit, lang="it"):
            if not url or _should_skip_url(url):
                continue
            urls.append(url)
            if len(urls) >= limit:
                break
    except Exception as exc:
        logger.warning("googlesearch-python failed: %s", exc)
    return urls


async def _llm_search_queries(
    plan: Dict[str, Any],
    max_queries: int,
    cost_governor: Optional[ResearchCostGovernor] = None,
) -> List[str]:
    raw = await _call_anthropic_search_queries(plan, max_queries, cost_governor)
    if raw:
        return raw
    # OpenAI query generation is retired from the production discovery path.
    # If Anthropic is unavailable, callers use deterministic source-plan and
    # signal templates instead of switching to another paid provider.
    return []


def _llm_prompt(plan: Dict[str, Any], max_queries: int) -> str:
    payload = {
        "original_query": plan.get("original_query"),
        "sector": plan.get("sector"),
        "location": plan.get("location"),
        "required_signals": plan.get("required_signals"),
        "technical_filters": plan.get("technical_filters"),
        "extraction_schema": plan.get("extraction_schema"),
        "intent_summary": plan.get("intent_summary"),
        "discovery_round": plan.get("_discovery_round", 1),
        "research_questions": plan.get("research_questions"),
        "source_plan": plan.get("source_plan"),
        "evidence_policy": plan.get("evidence_policy"),
        "commercial_hypothesis": plan.get("commercial_hypothesis"),
        "ranking_policy": plan.get("ranking_policy"),
    }
    source_queries = _source_plan_queries(plan)
    return f"""Genera esattamente {max_queries} query Boolean diverse per trovare organizzazioni con segnali di bisogno.

Questo e il discovery round {plan.get('_discovery_round', 1)}: amplia fonti, sinonimi e formulazioni; non limitarti alle template del primo round.

Query suggerite dal source plan (migliorale e diversificale):
{json.dumps(source_queries, ensure_ascii=False)}

Usa le template per required_signals:
- hiring → OBBLIGATORIO: site:indeed.it OR site:infojobs.it "[ruolo]" Italia
- funding/expansion → site:startupitalia.eu OR site:italian.tech "round di finanziamento" [settore]
- tender_won → site:anac.gov.it OR "aggiudicazione appalto" [città]
- new_company → "nuova apertura" OR "costituzione società" [settore]
- tech_migration → "digital transformation" [settore]

Ogni query DEVE terminare con: -site:github.com -site:medium.com

MiraxQueryPlan:
{json.dumps(payload, ensure_ascii=False, indent=2)}"""


def _parse_queries_json(text: str) -> List[str]:
    text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if isinstance(data, dict) and isinstance(data.get("queries"), list):
        return [str(q).strip() for q in data["queries"] if str(q).strip()]
    if isinstance(data, list):
        return [str(q).strip() for q in data if str(q).strip()]
    return []


async def _call_openai_search_queries(plan: Dict[str, Any], max_queries: int) -> List[str]:
    if os.getenv("UQE_OPENAI_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return []
    api_key = ""
    if not api_key:
        return []
    model = "" or ""
    if not model:
        return []
    tool_schema = {
        "type": "function",
        "function": {
            "name": "submit_search_queries",
            "description": "Invia query B2B mirate su fonti osservabili, coerenti col target richiesto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": min(5, max_queries),
                        "maxItems": max_queries,
                    }
                },
                "required": ["queries"],
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=28.0) as client:
            res = await client.post(
                'data:,mirax-legacy-provider-removed',
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": max(600, min(1400, max_queries * 120)),
                    "messages": [
                        {"role": "system", "content": B2B_SYSTEM_PROMPT},
                        {"role": "user", "content": _llm_prompt(plan, max_queries)},
                    ],
                    "tools": [tool_schema],
                    "tool_choice": {"type": "function", "function": {"name": "submit_search_queries"}},
                },
            )
        if res.status_code != 200:
            logger.warning("OpenAI search queries HTTP %s", res.status_code)
            return []
        data = res.json()
        tool_calls = (data.get("choices") or [{}])[0].get("message", {}).get("tool_calls") or []
        for tc in tool_calls:
            fn = tc.get("function") or {}
            if fn.get("name") != "submit_search_queries":
                continue
            args = json.loads(fn.get("arguments") or "{}")
            return _finalize_search_queries(_parse_queries_json(json.dumps(args)), max_queries=max_queries)
    except Exception as exc:
        logger.warning("OpenAI search queries failed: %s", exc)
    return []


async def _call_anthropic_search_queries(
    plan: Dict[str, Any],
    max_queries: int,
    cost_governor: Optional[ResearchCostGovernor] = None,
) -> List[str]:
    if os.getenv("UQE_ANTHROPIC_ENABLED", "1").strip().lower() in {"0", "false", "no", "off", "disabled"}:
        return []
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return []
    model = (
        os.getenv("UQE_ANTHROPIC_MODEL")
        or os.getenv("ANTHROPIC_MODEL")
        or os.getenv("SEMANTIC_MODEL")
        or "claude-sonnet-5"
    ).replace("\\r", "").replace("\\n", "").strip()
    if cost_governor is None:
        raise ResearchBudgetExceeded("Anthropic query generation requires an atomic cost governor")
    prompt = _llm_prompt(plan, max_queries)
    digest = hashlib.sha256(
        f"{plan.get('_discovery_round', 1)}:{prompt}".encode("utf-8", "ignore")
    ).hexdigest()[:32]
    reservation_key = f"llm-query-plan:{digest}"
    estimated_eur = max(0.0, float(os.getenv("MIRAX_QUERY_LLM_RESERVED_EUR", "0.02") or "0.02"))
    reservation = cost_governor.reserve(
        reservation_key,
        "llm_query_generation",
        estimated_eur,
        provider="anthropic",
        model=model,
        source_class="query_plan",
        units=1,
        metadata={"discovery_round": int(plan.get("_discovery_round") or 1)},
    )
    if reservation.status != "reserved":
        logger.info("LLM query-plan idempotency hit status=%s; using deterministic queries", reservation.status)
        return []
    tool = {
        "name": "submit_search_queries",
        "description": "Invia query B2B mirate su fonti osservabili, coerenti col target richiesto.",
        "input_schema": {
            "type": "object",
            "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": min(5, max_queries),
                        "maxItems": max_queries,
                    }
            },
            "required": ["queries"],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=28.0) as client:
            res = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": max(600, min(1400, max_queries * 120)),
                    "system": B2B_SYSTEM_PROMPT,
                    "tools": [tool],
                    "tool_choice": {"type": "tool", "name": "submit_search_queries"},
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        if res.status_code != 200:
            logger.warning("Anthropic search queries HTTP %s", res.status_code)
            cost_governor.settle(
                reservation_key,
                estimated_eur,
                metadata={"outcome": "http_error", "http_status": res.status_code},
            )
            return []
        data = res.json()
        usage = data.get("usage") or {}
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        input_rate = max(0.0, float(os.getenv("MIRAX_LLM_INPUT_EUR_PER_M", "3") or "3"))
        output_rate = max(0.0, float(os.getenv("MIRAX_LLM_OUTPUT_EUR_PER_M", "15") or "15"))
        actual_eur = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
        cost_governor.settle(
            reservation_key,
            actual_eur if (input_tokens or output_tokens) else estimated_eur,
            metadata={
                "outcome": "success",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            },
        )
        for block in data.get("content") or []:
            if block.get("type") == "tool_use" and block.get("name") == "submit_search_queries":
                inp = block.get("input") or {}
                return _finalize_search_queries(_parse_queries_json(json.dumps(inp)), max_queries=max_queries)
    except ResearchBudgetExceeded:
        raise
    except Exception as exc:
        logger.warning("Anthropic search queries failed: %s", exc)
        # Once the request has been attempted, transport failure is ambiguous.
        # Conservatively settle the reservation and stop guessing at zero cost.
        cost_governor.settle(
            reservation_key,
            estimated_eur,
            metadata={"outcome": "provider_delivery_uncertain", "error_type": type(exc).__name__},
        )
    return []


def run_web_research(plan: Dict[str, Any], **kwargs: Any) -> List[Dict[str, str]]:
    """Entrypoint sync per script/worker."""
    return asyncio.run(WebResearcher(plan, **kwargs).run())


if __name__ == "__main__":
    sample_plan = {
        "original_query": "aziende lombarde bioplastica fondi UE",
        "search_strategy": "hybrid",
        "sector": "bioplastica",
        "location": "Lombardia",
        "required_signals": ["sector_investment", "hiring"],
        "technical_filters": {},
        "extraction_schema": ["email", "fatturato"],
        "confidence": 0.8,
        "intent_summary": "Produttori bioplastica in Lombardia con fondi UE",
    }
    assert extract_main_text("<html><body><main><p>Test azienda bioplastica</p></main></body></html>")[:20]
    hq = _heuristic_search_queries(sample_plan)
    assert len(hq) >= 2
    assert all("-site:github.com" in q and "-site:medium.com" in q for q in hq)
    hardened = _harden_search_query('site:indeed.it OR site:infojobs.it "sviluppatore" Italia')
    assert "-site:github.com" in hardened
    print("web_researcher self-check OK", f"heuristic_queries={len(hq)}")
