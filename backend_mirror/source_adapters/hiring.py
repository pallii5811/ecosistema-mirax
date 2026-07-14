"""Discovery-first hiring adapter with deterministic vacancy verification.

No provider call happens at import time. Paid search is only reachable through
the existing cost governor and is reserved before each query.
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from backend_mirror.agents.hiring_evidence import has_concrete_operational_hiring_evidence
from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain

from .contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceExhaustion,
)


_ATS_HOSTS = (
    "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co",
    "myworkdayjobs.com", "smartrecruiters.com", "teamtailor.com",
    "recruitee.com", "personio.de", "apply.workable.com",
)
_GENERIC_JOB_PATH_RE = re.compile(
    r"^/(?:jobs?|careers?|lavora-con-noi|lavora_con_noi|posizioni(?:-aperte)?|join-us|work-with-us)?/?$",
    re.I,
)
_GENERIC_TITLE_RE = re.compile(r"^(?:jobs?|careers?|lavora con noi|posizioni aperte|opportunit[aà])$", re.I)
_ACTIVE_TERMS_RE = re.compile(
    r"\b(?:candidati|invia (?:la )?candidatura|apply now|submit application|posizione aperta|open position)\b",
    re.I,
)
_LOCATION_RE = re.compile(
    r"\b(?:sede di lavoro|luogo di lavoro|location|workplace)\s*[:\-]\s*([^|;\n]{2,80})",
    re.I,
)
_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/20\d{2})\b")
_ROLE_SIGNAL_PATTERNS = {
    "hiring_sales": re.compile(r"\b(?:sales|commercial[ei]|account|business developer|venditor[ei])\b", re.I),
    "hiring_marketing": re.compile(r"\b(?:marketing|seo|content|social media|advertising|brand)\b", re.I),
    "hiring_technology": re.compile(r"\b(?:developer|software|data engineer|programmat|sistemist|devops|cyber|it technician)\b", re.I),
}
_ESTIMATED_SEARCH_QUERY_EUR = 0.005


@dataclass(frozen=True)
class HiringProviderResult:
    records: Tuple[Mapping[str, Any], ...]
    exhausted: bool
    cost_eur: float = 0.0
    warnings: Tuple[str, ...] = ()


HiringProvider = Callable[[AdapterDiscoveryRequest, int, int], Awaitable[HiringProviderResult]]


def _text(value: Any) -> Optional[str]:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or None


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


def _host(value: Any) -> str:
    text = _text(value) or ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def _is_recognized_ats(host: str) -> bool:
    return any(host == item or host.endswith(f".{item}") for item in _ATS_HOSTS)


def _specific_vacancy_url(value: Any) -> bool:
    text = _text(value)
    if not text:
        return False
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    path = re.sub(r"/+", "/", parsed.path or "/").rstrip("/") or "/"
    return not _GENERIC_JOB_PATH_RE.fullmatch(path)


def _cursor_offset(cursor: Optional[DiscoveryCursor]) -> int:
    if not cursor:
        return 0
    match = re.fullmatch(r"hiring:v1:(\d+)", cursor.value)
    if not match:
        raise ValueError("invalid hiring cursor")
    return int(match.group(1))


def _jsonld_records(html: str, source_url: str) -> List[Dict[str, Any]]:
    from backend_mirror.agents.structured_lanes import extract_jobposting_leads

    return [dict(item) for item in extract_jobposting_leads(html, source_url)]


def parse_hiring_page(html: str, source_url: str) -> List[Dict[str, Any]]:
    """Parse acquired HTML; generic careers pages never become vacancies."""
    structured = _jsonld_records(html, source_url)
    if structured:
        return structured
    if not _specific_vacancy_url(source_url):
        return []
    host = _host(source_url)
    if not host or is_blacklisted_domain(host):
        return []
    soup = BeautifulSoup(html or "", "html.parser")
    blob = _text(soup.get_text(" ", strip=True)) or ""
    heading = soup.find("h1")
    title = _text(heading.get_text(" ", strip=True) if heading else "")
    if not title or _GENERIC_TITLE_RE.fullmatch(title) or not _ACTIVE_TERMS_RE.search(blob):
        return []
    site_meta = soup.find("meta", attrs={"property": "og:site_name"})
    company = _text(site_meta.get("content") if site_meta else "")
    location_match = _LOCATION_RE.search(blob)
    location = _text(location_match.group(1)) if location_match else None
    published = None
    for selector in (
        {"property": "article:published_time"}, {"name": "date"}, {"itemprop": "datePosted"},
    ):
        meta = soup.find("meta", attrs=selector)
        published = _iso_date(meta.get("content") if meta else None)
        if published:
            break
    if not published:
        time_node = soup.find("time")
        published = _iso_date(time_node.get("datetime") if time_node else None)
    if not published:
        match = _DATE_RE.search(blob)
        published = _iso_date(match.group(1)) if match else None
    if not all((company, location, published)):
        return []
    excerpt_match = _ACTIVE_TERMS_RE.search(blob)
    start = max(0, (excerpt_match.start() if excerpt_match else 0) - 120)
    evidence = blob[start:start + 600]
    return [{
        "name": company,
        "website": f"https://{host}",
        "evidence": evidence,
        "matched_signals": ["hiring"],
        "hiring_title": title,
        "evidence_date": published,
        "valid_through": "",
        "location": location,
        "source_url": source_url,
        "source_publisher": host,
        "source_class": "company_careers",
        "extraction_method": "individual_vacancy_page",
        "active": True,
        "description": evidence,
        "employer_is_direct": True,
        "official_domain_verified": True,
        "entity_class": "operating_company",
    }]


async def _default_hiring_provider(
    request: AdapterDiscoveryRequest,
    offset: int,
    limit: int,
) -> HiringProviderResult:
    """Search and fetch evidence pages with a pre-query hard budget guard."""
    import asyncio
    import httpx
    from backend_mirror.agents.search_serp import search_urls_http

    location = next((item for item in request.geographies if item.casefold() not in {"italy", "italia"}), "Italia")
    role = "personale operativo" if "hiring_operational" in request.signal_ids else "personale"
    sector = " ".join(request.sectors)
    queries = (
        f'"{role}" "{location}" ("posizione aperta" OR "candidati")',
        f'"{role}" "{location}" (site:jobs.lever.co OR site:boards.greenhouse.io OR site:myworkdayjobs.com)',
        f'"{role}" "lavora con noi" {sector} {location}'.strip(),
    )
    max_queries = min(len(queries), math.floor((request.budget_eur + 1e-9) / _ESTIMATED_SEARCH_QUERY_EUR))
    if max_queries <= 0:
        return HiringProviderResult((), False, 0.0, ("BUDGET_TOO_LOW_FOR_SEARCH",))
    target_urls = min(100, offset + max(limit * 2, 30))
    urls: List[str] = []
    seen: set[str] = set()
    reserved_cost = 0.0
    scope = hashlib.sha256(f"{request.query}|{request.signal_ids}|{request.geographies}".encode()).hexdigest()[:20]
    for index, query in enumerate(queries[:max_queries]):
        if reserved_cost + _ESTIMATED_SEARCH_QUERY_EUR > request.budget_eur + 1e-9:
            break
        found = await asyncio.to_thread(
            search_urls_http,
            query,
            target_urls,
            cost_scope=f"hiring-adapter:{scope}:{index}",
        )
        reserved_cost += _ESTIMATED_SEARCH_QUERY_EUR
        for url in found:
            key = url.lower().rstrip("/")
            if key not in seen:
                seen.add(key)
                urls.append(url)
    records: List[Mapping[str, Any]] = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Hiring/1.0)", "Accept-Language": "it-IT,it;q=0.9"}
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        for url in urls[offset:offset + limit]:
            try:
                response = await client.get(url)
                if response.status_code != 200 or "html" not in str(response.headers.get("content-type") or "").lower():
                    continue
                records.extend(parse_hiring_page(response.text[:2_000_000], str(response.url)))
            except Exception:
                continue
    exhausted = offset + limit >= len(urls)
    return HiringProviderResult(tuple(records), exhausted, reserved_cost)


def _requires_sme(request: AdapterDiscoveryRequest) -> bool:
    return bool(re.search(r"\b(?:pmi|piccol[ae]|medi[ae]|microimprese?|sme)\b", request.query, re.I))


def _location_matches(record_location: str, geographies: Sequence[str]) -> bool:
    requested = [item.casefold() for item in geographies if item.casefold() not in {"italy", "italia"}]
    if not requested:
        return bool(record_location)
    location = record_location.casefold()
    return any(item in location or location in item for item in requested)


def _validate_record(
    record: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    today: date,
) -> Tuple[bool, str]:
    company = _text(record.get("company_name") or record.get("name"))
    title = _text(record.get("vacancy_title") or record.get("hiring_title"))
    if not company:
        return False, "HIRING_COMPANY_MISSING"
    if not title or _GENERIC_TITLE_RE.fullmatch(title):
        return False, "VACANCY_TITLE_MISSING"
    source_url = _text(record.get("source_url"))
    if not _specific_vacancy_url(source_url):
        return False, "GENERIC_CAREERS_PAGE"
    location = _text(record.get("location")) or ""
    if not location:
        return False, "VACANCY_LOCATION_MISSING"
    if not _location_matches(location, request.geographies):
        return False, "GEOGRAPHY_MISMATCH"
    published = _iso_date(record.get("published_at") or record.get("evidence_date") or record.get("date_posted"))
    if not published:
        return False, "VACANCY_DATE_MISSING"
    age = (today - date.fromisoformat(published)).days
    if age < 0 or (request.freshness_max_age_days is not None and age > request.freshness_max_age_days):
        return False, "VACANCY_STALE"
    valid_through = _iso_date(record.get("valid_through"))
    if valid_through and date.fromisoformat(valid_through) < today:
        return False, "VACANCY_EXPIRED"
    if record.get("active") is not True:
        return False, "VACANCY_NOT_CONFIRMED_ACTIVE"
    evidence = " ".join(filter(None, (
        title, _text(record.get("evidence") or record.get("evidence_excerpt")), _text(record.get("description")),
    )))
    specialized = [signal for signal in request.signal_ids if signal != "hiring" and signal.startswith("hiring_")]
    role_matches = {
        signal: (
            has_concrete_operational_hiring_evidence(evidence)
            if signal == "hiring_operational"
            else bool(_ROLE_SIGNAL_PATTERNS.get(signal) and _ROLE_SIGNAL_PATTERNS[signal].search(evidence))
        )
        for signal in specialized
    }
    if specialized:
        role_ok = any(role_matches.values()) if request.signal_match_mode == "any" else all(role_matches.values())
        if not role_ok:
            return False, "OPERATIONAL_ROLE_UNPROVEN" if specialized == ["hiring_operational"] else "HIRING_ROLE_MISMATCH"
    official_domain = _host(record.get("official_domain") or record.get("website"))
    if not official_domain or is_blacklisted_domain(official_domain):
        return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if record.get("official_domain_verified") is not True:
        return False, "OFFICIAL_DOMAIN_UNVERIFIED"
    source_class = _text(record.get("source_class")) or ""
    if source_class not in {"company_careers", "job_board"}:
        return False, "HIRING_SOURCE_CLASS_INVALID"
    if source_class == "job_board" and record.get("corroborated") is not True:
        return False, "SECONDARY_SOURCE_NOT_CORROBORATED"
    if record.get("employer_is_direct") is not True:
        return False, "DIRECT_EMPLOYER_UNVERIFIED"
    if (_text(record.get("entity_class")) or "operating_company") != "operating_company":
        return False, "NON_OPERATING_ENTITY"
    if _requires_sme(request):
        size = (_text(record.get("company_size")) or "").casefold()
        try:
            employees = int(record.get("employee_count")) if record.get("employee_count") is not None else None
        except (TypeError, ValueError):
            employees = None
        if size in {"enterprise", "large"} or (employees is not None and employees > 249):
            return False, "ENTERPRISE_OUT_OF_TARGET"
        if size not in {"micro", "small", "medium", "sme", "pmi"} and employees is None:
            return False, "SME_STATUS_UNVERIFIED"
    return True, ""


class HiringAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="structured_hiring_v1",
        adapter_version="1.0.0",
        supported_intents=("organic_web_search", "commercial_search", "hiring"),
        supported_signals=("hiring", "hiring_operational", "hiring_sales", "hiring_marketing", "hiring_technology"),
        source_classes=("company_careers", "job_board"),
        geographic_coverage=("global",),
        freshness_max_age_days=1,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=100,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=_ESTIMATED_SEARCH_QUERY_EUR,
        authentication_requirements=("search_provider_with_cost_governor",),
        rate_limit_per_minute=20,
        provenance_guarantees=("company", "vacancy_url", "publisher", "official_domain", "extraction_method"),
        evidence_guarantees=("vacancy_title", "location", "published_at", "active_status", "excerpt"),
        exhaustion_semantics="best_effort",
        coverage_status="supported",
    )

    def __init__(self, providers: Sequence[HiringProvider] = (_default_hiring_provider,)) -> None:
        if not providers:
            raise ValueError("at least one hiring provider is required")
        self._providers = tuple(providers)

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        offset = _cursor_offset(request.cursor)
        per_provider = min(100, max(request.requested_count * 3, 20))
        started = datetime.now(timezone.utc).isoformat()
        provider_results: List[HiringProviderResult] = []
        spent = 0.0
        for provider in self._providers:
            remaining = max(0.0, request.budget_eur - spent)
            bounded_request = AdapterDiscoveryRequest(
                intent=request.intent,
                signal_ids=request.signal_ids,
                signal_match_mode=request.signal_match_mode,
                geographies=request.geographies,
                freshness_max_age_days=request.freshness_max_age_days,
                requested_count=request.requested_count,
                budget_eur=remaining,
                query=request.query,
                sectors=request.sectors,
                technical_filters=request.technical_filters,
                cursor=request.cursor,
            )
            result = await provider(bounded_request, offset, per_provider)
            if result.cost_eur > remaining + 1e-9:
                raise RuntimeError("HIRING_PROVIDER_EXCEEDED_HARD_COST_CAP")
            provider_results.append(result)
            spent += result.cost_eur
        observed = datetime.now(timezone.utc).isoformat()
        candidates: List[OpportunityCandidate] = []
        seen_domains: set[str] = set()
        warnings: List[str] = [item for result in provider_results for item in result.warnings]
        for provider_result in provider_results:
            for record in provider_result.records:
                valid, rejection = _validate_record(record, request, date.today())
                if not valid:
                    warnings.append(rejection)
                    continue
                company = _text(record.get("company_name") or record.get("name")) or ""
                domain = _host(record.get("official_domain") or record.get("website"))
                if domain in seen_domains:
                    warnings.append("DUPLICATE_COMPANY")
                    continue
                seen_domains.add(domain)
                title = _text(record.get("vacancy_title") or record.get("hiring_title")) or ""
                published = _iso_date(record.get("published_at") or record.get("evidence_date") or record.get("date_posted")) or ""
                source_url = _text(record.get("source_url")) or ""
                publisher = _text(record.get("source_publisher")) or _host(source_url)
                source_class = _text(record.get("source_class")) or "company_careers"
                signal_id = next((item for item in request.signal_ids if item.startswith("hiring")), "hiring")
                excerpt = _text(record.get("evidence") or record.get("evidence_excerpt")) or f"{company} cerca {title}"
                confidence = 0.96 if source_class == "company_careers" else 0.86
                evidence = EvidenceRecord(
                    signal_id=signal_id,
                    source_url=source_url,
                    source_publisher=publisher,
                    source_class=source_class,
                    excerpt=excerpt[:1000],
                    observed_at=observed,
                    published_at=published,
                    extraction_method=_text(record.get("extraction_method")) or "structured_hiring_page",
                    confidence=confidence,
                    provenance={
                        "vacancy_title": title,
                        "location": record.get("location"),
                        "valid_through": _iso_date(record.get("valid_through")),
                        "active": True,
                        "employer_is_direct": True,
                        "company_size": record.get("company_size"),
                        "employee_count": record.get("employee_count"),
                    },
                )
                candidates.append(OpportunityCandidate(
                    canonical_company_name=company,
                    company_identifiers={},
                    official_domain=domain,
                    entity_class="operating_company",
                    geographies=(_text(record.get("location")) or "",),
                    buyer_fit=1.0,
                    signal_id=signal_id,
                    signal_date=published,
                    evidence=(evidence,),
                    why_now=f"Vacancy attiva per {title}, pubblicata il {published}",
                    contacts=(),
                    confidence=confidence,
                    contradiction_flags=(),
                    provenance={"adapter_id": self.capability.adapter_id, "vacancy_url": source_url, "publisher": publisher},
                    adapter_id=self.capability.adapter_id,
                    adapter_version=self.capability.adapter_version,
                    official_domain_verified=record.get("official_domain_verified") is True,
                    official_domain_confidence=0.96 if source_class == "company_careers" else 0.86,
                ))
                if len(candidates) >= request.requested_count:
                    break
            if len(candidates) >= request.requested_count:
                break
        target_reached = len(candidates) >= request.requested_count
        all_exhausted = all(result.exhausted for result in provider_results)
        next_cursor = None if all_exhausted else DiscoveryCursor(f"hiring:v1:{offset + per_provider}", partition="hiring_sources")
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=all_exhausted and not target_reached,
                scope="source" if all_exhausted else "partition",
                reason="requested_count_reached" if target_reached else "all_hiring_sources_exhausted" if all_exhausted else "next_partition_available",
                authoritative=False,
                next_cursor=next_cursor,
            ),
            operations=sum(len(result.records) for result in provider_results),
            cost_eur=spent,
            started_at=started,
            completed_at=observed,
            warnings=tuple(sorted(set(warnings))),
        )
