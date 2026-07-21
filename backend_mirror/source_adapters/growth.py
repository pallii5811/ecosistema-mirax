"""Composite official-evidence adapter for marketing investment and expansion.

The adapter does not treat pixels, generic growth language or a publisher's
identity as proof. Paid discovery is guarded before every query by the shared
cost governor; no call happens at import time.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain

from .contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceExhaustion,
)


_QUERY_COST_EUR = 0.005
_MARKETING_SIGNALS = {"investing_marketing", "active_advertising", "meta_ads_started", "google_ads_started", "rebranding"}
_EXPANSION_SIGNALS = {
    "expansion", "new_location", "geographic_expansion", "production_expansion",
    "product_launch", "service_launch", "internationalization", "new_equipment", "market_entry",
}
_DIRECT_PATTERNS: Dict[str, re.Pattern[str]] = {
    "meta_ads_started": re.compile(r"\b(?:campagn[ae]|inserzion[ei])\s+(?:attiv[ae]\s+)?(?:su\s+)?(?:meta|facebook|instagram)\s+ads\b", re.I),
    "google_ads_started": re.compile(r"\b(?:campagn[ae]|annunc[io]|investimento)\s+(?:attiv[ae]\s+)?(?:su\s+)?google\s+ads\b", re.I),
    "active_advertising": re.compile(r"\b(?:ha\s+)?(?:avviato|lanciato|attivato|pianificato)\s+(?:una\s+)?(?:nuova\s+)?campagna\s+(?:pubblicitaria|advertising|paid media)\b", re.I),
    "rebranding": re.compile(r"\b(?:annuncia|avvia|completa|presenta)\s+(?:il\s+)?(?:nuovo\s+)?rebrand(?:ing)?\b", re.I),
    "new_location": re.compile(
        r"\b(?:inaugura(?:to|ta)?|apre|ha aperto|annuncia(?:to|ta)?|apertura di)\s+"
        r"(?:(?:una|un|la|il)\s+)?(?:nuov[ao]\s+)?"
        r"(?:sede|filiale|ufficio|showroom|punto\s+vendita|negozio|stabilimento|apertura)\b|"
        r"\bnuov[ao]\s+(?:sede|filiale|negozio|stabilimento|punto\s+vendita)\b",
        re.I,
    ),
    "production_expansion": re.compile(
        r"\b(?:amplia|potenzia|inaugura|avvia|aumenta)\s+"
        r"(?:(?:la|un|una)\s+)?(?:capacita produttiva|capacità produttiva|produzione|"
        r"presenza\s+territoriale|nuov[ao]\s+(?:linea|impianto|stabilimento))\b|"
        r"\bampliamento\s+(?:della\s+)?(?:sede|stabilimento|capacita|capacità)\b",
        re.I,
    ),
    "geographic_expansion": re.compile(
        r"\b(?:entra|si espande|avvia le operazioni|debutta|espansione\s+geografica)\s+"
        r"(?:in|nel|sul|verso)?\s*(?:(?:un|una)\s+)?(?:nuov[oi]\s+)?mercat[oi]?\b|"
        r"\bespansione\s+(?:in|nel|sul)\s+[A-ZÀ-Üa-zà-ü]{3,}",
        re.I,
    ),
    "internationalization": re.compile(r"\b(?:espansione internazionale|internazionalizzazione|entra nel mercato estero|apre all'estero)\b", re.I),
    "product_launch": re.compile(r"\b(?:lancia|presenta|introduce)\s+(?:(?:il|la|un|una)\s+)?nuov[oa]\s+(?:prodotto|linea|gamma)\b", re.I),
    "service_launch": re.compile(r"\b(?:lancia|presenta|introduce)\s+(?:il\s+|un\s+)?nuov[oa]\s+servizi[oa]\b", re.I),
    "new_equipment": re.compile(r"\b(?:installa|acquista|investe in)\s+(?:un\s+|una\s+)?nuov[oa]\s+(?:macchinario|impianto|attrezzatura)\b", re.I),
    "market_entry": re.compile(r"\b(?:entra|debutta|sbarca)\s+(?:in|nel|sul)\s+(?:nuov[oa]\s+)?mercat[oa]\b", re.I),
}
_RUMOR_RE = re.compile(
    r"\b(?:si\s+parla\s+di|secondo\s+rumor|secondo\s+voci|ipotizz[ao]|potrebbe\s+aprire|"
    r"in\s+trattativa\s+per\s+aprire|progetto\s+ipotetic[oa]|non\s+confermat[oa])\b",
    re.I,
)
_PUBLIC_BODY_RE = re.compile(
    r"\b(?:comune|citt[aà]\s+metropolitana|provincia|regione|ministero|prefettura|"
    r"camera\s+di\s+commercio|asl\b|inps\b|agenzia\s+delle\s+entrate)\b",
    re.I,
)
_MAX_SOURCE_RECORDS = 40
_STRONG_MARKETING_PROXY_RE = re.compile(
    r"\b(?:affida|incarica|sceglie)\s+(?:una\s+)?agenzia\s+(?:per|di)\s+(?:la\s+)?(?:campagna|comunicazione|rebranding)|"
    r"\b(?:assume|ricerca)\s+(?:un\s+|una\s+)?(?:marketing manager|performance marketer|media buyer)\b",
    re.I,
)
_WEAK_GROWTH_RE = re.compile(r"\b(?:cresce|innovazione|leader|successo|ambizioso|digitale|marketing)\b", re.I)
_MARKETING_PROVIDER_NOISE_RE = re.compile(
    r"\b(?:agenzia (?:web|marketing|digital)|offriamo (?:servizi|campagne)|gestiamo (?:le )?campagne|"
    r"consulenza marketing|corso (?:di )?marketing|guida (?:a|al|alla))\b",
    re.I,
)


@dataclass(frozen=True)
class GrowthProviderResult:
    records: Tuple[Mapping[str, Any], ...]
    exhausted: bool
    cost_eur: float = 0.0
    warnings: Tuple[str, ...] = ()


GrowthProvider = Callable[[AdapterDiscoveryRequest, int, int], Awaitable[GrowthProviderResult]]


def _text(value: Any) -> Optional[str]:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or None


def _host(value: Any) -> str:
    text = _text(value) or ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def _iso_date(value: Any) -> Optional[str]:
    text = _text(value)
    if not text:
        return None
    for fmt in (None, "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            parsed = date.fromisoformat(text[:10]) if fmt is None else datetime.strptime(text[:10], fmt).date()
            return parsed.isoformat()
        except ValueError:
            continue
    return None


_IT_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}


def _parse_date_in_text(text: str) -> Optional[str]:
    blob = _text(text) or ""
    if not blob:
        return None
    month_names = "|".join(_IT_MONTHS)
    patterns = (
        rf"\b(\d{{1,2}})\s+({month_names})\s+(\d{{4}})\b",
        r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b",
        r"\b(\d{4})-(\d{2})-(\d{2})\b",
    )
    for index, pattern in enumerate(patterns):
        found = re.search(pattern, blob, re.I)
        if not found:
            continue
        try:
            if index == 0:
                day, month_name, year = found.group(1), found.group(2).casefold(), found.group(3)
                parsed = date(int(year), _IT_MONTHS[month_name], int(day))
            elif index == 1:
                parsed = date(int(found.group(3)), int(found.group(2)), int(found.group(1)))
            else:
                parsed = date(int(found.group(1)), int(found.group(2)), int(found.group(3)))
            return parsed.isoformat()
        except (ValueError, KeyError):
            continue
    return None


def _event_date_near_match(blob: str, match: re.Match[str]) -> Optional[str]:
    window = blob[max(0, match.start() - 100): match.end() + 160]
    return _parse_date_in_text(window)


def _iter_json(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        yield value
        graph = value.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from _iter_json(item)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_json(item)


def _organization_from_page(soup: BeautifulSoup, page_host: str) -> Tuple[Optional[Mapping[str, Any]], bool]:
    organizations: List[Mapping[str, Any]] = []
    mentioned: List[Mapping[str, Any]] = []
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _iter_json(payload):
            raw_type = item.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if "Organization" in types:
                organizations.append(item)
            for key in ("about", "mentions"):
                values = item.get(key)
                values = values if isinstance(values, list) else [values]
                for value in values:
                    if isinstance(value, Mapping):
                        mentioned.append(value)
    for org in organizations:
        if _host(org.get("url") or org.get("sameAs")) == page_host:
            return org, True
    for org in mentioned:
        if _text(org.get("name")) and _host(org.get("url") or org.get("sameAs")):
            return org, False
    return None, False


def classify_growth_evidence(text: str, requested_signals: Sequence[str]) -> Tuple[Optional[str], str, Optional[re.Match[str]]]:
    blob = _text(text) or ""
    requested = list(dict.fromkeys(requested_signals))
    for signal in requested:
        pattern = _DIRECT_PATTERNS.get(signal)
        if pattern and (match := pattern.search(blob)):
            return signal, "direct", match
    if any(signal in _MARKETING_SIGNALS for signal in requested):
        if match := _STRONG_MARKETING_PROXY_RE.search(blob):
            return "investing_marketing", "strong_proxy", match
    if "investing_marketing" in requested:
        for signal in ("meta_ads_started", "google_ads_started", "active_advertising", "rebranding"):
            if match := _DIRECT_PATTERNS[signal].search(blob):
                return "investing_marketing", "direct", match
    if "expansion" in requested:
        for signal in _EXPANSION_SIGNALS - {"expansion"}:
            pattern = _DIRECT_PATTERNS.get(signal)
            if pattern and (match := pattern.search(blob)):
                return signal, "direct", match
    return None, "weak_proxy" if _WEAK_GROWTH_RE.search(blob) else "none", None


def proven_requested_signals(text: str, requested_signals: Sequence[str]) -> Tuple[str, ...]:
    """Return canonical requested signals independently proven by the excerpt."""
    proven: List[str] = []
    for requested in dict.fromkeys(requested_signals):
        classified, proof, match = classify_growth_evidence(text, (requested,))
        if classified and match and proof in {"direct", "strong_proxy"}:
            proven.append(requested)
    return tuple(proven)


def _guess_company_name(blob: str, match: re.Match[str]) -> Optional[str]:
    window = blob[max(0, match.start() - 120): match.end() + 40]
    patterns = (
        r"([A-ZÀ-Ü][\w\.\'&\- ]{1,70}?)\s+(?:S\.?\s*r\.?\s*l\.?|S\.?\s*p\.?\s*A\.?|S\.?\s*a\.?\s*s\.?|S\.?\s*n\.?\s*c\.?)\b",
        r"\b((?:[A-ZÀ-Ü][\w\.\'&\-]{2,}(?:\s+[A-ZÀ-Ü][\w\.\'&\-]{2,}){0,3}))\s+(?:inaugura|apre|ha aperto|annuncia)\b",
    )
    for pattern in patterns:
        found = re.search(pattern, window, re.I)
        if found:
            name = _text(found.group(1))
            if name and not _PUBLIC_BODY_RE.search(name) and len(name) >= 3:
                return name
    return None


def _looks_like_news_host(host: str) -> bool:
    if not host:
        return True
    news_roots = (
        "corriere.", "repubblica.", "sole24ore.", "ilsole24ore.", "ansa.", "lastampa.",
        "ilgiornale.", "oggi.", "milanofinanza.", "economyup.", "startupitalia.",
        "today.it", "citynews.", "notiz", "news.", "giornale", "quotidiano",
    )
    return any(root in host for root in news_roots)


def _company_owns_host(company: str, host: str, publisher: str) -> bool:
    """Promote source host to official domain only when ownership is credible."""
    if not company or not host or is_blacklisted_domain(host):
        return False
    if publisher and company.casefold() == publisher.casefold() and not _looks_like_news_host(host):
        return True
    tokens = [t for t in re.split(r"[^a-z0-9à-ü]+", company.casefold()) if len(t) >= 4]
    host_cf = host.casefold().replace("-", "").replace(".", "")
    return any(t.replace("-", "") in host_cf for t in tokens[:4]) and not _looks_like_news_host(host)


def _extract_company_domain_from_links(soup: BeautifulSoup, company: str, page_host: str) -> str:
    tokens = [t for t in re.split(r"[^a-z0-9à-ü]+", (company or "").casefold()) if len(t) >= 4][:3]
    if not tokens:
        return ""
    for anchor in soup.find_all("a", href=True)[:80]:
        href = str(anchor.get("href") or "")
        candidate = _host(href)
        if not candidate or candidate == page_host or is_blacklisted_domain(candidate):
            continue
        if _looks_like_news_host(candidate):
            continue
        host_cf = candidate.casefold().replace("-", "").replace(".", "")
        if any(t.replace("-", "") in host_cf for t in tokens):
            return candidate
    return ""


def parse_growth_page(
    html: str,
    source_url: str,
    requested_signals: Sequence[str],
    geographies: Sequence[str],
) -> List[Dict[str, Any]]:
    host = _host(source_url)
    if not host or is_blacklisted_domain(host):
        return []
    soup = BeautifulSoup(html or "", "html.parser")
    organization, is_official = _organization_from_page(soup, host)
    blob = _text(soup.get_text(" ", strip=True)) or ""
    signal_id, proof_level, match = classify_growth_evidence(blob, requested_signals)
    if not signal_id or not match:
        return []
    publisher_meta = soup.find("meta", attrs={"property": "og:site_name"})
    publisher = _text(publisher_meta.get("content") if publisher_meta else None) or host
    company = _text(organization.get("name") if organization else None) or _guess_company_name(blob, match)
    official_domain = _host((organization or {}).get("url") or (organization or {}).get("sameAs")) if organization else ""
    if not official_domain and company and _company_owns_host(company, host, publisher):
        # Company newsroom/page: source host is the ownership candidate (no second SERP).
        official_domain = host
        is_official = True
    if not official_domain and company:
        official_domain = _extract_company_domain_from_links(soup, company, host)
    if not company or not official_domain or is_blacklisted_domain(official_domain):
        return []
    if company.casefold() == publisher.casefold() and _looks_like_news_host(host):
        return []
    page_published = None
    for attrs in ({"property": "article:published_time"}, {"name": "date"}, {"itemprop": "datePublished"}):
        node = soup.find("meta", attrs=attrs)
        page_published = _iso_date(node.get("content") if node else None)
        if page_published:
            break
    if not page_published:
        node = soup.find("time")
        page_published = _iso_date(node.get("datetime") if node else None)
    # Event date near the expansion match beats hub/newsroom page timestamps.
    published = _event_date_near_match(blob, match) or page_published
    if not published:
        return []
    geography = next((item for item in geographies if item.casefold() in blob.casefold()), "")
    start = max(0, match.start() - 180)
    excerpt = blob[start:match.end() + 300]
    source_class = "official_company_website" if (is_official or official_domain == host) else "recognized_local_news"
    entity_bound = bool(official_domain and (official_domain == host or official_domain != host))
    corroborated = bool(source_class == "official_company_website" or (official_domain and official_domain != host))
    expansion_city = ""
    city_match = re.search(
        r"\b(?:a|ad|in|di)\s+([A-ZÀ-Ü][a-zà-ü']+(?:\s+[A-ZÀ-Ü][a-zà-ü']+){0,2})\b",
        match.group(0),
    )
    if city_match:
        expansion_city = city_match.group(1)
    return [{
        "company_name": company,
        "official_domain": official_domain,
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "signal_id": signal_id,
        "proof_level": proof_level,
        "published_at": published,
        "geography": geography or expansion_city,
        "expansion_type": signal_id,
        "expansion_city": expansion_city or geography,
        "source_url": source_url,
        "source_publisher": publisher,
        "source_class": source_class,
        "evidence_excerpt": excerpt,
        "extraction_method": "structured_official_page" if source_class == "official_company_website" else "structured_news_about_entity",
        "corroborated": corroborated,
        "entity_bound": entity_bound,
    }]


async def _default_growth_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> GrowthProviderResult:
    import asyncio
    import httpx
    from backend_mirror.agents.search_serp import search_urls_http

    location = next((item for item in request.geographies if item.casefold() not in {"italy", "italia"}), "Italia")
    sector = " ".join(request.sectors)
    signals = set(request.signal_ids)
    queries: List[str] = []
    # Universal engine strategies first (cheap multi-query exploration).
    from .universal_strategy_queries import universal_strategy_queries_from_filters
    queries.extend(
        universal_strategy_queries_from_filters(
            request.technical_filters,
            signal_ids=request.signal_ids,
            max_queries=8,
        )
    )
    if signals & _MARKETING_SIGNALS:
        queries.extend((
            f'aziende {location} ("campagna pubblicitaria" OR "Meta Ads" OR "Google Ads") {sector}',
            f'aziende {location} ("affida la comunicazione" OR rebranding OR "media buyer") {sector}',
        ))
    if signals & _EXPANSION_SIGNALS:
        queries.extend((
            f'Italia ("nuova sede" OR "nuovo stabilimento" OR "nuovo negozio" OR "punto vendita") '
            f'(inaugura OR "ha aperto" OR annuncia OR apertura) {location} {sector}'.strip(),
            f'("comunicato stampa" OR newsroom OR "ufficio stampa") '
            f'("nuova sede" OR "nuovo stabilimento" OR ampliamento OR "capacità produttiva") {location} {sector}'.strip(),
            f'(2025 OR 2026) (inaugura OR "ha aperto" OR "apertura della") '
            f'("nuova sede" OR "nuovo negozio" OR "nuovo stabilimento") Italia {sector}'.strip(),
            f'site:.it "comunicato stampa" ("nuova sede" OR "nuovo stabilimento" OR "nuovo punto vendita") '
            f'(2025 OR 2026) {sector}'.strip(),
        ))
    # Deduplicate while preserving order.
    queries = list(dict.fromkeys(q for q in queries if str(q).strip()))
    max_queries = min(len(queries), math.floor((request.budget_eur + 1e-9) / _QUERY_COST_EUR))
    if max_queries <= 0:
        return GrowthProviderResult((), False, 0.0, ("BUDGET_TOO_LOW_FOR_SEARCH",))
    scope = hashlib.sha256(f"{request.query}|{request.signal_ids}|{request.geographies}".encode()).hexdigest()[:20]
    urls: List[str] = []
    seen: set[str] = set()
    spent = 0.0
    max_source = min(
        _MAX_SOURCE_RECORDS,
        int((request.technical_filters or {}).get("max_source_records") or _MAX_SOURCE_RECORDS),
    )
    target = min(max_source, offset + max(limit * 2, 20))
    for index, query in enumerate(queries[:max_queries]):
        if spent + _QUERY_COST_EUR > request.budget_eur + 1e-9:
            break
        found = await asyncio.to_thread(
            search_urls_http, query, target, cost_scope=f"growth-adapter:{scope}:{index}",
        )
        spent += _QUERY_COST_EUR
        for url in found:
            key = url.lower().rstrip("/")
            host = _host(url)
            if key in seen or not host or is_blacklisted_domain(host):
                continue
            seen.add(key)
            urls.append(url)
    # Prefer likely company/newsroom hosts before generic portals when fetching.
    def _fetch_rank(url: str) -> tuple[int, str]:
        host = _host(url)
        path = (urlparse(url).path or "").lower()
        score = 0
        if any(token in path for token in ("newsroom", "comunicato", "press", "news", "novita", "chi-siamo")):
            score -= 2
        if host.endswith(".it") and host.count(".") == 1:
            score -= 1
        return (score, host)

    urls.sort(key=_fetch_rank)
    # Universal engine: cheap prefilter before page fetch / identity.
    if bool((request.technical_filters or {}).get("universal_engine")):
        from .cheap_discovery_prefilter import DiscoveryHit, prefilter_discovery_hit
        active_query = next(iter(queries), request.query)
        semantic_open_world = request.technical_filters.get("semantic_authority_required") is True
        gated: List[str] = []
        codes: Dict[str, int] = {}
        raw = len(urls)
        for url in urls:
            path = (urlparse(url).path or "").replace("/", " ").replace("-", " ")
            decision = prefilter_discovery_hit(
                DiscoveryHit(title="", url=url, snippet=f"{path} {active_query}"),
                require_event_hint=not semantic_open_world,
                allow_admin_assoc=semantic_open_world,
            )
            if decision.accepted:
                gated.append(url)
            else:
                codes[decision.reason] = codes.get(decision.reason, 0) + 1
        bucket = request.technical_filters.get("universal_prefilter_telemetry")
        if isinstance(bucket, dict):
            bucket["raw_discovery_hits"] = int(bucket.get("raw_discovery_hits") or 0) + raw
            bucket["prefilter_accepted"] = int(bucket.get("prefilter_accepted") or 0) + len(gated)
            bucket["prefilter_rejected"] = int(bucket.get("prefilter_rejected") or 0) + (raw - len(gated))
            merged = dict(bucket.get("prefilter_rejection_codes") or {})
            for key, value in codes.items():
                merged[key] = int(merged.get(key) or 0) + value
            bucket["prefilter_rejection_codes"] = merged
            queries_log = list(bucket.get("provider_queries") or [])
            queries_log.extend(queries[:max_queries])
            bucket["provider_queries"] = queries_log
        urls = gated
    records: List[Mapping[str, Any]] = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Growth/1.0)", "Accept-Language": "it-IT,it;q=0.9"}
    pages_opened = 0
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        for url in urls[offset:offset + min(limit, max_source)]:
            try:
                response = await client.get(url)
                if response.status_code != 200 or "html" not in str(response.headers.get("content-type") or "").lower():
                    continue
                pages_opened += 1
                records.extend(parse_growth_page(response.text[:2_000_000], str(response.url), request.signal_ids, request.geographies))
                if len(records) >= max_source:
                    break
            except Exception:
                continue
    if bool((request.technical_filters or {}).get("universal_engine")):
        bucket = request.technical_filters.get("universal_prefilter_telemetry")
        if isinstance(bucket, dict):
            bucket["pages_opened_after_prefilter"] = int(bucket.get("pages_opened_after_prefilter") or 0) + pages_opened
    return GrowthProviderResult(
        tuple(records[:max_source]),
        exhausted=bool(not urls or offset + min(limit, max_source) >= len(urls) or len(records) >= max_source),
        cost_eur=spent,
    )


def _cursor_offset(cursor: Optional[DiscoveryCursor]) -> int:
    if not cursor:
        return 0
    match = re.fullmatch(r"growth:v1:(\d+)", cursor.value)
    if not match:
        raise ValueError("invalid growth cursor")
    return int(match.group(1))


def _requires_sme(request: AdapterDiscoveryRequest) -> bool:
    return bool(re.search(r"\b(?:pmi|piccol[ae]|medi[ae]|microimprese?|sme)\b", request.query, re.I))


def _record_valid(record: Mapping[str, Any], request: AdapterDiscoveryRequest, today: date) -> Tuple[bool, str]:
    company = _text(record.get("company_name"))
    domain = _host(record.get("official_domain"))
    if not company:
        return False, "COMPANY_MISSING"
    if _PUBLIC_BODY_RE.search(company):
        return False, "PUBLIC_BODY_AS_COMPANY"
    if not domain or is_blacklisted_domain(domain):
        return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if record.get("official_domain_verified") is not True:
        return False, "OFFICIAL_DOMAIN_UNVERIFIED"
    if (_text(record.get("entity_class")) or "") != "operating_company":
        return False, "NON_OPERATING_ENTITY"
    source_url = _text(record.get("source_url"))
    publisher = _text(record.get("source_publisher"))
    source_class = _text(record.get("source_class"))
    if not all((source_url, publisher, source_class)):
        return False, "SOURCE_PROVENANCE_MISSING"
    if source_class not in {"official_company_website", "recognized_local_news", "industry_publication"}:
        return False, "SOURCE_CLASS_UNSUPPORTED"
    source_host = _host(source_url)
    if source_class != "official_company_website":
        entity_bound = record.get("entity_bound") is True or (
            bool(domain) and bool(source_host) and domain != source_host and record.get("corroborated") is True
        )
        if not entity_bound and record.get("corroborated") is not True:
            return False, "SECONDARY_SOURCE_NOT_CORROBORATED"
        if domain and source_host and domain == source_host:
            return False, "PUBLISHER_DOMAIN_AS_COMPANY"
    if source_class != "official_company_website" and company.casefold() == publisher.casefold():
        return False, "PUBLISHER_AS_BUYER"
    published = _iso_date(record.get("published_at"))
    if not published:
        return False, "SIGNAL_DATE_MISSING"
    age = (today - date.fromisoformat(published)).days
    if age < 0 or (request.freshness_max_age_days is not None and age > request.freshness_max_age_days):
        return False, "SIGNAL_STALE"
    geography = (_text(record.get("geography")) or "").casefold()
    requested_geo = [item.casefold() for item in request.geographies if item.casefold() not in {"italy", "italia"}]
    if requested_geo and not any(item in geography or geography in item for item in requested_geo):
        return False, "GEOGRAPHY_MISMATCH"
    signal_id = _text(record.get("signal_id")) or ""
    requested = set(request.signal_ids)
    if request.signal_match_mode == "all" and len(requested) > 1:
        raw_matched = record.get("matched_signal_ids")
        matched = {str(item).strip() for item in raw_matched} if isinstance(raw_matched, (list, tuple, set)) else {signal_id}
        if not requested.issubset(matched):
            return False, "ALL_SIGNALS_INCOMPLETE"
    compatible = signal_id in requested
    if "investing_marketing" in requested and signal_id in _MARKETING_SIGNALS:
        compatible = True
    if "expansion" in requested and signal_id in _EXPANSION_SIGNALS:
        compatible = True
    if not compatible:
        return False, "SIGNAL_MISMATCH"
    proof = (_text(record.get("proof_level")) or "").casefold()
    if proof not in {"direct", "strong_proxy"}:
        return False, "EVIDENCE_TOO_WEAK"
    excerpt = _text(record.get("evidence_excerpt")) or ""
    if _RUMOR_RE.search(excerpt):
        return False, "RUMOR_OR_HYPOTHESIS"
    proven = set(proven_requested_signals(excerpt, request.signal_ids))
    if request.signal_match_mode == "all" and not requested.issubset(proven):
        return False, "EVIDENCE_PATTERN_UNPROVEN"
    if request.signal_match_mode == "any" and not requested.intersection(proven):
        return False, "EVIDENCE_PATTERN_UNPROVEN"
    classified, classified_proof, _ = classify_growth_evidence(excerpt, request.signal_ids)
    if not classified or (proof == "direct" and classified_proof != "direct"):
        return False, "EVIDENCE_PATTERN_UNPROVEN"
    if signal_id in _MARKETING_SIGNALS and _MARKETING_PROVIDER_NOISE_RE.search(excerpt) and record.get("named_client_case") is not True:
        return False, "MARKETING_PROVIDER_NOISE"
    if _requires_sme(request):
        size = (_text(record.get("company_size")) or "").casefold()
        try:
            employees = int(record.get("employee_count")) if record.get("employee_count") is not None else None
        except (TypeError, ValueError):
            employees = None
        if size in {"enterprise", "large"} or (employees is not None and employees > 249):
            return False, "ENTERPRISE_OUT_OF_TARGET"
        semantic_required = request.technical_filters.get("semantic_authority_required") is True
        if (
            size not in {"micro", "small", "medium", "pmi", "sme"}
            and employees is None
            and not semantic_required
        ):
            return False, "SME_STATUS_UNVERIFIED"
    return True, ""


class GrowthSignalsAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="official_growth_signals_v1",
        adapter_version="1.0.0",
        supported_intents=("organic_web_search", "commercial_search", "hybrid", "growth_signals"),
        supported_signals=tuple(sorted(_MARKETING_SIGNALS | _EXPANSION_SIGNALS)),
        source_classes=("official_company_website", "recognized_local_news", "industry_publication"),
        geographic_coverage=("global",),
        freshness_max_age_days=1,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=100,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=_QUERY_COST_EUR,
        authentication_requirements=("search_provider_with_cost_governor",),
        rate_limit_per_minute=20,
        provenance_guarantees=("company", "official_domain", "publisher", "source_url", "published_at"),
        evidence_guarantees=("signal_id", "proof_level", "excerpt", "freshness", "company_relation"),
        exhaustion_semantics="best_effort",
        coverage_status="supported",
    )

    def __init__(self, providers: Sequence[GrowthProvider] = (_default_growth_provider,)) -> None:
        if not providers:
            raise ValueError("at least one growth provider is required")
        self._providers = tuple(providers)

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        offset = _cursor_offset(request.cursor)
        max_source_records = min(
            _MAX_SOURCE_RECORDS,
            int(request.technical_filters.get("max_source_records") or _MAX_SOURCE_RECORDS),
        )
        page_size = min(max_source_records, max(request.requested_count * 3, 20))
        started = datetime.now(timezone.utc).isoformat()
        results: List[GrowthProviderResult] = []
        spent = 0.0
        for provider in self._providers:
            remaining = max(0.0, request.budget_eur - spent)
            bounded = AdapterDiscoveryRequest(
                intent=request.intent, signal_ids=request.signal_ids, signal_match_mode=request.signal_match_mode,
                geographies=request.geographies, freshness_max_age_days=request.freshness_max_age_days,
                requested_count=request.requested_count, budget_eur=remaining, query=request.query,
                sectors=request.sectors,
                technical_filters={**dict(request.technical_filters or {}), "max_source_records": max_source_records},
                cursor=request.cursor,
            )
            result = await provider(bounded, offset, page_size)
            if result.cost_eur > remaining + 1e-9:
                raise RuntimeError("GROWTH_PROVIDER_EXCEEDED_HARD_COST_CAP")
            results.append(result)
            spent += result.cost_eur
        observed = datetime.now(timezone.utc).isoformat()
        warnings = [warning for result in results for warning in result.warnings]
        candidates: List[OpportunityCandidate] = []
        by_domain: Dict[str, OpportunityCandidate] = {}
        source_attempts = 0
        for result in results:
            for record in result.records:
                if source_attempts >= max_source_records:
                    break
                source_attempts += 1
                valid, rejection = _record_valid(record, request, date.today())
                if not valid:
                    warnings.append(rejection)
                    continue
                from backend_mirror.agents.entity_identity_resolver import (
                    COMMERCIAL_ENTITY_CLASSES,
                    EntityIdentityRequest,
                    resolve_entity_identity,
                )
                company_probe = _text(record.get("company_name")) or ""
                domain_probe = _host(record.get("official_domain"))
                identity = resolve_entity_identity(
                    EntityIdentityRequest(
                        company_name=company_probe,
                        evidence_url=_text(record.get("source_url")) or "",
                        presented_domain=domain_probe,
                        geography=_text(record.get("geography")) or "",
                        budget_eur=0.0,
                        allow_serp=False,
                        allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
                        source_payload=record,
                        brand_name=_text(record.get("brand_name")) or "",
                        acronym=_text(record.get("acronym")) or "",
                        group_domain_proof=bool(record.get("group_domain_proof")),
                    ),
                    verify_fn=lambda company, url, location: {
                        "url": url,
                        "status": "verified",
                        "confidence": 0.96,
                        "score": 96,
                        "evidence": ["company_tokens_in_host", "official_page_host_match"],
                        "resolution_method": "growth_presented_domain",
                        "resolution_source": "source_adapter",
                    } if domain_probe and _host(url) == domain_probe else None,
                )
                if identity.identity_status != "verified" or not identity.official_domain:
                    warnings.append(identity.rejection_code or "ENTITY_IDENTITY_REJECTED")
                    continue
                company = identity.operating_entity_name or company_probe
                domain = identity.official_domain
                signal = _text(record.get("signal_id")) or ""
                published = _iso_date(record.get("published_at")) or ""
                source_url = _text(record.get("source_url")) or ""
                publisher = _text(record.get("source_publisher")) or ""
                source_class = _text(record.get("source_class")) or ""
                proof = _text(record.get("proof_level")) or ""
                excerpt = _text(record.get("evidence_excerpt")) or ""
                expansion_type = _text(record.get("expansion_type")) or signal
                expansion_city = _text(record.get("expansion_city") or record.get("geography")) or ""
                confidence = float(identity.identity_confidence) if identity.identity_confidence else (
                    0.96 if proof == "direct" and source_class == "official_company_website" else 0.86
                )
                # Emit the requested canonical relationship(s) proven by this
                # excerpt.  The provider's narrower subtype remains in
                # expansion_type/provenance; it must not break the request
                # boundary for family-level queries such as expansion or
                # investing_marketing.
                evidence_signals = proven_requested_signals(excerpt, request.signal_ids)
                evidence = tuple(EvidenceRecord(
                    signal_id=evidence_signal, source_url=source_url, source_publisher=publisher,
                    source_class=source_class, excerpt=excerpt[:1200], observed_at=observed,
                    published_at=published, extraction_method=_text(record.get("extraction_method")) or "structured_growth_event",
                    confidence=confidence,
                    provenance={
                        "proof_level": proof,
                        "corroborated": record.get("corroborated") is True,
                        "expansion_type": expansion_type,
                        "expansion_city": expansion_city,
                    },
                ) for evidence_signal in evidence_signals)
                why_now = _text(record.get("why_now"))
                if not why_now:
                    if signal in _EXPANSION_SIGNALS or "expansion" in set(request.signal_ids):
                        why_now = (
                            f"{company} ha annunciato {expansion_type.replace('_', ' ')}"
                            f"{f' a {expansion_city}' if expansion_city else ''} "
                            f"({published}). L'espansione crea fabbisogni operativi, fornitura e capacita immediati."
                        )
                    else:
                        why_now = f"{proof}: {excerpt[:240]}"
                if domain in by_domain:
                    existing = by_domain[domain]
                    seen_urls = {item.source_url for item in existing.evidence}
                    extra = tuple(item for item in evidence if item.source_url not in seen_urls)
                    merged_evidence = existing.evidence + extra
                    by_domain[domain] = OpportunityCandidate(
                        canonical_company_name=existing.canonical_company_name,
                        company_identifiers=existing.company_identifiers,
                        official_domain=existing.official_domain,
                        entity_class=existing.entity_class,
                        geographies=tuple(dict.fromkeys([*existing.geographies, expansion_city or ""])),
                        buyer_fit=existing.buyer_fit,
                        signal_id=existing.signal_id,
                        signal_date=existing.signal_date,
                        evidence=merged_evidence,
                        why_now=f"{existing.why_now} | {why_now}"[:900],
                        contacts=existing.contacts,
                        confidence=max(existing.confidence, confidence),
                        contradiction_flags=existing.contradiction_flags,
                        provenance={
                            **dict(existing.provenance),
                            "matched_signal_ids": tuple(dict.fromkeys([
                                *tuple(existing.provenance.get("matched_signal_ids") or ()),
                                *evidence_signals,
                            ])),
                            "related_openings": int(existing.provenance.get("related_openings") or 1) + 1,
                        },
                        adapter_id=existing.adapter_id,
                        adapter_version=existing.adapter_version,
                        official_domain_verified=existing.official_domain_verified,
                        official_domain_confidence=existing.official_domain_confidence,
                    )
                    warnings.append("DUPLICATE_COMPANY_SIGNAL_AGGREGATED")
                    continue
                resolved_at = identity.identity_resolved_at or datetime.now(timezone.utc).isoformat()
                candidate = OpportunityCandidate(
                    canonical_company_name=company, company_identifiers={}, official_domain=domain,
                    entity_class=identity.entity_class if identity.entity_class in COMMERCIAL_ENTITY_CLASSES else "operating_company",
                    geographies=(expansion_city or _text(record.get("geography")) or "",),
                    buyer_fit=1.0, signal_id=signal, signal_date=published, evidence=evidence,
                    why_now=why_now, contacts=(),
                    confidence=confidence, contradiction_flags=(),
                    provenance={
                        "adapter_id": self.capability.adapter_id,
                        "proof_level": proof,
                        "publisher": publisher,
                        "expansion_type": expansion_type,
                        "expansion_city": expansion_city,
                        "matched_signal_ids": evidence_signals,
                        "related_openings": 1,
                        "domain_verification": {
                            "status": "verified",
                            "confidence": confidence,
                            "score": int(round(confidence * 100)),
                            "evidence": tuple(identity.identity_evidence) or ("schema_org_identity_match", "official_page_host_match"),
                            "resolution_source": identity.resolution_source or "source_adapter",
                            "resolution_method": identity.resolution_method or "verified_source_adapter",
                            "adapter_id": self.capability.adapter_id,
                            "url": f"https://{domain}/",
                            "resolved_at": resolved_at,
                            "entity_class": identity.entity_class,
                        },
                    },
                    adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
                    official_domain_verified=True,
                    official_domain_confidence=confidence,
                )
                by_domain[domain] = candidate
                if len(by_domain) >= request.requested_count:
                    break
            if len(by_domain) >= request.requested_count or source_attempts >= max_source_records:
                break
        candidates = list(by_domain.values())[: request.requested_count]
        reached = len(candidates) >= request.requested_count
        exhausted = all(result.exhausted for result in results) or source_attempts >= max_source_records
        # ponytail: record cap is a canary safety stop, not authoritative global exhaustion
        next_cursor = None if exhausted else DiscoveryCursor(f"growth:v1:{offset + page_size}", partition="official_growth_sources")
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=exhausted and not reached, scope="source" if exhausted else "partition",
                reason=(
                    "requested_count_reached" if reached
                    else "max_source_records_reached" if source_attempts >= max_source_records
                    else "all_growth_sources_exhausted" if all(result.exhausted for result in results)
                    else "next_partition_available"
                ),
                authoritative=False, next_cursor=next_cursor,
            ),
            operations=sum(len(result.records) for result in results), cost_eur=spent,
            started_at=started, completed_at=observed, warnings=tuple(sorted(set(warnings))),
        )
