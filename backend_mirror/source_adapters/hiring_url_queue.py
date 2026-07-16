"""Pre-fetch URL classification and priority ordering for hiring adapter."""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain

from .hiring_recruiter import STAFFING_BRAND_ALIASES

PENDING_PROGRESS_BATCH_CAP = 20
URL_FETCH_CONCURRENCY = 4
URL_FETCH_TIMEOUT_S = 6.0
DOMAIN_LIMIT_PER_BATCH = 3

_ATS_HOSTS = (
    "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co",
    "myworkdayjobs.com", "smartrecruiters.com", "teamtailor.com",
    "recruitee.com", "personio.de", "apply.workable.com",
)
_CAREERS_SUBDOMAIN_PREFIXES = frozenset({"careers", "jobs", "job", "lavora", "work", "join", "recruiting"})
_JOB_BOARD_HOSTS = (
    "linkedin.com", "indeed.com", "infojobs.it", "monster.it", "glassdoor.",
    "jooble.org", "jobrapido.com", "careerjet.it", "talent.com", "jobijoba.it",
    "pagpersonnel.it", "randstad.it", "manpower.it", "synergie-italia.it", "synergie.it",
    "adecco.it", "gi-group.com", "umana.it", "openjobmetis.it", "etjca.it",
)
_LISTING_PATH_RE = re.compile(
    r"(?:/jobs/(?:search|category|list|lombardia|milano|bergamo|brescia|commerciale|tecnico|industriali|sector)|"
    r"/offerte-lavoro(?:/|$)|/annunci(?:/|$)|/candidati(?:/|$)|/ricerca(?:/|$)|"
    r"/lavora-con-noi/?$|/careers/?$|/posizioni(?:-aperte)?/?$|page[_=]|index_start=|"
    r"/q-[^/]+/page-|/offerte-di-lavoro/[^/]+/?$)",
    re.I,
)
_SERP_INTERNAL_RE = re.compile(r"(?:/search\?|/jobs/search|/offerte\?|/cerca\?|/risultati)", re.I)
_SOCIAL_LOGIN_RE = re.compile(
    r"(?:facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|youtube\.com|/login|/signin|/auth)",
    re.I,
)
_AGGREGATOR_HOSTS = (
    "trovit.it", "mitula.it", "cercalavoro.com", "jobtome.com", "jobisjob.it",
    "lavoro.it", "jobatus.it", "jobtome.", "clickajob.",
)
_ROLE_HINT_RE = re.compile(
    r"\b(?:commerciale|sales|account|business\s+developer|venditor|area\s+manager|sdr|bdr)\b",
    re.I,
)
_LOCATION_HINT_RE = re.compile(
    r"\b(?:lombardia|milano|bergamo|brescia|monza|brianza|varese|como|lecco|pavia|cremona|mantova|lodi|sondrio)\b",
    re.I,
)


def _host(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    return normalize_domain(parsed.hostname or "")


def _path(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    return re.sub(r"/+", "/", (parsed.path or "/").rstrip("/") or "/")


def _is_ats(host: str) -> bool:
    return any(host == item or host.endswith(f".{item}") for item in _ATS_HOSTS)


def _is_careers_subdomain(host: str) -> bool:
    parts = host.split(".")
    return len(parts) >= 3 and parts[0] in _CAREERS_SUBDOMAIN_PREFIXES


def _is_job_board(host: str) -> bool:
    return any(token in host for token in _JOB_BOARD_HOSTS)


def _is_aggregator(host: str) -> bool:
    return any(token in host for token in _AGGREGATOR_HOSTS)


def _staffing_brand(host: str, path_text: str) -> Optional[str]:
    hay = f"{host} {path_text}".casefold()
    for brand, aliases in STAFFING_BRAND_ALIASES.items():
        if any(alias in hay or alias.replace(" ", "") in host for alias in aliases):
            return brand
    return None


def _individual_vacancy_path(path_text: str) -> bool:
    if path_text in {"/", ""}:
        return False
    if _LISTING_PATH_RE.search(path_text):
        return False
    segments = [seg for seg in path_text.split("/") if seg]
    if len(segments) < 2:
        return False
    last = segments[-1]
    if last.isdigit() or re.search(r"\d{4,}", last):
        return True
    if re.search(r"(?:job|jobs|vacancy|offerta|position|apply|/r\d{5,})", path_text, re.I):
        return True
    return len(segments) >= 3 and len(last) >= 8


def classify_url_prefetch(
    url: str,
    *,
    query_source: str = "",
    seen_canonical: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Classify a discovered URL before any HTTP fetch."""
    canonical = url.lower().rstrip("/")
    host = _host(url)
    path_text = _path(url)
    source_class = "unknown"
    priority = 99
    prefetch_accept = False
    rejection_code = ""
    preliminary_employer = ""
    preliminary_role = ""
    preliminary_location = ""

    if not host or is_blacklisted_domain(host):
        rejection_code = "NOT_INDIVIDUAL_VACANCY"
    elif _SOCIAL_LOGIN_RE.search(url):
        rejection_code = "NOT_INDIVIDUAL_VACANCY"
    elif seen_canonical is not None and canonical in seen_canonical:
        rejection_code = "DUPLICATE"
    elif _SERP_INTERNAL_RE.search(url) or _LISTING_PATH_RE.search(path_text):
        rejection_code = "LISTING_PAGE"
    elif _is_aggregator(host) and not _individual_vacancy_path(path_text):
        rejection_code = "AGGREGATOR_WITHOUT_EMPLOYER"
    elif _staffing_brand(host, path_text) and not _individual_vacancy_path(path_text):
        rejection_code = "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
    elif not _individual_vacancy_path(path_text):
        rejection_code = "NOT_INDIVIDUAL_VACANCY"
    elif _is_ats(host):
        source_class = "company_careers"
        priority = 1
        prefetch_accept = True
        preliminary_employer = host.split(".")[0]
    elif _is_careers_subdomain(host):
        source_class = "company_careers"
        priority = 1
        prefetch_accept = True
        preliminary_employer = host.split(".")[1] if len(host.split(".")) >= 2 else host
    elif query_source == "serp:ats" or "workday" in host or "greenhouse" in host or "lever.co" in host:
        source_class = "company_careers"
        priority = 1
        prefetch_accept = True
    elif _is_job_board(host) and _individual_vacancy_path(path_text):
        source_class = "job_board"
        priority = 2
        prefetch_accept = True
        brand = _staffing_brand(host, path_text)
        if brand:
            rejection_code = "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
            prefetch_accept = False
            priority = 99
    elif query_source == "serp:careers" and _individual_vacancy_path(path_text):
        source_class = "company_careers"
        priority = 1
        prefetch_accept = True
    elif query_source == "serp:local_vacancy" and _individual_vacancy_path(path_text):
        source_class = "job_board" if _is_job_board(host) else "company_careers"
        priority = 2 if source_class == "job_board" else 1
        prefetch_accept = True
        if _is_aggregator(host):
            rejection_code = "AGGREGATOR_WITHOUT_EMPLOYER"
            prefetch_accept = False
    else:
        rejection_code = "NOT_INDIVIDUAL_VACANCY"

    role_match = _ROLE_HINT_RE.search(f"{path_text} {url}")
    if role_match:
        preliminary_role = role_match.group(0)
    loc_match = _LOCATION_HINT_RE.search(f"{path_text} {url}")
    if loc_match:
        preliminary_location = loc_match.group(0)

    if seen_canonical is not None and rejection_code != "DUPLICATE":
        seen_canonical.add(canonical)

    return {
        "url": url,
        "canonical_url": canonical,
        "source_domain": host,
        "source_class": source_class,
        "priority": priority,
        "preliminary_employer": preliminary_employer,
        "preliminary_role": preliminary_role,
        "preliminary_location": preliminary_location,
        "prefetch_accept": prefetch_accept,
        "prefetch_reject": not prefetch_accept,
        "rejection_code": rejection_code or ("ACCEPTED" if prefetch_accept else "NOT_INDIVIDUAL_VACANCY"),
        "query_source": query_source,
    }


def should_prefer_pending_over_retry(
    *,
    revalidation_urls: Sequence[str],
    discovery_offset: int,
    total_urls: int,
) -> bool:
    """After revalidation, drain discovered pending URLs before Workday retries."""
    if revalidation_urls:
        return False
    return discovery_offset < total_urls


def _is_workday_url(url: str) -> bool:
    return "myworkdayjobs.com" in _host(url)


def _workday_retry_urls(retry_urls: Sequence[str]) -> Tuple[str, ...]:
    return tuple(url for url in retry_urls if _is_workday_url(url))


def build_processing_batch(
    urls: list[str],
    url_query_meta: Mapping[str, tuple[str, str]],
    *,
    retry_urls: Sequence[str] = (),
    revalidation_urls: Sequence[str] = (),
    start_offset: int = 0,
    batch_cap: int = 24,
    prefer_pending_over_retry: bool = False,
) -> list[dict[str, Any]]:
    """Merge queue tiers: revalidation, then pending or retry depending on mode."""
    reval_items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for url in revalidation_urls:
        canonical = url.lower().rstrip("/")
        if not url or canonical in seen:
            continue
        seen.add(canonical)
        query, query_source = url_query_meta.get(url, url_query_meta.get(canonical, ("", "revalidation")))
        item = classify_url_prefetch(url, query_source=query_source, seen_canonical=None)
        item["query"] = query
        item["is_revalidation"] = True
        item["prefetch_accept"] = True
        reval_items.append(item)

    retry_source = _workday_retry_urls(retry_urls) if prefer_pending_over_retry else retry_urls
    retry_items: list[dict[str, Any]] = []
    for url in retry_source:
        canonical = url.lower().rstrip("/")
        if not url or canonical in seen:
            continue
        seen.add(canonical)
        query, query_source = url_query_meta.get(url, url_query_meta.get(canonical, ("", "retry")))
        item = classify_url_prefetch(url, query_source=query_source, seen_canonical=None)
        item["query"] = query
        item["is_retry"] = True
        retry_items.append(item)
    retry_items.sort(key=lambda row: (row["priority"], row["canonical_url"]))

    pending_all = build_priority_queue(urls, url_query_meta, start_offset=start_offset)
    pending_p1: list[dict[str, Any]] = []
    pending_p2: list[dict[str, Any]] = []
    pending_hard: list[dict[str, Any]] = []
    for row in pending_all:
        canonical = str(row.get("canonical_url") or "")
        if canonical:
            seen.add(canonical)
        item = dict(row)
        item["is_pending"] = True
        if item.get("prefetch_accept") and item.get("priority") == 1:
            pending_p1.append(item)
        elif item.get("prefetch_accept") and item.get("priority") == 2:
            pending_p2.append(item)
        else:
            pending_hard.append(item)

    if prefer_pending_over_retry:
        ordered = reval_items + pending_p1 + pending_p2 + pending_hard + retry_items
    else:
        ordered = reval_items + retry_items + pending_all
    return ordered[: max(0, batch_cap)]


def build_priority_queue(
    urls: list[str],
    url_query_meta: Mapping[str, tuple[str, str]],
    *,
    start_offset: int = 0,
) -> list[dict[str, Any]]:
    """Return pending URLs sorted by priority (ATS/careers first)."""
    seen: set[str] = set()
    for idx in range(start_offset):
        if idx < len(urls):
            seen.add(urls[idx].lower().rstrip("/"))
    classified: list[dict[str, Any]] = []
    for url in urls[start_offset:]:
        canonical = url.lower().rstrip("/")
        query, query_source = url_query_meta.get(url, url_query_meta.get(canonical, ("", "unknown")))
        item = classify_url_prefetch(url, query_source=query_source, seen_canonical=seen)
        item["query"] = query
        classified.append(item)
    accepted = [item for item in classified if item["prefetch_accept"]]
    rejected = [item for item in classified if not item["prefetch_accept"]]
    accepted.sort(key=lambda row: (row["priority"], row["canonical_url"]))
    return accepted + rejected
