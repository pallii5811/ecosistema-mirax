"""Zero/low-LLM discovery lanes for high-value structured evidence sources."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .portal_blacklist import is_blacklisted_domain, normalize_domain
from .search_serp import search_urls_http

logger = logging.getLogger("structured_lanes")

_HIRING_ROLE_PATTERNS = (
    r"(?:assum(?:e|ono|endo)|cerca(?:no)?|ricerca(?:no)?)\s+(?:un\s+|una\s+|dei\s+|delle\s+)?([^,.;]{3,60})",
    r"(?:posizione|ruolo|offerta)\s+(?:di|per)\s+([^,.;]{3,60})",
)

_ATS_HOSTS = (
    "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co",
    "myworkdayjobs.com", "smartrecruiters.com", "teamtailor.com",
    "recruitee.com", "personio.de", "apply.workable.com",
)


def _job_location(value: Any) -> str:
    values = value if isinstance(value, list) else [value]
    parts: List[str] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        address = item.get("address") if isinstance(item.get("address"), dict) else item
        for key in ("addressLocality", "addressRegion", "addressCountry", "name"):
            raw = address.get(key)
            if isinstance(raw, dict):
                raw = raw.get("name")
            text = str(raw or "").strip()
            if text and text not in parts:
                parts.append(text)
    return ", ".join(parts)[:200]


def _organization_size(organization: Dict[str, Any]) -> tuple[str, Optional[int]]:
    raw = organization.get("numberOfEmployees")
    if isinstance(raw, dict):
        raw = raw.get("value") or raw.get("maxValue")
    try:
        employees = int(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        employees = None
    if employees is None:
        return "", None
    if employees <= 9:
        return "micro", employees
    if employees <= 49:
        return "small", employees
    if employees <= 249:
        return "medium", employees
    return "enterprise", employees


def infer_hiring_roles(plan: Dict[str, Any]) -> List[str]:
    explicit = plan.get("hiring_roles")
    if isinstance(explicit, list):
        roles = [str(value).strip() for value in explicit if str(value).strip()]
        if roles:
            return roles[:5]
    hypothesis = plan.get("commercial_hypothesis") if isinstance(plan.get("commercial_hypothesis"), dict) else {}
    hypothesis_roles = hypothesis.get("hiring_roles")
    if isinstance(hypothesis_roles, list):
        roles = [str(value).strip() for value in hypothesis_roles if str(value).strip()]
        if roles:
            return roles[:5]
    query = str(plan.get("original_query") or "")
    for pattern in _HIRING_ROLE_PATTERNS:
        match = re.search(pattern, query, re.I)
        if match:
            role = re.sub(r"\s+", " ", match.group(1)).strip(" -")
            if role:
                return [role[:80]]
    return []


def _iter_json_objects(value: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        graph = value.get("@graph")
        if isinstance(graph, list):
            for child in graph:
                yield from _iter_json_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_json_objects(child)


def _corporate_from_careers_host(host: str) -> str:
    host = (host or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[0] in {"careers", "jobs", "job", "lavora", "work", "join", "recruiting"}:
        return normalize_domain(".".join(parts[1:]))
    return ""


def resolve_hiring_employer_domains(
    *,
    employer_name: str,
    organization_website: str,
    vacancy_url: str,
    source_url: str,
) -> Dict[str, Any]:
    """Separate vacancy source from employer corporate domain."""
    vacancy_url = (vacancy_url or source_url or "").strip()
    vacancy_source_domain = normalize_domain(urlparse(vacancy_url).hostname or "")
    official_host = normalize_domain(organization_website)
    is_ats = any(
        vacancy_source_domain == host or vacancy_source_domain.endswith(f".{host}")
        for host in _ATS_HOSTS
    )
    employer_official_domain = ""
    verification_evidence: List[str] = []
    if official_host and not is_blacklisted_domain(official_host):
        if not any(official_host == host or official_host.endswith(f".{host}") for host in _ATS_HOSTS):
            employer_official_domain = official_host
            verification_evidence.append("schema_org_identity_match")
    if not employer_official_domain:
        corporate = _corporate_from_careers_host(vacancy_source_domain)
        if corporate and not is_blacklisted_domain(corporate):
            employer_official_domain = corporate
            verification_evidence.append("careers_subdomain_corporate_link")
    if not employer_official_domain and official_host:
        employer_official_domain = official_host
        verification_evidence.append("employer_corporate_domain_resolved")
    if employer_official_domain and vacancy_source_domain:
        if vacancy_source_domain == employer_official_domain:
            verification_evidence.append("official_page_host_match")
        elif vacancy_source_domain.endswith(f".{employer_official_domain}"):
            verification_evidence.append("careers_subdomain_corporate_link")
    verification_evidence.append("vacancy_source_verified")
    employer_is_direct = bool(employer_name.strip()) and bool(employer_official_domain)
    verified = employer_is_direct and bool(verification_evidence)
    return {
        "employer_name": employer_name.strip(),
        "employer_official_domain": employer_official_domain,
        "vacancy_url": vacancy_url,
        "vacancy_source_domain": vacancy_source_domain,
        "official_domain_verified": verified,
        "employer_is_direct": employer_is_direct,
        "domain_verification_evidence": tuple(sorted(set(verification_evidence))),
    }


def extract_jobposting_leads(html: str, source_url: str) -> List[Dict[str, Any]]:
    """Extract schema.org JobPosting entities without an LLM."""
    soup = BeautifulSoup(html or "", "html.parser")
    out: List[Dict[str, Any]] = []
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for obj in _iter_json_objects(payload):
            raw_type = obj.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if "JobPosting" not in types:
                continue
            organization = obj.get("hiringOrganization")
            if not isinstance(organization, dict):
                continue
            name = str(organization.get("name") or "").strip()
            if len(name) < 2:
                continue
            website = str(organization.get("sameAs") or organization.get("url") or "").strip()
            if website and is_blacklisted_domain(normalize_domain(website)):
                website = ""
            title = str(obj.get("title") or obj.get("name") or "Posizione aperta").strip()
            date_posted = str(obj.get("datePosted") or "").strip()
            valid_through = str(obj.get("validThrough") or "").strip()
            vacancy_url = str(obj.get("url") or source_url).strip()
            location = _job_location(obj.get("jobLocation") or obj.get("applicantLocationRequirements"))
            source_host = normalize_domain(urlparse(source_url).hostname or "")
            resolved = resolve_hiring_employer_domains(
                employer_name=name,
                organization_website=website,
                vacancy_url=vacancy_url,
                source_url=source_url,
            )
            employer_official_domain = resolved["employer_official_domain"]
            vacancy_source_domain = resolved["vacancy_source_domain"]
            is_recognized_ats = any(
                vacancy_source_domain == host or vacancy_source_domain.endswith(f".{host}")
                for host in _ATS_HOSTS
            )
            source_class = (
                "company_careers"
                if employer_official_domain
                and (
                    vacancy_source_domain == employer_official_domain
                    or vacancy_source_domain.endswith(f".{employer_official_domain}")
                    or is_recognized_ats
                )
                else "job_board"
            )
            company_size, employee_count = _organization_size(organization)
            description = BeautifulSoup(str(obj.get("description") or ""), "html.parser").get_text(" ", strip=True)
            evidence = f"{name} cerca {title}"
            if date_posted:
                evidence += f" (pubblicata {date_posted[:10]})"
            corporate_website = (
                f"https://{employer_official_domain}"
                if employer_official_domain
                else website[:500]
            )
            out.append(
                {
                    "name": name[:200],
                    "company_name": name[:200],
                    "website": corporate_website,
                    "employer_official_domain": employer_official_domain,
                    "vacancy_url": vacancy_url[:1000],
                    "vacancy_source_domain": vacancy_source_domain,
                    "evidence": evidence[:300],
                    "matched_signals": ["hiring"],
                    "hiring_title": title[:200],
                    "vacancy_title": title[:200],
                    "evidence_date": date_posted[:40],
                    "published_at": date_posted[:40],
                    "valid_through": valid_through[:40],
                    "location": location,
                    "source_url": vacancy_url[:1000],
                    "source_publisher": vacancy_source_domain or source_host,
                    "source_class": source_class,
                    "extraction_method": "schema_org_jobposting",
                    "active": True,
                    "description": description[:2000],
                    "company_size": company_size,
                    "employee_count": employee_count,
                    "employer_is_direct": resolved["employer_is_direct"],
                    "official_domain_verified": resolved["official_domain_verified"],
                    "domain_verification_evidence": list(resolved["domain_verification_evidence"]),
                    "source_lane": "hiring_jsonld",
                    "entity_class": "operating_company",
                }
            )
    return out


async def _fetch_text(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> str:
    async with sem:
        try:
            response = await client.get(url)
            if response.status_code != 200:
                return ""
            content_type = str(response.headers.get("content-type") or "").lower()
            if "html" not in content_type and "xhtml" not in content_type:
                return ""
            return response.text[:2_000_000]
        except Exception:
            return ""


async def discover_hiring_companies(plan: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    roles = infer_hiring_roles(plan)
    role = roles[0] if roles else str(plan.get("sector") or "personale").strip()
    location = str(plan.get("location") or "Italia").strip()
    sector = str(plan.get("sector") or "").strip()
    role_pool = roles[:5] if roles else [role]
    queries: List[str] = []
    for current_role in role_pool:
        queries.extend(
            [
                f'"{current_role}" "{location}" (site:indeed.it OR site:infojobs.it OR site:linkedin.com/jobs)',
                f'"{current_role}" ("lavora con noi" OR careers OR "posizioni aperte") {sector} {location}',
            ]
        )
    urls: List[str] = []
    seen_urls: set[str] = set()
    per_query = max(15, min(60, limit * 2))
    for query in queries:
        found = await asyncio.to_thread(search_urls_http, query, per_query)
        for url in found:
            key = url.lower().rstrip("/")
            if key not in seen_urls:
                seen_urls.add(key)
                urls.append(url)
            if len(urls) >= min(180, max(30, limit * 4)):
                break

    sem = asyncio.Semaphore(8)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MIRAX-Research/2.0)",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
    }
    leads: List[Dict[str, Any]] = []
    seen_companies: set[str] = set()
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        tasks = [asyncio.create_task(_fetch_text(client, url, sem)) for url in urls]
        for url, task in zip(urls, tasks):
            html = await task
            for lead in extract_jobposting_leads(html, url):
                key = normalize_domain(str(lead.get("website") or "")) or str(lead.get("name") or "").lower()
                if not key or key in seen_companies:
                    continue
                seen_companies.add(key)
                leads.append(lead)
                if len(leads) >= limit:
                    return leads
    return leads


async def discover_structured_leads(plan: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    """Execute applicable lanes concurrently and return deduplicated candidates."""
    signals = {str(value).strip().lower() for value in plan.get("required_signals") or []}
    tasks: List[asyncio.Task[List[Dict[str, Any]]]] = []
    if "tender_won" in signals:
        from anac_client import discover_anac_companies

        keywords = [str(plan.get("sector") or ""), str(plan.get("original_query") or "")]
        tasks.append(
            asyncio.create_task(
                discover_anac_companies(
                    keywords,
                    location=str(plan.get("location") or ""),
                    max_records=min(limit, 1_000),
                )
            )
        )
    if "hiring" in signals or any(signal.startswith("hiring_") for signal in signals):
        tasks.append(asyncio.create_task(discover_hiring_companies(plan, min(limit, 500))))
    if not tasks:
        return []

    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for result in await asyncio.gather(*tasks, return_exceptions=True):
        if isinstance(result, BaseException):
            logger.warning("structured lane failed: %s", result)
            continue
        for lead in result:
            key = normalize_domain(str(lead.get("website") or "")) or str(lead.get("name") or "").lower().strip()
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(lead)
            if len(merged) >= limit:
                return merged
    return merged
