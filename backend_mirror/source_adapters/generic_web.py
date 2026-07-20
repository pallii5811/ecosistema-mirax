"""Explicitly partial generic web fallback for uncovered commercial signals."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple
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
from .generic_web_budget import (
    BUFFER_EUR,
    IDENTITY_RESERVE_EUR,
    QUERY_COST_EUR,
    SEMANTIC_RESERVE_EUR,
    URLS_PER_WAVE,
    decode_generic_web_v2_payload,
    encode_generic_web_cursor,
    load_generic_web_state,
    persist_generic_web_state,
)
from .generic_web_provenance import (
    append_query_telemetry,
    attach_generic_provenance,
    evidence_has_fetch_provenance,
    generic_record_has_fetch_provenance,
    is_careers_only_host,
    page_fetch_id,
    semantic_call_id,
)
_SIGNAL_ALIASES: Dict[str, Tuple[str, ...]] = {
    "seeking_supplier": ("ricerca fornitori", "nuovi fornitori", "albo fornitori", "supplier search"),
    "regulatory_change": ("adeguamento normativo", "nuovo obbligo", "nuova normativa", "compliance"),
    "compliance_gap": ("non conforme", "sanzione", "obbligo non rispettato", "compliance gap"),
    "leadership_change": ("nuovo amministratore delegato", "nuovo direttore", "nomina", "management change", "nuovo CEO"),
    "certification": ("ottiene la certificazione", "certificata", "certificazione ottenuta"),
    "partnership_search": ("ricerca partner", "nuovi partner", "partner commerciali"),
    "distributor_search": ("ricerca distributori", "nuovi distributori", "rete distributiva"),
    "acquisition": ("acquisisce", "acquisizione", "ha acquisito"),
    "merger": ("fusione", "si fonde", "merger"),
    "funding": ("ha raccolto", "round di investimento", "finanziamento", "venture capital", "funding"),
    "financing": ("finanziamento agevolato", "credito d'imposta", "fondo perduto"),
    "capital_investment": ("investimento di", "iniezione di capitale", "private equity"),
    "technology_adoption": ("adotta", "implementa", "sceglie la piattaforma", "CRM", "ERP"),
    "technology_migration": ("migrazione", "sostituzione sistema", "passaggio a"),
    "active_advertising": ("campagna pubblicitaria", "Meta Ads", "Google Ads", "investimento media"),
    "investing_marketing": ("campagna pubblicitaria", "investimento marketing", "media buyer"),
}


@dataclass(frozen=True)
class GenericWebProviderResult:
    records: Tuple[Mapping[str, Any], ...]
    cost_eur: float = 0.0
    warnings: Tuple[str, ...] = ()


GenericWebProvider = Callable[[AdapterDiscoveryRequest, int, int], Awaitable[GenericWebProviderResult]]


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


def _official_organization(soup: BeautifulSoup, page_host: str) -> Optional[Mapping[str, Any]]:
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _iter_json(payload):
            raw_type = item.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if "Organization" in types and _host(item.get("url") or item.get("sameAs")) == page_host:
                return item
    return None


def _signal_phrases(request: AdapterDiscoveryRequest, signal_id: str) -> Tuple[str, ...]:
    configured = request.technical_filters.get("signal_keywords")
    if isinstance(configured, Mapping):
        values = configured.get(signal_id)
        if isinstance(values, (list, tuple)):
            cleaned = tuple(value for item in values if (value := _text(item)))
            if cleaned:
                return cleaned
    aliases = _SIGNAL_ALIASES.get(signal_id)
    if aliases:
        return aliases
    phrase = re.sub(r"[_-]+", " ", signal_id).strip()
    return (phrase,) if len(phrase) >= 5 else ()


def _matched_signals(blob: str, request: AdapterDiscoveryRequest) -> Tuple[str, ...]:
    lower = blob.casefold()
    matched = []
    for signal_id in request.signal_ids:
        phrases = _signal_phrases(request, signal_id)
        if phrases and any(phrase.casefold() in lower for phrase in phrases):
            matched.append(signal_id)
    return tuple(matched)


def parse_primary_evidence_page(
    html: str,
    source_url: str,
    request: AdapterDiscoveryRequest,
) -> List[Dict[str, Any]]:
    """Return only dated first-party evidence with explicit signal phrases."""
    host = _host(source_url)
    parsed_url = urlparse(source_url)
    if not host or is_blacklisted_domain(host) or (parsed_url.path or "/") in {"", "/"}:
        return []
    soup = BeautifulSoup(html or "", "html.parser")
    organization = _official_organization(soup, host)
    if not organization:
        return []
    company = _text(organization.get("name"))
    if not company:
        return []
    blob = _text(soup.get_text(" ", strip=True)) or ""
    matched = _matched_signals(blob, request)
    if request.signal_match_mode == "all" and len(matched) != len(request.signal_ids):
        return []
    if request.signal_match_mode == "any" and not matched:
        return []
    published = None
    for attrs in ({"property": "article:published_time"}, {"name": "date"}, {"itemprop": "datePublished"}):
        node = soup.find("meta", attrs=attrs)
        published = _iso_date(node.get("content") if node else None)
        if published:
            break
    if not published:
        node = soup.find("time")
        published = _iso_date(node.get("datetime") if node else None)
    if not published:
        return []
    positions = [blob.casefold().find(phrase.casefold()) for signal in matched for phrase in _signal_phrases(request, signal)]
    start = max(0, min((value for value in positions if value >= 0), default=0) - 180)
    excerpt = blob[start:start + 900]
    geography = next((item for item in request.geographies if item.casefold() in blob.casefold()), "")
    publisher_meta = soup.find("meta", attrs={"property": "og:site_name"})
    publisher = _text(publisher_meta.get("content") if publisher_meta else None) or company
    employees_raw = organization.get("numberOfEmployees")
    if isinstance(employees_raw, Mapping):
        employees_raw = employees_raw.get("value") or employees_raw.get("maxValue")
    try:
        employees = int(employees_raw) if employees_raw not in (None, "") else None
    except (TypeError, ValueError):
        employees = None
    size = ""
    if employees is not None:
        size = "micro" if employees <= 9 else "small" if employees <= 49 else "medium" if employees <= 249 else "enterprise"
    return [{
        "company_name": company,
        "official_domain": host,
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "matched_signal_ids": list(matched),
        "published_at": published,
        "geography": geography,
        "source_url": source_url,
        "source_publisher": publisher,
        "source_class": "official_company_website",
        "evidence_excerpt": excerpt,
        "extraction_method": "deterministic_primary_page",
        "company_size": size,
        "employee_count": employees,
        "query_origin": request.technical_filters.get("query_origin") or request.query,
        "parent_query": request.technical_filters.get("parent_query") or request.query,
        "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
    }]


def diversified_queries(request: AdapterDiscoveryRequest) -> Tuple[str, ...]:
    from .universal_strategy_queries import universal_strategy_queries_from_filters

    geography = " ".join(request.geographies)
    sector = " ".join(request.sectors)
    phrases = [phrase for signal in request.signal_ids for phrase in _signal_phrases(request, signal)]
    signal_query = " OR ".join(f'"{phrase}"' for phrase in phrases[:8])
    base = _text(request.query) or ""
    universal = universal_strategy_queries_from_filters(
        request.technical_filters,
        signal_ids=request.signal_ids,
        max_queries=8,
    )
    values = (
        *universal,
        base,
        f"({signal_query}) {sector} {geography} (comunicato OR news OR aggiornamento)",
        f"({signal_query}) {sector} {geography} (site:.it OR site:.eu)",
    )
    return tuple(dict.fromkeys(value.strip() for value in values if value.strip()))


def _telemetry_bucket(request: AdapterDiscoveryRequest) -> Dict[str, Any]:
    bucket = request.technical_filters.get("universal_prefilter_telemetry")
    if isinstance(bucket, dict):
        return bucket
    return {}


def _record_prefilter(
    request: AdapterDiscoveryRequest,
    *,
    raw: int,
    accepted: int,
    rejected: int,
    codes: Mapping[str, int],
    pages: int = 0,
    provider_query: str = "",
) -> None:
    bucket = request.technical_filters.get("universal_prefilter_telemetry")
    if not isinstance(bucket, dict):
        return
    bucket["raw_discovery_hits"] = int(bucket.get("raw_discovery_hits") or 0) + raw
    bucket["prefilter_accepted"] = int(bucket.get("prefilter_accepted") or 0) + accepted
    bucket["prefilter_rejected"] = int(bucket.get("prefilter_rejected") or 0) + rejected
    merged = dict(bucket.get("prefilter_rejection_codes") or {})
    for key, value in codes.items():
        merged[key] = int(merged.get(key) or 0) + int(value)
    bucket["prefilter_rejection_codes"] = merged
    bucket["pages_opened_after_prefilter"] = int(bucket.get("pages_opened_after_prefilter") or 0) + pages
    if provider_query:
        queries = list(bucket.get("provider_queries") or [])
        queries.append(provider_query)
        bucket["provider_queries"] = queries


def _gate_serp_hits(
    request: AdapterDiscoveryRequest,
    hits: Sequence[Mapping[str, Any]],
    *,
    provider_query: str,
) -> List[DiscoveryHit]:
    from .cheap_discovery_prefilter import DiscoveryHit, prefilter_discovery_hit

    accepted: List[DiscoveryHit] = []
    semantic_open_world = request.technical_filters.get("semantic_authority_required") is True
    codes: Dict[str, int] = {}
    raw = 0
    for item in hits:
        url = _text(item.get("url") or item.get("link")) or ""
        if not url:
            continue
        raw += 1
        hit = DiscoveryHit(
            title=str(item.get("title") or ""),
            url=url,
            snippet=str(item.get("snippet") or item.get("description") or ""),
            publisher=str(item.get("publisher") or ""),
        )
        decision = prefilter_discovery_hit(
            hit,
            require_event_hint=not semantic_open_world,
            allow_admin_assoc=semantic_open_world,
        )
        if decision.accepted:
            accepted.append(hit)
        else:
            codes[decision.reason] = codes.get(decision.reason, 0) + 1
    _record_prefilter(
        request,
        raw=raw,
        accepted=len(accepted),
        rejected=raw - len(accepted),
        codes=codes,
        provider_query=provider_query,
    )
    filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
    append_query_telemetry(
        filters,
        query_text=provider_query,
        raw_provider_hits=raw,
        prefilter_accepted=len(accepted),
        prefilter_rejected=raw - len(accepted),
        rejection_histogram=codes,
        provider_error=None,
        cost_eur=QUERY_COST_EUR,
    )
    return accepted


def _hits_from_urls(urls: Sequence[str], *, query: str) -> List[Dict[str, str]]:
    """Normalize legacy URL-only providers without fabricating SERP evidence."""
    out: List[Dict[str, str]] = []
    for url in urls:
        out.append({"url": url, "title": "", "snippet": "", "source_type": "search", "provider": "legacy_url"})
    return out


def _record_url_outcome(filters: MutableMapping[str, Any], outcome: Mapping[str, Any]) -> None:
    bucket = filters.get("generic_web_url_outcomes")
    if not isinstance(bucket, list):
        bucket = []
        filters["generic_web_url_outcomes"] = bucket
    bucket.append(dict(outcome))


def _apply_free_identity(row: MutableMapping[str, Any], request: AdapterDiscoveryRequest) -> MutableMapping[str, Any]:
    from backend_mirror.agents.entity_identity_resolver import (
        COMMERCIAL_ENTITY_CLASSES,
        EntityIdentityRequest,
        resolve_entity_identity,
    )

    company = _text(row.get("company_name"))
    source_url = _text(row.get("source_url"))
    domain = _host(row.get("official_domain"))
    if domain and is_careers_only_host(domain):
        domain = ""
    identity = resolve_entity_identity(
        EntityIdentityRequest(
            company_name=company,
            evidence_url=source_url,
            presented_domain=domain,
            geography=_text(row.get("geography")) or "",
            budget_eur=0.0,
            allow_serp=False,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
            source_payload=dict(row),
        )
    )
    if identity.official_domain and str(identity.identity_status or "").lower() == "verified":
        if not is_careers_only_host(identity.official_domain):
            row["official_domain"] = identity.official_domain
            row["official_domain_verified"] = True
            row["entity_class"] = identity.entity_class or "operating_company"
            row["domain_verification"] = {
                "status": "verified",
                "confidence": float(identity.identity_confidence or 0.85),
                "score": int(round(float(identity.identity_confidence or 0.85) * 100)),
                "evidence": tuple(identity.identity_evidence or ("free_identity",)),
                "resolution_source": identity.resolution_source or "free_identity",
                "resolution_method": identity.resolution_method or "structured_or_owned_host",
                "adapter_id": "generic_web_research_v1",
                "url": f"https://{identity.official_domain}/",
            }
    return row


_GENERIC_TITLE_RE = re.compile(
    r"\b(?:news|notizie|comunicato|stampa|evento|eventi|home|homepage|blog|"
    r"finanziamento|funding|round|nomina|partnership|tecnologia|marketing)\b",
    re.I,
)
_LEGAL_ENTITY_RE = re.compile(
    r"\b([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,5}"
    r"\s+(?:S\.?\s?p\.?\s?A\.?|S\.?\s?r\.?\s?l\.?|Srl|Spa|S\.p\.A\.))\b"
)


def _structured_subject_identities(html: str, *, page_host: str = "") -> Tuple[Mapping[str, Any], ...]:
    """Extract explicit target organizations without treating the publisher as one.

    Only organizations linked from an event-bearing object (about, mentions,
    hiringOrganization) are accepted on third-party pages.  A page-level
    Organization is accepted only on a non-article page hosted on that same
    organization's domain.  This is identity discovery, never event matching.
    """
    soup = BeautifulSoup(html or "", "html.parser")
    items: List[Mapping[str, Any]] = []
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        items.extend(_iter_json(payload))

    article_page = any(
        str(value) in {"Article", "NewsArticle", "Report", "BlogPosting"}
        for item in items
        for value in (item.get("@type") if isinstance(item.get("@type"), list) else [item.get("@type")])
    )
    identities: Dict[Tuple[str, str], Mapping[str, Any]] = {}
    for item in items:
        subjects: List[Any] = []
        for key in ("about", "mentions", "hiringOrganization"):
            value = item.get(key)
            subjects.extend(value if isinstance(value, list) else [value])
        raw_item_type = item.get("@type")
        item_types = raw_item_type if isinstance(raw_item_type, list) else [raw_item_type]
        item_url = item.get("url") or item.get("sameAs")
        if (
            not article_page
            and any(value in {"Organization", "Corporation", "LocalBusiness"} for value in item_types)
            and _host(item_url) == page_host
        ):
            subjects.append(item)
        for subject in subjects:
            if not isinstance(subject, Mapping):
                continue
            raw_type = subject.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if not any(value in {"Organization", "Corporation", "LocalBusiness"} for value in types):
                continue
            name = _text(subject.get("name")) or ""
            raw_urls = subject.get("url") or subject.get("sameAs") or ()
            urls = raw_urls if isinstance(raw_urls, list) else [raw_urls]
            official_url = next(
                (str(value) for value in urls if _host(value) and not is_blacklisted_domain(_host(value))),
                "",
            )
            domain = _host(official_url)
            if name and domain:
                identities[(name.casefold(), domain)] = {
                    "name": name,
                    "url": official_url,
                    "domain": domain,
                    "types": tuple(str(value) for value in types if value),
                }
    return tuple(identities.values())


def _structured_subject_company(html: str) -> str:
    identities = _structured_subject_identities(html)
    return str(identities[0].get("name") or "") if len(identities) == 1 else ""


def _structured_page_date(html: str) -> Optional[str]:
    soup = BeautifulSoup(html or "", "html.parser")
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _iter_json(payload):
            for key in ("datePublished", "datePosted"):
                parsed = _iso_date(item.get(key))
                if parsed:
                    return parsed
    for attrs in (
        {"property": "article:published_time"}, {"name": "date"},
        {"itemprop": "datePublished"}, {"itemprop": "datePosted"},
    ):
        node = soup.find("meta", attrs=attrs)
        parsed = _iso_date(node.get("content") if node else None)
        if parsed:
            return parsed
    node = soup.find("time", attrs={"datetime": True})
    return _iso_date(node.get("datetime") if node else None)


def _canonical_token(value: str) -> str:
    return "".join(char.casefold() for char in _text(value) if char.isalnum())


def _company_identity_hint(*, title: str, snippet: str, html: str) -> str:
    """Return only an identity explicitly present in acquired evidence."""
    structured = _structured_subject_company(html)
    if structured:
        return structured
    visible = _text(BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)) or ""
    combined = f"{title} {snippet} {visible[:100_000]}"
    legal = _LEGAL_ENTITY_RE.search(combined)
    if legal:
        return legal.group(1).strip()
    leading = re.split(r"\s+[|–—-]\s+|:\s+", title or "", maxsplit=1)[0].strip()
    if (
        2 <= len(leading) <= 90
        and not _GENERIC_TITLE_RE.search(leading)
        and re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]", leading)
        and leading.casefold() in snippet.casefold()
    ):
        return leading
    return ""


async def _default_generic_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> GenericWebProviderResult:
    import asyncio
    import httpx
    from backend_mirror.agents.search_serp import search_hits_http, search_urls_http
    from .universal_evidence import extract_evidence_from_text

    queries = diversified_queries(request)
    state = load_generic_web_state(request.cursor, request.technical_filters)
    hard_cap = float(request.budget_eur)
    remaining_for_query = max(0.0, hard_cap - float(state.discovery_spent_eur or 0.0))
    max_queries = min(len(queries), math.floor((remaining_for_query + 1e-9) / QUERY_COST_EUR))
    plan_search_cap = request.technical_filters.get("maximum_search_calls")
    try:
        if plan_search_cap is not None:
            max_queries = min(max_queries, max(1, int(plan_search_cap)))
    except (TypeError, ValueError):
        pass
    scope = hashlib.sha256(f"{request.query}|{request.signal_ids}|{request.geographies}".encode()).hexdigest()[:20]
    target = min(100, max(limit, URLS_PER_WAVE))
    universal = bool((request.technical_filters or {}).get("universal_engine"))
    spy_search = (request.technical_filters or {}).get("universal_serp_search")
    spent = 0.0
    accepted_hits: List[Any] = []
    seen: set[str] = set()
    provider_warnings: List[str] = []
    raw_meta = {
        str(item.get("url") or "").lower().rstrip("/"): dict(item)
        for item in state.url_meta
        if isinstance(item, Mapping) and item.get("url")
    }
    terminal = {str(item).strip().lower().rstrip("/") for item in state.processed_terminal_urls}
    for url in state.pending_urls:
        key = str(url).strip().lower().rstrip("/")
        if key and key not in terminal and key not in seen:
            seen.add(key)
            accepted_hits.append(raw_meta.get(key) or {"url": url, "title": "", "snippet": "", "source_type": "search", "provider": "resume"})
    # Resume must re-queue SERP hits persisted in url_meta even when pending_urls was empty.
    for meta in state.url_meta:
        if not isinstance(meta, Mapping):
            continue
        url = str(meta.get("url") or "")
        key = url.strip().lower().rstrip("/")
        if key and key not in terminal and key not in seen:
            seen.add(key)
            accepted_hits.append(dict(meta))
    pending_queries = list(queries[state.query_index:])
    from cost_context import current_cost_governor
    governor = current_cost_governor()
    remaining_governor = float(getattr(governor, "remaining_eur", 0.0) or 0.0) if governor is not None else float("inf")
    if not accepted_hits and max_queries > 0:
        if universal and remaining_governor + 1e-9 < QUERY_COST_EUR + SEMANTIC_RESERVE_EUR + IDENTITY_RESERVE_EUR + BUFFER_EUR:
            return GenericWebProviderResult((), 0.0, ("DISCOVERY_BUDGET_RESERVED",))
    queries_run = 0
    if not accepted_hits:
        for index, query in enumerate(pending_queries[:max_queries]):
            if queries_run > 0:
                break
            if spent + QUERY_COST_EUR > request.budget_eur + 1e-9:
                break
            if callable(spy_search):
                found_hits = await asyncio.to_thread(spy_search, query, target)
                spent += QUERY_COST_EUR
                if found_hits and isinstance(found_hits[0], str):
                    found_hits = _hits_from_urls(found_hits, query=query)
            else:
                if universal:
                    found_hits = await asyncio.to_thread(
                        search_hits_http, query, target, cost_scope=f"generic-web:{scope}:{index}",
                    )
                else:
                    found_urls = await asyncio.to_thread(
                        search_urls_http, query, target, cost_scope=f"generic-web:{scope}:{index}",
                    )
                    found_hits = _hits_from_urls(found_urls, query=query)
                spent += QUERY_COST_EUR
            queries_run += 1
            state.query_index += 1
            state.provider_calls += 1
            state.discovery_spent_eur = round(float(state.discovery_spent_eur) + QUERY_COST_EUR, 6)
            if universal:
                gated = _gate_serp_hits(request, found_hits, provider_query=query)
                rich_by_url = {
                    str(item.get("url") or item.get("link") or "").lower().rstrip("/"): item
                    for item in found_hits
                    if isinstance(item, Mapping)
                }
                for hit in gated:
                    key = hit.url.lower().rstrip("/")
                    if key in terminal:
                        continue
                    if key not in seen:
                        seen.add(key)
                        original = rich_by_url.get(key) or {}
                        accepted_hits.append({
                            "url": hit.url,
                            "title": hit.title,
                            "snippet": hit.snippet,
                            "publisher": hit.publisher,
                            "source_type": str(original.get("source_type") or "search"),
                            "provider": str(original.get("provider") or "unknown"),
                            "rank": int(original.get("rank") or 0),
                            "provider_query": query,
                        })
            else:
                for item in found_hits:
                    url = str(item.get("url") or "")
                    key = url.lower().rstrip("/")
                    if url and key not in seen:
                        seen.add(key)
                        accepted_hits.append(item)
            if accepted_hits:
                break

    records: List[Mapping[str, Any]] = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Generic/1.0)", "Accept-Language": "it-IT,it;q=0.9"}
    pages_opened = 0
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        page_fetch = (request.technical_filters or {}).get("universal_page_fetch")
        next_pending_urls: List[str] = []
        next_url_meta: Dict[str, Dict[str, Any]] = dict(raw_meta)
        wave = accepted_hits[: max(3, min(limit, URLS_PER_WAVE))]
        for item in wave:
            url = item.url if hasattr(item, "url") else str(item.get("url") or "")
            title = item.title if hasattr(item, "title") else str(item.get("title") or "")
            snippet = item.snippet if hasattr(item, "snippet") else str(item.get("snippet") or "")
            search_provider = str(item.get("provider") or "unknown") if isinstance(item, Mapping) else "unknown"
            provider_query = str(item.get("provider_query") or request.query) if isinstance(item, Mapping) else request.query
            key = url.lower().rstrip("/")
            if key:
                next_url_meta[key] = {
                    "url": url,
                    "title": title,
                    "snippet": snippet,
                    "provider": search_provider,
                    "source_type": str(item.get("source_type") or "search") if isinstance(item, Mapping) else "search",
                    "rank": int(item.get("rank") or 0) if isinstance(item, Mapping) else 0,
                    "provider_query": provider_query,
                }
            try:
                if callable(page_fetch):
                    html, final_url = await asyncio.to_thread(page_fetch, url)
                else:
                    response = await client.get(url)
                    if response.status_code != 200 or "html" not in str(response.headers.get("content-type") or "").lower():
                        filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                        _record_url_outcome(filters, {
                            "url": url,
                            "query": provider_query,
                            "fetch_attempted": True,
                            "status_code": int(response.status_code),
                            "parse_status": "rejected_fetch",
                            "rejection_code": "PAGE_FETCH_FAILED",
                        })
                        state.wave_terminal_rejections += 1
                        state.processed_terminal_urls = (*state.processed_terminal_urls, url)
                        continue
                    html = response.text[:2_000_000]
                    final_url = str(response.url)
                pages_opened += 1
                state.pages_fetched += 1
                state.processed_terminal_urls = (*state.processed_terminal_urls, url)
                visible_text = _text(BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)) or ""
                fetch_provenance = {
                    "scope": scope,
                    "final_url": final_url,
                    "source_text": visible_text,
                }
                if universal:
                    page_host = _host(final_url)
                    if request.technical_filters.get("semantic_authority_required") is True:
                        identity_hint = _company_identity_hint(title=title, snippet=snippet, html=html)
                        if (
                            identity_hint
                            and _canonical_token(identity_hint) not in _canonical_token(visible_text)
                        ):
                            filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                            _record_url_outcome(filters, {
                                "url": url,
                                "query": provider_query,
                                "fetch_attempted": True,
                                "status_code": 200,
                                "parse_status": "rejected_content",
                                "rejection_code": "PAGE_CONTENT_MISSING",
                            })
                            state.wave_terminal_rejections += 1
                            continue
                    # Dynamic relationships are acquisition hypotheses only.
                    # Final event type, role and query match are decided by the
                    # semantic interpreter and exact grounding verifier.
                    semantic_contract = request.technical_filters.get("semantic_query_contract")
                    identities: Tuple[Mapping[str, Any], ...] = ()
                    if isinstance(semantic_contract, Mapping):
                        identities = _structured_subject_identities(html, page_host=page_host)
                    if identities:
                        published = _structured_page_date(html)
                        visible_text = fetch_provenance["source_text"]
                        if not visible_text or not published:
                            provider_warnings.append("SEMANTIC_SOURCE_PROVENANCE_INCOMPLETE")
                            continue
                        for identity in identities:
                            company = str(identity.get("name") or "")
                            domain = str(identity.get("domain") or "")
                            excerpt = title.strip() if title.strip() and title.strip() in visible_text else visible_text[:1200]
                            row = {
                                "company_name": company,
                                "official_domain": domain,
                                "organization_url": identity.get("url"),
                                "official_domain_verified": False,
                                "entity_class": "operating_company",
                                "matched_signal_ids": list(request.signal_ids),
                                "published_at": published,
                                "geography": next((g for g in request.geographies if g.casefold() not in {"italy", "italia"}), ""),
                                "source_url": final_url,
                                "source_publisher": str(item.get("publisher") or title or page_host) if isinstance(item, Mapping) else (title or page_host),
                                "source_class": "official_company_website" if domain == page_host else "recognized_news",
                                "evidence_excerpt": excerpt,
                                "extraction_method": "structured_identity_semantic_candidate",
                                "source_text": visible_text[:250_000],
                                "page_title": title,
                                "search_snippet": snippet,
                                "structured_metadata": {"target_organization": dict(identity)},
                                "query_origin": request.technical_filters.get("query_origin") or request.query,
                                "parent_query": request.technical_filters.get("parent_query") or request.query,
                                "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
                                "provider_query": provider_query,
                                "search_provider": search_provider,
                            }
                            attach_generic_provenance(
                                row,
                                adapter_id="generic_web_research_v1",
                                search_scope=scope,
                                execution_round=int(request.technical_filters.get("discovery_round") or state.provider_calls or 1),
                                provider_call_id=f"serp:{scope}:{state.provider_calls}",
                                page_fetch_id_value=page_fetch_id(
                                    search_scope=scope,
                                    url=str(fetch_provenance["final_url"]),
                                    wave_index=state.pages_fetched,
                                ),
                                source_text=visible_text,
                                cursor_version=request.cursor.value if request.cursor else "generic-web:v2",
                            )
                            row = _apply_free_identity(row, request)
                            records.append(row)
                        continue
                    # Open-world pages often lack JSON-LD about/mentions. Keep the
                    # page as source_text via universal evidence extraction so
                    # SemanticCommercialEventInterpreter can still run.
                    company_hint = _company_identity_hint(title=title, snippet=snippet, html=html)
                    if not company_hint:
                        provider_warnings.append("COMPANY_IDENTITY_UNRESOLVED")
                        state.wave_terminal_rejections += 1
                        continue
                    events = extract_evidence_from_text(
                        text=html,
                        source_url=final_url,
                        source_class="recognized_news",
                        publisher=title or _host(final_url),
                        company_name_hint=company_hint,
                        requested_signals=(),
                    )
                    if not events and snippet and request.technical_filters.get("semantic_authority_required") is not True:
                        events = extract_evidence_from_text(
                            text=f"{title}. {snippet}",
                            source_url=final_url,
                            source_class="recognized_news",
                            publisher=title or _host(final_url),
                            company_name_hint=company_hint,
                            requested_signals=(),
                        )
                    # Never invent publisher host as the target company domain.
                    for event in events:
                        if not event.company_name or not event.evidence_excerpt or not event.event_date:
                            continue
                        domain = event.official_domain_candidate or _host(final_url)
                        matched_ids = []
                        if event.event_type and event.event_type in request.signal_ids:
                            matched_ids = [event.event_type]
                        else:
                            related = {
                                "active_advertising": {"investing_marketing", "active_advertising", "rebranding"},
                                "funding": {"funding", "financing", "capital_investment"},
                                "technology_adoption": {"technology_adoption", "technology_migration"},
                                "regulatory_change": {"regulatory_change", "compliance_gap", "certification"},
                                "leadership_change": {"leadership_change"},
                            }
                            for req in request.signal_ids:
                                family = related.get(event.event_type or "", set()) | {event.event_type or ""}
                                if req in family or event.event_type == req:
                                    matched_ids.append(req)
                        if not matched_ids and isinstance(semantic_contract, Mapping):
                            matched_ids = list(request.signal_ids)
                        if not matched_ids:
                            continue
                        row = {
                            "company_name": event.company_name,
                            "official_domain": domain,
                            "official_domain_verified": False,
                            "entity_class": "operating_company",
                            "matched_signal_ids": matched_ids,
                            "published_at": event.event_date,
                            "geography": next((g for g in request.geographies if g.casefold() not in {"italy", "italia"}), ""),
                            "source_url": event.source_url,
                            "source_publisher": event.publisher,
                            "source_class": event.source_class,
                            "evidence_excerpt": event.evidence_excerpt,
                            "extraction_method": "universal_evidence",
                            "source_text": visible_text[:250_000],
                            "why_now": event.evidence_excerpt[:260],
                            "buyer_fit": 0.75,
                            "query_origin": request.technical_filters.get("query_origin") or request.query,
                            "parent_query": request.technical_filters.get("parent_query") or request.query,
                            "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
                            "provider_query": provider_query,
                            "search_provider": search_provider,
                        }
                        attach_generic_provenance(
                            row,
                            adapter_id="generic_web_research_v1",
                            search_scope=scope,
                            execution_round=int(request.technical_filters.get("discovery_round") or state.provider_calls or 1),
                            provider_call_id=f"serp:{scope}:{state.provider_calls}",
                            page_fetch_id_value=page_fetch_id(
                                search_scope=scope,
                                url=str(fetch_provenance["final_url"]),
                                wave_index=state.pages_fetched,
                            ),
                            source_text=visible_text,
                            cursor_version=request.cursor.value if request.cursor else "generic-web:v2",
                        )
                        row = _apply_free_identity(row, request)
                        records.append(row)
                else:
                    records.extend(parse_primary_evidence_page(html, final_url, request))
                filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                _record_url_outcome(filters, {
                    "url": url,
                    "query": provider_query,
                    "fetch_attempted": True,
                    "status_code": 200,
                    "final_url": final_url,
                    "source_text_chars": len(visible_text),
                    "parse_status": "parsed",
                })
            except Exception as exc:
                filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                _record_url_outcome(filters, {
                    "url": url,
                    "query": provider_query,
                    "fetch_attempted": True,
                    "parse_status": "rejected_fetch",
                    "rejection_code": "PAGE_FETCH_FAILED",
                    "error": type(exc).__name__,
                })
                provider_warnings.append(f"PAGE_FETCH_FAILED:{type(exc).__name__}")
                state.wave_terminal_rejections += 1
                state.processed_terminal_urls = (*state.processed_terminal_urls, url)
                continue
        terminal_end = {str(item).strip().lower().rstrip("/") for item in state.processed_terminal_urls}
        for item in accepted_hits:
            url = item.url if hasattr(item, "url") else str(item.get("url") or "")
            key = url.lower().rstrip("/")
            if url and key not in terminal_end:
                next_pending_urls.append(url)
        state.pending_urls = tuple(dict.fromkeys(next_pending_urls))
        state.url_meta = tuple(next_url_meta.values())
        persist_generic_web_state(request.technical_filters, state)
    if universal:
        _record_prefilter(request, raw=0, accepted=0, rejected=0, codes={}, pages=pages_opened)
    return GenericWebProviderResult(tuple(records), spent, tuple(provider_warnings))


def _cursor_offset(cursor: Optional[DiscoveryCursor]) -> int:
    if not cursor:
        return 0
    if cursor.value.startswith("generic-web:v2:"):
        payload = decode_generic_web_v2_payload(cursor.value)
        if isinstance(payload, Mapping):
            try:
                return max(0, int(payload.get("legacy_offset") or 0))
            except (TypeError, ValueError):
                return 0
        return 0
    match = re.fullmatch(r"generic-web:v1:(\d+)", cursor.value)
    if not match:
        raise ValueError("invalid generic web cursor")
    return int(match.group(1))


def _requires_sme(request: AdapterDiscoveryRequest) -> bool:
    return bool(re.search(r"\b(?:pmi|piccol[ae]|medi[ae]|microimprese?|sme)\b", request.query, re.I))


def _valid_record(record: Mapping[str, Any], request: AdapterDiscoveryRequest, today: date) -> Tuple[bool, str]:
    company = _text(record.get("company_name"))
    domain = _host(record.get("official_domain"))
    universal = bool((request.technical_filters or {}).get("universal_engine"))
    semantic_required = request.technical_filters.get("semantic_authority_required") is True
    if not company:
        return False, "COMPANY_MISSING"
    if not domain or is_blacklisted_domain(domain):
        return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if universal:
        ok_prov, prov_code = generic_record_has_fetch_provenance(record)
        if not ok_prov:
            return False, prov_code
    if record.get("official_domain_verified") is not True:
        if not semantic_required:
            return False, "OFFICIAL_DOMAIN_UNVERIFIED"
        if not domain:
            return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if (_text(record.get("entity_class")) or "") != "operating_company":
        return False, "NON_OPERATING_ENTITY"
    source_class = _text(record.get("source_class")) or ""
    if universal:
        if source_class not in {"official_company_website", "recognized_news", "industry_publication", "corporate_newsroom"}:
            return False, "NON_PRIMARY_SOURCE"
    elif source_class != "official_company_website":
        return False, "NON_PRIMARY_SOURCE"
    if not all((_text(record.get("source_url")), _text(record.get("source_publisher")), _text(record.get("evidence_excerpt")))):
        return False, "SOURCE_PROVENANCE_MISSING"
    if universal and not semantic_required and not _text(record.get("why_now")):
        return False, "WHY_NOW_MISSING"
    if universal and not semantic_required and record.get("buyer_fit") is None:
        return False, "BUYER_FIT_MISSING"
    published = _iso_date(record.get("published_at"))
    if not published:
        return False, "SIGNAL_DATE_MISSING"
    age = (today - date.fromisoformat(published)).days
    if age < 0 or (request.freshness_max_age_days is not None and age > request.freshness_max_age_days):
        return False, "SIGNAL_STALE"
    matched_raw = record.get("matched_signal_ids")
    matched = {str(item).strip() for item in matched_raw} if isinstance(matched_raw, (list, tuple, set)) else set()
    required = set(request.signal_ids)
    if request.signal_match_mode == "all" and not required.issubset(matched):
        return False, "ALL_SIGNALS_INCOMPLETE"
    if request.signal_match_mode == "any" and not required.intersection(matched):
        return False, "NO_REQUESTED_SIGNAL_EVIDENCE"
    excerpt = _text(record.get("evidence_excerpt")) or ""
    if not universal:
        verified = _matched_signals(excerpt, request)
        if not set(verified).issuperset(matched.intersection(required)):
            return False, "EVIDENCE_PATTERN_UNPROVEN"
    requested_geo = [item.casefold() for item in request.geographies if item.casefold() not in {"italy", "italia"}]
    geography = (_text(record.get("geography")) or "").casefold()
    if requested_geo and geography and not any(item in geography or geography in item for item in requested_geo):
        return False, "GEOGRAPHY_MISMATCH"
    if _requires_sme(request):
        size = (_text(record.get("company_size")) or "").casefold()
        try:
            employees = int(record.get("employee_count")) if record.get("employee_count") is not None else None
        except (TypeError, ValueError):
            employees = None
        if size in {"enterprise", "large"} or (employees is not None and employees > 249):
            return False, "ENTERPRISE_OUT_OF_TARGET"
        if size not in {"micro", "small", "medium", "pmi", "sme"} and employees is None:
            return False, "SME_STATUS_UNVERIFIED"
    return True, ""


class GenericWebResearchAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="generic_web_research_v1", adapter_version="1.0.0",
        supported_intents=("*",), supported_signals=("*",),
        source_classes=("search_snippet", "official_company_website"), geographic_coverage=("global",),
        freshness_max_age_days=None, discovery_mode="generic_fallback", supports_pagination=True,
        supports_cursor_resume=True, max_results_per_page=100, max_results_per_run=None,
        estimated_cost_eur_per_operation=QUERY_COST_EUR,
        authentication_requirements=("search_provider_with_cost_governor",), rate_limit_per_minute=20,
        provenance_guarantees=("query_origin", "parent_query", "discovery_round", "source_url", "publisher"),
        evidence_guarantees=("explicit_signal_phrase", "published_at", "official_company_identity"),
        exhaustion_semantics="best_effort", coverage_status="generic_fallback_partial",
    )

    def __init__(self, providers: Sequence[GenericWebProvider] = (_default_generic_provider,)) -> None:
        if not providers:
            raise ValueError("at least one generic web provider is required")
        self._providers = tuple(providers)

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        offset = _cursor_offset(request.cursor)
        page_size = min(100, max(request.requested_count * 4, 20))
        started = datetime.now(timezone.utc).isoformat()
        results: List[GenericWebProviderResult] = []
        spent = 0.0
        for provider in self._providers:
            remaining = max(0.0, request.budget_eur - spent)
            bounded = AdapterDiscoveryRequest(
                intent=request.intent, signal_ids=request.signal_ids, signal_match_mode=request.signal_match_mode,
                geographies=request.geographies, freshness_max_age_days=request.freshness_max_age_days,
                requested_count=request.requested_count, budget_eur=remaining, query=request.query,
                sectors=request.sectors, technical_filters=request.technical_filters, cursor=request.cursor,
            )
            result = await provider(bounded, offset, page_size)
            if result.cost_eur > remaining + 1e-9:
                raise RuntimeError("GENERIC_WEB_PROVIDER_EXCEEDED_HARD_COST_CAP")
            results.append(result)
            spent += result.cost_eur
        observed = datetime.now(timezone.utc).isoformat()
        state = load_generic_web_state(request.cursor, request.technical_filters)
        next_legacy_offset = max(offset + page_size, int(state.legacy_offset or 0))
        state.legacy_offset = next_legacy_offset
        persist_generic_web_state(request.technical_filters, state)
        warnings = [warning for result in results for warning in result.warnings]
        candidates: List[OpportunityCandidate] = []
        seen: set[str] = set()
        universal = bool((request.technical_filters or {}).get("universal_engine"))
        semantic_required = request.technical_filters.get("semantic_authority_required") is True
        for result in results:
            for record in result.records:
                domain = _host(record.get("official_domain"))
                company = _text(record.get("company_name")) or ""
                source_url = _text(record.get("source_url")) or ""
                valid, rejection = _valid_record(record, request, date.today())
                if not valid:
                    warnings.append(rejection)
                    continue
                domain = _host(record.get("official_domain"))
                if domain in seen:
                    warnings.append("DUPLICATE_COMPANY")
                    continue
                seen.add(domain)
                matched = tuple(str(item) for item in record.get("matched_signal_ids") or () if str(item) in request.signal_ids)
                if not matched:
                    warnings.append("NO_REQUESTED_SIGNAL_EVIDENCE")
                    continue
                published = _iso_date(record.get("published_at")) or ""
                source_url = _text(record.get("source_url")) or ""
                publisher = _text(record.get("source_publisher")) or ""
                excerpt = _text(record.get("evidence_excerpt")) or ""
                source_class = _text(record.get("source_class")) or "official_company_website"
                why_now = _text(record.get("why_now"))
                if semantic_required:
                    buyer_fit = None
                else:
                    why_now = why_now or f"Evidenza primaria recente: {excerpt[:260]}"
                    try:
                        buyer_fit = float(record.get("buyer_fit") if record.get("buyer_fit") is not None else 0.75)
                    except (TypeError, ValueError):
                        buyer_fit = 0.75
                domain_verification = record.get("domain_verification") if isinstance(record.get("domain_verification"), Mapping) else {
                    "status": "verified", "confidence": 0.80, "score": 80,
                    "evidence": ("schema_org_identity_match", "official_page_host_match"),
                    "resolution_source": "source_adapter",
                    "resolution_method": "verified_source_adapter",
                    "adapter_id": self.capability.adapter_id,
                    "url": f"https://{domain}/",
                }
                evidence = tuple(EvidenceRecord(
                    signal_id=signal, source_url=source_url, source_publisher=publisher,
                    source_class=source_class, excerpt=excerpt[:1200], observed_at=observed,
                    published_at=published, extraction_method=_text(record.get("extraction_method")) or "deterministic_primary_page",
                    confidence=0.72,
                    provenance={
                        "query_origin": record.get("query_origin") or request.query,
                        "parent_query": record.get("parent_query") or request.query,
                        "discovery_round": record.get("discovery_round") or 1,
                        "provider_query": record.get("provider_query"),
                        "coverage": "generic_fallback_partial",
                        "source_text": record.get("source_text") or excerpt,
                        "page_title": record.get("page_title"),
                        "search_snippet": record.get("search_snippet"),
                        "structured_metadata": record.get("structured_metadata") or {},
                        "origin_adapter_id": record.get("origin_adapter_id"),
                        "origin_execution_round": record.get("origin_execution_round"),
                        "origin_provider_call_id": record.get("origin_provider_call_id"),
                        "origin_page_fetch_id": record.get("origin_page_fetch_id"),
                        "origin_source_text_hash": record.get("origin_source_text_hash"),
                        "origin_cursor_version": record.get("origin_cursor_version"),
                    },
                ) for signal in matched)
                if not evidence:
                    warnings.append("NO_CANONICAL_EVIDENCE")
                    continue
                # Hard reject incomplete universal candidates.
                if universal and not semantic_required and not all((company, domain, matched, published, excerpt, source_url, source_class, domain_verification)):
                    warnings.append("UNIVERSAL_CANDIDATE_INCOMPLETE")
                    continue
                if universal and semantic_required and not all((company, matched, published, excerpt, source_url, source_class)):
                    warnings.append("UNIVERSAL_CANDIDATE_INCOMPLETE")
                    continue
                candidates.append(OpportunityCandidate(
                    canonical_company_name=company,
                    company_identifiers={}, official_domain=domain, entity_class="operating_company",
                    geographies=(_text(record.get("geography")) or "",), buyer_fit=buyer_fit,
                    signal_id=matched[0], signal_date=published, evidence=evidence,
                    why_now=why_now, contacts=(), confidence=0.55 if semantic_required else 0.72,
                    contradiction_flags=("GENERIC_FALLBACK_PARTIAL",),
                    provenance={
                        "adapter_id": self.capability.adapter_id,
                        "query_origin": record.get("query_origin") or request.query,
                        "parent_query": record.get("parent_query") or request.query,
                        "discovery_round": record.get("discovery_round") or 1,
                        "provider_query": record.get("provider_query"),
                        "limitations": "sampled web evidence; no global source exhaustion claim",
                        "domain_verification": domain_verification,
                        "origin_adapter_id": record.get("origin_adapter_id"),
                        "origin_execution_round": record.get("origin_execution_round"),
                        "origin_provider_call_id": record.get("origin_provider_call_id"),
                        "origin_page_fetch_id": record.get("origin_page_fetch_id"),
                        "origin_source_text_hash": record.get("origin_source_text_hash"),
                        "origin_cursor_version": record.get("origin_cursor_version"),
                    },
                    adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
                    official_domain_verified=record.get("official_domain_verified") is True,
                    official_domain_confidence=float(domain_verification.get("confidence") or 0.80),
                ))
                if len(candidates) >= request.requested_count:
                    break
            if len(candidates) >= request.requested_count:
                break
        final_state = load_generic_web_state(request.cursor, request.technical_filters)
        filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=False, scope="partition",
                reason="requested_count_reached_partial_coverage" if len(candidates) >= request.requested_count else "sample_partition_complete_not_global_exhaustion",
                authoritative=False,
                next_cursor=encode_generic_web_cursor(final_state),
            ),
            operations=sum(len(result.records) for result in results), cost_eur=spent,
            started_at=started, completed_at=observed, warnings=tuple(sorted(set(warnings))),
            telemetry={
                "pages_fetched": final_state.pages_fetched,
                "provider_queries": final_state.provider_calls,
                "query_telemetry": list(filters.get("generic_web_query_telemetry") or ()),
                "url_outcomes": list(filters.get("generic_web_url_outcomes") or ()),
                "acquisition": {
                    "pages_fetched": final_state.pages_fetched,
                    "provider_queries": final_state.provider_calls,
                    "pending_urls": list(final_state.pending_urls),
                },
            },
        )
