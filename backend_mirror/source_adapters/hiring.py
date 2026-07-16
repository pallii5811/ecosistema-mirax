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

from .hiring_budget import (
    HiringDiscoveryState,
    QUERY_COST_EUR,
    URLS_PER_BATCH,
    encode_discovery_cursor,
    load_discovery_state,
    url_outcomes_map,
)
from .hiring_qualification import (
    QUALIFICATION_VALIDATOR_EPOCH,
    bootstrap_parsed_and_revalidation_queues,
    dedupe_key,
    employer_key_from_record,
    outcome_to_record,
    resolve_employer_identity,
    vacancy_geography_matches,
    vacancy_role_matches_marketing,
    vacancy_role_matches_sales,
)
from .hiring_recruiter import enrich_record_with_recruiter_fields
from .hiring_url_queue import build_processing_batch, PENDING_PROGRESS_BATCH_CAP, should_prefer_pending_over_retry
from .hiring_ats_parsers import (
    bootstrap_legacy_retry_urls,
    build_greenhouse_api_url,
    build_teamtailor_json_url,
    build_workday_cxs_url,
    classify_failure_for_retry,
    detect_ats_vendor,
    parse_vacancy_html,
)

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
    "hiring_sales": re.compile(
        r"\b(?:sales|commercial[ei]|account(?:\s+executive|\s+manager)?|business developer|"
        r"venditor[ei]|area manager|\bsdr\b|\bbdr\b)\b",
        re.I,
    ),
    "hiring_marketing": re.compile(r"\b(?:marketing|seo|content|social media|advertising|brand|performance marketer)\b", re.I),
    "hiring_technology": re.compile(r"\b(?:developer|software|data engineer|programmat|sistemist|devops|cyber|it technician)\b", re.I),
}
_HIRING_SALES_ROLE_TERMS = (
    "commerciale", "sales manager", "business developer", "account executive",
    "account manager", "area manager", "SDR", "BDR",
)
_HIRING_MARKETING_ROLE_TERMS = (
    "marketing manager",
    "digital marketing manager",
    "digital marketing specialist",
    "growth manager",
    "growth marketing manager",
    "performance marketing specialist",
    "performance marketing manager",
    "social media manager",
    "brand manager",
    "product marketing manager",
)
_LOMBARDIA_GEO_TERMS = (
    "Lombardia", "Milano", "Bergamo", "Brescia", "Monza", "Brianza", "Varese", "Como",
    "Lecco", "Pavia", "Cremona", "Mantova", "Lodi", "Sondrio",
)
_LOMBARDIA_LOCATION_ALIASES = frozenset({
    "lombardia", "lombardy", "milano", "milan", "bergamo", "brescia", "monza", "brianza",
    "varese", "como", "lecco", "pavia", "cremona", "mantova", "lodi", "sondrio",
    "sesto san giovanni", "rho", "legnano", "desio", "vimercate", "lissone",
})
_REGION_LOCATION_ALIASES = {
    "lombardia": _LOMBARDIA_LOCATION_ALIASES,
    "lombardy": _LOMBARDIA_LOCATION_ALIASES,
}
_RECRUITER_NAME_RE = re.compile(
    r"\b(?:agenzia di selezione|headhunter|recruiter|staffing|consulting group|human resources agency)\b",
    re.I,
)
_ANONYMOUS_EMPLOYER_RE = re.compile(r"\b(?:confidential|anonim[oa]|azienda riservata|employer hidden)\b", re.I)
_CAREERS_SUBDOMAIN_PREFIXES = frozenset({"careers", "jobs", "job", "lavora", "work", "join", "recruiting"})
_ESTIMATED_SEARCH_QUERY_EUR = 0.005


@dataclass(frozen=True)
class HiringProviderResult:
    records: Tuple[Mapping[str, Any], ...]
    exhausted: bool
    cost_eur: float = 0.0
    warnings: Tuple[str, ...] = ()
    url_traces: Tuple[Mapping[str, Any], ...] = ()
    discovery_state: Optional[HiringDiscoveryState] = None
    urls_processed: int = 0
    urls_discovered_total: int = 0


def _build_hiring_discovery_queries(request: AdapterDiscoveryRequest) -> List[Tuple[str, str, str]]:
    """Return (query_key, query, source_label) in progressive high-yield order."""
    if "hiring_sales" in request.signal_ids:
        roles = _HIRING_SALES_ROLE_TERMS
    elif "hiring_marketing" in request.signal_ids:
        roles = _HIRING_MARKETING_ROLE_TERMS
    elif "hiring_technology" in request.signal_ids:
        roles = ("developer", "software engineer", "data engineer", "devops")
    elif "hiring_operational" in request.signal_ids:
        roles = ("operaio", "tecnico", "magazziniere", "autista")
    else:
        roles = ("personale", "posizione")
    priority_geos = list(_LOMBARDIA_GEO_TERMS) if any(
        geo.casefold() in {"lombardia", "lombardy"} for geo in request.geographies
    ) else [item for item in request.geographies if item.casefold() not in {"italy", "italia"}] or ["Italia"]
    sector = " ".join(request.sectors)
    pairs: List[Tuple[str, str, str]] = []
    for role in roles:
        for geo in priority_geos:
            for template, source in (
                (f'"{role}" "{geo}" ("posizione aperta" OR candidati OR apply)', "serp:local_vacancy"),
                (f'"{role}" "{geo}" (site:jobs.lever.co OR site:boards.greenhouse.io OR site:myworkdayjobs.com)', "serp:ats"),
                (f'"{role}" "lavora con noi" {sector} {geo}'.strip(), "serp:careers"),
            ):
                key = f"{source}:{role}:{geo}:{template}"
                pairs.append((key, template, source))
    return pairs


def _trace_url(
    *,
    url: str,
    query: str,
    query_source: str,
    record: Optional[Mapping[str, Any]] = None,
    rejection: str = "",
) -> Dict[str, Any]:
    trace: Dict[str, Any] = {
        "url": url,
        "query": query,
        "query_source": query_source,
        "rejection_code": _normalize_rejection_code(rejection or "FETCH_OR_PARSE_EMPTY"),
        "rejection_function": "_validate_record" if rejection else "parse_hiring_page",
    }
    if record:
        trace.update({
            "title": _text(record.get("vacancy_title") or record.get("hiring_title")),
            "employer": _text(record.get("company_name") or record.get("name")),
            "role": _text(record.get("vacancy_title") or record.get("hiring_title")),
            "location": _text(record.get("location")),
            "publication_date": _iso_date(record.get("published_at") or record.get("evidence_date") or record.get("date_posted")),
            "vacancy_active": record.get("active") is True,
            "employer_direct": record.get("employer_is_direct") is True,
            "ats_domain": _text(record.get("vacancy_source_domain")),
            "employer_official_domain": _text(record.get("employer_official_domain")),
            "source": _text(record.get("source_class")),
            "rejection_code": _normalize_rejection_code(rejection or "ACCEPTED"),
            "rejection_function": "_validate_record",
        })
    return trace


HiringProvider = Callable[[AdapterDiscoveryRequest, HiringDiscoveryState, int], Awaitable[HiringProviderResult]]


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


def parse_hiring_page(
    html: str,
    source_url: str,
    *,
    structured_json: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Parse acquired HTML/JSON into vacancy records."""
    parsed = parse_vacancy_html(html, source_url, structured_json=structured_json)
    if parsed.records:
        return [dict(item) for item in parsed.records]
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


def _governor_committed_eur() -> float:
    try:
        from cost_context import current_cost_governor

        governor = current_cost_governor()
        if governor is None:
            return 0.0
        return governor.committed_micro_eur / 1_000_000
    except Exception:
        return 0.0


def _normalize_rejection_code(code: str) -> str:
    mapping = {
        "GENERIC_CAREERS_PAGE": "NOT_INDIVIDUAL_VACANCY",
        "VACANCY_TITLE_MISSING": "NOT_INDIVIDUAL_VACANCY",
        "LISTING_PAGE": "LISTING_PAGE",
        "HIRING_ROLE_MISMATCH": "ROLE_MISMATCH",
        "OPERATIONAL_ROLE_UNPROVEN": "ROLE_MISMATCH",
        "VACANCY_STALE": "STALE_VACANCY",
        "VACANCY_EXPIRED": "STALE_VACANCY",
        "OFFICIAL_DOMAIN_UNVERIFIED": "OFFICIAL_DOMAIN_UNRESOLVED",
        "HIRING_COMPANY_MISSING": "EMPLOYER_UNRESOLVED",
        "DIRECT_EMPLOYER_UNVERIFIED": "EMPLOYER_UNRESOLVED",
        "RECRUITER_WITHOUT_EMPLOYER": "RECRUITER_FINAL_EMPLOYER_UNRESOLVED",
        "FETCH_FAILED": "FETCH_HTTP_ERROR",
        "FETCH_EXCEPTION": "FETCH_TIMEOUT",
        "PARSE_EMPTY": "PARSE_FAILED",
        "FETCH_OR_PARSE_EMPTY": "PARSE_FAILED",
        "AGGREGATOR_WITHOUT_EMPLOYER": "AGGREGATOR_WITHOUT_EMPLOYER",
    }
    return mapping.get(code, code or "PARSE_FAILED")


async def _fetch_ats_structured_json(
    client: Any,
    url: str,
    html: str,
) -> Tuple[Optional[Mapping[str, Any]], Dict[str, Any]]:
    import asyncio

    from .hiring_ats_parsers import inspect_workday_url

    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; MIRAX-Hiring/1.0)",
    }
    candidates: List[str] = []
    vendor = detect_ats_vendor(url)
    forensic: Dict[str, Any] = {"ats_vendor": vendor, "cxs_attempts": []}
    if vendor == "workday":
        meta = inspect_workday_url(url, html)
        forensic.update(meta)
        api = build_workday_cxs_url(url, html)
        if api:
            candidates.append(api)
            forensic["cxs_url"] = api
        else:
            forensic["cxs_failure_code"] = "WORKDAY_CXS_URL_UNRESOLVED"
    elif vendor == "teamtailor":
        api = build_teamtailor_json_url(url)
        if api:
            candidates.append(api)
    elif vendor == "greenhouse":
        api = build_greenhouse_api_url(url)
        if api:
            candidates.append(api)
    for api in candidates:
        attempt: Dict[str, Any] = {"cxs_url": api}
        try:
            response = await asyncio.wait_for(client.get(api, headers=headers), timeout=10.0)
            attempt["http_status"] = response.status_code
            attempt["content_type"] = str(response.headers.get("content-type") or "")
            attempt["response_bytes"] = len(response.content or b"")
            attempt["final_url"] = str(response.url)
            forensic["cxs_attempts"].append(attempt)
            forensic["cxs_http_status"] = response.status_code
            forensic["cxs_content_type"] = attempt["content_type"]
            forensic["cxs_response_bytes"] = attempt["response_bytes"]
            forensic["cxs_final_url"] = attempt["final_url"]
            if response.status_code == 404:
                forensic["cxs_failure_code"] = "WORKDAY_CXS_HTTP_404"
                continue
            if response.status_code == 403:
                forensic["cxs_failure_code"] = "WORKDAY_CXS_HTTP_403"
                continue
            if response.status_code != 200:
                forensic["cxs_failure_code"] = f"WORKDAY_CXS_HTTP_{response.status_code}"
                continue
            content_type = attempt["content_type"].lower()
            if "json" not in content_type:
                forensic["cxs_failure_code"] = "WORKDAY_CXS_NOT_JSON"
                forensic["json_parse_result"] = "not_json_content_type"
                continue
            payload = response.json()
            if isinstance(payload, Mapping):
                forensic["json_parse_result"] = "ok"
                forensic.pop("cxs_failure_code", None)
                return payload, forensic
            forensic["cxs_failure_code"] = "WORKDAY_CXS_NOT_JSON"
            forensic["json_parse_result"] = "non_object_json"
        except Exception as exc:
            attempt["error"] = exc.__class__.__name__
            forensic["cxs_attempts"].append(attempt)
            forensic["cxs_failure_code"] = "WORKDAY_CXS_FETCH_ERROR"
            forensic["json_parse_result"] = "exception"
            continue
    if vendor == "workday" and candidates and "cxs_failure_code" not in forensic:
        forensic["cxs_failure_code"] = "WORKDAY_CXS_EMPTY"
    return None, forensic


def _workday_parse_failure_code(forensic: Mapping[str, Any], parsed_failure: str) -> str:
    code = str(forensic.get("cxs_failure_code") or "").strip()
    if code:
        return code
    if parsed_failure == "JAVASCRIPT_SHELL":
        return "JAVASCRIPT_SHELL"
    return parsed_failure or "JSONLD_JOBPOSTING_MISSING"

def _append_url_outcome(state: HiringDiscoveryState, outcome: Mapping[str, Any]) -> None:
    canonical = str(outcome.get("canonical_url") or outcome.get("url") or "").lower().rstrip("/")
    if not canonical:
        return
    rows = [dict(item) for item in state.url_outcomes if isinstance(item, Mapping)]
    for index, item in enumerate(rows):
        key = str(item.get("canonical_url") or item.get("url") or "").lower().rstrip("/")
        if key == canonical:
            rows[index] = dict(outcome)
            state.url_outcomes = tuple(rows)
            return
    rows.append(dict(outcome))
    state.url_outcomes = tuple(rows)


def _update_revalidation_queue(state: HiringDiscoveryState, url: str) -> None:
    canonical = url.lower().rstrip("/")
    state.revalidation_queue = tuple(
        item for item in state.revalidation_queue if item.lower().rstrip("/") != canonical
    )


def _revalidate_from_outcome(
    state: HiringDiscoveryState,
    *,
    url: str,
    base_outcome: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    outcomes_by_url: Mapping[str, Mapping[str, Any]],
) -> Tuple[Optional[Mapping[str, Any]], str, str]:
    canonical = url.lower().rstrip("/")
    prior = outcomes_by_url.get(canonical) or {}
    merged = {**dict(prior), **dict(base_outcome)}
    record = resolve_employer_identity(enrich_record_with_recruiter_fields(outcome_to_record(merged)))
    valid, rejection = _validate_record(record, request, date.today())
    normalized = _normalize_rejection_code(rejection)
    _append_url_outcome(state, {
        **merged,
        "vacancy_title": record.get("vacancy_title") or record.get("hiring_title"),
        "employer": record.get("company_name") or record.get("name"),
        "location": record.get("location"),
        "publication_date": record.get("published_at") or record.get("evidence_date"),
        "employer_official_domain": record.get("employer_official_domain"),
        "validation_result": "accepted" if valid else normalized,
        "rejection_code": "ACCEPTED" if valid else normalized,
        "url_state": "accepted" if valid else "rejected_final",
        "parser_result": "success",
        "revalidation": True,
    })
    _update_revalidation_queue(state, url)
    return (record if valid else None, normalized, "accepted" if valid else normalized)


def _update_retry_queue(state: HiringDiscoveryState, url: str, rejection_code: str, *, is_retry: bool) -> None:
    canonical = url.lower().rstrip("/")
    retry = [item for item in state.retry_urls if item.lower().rstrip("/") != canonical]
    if rejection_code == "ACCEPTED" or not classify_failure_for_retry(rejection_code):
        state.retry_urls = tuple(retry)
        return
    retry.insert(0, url)
    state.retry_urls = tuple(dict.fromkeys(retry))


def _url_query_meta_from_state(state: HiringDiscoveryState) -> Dict[str, Tuple[str, str]]:
    meta: Dict[str, Tuple[str, str]] = {}
    for item in state.url_meta:
        if not isinstance(item, Mapping):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        meta[url] = (
            str(item.get("query") or ""),
            str(item.get("query_source") or "unknown"),
        )
    return meta


def _merge_url_meta(
    existing: Sequence[Mapping[str, Any]],
    urls: Sequence[str],
    url_query_meta: Mapping[str, Tuple[str, str]],
) -> Tuple[Mapping[str, Any], ...]:
    by_url = {str(item.get("url") or ""): dict(item) for item in existing if isinstance(item, Mapping)}
    merged: list[Mapping[str, Any]] = []
    for url in urls:
        query, query_source = url_query_meta.get(url, ("", "unknown"))
        row = dict(by_url.get(url) or {})
        row.update({"url": url, "query": query, "query_source": query_source})
        merged.append(row)
    return tuple(merged)


def _processed_employer_keys(request: AdapterDiscoveryRequest) -> set[str]:
    return {
        str(item).strip()
        for item in (request.technical_filters.get("processed_employer_keys") or ())
        if str(item or "").strip()
    }


def _new_unique_target_reached(new_unique_employer_keys: set[str], request: AdapterDiscoveryRequest) -> bool:
    return len(new_unique_employer_keys) >= request.requested_count


def _register_unique_employer_record(
    record: Mapping[str, Any],
    *,
    processed_employer_keys: set[str],
    new_unique_employer_keys: set[str],
) -> Tuple[bool, str]:
    employer_key = employer_key_from_record(record)
    if employer_key and (employer_key in processed_employer_keys or employer_key in new_unique_employer_keys):
        return False, "DUPLICATE_EMPLOYER_OPPORTUNITY"
    if employer_key:
        new_unique_employer_keys.add(employer_key)
    return True, ""


async def _default_hiring_provider(
    request: AdapterDiscoveryRequest,
    state: HiringDiscoveryState,
    limit: int,
) -> HiringProviderResult:
    """Search and fetch evidence pages with batched discovery budget."""
    import asyncio
    import httpx
    from backend_mirror.agents.search_serp import search_urls_http

    before_cost = _governor_committed_eur()
    query_pairs = _build_hiring_discovery_queries(request)
    executed = set(state.executed_query_keys)
    zero_yield = set(state.zero_yield_sources)
    pending_queries = [
        item for item in query_pairs
        if item[0] not in executed and item[2] not in zero_yield
    ][state.query_index:]
    discovery_locked = state.discovery_locked()
    discovery_budget = min(state.discovery_remaining_eur(), max(0.0, request.budget_eur))
    max_queries = 0 if discovery_locked else min(
        state.max_queries_this_batch(),
        int(math.floor(discovery_budget / QUERY_COST_EUR)),
    )
    urls: List[str] = list(state.seen_urls)
    seen = set(urls)
    url_query_meta = _url_query_meta_from_state(state)
    query_stats: List[Dict[str, Any]] = list(state.query_stats)
    scope = hashlib.sha256(f"{request.query}|{request.signal_ids}|{request.geographies}".encode()).hexdigest()[:20]
    queries_run = 0
    if max_queries > 0 and pending_queries:
        for query_key, query, query_source in pending_queries[:max_queries]:
            if state.discovery_remaining_eur() + 1e-9 < QUERY_COST_EUR:
                break
            found = await asyncio.to_thread(
                search_urls_http,
                query,
                min(30, max(10, limit)),
                cost_scope=f"hiring-adapter:{scope}:{query_key}",
            )
            queries_run += 1
            state.query_index += 1
            executed.add(query_key)
            new_urls = 0
            for url in found:
                key = url.lower().rstrip("/")
                if key not in seen:
                    seen.add(key)
                    urls.append(key)
                    url_query_meta[key] = (query, query_source)
                    new_urls += 1
            query_stats.append({
                "query_key": query_key,
                "query": query,
                "query_source": query_source,
                "results_returned": len(found),
                "urls_new": new_urls,
                "cost_eur": QUERY_COST_EUR,
            })
            if new_urls == 0:
                zero_yield.add(query_source)
    state.executed_query_keys = tuple(sorted(executed))
    state.seen_urls = tuple(urls)
    state.url_meta = _merge_url_meta(state.url_meta, urls, url_query_meta)
    state.zero_yield_sources = tuple(sorted(zero_yield))
    state.query_stats = tuple(query_stats)
    state.discovery_spent_eur = round(state.discovery_spent_eur + queries_run * QUERY_COST_EUR, 6)

    if state.parser_epoch < 2:
        boot = bootstrap_legacy_retry_urls(
            state.seen_urls,
            state.url_offset,
            parser_epoch=state.parser_epoch,
            url_outcomes=url_outcomes_map(state),
        )
        if boot:
            state.retry_urls = tuple(dict.fromkeys([*state.retry_urls, *boot]))
        state.parser_epoch = 2

    if state.qualification_validator_epoch < QUALIFICATION_VALIDATOR_EPOCH:
        parsed_queue, reval_queue = bootstrap_parsed_and_revalidation_queues(
            state.url_outcomes,
            qualification_validator_epoch=state.qualification_validator_epoch,
        )
        if parsed_queue:
            state.parsed_candidate_queue = tuple(dict.fromkeys([*state.parsed_candidate_queue, *parsed_queue]))
        if reval_queue:
            state.revalidation_queue = tuple(dict.fromkeys([*state.revalidation_queue, *reval_queue]))
        state.qualification_validator_epoch = QUALIFICATION_VALIDATOR_EPOCH

    discovery_offset = state.discovery_url_offset or state.url_offset
    state.discovery_url_offset = discovery_offset
    prefer_pending = should_prefer_pending_over_retry(
        revalidation_urls=state.revalidation_queue,
        discovery_offset=discovery_offset,
        total_urls=len(urls),
    )
    queue_pending = discovery_offset < len(urls) or bool(state.retry_urls) or bool(state.revalidation_queue)
    if not queue_pending and queries_run == 0:
        exhausted = discovery_locked and state.query_index >= len(query_pairs)
        return HiringProviderResult(
            (), exhausted, 0.0, ("DISCOVERY_BUDGET_EXHAUSTED",) if discovery_locked else (), (), state, 0, len(urls),
        )

    records: List[Mapping[str, Any]] = []
    traces: List[Dict[str, Any]] = []
    prefetch_traces = list(state.prefetch_traces)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Hiring/1.0)", "Accept-Language": "it-IT,it;q=0.9"}
    processed_employer_keys = _processed_employer_keys(request)
    new_unique_employer_keys: set[str] = set()
    batch_cap = min(
        limit,
        PENDING_PROGRESS_BATCH_CAP if prefer_pending else URLS_PER_BATCH,
        max(queue_pending, len(state.retry_urls) + len(state.revalidation_queue)),
    )
    priority_queue = build_processing_batch(
        urls,
        url_query_meta,
        retry_urls=state.retry_urls,
        revalidation_urls=state.revalidation_queue,
        start_offset=discovery_offset,
        batch_cap=batch_cap,
        prefer_pending_over_retry=prefer_pending,
    )
    domain_active: Dict[str, int] = {}
    urls_processed = 0
    outcomes_by_url = url_outcomes_map(state)

    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        for item in priority_queue:
            url = str(item.get("url") or "")
            if not url:
                continue
            is_retry = bool(item.get("is_retry"))
            is_revalidation = bool(item.get("is_revalidation"))
            prefetch_traces.append(dict(item))
            canonical = url.lower().rstrip("/")
            base_outcome: Dict[str, Any] = {
                "url": url,
                "canonical_url": canonical,
                "source_domain": item.get("source_domain"),
                "source_class": item.get("source_class"),
                "priority": item.get("priority"),
                "ats_vendor": detect_ats_vendor(url),
            }
            if is_revalidation:
                record, rejection, _ = _revalidate_from_outcome(
                    state,
                    url=url,
                    base_outcome=base_outcome,
                    request=request,
                    outcomes_by_url=outcomes_by_url,
                )
                traces.append({
                    **base_outcome,
                    "revalidation": True,
                    "rejection_code": rejection,
                    "url_state": "accepted" if record else "rejected_final",
                })
                if record:
                    accepted, duplicate_reason = _register_unique_employer_record(
                        record,
                        processed_employer_keys=processed_employer_keys,
                        new_unique_employer_keys=new_unique_employer_keys,
                    )
                    if accepted:
                        records.append(record)
                    else:
                        traces.append({
                            **base_outcome,
                            "revalidation": True,
                            "rejection_code": duplicate_reason,
                            "url_state": "duplicate_employer",
                        })
                urls_processed += 1
                if _new_unique_target_reached(new_unique_employer_keys, request):
                    break
                continue
            if not item.get("prefetch_accept"):
                rejection = _normalize_rejection_code(str(item.get("rejection_code") or "NOT_INDIVIDUAL_VACANCY"))
                traces.append({
                    **base_outcome,
                    "query": item.get("query") or "",
                    "query_source": item.get("query_source") or "unknown",
                    "rejection_code": rejection,
                    "rejection_function": "classify_url_prefetch",
                    "prefetch_accept": False,
                    "url_state": "rejected_final",
                })
                _append_url_outcome(state, {**base_outcome, "rejection_code": rejection, "url_state": "rejected_final"})
                if not is_retry:
                    _advance_discovery_offset(state)
                else:
                    _update_retry_queue(state, url, rejection, is_retry=True)
                urls_processed += 1
                continue
            host = str(item.get("source_domain") or _host(url))
            if domain_active.get(host, 0) >= 2:
                rejection = "FETCH_TIMEOUT"
                traces.append({**base_outcome, "rejection_code": rejection, "rejection_function": "domain_rate_limit", "url_state": "retryable_parser_failure"})
                _append_url_outcome(state, {**base_outcome, "rejection_code": rejection, "url_state": "retryable_parser_failure"})
                _update_retry_queue(state, url, rejection, is_retry=is_retry)
                if not is_retry:
                    _advance_discovery_offset(state)
                urls_processed += 1
                continue
            domain_active[host] = domain_active.get(host, 0) + 1
            query = str(item.get("query") or "")
            query_source = str(item.get("query_source") or "unknown")
            try:
                response = await asyncio.wait_for(client.get(url), timeout=12.0)
                base_outcome.update({
                    "http_status": response.status_code,
                    "content_type": str(response.headers.get("content-type") or ""),
                    "response_bytes": len(response.content or b""),
                    "final_url": str(response.url),
                })
                if response.status_code != 200:
                    rejection = "FETCH_HTTP_ERROR"
                    traces.append(_trace_url(url=url, query=query, query_source=query_source, rejection=rejection))
                    _append_url_outcome(state, {**base_outcome, "rejection_code": rejection, "url_state": "retryable_parser_failure", "fetch_success": False})
                    _update_retry_queue(state, url, rejection, is_retry=is_retry)
                    if not is_retry:
                        _advance_discovery_offset(state)
                    urls_processed += 1
                    continue
                html = response.text[:2_000_000]
                structured_json, cxs_forensic = await _fetch_ats_structured_json(client, url, html)
                base_outcome.update({k: v for k, v in cxs_forensic.items() if k != "cxs_attempts"})
                if cxs_forensic.get("cxs_attempts"):
                    base_outcome["cxs_attempts"] = list(cxs_forensic["cxs_attempts"])
                parsed_result = parse_vacancy_html(html, str(response.url), structured_json=structured_json)
                base_outcome.update({
                    "fetch_success": True,
                    "javascript_shell": parsed_result.javascript_shell,
                    "jsonld_jobposting_count": parsed_result.jsonld_count,
                    "parser_selected": parsed_result.parser_id,
                    "cxs_used": bool(structured_json),
                })
                parsed = [resolve_employer_identity(enrich_record_with_recruiter_fields(row)) for row in parsed_result.records]
                if not parsed:
                    rejection = _normalize_rejection_code(
                        _workday_parse_failure_code(cxs_forensic, parsed_result.failure_code or "PARSE_FAILED")
                        if detect_ats_vendor(url) == "workday"
                        else (parsed_result.failure_code or "PARSE_FAILED")
                    )
                    traces.append(_trace_url(url=url, query=query, query_source=query_source, rejection=rejection))
                    _append_url_outcome(state, {
                        **base_outcome,
                        "rejection_code": rejection,
                        "url_state": "retryable_parser_failure" if classify_failure_for_retry(rejection) else "rejected_final",
                        "parser_result": "empty",
                        "failure_code": rejection,
                    })
                    _update_retry_queue(state, url, rejection, is_retry=is_retry)
                    if not is_retry:
                        _advance_discovery_offset(state)
                    urls_processed += 1
                    continue
                url_accepted = False
                for record in parsed:
                    valid, rejection = _validate_record(record, request, date.today())
                    normalized = _normalize_rejection_code(rejection)
                    traces.append(_trace_url(
                        url=url, query=query, query_source=query_source, record=record, rejection=normalized,
                    ))
                    _append_url_outcome(state, {
                        **base_outcome,
                        "vacancy_title": record.get("vacancy_title") or record.get("hiring_title"),
                        "employer": record.get("company_name") or record.get("name"),
                        "location": record.get("location"),
                        "publication_date": record.get("published_at") or record.get("evidence_date"),
                        "validation_result": "accepted" if valid else normalized,
                        "rejection_code": "ACCEPTED" if valid else normalized,
                        "url_state": "accepted" if valid else ("rejected_final" if not classify_failure_for_retry(normalized) else "retryable_parser_failure"),
                        "parser_result": "success",
                    })
                    if valid:
                        unique_ok, duplicate_reason = _register_unique_employer_record(
                            record,
                            processed_employer_keys=processed_employer_keys,
                            new_unique_employer_keys=new_unique_employer_keys,
                        )
                        if unique_ok:
                            records.append(record)
                            url_accepted = True
                        else:
                            traces.append(_trace_url(
                                url=url, query=query, query_source=query_source, record=record, rejection=duplicate_reason,
                            ))
                            _append_url_outcome(state, {
                                **base_outcome,
                                "vacancy_title": record.get("vacancy_title") or record.get("hiring_title"),
                                "employer": record.get("company_name") or record.get("name"),
                                "location": record.get("location"),
                                "validation_result": duplicate_reason,
                                "rejection_code": duplicate_reason,
                                "url_state": "duplicate_employer",
                                "parser_result": "success",
                            })
                        if _new_unique_target_reached(new_unique_employer_keys, request):
                            break
                    elif not classify_failure_for_retry(normalized):
                        _update_retry_queue(state, url, normalized, is_retry=is_retry)
                if not url_accepted:
                    last_code = str(traces[-1].get("rejection_code") or "PARSE_FAILED") if traces else "PARSE_FAILED"
                    _update_retry_queue(state, url, last_code, is_retry=is_retry)
            except asyncio.TimeoutError:
                rejection = "FETCH_TIMEOUT"
                traces.append(_trace_url(url=url, query=query, query_source=query_source, rejection=rejection))
                _append_url_outcome(state, {**base_outcome, "rejection_code": rejection, "url_state": "retryable_parser_failure", "fetch_success": False})
                _update_retry_queue(state, url, rejection, is_retry=is_retry)
            except Exception:
                rejection = "FETCH_BLOCKED"
                traces.append(_trace_url(url=url, query=query, query_source=query_source, rejection=rejection))
                _append_url_outcome(state, {**base_outcome, "rejection_code": rejection, "url_state": "retryable_parser_failure", "fetch_success": False})
                _update_retry_queue(state, url, rejection, is_retry=is_retry)
            if not is_retry:
                _advance_discovery_offset(state)
            elif traces and traces[-1].get("rejection_code") == "ACCEPTED":
                _update_retry_queue(state, url, "ACCEPTED", is_retry=True)
            urls_processed += 1
            if _new_unique_target_reached(new_unique_employer_keys, request):
                break

    state.prefetch_traces = tuple(prefetch_traces)
    after_cost = _governor_committed_eur()
    actual_cost = max(0.0, round(after_cost - before_cost, 6))
    if actual_cost <= 0 and queries_run:
        actual_cost = round(queries_run * QUERY_COST_EUR, 6)
    exhausted = (
        (state.discovery_url_offset or state.url_offset) >= len(urls)
        and not state.retry_urls
        and not state.revalidation_queue
        and (discovery_locked or state.query_index >= len(query_pairs))
    )
    return HiringProviderResult(
        tuple(records),
        exhausted,
        actual_cost,
        (("QUEUE_ONLY",) if discovery_locked and queries_run == 0 else ()),
        tuple(traces),
        state,
        urls_processed,
        len(urls),
    )


def _requires_sme(request: AdapterDiscoveryRequest) -> bool:
    return bool(re.search(r"\b(?:pmi|piccol[ae]|medi[ae]|microimprese?|sme)\b", request.query, re.I))


def _advance_discovery_offset(state: HiringDiscoveryState) -> None:
    state.url_offset += 1
    state.discovery_url_offset = state.url_offset


def _location_matches(record_location: str, geographies: Sequence[str]) -> bool:
    requested = [item.casefold() for item in geographies if item.casefold() not in {"italy", "italia"}]
    if not requested:
        return bool(record_location)
    location = record_location.casefold()
    for item in requested:
        if item in location or location in item:
            return True
        aliases = _REGION_LOCATION_ALIASES.get(item)
        if aliases and any(alias in location for alias in aliases):
            return True
    return False


def _employer_official_domain(record: Mapping[str, Any]) -> str:
    return _host(
        record.get("employer_official_domain")
        or record.get("official_domain")
        or record.get("website")
    )


def _validate_record(
    record: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    today: date,
) -> Tuple[bool, str]:
    company = _text(record.get("company_name") or record.get("name"))
    title = _text(record.get("vacancy_title") or record.get("hiring_title"))
    if not company or _ANONYMOUS_EMPLOYER_RE.search(company):
        return False, "HIRING_COMPANY_MISSING"
    if str(record.get("rejection_code") or "") == "RECRUITER_FINAL_EMPLOYER_UNRESOLVED":
        return False, "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
    if record.get("employer_is_recruiter") is True and record.get("hiring_for_self") is not True:
        if not _host(record.get("final_employer_domain")):
            return False, "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
    if _RECRUITER_NAME_RE.search(company) and record.get("employer_is_direct") is not True:
        return False, "RECRUITER_WITHOUT_EMPLOYER"
    if not title or _GENERIC_TITLE_RE.fullmatch(title):
        return False, "VACANCY_TITLE_MISSING"
    source_url = _text(record.get("source_url"))
    if not _specific_vacancy_url(source_url):
        return False, "GENERIC_CAREERS_PAGE"
    location = _text(record.get("location")) or ""
    if not location and not title:
        return False, "VACANCY_LOCATION_MISSING"
    if not vacancy_geography_matches(
        location=location,
        title=title,
        address_locality=_text(record.get("address_locality")),
        address_region=_text(record.get("address_region")),
        geographies=request.geographies,
    ):
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
    if specialized:
        if "hiring_sales" in specialized:
            role_ok, role_code = vacancy_role_matches_sales(
                title=title,
                description=_text(record.get("description") or record.get("evidence")),
            )
            if not role_ok:
                return False, role_code or "HIRING_ROLE_MISMATCH"
        elif "hiring_marketing" in specialized:
            role_ok, role_code = vacancy_role_matches_marketing(
                title=title,
                description=_text(record.get("description") or record.get("evidence")),
                structured_role=_text(record.get("occupational_category") or record.get("role_category")),
            )
            if not role_ok:
                return False, role_code or "HIRING_ROLE_MISMATCH"
        else:
            role_matches = {
                signal: (
                    has_concrete_operational_hiring_evidence(evidence)
                    if signal == "hiring_operational"
                    else bool(_ROLE_SIGNAL_PATTERNS.get(signal) and _ROLE_SIGNAL_PATTERNS[signal].search(evidence))
                )
                for signal in specialized
            }
            role_ok = any(role_matches.values()) if request.signal_match_mode == "any" else all(role_matches.values())
            if not role_ok:
                return False, "OPERATIONAL_ROLE_UNPROVEN" if specialized == ["hiring_operational"] else "HIRING_ROLE_MISMATCH"
    official_domain = _employer_official_domain(record)
    vacancy_source_domain = _host(record.get("vacancy_source_domain") or record.get("source_url"))
    if not official_domain or is_blacklisted_domain(official_domain):
        return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if vacancy_source_domain and official_domain == vacancy_source_domain:
        host_parts = vacancy_source_domain.split(".")
        if len(host_parts) >= 3 and host_parts[0] in _CAREERS_SUBDOMAIN_PREFIXES:
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
        discovery_state = load_discovery_state(request.cursor, request.technical_filters)
        per_provider = min(100, max(request.requested_count * 3, 20))
        started = datetime.now(timezone.utc).isoformat()
        provider_results: List[HiringProviderResult] = []
        spent = 0.0
        url_traces: List[Mapping[str, Any]] = []
        urls_processed_total = 0
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
                technical_filters={
                    **request.technical_filters,
                    "hiring_discovery": discovery_state.to_dict(),
                },
                cursor=request.cursor,
            )
            result = await provider(bounded_request, discovery_state, per_provider)
            if result.discovery_state is not None:
                discovery_state = result.discovery_state
            if result.cost_eur > remaining + 1e-9:
                raise RuntimeError("HIRING_PROVIDER_EXCEEDED_HARD_COST_CAP")
            provider_results.append(result)
            spent += result.cost_eur
            urls_processed_total += int(result.urls_processed or 0)
            url_traces.extend(result.url_traces)
        observed = datetime.now(timezone.utc).isoformat()
        candidates: List[OpportunityCandidate] = []
        seen_dedupe: set[str] = set()
        processed_employer_keys = _processed_employer_keys(request)
        new_unique_employer_keys: set[str] = set()
        warnings: List[str] = [item for result in provider_results for item in result.warnings]
        for provider_result in provider_results:
            for record in provider_result.records:
                record = resolve_employer_identity(enrich_record_with_recruiter_fields(record))
                valid, rejection = _validate_record(record, request, date.today())
                if not valid:
                    warnings.append(rejection)
                    continue
                company = _text(record.get("company_name") or record.get("name")) or ""
                domain = _employer_official_domain(record)
                dedupe = dedupe_key(record)
                if dedupe in seen_dedupe:
                    warnings.append("DUPLICATE_VACANCY")
                    continue
                seen_dedupe.add(dedupe)
                accepted, duplicate_reason = _register_unique_employer_record(
                    record,
                    processed_employer_keys=processed_employer_keys,
                    new_unique_employer_keys=new_unique_employer_keys,
                )
                if not accepted:
                    warnings.append(duplicate_reason)
                    continue
                title = _text(record.get("vacancy_title") or record.get("hiring_title")) or ""
                published = _iso_date(record.get("published_at") or record.get("evidence_date") or record.get("date_posted")) or ""
                source_url = _text(record.get("source_url") or record.get("vacancy_url")) or ""
                publisher = _text(record.get("source_publisher")) or _host(source_url)
                vacancy_source_domain = _text(record.get("vacancy_source_domain")) or _host(source_url)
                source_class = _text(record.get("source_class")) or "company_careers"
                signal_id = next((item for item in request.signal_ids if item.startswith("hiring")), "hiring")
                excerpt = _text(record.get("evidence") or record.get("evidence_excerpt")) or f"{company} cerca {title}"
                confidence = 0.96 if source_class == "company_careers" else 0.86
                verification_evidence = tuple(record.get("domain_verification_evidence") or (
                    ("schema_org_identity_match", "official_page_host_match")
                    if "schema_org" in (_text(record.get("extraction_method")) or "")
                    else ("company_careers_host_match", "legal_name_in_page", "vacancy_source_verified")
                ))
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
                        "vacancy_url": source_url,
                        "vacancy_source_domain": vacancy_source_domain,
                        "employer_official_domain": domain,
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
                    provenance={
                        "adapter_id": self.capability.adapter_id,
                        "vacancy_url": source_url,
                        "vacancy_source_domain": vacancy_source_domain,
                        "employer_official_domain": domain,
                        "employer_is_direct": record.get("employer_is_direct") is True,
                        "employer_is_recruiter": record.get("employer_is_recruiter") is True,
                        "hiring_for_self": record.get("hiring_for_self") is True,
                        "final_employer_name": record.get("final_employer_name"),
                        "final_employer_domain": record.get("final_employer_domain"),
                        "employer_resolution_method": record.get("employer_resolution_method"),
                        "publisher": publisher,
                        "domain_verification": {
                            "status": "verified", "confidence": 0.96 if source_class == "company_careers" else 0.86,
                            "score": 96 if source_class == "company_careers" else 86,
                            "evidence": verification_evidence,
                            "resolution_source": "source_adapter",
                            "resolution_method": "verified_source_adapter",
                            "adapter_id": self.capability.adapter_id,
                            "url": f"https://{domain}/",
                        },
                    },
                    adapter_id=self.capability.adapter_id,
                    adapter_version=self.capability.adapter_version,
                    official_domain_verified=record.get("official_domain_verified") is True,
                    official_domain_confidence=0.96 if source_class == "company_careers" else 0.86,
                ))
                if _new_unique_target_reached(new_unique_employer_keys, request):
                    break
            if _new_unique_target_reached(new_unique_employer_keys, request):
                break
        target_reached = _new_unique_target_reached(new_unique_employer_keys, request)
        all_exhausted = all(result.exhausted for result in provider_results)
        next_cursor = None if all_exhausted else encode_discovery_cursor(discovery_state)
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
            operations=urls_processed_total,
            cost_eur=spent,
            started_at=started,
            completed_at=observed,
            warnings=tuple(sorted(set(warnings))),
            telemetry={
                "hiring_discovery": discovery_state.to_dict(),
                "url_traces": list(url_traces),
                "query_stats": list(discovery_state.query_stats),
                "discovery_spent_eur": discovery_state.discovery_spent_eur,
                "total_spent_eur": discovery_state.total_spent_eur,
                "queue_total_urls": len(discovery_state.seen_urls),
                "queue_pending_urls": discovery_state.queue_pending(),
                "urls_processed_total": discovery_state.url_offset,
                "queue_retry_urls": len(discovery_state.retry_urls),
                "url_outcomes_count": len(discovery_state.url_outcomes),
                "parser_epoch": discovery_state.parser_epoch,
                "acquisition": {
                    "hiring_discovery": discovery_state.to_dict(),
                    "url_traces": list(url_traces),
                    "url_outcomes": list(discovery_state.url_outcomes),
                    "prefetch_traces": list(discovery_state.prefetch_traces),
                },
            },
        )
