"""Source-specific ATS vacancy parsers for the hiring adapter."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain
from backend_mirror.agents.structured_lanes import extract_jobposting_leads, resolve_hiring_employer_domains

from .hiring_url_queue import classify_url_prefetch

_ATS_VENDOR_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("workday", re.compile(r"\.myworkdayjobs\.com$", re.I)),
    ("greenhouse", re.compile(r"(?:boards|job-boards)\.greenhouse\.io$", re.I)),
    ("lever", re.compile(r"jobs\.lever\.co$", re.I)),
    ("smartrecruiters", re.compile(r"\.smartrecruiters\.com$", re.I)),
    ("teamtailor", re.compile(r"\.teamtailor\.com$", re.I)),
    ("recruitee", re.compile(r"\.recruitee\.com$", re.I)),
    ("personio", re.compile(r"\.personio\.(?:de|com)$", re.I)),
    ("workable", re.compile(r"apply\.workable\.com$", re.I)),
    ("softgarden", re.compile(r"\.softgarden\.de$", re.I)),
)

_JS_SHELL_RE = re.compile(
    r"(?:wd-ApplicationShell|data-automation-id=\"jobPostingPage\"|window\.workday|__NEXT_DATA__|react-root)",
    re.I,
)
_WORKDAY_TENANT_RE = re.compile(r"\"tenant\"\s*:\s*\"([^\"]+)\"", re.I)
_WORKDAY_SITE_RE = re.compile(r"\"siteId\"\s*:\s*\"([^\"]+)\"", re.I)
_WORKDAY_OUTAGE_RE = re.compile(r"/wday/drs/outage\?t=([^&\"']+)&s=([^&\"']+)", re.I)
_LOCALE_RE = re.compile(r"^[a-z]{2}(?:-[a-z]{2})?$", re.I)
_REQUISITION_RE = re.compile(r"(?:_r\d+|_jr-?\d+|_req-?\d+|_\d{5,}|r-\d+)$", re.I)

# Deterministic Workday tenant -> corporate domain (never invent arbitrary .com).
_WORKDAY_TENANT_CORPORATE_DOMAINS: Mapping[str, str] = {
    "airliquidehr": "airliquide.com",
    "airliquide": "airliquide.com",
    "solenis": "solenis.com",
    "lyreco": "lyreco.it",
    "teamsystem": "teamsystem.com",
    "gsk": "gsk.com",
    "ing": "ing.it",
    "convatec": "convatec.com",
    "moog": "moog.com",
    "otis": "otis.com",
    "jj": "jnj.com",
    "bdrthermea": "bdrthermea.com",
    "dedalus": "dedalus.com",
    "mango": "mango.com",
    "ttiemea": "tti.com",
    "bakerhughes": "bakerhughes.com",
    "bdx": "bd.com",
    "diageo": "diageo.com",
    "cognex": "cognex.com",
    "dupont": "dupont.com",
    "sensata": "sensata.com",
    "viatris": "viatris.com",
    "livanova": "livanova.com",
    "condenast": "condenast.com",
    "flexerasoftware": "flexera.com",
    "dentsuaegis": "dentsu.com",
    "columbiasportswearcompany": "columbia.com",
    "movadogroup": "movado.com",
    "scj": "scjohnson.com",
    "hyperiongrp": "hyperion.com",
}

RETRYABLE_FAILURE_CODES = frozenset({
    "FETCH_TIMEOUT",
    "FETCH_HTTP_ERROR",
    "FETCH_BLOCKED",
    "DOMAIN_BATCH_DEFERRED",
    "JAVASCRIPT_SHELL",
    "JSONLD_JOBPOSTING_MISSING",
    "ATS_UNSUPPORTED",
    "PARSE_FAILED",
    "WORKDAY_CXS_HTTP_403",
    "WORKDAY_CXS_HTTP_404",
    "WORKDAY_CXS_HTTP_422",
    "WORKDAY_CXS_NOT_JSON",
    "WORKDAY_CXS_FETCH_ERROR",
    "WORKDAY_CXS_URL_UNRESOLVED",
    "WORKDAY_CXS_EMPTY",
})

HARD_REJECT_CODES = frozenset({
    "DUPLICATE",
    "LISTING_PAGE",
    "NOT_INDIVIDUAL_VACANCY",
    "RECRUITER_FINAL_EMPLOYER_UNRESOLVED",
    "ROLE_MISMATCH",
    "GEOGRAPHY_MISMATCH",
    "STALE_VACANCY",
    "EMPLOYER_UNRESOLVED",
    "OFFICIAL_DOMAIN_UNRESOLVED",
    "AGGREGATOR_WITHOUT_EMPLOYER",
    "rejected_final",
})


@dataclass(frozen=True)
class VacancyParseResult:
    records: Tuple[Mapping[str, Any], ...]
    parser_id: str
    failure_code: str = ""
    jsonld_count: int = 0
    javascript_shell: bool = False
    fetch_mode: str = "html"


def detect_ats_vendor(url: str) -> Optional[str]:
    host = normalize_domain(urlparse(url).hostname or "")
    if not host:
        return None
    for vendor, pattern in _ATS_VENDOR_PATTERNS:
        if pattern.search(host):
            return vendor
    return None


def is_javascript_shell(html: str) -> bool:
    sample = (html or "")[:80_000]
    if len(sample.strip()) < 400:
        return True
    return bool(_JS_SHELL_RE.search(sample))


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _normalize_record(
    *,
    employer_name: str,
    title: str,
    location: str,
    published_at: str,
    source_url: str,
    extraction_method: str,
    description: str = "",
    organization_website: str = "",
    valid_through: str = "",
) -> Dict[str, Any]:
    resolved = resolve_hiring_employer_domains(
        employer_name=employer_name,
        organization_website=organization_website,
        vacancy_url=source_url,
        source_url=source_url,
    )
    employer_official_domain = resolved["employer_official_domain"]
    vacancy_source_domain = resolved["vacancy_source_domain"]
    is_ats = detect_ats_vendor(source_url) is not None
    source_class = "company_careers" if is_ats or employer_official_domain else "job_board"
    evidence = f"{employer_name} cerca {title}"
    if published_at:
        evidence += f" (pubblicata {published_at[:10]})"
    return {
        "name": employer_name[:200],
        "company_name": employer_name[:200],
        "website": f"https://{employer_official_domain}" if employer_official_domain else organization_website[:500],
        "employer_official_domain": employer_official_domain,
        "vacancy_url": source_url[:1000],
        "vacancy_source_domain": vacancy_source_domain,
        "evidence": evidence[:300],
        "matched_signals": ["hiring"],
        "hiring_title": title[:200],
        "vacancy_title": title[:200],
        "evidence_date": published_at[:40],
        "published_at": published_at[:40],
        "valid_through": valid_through[:40],
        "location": location[:200],
        "source_url": source_url[:1000],
        "source_publisher": vacancy_source_domain,
        "source_class": source_class,
        "extraction_method": extraction_method,
        "description": description[:2000],
        "employer_is_direct": resolved["employer_is_direct"],
        "official_domain_verified": resolved["official_domain_verified"],
        "domain_verification_evidence": list(resolved["domain_verification_evidence"]),
        "entity_class": "operating_company",
    }


def _workday_path_parts(source_url: str) -> Optional[Tuple[str, str, str, str]]:
    """Return (tenant_hint, career_site, job_path, requisition_id) from a Workday vacancy URL."""
    parsed = urlparse(source_url)
    segments = [item for item in parsed.path.split("/") if item]
    if "job" not in segments:
        return None
    job_idx = segments.index("job")
    prefix = segments[:job_idx]
    if not prefix:
        return None
    if len(prefix) >= 2 and _LOCALE_RE.fullmatch(prefix[0]):
        site = prefix[1]
    else:
        site = prefix[0]
    job_segments = segments[job_idx + 1:]
    stop_words = {"apply", "usemylastapplication", "applymanually", "login", "autofillwithresume"}
    trimmed: List[str] = []
    for segment in job_segments:
        if segment.lower() in stop_words:
            break
        trimmed.append(segment)
    if not trimmed:
        return None
    job_path = "/".join(trimmed)
    requisition_id = ""
    tail = trimmed[-1]
    req_match = _REQUISITION_RE.search(tail)
    if req_match:
        requisition_id = req_match.group(0).lstrip("_-")
    host_prefix = (parsed.hostname or "").split(".")[0].lower()
    # Keep the Workday tenant as the hostname label (airliquidehr, not airliquide).
    tenant = host_prefix
    return tenant, site, job_path, requisition_id


def inspect_workday_url(source_url: str, html: str = "") -> dict[str, Any]:
    """Forensic breakdown used by CXS fetch traces."""
    parsed = urlparse(source_url)
    parts = _workday_path_parts(source_url)
    tenant = ""
    site = ""
    job_path = ""
    requisition_id = ""
    if parts:
        tenant, site, job_path, requisition_id = parts
    outage = _WORKDAY_OUTAGE_RE.search(html or "")
    if outage:
        tenant = outage.group(1)
        site = outage.group(2)
    for match in _WORKDAY_TENANT_RE.finditer(html or ""):
        tenant = match.group(1)
    for match in _WORKDAY_SITE_RE.finditer(html or ""):
        site = match.group(1)
    return {
        "original_url": source_url,
        "host": parsed.hostname or "",
        "tenant": tenant,
        "career_site": site,
        "job_path": job_path,
        "requisition_id": requisition_id,
    }


def build_workday_cxs_url(source_url: str, html: str = "") -> Optional[str]:
    meta = inspect_workday_url(source_url, html)
    tenant = str(meta.get("tenant") or "")
    site = str(meta.get("career_site") or "")
    job_path = str(meta.get("job_path") or "")
    if not tenant or not site or not job_path:
        return None
    host = urlparse(source_url).netloc
    return f"https://{host}/wday/cxs/{tenant}/{site}/job/{job_path}"


def _workday_corporate_guess(source_url: str) -> str:
    host = normalize_domain(urlparse(source_url if "://" in source_url else f"https://{source_url}").hostname or "")
    prefix = (host.split(".")[0] if host else "").lower()
    if prefix in _WORKDAY_TENANT_CORPORATE_DOMAINS:
        return _WORKDAY_TENANT_CORPORATE_DOMAINS[prefix]
    for suffix in ("externalcareer", "external", "careers", "jobs", "hr"):
        stripped = prefix
        if stripped.endswith(suffix) and len(stripped) > len(suffix):
            stripped = stripped[: -len(suffix)]
            if stripped in _WORKDAY_TENANT_CORPORATE_DOMAINS:
                return _WORKDAY_TENANT_CORPORATE_DOMAINS[stripped]
    return ""


def parse_workday_json(payload: Mapping[str, Any], source_url: str) -> List[Dict[str, Any]]:
    info = payload.get("jobPostingInfo") if isinstance(payload.get("jobPostingInfo"), Mapping) else payload
    title = _text(info.get("title") or info.get("jobPostingTitle") or payload.get("title"))
    if not title:
        return []
    organization = info.get("hiringOrganization") if isinstance(info.get("hiringOrganization"), Mapping) else {}
    if not organization and isinstance(payload.get("hiringOrganization"), Mapping):
        organization = payload["hiringOrganization"]
    employer_name = _text(organization.get("name") or info.get("company") or payload.get("company"))
    corporate = _workday_corporate_guess(source_url)
    meta = inspect_workday_url(source_url)
    tenant = str(meta.get("tenant") or "").lower()
    if not employer_name:
        # Deterministic fallback from Workday tenant map only (never invent names).
        name_map = {
            "airliquidehr": "Air Liquide",
            "airliquide": "Air Liquide",
            "solenis": "Solenis",
            "lyreco": "Lyreco",
            "teamsystem": "TeamSystem",
            "gsk": "GSK",
            "ing": "ING",
            "convatec": "Convatec",
            "moog": "Moog",
            "otis": "Otis",
            "jj": "Johnson & Johnson",
            "bakerhughes": "Baker Hughes",
            "bdx": "BD",
            "diageo": "Diageo",
            "cognex": "Cognex",
            "dupont": "DuPont",
            "sensata": "Sensata",
            "viatris": "Viatris",
            "livanova": "LivaNova",
            "condenast": "Condé Nast",
            "flexerasoftware": "Flexera",
            "dentsuaegis": "Dentsu",
            "columbiasportswearcompany": "Columbia Sportswear",
            "movadogroup": "Movado",
            "scj": "SC Johnson",
        }
        employer_name = name_map.get(tenant, "")
    if not employer_name:
        return []
    location = _text(info.get("location") or info.get("jobRequisitionLocation") or payload.get("location"))
    if isinstance(info.get("locationsText"), str):
        location = location or _text(info.get("locationsText"))
    additional = info.get("additionalLocations")
    if isinstance(additional, Sequence) and not isinstance(additional, (str, bytes)):
        extras = [_text(item) for item in additional if _text(item)]
        if extras:
            location = ", ".join([part for part in (location, *extras) if part])
    # Prefer ISO startDate over relative postedOn ("Posted Today").
    published_at = _text(info.get("startDate") or payload.get("startDate") or "")
    if not re.match(r"^20\d{2}-\d{2}-\d{2}", published_at):
        posted = _text(info.get("postedOn") or info.get("datePosted") or payload.get("postedOn"))
        if re.match(r"^20\d{2}-\d{2}-\d{2}", posted):
            published_at = posted
    description = _text(info.get("jobDescription") or payload.get("jobDescription"))
    organization_website = _text(
        organization.get("sameAs")
        or organization.get("url")
        or ""
    )
    resolution_method = ""
    if organization_website and "myworkdayjobs.com" not in organization_website.lower():
        resolution_method = "hiring_organization_same_as"
    elif corporate:
        organization_website = f"https://{corporate}"
        resolution_method = "workday_tenant_corporate_map"
    valid_through = _text(info.get("validThrough") or payload.get("validThrough"))
    requisition_id = _text(info.get("jobReqId") or info.get("id") or payload.get("jobReqId"))
    active = info.get("canApply")
    external_url = _text(info.get("externalUrl") or payload.get("externalUrl") or source_url)
    # Keep vacancy URL as the Workday job URL (never promote ATS host to official domain).
    vacancy_url = source_url if "myworkdayjobs.com" in source_url.lower() else (external_url or source_url)
    record = _normalize_record(
        employer_name=employer_name,
        title=title,
        location=location,
        published_at=published_at,
        source_url=vacancy_url,
        extraction_method="workday_cxs_json",
        description=description,
        organization_website=organization_website,
        valid_through=valid_through,
    )
    record["requisition_id"] = requisition_id
    record["external_url"] = external_url
    record["workday_tenant"] = tenant
    record["workday_career_site"] = str(meta.get("career_site") or "")
    record["hiring_organization_name"] = employer_name
    record["additional_locations"] = list(additional) if isinstance(additional, list) else []
    record["start_date"] = _text(info.get("startDate") or published_at)
    if active is not None:
        record["active"] = bool(active)
    official = str(record.get("employer_official_domain") or "")
    if official and "myworkdayjobs.com" in official.lower():
        official = ""
        record["employer_official_domain"] = ""
        record["official_domain_verified"] = False
    if corporate and (not official or official == corporate):
        record["employer_official_domain"] = corporate
        record["website"] = f"https://{corporate}"
        record["official_domain_verified"] = True
        record["employer_is_direct"] = True
        record["domain_verification_evidence"] = list(dict.fromkeys([
            *(record.get("domain_verification_evidence") or []),
            "workday_tenant_corporate_map",
            f"workday_tenant:{tenant}",
            f"corporate_domain:{corporate}",
        ]))
        resolution_method = resolution_method or "workday_tenant_corporate_map"
        record["source_class"] = "company_careers"
        record["source_subtype"] = "first_party_ats"
        record["ats_vendor"] = "workday"
    elif record.get("employer_official_domain") and detect_ats_vendor(vacancy_url) == "workday":
        record["source_class"] = "company_careers"
        record["source_subtype"] = "first_party_ats"
        record["ats_vendor"] = "workday"
    record["employer_resolution_method"] = resolution_method or (
        "hiring_organization_name" if employer_name else ""
    )
    return [record]


def parse_teamtailor_json(payload: Mapping[str, Any], source_url: str) -> List[Dict[str, Any]]:
    attrs = payload.get("attributes") if isinstance(payload.get("attributes"), Mapping) else payload
    title = _text(attrs.get("title") or payload.get("title"))
    employer_name = _text((payload.get("company") or {}).get("name") if isinstance(payload.get("company"), Mapping) else attrs.get("company-name"))
    location = _text(attrs.get("location") or attrs.get("locations"))
    published_at = _text(attrs.get("created-at") or attrs.get("published-at"))
    if not title or not employer_name:
        return []
    return [_normalize_record(
        employer_name=employer_name,
        title=title,
        location=location,
        published_at=published_at,
        source_url=source_url,
        extraction_method="teamtailor_json",
        description=_text(attrs.get("body")),
    )]


def build_teamtailor_json_url(source_url: str) -> Optional[str]:
    parsed = urlparse(source_url)
    segments = [item for item in parsed.path.split("/") if item]
    if "jobs" not in segments:
        return None
    job_idx = segments.index("jobs")
    if job_idx + 1 >= len(segments):
        return None
    job_slug = segments[job_idx + 1]
    return f"{parsed.scheme}://{parsed.netloc}/jobs/{job_slug}.json"


def build_greenhouse_api_url(source_url: str) -> Optional[str]:
    parsed = urlparse(source_url)
    segments = [item for item in parsed.path.split("/") if item]
    if len(segments) >= 3 and segments[0] == "jobs" and segments[1].isdigit():
        board = normalize_domain(parsed.hostname or "").split(".")[0]
        return f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{segments[1]}"
    if len(segments) >= 3 and segments[-2] == "jobs":
        board = segments[0]
        job_id = segments[-1]
        if job_id.isdigit():
            return f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}"
    return None


def parse_greenhouse_json(payload: Mapping[str, Any], source_url: str) -> List[Dict[str, Any]]:
    title = _text(payload.get("title"))
    employer_name = _text((payload.get("company") or {}).get("name") if isinstance(payload.get("company"), Mapping) else payload.get("company_name"))
    location = _text(payload.get("location", {}).get("name") if isinstance(payload.get("location"), Mapping) else payload.get("location"))
    published_at = _text(payload.get("updated_at") or payload.get("first_published"))
    if not title:
        return []
    if not employer_name:
        employer_name = _text(payload.get("departments", [{}])[0].get("name") if payload.get("departments") else "")
    if not employer_name:
        return []
    return [_normalize_record(
        employer_name=employer_name,
        title=title,
        location=location,
        published_at=published_at,
        source_url=source_url,
        extraction_method="greenhouse_api_json",
        description=_text(payload.get("content")),
    )]


def parse_vacancy_html(html: str, source_url: str, *, structured_json: Optional[Mapping[str, Any]] = None) -> VacancyParseResult:
    shell = is_javascript_shell(html)
    jsonld = extract_jobposting_leads(html, source_url)
    if jsonld:
        return VacancyParseResult(tuple(dict(item) for item in jsonld), "jsonld", jsonld_count=len(jsonld), javascript_shell=shell)
    if structured_json:
        vendor = detect_ats_vendor(source_url)
        if vendor == "workday":
            records = parse_workday_json(structured_json, source_url)
            if records:
                return VacancyParseResult(tuple(records), "workday_cxs_json", jsonld_count=0, javascript_shell=shell, fetch_mode="json")
            return VacancyParseResult((), "workday_cxs_json", failure_code="WORKDAY_CXS_EMPTY", javascript_shell=shell, fetch_mode="json")
        if vendor == "teamtailor":
            records = parse_teamtailor_json(structured_json, source_url)
            if records:
                return VacancyParseResult(tuple(records), "teamtailor_json", jsonld_count=0, javascript_shell=shell, fetch_mode="json")
        if vendor == "greenhouse":
            records = parse_greenhouse_json(structured_json, source_url)
            if records:
                return VacancyParseResult(tuple(records), "greenhouse_api_json", jsonld_count=0, javascript_shell=shell, fetch_mode="json")
    vendor = detect_ats_vendor(source_url)
    if vendor == "workday" and shell:
        return VacancyParseResult((), "workday", failure_code="JAVASCRIPT_SHELL", javascript_shell=True)
    if vendor and vendor not in {"workday", "greenhouse", "teamtailor", "softgarden"}:
        return VacancyParseResult((), vendor or "unknown", failure_code="ATS_UNSUPPORTED", javascript_shell=shell)
    if shell:
        return VacancyParseResult((), vendor or "html", failure_code="JAVASCRIPT_SHELL", javascript_shell=True)
    return VacancyParseResult((), vendor or "html", failure_code="JSONLD_JOBPOSTING_MISSING", javascript_shell=shell)


def classify_failure_for_retry(rejection_code: str) -> bool:
    return rejection_code in RETRYABLE_FAILURE_CODES


def bootstrap_legacy_retry_urls(
    seen_urls: Sequence[str],
    url_offset: int,
    *,
    parser_epoch: int,
    url_outcomes: Mapping[str, Mapping[str, Any]],
) -> Tuple[str, ...]:
    """Requeue prefetch-accepted / ATS URLs from legacy runs without per-URL traces."""
    if parser_epoch >= 2 or url_offset <= 0:
        return ()
    retry: List[str] = []
    for url in seen_urls[:url_offset]:
        canonical = url.lower().rstrip("/")
        prior = url_outcomes.get(canonical) if isinstance(url_outcomes, Mapping) else None
        if isinstance(prior, Mapping):
            state = str(prior.get("url_state") or "")
            code = str(prior.get("rejection_code") or "")
            if state == "accepted":
                continue
            if code in HARD_REJECT_CODES or not classify_failure_for_retry(code):
                continue
        vendor = detect_ats_vendor(url)
        prefetch = classify_url_prefetch(url)
        if vendor or prefetch.get("prefetch_accept"):
            if prefetch.get("rejection_code") not in HARD_REJECT_CODES:
                retry.append(url)
    return tuple(dict.fromkeys(retry))
