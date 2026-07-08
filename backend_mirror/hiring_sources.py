"""
MIRAX — Fonti hiring esterne (Indeed, InfoJobs IT, Google Jobs, LinkedIn via Google).
Query-aware: usa ruoli dalla intent per filtrare titoli offerta.
"""
from __future__ import annotations

import asyncio
import random
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin

from business_events_enrich import (
    HEADERS_POOL,
    _expand_hiring_roles,
    _lead_name,
    _make_signal,
    _utc_now_iso,
)

_JOB_TITLE_RE = re.compile(
    r"(commerciale|sales|account manager|business developer|venditor\w*|marketing manager|"
    r"programmator\w*|developer|software engineer|copywriter|seo|stage|tirocinio)",
    re.I,
)


def _role_in_text(text: str, role_variants: List[str]) -> bool:
    if not role_variants:
        return True
    lower = text.lower()
    for r in role_variants:
        if len(r) <= 4:
            if re.search(rf"\b{re.escape(r)}\b", lower):
                return True
        elif r in lower:
            return True
    return False


def _parse_job_titles_from_html(html: str, role_variants: List[str], company_hint: str = "") -> List[str]:
    titles: List[str] = []
    seen: set[str] = set()
    hint = (company_hint or "").lower()[:15]
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for el in soup.find_all(["h2", "h3", "a", "span", "li", "div"]):
            t = el.get_text(" ", strip=True)
            if not (8 <= len(t) <= 160):
                continue
            tl = t.lower()
            if tl in seen:
                continue
            if not _JOB_TITLE_RE.search(t) and not _role_in_text(t, role_variants):
                continue
            if role_variants and not _role_in_text(t, role_variants):
                continue
            if hint and hint not in tl and company_hint.lower()[:8] not in tl:
                # Google snippets may omit company — allow job-title-only lines
                if not _JOB_TITLE_RE.search(t):
                    continue
            seen.add(tl)
            titles.append(t[:200])
            if len(titles) >= 5:
                break
    except Exception:
        pass
    return titles


def _hiring_signals_from_jobs(
    jobs: List[str],
    *,
    source: str,
    source_label: str,
    url: str,
    company: str,
) -> List[Dict[str, Any]]:
    if not jobs:
        return []
    title = f"Sta assumendo — {jobs[0]}" if len(jobs) == 1 else f"Sta assumendo — {len(jobs)} offerte"
    evidence: List[Dict[str, Any]] = [
        {"label": "Fonte", "value": source_label, "source": source, "url": url, "company": company},
    ]
    for jt in jobs[:3]:
        evidence.append({"label": "Offerta", "value": jt, "source": source, "url": url, "company": company})
    return [
        _make_signal(
            "hiring",
            title,
            severity="high",
            confidence=82,
            evidence=evidence,
        )
    ]


async def detect_hiring_via_infojobs_it(
    company_name: str,
    city: str,
    roles: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """InfoJobs Italia — keyword + località."""
    name = (company_name or "").strip()
    loc = (city or "").strip().split(",")[0].strip() or "Milano"
    if len(name) < 2:
        return []
    role_variants = _expand_hiring_roles([r.strip().lower() for r in (roles or []) if str(r).strip()])
    try:
        import httpx

        # Query: ruolo + azienda quando disponibile
        kw_parts = [name]
        if role_variants:
            kw_parts.insert(0, role_variants[0])
        kw = quote(" ".join(kw_parts))
        loc_q = quote(loc)
        url = f"https://www.infojobs.it/offerte-lavoro.html?keyword={kw}&province={loc_q}&page=1"
        headers = dict(random.choice(HEADERS_POOL))
        headers["Accept-Language"] = "it-IT,it;q=0.9"
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return []
            html = resp.text or ""
        jobs = _parse_job_titles_from_html(html, role_variants, name)
        if not jobs and name.lower()[:10] in html.lower():
            # Pagina menziona l'azienda ma titoli non parsati — skip (no fake signal)
            pass
        return _hiring_signals_from_jobs(jobs, source="infojobs_it", source_label="InfoJobs Italia", url=url, company=name)
    except Exception as e:
        print(f"[enrich] infojobs_it skip: {e}", flush=True)
        return []


async def detect_hiring_via_google_jobs(
    company_name: str,
    city: str,
    roles: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Google Search aggregato: Indeed + InfoJobs + LinkedIn Jobs (no auth)."""
    name = (company_name or "").strip()
    loc = (city or "").strip().split(",")[0].strip() or "Italia"
    if len(name) < 2:
        return []
    role_variants = _expand_hiring_roles([r.strip().lower() for r in (roles or []) if str(r).strip()])
    role_q = role_variants[0] if role_variants else "offerta lavoro"
    try:
        import httpx

        q = quote(f'"{name}" {role_q} {loc} (site:it.indeed.com OR site:infojobs.it OR site:linkedin.com/jobs)')
        url = f"https://www.google.com/search?q={q}&hl=it&num=10"
        headers = dict(random.choice(HEADERS_POOL))
        headers["Accept-Language"] = "it-IT,it;q=0.9"
        await asyncio.sleep(random.uniform(0.4, 1.0))
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return []
            html = resp.text or ""
        jobs = _parse_job_titles_from_html(html, role_variants, name)
        # Estrai anche da snippet Google (h3)
        if len(jobs) < 2:
            for m in re.finditer(r"<h3[^>]*>([^<]{10,140})</h3>", html, re.I):
                t = re.sub(r"\s+", " ", m.group(1)).strip()
                if _role_in_text(t, role_variants) or (not role_variants and _JOB_TITLE_RE.search(t)):
                    if t not in jobs:
                        jobs.append(t[:200])
                if len(jobs) >= 4:
                    break
        return _hiring_signals_from_jobs(
            jobs[:4], source="google_jobs", source_label="Google Jobs (Indeed/InfoJobs/LinkedIn)", url=url, company=name
        )
    except Exception as e:
        print(f"[enrich] google_jobs skip: {e}", flush=True)
        return []


async def detect_hiring_via_linkedin_jobs(
    company_name: str,
    city: str,
    roles: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """LinkedIn Jobs via Google site: (LinkedIn blocca scrape diretto)."""
    name = (company_name or "").strip()
    loc = (city or "").strip().split(",")[0].strip() or "Italia"
    if len(name) < 2:
        return []
    role_variants = _expand_hiring_roles([r.strip().lower() for r in (roles or []) if str(r).strip()])
    role_q = role_variants[0] if role_variants else "lavoro"
    try:
        import httpx

        q = quote(f'site:linkedin.com/jobs "{name}" {role_q} {loc}')
        url = f"https://www.google.com/search?q={q}&hl=it&num=8"
        headers = dict(random.choice(HEADERS_POOL))
        async with httpx.AsyncClient(timeout=9.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return []
            html = resp.text or ""
        jobs = _parse_job_titles_from_html(html, role_variants, name)
        return _hiring_signals_from_jobs(
            jobs[:3], source="linkedin_jobs", source_label="LinkedIn Jobs", url=url, company=name
        )
    except Exception as e:
        print(f"[enrich] linkedin_jobs skip: {e}", flush=True)
        return []
