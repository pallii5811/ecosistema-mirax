"""Zero/low-LLM discovery lanes for high-value structured evidence sources."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, Iterable, List, Optional

import httpx
from bs4 import BeautifulSoup

from .portal_blacklist import is_blacklisted_domain, normalize_domain
from .search_serp import search_urls_http

logger = logging.getLogger("structured_lanes")

_HIRING_ROLE_PATTERNS = (
    r"(?:assum(?:e|ono|endo)|cerca(?:no)?|ricerca(?:no)?)\s+(?:un\s+|una\s+|dei\s+|delle\s+)?([^,.;]{3,60})",
    r"(?:posizione|ruolo|offerta)\s+(?:di|per)\s+([^,.;]{3,60})",
)


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
            evidence = f"{name} cerca {title}"
            if date_posted:
                evidence += f" (pubblicata {date_posted[:10]})"
            out.append(
                {
                    "name": name[:200],
                    "website": website[:500],
                    "evidence": evidence[:300],
                    "matched_signals": ["hiring"],
                    "hiring_title": title[:200],
                    "evidence_date": date_posted[:40],
                    "source_url": source_url,
                    "source_lane": "hiring_jsonld",
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
