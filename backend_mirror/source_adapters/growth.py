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
    "new_location": re.compile(r"\b(?:inaugura|apre|ha aperto|annuncia)\s+(?:una\s+)?nuov[ao]\s+(?:sede|filiale|ufficio|showroom|punto vendita|apertura)\b", re.I),
    "production_expansion": re.compile(r"\b(?:amplia|potenzia|inaugura|avvia)\s+(?:(?:la|un|una)\s+)?(?:capacita produttiva|capacità produttiva|produzione|nuov[ao]\s+(?:linea|impianto|stabilimento))\b", re.I),
    "geographic_expansion": re.compile(r"\b(?:entra|si espande|avvia le operazioni|debutta)\s+(?:in|nel|sul)\s+(?:(?:un|una)\s+)?(?:nuov[oi]\s+)?mercat[oi]\b", re.I),
    "internationalization": re.compile(r"\b(?:espansione internazionale|internazionalizzazione|entra nel mercato estero|apre all'estero)\b", re.I),
    "product_launch": re.compile(r"\b(?:lancia|presenta|introduce)\s+(?:(?:il|la|un|una)\s+)?nuov[oa]\s+(?:prodotto|linea|gamma)\b", re.I),
    "service_launch": re.compile(r"\b(?:lancia|presenta|introduce)\s+(?:il\s+|un\s+)?nuov[oa]\s+servizi[oa]\b", re.I),
    "new_equipment": re.compile(r"\b(?:installa|acquista|investe in)\s+(?:un\s+|una\s+)?nuov[oa]\s+(?:macchinario|impianto|attrezzatura)\b", re.I),
    "market_entry": re.compile(r"\b(?:entra|debutta|sbarca)\s+(?:in|nel|sul)\s+(?:nuov[oa]\s+)?mercat[oa]\b", re.I),
}
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
    if not organization:
        return []
    company = _text(organization.get("name"))
    official_domain = _host(organization.get("url") or organization.get("sameAs"))
    if not company or not official_domain or is_blacklisted_domain(official_domain):
        return []
    blob = _text(soup.get_text(" ", strip=True)) or ""
    signal_id, proof_level, match = classify_growth_evidence(blob, requested_signals)
    if not signal_id or not match:
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
    geography = next((item for item in geographies if item.casefold() in blob.casefold()), "")
    start = max(0, match.start() - 180)
    excerpt = blob[start:match.end() + 300]
    publisher_meta = soup.find("meta", attrs={"property": "og:site_name"})
    publisher = _text(publisher_meta.get("content") if publisher_meta else None) or host
    source_class = "official_company_website" if is_official else "recognized_local_news"
    return [{
        "company_name": company,
        "official_domain": official_domain,
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "signal_id": signal_id,
        "proof_level": proof_level,
        "published_at": published,
        "geography": geography,
        "source_url": source_url,
        "source_publisher": publisher,
        "source_class": source_class,
        "evidence_excerpt": excerpt,
        "extraction_method": "structured_official_page" if is_official else "structured_news_about_entity",
        "corroborated": is_official,
    }]


async def _default_growth_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> GrowthProviderResult:
    import asyncio
    import httpx
    from backend_mirror.agents.search_serp import search_urls_http

    location = next((item for item in request.geographies if item.casefold() not in {"italy", "italia"}), "Italia")
    sector = " ".join(request.sectors)
    signals = set(request.signal_ids)
    queries: List[str] = []
    if signals & _MARKETING_SIGNALS:
        queries.extend((
            f'aziende {location} ("campagna pubblicitaria" OR "Meta Ads" OR "Google Ads") {sector}',
            f'aziende {location} ("affida la comunicazione" OR rebranding OR "media buyer") {sector}',
        ))
    if signals & _EXPANSION_SIGNALS:
        queries.extend((
            f'aziende {location} ("nuova sede" OR "nuovo stabilimento" OR "capacità produttiva") {sector}',
            f'aziende {location} ("nuovo mercato" OR internazionalizzazione OR "nuova linea") {sector}',
        ))
    max_queries = min(len(queries), math.floor((request.budget_eur + 1e-9) / _QUERY_COST_EUR))
    if max_queries <= 0:
        return GrowthProviderResult((), False, 0.0, ("BUDGET_TOO_LOW_FOR_SEARCH",))
    scope = hashlib.sha256(f"{request.query}|{request.signal_ids}|{request.geographies}".encode()).hexdigest()[:20]
    urls: List[str] = []
    seen: set[str] = set()
    spent = 0.0
    target = min(100, offset + max(limit * 2, 30))
    for index, query in enumerate(queries[:max_queries]):
        if spent + _QUERY_COST_EUR > request.budget_eur + 1e-9:
            break
        found = await asyncio.to_thread(
            search_urls_http, query, target, cost_scope=f"growth-adapter:{scope}:{index}",
        )
        spent += _QUERY_COST_EUR
        for url in found:
            key = url.lower().rstrip("/")
            if key not in seen:
                seen.add(key)
                urls.append(url)
    records: List[Mapping[str, Any]] = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Growth/1.0)", "Accept-Language": "it-IT,it;q=0.9"}
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        for url in urls[offset:offset + limit]:
            try:
                response = await client.get(url)
                if response.status_code != 200 or "html" not in str(response.headers.get("content-type") or "").lower():
                    continue
                records.extend(parse_growth_page(response.text[:2_000_000], str(response.url), request.signal_ids, request.geographies))
            except Exception:
                continue
    return GrowthProviderResult(tuple(records), offset + limit >= len(urls), spent)


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
    if source_class != "official_company_website" and record.get("corroborated") is not True:
        return False, "SECONDARY_SOURCE_NOT_CORROBORATED"
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
        if size not in {"micro", "small", "medium", "pmi", "sme"} and employees is None:
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
        page_size = min(100, max(request.requested_count * 3, 20))
        started = datetime.now(timezone.utc).isoformat()
        results: List[GrowthProviderResult] = []
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
                raise RuntimeError("GROWTH_PROVIDER_EXCEEDED_HARD_COST_CAP")
            results.append(result)
            spent += result.cost_eur
        observed = datetime.now(timezone.utc).isoformat()
        warnings = [warning for result in results for warning in result.warnings]
        candidates: List[OpportunityCandidate] = []
        seen: set[Tuple[str, str]] = set()
        for result in results:
            for record in result.records:
                valid, rejection = _record_valid(record, request, date.today())
                if not valid:
                    warnings.append(rejection)
                    continue
                company = _text(record.get("company_name")) or ""
                domain = _host(record.get("official_domain"))
                signal = _text(record.get("signal_id")) or ""
                key = (domain, signal)
                if key in seen:
                    warnings.append("DUPLICATE_COMPANY_SIGNAL")
                    continue
                seen.add(key)
                published = _iso_date(record.get("published_at")) or ""
                source_url = _text(record.get("source_url")) or ""
                publisher = _text(record.get("source_publisher")) or ""
                source_class = _text(record.get("source_class")) or ""
                proof = _text(record.get("proof_level")) or ""
                excerpt = _text(record.get("evidence_excerpt")) or ""
                confidence = 0.96 if proof == "direct" and source_class == "official_company_website" else 0.86
                evidence_signals = (
                    proven_requested_signals(excerpt, request.signal_ids)
                    if request.signal_match_mode == "all"
                    else (signal,)
                )
                evidence = tuple(EvidenceRecord(
                    signal_id=evidence_signal, source_url=source_url, source_publisher=publisher,
                    source_class=source_class, excerpt=excerpt[:1200], observed_at=observed,
                    published_at=published, extraction_method=_text(record.get("extraction_method")) or "structured_growth_event",
                    confidence=confidence,
                    provenance={"proof_level": proof, "corroborated": record.get("corroborated") is True},
                ) for evidence_signal in evidence_signals)
                candidates.append(OpportunityCandidate(
                    canonical_company_name=company, company_identifiers={}, official_domain=domain,
                    entity_class="operating_company", geographies=(_text(record.get("geography")) or "",),
                    buyer_fit=1.0, signal_id=signal, signal_date=published, evidence=evidence,
                    why_now=_text(record.get("why_now")) or f"{proof}: {excerpt[:240]}", contacts=(),
                    confidence=confidence, contradiction_flags=(),
                    provenance={
                        "adapter_id": self.capability.adapter_id,
                        "proof_level": proof,
                        "publisher": publisher,
                        "matched_signal_ids": evidence_signals,
                    },
                    adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
                    official_domain_verified=record.get("official_domain_verified") is True,
                    official_domain_confidence=0.96 if source_class == "official_company_website" else 0.86,
                ))
                if len(candidates) >= request.requested_count:
                    break
            if len(candidates) >= request.requested_count:
                break
        reached = len(candidates) >= request.requested_count
        exhausted = all(result.exhausted for result in results)
        next_cursor = None if exhausted else DiscoveryCursor(f"growth:v1:{offset + page_size}", partition="official_growth_sources")
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=exhausted and not reached, scope="source" if exhausted else "partition",
                reason="requested_count_reached" if reached else "all_growth_sources_exhausted" if exhausted else "next_partition_available",
                authoritative=False, next_cursor=next_cursor,
            ),
            operations=sum(len(result.records) for result in results), cost_eur=spent,
            started_at=started, completed_at=observed, warnings=tuple(sorted(set(warnings))),
        )
