import asyncio
import json
import time
import traceback
import os
import sys
import re
import argparse
import random
import logging
import concurrent.futures
import socket
import threading
import types
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set
from urllib.parse import parse_qs, quote, unquote, urlparse, urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from html import unescape

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
except Exception:  # pragma: no cover
    FastAPI = None  # type: ignore
    HTTPException = None  # type: ignore
    BaseModel = object  # type: ignore

# Ensure imports used by backend/main.py (e.g. `import audit_engine`) work even when
# this worker is launched from the repo root.
_BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_BACKEND_DIR, ".."))
for _p in (_REPO_ROOT, _BACKEND_DIR):
    if _p and _p not in sys.path:
        sys.path.insert(0, _p)


def _install_flat_runtime_package_alias(
    backend_dir: str,
    repo_root: str,
    *,
    module_name: str,
) -> bool:
    """Expose a flat immutable release through the canonical package name.

    Staging deploys the contents of ``backend_mirror`` directly into the
    immutable release directory. Source adapters intentionally use canonical
    ``backend_mirror.*`` imports, so a flat release needs a package alias even
    though a repository checkout does not. This has no effect when the real
    package directory exists.
    """
    if os.path.isdir(os.path.join(repo_root, "backend_mirror")):
        return False
    package = sys.modules.get("backend_mirror")
    if package is None:
        package = types.ModuleType("backend_mirror")
        package.__file__ = os.path.join(backend_dir, "__init__.py")
        package.__path__ = [backend_dir]
        package.__package__ = "backend_mirror"
        sys.modules["backend_mirror"] = package
    current = sys.modules.get(module_name)
    if current is not None:
        sys.modules.setdefault("backend_mirror.worker_supabase", current)
    return True


_install_flat_runtime_package_alias(
    _BACKEND_DIR,
    _REPO_ROOT,
    module_name=__name__,
)

from job_leases import build_claim_payload, is_processing_job_stale
from url_safety import assert_safe_public_url, install_playwright_ssrf_guard
from adaptive_audit import AdaptiveAuditCache, adaptive_modules, module_payload
from maps_pagination import select_digital_audit_maps_page


def _runtime_release_id() -> str:
    configured = str(os.getenv("MIRAX_RELEASE_ID") or "").strip()
    if configured:
        return configured[:80]
    try:
        with open(os.path.join(_BACKEND_DIR, ".release-id"), "r", encoding="utf-8") as handle:
            return handle.read(80).strip() or "development"
    except OSError:
        return "development"

try:
    from business_events_enrich import detect_crm_from_html
except Exception:
    detect_crm_from_html = None  # type: ignore

_CORE_NORMALIZE_PHONE = None


app = FastAPI() if FastAPI is not None else None


def _run_coro_blocking(coro):
    """Run async coroutine from sync code; safe inside an active event loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def normalize_phone_italy(value: Optional[str]) -> Optional[str]:
    global _CORE_NORMALIZE_PHONE
    if not value:
        return None

    # Prefer the authoritative implementation from backend.main (lazy import + cache).
    if _CORE_NORMALIZE_PHONE is None:
        try:
            from backend import main as core  # type: ignore

            _CORE_NORMALIZE_PHONE = getattr(core, "normalize_phone_italy", None)
        except Exception:
            _CORE_NORMALIZE_PHONE = False

    if callable(_CORE_NORMALIZE_PHONE):
        try:
            return _CORE_NORMALIZE_PHONE(value)
        except Exception:
            pass

    # Fallback: keep only digits and leading '+' (best-effort, non-throwing)
    try:
        s = str(value).strip()
        if not s:
            return None
        keep_plus = s.startswith("+")
        digits = re.sub(r"\D+", "", s)
        if not digits:
            return None
        return ("+" if keep_plus else "") + digits
    except Exception:
        return None


def _digits_only_phone(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Keep only digits and leading '+'
    keep_plus = s.startswith("+")
    digits = re.sub(r"\D+", "", s)
    if not digits:
        return None
    return ("+" if keep_plus else "") + digits

def _normalize_phone_compound(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None

    # Preserve explicit separators (avoid concatenating into a single huge number)
    if "/" in raw:
        parts = [p.strip() for p in raw.split("/")]
        normalized_parts: List[str] = []
        for p in parts:
            if not p:
                continue
            np = normalize_phone_italy(p)
            if np:
                normalized_parts.append(np)
        if normalized_parts:
            normalized_parts = list(dict.fromkeys(normalized_parts))
            return " / ".join(normalized_parts)
        return None

    return normalize_phone_italy(raw)


_FAKE_EMAIL_MARKERS = (
    "example.com", "company.com", "yourdomain", "yoursite", "tuodominio", "tuosito",
    "ninjamailtrap", "mailtrap", "sentry", "wixpress", "email.com", "domain.com",
    "sample.com", "placeholder.com",
)

_GLOBAL_BRAND_DOMAINS = (
    "nike.com",
    "ferrari.com",
    "uniqlo.com",
    "primark.com",
    "urbanoutfitters.com",
    "ikea.com",
    "zara.com",
    "hm.com",
    "apple.com",
    "microsoft.com",
    "google.com",
    "amazon.",
    "mediaset.it",
    "iliad.it",
    "acer.com",
)

_GLOBAL_BRAND_PATTERNS = (
    (re.compile(r"\buniqlo\b", re.I), "uniqlo"),
    (re.compile(r"\bprimark\b", re.I), "primark"),
    (re.compile(r"\burban\s+outfitters\b", re.I), "urban outfitters"),
    (re.compile(r"\bnike(?:\s+(?:milano|roma|store|flagship|retail|shop))?\b", re.I), "nike"),
    (re.compile(r"\bferrari\s+(?:flagship|store|official|milano|roma)\b", re.I), "ferrari"),
    (re.compile(r"\bikea\b", re.I), "ikea"),
    (re.compile(r"\bzara\b", re.I), "zara"),
    (re.compile(r"\bh\s*&\s*m\b|\bhm\s+(?:store|milano|roma)\b", re.I), "h&m"),
    (re.compile(r"\bapple\s+store\b", re.I), "apple"),
    (re.compile(r"\bgalleria\s+vittorio\s+emanuele\b", re.I), "galleria vittorio emanuele"),
)

_SMB_SIGNAL_CONTEXT_RE = re.compile(
    r"\b(pmi|piccol[aeio]?|medie?\s+imprese?|local[ei]|non\s+famose?|lead\s+cald|"
    r"a\s+cui\s+vendere|prospect|sales\s+intelligence|lead\s+generation|outreach|"
    r"segnal[ei]\s+d.?acquisto|invest\w*\s+in\s+marketing|budget\s+marketing|ads\s+attiv[ei])\b",
    re.I,
)


def _enterprise_lead_reason(lead: Dict[str, Any]) -> Optional[str]:
    domain_raw = str(lead.get("sito") or lead.get("website") or "").strip().lower()
    domain = re.sub(r"^https?://", "", domain_raw)
    domain = re.sub(r"^www\.", "", domain)
    domain = domain.split("/", 1)[0].strip()
    if domain:
        for blocked in _GLOBAL_BRAND_DOMAINS:
            if domain == blocked or domain.endswith(f".{blocked}") or blocked in domain:
                return f"global-brand-domain:{blocked}"

    haystack = " ".join(
        str(lead.get(key) or "").strip()
        for key in ("azienda", "nome", "business_name", "name", "categoria", "category", "sito", "website")
        if str(lead.get(key) or "").strip()
    )
    for pattern, label in _GLOBAL_BRAND_PATTERNS:
        if pattern.search(haystack):
            return f"global-brand-name:{label}"
    return None


def _enterprise_guard_context(intent: Optional[Dict[str, Any]]) -> str:
    if not isinstance(intent, dict):
        return ""
    parts: List[str] = []
    for key in ("original_query", "query", "user_query", "intent_summary", "category", "categoria"):
        value = intent.get(key)
        if value:
            parts.append(str(value))
    for value in intent.get("required_signals") or []:
        parts.append(str(value))
    hypothesis = intent.get("commercial_hypothesis")
    if isinstance(hypothesis, dict):
        for key in ("offer", "target_profile", "buyer_pains", "buying_signals", "disqualifiers"):
            value = hypothesis.get(key)
            if isinstance(value, list):
                parts.extend(str(item) for item in value)
            elif value:
                parts.append(str(value))
    return " ".join(parts)


def _should_reject_enterprise_lead(lead: Dict[str, Any], intent: Optional[Dict[str, Any]]) -> bool:
    reason = _enterprise_lead_reason(lead)
    if not reason:
        return False
    context = _enterprise_guard_context(intent)
    required = set(_required_signals_from_intent(intent))
    if required or not context.strip() or _SMB_SIGNAL_CONTEXT_RE.search(context):
        return True
    return False


def _non_target_lead_reason(lead: Dict[str, Any]) -> Optional[str]:
    """Reject source portals, universities/blogs and known non-target entities as leads."""
    if not isinstance(lead, dict):
        return "invalid-lead"
    name = str(
        lead.get("azienda")
        or lead.get("nome")
        or lead.get("business_name")
        or lead.get("name")
        or ""
    ).strip()
    website = str(lead.get("sito") or lead.get("website") or "").strip()
    try:
        from agents.portal_blacklist import is_blacklisted_domain, is_blacklisted_name, normalize_domain

        domain = normalize_domain(website)
        if domain and is_blacklisted_domain(domain):
            return f"blacklisted-domain:{domain}"
        if name and is_blacklisted_name(name):
            # Keep local legal-entity homonyms alive when they have their own
            # non-blacklisted official domain; enterprise patterns handle the
            # famous-brand cases separately.
            local_legal_entity = bool(re.search(r"\b(srl|s\.r\.l\.|spa|s\.p\.a\.|snc|sas|societa|societ[aà])\b", name, re.I))
            if not (domain and local_legal_entity):
                return f"blacklisted-name:{name[:60]}"
    except Exception:
        return None
    return None


def _is_real_business_email(value: Optional[str]) -> bool:
    email = str(value or "").strip().lower()
    if not email or "@" not in email:
        return False
    if email in {"n/d", "n/a", "n.d.", "none", "null", "-", "—"}:
        return False
    if any(x in email for x in _FAKE_EMAIL_MARKERS):
        return False
    if re.search(r"\.(png|jpg|jpeg|gif|webp|svg|css|js|woff2?|ttf|eot|ico)$", email):
        return False
    return True


def _clean_business_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    m = re.search(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", str(value))
    if not m:
        return None
    email = m.group(0).strip().lower()
    return email if _is_real_business_email(email) else None


def _extract_real_email_from_html(html: Optional[str]) -> Optional[str]:
    for raw in re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", str(html or "")):
        email = _clean_business_email(raw)
        if email:
            return email
    return None


def _extract_phone_from_html_any(html: Optional[str]) -> Optional[str]:
    if not html:
        return None
    text = unescape(str(html or "")).replace("\u00a0", " ")
    for raw in re.findall(r"tel:([^\"'<>\\s]+)", text, flags=re.IGNORECASE):
        phone = _normalize_phone_compound(raw)
        if phone and len(re.sub(r"\D+", "", phone)) >= 8:
            return phone
    for raw in re.findall(r"(?<!\d)(?:\+39\s*|0039\s*)?(?:0\d{1,4}|3\d{2})(?:[\s.\-/]*\d){6,9}(?!\d)", text):
        phone = _normalize_phone_compound(raw)
        if phone:
            digits = re.sub(r"\D+", "", phone)
            if 8 <= len(digits) <= 13:
                return phone
    return None


async def _scrape_site_contacts_light(url: str, html_home: Optional[str] = None) -> Dict[str, Optional[str]]:
    out: Dict[str, Optional[str]] = {
        "email": _extract_real_email_from_html(html_home),
        "phone": _extract_phone_from_html_any(html_home),
        "instagram": _extract_first_social_link(html_home, "instagram"),
        "facebook": _extract_first_social_link(html_home, "facebook"),
        "linkedin": _extract_first_social_link(html_home, "linkedin"),
    }
    if out.get("email") and out.get("phone"):
        return out
    try:
        import httpx
        base = f"{urlparse(url if str(url).startswith('http') else f'https://{url}').scheme}://{urlparse(url if str(url).startswith('http') else f'https://{url}').netloc}"
        candidates = ["/contatti", "/contatti/", "/contatto", "/contact", "/contact/", "/contattaci", "/azienda", "/chi-siamo"]
        for href in re.findall(r'href=["\']([^"\']+)["\']', str(html_home or ""), flags=re.IGNORECASE):
            href_l = href.lower()
            if any(x in href_l for x in ["contatt", "contact", "azienda", "chi-siamo", "about"]):
                full = urljoin(base + "/", href)
                if full not in candidates:
                    candidates.insert(0, full)
        timeout = httpx.Timeout(8.0, connect=4.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False) as client:
            for path in candidates[:10]:
                page_url = path if str(path).lower().startswith(("http://", "https://")) else urljoin(base + "/", path.lstrip("/"))
                try:
                    r = await client.get(page_url, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "it-IT,it;q=0.9,en;q=0.8"})
                    if r.status_code >= 400:
                        continue
                    html = r.text or ""
                    if not out.get("email"):
                        out["email"] = _extract_real_email_from_html(html)
                    if not out.get("phone"):
                        out["phone"] = _extract_phone_from_html_any(html)
                    if not out.get("instagram"):
                        out["instagram"] = _extract_first_social_link(html, "instagram")
                    if not out.get("facebook"):
                        out["facebook"] = _extract_first_social_link(html, "facebook")
                    if not out.get("linkedin"):
                        out["linkedin"] = _extract_first_social_link(html, "linkedin")
                    if out.get("email") and out.get("phone"):
                        return out
                except Exception:
                    continue
    except Exception:
        pass
    return out


def _extract_first_social_link(html: Optional[str], kind: str) -> Optional[str]:
    if not html:
        return None
    h = str(html)
    if kind == "instagram":
        pat = re.compile(r"https?://(?:www\.)?instagram\.com/[^\s'\"<>]+", re.IGNORECASE)
    elif kind == "facebook":
        pat = re.compile(r"https?://(?:www\.)?(?:facebook\.com|fb\.me)/[^\s'\"<>]+", re.IGNORECASE)
    elif kind == "linkedin":
        pat = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:company|in)/[^\s'\"<>]+", re.IGNORECASE)
    else:
        return None

    m = pat.search(h)
    if not m:
        return None
    url = (m.group(0) or "").strip().rstrip(").,;\"")
    return url or None


async def process_single_url(url: str) -> Dict[str, Any]:
    import re
    from backend.main import (
        audit_from_html,
        deep_scrape_email_from_website,
        deep_scrape_mobile_from_website,
        detect_tech_stack,
        extract_email_from_html,
        normalize_phone_italy,
    )
    from backend.audit_engine import run_technical_audit
    
    assert_safe_public_url(url)
    result = {
        "nome": None, "sito": url, "telefono": None, "email": None,
        "indirizzo": None, "citta": None, "categoria": None,
        "has_pixel": False, "has_gtm": False, "has_google_ads": False,
        "has_ssl": url.startswith("https"),
        "seo_errors": [], "load_speed_seconds": None, "tech_stack": None
    }
    
    try:
        # Use Playwright exactly like the worker loop does
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await install_playwright_ssrf_guard(page)
            
            pixel_found = False
            gtm_found = False
            requests_log = []
            page_title = None
            
            page.on("request", lambda req: requests_log.append(req.url))
            
            await page.goto(url, timeout=15000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=3000)
            except Exception:
                pass
            await page.wait_for_timeout(800)
            try:
                page_title = await page.title()
            except Exception:
                page_title = None
            html = await page.content()
            await browser.close()
            
            # Check pixel in HTML and network requests
            raw_lower = html.lower()
            pixel_found = (
                "fbevents.js" in raw_lower
                or "connect.facebook.net" in raw_lower
                or "fbq('init'" in raw_lower
                or 'fbq("init"' in raw_lower
                or "facebook.com/tr?id=" in raw_lower
                or any("fbevents.js" in r or "connect.facebook.net" in r or "facebook.com/tr" in r for r in requests_log)
            )
            gtm_found = (
                "gtm.js" in raw_lower
                or bool(re.search(r"\bGTM-[A-Z0-9]+\b", html))
                or any("gtm.js" in r or "GTM-" in r for r in requests_log)
            )
            ads_strings = ["googleads.g.doubleclick.net", "google_conversion", "gtag('config', 'AW-"]

            ads_found = any(
                any(s in r for r in requests_log) or s in html
                for s in ads_strings
            )
            
            result["has_pixel"] = pixel_found
            result["has_gtm"] = gtm_found
            result["has_google_ads"] = ads_found
            
            # Extract email
            email = None
            try:
                email = extract_email_from_html(html)
            except Exception:
                email = None
            email = _clean_business_email(email)
            if not email:
                email = _extract_real_email_from_html(html)
            if not email:
                email = _clean_business_email(await asyncio.wait_for(
                    deep_scrape_email_from_website(url, html_home=html),
                    timeout=8,
                ))
            light_contacts = None
            if not email:
                light_contacts = await _scrape_site_contacts_light(url, html)
                email = _clean_business_email(light_contacts.get("email"))
            result["email"] = email
            
            # Extract phone
            telefono = None
            try:
                telefono = await asyncio.wait_for(
                    deep_scrape_mobile_from_website(url, html),
                    timeout=8.0,
                )
            except Exception:
                telefono = None
            if not telefono:
                if light_contacts is None:
                    light_contacts = await _scrape_site_contacts_light(url, html)
                telefono = light_contacts.get("phone")
            if not telefono:
                phone_match = re.search(
                    r'(\+39[\s.]?)?(0\d{1,3}[\s.\-\/]\d{3,8}|3\d{2}[\s.\-]\d{6,7}|\+39\s*3\d{9})',
                    html,
                )
                if phone_match:
                    try:
                        telefono = normalize_phone_italy(phone_match.group(0).strip())
                    except Exception:
                        telefono = phone_match.group(0).strip()
            # Guardrail: drop too-short numbers (common false positives)
            if telefono:
                digits = re.sub(r"\D+", "", str(telefono))
                if len(digits) < 8:
                    telefono = None
            result["telefono"] = telefono
            
            # Extract nome from title
            nome = None
            if isinstance(page_title, str) and page_title.strip():
                nome = page_title.strip()
            else:
                title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
                if title_match:
                    nome = title_match.group(1).strip()
            if isinstance(nome, str) and nome.strip():
                for suffix in [' - Home', ' | Home', ' – Home', ' - Benvenuto', ' | Benvenuto']:
                    nome = nome.replace(suffix, '')
                result["nome"] = nome.strip()
            
            # Tech stack
            try:
                result["tech_stack"] = detect_tech_stack(html)
            except Exception:
                pass

            instagram = _extract_first_social_link(html, "instagram")
            facebook = _extract_first_social_link(html, "facebook")
            linkedin = _extract_first_social_link(html, "linkedin")
            if not (instagram and facebook and linkedin):
                if light_contacts is None:
                    light_contacts = await _scrape_site_contacts_light(url, html)
                instagram = instagram or light_contacts.get("instagram")
                facebook = facebook or light_contacts.get("facebook")
                linkedin = linkedin or light_contacts.get("linkedin")
            result["instagram"] = instagram
            result["facebook"] = facebook
            result["linkedin"] = linkedin
            result["instagram_missing"] = not bool(instagram)
            
            # SSL
            result["has_ssl"] = url.startswith("https")
            
    except Exception as e:
        print(f"[process_single_url] error: {e}")
    
    # Run technical audit for SEO and speed
    try:
        tech = await asyncio.to_thread(run_technical_audit, url)
        result["seo_errors"] = tech.get("issues", [])
        result["load_speed_seconds"] = tech.get("load_speed_seconds")
        if not result.get("telefono") and tech.get("phone"):
            result["telefono"] = _normalize_phone_compound(tech.get("phone"))
        if not result["has_google_ads"]:
            result["has_google_ads"] = tech.get("has_google_ads", False)
    except Exception as e:
        print(f"[process_single_url] tech audit error: {e}")

    # Compatibility payload for frontend/business result shape
    try:
        result["meta_pixel"] = bool(result.get("has_pixel"))
        result["google_tag_manager"] = bool(result.get("has_gtm"))
        result["pixel_missing"] = not bool(result.get("has_pixel"))
        result["tiktok_missing"] = True
        result["audit"] = {
            "has_ssl": bool(result.get("has_ssl")),
            "is_mobile_responsive": False,
            "has_facebook_pixel": bool(result.get("has_pixel")),
            "has_tiktok_pixel": False,
            "has_gtm": bool(result.get("has_gtm")),
            "missing_instagram": not bool(result.get("instagram")),
        }
    except Exception:
        pass
    
    return result


if app is not None:
    @app.get("/health")
    async def health() -> Dict[str, str]:
        return {"status": "ok", "service": "mirax-worker-api", "release_id": _runtime_release_id()}

    @app.get("/api/v1/health")
    async def health_v1() -> Dict[str, Any]:
        """Stato fonti enrichment MIRAX v5 (health monitor + cache)."""
        try:
            from resilience import get_resilience_status

            return {
                "status": "ok",
                "service": "mirax-worker-api",
                "release_id": _runtime_release_id(),
                **get_resilience_status(),
            }
        except Exception as e:
            return {
                "status": "degraded",
                "service": "mirax-worker-api",
                "release_id": _runtime_release_id(),
                "error": str(e),
            }

    class _AuditUrlRequest(BaseModel):
        url: str


    @app.post("/audit-url")
    async def audit_url(payload: _AuditUrlRequest) -> Dict[str, Any]:
        try:
            return await process_single_url(payload.url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    class _ReauditRequest(BaseModel):
        max: int = 20

    @app.post("/reaudit")
    async def trigger_reaudit(payload: _ReauditRequest) -> Dict[str, Any]:
        """Avvia re-audit batch in background (per cron VPS o trigger manuale)."""
        import threading

        max_l = max(1, min(50, int(payload.max or 20)))

        def _run() -> None:
            try:
                run_reaudit_worker(max_leads=max_l)
            except Exception as e:
                print(f"[reaudit] background error: {e}", flush=True)

        threading.Thread(target=_run, daemon=True).start()
        return {"ok": True, "started": True, "max": max_l}

    class _EnrichHiringBatchRequest(BaseModel):
        leads: List[Dict[str, Any]]
        location: str = "Milano"
        max_leads: int = 120
        intent: Optional[Dict[str, Any]] = None

    @app.post("/enrich-hiring-batch")
    async def enrich_hiring_batch(payload: _EnrichHiringBatchRequest) -> Dict[str, Any]:
        """Indeed / segnali esterni su batch lead (post-Maps)."""
        leads_in = [dict(x) for x in (payload.leads or []) if isinstance(x, dict)]
        try:
            from business_events_enrich import enrich_results_business_events, resolve_enrichment_cap

            cap = resolve_enrichment_cap(payload.intent, len(leads_in))
            cap = max(1, min(int(payload.max_leads or cap), cap, len(leads_in)))
        except Exception:
            cap = max(1, min(int(payload.max_leads or 40), len(leads_in)))
        batch = leads_in[:cap]
        if not batch:
            return {"ok": True, "enriched": 0, "leads": []}
        try:
            from business_events_enrich import enrich_results_business_events

            loc = (payload.location or "Milano").strip() or "Milano"
            await enrich_results_business_events(
                batch,
                loc,
                max_leads=cap,
                external_only=True,
                intent=payload.intent,
            )
            n = sum(1 for l in batch if l.get("business_hiring_jobs") or any(
                s.get("type") == "hiring" for s in (l.get("business_signals") or []) if isinstance(s, dict)
            ))
            print(f"[enrich-hiring-batch] {n}/{cap} con hiring", flush=True)
            return {"ok": True, "enriched": n, "processed": cap, "leads": batch}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


async def _scrape_single_place_fallback(category: str, location: str, zone: Optional[str]) -> List[Dict[str, Any]]:
    """Fallback scraper for the 'single place card' scenario.

    When Google Maps opens directly a single business detail view (no list/feed),
    the core scraper may return 0 results. This function extracts the visible
    business fields from the detail panel and returns a single-row list.
    """

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as e:
        raise RuntimeError("Playwright not installed") from e

    def _compose_query() -> str:
        z = (zone or "").strip()
        if not z or z.lower() == "tutta la città":
            return f"{category} {location}"
        return f"{category} {location} {z}"

    q = _compose_query()
    url = f"https://www.google.com/maps/search/{quote(q)}?hl=it&gl=it&entry=ttu"

    def _normalize_phone_text(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        v = " ".join(str(value).split())
        v = re.sub(r"^telefono\s*:??\s*", "", v, flags=re.IGNORECASE)
        v = v.strip()
        return v or None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=[
                "--lang=it-IT",
                "--disable-blink-features=AutomationControlled",
                "--no-default-browser-check",
            ],
        )
        context = browser.new_context(
            locale="it-IT",
            timezone_id="Europe/Rome",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1400, "height": 900},
        )
        page = context.new_page()
        page.set_default_timeout(20000)

        page.goto(url, wait_until="domcontentloaded", timeout=55000)
        page.wait_for_timeout(1400)

        # If a feed/list exists, this is not the single-card case.
        cards = page.locator('div[role="article"]')
        alt_cards = page.locator("div.Nv2PK")
        feed = page.locator('div[role="feed"]')
        if cards.count() > 0 or alt_cards.count() > 0 or feed.count() > 0:
            context.close()
            browser.close()
            return []

        # Best-effort extraction from detail view
        name = None
        for css in ("h1.DUwDvf", "h1", "div.DUwDvf"):
            try:
                t = page.locator(css).first.text_content(timeout=2500)
                t = (t or "").strip()
                if t:
                    name = t
                    break
            except Exception:
                continue

        address = None
        try:
            address = page.locator('button[data-item-id="address"]').first.text_content(timeout=2000)
        except Exception:
            address = None

        phone = None
        try:
            v = page.locator('button[data-item-id^="phone"]').first.text_content(timeout=2000)
            phone = _normalize_phone_text(v)
        except Exception:
            phone = None

        website = None
        try:
            website = page.locator('a[data-item-id="authority"]').first.get_attribute("href", timeout=2000)
        except Exception:
            website = None

        context.close()
        browser.close()

        if not name:
            return []
        return [
            {
                "business_name": name,
                "address": address.strip() if address else None,
                "phone": phone.strip() if phone else None,
                "website": website,
            }
        ]


async def _scrape_reviews_and_competitors(
    business_name: str,
    category: str,
    location: str,
) -> Dict[str, Any]:
    """Scrapa recensioni e competitor da Google Maps. Non-blocking: 
    in caso di errore ritorna dict vuoto senza crashare il worker."""
    result = {"google_reviews": [], "local_competitors": []}
    try:
        import random
        import re
        from playwright.async_api import async_playwright
        from urllib.parse import quote

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
            context = await browser.new_context(
                locale="it-IT",
                timezone_id="Europe/Rome",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1400, "height": 900},
            )

            # --- RECENSIONI ---
            try:
                page = await context.new_page()
                query = quote(f"{business_name} {location}")
                url = f"https://www.google.com/maps/search/{query}?hl=it&gl=it"
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(random.uniform(1500, 2500))

                # Accetta cookie Google
                try:
                    await page.click(
                        'button:has-text("Accetta tutto")',
                        timeout=5000
                    )
                    await page.wait_for_timeout(2000)
                except:
                    try:
                        await page.click(
                            'button:has-text("Accept all")',
                            timeout=3000
                        )
                        await page.wait_for_timeout(2000)
                    except:
                        pass

                # Clicca sul primo risultato se siamo in lista
                first_result = page.locator('div.Nv2PK').first
                if await first_result.count() > 0:
                    await first_result.click()
                    await page.wait_for_timeout(random.uniform(1500, 2000))

                # Clicca sul tab Recensioni
                reviews_tab = page.locator('button[aria-label*="ecensioni"], button[data-tab-index="1"]').first
                if await reviews_tab.count() > 0:
                    await reviews_tab.click()
                    await page.wait_for_timeout(random.uniform(1000, 1500))

                # Scrapa le recensioni visibili (max 5)
                review_blocks = page.locator('div[data-review-id]')
                count = min(await review_blocks.count(), 5)
                reviews = []
                for idx in range(count):
                    try:
                        block = review_blocks.nth(idx)
                        # Espandi testo se presente
                        more_btn = block.locator('button.w8nwRe')
                        if await more_btn.count() > 0:
                            await more_btn.click()
                            await page.wait_for_timeout(300)
                        text = await block.locator('span.wiI7pd').first.text_content(timeout=2000)
                        stars_attr = await block.locator('span[aria-label*="stell"]').first.get_attribute('aria-label', timeout=2000)
                        stars = 5
                        if stars_attr:
                            m = re.search(r'(\d)', stars_attr)
                            if m:
                                stars = int(m.group(1))
                        if text and text.strip():
                            reviews.append({"text": text.strip()[:500], "stars": stars})
                    except Exception:
                        continue
                result["google_reviews"] = reviews
                await page.close()
            except Exception as e:
                print(f"[reviews_scraper] Errore recensioni: {e}")

            # --- COMPETITOR ---
            try:
                page2 = await context.new_page()
                comp_query = quote(f"{category} {location}")
                comp_url = f"https://www.google.com/maps/search/{comp_query}?hl=it&gl=it"
                await page2.goto(comp_url, wait_until="domcontentloaded", timeout=30000)
                await page2.wait_for_timeout(random.uniform(1500, 2500))

                # Accetta cookie Google
                try:
                    await page2.click(
                        'button:has-text("Accetta tutto")',
                        timeout=5000
                    )
                    await page2.wait_for_timeout(2000)
                except:
                    try:
                        await page2.click(
                            'button:has-text("Accept all")',
                            timeout=3000
                        )
                        await page2.wait_for_timeout(2000)
                    except:
                        pass

                competitor_cards = page2.locator('div.Nv2PK')
                total = min(await competitor_cards.count(), 6)
                competitors = []
                for idx in range(total):
                    try:
                        card = competitor_cards.nth(idx)
                        name = await card.locator('div.qBF1Pd').first.text_content(timeout=1500)
                        if not name or name.strip().lower() == business_name.strip().lower():
                            continue
                        rating_el = card.locator('span.MW4etd')
                        rating = None
                        if await rating_el.count() > 0:
                            rt = await rating_el.first.text_content(timeout=1000)
                            try:
                                rating = float(rt.replace(',', '.'))
                            except Exception:
                                pass
                        reviews_el = card.locator('span.UY7F9')
                        reviews_count = None
                        if await reviews_el.count() > 0:
                            rc = await reviews_el.first.text_content(timeout=1000)
                            try:
                                reviews_count = int(re.sub(r'\D', '', rc))
                            except Exception:
                                pass
                        competitors.append({
                            "name": name.strip(),
                            "rating": rating,
                            "reviews_count": reviews_count,
                        })
                        if len(competitors) >= 5:
                            break
                    except Exception:
                        continue
                result["local_competitors"] = competitors
                await page2.close()
            except Exception as e:
                print(f"[reviews_scraper] Errore competitor: {e}")

            await context.close()
            await browser.close()

    except Exception as e:
        print(f"[reviews_scraper] Errore generale: {e}")

    return result


_REVIEW_POSITIVE_WORDS = {
    "buono", "buon", "ottimo", "eccellente", "fantastico", "bello", "magnifico",
    "delizioso", "cordiale", "gentile", "professionale", "consigliato", "perfetto",
    "impeccabile", "gradevole", "piacevole", "valido", "soddisfatto", "contento",
    "felice", "bravo", "qualità", "pulito", "rapido", "veloce", "simpatico",
    "accogliente", "cortese", "disponibile", "ottima", "bellissimo", "buonissimo",
    "speciale", "unico", "adoro", "amore", "top", "super", "positive", "positive",
}
_REVIEW_NEGATIVE_WORDS = {
    "brutto", "pessimo", "scarso", "orribile", "terribile", "maleducato", "scortese",
    "lento", "sporco", "caro", "deludente", "insufficiente", "negativo", "problemi",
    "errore", "difetto", "disastro", "orrore", "schifo", "pessima", "bruttissimo",
    "orrendo", "cattivo", "cattiva", "difettoso", "lamentele", "lamentela", "triste",
    "arrabbiato", "deluso", "delusa", "scadente", "inferiore", "disgustoso", "squallido",
    "fuori", "peggio", "peggiore", "noioso", "rumoroso", "affollato", "scortesia",
}
_REVIEW_NEGATIONS = {"non", "mai", "nessuno", "nessuna", "nulla", "neanche", "nemmeno", "neppure"}
_REVIEW_INTENSIFIERS = {"molto", "troppo", "davvero", "veramente", "estremamente", "assolutamente", "incredibilmente", "super", "super"}


def _analyze_review_sentiment(reviews: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Simple lexicon-based sentiment for Italian/English Google review snippets."""
    if not reviews:
        return {"score": 0.0, "label": "neutral", "reviews": []}

    analyzed = []
    total = 0.0
    for review in reviews:
        text = str(review.get("text") or "").lower()
        stars = review.get("stars")
        words = re.findall(r"[a-zàèéìòù']+", text)
        score = 0.0
        i = 0
        while i < len(words):
            w = words[i]
            modifier = 1.0
            # Check for negation/intensifier on the previous token
            if i > 0:
                if words[i - 1] in _REVIEW_NEGATIONS:
                    modifier *= -1.0
                if words[i - 1] in _REVIEW_INTENSIFIERS:
                    modifier *= 1.5
            if w in _REVIEW_POSITIVE_WORDS:
                score += 1.0 * modifier
            elif w in _REVIEW_NEGATIVE_WORDS:
                score -= 1.0 * modifier
            i += 1

        # Normalize rough text score to [-1, 1]
        text_score = max(-1.0, min(1.0, score / max(3.0, abs(score))))

        # Blend with star rating when available (1 star -> -1, 5 stars -> +1)
        if isinstance(stars, (int, float)) and 1 <= stars <= 5:
            star_score = (stars - 3) / 2.0
            final_score = 0.6 * text_score + 0.4 * star_score
        else:
            final_score = text_score

        final_score = round(max(-1.0, min(1.0, final_score)), 3)
        analyzed.append({"text": review.get("text", "")[:200], "stars": stars, "score": final_score})
        total += final_score

    avg = round(total / len(analyzed), 3) if analyzed else 0.0
    label = "positive" if avg > 0.25 else "negative" if avg < -0.25 else "neutral"
    return {"score": avg, "label": label, "reviews": analyzed}


try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None

try:
    from supabase import create_client  # type: ignore
except Exception:  # pragma: no cover
    create_client = None


def _require_env(name: str) -> str:
    """Fail fast if a required environment variable is missing or empty."""
    value = (os.getenv(name) or "").strip()
    if not value:
        print(f"[worker_supabase] FATAL: variabile d'ambiente {name} mancante.")
        raise SystemExit(2)
    return value


SUPABASE_URL = _require_env("SUPABASE_URL")


def _get_supabase_key() -> str:
    # Load .env from repo root (local convenience). Optional dependency.
    try:
        if load_dotenv is not None:
            env_path = os.path.join(_REPO_ROOT, ".env")
            load_dotenv(dotenv_path=env_path)
        else:
            # If python-dotenv is missing, environment variables can still be provided by the shell.
            pass
    except Exception:
        pass

    # Server-side code MUST use the service role key. Do NOT fall back to
    # publishable/anon keys: RLS write policies require service_role, and using
    # a weak credential silently breaks the worker.
    k = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not k:
        print("[worker_supabase] FATAL: SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_KEY) mancante.")
        raise SystemExit(2)
    return k


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _calc_freshness_score(last_audited_iso: Optional[str]) -> int:
    """Returns 0-100. Decays over 30 days."""
    if not last_audited_iso:
        return 0
    try:
        last = datetime.fromisoformat(str(last_audited_iso).replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age_days = (now - last).total_seconds() / 86400
        score = max(0, int(100 - (age_days / 30) * 100))
        return score
    except Exception:
        return 0


def _calc_opportunity_score(r: Dict[str, Any]) -> int:
    """Rule-based opportunity score (0-100). See docs/SCORE_AI_RULES.md — no ML."""
    score = 0
    try:
        tech = r.get("tech_stack") or []
        stack = " ".join(tech).lower() if isinstance(tech, list) else ""
        tr = r.get("technical_report") or {}

        if not r.get("meta_pixel") or "no pixel" in stack:
            score += 25
        if not r.get("sito") and not r.get("website"):
            score += 30
        if not r.get("instagram"):
            score += 10
        if tr.get("seo_disaster") or "disastro seo" in stack:
            score += 15
        if tr.get("has_dmarc") is False or "no dmarc" in stack:
            score += 10
        if "no mobile" in stack or "not mobile" in stack:
            score += 5
        if isinstance(tr.get("load_speed_seconds"), (int, float)) and float(tr.get("load_speed_seconds", 0) or 0) > 4.0:
            score += 5

        rating = r.get("rating")
        if isinstance(rating, (int, float)):
            if float(rating) < 3.5:
                score += 20
            elif float(rating) < 4.0:
                score += 10

        reviews = r.get("reviews_count") or 0
        if isinstance(reviews, (int, float)) and int(reviews) < 10:
            score += 5
    except Exception:
        pass
    return min(int(score), 100)


def _detect_changes(old: Dict[str, Any], new: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Compare old and new audit results and return change events."""
    changes: List[Dict[str, Any]] = []
    now = _utc_now_iso()
    logger = logging.getLogger("worker_supabase.changes")

    fields_to_watch = [
        ("meta_pixel", "Meta Pixel"),
        ("google_tag_manager", "Google Tag Manager"),
        ("instagram", "Instagram"),
        ("facebook", "Facebook"),
        ("sito", "Sito Web"),
        ("email", "Email"),
    ]

    try:
        for field, label in fields_to_watch:
            old_val = bool(old.get(field))
            new_val = bool(new.get(field))
            if old_val != new_val:
                changes.append(
                    {
                        "field": field,
                        "label": label,
                        "from": old_val,
                        "to": new_val,
                        "detected_at": now,
                        "signal": f"{label} {'installato' if new_val else 'rimosso'}",
                    }
                )

        old_rating = old.get("rating")
        new_rating = new.get("rating")
        if isinstance(old_rating, (int, float)) and isinstance(new_rating, (int, float)):
            diff = float(new_rating) - float(old_rating)
            if abs(diff) >= 0.3:
                direction = "salito" if diff > 0 else "sceso"
                changes.append(
                    {
                        "field": "rating",
                        "label": "Rating Google",
                        "from": old_rating,
                        "to": new_rating,
                        "detected_at": now,
                        "signal": f"Rating {direction} da {old_rating} a {new_rating}",
                    }
                )

        had_site = bool(old.get("sito") or old.get("website"))
        has_site = bool(new.get("sito") or new.get("website"))
        if had_site != has_site:
            changes.append(
                {
                    "field": "website_status",
                    "label": "Sito Web",
                    "from": had_site,
                    "to": has_site,
                    "detected_at": now,
                    "signal": "Sito web creato!" if has_site else "Sito web offline",
                }
            )
    except Exception as e:
        try:
            logger.warning(f"[changes] Errore detection: {e}")
        except Exception:
            pass

    return changes


def _format_results(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        azienda_raw = r.get("business_name")
        azienda = (str(azienda_raw).strip() if azienda_raw is not None else "")
        if not azienda:
            azienda = "N/A"

        telefono = _normalize_phone_compound(r.get("phone")) or ""

        email_raw = r.get("email")
        email = (str(email_raw).strip() if email_raw is not None else "")

        website_raw = r.get("website")
        website = None
        try:
            ws = (str(website_raw).strip() if website_raw is not None else "")
            website = ws or None
        except Exception:
            website = None

        citta_raw = r.get("city")
        indirizzo_raw = r.get("address")
        try:
            from entity_matcher import resolve_lead_city

            citta = resolve_lead_city(
                str(citta_raw).strip() if citta_raw is not None else None,
                str(indirizzo_raw).strip() if indirizzo_raw is not None else None,
            )
        except ImportError:
            citta = (str(citta_raw).strip() if citta_raw is not None else "")
            if not citta:
                citta = "N/A"

        indirizzo = (str(indirizzo_raw).strip() if indirizzo_raw is not None else "")

        tech_stack_list_raw = r.get("tech_stack")
        tech_stack_list: List[str] = []
        if isinstance(tech_stack_list_raw, list):
            for x in tech_stack_list_raw:
                sx = str(x).strip()
                if sx:
                    tech_stack_list.append(sx)
        elif isinstance(tech_stack_list_raw, str):
            ts = tech_stack_list_raw.strip()
            if ts:
                tech_stack_list = [ts]
        if not tech_stack_list:
            tech_stack_list = ["Verifica in corso"]

        result_dict: Dict[str, Any] = {
                "azienda": azienda,
                "telefono": telefono,
                "email": email,
                "sito": website,
                "website": website,
                "citta": citta,
                "indirizzo": indirizzo,
                "categoria": r.get("category") or r.get("categoria") or "",
                "category": r.get("category") or r.get("categoria") or "",
                "tech_stack": tech_stack_list,

                "rating": r.get("rating"),
                "reviews_count": int(r.get("reviews_count") or 0),
                "is_claimed": r.get("is_claimed"),

                "instagram": r.get("instagram"),
                "facebook": r.get("facebook"),
                "linkedin": r.get("linkedin"),
                "meta_ads_library": r.get("meta_ads_library"),
                "decision_maker": r.get("decision_maker") or "N/D",
                "meta_pixel": bool(r.get("meta_pixel")),
                "google_tag_manager": bool(r.get("google_tag_manager")),
                "html_errors": int(r.get("html_errors") or 0),
                "technical_report": r.get("technical_report") or {},

                # Freshness (Lead Object v2)
                "lead_object_version": 2,
                "last_audited_at": _utc_now_iso(),
                "freshness_score": 100,
                "audit_version": 2,
            }

        for _bk in (
            "business_hiring_jobs",
            "business_tender_hits",
            "detected_crm_stack",
            "business_sector_hits",
            "audit_changes",
            "business_events_enriched_at",
            "business_events_audit_at",
            "business_events_external_at",
            "business_signals",
        ):
            if _bk in r and r.get(_bk) is not None:
                result_dict[_bk] = r.get(_bk)

        try:
            result_dict["opportunity_score"] = _calc_opportunity_score(result_dict)
        except Exception:
            result_dict["opportunity_score"] = 0

        out.append(result_dict)
    return out


def _sync_search_leads_safe(
    supabase: Any,
    search_id: Optional[str],
    user_id: Optional[str],
    results: Any,
) -> None:
    """Dual-write search_leads — non blocca il flusso legacy se fallisce."""
    if not supabase or not search_id:
        return
    try:
        from search_leads_sync import normalize_and_upsert_search_leads

        normalize_and_upsert_search_leads(
            supabase,
            str(search_id),
            str(user_id).strip() if user_id else None,
            results if isinstance(results, list) else [],
        )
    except Exception as exc:
        print(f"[worker_supabase] search_leads sync skipped: {exc}", flush=True)


def _sync_neo4j_leads_safe(results: Any, search_id: Any = None) -> None:
    """Sidecar Neo4j — dopo Postgres; non blocca il worker se fallisce."""
    if not isinstance(results, list) or not results:
        return
    try:
        from universe_neo4j_sync import (
            is_neo4j_enabled,
            sync_leads_to_graph,
            sync_semantic_leads_to_graph,
        )

        if not is_neo4j_enabled():
            return
        stats = sync_leads_to_graph(results)
        semantic_stats = sync_semantic_leads_to_graph(
            results,
            search_id=str(search_id).strip() if search_id else None,
        )
        if stats["synced"] or stats["errors"]:
            print(
                f"[worker_supabase] neo4j sync: {stats['synced']} ok, "
                f"{stats['skipped']} skip, {stats['errors']} err",
                flush=True,
            )
        if semantic_stats["nodes"] or semantic_stats["relationships"] or semantic_stats["errors"]:
            print(
                f"[worker_supabase] neo4j semantic: {semantic_stats['nodes']} nodes, "
                f"{semantic_stats['relationships']} rel, {semantic_stats['errors']} err",
                flush=True,
            )
    except Exception as exc:
        print(f"[worker_supabase] neo4j sync skipped: {exc}", flush=True)


def _should_sync_graph_for_publish_status(status: Any) -> bool:
    """Only terminal, qualified publication may mutate the commercial graph."""
    return str(status or "").strip().lower() == "completed"


def _sync_neo4j_universe_safe(supabase: Any, results: Any) -> None:
    """Mirror rich Universe edges to Neo4j after authoritative Postgres ingest."""
    if supabase is None or not isinstance(results, list) or not results:
        return
    entity_ids = sorted(
        {
            str(item.get("universe_entity_id"))
            for item in results
            if isinstance(item, dict) and item.get("universe_entity_id")
        }
    )
    if not entity_ids:
        return
    try:
        from universe_neo4j_sync import sync_universe_graph_to_neo4j

        stats = sync_universe_graph_to_neo4j(supabase, entity_ids)
        if stats["nodes"] or stats["relationships"] or stats["errors"]:
            print(
                f"[worker_supabase] neo4j universe mirror: {stats['nodes']} nodes, "
                f"{stats['relationships']} rel, {stats['errors']} err",
                flush=True,
            )
    except Exception as exc:
        print(f"[worker_supabase] neo4j universe mirror skipped: {exc}", flush=True)


def _sync_cost_ledger_safe(supabase: Any, search_id: Any, cost_snapshot: Any) -> None:
    """Persist idempotent operation reservations/settlements for resumable jobs."""
    if supabase is None or not search_id or not isinstance(cost_snapshot, dict):
        return
    for operation in cost_snapshot.get("operations") or []:
        if not isinstance(operation, dict):
            continue
        key = str(operation.get("idempotency_key") or "").strip()
        if not key or key == "prior-resume-cost":
            continue
        status = str(operation.get("status") or "reserved").strip().lower()
        estimated = max(0.0, float(operation.get("estimated_cost_eur") or 0.0))
        actual_raw = operation.get("actual_cost_eur")
        actual = max(0.0, float(actual_raw)) if actual_raw is not None else estimated
        try:
            if status in {"released", "failed"}:
                supabase.rpc(
                    "release_search_cost",
                    {
                        "p_search_id": str(search_id),
                        "p_idempotency_key": key,
                        "p_status": status,
                        "p_error_code": "WORKER_OPERATION_FAILED" if status == "failed" else None,
                    },
                ).execute()
            else:
                supabase.rpc(
                    "settle_search_cost",
                    {
                        "p_search_id": str(search_id),
                        "p_idempotency_key": key,
                        "p_actual_cost_eur": actual,
                        "p_metadata": {"accounting": "atomic_cost_governor_v2"},
                    },
                ).execute()
        except Exception as exc:
            print(f"[worker_supabase] cost ledger sync skipped key={key[:40]}: {exc}", flush=True)


def _lead_has_agentic_value(lead: Dict[str, Any]) -> bool:
    """Contatto valido o tech stack auditato — criterio ammissione lead agentic."""
    phone = str(lead.get("telefono") or lead.get("phone") or "").strip()
    email = str(lead.get("email") or "").strip()
    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null"}
    has_phone = phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8
    has_email = _is_real_business_email(email)
    tech = lead.get("tech_stack") or []
    has_real_tech = isinstance(tech, list) and any(
        str(t).strip()
        and "verifica in corso" not in str(t).lower()
        and "audit in arrivo" not in str(t).lower()
        for t in tech
    )
    site = str(lead.get("sito") or lead.get("website") or "").strip()
    has_site = site and site.lower() not in bad
    return has_phone or has_email or (has_site and has_real_tech)


def _lead_satisfies_confirmed_required_signals(lead: Dict[str, Any]) -> bool:
    """UI publish gate: required buying signals must be confirmed in payload."""
    if not isinstance(lead, dict):
        return False
    required = {
        str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
        for value in (lead.get("required_signals") or [])
        if str(value or "").strip()
    }
    if not required:
        return True
    signals = lead.get("business_signals") or []
    confirmed = set()
    equivalents = {
        "hiring": {"hiring"},
        "hiring_operational": {"hiring", "hiring_operational"},
        "hiring_technology": {"hiring", "hiring_technology"},
        "hiring_sales": {"hiring", "hiring_sales"},
        "hiring_marketing": {"hiring", "hiring_marketing"},
        "investing_marketing": {"investing_marketing", "meta_ads_started", "google_ads_started"},
        "sector_investment": {"sector_investment", "funding_received", "expansion"},
        "expansion": {"expansion", "new_location", "new_company"},
    }
    for signal in signals if isinstance(signals, list) else []:
        if not isinstance(signal, dict):
            continue
        status = str(signal.get("status") or "confirmed").strip().lower()
        if status not in {"confirmed", "verified"}:
            continue
        typ = str(signal.get("type") or signal.get("signalType") or "").strip().lower().replace("-", "_").replace(" ", "_")
        if typ:
            confirmed.add(typ)
    satisfied = {
        req for req in required
        if confirmed.intersection(equivalents.get(req, {req}))
    }
    match_mode = str(lead.get("signal_match_mode") or "all").strip().lower()
    return bool(satisfied) if match_mode == "any" else len(satisfied) == len(required)


def _required_signals_from_intent(intent: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(intent, dict):
        return []
    values: List[str] = []
    for raw in intent.get("required_signals") or []:
        value = str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
        if value and value not in values:
            values.append(value)
    for signal in intent.get("signals") or []:
        if isinstance(signal, dict):
            value = str(signal.get("type") or "").strip().lower().replace("-", "_").replace(" ", "_")
            if value and value not in values:
                values.append(value)
    return values


def _filter_results_by_confirmed_required_signals(
    results: Any,
    intent: Optional[Dict[str, Any]],
    *,
    stage: str,
) -> List[Dict[str, Any]]:
    rows = [dict(item) for item in results if isinstance(item, dict)] if isinstance(results, list) else []
    required = _required_signals_from_intent(intent)
    out: List[Dict[str, Any]] = []
    for lead in rows:
        non_target_reason = _non_target_lead_reason(lead)
        if non_target_reason:
            print(
                f"[worker_supabase] quality gate drop ({stage}): "
                f"{str(lead.get('azienda') or lead.get('nome') or '')[:60]} "
                f"{non_target_reason}",
                flush=True,
            )
            continue
        if _should_reject_enterprise_lead(lead, intent):
            print(
                f"[worker_supabase] quality gate drop ({stage}): "
                f"{str(lead.get('azienda') or lead.get('nome') or '')[:60]} "
                "enterprise/global brand rejected for SMB/signal query",
                flush=True,
            )
            continue
        if not required:
            out.append(lead)
            continue
        if not lead.get("required_signals"):
            lead["required_signals"] = list(required)
        if _lead_satisfies_confirmed_required_signals(lead):
            out.append(lead)
        else:
            print(
                f"[worker_supabase] quality gate drop ({stage}): "
                f"{str(lead.get('azienda') or lead.get('nome') or '')[:60]} "
                f"missing confirmed signals={required}",
                flush=True,
            )
    return out


def _is_agentic_only_job(intent: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(intent, dict):
        return False
    if str(intent.get("search_mode") or "").strip().lower() == "agentic_only":
        return True
    if str(intent.get("search_strategy") or "").strip().lower() == "organic_web_search":
        return True
    return False


_SELLER_LEADGEN_CATEGORY = "PMI B2B con team commerciale in espansione"
_SELLER_LEADGEN_LOCATION = "Italia"


def _looks_like_seller_leadgen_query(text: str) -> bool:
    q = str(text or "").lower()
    seller = re.search(
        r"\b(a\s+cui\s+vendere|vendere\s+(?:il|la|i|le|un|una|mio|mia)|trov\w+\s+lead|lead\s+cald|clienti\s+per|prospect)\b",
        q,
    )
    offer = re.search(
        r"\b(lead\s*generation|generazione\s+lead|sales\s*intelligence|prospect(?:ing)?|outreach|scouting)\b",
        q,
    )
    return bool(seller and offer)


def _looks_like_buyer_marketing_investment_query(text: str) -> bool:
    q = str(text or "").lower()
    # Hiring vacancy queries mention "marketing" as a role, not as ad spend.
    if re.search(
        r"\b(?:assum\w*|hiring|vacanc\w*|recruit\w*|job posting|posizione aperta|"
        r"marketing manager|social media manager|growth manager|performance marketing)\b",
        q,
    ):
        return False
    return bool(
        re.search(r"\b(aziende|imprese|pmi|attivit[aà]|negozi|business)\b", q)
        and re.search(r"\b(invest\w*|spend\w*|budget|campagne?|ads|pubblicit[aà]|marketing)\b", q)
        and re.search(r"\b(marketing|ads|pubblicit[aà]|meta|facebook|google)\b", q)
    )


def _canonicalize_marketing_investment_job(
    category: str,
    location: str,
    intent: Optional[Dict[str, Any]],
    job: Dict[str, Any],
) -> tuple[str, str, Optional[Dict[str, Any]], bool]:
    """Signal-buying query: never let Maps return famous retail brands."""
    intent_obj: Dict[str, Any] = dict(intent) if isinstance(intent, dict) else {}
    candidates: List[str] = []
    for key in ("original_query", "query", "user_query"):
        value = intent_obj.get(key)
        if value:
            candidates.append(str(value))
    for key in ("query", "text", "search_query", "original_query"):
        value = job.get(key)
        if value:
            candidates.append(str(value))
    signal_types = {
        str(item.get("type") or "").strip().lower()
        for item in (intent_obj.get("signals") or [])
        if isinstance(item, dict)
    }
    required = {str(value).strip().lower() for value in (intent_obj.get("required_signals") or [])}
    hiring_signals = {
        "hiring",
        "hiring_operational",
        "hiring_sales",
        "hiring_marketing",
        "hiring_technology",
    }
    # Never rewrite an already-scoped hiring search into investing_marketing.
    if hiring_signals & (signal_types | required):
        return category, location, intent, False
    looks_like = any(_looks_like_buyer_marketing_investment_query(value) for value in candidates)
    has_signal = bool({"investing_marketing", "meta_ads_started", "google_ads_started"} & (signal_types | required))
    if not (looks_like or has_signal):
        return category, location, intent, False

    signals = intent_obj.get("signals")
    if not isinstance(signals, list):
        signals = []
    if "investing_marketing" not in signal_types:
        signals.append({"type": "investing_marketing", "params": {}})
    original_query = next((value for value in candidates if _looks_like_buyer_marketing_investment_query(value)), None)
    if original_query and not intent_obj.get("original_query"):
        intent_obj["original_query"] = original_query
    if original_query and not intent_obj.get("query"):
        intent_obj["query"] = original_query
    intent_obj.update(
        {
            "search_mode": "agentic_only",
            "search_strategy": "organic_web_search",
            "signals": signals,
            "required_signals": ["investing_marketing"],
            "commercial_hypothesis": intent_obj.get("commercial_hypothesis")
            or {
                "offer": "Servizi o software per marketing, advertising e crescita commerciale",
                "target_profile": [
                    "PMI e aziende locali/non famose con evidenza verificabile di investimento marketing",
                    "aziende con campagne ads, landing page, funnel o iniziative di acquisizione attive",
                ],
                "buyer_pains": [
                    "spesa marketing da trasformare in lead/clienti misurabili",
                    "campagne attive senza sufficiente conversione o tracciamento",
                ],
                "buying_signals": [
                    "Meta Ads o Google Ads attivi",
                    "landing page o campagne con CTA commerciale",
                    "nuove iniziative di marketing, lancio prodotto, evento o crescita canali",
                ],
                "decision_maker_roles": ["Founder", "CEO", "Responsabile Marketing", "Marketing Manager", "Titolare"],
                "disqualifiers": [
                    "brand globale o catena famosa",
                    "negozio retail enterprise senza prova di budget ads locale",
                    "risultato Maps senza evidenza marketing verificabile",
                ],
            },
            "ranking_policy": {
                **(intent_obj.get("ranking_policy") if isinstance(intent_obj.get("ranking_policy"), dict) else {}),
                "signal_match_mode": "all",
                "max_signal_age_days": 120,
            },
        }
    )
    return (
        "PMI che investono in marketing",
        location or str(intent_obj.get("location") or "").strip() or "Italia",
        intent_obj,
        True,
    )


def _canonicalize_seller_leadgen_job(
    category: str,
    location: str,
    intent: Optional[Dict[str, Any]],
    job: Dict[str, Any],
) -> tuple[str, str, Optional[Dict[str, Any]], bool]:
    """Server-side guard for stale UI deployments that mis-route seller queries as Software/Cui."""
    intent_obj: Dict[str, Any] = dict(intent) if isinstance(intent, dict) else {}
    candidates: List[str] = []
    for key in ("original_query", "query", "user_query"):
        value = intent_obj.get(key)
        if value:
            candidates.append(str(value))
    for key in ("query", "text", "search_query", "original_query"):
        value = job.get(key)
        if value:
            candidates.append(str(value))

    degraded_software_cui = category.strip().lower() == "software" and location.strip().lower() == "cui"
    seller_query = any(_looks_like_seller_leadgen_query(value) for value in candidates)
    if not (seller_query or degraded_software_cui):
        return category, location, intent, False

    signals = intent_obj.get("signals")
    if not isinstance(signals, list):
        signals = []
    signal_types = {
        str(item.get("type") or "").strip().lower()
        for item in signals
        if isinstance(item, dict)
    }
    for signal_type in ("hiring", "expansion"):
        if signal_type not in signal_types:
            signals.append({"type": signal_type, "params": {}})
            signal_types.add(signal_type)

    original_query = next((value for value in candidates if _looks_like_seller_leadgen_query(value)), None)
    if original_query and not intent_obj.get("original_query"):
        intent_obj["original_query"] = original_query
    if original_query and not intent_obj.get("query"):
        intent_obj["query"] = original_query
    intent_obj.update(
        {
            "search_mode": "agentic_only",
            "search_strategy": "organic_web_search",
            "signals": signals,
            "required_signals": ["hiring", "expansion"],
            "commercial_hypothesis": intent_obj.get("commercial_hypothesis")
            or {
                "offer": "Software di lead generation e Sales Intelligence",
                "target_profile": [
                    "PMI italiane B2B con processo commerciale attivo",
                    "aziende che stanno costruendo o ampliando il team new business",
                ],
                "buyer_pains": [
                    "prospecting e ricerca account manuali",
                    "pipeline insufficiente o costosa da alimentare",
                ],
                "buying_signals": [
                    "assunzione recente di SDR, BDR, Inside Sales o Business Developer",
                    "annuncio che cita outbound, prospecting, lead generation o sviluppo nuovi clienti",
                    "potenziamento rete commerciale o ingresso in nuovi mercati",
                ],
                "hiring_roles": [
                    "Sales Development Representative",
                    "Business Development Representative",
                    "Inside Sales",
                    "Business Developer",
                    "Sales Account New Business",
                    "Lead Generation Specialist",
                ],
                "decision_maker_roles": ["CEO", "Founder", "Head of Sales", "Sales Director", "Revenue Operations"],
                "disqualifiers": [
                    "azienda enterprise famosa o multinazionale",
                    "segnale senza URL o prova testuale",
                    "ruolo retail/customer care senza new business",
                ],
            },
        }
    )
    uqe_plan = intent_obj.get("uqe_plan")
    if isinstance(uqe_plan, dict):
        uqe_plan.update(
            {
                "search_strategy": "organic_web_search",
                "sector": _SELLER_LEADGEN_CATEGORY,
                "location": _SELLER_LEADGEN_LOCATION,
                "required_signals": ["hiring", "expansion"],
                "commercial_hypothesis": intent_obj.get("commercial_hypothesis"),
            }
        )
    return _SELLER_LEADGEN_CATEGORY, _SELLER_LEADGEN_LOCATION, intent_obj, True


def _upsert_single_search_lead_safe(
    supabase: Any,
    search_id: Optional[str],
    user_id: Optional[str],
    lead: Dict[str, Any],
    position: int,
) -> None:
    if not supabase or not search_id:
        return
    try:
        from search_leads_sync import upsert_single_search_lead

        upsert_single_search_lead(supabase, str(search_id), user_id, lead, position)
    except Exception as exc:
        print(f"[worker_supabase] search_leads single upsert skipped: {exc}", flush=True)


def _delete_search_lead_safe(supabase: Any, search_id: Optional[str], dedupe_key: str) -> None:
    if not supabase or not search_id or not dedupe_key:
        return
    try:
        from search_leads_sync import delete_search_lead_by_dedupe_key

        delete_search_lead_by_dedupe_key(supabase, str(search_id), dedupe_key)
    except Exception as exc:
        print(f"[worker_supabase] search_leads delete skipped: {exc}", flush=True)


def _agentic_audit_site_reachable(audit: Optional[Dict[str, Any]]) -> bool:
    """True se l'audit ha aperto il sito (non timeout/connessione fallita)."""
    if not isinstance(audit, dict):
        return False
    status = audit.get("website_http_status")
    if isinstance(status, int):
        if 200 <= status < 500:
            return True
        if status in (401, 403):
            return True
    if audit.get("website_has_html"):
        return True
    if audit.get("telefono") or audit.get("email"):
        return True
    if audit.get("tech_stack"):
        return True
    err = str(audit.get("website_error") or audit.get("website_error_hint") or "").lower()
    if any(x in err for x in ("timeout", "connection", "refused", "unreachable", "nxdomain", "failed")):
        return False
    return False


def _agentic_make_pending_stub(stub: Dict[str, Any]) -> Dict[str, Any]:
    pending = dict(stub)
    pending["tech_stack"] = ["Verifica in corso"]
    pending.setdefault("telefono", "")
    pending.setdefault("email", "")
    tr = dict(pending.get("technical_report") or {})
    tr["source"] = "agentic_web_search"
    tr["audit_status"] = "pending"
    pending["technical_report"] = tr
    pending["source"] = "agentic_web_search"
    return pending


def _agentic_apply_contact_fallback(stub: Dict[str, Any]) -> Dict[str, Any]:
    """Se audit OK ma nessun contatto: pubblica con nota N/D."""
    out = dict(stub)
    phone = str(out.get("telefono") or out.get("phone") or "").strip()
    email = str(out.get("email") or "").strip()
    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null"}
    has_phone = phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8
    has_email = _is_real_business_email(email)
    if not has_phone and not has_email:
        tr = dict(out.get("technical_report") or {})
        tr["contact_note"] = "N/D - Visita il sito"
        out["technical_report"] = tr
    return out


def _agentic_should_defer_publish_until_audit(stub: Dict[str, Any]) -> bool:
    """Signal-led jobs must not expose unaudited/pending leads to UI or search_leads."""
    if not isinstance(stub, dict):
        return False
    return any(str(value or "").strip() for value in (stub.get("required_signals") or []))


def _validate_canonical_plan_in_intent(intent: Any) -> Any:
    """Validate a declared v1 plan before a worker can spend or claim the job."""
    if not isinstance(intent, dict):
        return intent
    normalized = dict(intent)
    uqe_plan = normalized.get("uqe_plan")
    canonical_plan = uqe_plan.get("canonical_plan") if isinstance(uqe_plan, dict) else None
    if canonical_plan is None:
        canonical_plan = normalized.get("canonical_plan")
    if canonical_plan is None:
        return normalized

    from contracts.commercial_search_plan import validate_commercial_search_plan
    from contracts.signal_ontology import validate_plan_signals
    from contracts.source_registry import validate_plan_source_policy

    validated = validate_commercial_search_plan(canonical_plan).model_dump(mode="json")
    validate_plan_signals(validated)
    validate_plan_source_policy(validated)
    if isinstance(uqe_plan, dict):
        normalized_uqe = dict(uqe_plan)
        normalized_uqe["canonical_plan"] = validated
        normalized["uqe_plan"] = normalized_uqe
    else:
        normalized["canonical_plan"] = validated
    return normalized


def _canonical_plan_from_intent(intent: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(intent, dict):
        return None
    uqe_plan = intent.get("uqe_plan")
    if isinstance(uqe_plan, dict) and isinstance(uqe_plan.get("canonical_plan"), dict):
        return uqe_plan["canonical_plan"]
    return intent.get("canonical_plan") if isinstance(intent.get("canonical_plan"), dict) else None


def _agentic_stream_one_lead(
    item: Dict[str, Any],
    *,
    accumulated: List[Dict[str, Any]],
    seen: Set[str],
    category: str,
    location: str,
    publish_cb: Optional[Any],
    supabase: Any,
    search_id: Optional[str],
    user_id: Optional[str],
    defer_publish_until_audit: bool = False,
) -> bool:
    """
    Streaming 1-a-1: publish pre-audit → audit → update riga.
    Scarta solo se dominio assente o sito non apribile.
    """
    from agents.agentic_gap_fill import extracted_to_lead_stub, lead_dedupe_key, prepare_agentic_extracted_item

    prepared = prepare_agentic_extracted_item(item, location=location)
    if not prepared:
        print(
            f"[worker_supabase] agentic skip (no domain) name={str(item.get('name') or '')[:50]}",
            flush=True,
        )
        return False

    stub = extracted_to_lead_stub(prepared, category=category, location=location)
    stub_required = {
        str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
        for value in (stub.get("required_signals") or [])
        if str(value or "").strip()
    }
    if "investing_marketing" in stub_required:
        marketing_non_buyer = re.search(
            r"\b(festival|evento|eventi|arte\s+e\s+natura|turismo|tourism|destination|"
            r"portale|directory|marketplace)\b",
            " ".join(str(stub.get(k) or "") for k in ("azienda", "nome", "categoria", "category", "sito", "website")),
            re.I,
        )
        if marketing_non_buyer:
            print(
                f"[worker_supabase] agentic skip (marketing non-buyer): "
                f"{str(stub.get('azienda') or '')[:50]}",
                flush=True,
            )
            return False
    non_target_reason = _non_target_lead_reason(stub)
    if non_target_reason:
        print(
            f"[worker_supabase] agentic skip (non-target): "
            f"{str(stub.get('azienda') or '')[:50]} {non_target_reason}",
            flush=True,
        )
        return False
    if not _lead_satisfies_confirmed_required_signals(stub):
        print(
            f"[worker_supabase] agentic skip (unconfirmed required signal) "
            f"name={str(stub.get('azienda') or '')[:50]}",
            flush=True,
        )
        return False
    key = lead_dedupe_key(
        str(stub.get("nome") or ""),
        str(stub.get("sito") or stub.get("website") or ""),
        str(stub.get("azienda") or ""),
    )
    if not key:
        return False
    if key in seen:
        accumulated[:] = _merge_formatted_results(accumulated, [stub])
        if publish_cb and not defer_publish_until_audit:
            try:
                publish_cb(list(accumulated), status="running")
            except TypeError:
                publish_cb(list(accumulated))
        return False

    site = str(stub.get("sito") or stub.get("website") or "").strip()
    if not site:
        return False

    verification = prepared.get("domain_verification")
    if not isinstance(verification, dict) or verification.get("status") not in {"verified", "probable"}:
        return False

    pending = _agentic_make_pending_stub(stub)
    seen.add(key)
    position = len(accumulated)
    accumulated.append(pending)

    if defer_publish_until_audit or _agentic_should_defer_publish_until_audit(pending):
        print(
            f"[worker_supabase] agentic defer pending until audit: {str(pending.get('azienda') or '')[:50]} "
            f"pos={position} url={site[:60]}",
            flush=True,
        )
        return True

    print(
        f"[worker_supabase] agentic publish pending: {str(pending.get('azienda') or '')[:50]} "
        f"pos={position} url={site[:60]}",
        flush=True,
    )

    if publish_cb:
        try:
            publish_cb(list(accumulated), status="running")
        except TypeError:
            publish_cb(list(accumulated))

    _upsert_single_search_lead_safe(supabase, search_id, user_id, pending, position)

    # Discovery must not wait up to 55 seconds per lead.  The completion pass
    # audits pending leads concurrently and keeps failures retryable instead of
    # deleting evidence-backed companies because of a transient timeout.
    return True


def _agentic_raw_to_stubs(
    extracted: List[Dict[str, Any]],
    *,
    formatted: List[Dict[str, Any]],
    seen: Set[str],
    category: str,
    location: str,
    remaining_target: int,
    publish_cb: Optional[Any] = None,
    supabase: Any = None,
    search_id: Optional[str] = None,
    user_id: Optional[str] = None,
    defer_publish_until_audit: bool = False,
) -> List[Dict[str, Any]]:
    """Legacy batch wrapper — delega a streaming 1-a-1 (muta formatted in-place)."""
    accumulated = formatted
    new_leads: List[Dict[str, Any]] = []
    for item in extracted:
        if len(new_leads) >= remaining_target:
            break
        if not isinstance(item, dict):
            continue
        if _agentic_stream_one_lead(
            item,
            accumulated=accumulated,
            seen=seen,
            category=category,
            location=location,
            publish_cb=publish_cb,
            supabase=supabase,
            search_id=search_id,
            user_id=user_id,
            defer_publish_until_audit=defer_publish_until_audit,
        ):
            new_leads.append(accumulated[-1])
    return new_leads


def _agentic_candidate_pool_target(lead_target: int, defer_until_audit: bool) -> int:
    target = max(0, int(lead_target or 0))
    if not defer_until_audit or target <= 0:
        return target
    return min(25, max(target, target * 3))


def _agentic_gap_fill_safe(
    formatted: List[Dict[str, Any]],
    *,
    job_max: int,
    intent: Optional[Dict[str, Any]],
    category: str,
    location: str,
    original_query: Optional[str] = None,
    publish_cb: Optional[Any] = None,
    supabase: Any = None,
    search_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Gap-fill agentic se Maps/directory non raggiungono job_max.
    Con publish_cb: streaming incrementale (status running) ogni batch.
    Ritorna (lead, messaggio_esaurimento opzionale).
    """
    if not isinstance(formatted, list):
        formatted = []
    enabled = os.getenv("AGENTIC_GAP_FILL_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return formatted, None

    remaining_target = max(0, int(job_max or 0) - len(formatted))
    if remaining_target <= 0:
        return formatted, None

    print(
        f"[worker_supabase] Agentic gap-fill: target={job_max} current={len(formatted)} "
        f"remaining={remaining_target} streaming={bool(publish_cb)}",
        flush=True,
    )

    accumulated = list(formatted)
    try:
        from agents.agentic_gap_fill import (
            AGENTIC_TIMEOUT_SEC,
            STREAM_BATCH_SIZE,
            build_agentic_completion_message,
            build_mirax_query_plan_from_job,
            existing_dedupe_keys,
            run_agentic_discovery_streaming,
        )

        plan = build_mirax_query_plan_from_job(
            intent,
            category,
            location,
            original_query=original_query,
        )
        accumulated = list(formatted)
        seen = existing_dedupe_keys(accumulated)
        total_new = 0
        discovery_stats: Dict[str, Any] = {}
        intent_state: Dict[str, Any] = intent if isinstance(intent, dict) else {}
        defer_publish_until_audit = bool(plan.get("required_signals") or [])
        candidate_pool_target = _agentic_candidate_pool_target(
            remaining_target,
            defer_publish_until_audit,
        )

        def _on_checkpoint(checkpoint_data: Dict[str, Any]) -> None:
            intent_state["agentic_checkpoint"] = checkpoint_data
            if supabase is not None and search_id:
                supabase.table("searches").update({"intent": intent_state}).eq("id", search_id).execute()

        def _on_batch(raw_batch: List[Dict[str, Any]]) -> int:
            nonlocal accumulated, total_new
            if not raw_batch:
                return 0
            still_need = max(0, candidate_pool_target - total_new)
            contextual_batch = [
                {
                    **item,
                    "_required_signals": plan.get("required_signals") or [],
                    "_signal_match_mode": (
                        (plan.get("ranking_policy") or {}).get("signal_match_mode", "all")
                        if isinstance(plan.get("ranking_policy"), dict)
                        else "all"
                    ),
                    "_ranking_policy": plan.get("ranking_policy") or {},
                    "_commercial_hypothesis": plan.get("commercial_hypothesis") or {},
                }
                for item in raw_batch
                if isinstance(item, dict)
            ]
            stubs = _agentic_raw_to_stubs(
                contextual_batch,
                formatted=accumulated,
                seen=seen,
                category=category,
                location=location,
                remaining_target=still_need,
                publish_cb=publish_cb,
                supabase=supabase,
                search_id=search_id,
                user_id=user_id,
                defer_publish_until_audit=defer_publish_until_audit,
            )
            if not stubs:
                return 0
            total_new += len(stubs)
            print(
                f"[worker_supabase] Agentic stream batch: +{len(stubs)} (totale {len(accumulated)})",
                flush=True,
            )
            if publish_cb and not defer_publish_until_audit:
                try:
                    publish_cb(accumulated, status="running")
                except TypeError:
                    publish_cb(accumulated)
            return len(stubs)

        timeout_sec = float(AGENTIC_TIMEOUT_SEC)
        _coro = run_agentic_discovery_streaming(
            plan,
            candidate_pool_target,
            on_batch=_on_batch,
            existing_keys=seen,
            batch_size=STREAM_BATCH_SIZE,
            stats_out=discovery_stats,
            checkpoint=intent_state.get("agentic_checkpoint"),
            on_checkpoint=_on_checkpoint,
            cost_client=supabase,
            search_id=search_id,
        )
        if timeout_sec > 0:
            asyncio.run(asyncio.wait_for(_coro, timeout=timeout_sec))
        else:
            asyncio.run(_coro)
        if len(accumulated) < int(job_max or len(accumulated)) and discovery_stats.get("stop_reason") == "target_reached":
            discovery_stats["stop_reason"] = "round_complete"
            checkpoint_state = intent_state.get("agentic_checkpoint")
            if isinstance(checkpoint_state, dict):
                checkpoint_state["stop_reason"] = "round_complete"
        discovery_stats["found"] = len(accumulated)
        discovery_stats["target"] = int(job_max or len(accumulated))
        discovery_stats["candidate_pool_target"] = candidate_pool_target
        intent_state["agentic_stats"] = discovery_stats
        if supabase is not None and search_id:
            try:
                supabase.table("searches").update({"intent": intent_state}).eq("id", search_id).execute()
            except Exception as stats_error:
                print(f"[worker_supabase] agentic stats save skipped: {stats_error}", flush=True)

        exhaustion_msg: Optional[str] = None
        if len(accumulated) < int(job_max or len(accumulated)):
            found_total = len(accumulated)
            exhaustion_msg = build_agentic_completion_message(
                found_total,
                int(job_max or found_total),
                str(discovery_stats.get("stop_reason") or "page_budget"),
            )
            print(f"[worker_supabase] Agentic completion: {exhaustion_msg}", flush=True)

        if total_new == 0:
            print("[worker_supabase] Agentic gap-fill: nessun lead estratto", flush=True)
            return formatted, exhaustion_msg

        print(
            f"[worker_supabase] Agentic gap-fill: +{total_new} lead (totale {len(accumulated)})",
            flush=True,
        )
        return accumulated, exhaustion_msg
    except asyncio.TimeoutError:
        print("[worker_supabase] Agentic gap-fill timeout — salvo lead parziali", flush=True)
        found_total = len(accumulated)
        discovery_stats.update(
            {"found": found_total, "target": int(job_max or found_total), "stop_reason": "time_budget"}
        )
        intent_state["agentic_stats"] = discovery_stats
        checkpoint_state = intent_state.get("agentic_checkpoint")
        if isinstance(checkpoint_state, dict):
            checkpoint_state["stop_reason"] = "time_budget"
        if supabase is not None and search_id:
            try:
                supabase.table("searches").update({"intent": intent_state}).eq("id", search_id).execute()
            except Exception as stats_error:
                print(f"[worker_supabase] timeout stats save skipped: {stats_error}", flush=True)
        msg = build_agentic_completion_message(found_total, int(job_max or found_total), "time_budget")
        return accumulated, msg
    except Exception as exc:
        print(f"[worker_supabase] Agentic gap-fill skipped: {exc}", flush=True)
        return accumulated, None


def _lead_has_pending_audit(lead: Any) -> bool:
    if not isinstance(lead, dict):
        return False
    tech = lead.get("tech_stack") or []
    if isinstance(tech, list):
        stack_str = " ".join(str(x) for x in tech).lower()
        if "verifica in corso" in stack_str or "audit in arrivo" in stack_str or "stack in arrivo" in stack_str:
            return True
    tr = lead.get("technical_report")
    if isinstance(tr, dict) and tr:
        return False
    return not tech or (isinstance(tech, list) and len(tech) == 0)


def _lead_has_contact_channel(lead: Any) -> bool:
    if not isinstance(lead, dict):
        return False
    phone = str(lead.get("telefono") or lead.get("phone") or "").strip()
    email = str(lead.get("email") or "").strip()
    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
    if phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8:
        return True
    if _is_real_business_email(email):
        return True
    for key in ("linkedin", "instagram", "facebook"):
        value = str(lead.get(key) or "").strip().lower()
        if value.startswith("http") and key in value:
            return True
    return False


def _verified_official_domain_payload(
    lead: Dict[str, Any],
    audit: Dict[str, Any],
    previous_report: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Return a lifecycle-safe verified domain or fail closed.

    Compatibility payloads are untrusted at this boundary: a portal or
    directory can contain a syntactically valid ``domain_verification``.  Only
    a positive identity proof for the exact canonical website may be promoted.
    """
    try:
        from agents.portal_blacklist import (
            is_blacklisted_domain,
            is_source_portal_url,
            normalize_domain,
        )
    except Exception:
        return None

    official_url = str(lead.get("sito") or lead.get("website") or "").strip()
    official_domain = normalize_domain(official_url)
    if not official_domain or is_blacklisted_domain(official_domain) or is_source_portal_url(official_url):
        return None

    candidates = (
        lead.get("domain_verification"),
        audit.get("domain_verification"),
        previous_report.get("domain_verification"),
    )
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        resolved_url = str(candidate.get("url") or "").strip()
        resolved_domain = normalize_domain(resolved_url)
        evidence = {
            str(value).strip()
            for value in candidate.get("evidence") or []
            if str(value).strip()
        }
        try:
            confidence = float(candidate.get("confidence") or 0.0)
            score = int(candidate.get("score") or 0)
        except (TypeError, ValueError):
            continue
        if (
            str(candidate.get("status") or "").strip().lower() != "verified"
            or resolved_domain != official_domain
            or is_blacklisted_domain(resolved_domain)
            or is_source_portal_url(resolved_url)
            or confidence < 0.70
            or score < 70
            or str(candidate.get("resolution_source") or "") not in {"extracted_website", "serp_identity"}
            or str(candidate.get("resolution_method") or "") != "positive_page_identity"
            or len(evidence) < 2
            or not evidence.intersection({"company_tokens_in_host", "schema_org_identity_match"})
        ):
            continue
        return dict(candidate)
    return None


def _apply_audit_url_payload_to_lead(lead: Dict[str, Any], audit: Dict[str, Any]) -> Dict[str, Any]:
    updated = dict(lead)
    ts: List[str] = []
    raw = str(audit.get("tech_stack") or "").lower()
    if "wordpress" in raw:
        ts.append("WORDPRESS")
    elif "shopify" in raw:
        ts.append("SHOPIFY")
    elif "wix" in raw:
        ts.append("WIX")
    has_pixel = bool(audit.get("has_pixel") or audit.get("meta_pixel"))
    has_gtm = bool(audit.get("has_gtm") or audit.get("google_tag_manager"))
    has_ads = bool(audit.get("has_google_ads"))
    if audit.get("has_ssl") is not False:
        ts.append("SSL")
    ts.append("Meta Pixel" if has_pixel else "MISSING FB PIXEL")
    ts.append("GTM" if has_gtm else "MISSING GTM")
    ts.append("GOOGLE ADS" if has_ads else "MISSING GOOGLE ADS")
    try:
        speed = audit.get("load_speed_seconds")
        if speed is not None and float(speed) > 4.0:
            ts.append("SITO LENTO")
    except Exception:
        pass
    tech_stack = list(dict.fromkeys([x for x in ts if str(x).strip()])) or ["Custom HTML"]
    seo_errors = audit.get("seo_errors") if isinstance(audit.get("seo_errors"), list) else []
    prev_tr = lead.get("technical_report") if isinstance(lead.get("technical_report"), dict) else {}
    # Normalize the compatibility payload once at the audit boundary.  Older
    # stubs stored verified identity/evidence only under technical_report and
    # agentic_*; the canonical lifecycle intentionally reads top-level fields.
    domain_verification = _verified_official_domain_payload(updated, audit, prev_tr)
    if domain_verification:
        updated["domain_verification"] = domain_verification
    else:
        # A pre-existing compatibility mirror must not bypass validation.
        updated.pop("domain_verification", None)
    if not str(updated.get("source_url") or "").strip():
        updated["source_url"] = str(updated.get("agentic_source_url") or prev_tr.get("agentic_source_url") or "").strip()
    if not str(updated.get("evidence") or "").strip():
        updated["evidence"] = str(updated.get("agentic_evidence") or prev_tr.get("agentic_evidence") or "").strip()
    if not str(updated.get("evidence_date") or "").strip():
        updated["evidence_date"] = str(updated.get("source_observation_date") or "").strip() or None
    if not str(updated.get("source_class") or "").strip():
        source_types = updated.get("source_types") if isinstance(updated.get("source_types"), list) else []
        updated["source_class"] = str(source_types[0] if source_types else "").strip()
    updated["tech_stack"] = tech_stack
    updated["meta_pixel"] = has_pixel
    updated["google_tag_manager"] = has_gtm
    updated["technical_report"] = {
        **prev_tr,
        "has_google_ads": has_ads,
        "has_ga4": bool(audit.get("has_ga4")),
        "load_speed_seconds": audit.get("load_speed_seconds"),
        "html_errors": len(seo_errors),
        "error_details": seo_errors,
    }
    if audit.get("email") and not lead.get("email"):
        updated["email"] = audit.get("email")
    if audit.get("telefono") and not lead.get("telefono"):
        updated["telefono"] = audit.get("telefono")
    if audit.get("citta") or audit.get("indirizzo"):
        try:
            from entity_matcher import resolve_lead_city
            updated["citta"] = resolve_lead_city(
                str(audit.get("citta") or lead.get("citta") or ""),
                str(audit.get("indirizzo") or lead.get("indirizzo") or ""),
                str(lead.get("citta") or ""),
            )
        except ImportError:
            pass
    if audit.get("instagram") and not lead.get("instagram"):
        updated["instagram"] = audit.get("instagram")
    if audit.get("facebook") and not lead.get("facebook"):
        updated["facebook"] = audit.get("facebook")
    if audit.get("linkedin") and not lead.get("linkedin"):
        updated["linkedin"] = audit.get("linkedin")
    ig_missing = audit.get("instagram_missing")
    if ig_missing is None and audit.get("audit") and isinstance(audit.get("audit"), dict):
        ig_missing = audit["audit"].get("missing_instagram")
    if ig_missing is not None:
        updated["instagram_missing"] = bool(ig_missing)
        prev_audit = updated.get("audit") if isinstance(updated.get("audit"), dict) else {}
        updated["audit"] = {**prev_audit, "missing_instagram": bool(ig_missing)}
    updated["last_audited_at"] = _utc_now_iso()
    updated["freshness_score"] = 100
    updated["lead_object_version"] = 2
    updated["audit_version"] = 2
    if updated.get("hotness_score") is not None:
        try:
            contact_bonus = 0
            if _is_real_business_email(str(updated.get("email") or "")):
                contact_bonus += 3
            if len(re.sub(r"\D+", "", str(updated.get("telefono") or ""))) >= 8:
                contact_bonus += 3
            if updated.get("linkedin") or updated.get("instagram") or updated.get("facebook"):
                contact_bonus += 1
            hotness = min(100, int(updated.get("hotness_score") or 0) + contact_bonus)
            updated["hotness_score"] = hotness
            updated["lead_temperature"] = "hot" if hotness >= 80 else "warm" if hotness >= 65 else "contextual"
        except (TypeError, ValueError):
            pass
    try:
        updated["opportunity_score"] = _calc_opportunity_score(updated)
    except Exception:
        pass
    return updated


async def _finish_pending_audits(
    formatted: List[Dict[str, Any]],
    publish_cb=None,
    audit_policy: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = [dict(x) if isinstance(x, dict) else x for x in formatted]
    pending_idxs = [i for i, l in enumerate(out) if isinstance(l, dict) and _lead_has_pending_audit(l)]
    if not pending_idxs:
        return out
    print(f"[worker_supabase] Completion pass: {len(pending_idxs)} lead con audit pending", flush=True)
    try:
        audit_workers = max(1, min(16, int(os.getenv("AGENTIC_AUDIT_WORKERS", "8") or "8")))
    except ValueError:
        audit_workers = 8
    sem = asyncio.Semaphore(audit_workers)
    audit_cache = AdaptiveAuditCache()

    async def _audit_one(i: int) -> None:
        async with sem:
            lead = out[i]
            if not isinstance(lead, dict):
                return
            site = (lead.get("sito") or lead.get("website") or "").strip()
            if not site or site.upper() in {"N/D", "N/A", "N.D.", "N/D."}:
                lead = dict(lead)
                lead["tech_stack"] = ["NO WEBSITE"]
                lead["technical_report"] = lead.get("technical_report") or {"has_google_ads": False}
                lead["last_audited_at"] = _utc_now_iso()
                lead["freshness_score"] = 100
                lead["lead_object_version"] = 2
                out[i] = lead
                if publish_cb:
                    try:
                        publish_cb(out)
                    except Exception:
                        pass
                return
            url = site if site.startswith("http") else f"https://{site}"
            try:
                modules = adaptive_modules(audit_policy, lead)
                cached_modules = audit_cache.get_many(url, modules)
                if modules and modules.issubset(cached_modules):
                    cached_payload: Dict[str, Any] = {}
                    for module in sorted(modules):
                        cached_payload.update(cached_modules[module])
                    updated = _apply_audit_url_payload_to_lead(lead, cached_payload)
                    report = dict(updated.get("technical_report") or {})
                    report["audit_status"] = "complete"
                    report["audit_cache_hit"] = True
                    report["audit_modules"] = sorted(modules)
                    updated["technical_report"] = report
                    out[i] = _agentic_apply_contact_fallback(updated)
                    if publish_cb:
                        try:
                            publish_cb(out)
                        except Exception:
                            pass
                    return
                audit = await asyncio.wait_for(process_single_url(url), timeout=45.0)
                if isinstance(audit, dict):
                    for module in modules:
                        audit_cache.put(url, module, module_payload(module, audit))
                    updated = _apply_audit_url_payload_to_lead(lead, audit)
                    report = dict(updated.get("technical_report") or {})
                    report["audit_status"] = "complete"
                    report["audit_cache_hit"] = False
                    report["audit_modules"] = sorted(modules)
                    updated["technical_report"] = report
                    out[i] = _agentic_apply_contact_fallback(updated)
                    if publish_cb:
                        try:
                            publish_cb(out)
                        except Exception:
                            pass
            except Exception as e:
                print(f"[worker_supabase] completion-pass audit failed {url}: {e}", flush=True)
                failed = dict(lead)
                report = dict(failed.get("technical_report") or {})
                report["audit_status"] = "retryable_error"
                report["audit_error"] = str(e)[:200]
                failed["technical_report"] = report
                out[i] = failed
                if publish_cb:
                    try:
                        publish_cb(out)
                    except Exception:
                        pass

    await asyncio.gather(*[_audit_one(i) for i in pending_idxs])
    return out


def _canonical_audit_policy(intent: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(intent, dict):
        return {}
    uqe = intent.get("uqe_plan") if isinstance(intent.get("uqe_plan"), dict) else {}
    canonical = uqe.get("canonical_plan") if isinstance(uqe.get("canonical_plan"), dict) else {}
    if not canonical and isinstance(intent.get("canonical_plan"), dict):
        canonical = intent["canonical_plan"]
    policy = canonical.get("audit_policy") if isinstance(canonical.get("audit_policy"), dict) else {}
    return dict(policy)


def _organic_env_int(name: str, default: int, min_value: int, max_value: int) -> int:
    try:
        raw = os.getenv(name)
        value = int(str(raw).strip()) if raw is not None else default
        return max(min_value, min(max_value, value))
    except Exception:
        return default


def _organic_enabled() -> bool:
    raw = os.getenv("ORGANIC_DISCOVERY_ENABLED", "false")
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _organic_strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\\1>", " ", html or "")
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _organic_fetch(url: str, timeout: float = 7.0) -> str:
    try:
        req = Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
            },
        )
        with urlopen(req, timeout=timeout) as res:
            ct = str(res.headers.get("content-type") or "").lower()
            if "text/html" not in ct and "text/plain" not in ct and "application/xhtml" not in ct:
                return ""
            body = res.read(800000)
            enc = res.headers.get_content_charset() or "utf-8"
            return body.decode(enc, errors="ignore")
    except (HTTPError, URLError, TimeoutError, ValueError, Exception):
        return ""


def _organic_decode_search_url(href: str) -> str:
    try:
        href = unescape(href or '')
        if href.startswith('//'):
            href = 'https:' + href
        parsed = urlparse(href)
        if href.startswith('/l/?') or 'duckduckgo.com/l/?' in href:
            qs = parse_qs(parsed.query)
            return unquote(qs.get('uddg', [''])[0] or href)
        if 'bing.com/ck/a' in href or href.startswith('/ck/a'):
            qs = parse_qs(parsed.query)
            raw = qs.get('u', [''])[0]
            if raw:
                try:
                    import base64
                    raw = raw[2:] if raw.startswith('a1') else raw
                    raw += '=' * (-len(raw) % 4)
                    return base64.urlsafe_b64decode(raw.encode()).decode('utf-8', 'ignore')
                except Exception:
                    pass
        return href
    except Exception:
        return href


def _organic_is_allowed_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or '').lower().replace('www.', '')
        if not url.startswith('http') or not host:
            return False
        blocked = [
            'google.', 'gstatic', 'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'linkedin.com',
            'indeed.', 'jooble.', 'subito.', 'wikipedia.', 'tripadvisor.', 'paginegialle.', 'virgilio.',
            'paginebianche.', 'paginebianche.it', 'misterimprese.', 'cylex.', 'kompass.', 'europages.', 'trovit.', 'infojobs.', 'glassdoor.',
            'bing.com', 'duckduckgo.com', 'brave.com', 'mojeek.com', 'reverso.net', 'amazon.', 'ebay.',
            'mapcarta.', 'tuttocitta.', 'aziende.it', 'informazione-aziende.it', 'reteimprese.it', 'microsoft.com', 'msn.com',
        ]
        return not any(x in host for x in blocked)
    except Exception:
        return False


def _organic_extract_search_links(html: str, max_results: int, base_url: str = '') -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    base = base_url or ''
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html or '', re.I | re.S):
        href = _organic_decode_search_url(unquote(unescape(m.group(1) or '')).split('#', 1)[0])
        if href.startswith('/url?'):
            href = parse_qs(urlparse(href).query).get('q', [''])[0]
        if not href.startswith('http') and base:
            href = urljoin(base, href)
        if not _organic_is_allowed_url(href):
            continue
        host = urlparse(href).netloc.lower().replace('www.', '')
        if host in seen:
            continue
        title = _organic_strip_html(m.group(2) or '')[:160]
        title_l = title.lower()
        if len(title) < 4 or title_l in ['immagini', 'images', 'video', 'maps', 'mappe', 'notizie']:
            continue
        seen.add(host)
        out.append({'url': href, 'title': title})
        if len(out) >= max_results:
            return out
    return out


def _organic_google_urls(query: str, max_results: int) -> List[Dict[str, str]]:
    collected: List[Dict[str, str]] = []
    seen = set()
    urls = [
        f'https://www.bing.com/search?q={quote(query)}&setlang=it-IT&cc=IT&count={max_results}',
        f'https://search.brave.com/search?q={quote(query)}&source=web',
        f'https://www.google.com/search?q={quote(query)}&hl=it&gl=it&num={max_results}',
        f'https://duckduckgo.com/html/?q={quote(query)}',
    ]
    for search_url in urls:
        html = _organic_fetch(search_url, timeout=8.0)
        found = _organic_extract_search_links(html, max_results, search_url)
        try:
            print(f'[worker_supabase] Organic search source {urlparse(search_url).netloc}: query="{query}" urls={len(found)}', flush=True)
        except Exception:
            pass
        for item in found:
            host = urlparse(item.get('url') or '').netloc.lower().replace('www.', '')
            if not host or host in seen:
                continue
            seen.add(host)
            collected.append(item)
            if len(collected) >= max_results:
                return collected
    return collected


def _organic_origin(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url if url.startswith("http") else f"https://{url}")
        if not parsed.netloc:
            return None
        return f"{parsed.scheme or 'https'}://{parsed.netloc}".rstrip("/")
    except Exception:
        return None


def _organic_extract_contacts(html: str) -> Dict[str, str]:
    emails = re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", html or "")
    clean_emails = []
    for e in emails:
        e = _clean_business_email(e)
        if not e:
            continue
        if e not in clean_emails:
            clean_emails.append(e)
    phones = re.findall(r"(?<!\d)(?:\+39\s?|0039\s?)?(?:0[1-9]|3\d)(?:[\s.\-\u00a0]*\d){6,9}(?!\d)", html or "")
    phone = ""
    for raw in phones:
        norm = _normalize_phone_compound(raw)
        if norm:
            phone = norm
            break
    return {"email": clean_emails[0] if clean_emails else "", "phone": phone}


def _organic_category_evidence(category: str, text: str) -> bool:
    c = str(category or "").lower()
    t = str(text or "").lower()
    if not c or not t:
        return False
    if any(x in c for x in ["frigo", "refriger", "celle frigor"]):
        include = ["refrigerazione", "frigorif", "frigorist", "celle frigor", "impianti frigor", "raffreddamento", "commercial", "industrial"]
        exclude = ["domestici", "elettrodomestici", "frigo casa", "privati", "appartamenti"]
        return any(x in t for x in include) and not any(x in t for x in exclude)
    tokens = [x for x in re.findall(r"[a-zà-ÿ0-9]{4,}", c) if x not in {"della", "delle", "degli", "agenzia", "agenzie", "studio", "studi"}]
    return any(tok in t for tok in tokens[:4])


def _organic_business_name(title: str, origin: str) -> str:
    t = re.sub(r"\s*[|\-–—].*$", "", title or "").strip()
    if 3 <= len(t) <= 80:
        return t
    host = urlparse(origin).netloc.replace("www.", "")
    return host.split(".")[0].replace("-", " ").replace("_", " ").title()


_REGION_CITIES: Dict[str, List[str]] = {
    "lombardia": ["Milano", "Bergamo", "Brescia", "Monza", "Como", "Varese", "Pavia", "Cremona"],
    "lazio": ["Roma", "Latina", "Frosinone", "Viterbo", "Rieti"],
    "veneto": ["Venezia", "Verona", "Padova", "Vicenza", "Treviso", "Rovigo"],
    "emilia-romagna": ["Bologna", "Modena", "Parma", "Reggio Emilia", "Rimini", "Ferrara"],
    "piemonte": ["Torino", "Novara", "Alessandria", "Cuneo", "Asti"],
    "toscana": ["Firenze", "Pisa", "Livorno", "Siena", "Prato", "Arezzo"],
    "campania": ["Napoli", "Salerno", "Caserta", "Avellino", "Benevento"],
    "sicilia": ["Palermo", "Catania", "Messina", "Siracusa"],
    "puglia": ["Bari", "Lecce", "Taranto", "Foggia", "Brindisi"],
}

_DEV_HUB_CITIES = ["Milano", "Roma", "Torino", "Bologna", "Padova", "Firenze"]


def _organic_search_locations(location: str, category: str = "") -> List[str]:
    """Per ricerche regionali, espandi su città principali (più lead Maps/SERP)."""
    loc = (location or "").strip()
    cat = (category or "").lower()
    is_dev = any(x in cat for x in ("informatic", "software", "sviluppo", "programm", "tech"))
    if is_dev and (not loc or loc.lower() in ("italia", "italy", "milano")):
        return _DEV_HUB_CITIES[:5]
    if not loc:
        return ["Italia"]
    key = loc.lower().replace("emilia romagna", "emilia-romagna")
    cities = _REGION_CITIES.get(key)
    if cities:
        return cities[:6]
    return [loc]


def _organic_lead_city(search_city: str, address: str = "") -> str:
    try:
        from entity_matcher import resolve_lead_city
        return resolve_lead_city(None, address, search_city)
    except ImportError:
        return search_city or "N/A"


def _discover_organic_website_leads(category: str, location: str) -> List[Dict[str, Any]]:
    if not _organic_enabled() or not category or not location:
        return []
    max_sites = _organic_env_int("ORGANIC_DISCOVERY_MAX_SITES", 12, 0, 24)
    if max_sites <= 0:
        return []
    c = str(category or '').lower()
    is_frigo = any(x in c for x in ['frigo', 'frigor', 'refriger', 'celle frigor'])
    search_locs = _organic_search_locations(location, category)
    queries: List[str] = []
    if is_frigo:
        for loc in search_locs:
            queries.extend([
                f'{category} {loc}',
                f'celle frigorifere industriali {loc}',
                f'impianti frigoriferi industriali {loc}',
            ])
    else:
        for loc in search_locs:
            queries.extend([
                f'{category} {loc} azienda contatti',
                f'{category} {loc} sito ufficiale',
                f'{category} {loc}',
            ])
    candidates: List[Dict[str, str]] = []
    seen_hosts = set()
    for q in queries:
        q_loc = next((loc for loc in search_locs if loc.lower() in q.lower()), location)
        for item in _organic_google_urls(q, max_sites):
            origin = _organic_origin(item.get('url') or '')
            if not origin:
                continue
            host = urlparse(origin).netloc.lower().replace('www.', '')
            if host in seen_hosts:
                continue
            seen_hosts.add(host)
            candidates.append({
                'origin': origin,
                'url': item.get('url') or origin,
                'title': item.get('title') or '',
                'query': q,
                'search_city': q_loc,
            })
            if len(candidates) >= max_sites:
                break
        if len(candidates) >= max_sites:
            break
    leads: List[Dict[str, Any]] = []
    rejected_no_evidence = 0
    for item in candidates:
        origin = item['origin']
        title = item.get('title') or ''
        host = urlparse(origin).netloc.lower().replace('www.', '')
        search_city = str(item.get('search_city') or location)
        if _organic_looks_like_directory(title, host):
            continue
        location_l = search_city.strip().lower()
        if location_l and len(location_l) > 2 and location_l not in title.lower() and location_l not in host:
            continue
        evidence_blob = f"{title} {origin} {item.get('query') or ''}"
        if not _organic_category_evidence(category, evidence_blob):
            rejected_no_evidence += 1
            continue
        leads.append({
            'business_name': _organic_business_name(title, origin),
            'phone': '',
            'email': '',
            'website': origin,
            'city': _organic_lead_city(search_city),
            'category': category,
            'rating': None,
            'reviews_count': 0,
            'is_claimed': None,
            'tech_stack': ['Lead da sito web', 'Contatto da verificare'],
            'technical_report': {'source': 'organic_website_discovery', 'contact_found': False, 'serp_title': title},
        })
    if not leads and is_frigo:
        try:
            seeded = []
            seen_seed_hosts = set(seen_hosts)
            if create_client is None:
                seed_rows = []
            else:
                _seed_key = _get_supabase_key()
                _seed_sb = create_client(SUPABASE_URL, _seed_key)
                seed_rows = _seed_sb.table("searches").select("results, category, location, created_at").eq("status", "completed").ilike("location", f"%{location}%").order("created_at", desc=True).limit(200).execute().data or []
            for row in seed_rows:
                row_cat = str(row.get("category") or "").lower()
                if not any(x in row_cat for x in ["frigo", "frigor", "refriger", "celle frigor"]):
                    continue
                arr = row.get("results") or []
                if isinstance(arr, str):
                    try:
                        arr = json.loads(arr)
                    except Exception:
                        arr = []
                if not isinstance(arr, list):
                    continue
                for old in arr:
                    site = str(old.get("sito") or old.get("website") or "").strip()
                    origin = _organic_origin(site)
                    if not origin:
                        continue
                    host = urlparse(origin).netloc.lower().replace("www.", "")
                    if not host or host in seen_seed_hosts:
                        continue
                    evidence = " ".join(str(old.get(k) or "") for k in ["azienda", "business_name", "nome", "categoria", "category", "sito", "website", "technical_report", "tech_stack"])
                    if not _organic_category_evidence(category, evidence):
                        continue
                    seen_seed_hosts.add(host)
                    seeded.append({
                        "business_name": str(old.get("azienda") or old.get("business_name") or old.get("nome") or _organic_business_name("", origin)),
                        "phone": str(old.get("telefono") or old.get("phone") or ""),
                        "email": str(old.get("email") or ""),
                        "website": origin,
                        "city": location,
                        "category": category,
                        "rating": old.get("rating"),
                        "reviews_count": old.get("reviews_count") or old.get("recensioni") or 0,
                        "is_claimed": old.get("is_claimed"),
                        "tech_stack": old.get("tech_stack") if isinstance(old.get("tech_stack"), list) else ["Lead da sito web", "Contatto da verificare"],
                        "technical_report": old.get("technical_report") if isinstance(old.get("technical_report"), dict) else {"source": "organic_website_discovery", "seeded_from_db": True},
                    })
                    if len(seeded) >= max_sites:
                        break
                if len(seeded) >= max_sites:
                    break
            if seeded:
                leads = seeded
                print(f'[worker_supabase] Organic DB seed fallback: leads={len(leads)}', flush=True)
        except Exception as e:
            print(f'[worker_supabase] Organic DB seed fallback skipped: {e}', flush=True)
    if is_frigo and len(leads) < max_sites and str(os.getenv("ORGANIC_CURATED_FRIGO_FALLBACK", "0")).strip().lower() in {"1", "true", "yes", "on"}:
        try:
            curated = [
                ("https://www.crfrigor.com", "C.R. FRIGOR - celle frigorifere industriali Milano"),
                ("https://www.frigorbox.it", "Frigorbox - celle frigorifere industriali e commerciali"),
                ("https://www.refridom.it", "Refridom - installazione manutenzione celle frigorifere Milano"),
                ("https://www.isocostruzioni.it", "Isocostruzioni - celle frigorifere industriali"),
                ("https://www.madefrigor.it", "Madefrigor - refrigerazione industriale"),
                ("https://cellefrigorifereindustriali.com", "Celle frigorifere industriali su misura"),
                ("https://www.cmcrefrigeration.it", "CMC Refrigeration"),
                ("https://www.mp-refrigerazione.it", "MP Refrigerazione - celle frigorifere industriali e commerciali"),
                ("http://www.addafrigor.it", "AddA Frigor - impianti frigoriferi industriali"),
                ("https://www.frozensrl.it", "Frozen SRL - refrigerazione industriale e commerciale"),
                ("http://www.fossatimilano.it", "Fossati - celle frigorifere Milano"),
            ]
            known_hosts = set()
            for old in leads:
                origin = _organic_origin(str(old.get("website") or old.get("sito") or ""))
                if origin:
                    known_hosts.add(urlparse(origin).netloc.lower().replace("www.", ""))
            added = 0
            for url, title in curated:
                if len(leads) >= max_sites:
                    break
                origin = _organic_origin(url)
                if not origin:
                    continue
                host = urlparse(origin).netloc.lower().replace("www.", "")
                if not host or host in known_hosts:
                    continue
                evidence = f"{title} {origin} {category} {location}"
                if not _organic_category_evidence(category, evidence):
                    continue
                known_hosts.add(host)
                leads.append({
                    "business_name": _organic_business_name(title, origin),
                    "phone": "",
                    "email": "",
                    "website": origin,
                    "city": location,
                    "category": category,
                    "rating": None,
                    "reviews_count": 0,
                    "is_claimed": None,
                    "tech_stack": ["Lead da sito web", "Contatto da verificare"],
                    "technical_report": {"source": "organic_website_discovery", "contact_found": False, "curated_frigo_seed": True, "serp_title": title},
                })
                added += 1
            if added:
                print(f'[worker_supabase] Organic curated frigo seed fallback: added={added} leads={len(leads)}', flush=True)
        except Exception as e:
            print(f'[worker_supabase] Organic curated frigo seed fallback skipped: {e}', flush=True)
    print(f'[worker_supabase] Organic website discovery summary: candidates={len(candidates)} leads={len(leads)} no_evidence={rejected_no_evidence}', flush=True)
    return leads


def _is_non_domestic_refrigeration_search(category: str) -> bool:
    c = str(category or "").lower()
    has_refrigeration = any(x in c for x in ["frigo", "frigor", "refriger", "celle frigor"])
    has_strict_b2b_intent = any(x in c for x in [
        "industrial", "industriali", "commercial", "commerciali", "celle frigor",
        "impianti frigor", "impianto frigor", "banchi frigo", "gdo", "horeca",
        "supermercat", "aziende", "professionali",
    ])
    has_domestic = any(x in c for x in ["domestic", "elettrodomestic", "casa", "privati", "appartamenti"])
    return has_refrigeration and has_strict_b2b_intent and not has_domestic


def _filter_non_domestic_refrigeration_results(category: str, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not _is_non_domestic_refrigeration_search(category):
        return results

    domestic_terms = [
        "elettrodomestici", "elettrodomestico", "assistenza elettrodomestici",
        "riparazione elettrodomestici", "riparazioni elettrodomestici",
        "frigoriferi domestici", "frigorifero domestico", "frigo casa", "frigorifero casa",
        "home service", "assistenza autorizzata", "centro assistenza autorizzato",
        "lavatrice", "lavatrici", "lavastoviglie", "asciugatrice", "asciugatrici",
        "forni", "piani cottura", "microonde", "caldaie", "scaldabagni",
        "privati", "appartamenti", "abitazioni", "casa", "domestico", "domestici",
        "civile", "civili", "residenziale", "residenziali", "condizionamento civile",
        "climatizzazione civile", "impianti civili", "utenze domestiche",
    ]

    required_industrial_terms = [
        "refrigerazione industriale", "refrigerazione commerciale",
        "frigorista industriale", "frigoristi industriali",
        "impianti frigoriferi industriali", "impianto frigorifero industriale",
        "impianti frigoriferi", "impianto frigorifero",
        "celle frigorifere", "cella frigorifera", "celle frigo",
        "banchi frigo", "banco frigo", "centrali frigorifere", "centrale frigorifera",
        "gruppi frigoriferi", "gruppo frigorifero", "chiller", "surgelazione",
        "tunnel di surgelazione", "abbattitori", "catena del freddo", "logistica del freddo",
        "cold chain", "gdo", "horeca", "supermercati", "supermercato",
        "alimentare", "agroalimentare", "caseifici", "macelli",
        "industriale", "industriali", "commerciale", "commerciali",
    ]

    organic_specific_refrigeration_terms = [
        "refrigerazione industriale", "refrigerazione commerciale",
        "refriger", "frigor", "frigo", "cold",
        "frigorista", "frigoristi", "frigoriferi industriali",
        "impianti frigoriferi", "impianto frigorifero", "impianti di refrigerazione",
        "celle frigorifere", "cella frigorifera", "celle frigo",
        "banchi frigo", "banco frigo", "centrali frigorifere", "gruppi frigoriferi",
        "chiller", "surgelazione", "abbattitori", "catena del freddo",
        "logistica del freddo", "magazzini frigoriferi", "magazzino frigorifero",
    ]

    organic_b2b_scale_terms = [
        "industriale", "industriali", "commerciale", "commerciali",
        "professionale", "professionali", "impianti", "impianto",
        "su misura", "chiavi in mano", "centrali frigorifere", "centrale frigorifera",
        "gruppi frigoriferi", "gruppo frigorifero", "chiller", "surgelazione",
        "tunnel di surgelazione", "catena del freddo", "logistica del freddo",
        "gdo", "horeca", "supermercati", "supermercato", "alimentare",
        "agroalimentare", "caseifici", "macelli",
    ]

    organic_blocked_terms = [
        "annunciindustriali", "annunci industriali", "marketplace", "annunci", "aste",
        "usato", "subito", "kijiji", "carrello", "checkout", "spedizione",
        "allforfood", "gastrodomus", "allfoodproject", "forniture alberghiere",
        "attrezzature per ristorazione", "ristorazione professionale",
        "area-clienti", "area clienti", "login", "accedi", "registrati",
    ]

    def _is_organic(item: Dict[str, Any]) -> bool:
        blob = " ".join([
            str(item.get("source") or ""),
            str(item.get("tech_stack") or ""),
            str(item.get("technical_report") or ""),
        ]).lower()
        return "organic_website_discovery" in blob or "lead da sito web" in blob or "contatto da verificare" in blob

    def _has_contact(item: Dict[str, Any]) -> bool:
        phone = str(item.get("telefono") or item.get("phone") or "").strip()
        email = str(item.get("email") or "").strip()
        digits = re.sub(r"\D+", "", phone)
        bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null", "-", "—"}
        return (phone not in bad and len(digits) >= 8) or _is_real_business_email(email)

    filtered: List[Dict[str, Any]] = []
    removed_domestic: List[str] = []
    removed_no_industrial_evidence: List[str] = []
    removed_organic_no_contact: List[str] = []

    for item in results or []:
        evidence_blob = " ".join(
            str(item.get(k) or "")
            for k in [
                "azienda", "nome", "business_name", "sito", "website", "email", "telefono",
                "tech_stack", "technical_report", "descrizione", "description", "snippet",
            ]
        ).lower()
        label = str(item.get("azienda") or item.get("nome") or item.get("business_name") or item.get("sito") or item.get("website") or "").strip()
        has_domestic_signal = any(term in evidence_blob for term in domestic_terms)
        has_required_industrial_signal = any(term in evidence_blob for term in required_industrial_terms)
        is_organic = _is_organic(item)

        if has_domestic_signal:
            removed_domestic.append(label)
            continue

        if is_organic:
            tr = item.get("technical_report") if isinstance(item.get("technical_report"), dict) else {}
            is_audited = bool(tr.get("organic_audited"))
            if is_audited and not _has_contact(item):
                removed_organic_no_contact.append(label)
                continue
            if any(term in evidence_blob for term in organic_blocked_terms):
                removed_no_industrial_evidence.append(label)
                continue
            if not any(term in evidence_blob for term in organic_specific_refrigeration_terms):
                removed_no_industrial_evidence.append(label)
                continue
            if not any(term in evidence_blob for term in organic_b2b_scale_terms):
                removed_no_industrial_evidence.append(label)
                continue
            if not has_required_industrial_signal:
                removed_no_industrial_evidence.append(label)
                continue

        filtered.append(item)

    if removed_domestic or removed_no_industrial_evidence or removed_organic_no_contact:
        print(
            f"[worker_supabase] SAFE industrial refrigeration filter: kept={len(filtered)} "
            f"removed_domestic={len(removed_domestic)} removed_organic_no_contact={len(removed_organic_no_contact)} "
            f"removed_organic_no_industrial_evidence={len(removed_no_industrial_evidence)} "
            f"domestic_sample={removed_domestic[:8]} no_contact_sample={removed_organic_no_contact[:8]} "
            f"no_evidence_sample={removed_no_industrial_evidence[:8]}",
            flush=True,
        )
    return filtered

def _lead_merge_quality(item: Dict[str, Any]) -> int:
    score = 0
    tech = item.get("tech_stack")
    tech_parts: List[str] = []
    if isinstance(tech, list):
        tech_parts = [str(t).lower() for t in tech if isinstance(t, str)]
    elif isinstance(tech, str):
        tech_parts = [tech.lower()]
    if tech_parts:
        if any("verifica in corso" in t or "audit in arrivo" in t or "stack in arrivo" in t for t in tech_parts):
            score -= 200
        else:
            score += 80
    email = str(item.get("email") or "").strip().lower()
    if email and email not in {"n/d", "n/a", "none", "null"}:
        score += 25
    phone = re.sub(r"\D+", "", str(item.get("telefono") or ""))
    if len(phone) >= 8:
        score += 15
    try:
        score += int(item.get("quality_score") or 0)
    except Exception:
        pass
    tr = item.get("technical_report")
    if isinstance(tr, dict) and tr:
        score += 10
        if tr.get("load_speed_seconds") is not None or tr.get("html_errors") is not None:
            score += 25
    if item.get("last_audited_at"):
        score += 15
    try:
        if int(item.get("audit_version") or 0) >= 2:
            score += 10
    except Exception:
        pass
    return score


def _merge_lead_pair(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Merge two lead records — never downgrade a complete audit to pending."""
    ex_pending = _lead_has_pending_audit(existing)
    inc_pending = _lead_has_pending_audit(incoming)
    if inc_pending and not ex_pending:
        return existing
    if ex_pending and not inc_pending:
        winner, loser = incoming, existing
    elif _lead_merge_quality(incoming) > _lead_merge_quality(existing):
        winner, loser = incoming, existing
    elif _lead_merge_quality(existing) > _lead_merge_quality(incoming):
        winner, loser = existing, incoming
    else:
        winner, loser = incoming, existing

    merged = dict(loser)
    merged.update(winner)
    for field in ("telefono", "phone", "email", "nome", "azienda", "instagram", "facebook"):
        if not merged.get(field) and loser.get(field):
            merged[field] = loser.get(field)
    if _lead_has_pending_audit(merged) and not _lead_has_pending_audit(loser):
        merged["tech_stack"] = loser.get("tech_stack")
        if isinstance(loser.get("technical_report"), dict):
            merged["technical_report"] = loser.get("technical_report")

    def _merge_records(field: str, key_fields: tuple[str, ...]) -> None:
        records: List[Dict[str, Any]] = []
        seen_records: Set[str] = set()
        for source in (existing, incoming):
            values = source.get(field)
            if not isinstance(values, list):
                continue
            for value in values:
                if not isinstance(value, dict):
                    continue
                key = "|".join(str(value.get(name) or "").strip().lower() for name in key_fields)
                if not key.strip("|") or key in seen_records:
                    continue
                seen_records.add(key)
                records.append(dict(value))
        if records:
            merged[field] = records

    _merge_records("agentic_evidence_records", ("source_url", "claim"))
    _merge_records("business_hiring_jobs", ("title", "url", "source"))

    signals_by_type: Dict[str, Dict[str, Any]] = {}
    for source in (existing, incoming):
        for signal in source.get("business_signals") or []:
            if not isinstance(signal, dict):
                continue
            signal_type = str(signal.get("type") or "").strip()
            if not signal_type:
                continue
            previous = signals_by_type.get(signal_type, {})
            combined = {**previous, **signal}
            evidence: List[Any] = []
            for candidate in (previous.get("evidence"), signal.get("evidence")):
                if isinstance(candidate, list):
                    evidence.extend(candidate)
                elif candidate:
                    evidence.append(candidate)
            if evidence:
                unique_evidence: List[Any] = []
                seen_evidence: Set[str] = set()
                for item in evidence:
                    try:
                        evidence_key = json.dumps(item, sort_keys=True, ensure_ascii=False)
                    except (TypeError, ValueError):
                        evidence_key = str(item)
                    if evidence_key in seen_evidence:
                        continue
                    seen_evidence.add(evidence_key)
                    unique_evidence.append(item)
                combined["evidence"] = unique_evidence
            signals_by_type[signal_type] = combined
    if signals_by_type:
        merged["business_signals"] = list(signals_by_type.values())

    matched = {
        str(value).strip().lower()
        for source in (existing, incoming)
        for value in (source.get("matched_signals") or [])
        if str(value).strip()
    }
    required = {
        str(value).strip().lower()
        for source in (existing, incoming)
        for value in (source.get("required_signals") or [])
        if str(value).strip()
    }
    if matched:
        merged["matched_signals"] = sorted(matched)
    if required:
        merged["required_signals"] = sorted(required)
        coverage = len(required.intersection(matched)) / len(required)
        if coverage >= 1:
            merged["query_match_status"] = "verified"
            merged["query_match_score"] = max(int(merged.get("query_match_score") or 0), 85)
        elif coverage > 0:
            merged["query_match_status"] = "partial"
    return merged


def _merge_formatted_results(primary: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []

    def key_for(item: Dict[str, Any]) -> str:
        site = str(item.get("sito") or item.get("website") or "").lower().strip().replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/")
        phone = re.sub(r"\D+", "", str(item.get("telefono") or ""))
        name = re.sub(r"\W+", "", str(item.get("azienda") or item.get("nome") or "").lower())
        address = re.sub(r"\s+", "", str(item.get("indirizzo") or item.get("address") or "").lower())
        # Prefer name+address so distinct branches of the same chain are kept.
        if name and address:
            return f"nameaddr:{name}|{address}"
        if site and name:
            return f"site:{site}|name:{name}"
        if phone:
            return f"phone:{phone}"
        if site:
            return f"site:{site}"
        if name:
            return f"name:{name}"
        return ""

    for item in list(primary or []) + list(extra or []):
        k = key_for(item)
        if not k:
            continue
        if k not in by_key:
            order.append(k)
            by_key[k] = item
            continue
        by_key[k] = _merge_lead_pair(by_key[k], item)
    return [by_key[k] for k in order if k in by_key]


def _cap_search_results(
    results: Any,
    max_results: int,
    *,
    prioritize_hot: bool = False,
) -> List[Dict[str, Any]]:
    """Return a deduplicated result set that never exceeds the user contract."""
    try:
        cap = max(1, int(max_results))
    except (TypeError, ValueError):
        cap = 1
    valid = _drop_blacklisted_formatted_leads(results)
    merged = _merge_formatted_results([], valid)
    if prioritize_hot:
        merged.sort(
            key=lambda item: (
                float(item.get("hotness_score") or 0),
                float(item.get("query_match_score") or 0),
                float(item.get("opportunity_score") or 0),
                bool(item.get("email") or item.get("telefono") or item.get("phone")),
            ),
            reverse=True,
        )
    return merged[:cap]


def _drop_blacklisted_formatted_leads(results: Any) -> List[Dict[str, Any]]:
    try:
        from agents.portal_blacklist import is_blacklisted_domain, is_blacklisted_name, normalize_domain
    except Exception:
        return [item for item in (results or []) if isinstance(item, dict)]
    out: List[Dict[str, Any]] = []
    for item in results or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("azienda") or item.get("nome") or item.get("business_name") or "").strip()
        site = str(item.get("sito") or item.get("website") or "").strip()
        if is_blacklisted_name(name) or is_blacklisted_domain(normalize_domain(site)):
            print(f"[worker_supabase] Drop blacklisted lead: {name[:80]} {site[:80]}", flush=True)
            continue
        out.append(item)
    return out


def _build_meta_ads_library_url(facebook_url: Optional[str], website_url: Optional[str]) -> Optional[str]:
    try:
        q: Optional[str] = None
        if facebook_url and isinstance(facebook_url, str):
            u = facebook_url.strip()
            if "facebook.com" in u:
                try:
                    # Normalize and extract the first path segment (page handle)
                    u2 = u.split("?", 1)[0]
                    parts = u2.split("facebook.com/", 1)[1].split("/")
                    handle = parts[0].strip()
                    if handle and handle.lower() not in {"pages", "profile.php"}:
                        q = handle
                except Exception:
                    q = None

        if not q and website_url and isinstance(website_url, str):
            try:
                from urllib.parse import urlparse

                netloc = (urlparse(website_url).netloc or "").split(":", 1)[0]
                if netloc.startswith("www."):
                    netloc = netloc[4:]
                q = netloc or None
            except Exception:
                q = None

        if not q:
            return None

        from urllib.parse import quote

        return (
            "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IT&q="
            + quote(q)
        )
    except Exception:
        return None


def _organic_looks_like_directory(title: str, host: str) -> bool:
    t = (title or '').lower()
    h = (host or '').lower()
    directory_keywords = [
        'migliori', 'top ', 'top 10', 'guida', 'elenco', 'lista', 'directory', 'portale',
        'prenota', 'prenotazione', 'recensioni', 'opinioni', 'confronta', 'offerte',
        'magazine', 'rivista', 'giornale', 'notizie', 'news', 'blog', 'articoli', 'digest',
    ]
    if any(kw in t for kw in directory_keywords):
        return True
    directory_hosts = [
        'quandoo', 'thefork', 'michelin', 'tripadvisor', 'paginegialle', 'paginebianche',
        'milanotoday', 'romatoday', 'napolitoday', 'torinotoday', 'veneziatoday', 'bolognatoday',
        'firenzetoday', 'genovatoday', 'veronatoday', 'padovatoday', 'trentotoday',
        'yelp', 'opentable', 'reservation', 'infobel', 'cylex', 'kompass', 'europages',
        'trovit', 'infojobs', 'jooble', 'indeed', 'aziende.it', 'informazione-aziende.it',
        'reteimprese.it', 'misterimprese.it', 'virgilio', 'tuttocitta', 'mapcarta',
        'corriere.it', 'repubblica.it', 'lastampa.it', 'ilgiornale.it', 'ad-italia.it',
        'gamberorosso.it', 'identitagolose.it', 'finestresullarte.it', 'vivimilano',
    ]
    if any(d in h for d in directory_hosts):
        return True
    return False


async def _organic_backfill_leads(
    category: str,
    location: str,
    needed: int,
    existing_leads: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """When Maps results are exhausted, discover extra leads from organic search
    results and their websites, avoiding duplicates against existing leads."""
    if needed <= 0:
        return []
    # Scale discovery to the remaining gap, but keep it bounded and fast.
    # Capping sites keeps the backfill from dominating total job runtime.
    max_sites = min(max(needed, 12), 30)
    queries = [
        f'{category} {location}',
        f'{category} {location} contatti',
    ]
    existing_hosts: set = set()
    for lead in existing_leads:
        site = str(lead.get('website') or lead.get('sito') or '').strip()
        if site:
            try:
                host = urlparse(site).netloc.lower().replace('www.', '')
                if host:
                    existing_hosts.add(host)
            except Exception:
                pass

    candidates: List[Dict[str, str]] = []
    seen_hosts = set(existing_hosts)
    for q in queries:
        if len(candidates) >= max_sites:
            break
        for item in _organic_google_urls(q, max_sites):
            origin = _organic_origin(item.get('url') or '')
            if not origin:
                continue
            host = urlparse(origin).netloc.lower().replace('www.', '')
            if not host or host in seen_hosts:
                continue
            seen_hosts.add(host)
            candidates.append({'origin': origin, 'title': item.get('title') or '', 'query': q})
            if len(candidates) >= max_sites:
                break

    leads: List[Dict[str, Any]] = []
    lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(6)

    async def _audit_one(item: Dict[str, str]) -> Optional[Dict[str, Any]]:
        # Stop early once the target is reached.
        if len(leads) >= needed:
            return None
        origin = item['origin']
        title = item.get('title') or ''
        host = urlparse(origin).netloc.lower().replace('www.', '')
        if _organic_looks_like_directory(title, host):
            return None
        evidence_blob = f"{title} {origin} {item.get('query') or ''}"
        if not _organic_category_evidence(category, evidence_blob):
            return None
        # Require city signal in title/host for location-sensitive queries.
        location_l = (location or '').strip().lower()
        if location_l and len(location_l) > 2 and location_l not in title.lower() and location_l not in host:
            return None
        try:
            html = await asyncio.to_thread(_organic_fetch, origin, 5.0)
        except Exception:
            return None
        contacts = _organic_extract_contacts(html)
        if not contacts.get('email') and not contacts.get('phone'):
            return None
        return {
            'business_name': _organic_business_name(title, origin),
            'phone': contacts.get('phone', ''),
            'email': contacts.get('email', ''),
            'website': origin,
            'city': location,
            'category': category,
            'rating': None,
            'reviews_count': 0,
            'is_claimed': None,
            'tech_stack': ['Lead da sito web'],
            'technical_report': {'source': 'organic_backfill', 'contact_found': True},
        }

    async def _bounded(item: Dict[str, str]) -> None:
        async with semaphore:
            lead = await _audit_one(item)
        if not lead:
            return
        async with lock:
            if len(leads) < needed:
                leads.append(lead)

    await asyncio.gather(*[_bounded(item) for item in candidates])
    if leads:
        print(f'[worker_supabase] Organic backfill: +{len(leads)} leads for "{category} {location}"', flush=True)
    return leads


async def _run_core_scraper(category: str, location: str, zone: Optional[str] = None, on_result=None, on_audit_done=None, intent: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    # Import here to keep the module import light and avoid side effects at worker startup.
    # NOTE: This does NOT start the FastAPI server; main.py runs uvicorn only under __main__.
    # Also: the repo's `backend/` folder is not a Python package (no __init__.py), so we
    # add the repo root to sys.path and import `backend/main.py` as `backend.main`.
    # Defensive sys.path setup (in case this function is invoked in isolation)
    for _p in (_REPO_ROOT, _BACKEND_DIR):
        if _p and _p not in sys.path:
            sys.path.insert(0, _p)

    try:
        from backend import main as core  # type: ignore
    except ModuleNotFoundError as e:
        # Helpful diagnostics if imports fail on some machines.
        print("[worker_supabase] Import error while loading backend.main:", str(e))
        print("[worker_supabase] sys.path:")
        for p in sys.path[:15]:
            print(" -", p)
        raise

    AuditSignals = core.AuditSignals
    audit_website_with_status = core.audit_website_with_status
    deep_scrape_mobile_from_website = core.deep_scrape_mobile_from_website
    normalize_phone_italy = core.normalize_phone_italy
    normalize_website = core.normalize_website
    scrape_google_maps_playwright = core.scrape_google_maps_playwright
    run_technical_audit = getattr(core, "run_technical_audit", None)

    raw = await scrape_google_maps_playwright(category, location, zone, on_result=on_result)
    if not raw:
        # Fallback for cases where Maps opens directly a single activity card.
        try:
            one = await _scrape_single_place_fallback(category, location, zone)
            if one:
                raw = one
        except Exception:
            pass

    # If Maps didn't reach the requested cap, backfill with leads discovered from
    # organic search results and their websites.
    # Keep a hard ceiling so auditing stays within memory/time budgets.
    LEAD_HARD_CAP = 200
    job_max = 0
    z = (zone or "").strip()
    if z.isdigit():
        job_max = int(z)
    cap_new = job_max if job_max > 0 else 500
    cap_new = min(cap_new, LEAD_HARD_CAP)
    if len(raw or []) < cap_new and not (
        isinstance(intent, dict) and str(intent.get("source_adapter") or "").strip() == "legacy_digital_audit_v1"
    ):
        try:
            needed = cap_new - len(raw or [])
            backfill = await _organic_backfill_leads(category, location, needed, raw or [])
            if backfill:
                raw = (raw or []) + backfill[:needed]
        except Exception as e:
            print(f'[worker_supabase] Organic backfill error: {e}', flush=True)

    async def _audit_single_lead(item: Dict[str, Any], i: int) -> Dict[str, Any]:
        try:
            return await _audit_single_lead_inner(item, i)
        except Exception as e:
            print(f"[worker_supabase] Audit lead {i} ({item.get('business_name') or '?'}): {e}", flush=True)
            # Return a minimal lead so the caller still has the Maps data.
            return {
                "result_index": i,
                "business_name": item.get("business_name") or "Unknown",
                "address": item.get("address"),
                "phone": normalize_phone_italy(item.get("phone")),
                "email": None,
                "website": normalize_website(item.get("website")),
                "website_status": "MISSING_WEBSITE",
                "tech_stack": ["Verifica in corso"],
                "load_speed_s": None,
                "domain_creation_date": None,
                "domain_expiration_date": None,
                "website_http_status": None,
                "website_error": "Audit failed",
                "website_has_html": False,
                "website_error_line": None,
                "website_error_hint": str(e)[:120],
                "instagram_missing": False,
                "tiktok_missing": True,
                "pixel_missing": True,
                "instagram": None,
                "facebook": None,
                "meta_ads_library": None,
                "decision_maker": "N/D",
                "meta_pixel": False,
                "google_tag_manager": False,
                "html_errors": 0,
                "technical_report": {"error": str(e)[:120]},
                "audit": {
                    "has_ssl": False,
                    "is_mobile_responsive": False,
                    "has_facebook_pixel": False,
                    "has_tiktok_pixel": False,
                    "has_gtm": False,
                    "missing_instagram": False,
                },
                "category": category,
                "city": location,
                "rating": item.get("rating"),
                "reviews_count": item.get("reviews_count"),
                "is_claimed": item.get("is_claimed"),
                "google_reviews": [],
                "local_competitors": [],
            }

    async def _audit_single_lead_inner(item: Dict[str, Any], i: int) -> Dict[str, Any]:
        name = item.get("business_name") or "Unknown"
        address = item.get("address")
        website = item.get("website")
        rating = item.get("rating")
        reviews_count = item.get("reviews_count")
        is_claimed = item.get("is_claimed")
        website_norm = normalize_website(website) if website else None

        phone_norm = normalize_phone_italy(item.get("phone"))
        phone_from_maps = phone_norm

        website_http_status: Optional[int] = None
        website_error: Optional[str] = None
        website_error_line: Optional[int] = None
        website_error_hint: Optional[str] = None
        website_html: Optional[str] = None
        website_has_html = False
        tech_stack = "Custom HTML"
        load_speed_s: Optional[float] = None
        domain_creation_date: Optional[str] = None
        domain_expiration_date: Optional[str] = None

        if website_norm:
            try:
                (
                    audit,
                    tech_stack,
                    load_speed_s,
                    domain_creation_date,
                    domain_expiration_date,
                    email,
                    website_http_status,
                    website_error,
                    website_html,
                    website_error_line,
                    website_error_hint,
                ) = await asyncio.wait_for(audit_website_with_status(website_norm), timeout=15.0)
            except asyncio.TimeoutError:
                audit, email = AuditSignals(), None
                tech_stack = "Custom HTML"
                load_speed_s = None
                domain_creation_date = None
                domain_expiration_date = None
                website_http_status, website_error = None, "Timeout"
                website_error_line, website_error_hint = None, "Timeout"
            except Exception:
                # Non-fatal: do not crash the entire worker if a single site audit fails.
                audit, email = AuditSignals(), None
                tech_stack = "Custom HTML"
                load_speed_s = None
                domain_creation_date = None
                domain_expiration_date = None
                website_http_status, website_error = None, "Audit failed"
                website_error_line, website_error_hint = None, "Audit failed"
            website_status = "HAS_WEBSITE"
        else:
            audit = AuditSignals()
            email = None
            website_status = "MISSING_WEBSITE"

        # NO WEBSITE shortcut: replicate desktop behavior (skip audits, mark opportunity)
        error_details: List[str] = []
        has_google_ads = False
        has_ga4 = False
        has_chatbot = False
        has_booking_system = False
        has_ecommerce = False
        has_spf = False
        has_dmarc = False
        seo_disaster = False
        decision_maker = "N/D"
        load_speed_seconds: Optional[float] = None
        if not website_norm:
            instagram = None
            facebook = None
            meta_pixel = False
            google_tag_manager = False
            html_errors = 0
            error_details = []
            has_google_ads = False
            has_ga4 = False
            has_chatbot = False
            has_booking_system = False
            has_ecommerce = False
            has_spf = False
            has_dmarc = False
            seo_disaster = False
            decision_maker = "N/D"
            load_speed_seconds = None
            tech_stack_list = ["NO WEBSITE"]
        else:
            instagram = _extract_first_social_link(website_html, "instagram")
            facebook = _extract_first_social_link(website_html, "facebook")

            # Strengthen TikTok detection: besides existing patterns, check for ttq.load and generic tiktok.com.
            html_lower = (website_html or "").lower() if website_html else ""
            tiktok_pixel = bool(getattr(audit, "has_tiktok_pixel", False)) or (
                "ttq.load" in html_lower or "tiktok.com" in html_lower
            )

            # Cookie banners (Cookiebot, Iubenda, etc.) often prevent JS execution, so rely on
            # raw HTML string scanning (including <script type="text/plain"> blocks).
            raw_html = website_html or ""
            raw_lower = raw_html.lower()

            meta_pixel = bool(getattr(audit, "has_facebook_pixel", False)) or (
                "fbevents.js" in raw_lower
                or "connect.facebook.net" in raw_lower
                or "fbq('init'" in raw_lower
                or "fbq(\"init\"" in raw_lower
            )

            google_tag_manager = bool(getattr(audit, "has_gtm", False)) or (
                "gtm.js" in raw_lower or bool(re.search(r"\bGTM-[A-Z0-9]+\b", raw_html, flags=re.IGNORECASE))
            )

            # Keep payload flags consistent even if audit engine couldn't detect them.
            try:
                setattr(audit, "has_facebook_pixel", bool(meta_pixel))
            except Exception:
                pass
            try:
                setattr(audit, "has_gtm", bool(google_tag_manager))
            except Exception:
                pass

            html_errors = 0
            if run_technical_audit is not None:
                try:
                    report = await asyncio.to_thread(run_technical_audit, website_norm, existing_phone=phone_from_maps)
                    issues = report.get("issues") if isinstance(report, dict) else None
                    if isinstance(issues, list):
                        html_errors = len(issues)
                    # Fill phone only if Maps didn't provide it.
                    try:
                        if not phone_from_maps and isinstance(report, dict) and report.get("phone"):
                            phone_norm = normalize_phone_italy(str(report.get("phone")))
                    except Exception:
                        pass
                    ed = report.get("error_details") if isinstance(report, dict) else None
                    if isinstance(ed, list):
                        error_details = [str(x) for x in ed if str(x).strip()]
                    has_google_ads = bool(report.get("has_google_ads")) if isinstance(report, dict) else False
                    has_ga4 = bool(report.get("has_ga4")) if isinstance(report, dict) else False
                    has_chatbot = bool(report.get("has_chatbot")) if isinstance(report, dict) else False
                    has_booking_system = bool(report.get("has_booking_system")) if isinstance(report, dict) else False
                    has_ecommerce = bool(report.get("has_ecommerce")) if isinstance(report, dict) else False
                    has_spf = bool(report.get("has_spf")) if isinstance(report, dict) else False
                    has_dmarc = bool(report.get("has_dmarc")) if isinstance(report, dict) else False
                    seo_disaster = bool(report.get("seo_disaster")) if isinstance(report, dict) else False
                    try:
                        decision_maker = (
                            str(report.get("decision_maker"))
                            if isinstance(report, dict) and report.get("decision_maker")
                            else "N/D"
                        )
                    except Exception:
                        decision_maker = "N/D"
                    try:
                        load_speed_seconds = (
                            float(report.get("load_speed_seconds"))
                            if isinstance(report, dict) and report.get("load_speed_seconds") is not None
                            else None
                        )
                    except Exception:
                        load_speed_seconds = None
                except Exception:
                    html_errors = 0
                    error_details = []
                    has_google_ads = False
                    has_ga4 = False
                    has_chatbot = False
                    has_booking_system = False
                    has_ecommerce = False
                    has_spf = False
                    has_dmarc = False
                    seo_disaster = False
                    decision_maker = "N/D"
                    load_speed_seconds = None

            tech_stack_list: List[str] = []

            # CMS / technologies from tech_stack string (normalize to labels)
            try:
                ts_raw = (tech_stack or "").strip() if isinstance(tech_stack, str) else ""
                key = ts_raw.lower()
                if "wordpress" in key:
                    tech_stack_list.append("WORDPRESS")
                elif "shopify" in key:
                    tech_stack_list.append("SHOPIFY")
                elif "wix" in key:
                    tech_stack_list.append("WIX")
            except Exception:
                pass

            # Positive signals
            try:
                if bool(getattr(audit, "has_ssl", False)):
                    tech_stack_list.append("SSL")
                if bool(getattr(audit, "is_mobile_responsive", False)):
                    tech_stack_list.append("MOBILE")
            except Exception:
                pass

            # Absence labels (sales opportunities)
            if not meta_pixel:
                tech_stack_list.append("MISSING FB PIXEL")
            else:
                tech_stack_list.append("Meta Pixel")

            if not google_tag_manager:
                tech_stack_list.append("MISSING GTM")
            else:
                tech_stack_list.append("GTM")

            if not tiktok_pixel:
                tech_stack_list.append("NO TIKTOK")
            else:
                tech_stack_list.append("TikTok Pixel")

            # Ads / GA4 / Chatbot (presence + absence)
            if has_google_ads:
                tech_stack_list.append("GOOGLE ADS")
            else:
                tech_stack_list.append("MISSING GOOGLE ADS")

            if has_ga4:
                tech_stack_list.append("GA4")
            else:
                tech_stack_list.append("MISSING GA4")

            if has_chatbot:
                tech_stack_list.append("CHATBOT AI")
            else:
                tech_stack_list.append("NO CHATBOT")

            # Booking / E-commerce radar (only add if present)
            if has_booking_system:
                tech_stack_list.append("SISTEMA PRENOTAZIONI")
            if has_ecommerce:
                tech_stack_list.append("E-COMMERCE")

            # Slow site trigger (use audit_engine measurement if available, fallback to existing load_speed_s)
            try:
                effective_speed = load_speed_seconds if load_speed_seconds is not None else load_speed_s
                if effective_speed is not None and float(effective_speed) > 4.0:
                    tech_stack_list.append("SITO LENTO")
            except Exception:
                pass

            # DMARC/SPF trigger
            try:
                if has_dmarc:
                    tech_stack_list.append("DMARC OK")
                else:
                    tech_stack_list.append("EMAIL IN SPAM (NO DMARC)")
            except Exception:
                pass

            # SEO disaster trigger
            try:
                if seo_disaster:
                    tech_stack_list.append("DISASTRO SEO (NO H1/TITLE)")
            except Exception:
                pass

        # Maps claimed trigger
        try:
            if is_claimed is False:
                tech_stack_list.append("SCHEDA NON RIVENDICATA")
        except Exception:
            pass

        # De-duplicate while preserving order
        try:
            tech_stack_list = list(dict.fromkeys([t for t in tech_stack_list if str(t).strip()]))
        except Exception:
            pass

        # If audit failed or yielded nothing useful, keep a non-empty label.
        if not tech_stack_list:
            tech_stack_list = ["Verifica in corso"]

        if website_norm:
            try:
                deep_mobile = await asyncio.wait_for(
                    deep_scrape_mobile_from_website(website_norm, website_html),
                    timeout=8.0,
                )
                # Merge mobile found on website with Maps phone (often a landline).
                # If Maps phone is missing, fallback to the mobile.
                existing = (phone_norm or "").strip() if isinstance(phone_norm, str) else ""
                existing_valid = bool(existing) and existing.upper() not in {"N/D", "N/A", "NONE", "NULL"}

                if deep_mobile:
                    if not existing_valid:
                        phone_norm = deep_mobile
                    else:
                        try:
                            existing_digits = re.sub(r"\D+", "", existing)
                            mobile_digits = re.sub(r"\D+", "", str(deep_mobile))
                            already_present = bool(mobile_digits) and mobile_digits in existing_digits
                        except Exception:
                            already_present = False

                        if not already_present:
                            phone_norm = f"{existing} / {deep_mobile}"
            except Exception:
                pass

        if website_html:
            website_has_html = True

        meta_ads_library = _build_meta_ads_library_url(facebook, website_norm)

        detected_crms: List[str] = []
        if website_html and detect_crm_from_html:
            try:
                detected_crms = detect_crm_from_html(website_html) or []
            except Exception:
                detected_crms = []

        return {
            "result_index": i,
            "business_name": name,
            "address": address,
            "phone": phone_norm,
            "email": email,
            "website": website_norm,
            "website_status": website_status,
            "tech_stack": tech_stack_list,
            "load_speed_s": load_speed_s,
            "domain_creation_date": domain_creation_date,
            "domain_expiration_date": domain_expiration_date,
            "website_http_status": website_http_status,
            "website_error": website_error,
            "website_has_html": website_has_html,
            "website_error_line": website_error_line,
            "website_error_hint": website_error_hint,
            "instagram_missing": bool(getattr(audit, "missing_instagram", False)),
            "tiktok_missing": not bool(getattr(audit, "has_tiktok_pixel", False)),
            "pixel_missing": not bool(getattr(audit, "has_facebook_pixel", False)),
            "instagram": instagram,
            "facebook": facebook,
            "meta_ads_library": meta_ads_library,
            "detected_crm_stack": detected_crms,
            "decision_maker": decision_maker,
            "meta_pixel": meta_pixel,
            "google_tag_manager": google_tag_manager,
            "html_errors": html_errors,
            "technical_report": {
                "html_errors": html_errors,
                "load_speed_s": load_speed_s,
                "load_speed_seconds": load_speed_seconds,
                "error_details": error_details,
                "has_google_ads": has_google_ads,
                "has_ga4": has_ga4,
                "has_chatbot": has_chatbot,
                "has_booking_system": has_booking_system,
                "has_ecommerce": has_ecommerce,
                "has_spf": has_spf,
                "has_dmarc": has_dmarc,
                "seo_disaster": seo_disaster,
            },
            "audit": {
                "has_ssl": bool(getattr(audit, "has_ssl", False)),
                "is_mobile_responsive": bool(getattr(audit, "is_mobile_responsive", False)),
                "has_facebook_pixel": bool(getattr(audit, "has_facebook_pixel", False)),
                "has_tiktok_pixel": bool(getattr(audit, "has_tiktok_pixel", False)),
                "has_gtm": bool(getattr(audit, "has_gtm", False)),
                "missing_instagram": bool(getattr(audit, "missing_instagram", False)),
            },
            "category": category,
            "city": location,
            "rating": rating,
            "reviews_count": reviews_count,
            "is_claimed": is_claimed,
            "google_reviews": [],
            "local_competitors": [],
        }

    results: List[Dict[str, Any]] = []
    raw_items = raw or []
    if isinstance(intent, dict) and str(intent.get("source_adapter") or "").strip() == "legacy_digital_audit_v1":
        raw_items = select_digital_audit_maps_page(raw_items, intent)
    control_records = [item for item in raw_items if item.get("_maps_control_only") is True]
    raw_items = [item for item in raw_items if item.get("_maps_control_only") is not True]
    if raw_items:
        sem = asyncio.Semaphore(12)

        async def _bounded(i: int, item: Dict[str, Any]) -> Dict[str, Any]:
            async with sem:
                return await _audit_single_lead(item, i)

        pending = {
            asyncio.create_task(_bounded(i, item)): (i, item)
            for i, item in enumerate(raw_items)
        }
        completed_since_notify = 0
        for coro in asyncio.as_completed(pending):
            try:
                lead = await coro
            except Exception as e:
                print(f"[worker_supabase] Audit lead failed: {e}", flush=True)
                continue
            results.append(lead)
            completed_since_notify += 1
            if on_audit_done and completed_since_notify >= 5:
                try:
                    on_audit_done(list(results))
                except Exception:
                    pass
                completed_since_notify = 0
        if on_audit_done and completed_since_notify:
            try:
                on_audit_done(list(results))
            except Exception:
                pass
        results.sort(key=lambda x: x.get("result_index", 0))
    results.extend(control_records)
    print(
        f"[worker_supabase] Core scraper: acquired={len(raw or [])} page_raw={len(raw_items)} audited={len(results)}",
        flush=True,
    )

    # Reviews/competitors: optional enrichment — must NOT block job completion (Blocco 1.3).
    enrich_reviews = os.getenv("ENRICH_REVIEWS", "0").strip().lower() in {"1", "true", "yes"}
    if enrich_reviews and results:
        for lead in results:
            try:
                enrichment = await asyncio.wait_for(
                    _scrape_reviews_and_competitors(
                        business_name=lead.get("business_name", ""),
                        category=category,
                        location=location,
                    ),
                    timeout=12.0,
                )
                lead["google_reviews"] = enrichment.get("google_reviews", [])
                lead["local_competitors"] = enrichment.get("local_competitors", [])
                lead["review_sentiment"] = _analyze_review_sentiment(lead["google_reviews"])
            except Exception as e:
                print(f"[enrichment] Skipped for {lead.get('business_name','?')}: {e}")
                lead["google_reviews"] = lead.get("google_reviews") or []
                lead["local_competitors"] = lead.get("local_competitors") or []
                lead["review_sentiment"] = lead.get("review_sentiment") or _analyze_review_sentiment([])

    return results


def _count_business_event_signals(leads: List[Dict[str, Any]]) -> int:
    try:
        from business_events_enrich import count_lead_signals

        n = 0
        for lead in leads or []:
            if isinstance(lead, dict) and count_lead_signals(lead) > 0:
                n += 1
        return n
    except Exception:
        n = 0
        for lead in leads or []:
            if not isinstance(lead, dict):
                continue
            if (
                lead.get("business_hiring_jobs")
                or lead.get("business_tender_hits")
                or lead.get("business_sector_hits")
                or lead.get("detected_crm_stack")
                or lead.get("business_signals")
            ):
                n += 1
        return n


async def _run_business_events_enrichment(
    formatted: List[Dict[str, Any]],
    location: str,
    *,
    supabase: Any = None,
    user_id: Optional[str] = None,
    publish_cb: Optional[Any] = None,
    external_only: bool = False,
    intent: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Business events enrichment post-audit."""
    enrich_business = os.getenv("ENRICH_BUSINESS_EVENTS", "1").strip().lower() in {"1", "true", "yes"}
    if not enrich_business or not formatted:
        return formatted
    try:
        from business_events_enrich import enrich_results_business_events, resolve_enrichment_cap

        cap = resolve_enrichment_cap(intent, len(formatted))
        await enrich_results_business_events(
            formatted,
            location,
            max_leads=cap,
            supabase=supabase,
            user_id=user_id,
            audit_only=not external_only,
            external_only=external_only,
            on_progress=(lambda snap, _n: publish_cb(snap)) if publish_cb else None,
            intent=intent,
        )
        touched = min(len(formatted), cap)
        signals = _count_business_event_signals(formatted[:cap])
        phase = "external" if external_only else "audit"
        print(
            f"[business_events] post-audit enrich ({phase}): {{ status: 'done', total: {len(formatted)}, "
            f"touched: {touched}, enrich: {signals} }}",
            flush=True,
        )
    except Exception as e:
        print(f"[business_events] post-audit skip: {e}", flush=True)
    return formatted


def _normalize_one_shot_search_id(raw_search_id: Any, once: bool) -> str:
    search_id = str(raw_search_id or "").strip()
    if not search_id:
        return ""
    if not once:
        raise ValueError("--search-id richiede --once")
    try:
        return str(uuid.UUID(search_id))
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError("--search-id deve essere un UUID valido") from exc


def _shadow_execution_is_authorized(intent: Any) -> bool:
    if not isinstance(intent, dict) or str(intent.get("lifecycle_stage") or "") != "v5_shadow":
        return True
    return (
        intent.get("customer_visible") is False
        and intent.get("prepare_only") is False
        and intent.get("execution_authorized") is True
    )


def _shadow_resume_state_from_progress(progress: Any) -> Dict[str, Any]:
    if not isinstance(progress, dict):
        return {}
    resume = progress.get("shadow_resume")
    return dict(resume) if isinstance(resume, dict) else {}


def _load_prior_shadow_qualified_payloads(job: Dict[str, Any], *, supabase: Any = None) -> List[Dict[str, Any]]:
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    resume = _shadow_resume_state_from_progress(progress)
    stored = resume.get("qualified_lead_payloads")
    if isinstance(stored, list) and stored:
        return [dict(item) for item in stored if isinstance(item, dict)]
    search_id = str(job.get("id") or "").strip()
    if supabase is not None and search_id:
        try:
            resp = supabase.table("search_candidates").select("payload").eq("search_id", search_id).execute()
            rows = getattr(resp, "data", None) or []
            payloads = [dict(row["payload"]) for row in rows if isinstance(row, dict) and isinstance(row.get("payload"), dict)]
            if payloads:
                return payloads
        except Exception:
            pass
    return []


def _upgrade_legacy_digital_audit_resume_geography(
    payloads: Sequence[Mapping[str, Any]],
    *,
    search_id: str,
    canonical_plan: Mapping[str, Any],
    resume_state: Mapping[str, Any],
) -> List[Dict[str, Any]]:
    """Hydrate pre-provenance regional DA payloads from the same checkpoint.

    This is deliberately not a geographic resolver.  A legacy payload is
    upgraded only when it is a member of the persisted qualified checkpoint
    and its structured locality equals the persisted controlled partition.
    """
    from source_adapters.digital_audit_partition_policy import controlled_geography_partitions
    from source_adapters.hiring_qualification import employer_key_from_payload

    target = canonical_plan.get("target") if isinstance(canonical_plan.get("target"), Mapping) else {}
    requested = tuple(str(item).strip() for item in target.get("geographies") or () if str(item).strip())
    plan_search_id = str(canonical_plan.get("search_id") or "").strip()
    acquisition = resume_state.get("acquisition") if isinstance(resume_state.get("acquisition"), Mapping) else {}
    partition_location = str(acquisition.get("partition_location") or "").strip()
    resume_cursors = resume_state.get("resume_cursors") if isinstance(resume_state.get("resume_cursors"), Mapping) else {}
    processed_keys = {str(item) for item in resume_state.get("processed_employer_keys") or () if str(item)}
    checkpoint_payloads = resume_state.get("qualified_lead_payloads")
    checkpoint_keys = {
        employer_key_from_payload(item)
        for item in checkpoint_payloads or ()
        if isinstance(item, Mapping) and employer_key_from_payload(item)
    }

    def norm(value: Any) -> str:
        return " ".join(str(value or "").casefold().split())

    partition_norm = norm(partition_location)
    matching_plan_geography = next((
        geography for geography in requested
        if partition_norm in {norm(item) for item in controlled_geography_partitions(geography)}
    ), "")
    checkpoint_provenance_valid = bool(
        str(search_id).strip()
        and plan_search_id == str(search_id).strip()
        and requested
        and matching_plan_geography
        and partition_location
        and int(acquisition.get("partition_count") or 0) > 0
        and acquisition.get("partition_index") is not None
        and resume_cursors.get("legacy_digital_audit_v1")
        and checkpoint_keys
    )

    upgraded: List[Dict[str, Any]] = []
    for item in payloads:
        payload = dict(item)
        if str(payload.get("source_adapter_id") or "") != "legacy_digital_audit_v1":
            upgraded.append(payload)
            continue
        if payload.get("geography_match") is True or payload.get("geography_match_method"):
            upgraded.append(payload)
            continue

        locality = str(
            payload.get("address_locality") or payload.get("municipality")
            or payload.get("citta") or payload.get("city") or payload.get("location") or ""
        ).strip()
        # Exact-locality payloads already have sufficient evidence and must
        # retain the existing lifecycle behavior without compatibility data.
        if norm(locality) in {norm(item) for item in requested}:
            upgraded.append(payload)
            continue

        nested_geography = (
            payload.get("technical_report", {}).get("geography", {})
            if isinstance(payload.get("technical_report"), Mapping)
            and isinstance(payload.get("technical_report", {}).get("geography"), Mapping)
            else {}
        )
        explicit_region = str(
            payload.get("address_region") or payload.get("region")
            or nested_geography.get("provider_region") or ""
        ).strip()
        explicit_country = str(
            payload.get("address_country") or payload.get("country")
            or nested_geography.get("normalized_country") or ""
        ).strip()
        region_contradiction = bool(explicit_region and norm(explicit_region) not in {norm(item) for item in requested})
        country_contradiction = bool(explicit_country and norm(explicit_country) not in {"it", "italia", "italy"})
        if region_contradiction or country_contradiction:
            payload.update({
                "requested_geographies": list(requested),
                "geography_match": False,
                "geography_rejection_code": "GEO_OUT_OF_SCOPE",
            })
            upgraded.append(payload)
            continue

        employer_key = employer_key_from_payload(payload)
        can_restore = bool(
            checkpoint_provenance_valid
            and employer_key
            and employer_key in checkpoint_keys
            and employer_key in processed_keys
            and norm(locality) == partition_norm
        )
        if can_restore:
            payload.update({
                "requested_geographies": list(requested),
                "geography_match": True,
                "matched_geography": matching_plan_geography,
                "geography_match_method": "legacy_resume_partition_provenance",
                "geography_match_evidence": {
                    "search_id": str(search_id),
                    "original_plan_geography": matching_plan_geography,
                    "persisted_partition_or_checkpoint_evidence": {
                        "partition_location": partition_location,
                        "partition_index": acquisition.get("partition_index"),
                        "partition_count": acquisition.get("partition_count"),
                        "processed_employer_key": employer_key,
                        "processed_place_ids_ref": resume_state.get("processed_place_ids_ref"),
                    },
                },
            })
            if payload.get("geography_rejection_code") == "GEO_UNVERIFIED":
                payload.pop("geography_rejection_code", None)
        upgraded.append(payload)
    return upgraded


def _bootstrap_shadow_resume_from_progress(job: Dict[str, Any], *, supabase: Any = None) -> Dict[str, Any]:
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    if progress.get("shadow_resume"):
        return {}
    if progress.get("termination_reason") != "partial_time_limit":
        return {}
    if progress.get("provider_exhausted"):
        return {}
    qualified = int(progress.get("qualified") or 0)
    target = int(progress.get("target") or job.get("max_results") or 0)
    if target and qualified >= target:
        return {}
    resume_cursors: Dict[str, str] = {}
    acquisition: Dict[str, Any] = {}
    for item in progress.get("adapter_telemetry") or []:
        if not isinstance(item, dict):
            continue
        adapter_id = str(item.get("adapter_id") or "").strip()
        cursor = item.get("next_cursor")
        acq = item.get("acquisition") if isinstance(item.get("acquisition"), dict) else {}
        if not cursor:
            start = acq.get("next_start_index")
            batch = acq.get("batch_cap") or acq.get("maps_batch_size")
            raw = acq.get("raw_candidate_budget")
            if start is not None and batch and raw:
                cursor = f"da:v2:{start}:{batch}:{raw}"
        if adapter_id and cursor:
            resume_cursors[adapter_id] = str(cursor)
        if acq:
            acquisition.update(acq)
    if not resume_cursors:
        return {}
    payloads = _load_prior_shadow_qualified_payloads(job, supabase=supabase)
    return {
        "resumable": True,
        "resume_cursors": resume_cursors,
        "prior_cost_eur": float(progress.get("cost_eur") or 0.0),
        "cumulative_orchestrator_qualified": len(payloads) or qualified,
        "qualified_lead_payloads": payloads,
        "processed_domains": [
            str(item.get("sito") or item.get("website") or "").replace("https://", "").replace("http://", "").split("/")[0]
            for item in payloads
        ],
        "acquisition": acquisition,
        "termination_reason": progress.get("termination_reason"),
        "provider_exhausted": False,
        "bootstrapped": True,
    }


def _source_adapter_shadow_is_requested(intent: Any) -> bool:
    return bool(
        isinstance(intent, dict)
        and str(intent.get("lifecycle_stage") or "") == "v5_shadow"
        and intent.get("source_adapter_shadow") is True
    )


def main() -> None:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument(
        "--enqueue",
        action="store_true",
        help="Inserisce job (status=pending) in Supabase senza avviare il worker.",
    )
    parser.add_argument(
        "--reaudit",
        action="store_true",
        help="Lancia il worker di re-audit (aggiorna lead esistenti)",
    )
    parser.add_argument(
        "--reaudit-max",
        type=int,
        default=20,
        help="Numero massimo di lead da ri-auditare (default: 20)",
    )
    parser.add_argument(
        "--user-id",
        type=str,
        default="",
        help="UUID user_id da associare ai job inseriti (necessario per --enqueue).",
    )
    parser.add_argument(
        "--cities",
        type=str,
        default="",
        help="Lista citta' separata da virgola, es: Milano,Roma,Torino",
    )
    parser.add_argument(
        "--categories",
        type=str,
        default="",
        help="Lista categorie separata da virgola, es: dentista,idraulico,ristorante",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=0,
        help="Numero massimo di lead per job (0 = default scraper).",
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="all",
        choices=["all", "user", "backlog"],
        help="Selezione job: all=user+backlog, user=solo user_id non nullo, backlog=solo user_id nullo.",
    )
    parser.add_argument(
        "--cooldown",
        type=int,
        default=20,
        help="Pausa (secondi) tra un job e il successivo.",
    )
    parser.add_argument(
        "--user-recent-minutes",
        type=int,
        default=10,
        help="In --mode user, considera solo job creati negli ultimi N minuti.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Esegue un solo ciclo del worker (un job pending se presente) e poi termina.",
    )
    parser.add_argument(
        "--search-id",
        type=str,
        default="",
        help=(
            "Vincola il one-shot a un singolo UUID search. "
            "Valido solo insieme a --once; non effettua fallback su altri job."
        ),
    )

    args, _unknown = parser.parse_known_args()

    try:
        search_id_filter = _normalize_one_shot_search_id(
            getattr(args, "search_id", ""),
            bool(getattr(args, "once", False)),
        )
    except ValueError as exc:
        parser.error(str(exc))

    if os.getenv("MIRAX_WORKER_DISABLED", "").strip().lower() in {"1", "true", "yes", "on"}:
        print("[worker_supabase] MIRAX_WORKER_DISABLED=1 — worker spento in modo sicuro.", flush=True)
        return

    # Re-audit worker mode (runs independently from the normal polling loop)
    if bool(getattr(args, "reaudit", False)):
        try:
            max_l = int(getattr(args, "reaudit_max", 20) or 20)
        except Exception:
            max_l = 20
        run_reaudit_worker(max_leads=max_l)
        return

    if create_client is None:
        print("ERROR: supabase-py non è installato.")
        print("Installa con: pip install supabase")
        raise SystemExit(2)

    if load_dotenv is None:
        print(
            "[worker_supabase] INFO: python-dotenv non installato. "
            "Se vuoi leggere SUPABASE_SERVICE_ROLE_KEY da .env: pip install python-dotenv"
        )

    supabase_key = _get_supabase_key()
    supabase = create_client(SUPABASE_URL, supabase_key)

    def _create_fresh_supabase_client():
        """Create a new Supabase client for use in background threads."""
        return create_client(SUPABASE_URL, supabase_key)

    def _split_csv(s: str) -> List[str]:
        try:
            parts = [p.strip() for p in (s or "").split(",")]
            return [p for p in parts if p]
        except Exception:
            return []

    if bool(getattr(args, "enqueue", False)):
        cities = _split_csv(getattr(args, "cities", ""))
        categories = _split_csv(getattr(args, "categories", ""))
        user_id = (getattr(args, "user_id", "") or "").strip()
        if not cities or not categories:
            print("[worker_supabase] --enqueue richiede --cities e --categories")
            raise SystemExit(2)
        if not user_id:
            print("[worker_supabase] --enqueue richiede anche --user-id (UUID)")
            raise SystemExit(2)

        now_iso = _utc_now_iso()
        payloads: List[Dict[str, Any]] = []
        for city in cities:
            for cat in categories:
                # NOTE: the user's Supabase schema does NOT have a 'zone' column.
                payloads.append(
                    {
                        "user_id": user_id,
                        "status": "pending",
                        "category": cat,
                        "location": city,
                        "results": None,
                        "created_at": now_iso,
                    }
                )

        print(f"[worker_supabase] Enqueue jobs: {len(payloads)}")
        try:
            resp = supabase.table("searches").insert(payloads).execute()
            data = getattr(resp, "data", None)
            if isinstance(data, list) and data:
                ids = [str((r or {}).get("id")) for r in data if isinstance(r, dict) and (r or {}).get("id")]
                if ids:
                    print("[worker_supabase] Inseriti job id:")
                    for jid in ids[:50]:
                        print(" -", jid)
        except Exception as e:
            print("[worker_supabase] ERROR enqueue:", str(e))
            print(traceback.format_exc())
            raise SystemExit(2)

        print("[worker_supabase] Done (enqueue).")
        return

    # Optional: allow extracting more than the default cap from Google Maps.
    try:
        mr = int(getattr(args, "max_results", 0) or 0)
        if mr > 0:
            os.environ["DEMO_MAX_RESULTS"] = str(mr)
    except Exception:
        pass

    print("[worker_supabase] Avviato")
    _project_ref = SUPABASE_URL.split("//")[-1].split(".")[0] if SUPABASE_URL else "unknown"
    print(f"[worker_supabase] Supabase project: {_project_ref}")
    print("[worker_supabase] Polling tabella: searches (status=pending) ogni 4 secondi")

    # A real lease prevents a legitimate long-running search from being reclaimed
    # by another worker merely because its creation timestamp is old.
    _worker_id = str(os.getenv("MIRAX_WORKER_ID") or f"{socket.gethostname()}:{os.getpid()}").strip()
    try:
        _lease_minutes = min(120, max(10, int(os.getenv("MIRAX_WORKER_LEASE_MINUTES", "30") or "30")))
    except Exception:
        _lease_minutes = 30

    def _lease_timestamp() -> str:
        return (datetime.now(timezone.utc) + timedelta(minutes=_lease_minutes)).isoformat()

    try:
        supabase.table("searches").select("worker_id,heartbeat_at,lease_expires_at,attempt_count,progress").limit(1).execute()
        _lease_supported = True
        print(f"[worker_supabase] Job lease attiva: worker={_worker_id} ttl={_lease_minutes}m", flush=True)
    except Exception as e:
        _lease_supported = False
        print(f"[worker_supabase] Job lease non migrata; fallback recovery 12h: {e}", flush=True)

    # Recovery: reset stale processing jobs to pending so they are not lost after a crash/restart.
    def _recover_stale_processing() -> None:
        try:
            now = datetime.now(timezone.utc)
            fields = "id,created_at,heartbeat_at,lease_expires_at" if _lease_supported else "id,created_at"
            processing = (
                supabase.table("searches")
                .select(fields)
                .eq("status", "processing")
                .order("created_at")
                .limit(500)
                .execute()
                .data
                or []
            )
            stale = []
            for row in processing:
                lease_row = row if _lease_supported else {"created_at": row.get("created_at")}
                if is_processing_job_stale(lease_row, now=now):
                    stale.append(row)
            if stale:
                print(f"[worker_supabase] Recovery: resetting {len(stale)} stale processing jobs to pending", flush=True)
                for row in stale:
                    try:
                        payload: Dict[str, Any] = {"status": "pending"}
                        if _lease_supported:
                            payload.update({"worker_id": None, "heartbeat_at": None, "lease_expires_at": None})
                        supabase.table("searches").update(payload).eq("id", row["id"]).eq("status", "processing").execute()
                    except Exception:
                        pass
        except Exception as e:
            print(f"[worker_supabase] Recovery skipped: {e}", flush=True)

    _recover_stale_processing()

    mode = str(getattr(args, "mode", "all") or "all").strip().lower()
    if mode not in {"all", "user", "backlog"}:
        mode = "all"
    try:
        cooldown_s = int(getattr(args, "cooldown", 20) or 20)
    except Exception:
        cooldown_s = 20
    try:
        _ur = getattr(args, "user_recent_minutes", None)
        user_recent_minutes = 10 if _ur is None else int(_ur)
    except Exception:
        user_recent_minutes = 10

    if user_recent_minutes < 0:
        user_recent_minutes = 0

    loop_count = 0
    while True:
        try:
            loop_count += 1
            if loop_count % 30 == 0:
                _recover_stale_processing()
            # Desync workers to reduce stampedes / race windows.
            try:
                time.sleep(random.uniform(1.0, 5.0))
            except Exception:
                pass

            rows = []
            expected_pending_status = "pending"
            if search_id_filter:
                # Recover a stale lease on the targeted search before claiming it.
                try:
                    targeted = (
                        supabase.table("searches")
                        .select("id,status,created_at,heartbeat_at,lease_expires_at")
                        .eq("id", search_id_filter)
                        .limit(1)
                        .execute()
                        .data
                        or []
                    )
                    if targeted and targeted[0].get("status") == "processing" and is_processing_job_stale(targeted[0]):
                        payload: Dict[str, Any] = {"status": "pending"}
                        if _lease_supported:
                            payload.update({"worker_id": None, "heartbeat_at": None, "lease_expires_at": None})
                        supabase.table("searches").update(payload).eq("id", search_id_filter).eq("status", "processing").execute()
                        print(f"[worker_supabase] Recovery: reset stale processing search_id={search_id_filter} -> pending", flush=True)
                except Exception as recovery_error:
                    print(f"[worker_supabase] Targeted recovery skipped: {recovery_error}", flush=True)
                resp = (
                    supabase.table("searches")
                    .select("*")
                    .eq("id", search_id_filter)
                    .eq("status", "pending")
                    .limit(1)
                    .execute()
                )
                rows = getattr(resp, "data", None) or []
                if not rows:
                    resume_resp = (
                        supabase.table("searches")
                        .select("*")
                        .eq("id", search_id_filter)
                        .limit(1)
                        .execute()
                    )
                    resume_rows = getattr(resume_resp, "data", None) or []
                    if resume_rows:
                        resume_job = resume_rows[0]
                        resume_progress = resume_job.get("progress") if isinstance(resume_job.get("progress"), dict) else {}
                        resume_state = resume_progress.get("shadow_resume") if isinstance(resume_progress, dict) else {}
                        if (
                            resume_job.get("status") == "completed"
                            and isinstance(resume_state, dict)
                            and resume_state.get("resumable")
                        ):
                            supabase.table("searches").update({
                                "status": "pending",
                                "updated_at": _utc_now_iso(),
                            }).eq("id", search_id_filter).eq("status", "completed").execute()
                        elif resume_job.get("status") == "completed":
                            bootstrapped = _bootstrap_shadow_resume_from_progress(resume_job, supabase=supabase)
                            if bootstrapped.get("resumable"):
                                merged_progress = dict(resume_progress)
                                merged_progress["shadow_resume"] = bootstrapped
                                supabase.table("searches").update({
                                    "status": "pending",
                                    "progress": merged_progress,
                                    "updated_at": _utc_now_iso(),
                                }).eq("id", search_id_filter).eq("status", "completed").execute()
                        if resume_job.get("status") == "completed":
                            resp = (
                                supabase.table("searches")
                                .select("*")
                                .eq("id", search_id_filter)
                                .eq("status", "pending")
                                .limit(1)
                                .execute()
                            )
                            rows = getattr(resp, "data", None) or []
            elif mode in {"all", "user"}:
                # Priority 1: realtime user jobs (most recent first)
                expected_pending_status = "pending"
                q = (
                    supabase.table("searches")
                    .select("*")
                    .eq("status", "pending")
                )
                if mode == "user" and user_recent_minutes > 0:
                    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=user_recent_minutes)).isoformat()
                    q = q.gte("created_at", cutoff)
                resp = (
                    q.order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = getattr(resp, "data", None) or []
                if not rows and mode == "user":
                    print(f"[worker_supabase] Nessun job pending (mode={mode}, recent_min={user_recent_minutes})", flush=True)

            # Backlog selection
            if (not rows) and (not search_id_filter) and mode in {"all", "backlog"}:
                resp = (
                    supabase.table("searches")
                    .select("*")
                    .eq("status", "pending")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = getattr(resp, "data", None) or []
                expected_pending_status = "pending"

            if not rows:
                if bool(getattr(args, "once", False)):
                    target = f" search_id={search_id_filter}" if search_id_filter else ""
                    print(f"[worker_supabase] Nessun job pending{target}; one-shot terminato.", flush=True)
                    return
                time.sleep(4)
                continue

            job = rows[0]

            job_id = job.get("id")
            category = (job.get("category") or "").strip()
            location = (job.get("location") or "").strip()
            zone = (job.get("zone") or None)
            intent = job.get("intent") or None
            if isinstance(intent, str):
                try:
                    intent = json.loads(intent)
                except Exception:
                    intent = None
            # Canonical-plan boundary: legacy jobs remain compatible, but once a
            # canonical contract is present the worker must validate it before
            # claiming the job or spending on any external operation.
            had_canonical_plan = bool(
                isinstance(intent, dict)
                and (
                    intent.get("canonical_plan") is not None
                    or (
                        isinstance(intent.get("uqe_plan"), dict)
                        and intent["uqe_plan"].get("canonical_plan") is not None
                    )
                )
            )
            try:
                intent = _validate_canonical_plan_in_intent(intent)
            except Exception as contract_error:
                if had_canonical_plan:
                    print(
                        f"[worker_supabase] Reject invalid canonical plan job={job_id}: "
                        f"{contract_error.__class__.__name__}",
                        flush=True,
                    )
                    supabase.table("searches").update(
                        {
                            "status": "error",
                            "results": [],
                            "progress": {
                                "stop_reason": "INVALID_COMMERCIAL_SEARCH_PLAN",
                                "stage": "contract_validation",
                                "updated_at": _utc_now_iso(),
                            },
                            "updated_at": _utc_now_iso(),
                        }
                    ).eq("id", job_id).eq("status", expected_pending_status).execute()
                    time.sleep(1)
                    continue
                raise
            if not _shadow_execution_is_authorized(intent):
                print(
                    f"[worker_supabase] Reject unauthorized shadow execution job={job_id}",
                    flush=True,
                )
                supabase.table("searches").update(
                    {
                        "status": "planning",
                        "results": [],
                        "progress": {
                            "stop_reason": "SHADOW_EXECUTION_NOT_AUTHORIZED",
                            "stage": "execution_authorization",
                            "updated_at": _utc_now_iso(),
                        },
                        "updated_at": _utc_now_iso(),
                    }
                ).eq("id", job_id).eq("status", expected_pending_status).execute()
                if bool(getattr(args, "once", False)):
                    return
                time.sleep(1)
                continue
            intent_signals = []
            if isinstance(intent, dict):
                intent_signals = intent.get("signals") or []
                if intent_signals:
                    signal_types = [s.get("type") for s in intent_signals if isinstance(s, dict)]
                    print(f"[worker_supabase] Job intent signals: {signal_types}", flush=True)

            category, location, intent, canonicalized_marketing_job = _canonicalize_marketing_investment_job(
                category,
                location,
                intent if isinstance(intent, dict) else None,
                job if isinstance(job, dict) else {},
            )
            category, location, intent, canonicalized_seller_job = _canonicalize_seller_leadgen_job(
                category,
                location,
                intent if isinstance(intent, dict) else None,
                job if isinstance(job, dict) else {},
            )
            if canonicalized_seller_job or canonicalized_marketing_job:
                print(
                    f"[worker_supabase] Canonicalized signal job {job_id}: {category} @ {location}",
                    flush=True,
                )
                try:
                    supabase.table("searches").update(
                        {"category": category, "location": location, "intent": intent}
                    ).eq("id", job_id).eq("status", expected_pending_status).execute()
                except Exception as canon_error:
                    print(f"[worker_supabase] canonicalize update skipped: {canon_error}", flush=True)

            job_user_id = str(job.get("user_id") or "").strip() or None

            if not job_id:
                print("[worker_supabase] WARNING: riga pending senza id. La salto.")
                time.sleep(4)
                continue

            if not category or not location:
                print(f"[worker_supabase] WARNING: job {job_id} mancante di category/location. Setto error.")
                supabase.table("searches").update(
                    {
                        "status": "error",
                        "results": {
                            "error": "Missing category or location",
                            "ts": _utc_now_iso(),
                        },
                    }
                ).eq("id", job_id).execute()
                time.sleep(1)
                continue

            print(f"[worker_supabase] Trovata richiesta pending id={job_id} :: {category} @ {location}")

            # Per-job scrape depth: zone may hold the requested lead cap from the frontend.
            job_max = int(os.getenv("DEMO_MAX_RESULTS", "50") or "50")
            try:
                default_max = int(os.getenv("DEMO_MAX_RESULTS", "50") or "50")
                job_max = default_max
                z = job.get("zone")
                if isinstance(z, str) and z.strip().isdigit():
                    job_max = min(10000, max(5, int(z.strip())))
                elif isinstance(z, dict) and z.get("max_results"):
                    job_max = min(10000, max(5, int(z.get("max_results") or default_max)))
                elif isinstance(intent, dict):
                    for target_key in ("max_leads", "requested_leads", "lead_target", "target"):
                        raw_target = intent.get(target_key)
                        if raw_target is None:
                            continue
                        try:
                            job_max = min(10000, max(5, int(str(raw_target).strip())))
                            break
                        except Exception:
                            continue
                if _source_adapter_shadow_is_requested(intent):
                    os.environ.pop("DEMO_MAX_RESULTS", None)
                    print(
                        f"[worker_supabase] Shadow job qualified_target={job_max} "
                        "(DEMO_MAX_RESULTS not applied to Maps acquisition)",
                        flush=True,
                    )
                else:
                    os.environ["DEMO_MAX_RESULTS"] = str(job_max)
                    print(f"[worker_supabase] Job max_results={job_max}", flush=True)
            except Exception:
                if not _source_adapter_shadow_is_requested(intent):
                    os.environ["DEMO_MAX_RESULTS"] = "50"

            # Atomic claim: only one worker should be able to update pending -> processing.
            claim_payload: Dict[str, Any] = {"status": "processing"}
            if _lease_supported:
                claim_payload = build_claim_payload(
                    worker_id=_worker_id,
                    target=job_max,
                    attempt_count=int(job.get("attempt_count") or 0),
                    lease_minutes=_lease_minutes,
                )
            claim = (
                supabase.table("searches")
                .update(claim_payload)
                .eq("id", job_id)
                .eq("status", expected_pending_status)
                .execute()
            )

            claimed_rows = getattr(claim, "data", None) or []
            if not claimed_rows:
                print("[worker_supabase] Job già preso da un collega, salto...")
                time.sleep(1)
                continue

            print(f"[worker_supabase] Job {job_id} -> processing. Avvio scraper...")

            # Independent heartbeat covers long source calls that do not emit a
            # result batch before the lease deadline.
            _heartbeat_stop = threading.Event()
            if _lease_supported:
                def _heartbeat_loop() -> None:
                    interval = min(60, max(10, (_lease_minutes * 60) // 4))
                    try:
                        heartbeat_sb = _create_fresh_supabase_client()
                    except Exception as heartbeat_error:
                        print(f"[worker_supabase] heartbeat client unavailable: {heartbeat_error}", flush=True)
                        return
                    while not _heartbeat_stop.wait(interval):
                        try:
                            heartbeat_sb.table("searches").update(
                                {"heartbeat_at": _utc_now_iso(), "lease_expires_at": _lease_timestamp()}
                            ).eq("id", job_id).eq("status", "processing").eq("worker_id", _worker_id).execute()
                        except Exception as heartbeat_error:
                            print(f"[worker_supabase] heartbeat renewal skipped: {heartbeat_error}", flush=True)

                threading.Thread(target=_heartbeat_loop, daemon=True, name=f"mirax-heartbeat-{job_id}").start()

            # Real-time result callback: push each result to DB as it's found
            _rt_results = []
            try:
                existing_results = job.get("results") if isinstance(job, dict) else None
                if isinstance(existing_results, str):
                    try:
                        existing_results = json.loads(existing_results)
                    except Exception:
                        existing_results = []
                if isinstance(existing_results, list):
                    _rt_results = _filter_non_domestic_refrigeration_results(category, _merge_formatted_results([], existing_results))
                    if _rt_results:
                        print(f"[worker_supabase] Preserved existing results before re-scrape: {len(_rt_results)}", flush=True)
            except Exception as e:
                print(f"[worker_supabase] Preserve existing results skipped: {e}", flush=True)
                _rt_results = []
            _rt_lock = __import__('threading').Lock()

            def _load_current_job_results_safe():
                try:
                    row = supabase.table("searches").select("results").eq("id", job_id).single().execute().data or {}
                    current = row.get("results") or []
                    if isinstance(current, str):
                        try:
                            current = json.loads(current)
                        except Exception:
                            current = []
                    return current if isinstance(current, list) else []
                except Exception:
                    return []

            def _publish_job_results_safe(new_results, status=None):
                canonical_lifecycle_plan = _canonical_plan_from_intent(intent)
                current: List[Dict[str, Any]] = []
                try:
                    current = _load_current_job_results_safe()
                    merged = _merge_formatted_results(current, new_results if isinstance(new_results, list) else [])
                    filtered = _filter_non_domestic_refrigeration_results(category, merged)
                    requires_confirmed_signals = bool(_required_signals_from_intent(intent if isinstance(intent, dict) else None))
                    if requires_confirmed_signals:
                        filtered = _filter_results_by_confirmed_required_signals(
                            filtered,
                            intent if isinstance(intent, dict) else None,
                            stage="publish",
                        )
                    if current and not filtered and not requires_confirmed_signals:
                        print(f"[worker_supabase] Safe publish preserved current results because filter returned empty: current={len(current)}", flush=True)
                        filtered = current
                    uqe_ctx = intent.get("uqe_plan") if isinstance(intent, dict) and isinstance(intent.get("uqe_plan"), dict) else {}
                    prioritize_hot = _is_agentic_only_job(intent) or bool(uqe_ctx.get("commercial_hypothesis"))
                    candidate_pool = list(filtered)
                    merged = _cap_search_results(candidate_pool, job_max, prioritize_hot=prioritize_hot)
                    if canonical_lifecycle_plan is not None:
                        from commercial_lifecycle import persist_and_publish_candidates

                        lifecycle_shadow_mode = bool(
                            isinstance(intent, dict)
                            and intent.get("customer_visible") is False
                            and str(intent.get("lifecycle_stage") or "") == "v5_shadow"
                        )

                        lifecycle_published = persist_and_publish_candidates(
                            supabase,
                            search_id=str(job_id),
                            user_id=str(job.get("user_id") or "").strip() or None,
                            leads=candidate_pool if lifecycle_shadow_mode else merged,
                            canonical_plan=canonical_lifecycle_plan,
                            shadow_mode=lifecycle_shadow_mode,
                        )
                        # Preserve previously published rows, never intermediate candidates.
                        merged = _cap_search_results(
                            _merge_formatted_results(current, lifecycle_published),
                            job_max,
                            prioritize_hot=prioritize_hot,
                        )
                    with _rt_lock:
                        _rt_results.clear()
                        _rt_results.extend(merged)
                    payload = {"results": merged}
                    if status:
                        payload["status"] = status
                    if _lease_supported:
                        now_iso = _utc_now_iso()
                        terminal = status in {"completed", "error", "cancelled"}
                        requeued = status == "pending"
                        runtime_stats = intent.get("agentic_stats") if isinstance(intent, dict) else None
                        runtime_summary = {}
                        if isinstance(runtime_stats, dict):
                            extraction_stats = runtime_stats.get("extraction") or {}
                            runtime_summary = {
                                "pages_scraped": runtime_stats.get("pages_scraped"),
                                "page_budget": runtime_stats.get("page_budget"),
                                "rounds": runtime_stats.get("rounds"),
                                "stop_reason": runtime_stats.get("stop_reason"),
                                "unique_urls": runtime_stats.get("unique_urls"),
                                "llm_requests": int(extraction_stats.get("openai_requests") or 0)
                                + int(extraction_stats.get("anthropic_requests") or 0),
                                "cache_hits": extraction_stats.get("cache_hits"),
                                "estimated_llm_cost_usd": extraction_stats.get("estimated_llm_cost_usd"),
                            }
                            _sync_cost_ledger_safe(
                                supabase,
                                job_id,
                                runtime_stats.get("cost_governor"),
                            )
                        payload.update(
                            {
                                "worker_id": None if terminal or requeued else _worker_id,
                                "heartbeat_at": None if terminal or requeued else now_iso,
                                "lease_expires_at": None if terminal or requeued else _lease_timestamp(),
                                "progress": {
                                    "phase": status or "running",
                                    "found": len(merged),
                                    "target": job_max,
                                    "updated_at": now_iso,
                                    **runtime_summary,
                                },
                            }
                        )
                    _job_uid = None
                    try:
                        _job_uid = str(job.get("user_id") or "").strip() or None
                    except Exception:
                        _job_uid = None
                    supabase.table("searches").update(payload).eq("id", job_id).execute()
                    _sync_search_leads_safe(supabase, job_id, _job_uid, merged)
                    if _should_sync_graph_for_publish_status(status):
                        _sync_neo4j_leads_safe(merged, job_id)
                    return merged
                except Exception as e:
                    print(f"[worker_supabase] Safe publish skipped: {e}", flush=True)
                    if canonical_lifecycle_plan is not None:
                        return current
                    return new_results if isinstance(new_results, list) else []

            def _publish_progressive_organic():
                def _site_key(item):
                    return str(item.get("sito") or item.get("website") or "").lower().strip().replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/")

                def _merge_replace(current, enriched):
                    key = _site_key(enriched)
                    out = []
                    replaced = False
                    for row in current or []:
                        if key and _site_key(row) == key:
                            out.append(enriched)
                            replaced = True
                        else:
                            out.append(row)
                    if not replaced:
                        out.append(enriched)
                    return out

                def _has_real_contact(item):
                    phone = str(item.get("telefono") or item.get("phone") or "").strip()
                    email = str(item.get("email") or "").strip()
                    bad = {"", "N/D", "N/A", "N.D.", "None", "none", "null"}
                    return (phone not in bad and len(re.sub(r"\D+", "", phone)) >= 8) or _is_real_business_email(email)

                def _enrich_organic_lead(lead):
                    site = str(lead.get("sito") or lead.get("website") or "").strip()
                    if not site:
                        return lead
                    enriched = dict(lead)
                    try:
                        audited = asyncio.run(asyncio.wait_for(process_single_url(site), timeout=55.0))
                    except Exception as e:
                        tr = dict(enriched.get("technical_report") or {})
                        tr["source"] = tr.get("source") or "organic_website_discovery"
                        tr["organic_audited"] = True
                        tr["organic_audit_error"] = str(e)[:200]
                        enriched["technical_report"] = tr
                        return enriched

                    if isinstance(audited, dict):
                        if audited.get("telefono"):
                            enriched["telefono"] = audited.get("telefono")
                        clean_email = _clean_business_email(audited.get("email"))
                        if clean_email:
                            enriched["email"] = clean_email
                        if audited.get("nome") and not str(enriched.get("azienda") or "").strip():
                            enriched["azienda"] = audited.get("nome")
                        if audited.get("citta") or audited.get("indirizzo"):
                            try:
                                from entity_matcher import resolve_lead_city
                                enriched["citta"] = resolve_lead_city(
                                    str(audited.get("citta") or ""),
                                    str(audited.get("indirizzo") or enriched.get("indirizzo") or ""),
                                    str(enriched.get("citta") or ""),
                                )
                            except ImportError:
                                pass
                        enriched["meta_pixel"] = bool(audited.get("meta_pixel"))
                        enriched["google_tag_manager"] = bool(audited.get("google_tag_manager"))
                        seo_errors = audited.get("seo_errors") if isinstance(audited.get("seo_errors"), list) else []
                        enriched["html_errors"] = len(seo_errors)

                        tr = dict(enriched.get("technical_report") or {})
                        tr["source"] = "organic_website_discovery"
                        tr["organic_audited"] = True
                        tr["contact_found"] = _has_real_contact(enriched)
                        tr["seo_errors"] = seo_errors
                        tr["load_speed_seconds"] = audited.get("load_speed_seconds")
                        tr["has_google_ads"] = bool(audited.get("has_google_ads"))
                        enriched["technical_report"] = tr

                        audit = audited.get("audit") if isinstance(audited.get("audit"), dict) else {}
                        enriched["audit"] = audit

                        stack = []
                        old_stack = enriched.get("tech_stack")
                        if isinstance(old_stack, list):
                            stack.extend([str(x) for x in old_stack if str(x).strip() and str(x).lower() not in {"contatto da verificare"}])
                        elif old_stack:
                            stack.append(str(old_stack))
                        ts = str(audited.get("tech_stack") or "").strip()
                        if ts:
                            stack.append(ts.upper() if ts.lower() in {"wordpress", "wix", "shopify"} else ts)
                        if audit.get("has_ssl") or str(site).lower().startswith("https://"):
                            stack.append("SSL")
                        stack.append("Meta Pixel" if enriched.get("meta_pixel") else "MISSING FB PIXEL")
                        stack.append("GTM" if enriched.get("google_tag_manager") else "MISSING GTM")
                        stack.append("GOOGLE ADS" if tr.get("has_google_ads") else "MISSING GOOGLE ADS")
                        if seo_errors:
                            stack.append("ERRORI SEO")
                        try:
                            if audited.get("load_speed_seconds") is not None and float(audited.get("load_speed_seconds")) > 4.0:
                                stack.append("SITO LENTO")
                        except Exception:
                            pass
                        enriched["tech_stack"] = list(dict.fromkeys([x for x in stack if str(x).strip()])) or ["Verifica in corso"]
                    return enriched

                try:
                    organic_raw = _discover_organic_website_leads(category=category, location=location)
                    organic_formatted = _format_results(organic_raw)
                    if not organic_formatted:
                        print("[worker_supabase] Progressive organic discovery: +0 lead", flush=True)
                        return
                    print(f"[worker_supabase] Progressive organic discovery candidates: {len(organic_formatted)}; auditing before publish", flush=True)
                    max_audit = _organic_env_int("ORGANIC_AUDIT_MAX_SITES", len(organic_formatted), 0, 24)
                    published = 0
                    discarded_no_contact = 0
                    for lead in organic_formatted[:max_audit]:
                        enriched = _enrich_organic_lead(lead)
                        if not _has_real_contact(enriched):
                            discarded_no_contact += 1
                            print(f"[worker_supabase] Progressive organic audit discarded no-contact: {enriched.get('azienda') or enriched.get('sito')}", flush=True)
                            continue
                        with _rt_lock:
                            updated = _merge_replace(list(_rt_results), enriched)
                            updated = _filter_non_domestic_refrigeration_results(category, updated)
                            _rt_results.clear()
                            _rt_results.extend(updated)
                            snapshot = list(_rt_results)
                        snapshot = _publish_job_results_safe(snapshot)
                        published += 1
                        print(f"[worker_supabase] Progressive organic audit published: {enriched.get('azienda') or enriched.get('sito')} contact=True total={len(snapshot)}", flush=True)
                    print(f"[worker_supabase] Progressive organic audit summary: candidates={len(organic_formatted)} published={published} discarded_no_contact={discarded_no_contact}", flush=True)
                except Exception as e:
                    print(f"[worker_supabase] Progressive organic discovery skipped: {e}", flush=True)

            _agentic_only = _is_agentic_only_job(intent)

            # The v5 source-adapter path is an isolated evaluation lane. It is
            # default-off, never falls back to legacy acquisition and never
            # invokes graph/customer publication. Qualified shadow payloads may
            # be returned in the owning staging search row for live UI review.
            if _source_adapter_shadow_is_requested(intent):
                from commercial_lifecycle import canonical_domain, persist_and_publish_candidates
                from source_adapters.shadow_runtime import (
                    build_shadow_resume_state,
                    candidate_to_lifecycle_shadow_payload,
                    execute_source_adapter_shadow,
                    merge_shadow_qualified_payloads,
                    revalidate_hiring_payload_geographies,
                    serialize_shadow_qualified_leads,
                    source_adapter_shadow_decision,
                )
                from source_adapters.hiring_qualification import collect_processed_employer_keys, count_unique_employer_keys, employer_key_from_payload

                shadow_decision = source_adapter_shadow_decision(intent)
                prior_shadow_resume = _shadow_resume_state_from_progress(job.get("progress"))
                loaded_prior_payloads = _load_prior_shadow_qualified_payloads(job, supabase=supabase)
                canonical_shadow_plan = _canonical_plan_from_intent(intent)
                if canonical_shadow_plan is None:
                    raise RuntimeError("CANONICAL_PLAN_MISSING_BEFORE_GEOGRAPHY_REVALIDATION")
                loaded_prior_payloads = _upgrade_legacy_digital_audit_resume_geography(
                    loaded_prior_payloads,
                    search_id=str(job_id),
                    canonical_plan=canonical_shadow_plan,
                    resume_state=prior_shadow_resume,
                )
                target_geographies = tuple(
                    str(item) for item in canonical_shadow_plan.get("target", {}).get("geographies") or ()
                )
                prior_qualified_payloads, geography_rejected_payloads = revalidate_hiring_payload_geographies(
                    loaded_prior_payloads,
                    target_geographies,
                )
                from source_adapters.digital_audit import is_valid_digital_audit_official_domain
                invalid_digital_domain_payloads = [
                    payload for payload in prior_qualified_payloads
                    if str(payload.get("source_adapter_id") or "") == "legacy_digital_audit_v1"
                    and not is_valid_digital_audit_official_domain(
                        payload.get("employer_official_domain") or payload.get("sito") or payload.get("website")
                    )
                ]
                invalid_digital_keys = {
                    employer_key_from_payload(payload) for payload in invalid_digital_domain_payloads
                    if employer_key_from_payload(payload)
                }
                if invalid_digital_keys:
                    prior_qualified_payloads = [
                        payload for payload in prior_qualified_payloads
                        if employer_key_from_payload(payload) not in invalid_digital_keys
                    ]
                    for rejected_payload in invalid_digital_domain_payloads:
                        rejected_domain = canonical_domain(
                            rejected_payload.get("sito") or rejected_payload.get("website")
                        )
                        if rejected_domain:
                            supabase.table("search_candidates").update({
                                "stage": "rejected",
                                "rejection_code": "OFFICIAL_DOMAIN_NOT_COMPANY_OWNED",
                                "payload": {
                                    **rejected_payload,
                                    "rejection_code": "OFFICIAL_DOMAIN_NOT_COMPANY_OWNED",
                                },
                                "updated_at": _utc_now_iso(),
                            }).eq("search_id", job_id).eq("canonical_domain", rejected_domain).execute()
                prior_geography_rejections = [
                    dict(item)
                    for item in prior_shadow_resume.get("geography_revalidation_rejections") or ()
                    if isinstance(item, dict)
                ]
                geography_rejections_by_employer = {
                    employer_key_from_payload(item): item
                    for item in (*prior_geography_rejections, *geography_rejected_payloads)
                    if employer_key_from_payload(item)
                }
                geography_rejected_payloads = list(geography_rejections_by_employer.values())
                for rejected_payload in geography_rejected_payloads:
                    rejected_domain = canonical_domain(rejected_payload.get("sito") or rejected_payload.get("website"))
                    if not rejected_domain:
                        continue
                    supabase.table("search_candidates").update({
                        "stage": "rejected",
                        "target_fit_verified": False,
                        "rejection_code": "GEO_OUT_OF_SCOPE",
                        "rejection_detail": {
                            "failed_gates": ["geography_matches_target"],
                            "reason_codes": ["GEO_OUT_OF_SCOPE"],
                            "geography": {
                                key: rejected_payload.get(key)
                                for key in (
                                    "requested_geographies", "normalized_country", "matched_geography",
                                    "geography_match_method", "geography_match_evidence",
                                )
                            },
                        },
                        "payload": rejected_payload,
                        "updated_at": _utc_now_iso(),
                    }).eq("search_id", job_id).eq("canonical_domain", rejected_domain).execute()
                processed_employer_keys = collect_processed_employer_keys(
                    (),
                    prior_qualified_payloads,
                )
                unique_prior_count = len(processed_employer_keys)
                remaining_qualified_target = max(0, int(job_max) - unique_prior_count)
                prior_shadow_resume = {
                    **prior_shadow_resume,
                    "processed_employer_keys": list(processed_employer_keys),
                    "processed_domains": [
                        domain for payload in prior_qualified_payloads
                        if (domain := canonical_domain(payload.get("sito") or payload.get("website")))
                    ],
                    "total_unique_employer_target": int(job_max),
                    "qualified_lead_payloads": prior_qualified_payloads,
                    "geography_revalidation_rejections": geography_rejected_payloads,
                }
                if not shadow_decision.enabled:
                    _heartbeat_stop.set()
                    supabase.table("searches").update({
                        "status": "error",
                        "results": prior_qualified_payloads,
                        "worker_id": None,
                        "heartbeat_at": None,
                        "lease_expires_at": None,
                        "progress": {
                            "stage": "source_adapter_shadow_blocked",
                            "stop_reason": shadow_decision.reason,
                            "target": job_max,
                            "found": len(prior_qualified_payloads),
                            "unique_lifecycle_accepted_count": unique_prior_count,
                            "processed_employer_keys": list(processed_employer_keys),
                            "shadow_resume": prior_shadow_resume,
                            "updated_at": _utc_now_iso(),
                        },
                        "updated_at": _utc_now_iso(),
                    }).eq("id", job_id).eq("status", "processing").execute()
                    if bool(getattr(args, "once", False)):
                        return
                    continue

                def _on_source_adapter_progress(snapshot: Any) -> None:
                    current_payloads = [
                        candidate_to_lifecycle_shadow_payload(
                            lead.candidate,
                            opportunity_value_score=lead.opportunity_value_score,
                        )
                        for lead in getattr(snapshot, "qualified_leads", ())
                    ]
                    checkpoint_payloads = merge_shadow_qualified_payloads(
                        prior_qualified_payloads,
                        current_payloads,
                    )
                    checkpoint_keys = collect_processed_employer_keys((), checkpoint_payloads)
                    runtime_state = getattr(snapshot, "runtime_state", {})
                    runtime_state = runtime_state if isinstance(runtime_state, dict) else {}
                    resume_cursors = dict(prior_shadow_resume.get("resume_cursors") or {})
                    acquisition = dict(prior_shadow_resume.get("acquisition") or {})
                    all_authoritatively_exhausted = bool(runtime_state)
                    for adapter_id, adapter_state in runtime_state.items():
                        if not isinstance(adapter_state, dict):
                            continue
                        next_cursor = adapter_state.get("next_cursor")
                        if next_cursor:
                            resume_cursors[str(adapter_id)] = str(next_cursor)
                        elif adapter_state.get("exhausted"):
                            resume_cursors.pop(str(adapter_id), None)
                        adapter_acquisition = adapter_state.get("acquisition")
                        if isinstance(adapter_acquisition, dict):
                            acquisition.update(adapter_acquisition)
                        all_authoritatively_exhausted = (
                            all_authoritatively_exhausted
                            and bool(adapter_state.get("exhausted"))
                            and bool(adapter_state.get("exhaustion_authoritative"))
                        )
                    processed_identity_hashes = list(dict.fromkeys(
                        list(prior_shadow_resume.get("processed_identity_hashes") or ())
                        + list(acquisition.get("processed_identity_hashes") or ())
                    ))
                    checkpoint_resume = {
                        **prior_shadow_resume,
                        "resumable": bool(
                            len(checkpoint_keys) < int(job_max)
                            and not all_authoritatively_exhausted
                            and resume_cursors
                        ),
                        "resume_cursors": resume_cursors,
                        "prior_cost_eur": round(
                            float(prior_shadow_resume.get("prior_cost_eur") or 0.0)
                            + float(getattr(snapshot, "cost_eur", 0.0) or 0.0),
                            6,
                        ),
                        "cumulative_orchestrator_qualified": len(checkpoint_keys),
                        "unique_lifecycle_accepted_count": len(checkpoint_keys),
                        "processed_employer_keys": list(checkpoint_keys),
                        "qualified_lead_payloads": checkpoint_payloads,
                        "processed_identity_hashes": processed_identity_hashes,
                        "processed_place_ids_ref": acquisition.get("processed_place_ids_ref"),
                        "cumulative_raw_unique": int(acquisition.get("cumulative_raw_unique") or 0),
                        "cumulative_audited": int(acquisition.get("cumulative_audited") or 0),
                        "cumulative_qualified_unique": len(checkpoint_keys),
                        "acquisition": acquisition,
                        "provider_exhausted": all_authoritatively_exhausted,
                        "provider_exhausted_authoritative": all_authoritatively_exhausted,
                    }
                    progress_payload = {
                        "stage": "source_adapter_shadow",
                        "target": snapshot.requested_count,
                        "found": len(checkpoint_keys),
                        "discovered": snapshot.discovered_count,
                        "raw": snapshot.discovered_count,
                        "unique_entities": snapshot.unique_entity_count,
                        "resolved": snapshot.resolved_count,
                        "audited": snapshot.audited_count,
                        "evidence_verified": snapshot.evidence_verified_count,
                        "qualified": snapshot.qualified_count,
                        "rejected": snapshot.rejected_count,
                        "published": 0,
                        "resume_cursor": next(iter(resume_cursors.values()), None),
                        "shadow_resume": checkpoint_resume,
                        "updated_at": _utc_now_iso(),
                    }
                    supabase.table("searches").update({
                        "results": checkpoint_payloads,
                        "progress": progress_payload,
                        "heartbeat_at": _utc_now_iso() if _lease_supported else None,
                        "lease_expires_at": _lease_timestamp() if _lease_supported else None,
                    }).eq("id", job_id).eq("status", "processing").execute()

                try:
                    if remaining_qualified_target <= 0:
                        raise RuntimeError("UNIQUE_EMPLOYER_TARGET_ALREADY_REACHED")
                    shadow_result = _run_coro_blocking(execute_source_adapter_shadow(
                        intent,
                        requested_count=remaining_qualified_target,
                        progress_callback=_on_source_adapter_progress,
                        persistent_client=supabase,
                        search_id=str(job_id),
                        resume_state=prior_shadow_resume,
                    ))
                    new_shadow_leads = serialize_shadow_qualified_leads(shadow_result)
                    shadow_leads = merge_shadow_qualified_payloads(prior_qualified_payloads, new_shadow_leads)
                    lifecycle_accepted = persist_and_publish_candidates(
                        supabase,
                        search_id=str(job_id),
                        user_id=job_user_id,
                        leads=shadow_leads,
                        canonical_plan=canonical_shadow_plan,
                        shadow_mode=True,
                    )
                    _heartbeat_stop.set()
                    provider_exhausted = all(
                        item.exhausted and bool(getattr(item, "exhaustion_authoritative", False))
                        for item in shadow_result.adapter_progress
                    ) if shadow_result.adapter_progress else False
                    cumulative_cost = round(float(prior_shadow_resume.get("prior_cost_eur") or 0.0) + float(shadow_result.cost_eur or 0.0), 6)
                    shadow_resume = build_shadow_resume_state(
                        shadow_result,
                        qualified_lead_payloads=shadow_leads,
                        prior_state={
                            **prior_shadow_resume,
                            "prior_cost_eur": float(prior_shadow_resume.get("prior_cost_eur") or 0.0),
                            "total_unique_employer_target": int(job_max),
                        },
                        requested_count=int(job_max),
                    )
                    unique_shadow_count = count_unique_employer_keys(shadow_leads)
                    unique_lifecycle_keys = {
                        employer_key_from_payload(item)
                        for item in lifecycle_accepted
                        if isinstance(item, dict) and employer_key_from_payload(item)
                    }
                    resumable = bool(shadow_resume.get("resumable"))
                    final_status = "completed" if len(unique_lifecycle_keys) >= int(job_max) or not resumable else "pending"
                    cumulative_raw = int(shadow_resume.get("cumulative_raw_unique") or 0)
                    cumulative_audited = int(shadow_resume.get("cumulative_audited") or 0)
                    final_shadow_progress = {
                        "stage": "source_adapter_shadow_resumable" if resumable else "source_adapter_shadow_completed",
                        "stop_reason": shadow_result.status if len(unique_lifecycle_keys) >= int(job_max) else "UNIQUE_EMPLOYER_TARGET_NOT_REACHED",
                        "target": int(job_max),
                        "found": len(unique_lifecycle_keys),
                        "discovered": cumulative_raw,
                        "raw": cumulative_raw,
                        "unique_entities": unique_shadow_count,
                        "unique_lifecycle_accepted_count": len(unique_lifecycle_keys),
                        "processed_employer_keys": list(collect_processed_employer_keys(processed_employer_keys, shadow_leads)),
                        "resolved": shadow_result.progress.resolved_count,
                        "audited": cumulative_audited,
                        "evidence_verified": shadow_result.progress.evidence_verified_count,
                        "qualified": unique_shadow_count,
                        "lifecycle_qualified": len(unique_lifecycle_keys),
                        "rejected": shadow_result.progress.rejected_count + len(geography_rejected_payloads),
                        "rejection_codes": {
                            **dict(shadow_result.rejection_codes),
                            **({"GEO_OUT_OF_SCOPE": len(geography_rejected_payloads)} if geography_rejected_payloads else {}),
                        },
                        "coverage_status": shadow_result.coverage.status,
                        "selected_adapters": list(shadow_result.coverage.adapter_ids),
                        "missing_signals": list(shadow_result.coverage.missing_signals),
                        "coverage_reasons": list(shadow_result.coverage.reasons),
                        "adapter_telemetry": [
                            (
                                item.to_root_cause_telemetry()
                                if hasattr(item, "to_root_cause_telemetry")
                                else {
                                    "adapter_id": item.adapter_id,
                                    "calls": item.calls,
                                    "operations": item.operations,
                                    "raw_candidates": item.raw_candidates,
                                    "unique_candidates": item.unique_candidates,
                                    "qualified": item.qualified,
                                    "cost_eur": item.cost_eur,
                                    "exhausted": item.exhausted,
                                    "exhaustion_authoritative": bool(getattr(item, "exhaustion_authoritative", False)),
                                    "exhaustion_scope": getattr(item, "exhaustion_scope", None),
                                    "exhaustion_reason": getattr(item, "exhaustion_reason", None),
                                    "warnings": list(item.warnings),
                                    "acquisition": dict(getattr(item, "acquisition_telemetry", {}) or {}),
                                    "next_cursor": item.next_cursor.value if item.next_cursor else None,
                                }
                            )
                            for item in shadow_result.adapter_progress
                        ],
                        "projection_traces": [
                            dict(trace)
                            for item in shadow_result.adapter_progress
                            for trace in (getattr(item, "projection_traces", None) or [])
                        ],
                        "termination_reason": shadow_result.status,
                        "provider_exhausted": provider_exhausted,
                        "provider_exhausted_authoritative": provider_exhausted,
                        "shadow_resume": shadow_resume,
                        "resume_cursor": next(iter(shadow_resume.get("resume_cursors", {}).values()), None),
                        "published": 0,
                        "cost_eur": cumulative_cost,
                        "updated_at": _utc_now_iso(),
                    }
                    supabase.table("searches").update({
                        "status": final_status,
                        "results": lifecycle_accepted,
                        "worker_id": None,
                        "heartbeat_at": None,
                        "lease_expires_at": None,
                        "progress": final_shadow_progress,
                        "updated_at": _utc_now_iso(),
                    }).eq("id", job_id).eq("status", "processing").execute()
                except Exception as shadow_error:
                    _heartbeat_stop.set()
                    print(
                        f"[worker_supabase] source-adapter shadow failed job={job_id}: "
                        f"{shadow_error.__class__.__name__}: {shadow_error}",
                        flush=True,
                    )
                    import traceback as _tb
                    print(_tb.format_exc(), flush=True)
                    supabase.table("searches").update({
                        "status": "error",
                        "results": prior_qualified_payloads,
                        "worker_id": None,
                        "heartbeat_at": None,
                        "lease_expires_at": None,
                        "progress": {
                            "stage": "source_adapter_shadow_failed",
                            "stop_reason": "SOURCE_ADAPTER_SHADOW_FAILED",
                            "error_type": shadow_error.__class__.__name__,
                            "error_message": str(shadow_error)[:500],
                            "target": job_max,
                            "found": len(prior_qualified_payloads),
                            "unique_lifecycle_accepted_count": unique_prior_count,
                            "processed_employer_keys": list(processed_employer_keys),
                            "shadow_resume": prior_shadow_resume,
                            "published": 0,
                            "updated_at": _utc_now_iso(),
                        },
                        "updated_at": _utc_now_iso(),
                    }).eq("id", job_id).eq("status", "processing").execute()
                if bool(getattr(args, "once", False)):
                    return
                continue

            if not _agentic_only:
                try:
                    __import__('threading').Thread(target=_publish_progressive_organic, daemon=True).start()
                except Exception as e:
                    print(f"[worker_supabase] Progressive organic thread skipped: {e}", flush=True)

            def _on_maps_result(raw_item):
                try:
                    fmt = _format_results([raw_item])
                    if fmt:
                        with _rt_lock:
                            _rt_results.extend(fmt)
                            merged = _merge_formatted_results([], _rt_results)
                            merged = _filter_non_domestic_refrigeration_results(category, merged)
                            _rt_results.clear()
                            _rt_results.extend(merged)
                            snapshot = list(_rt_results)
                        _publish_job_results_safe(snapshot)
                except Exception:
                    pass

            # Progressive audit callback: update DB with full results (incl. email) after each site audit
            def _on_audit_done(audited_results):
                try:
                    fmt = _format_results(audited_results)
                    if fmt:
                        with _rt_lock:
                            merged = _merge_formatted_results(_rt_results, fmt)
                            merged = _filter_non_domestic_refrigeration_results(category, merged)
                            _rt_results.clear()
                            _rt_results.extend(merged)
                            snapshot = list(_rt_results)
                        _publish_job_results_safe(snapshot)
                except Exception:
                    pass

            if _agentic_only:
                print(f"[worker_supabase] Agentic-only job {job_id} — skip Maps, target={job_max}", flush=True)
                with _rt_lock:
                    formatted = list(_rt_results)
                _publish_job_results_safe(formatted, status="running")
            else:
                core_results = asyncio.run(_run_core_scraper(category=category, location=location, zone=zone, on_result=_on_maps_result, on_audit_done=_on_audit_done, intent=intent))
                formatted = _format_results(core_results)
                print(f"[worker_supabase] Formatted Maps leads: {len(formatted)} (core_results={len(core_results)})", flush=True)
                try:
                    organic_raw = _discover_organic_website_leads(category=category, location=location)
                    organic_formatted = _format_results(organic_raw)
                    print(f"[worker_supabase] Organic website discovery candidates: {len(organic_formatted)}", flush=True)
                    if organic_formatted:
                        with _rt_lock:
                            formatted = _merge_formatted_results(formatted, organic_formatted)
                        print(f"[worker_supabase] Formatted after organic merge: {len(formatted)}", flush=True)
                except Exception as e:
                    print(f"[worker_supabase] Organic website discovery skipped: {e}")

                formatted = _filter_non_domestic_refrigeration_results(category, formatted)
                with _rt_lock:
                    if _rt_results:
                        formatted = _merge_formatted_results(_rt_results, formatted)

            # Google Maps can return a page-sized batch larger than requested.
            # Apply the contract before any expensive audit/enrichment stage.
            formatted = _cap_search_results(formatted, job_max, prioritize_hot=_agentic_only)
            formatted = _filter_results_by_confirmed_required_signals(formatted, intent if isinstance(intent, dict) else None, stage="pre-audit")

            try:
                if formatted:
                    print(f"DEBUG DATA: {formatted[0]}")
                    print("[worker_supabase] Debug first result:")
                    print(json.dumps(formatted[0], ensure_ascii=False))
            except Exception:
                pass

            print(f"[worker_supabase] Job {job_id} completato. Risultati: {len(formatted)}")

            try:
                _strict_signal_publish = bool(_required_signals_from_intent(intent if isinstance(intent, dict) else None))
                formatted = asyncio.run(
                    _finish_pending_audits(
                        formatted,
                        publish_cb=None if _strict_signal_publish else (lambda snap: _publish_job_results_safe(snap)),
                        audit_policy=_canonical_audit_policy(intent if isinstance(intent, dict) else None),
                    )
                )
            except Exception as e:
                print(f"[worker_supabase] completion-pass skipped: {e}", flush=True)

            if not _agentic_only:
                try:
                    formatted = asyncio.run(
                        _run_business_events_enrichment(
                            formatted,
                            location,
                            supabase=supabase,
                            user_id=job_user_id,
                            publish_cb=_publish_job_results_safe,
                            intent=intent,
                        )
                    )
                    formatted = _publish_job_results_safe(formatted)
                except Exception as e:
                    print(f"[worker_supabase] business_events enrichment failed: {e}", flush=True)

            try:
                _job_query = None
                if isinstance(intent, dict):
                    _job_query = intent.get("original_query") or intent.get("query")
                agentic_exhaustion_msg: Optional[str] = None
                formatted, agentic_exhaustion_msg = _agentic_gap_fill_safe(
                    formatted if isinstance(formatted, list) else [],
                    job_max=job_max,
                    intent=intent if isinstance(intent, dict) else None,
                    category=category,
                    location=location,
                    original_query=str(_job_query) if _job_query else None,
                    publish_cb=_publish_job_results_safe,
                    supabase=supabase,
                    search_id=str(job_id),
                    user_id=job_user_id,
                )
            except Exception as e:
                print(f"[worker_supabase] agentic gap-fill outer skipped: {e}", flush=True)
                agentic_exhaustion_msg = None

            _strict_shadow_pool = bool(
                _required_signals_from_intent(intent if isinstance(intent, dict) else None)
                and isinstance(intent, dict)
                and intent.get("customer_visible") is False
                and str(intent.get("lifecycle_stage") or "") == "v5_shadow"
            )
            if not _strict_shadow_pool:
                formatted = _cap_search_results(formatted, job_max, prioritize_hot=_agentic_only)
            formatted = _filter_results_by_confirmed_required_signals(formatted, intent if isinstance(intent, dict) else None, stage="post-agentic")

            # Agentic-only must not complete with empty contacts/socials. Run
            # the same website audit pass before final status, then drop
            # no-contact leads and let the job auto-resume if target is short.
            try:
                _strict_signal_publish = bool(_required_signals_from_intent(intent if isinstance(intent, dict) else None))
                formatted = asyncio.run(
                    _finish_pending_audits(
                        formatted if isinstance(formatted, list) else [],
                        publish_cb=None
                        if _strict_signal_publish
                        else (lambda snap: _publish_job_results_safe(snap, status="running")),
                        audit_policy=_canonical_audit_policy(intent if isinstance(intent, dict) else None),
                    )
                )
            except Exception as e:
                print(f"[worker_supabase] post-agentic audit pass skipped: {e}", flush=True)

            if _agentic_only and isinstance(formatted, list):
                before_contact_filter = len(formatted)
                formatted = [lead for lead in formatted if _lead_has_contact_channel(lead)]
                dropped_no_contact = before_contact_filter - len(formatted)
                if dropped_no_contact > 0:
                    print(
                        f"[worker_supabase] Agentic contact gate dropped {dropped_no_contact} no-contact leads",
                        flush=True,
                    )
                    if isinstance(intent, dict):
                        checkpoint = intent.get("agentic_checkpoint")
                        if isinstance(checkpoint, dict):
                            checkpoint["stop_reason"] = "round_complete"
                        intent["agentic_checkpoint"] = checkpoint or {"stop_reason": "round_complete"}
                        try:
                            supabase.table("searches").update({"intent": intent}).eq("id", job_id).execute()
                        except Exception as _contact_gate_stats_err:
                            print(f"[worker_supabase] contact-gate intent update skipped: {_contact_gate_stats_err}", flush=True)

            agentic_count = len(formatted) if isinstance(formatted, list) else 0
            checkpoint_state = (
                intent.get("agentic_checkpoint")
                if isinstance(intent, dict) and isinstance(intent.get("agentic_checkpoint"), dict)
                else {}
            )
            checkpoint_reason = str(checkpoint_state.get("stop_reason") or "")
            agentic_resume_needed = (
                agentic_count < job_max
                and checkpoint_reason in {"page_budget", "time_budget", "round_complete"}
            )
            # ponytail: Maps fallback disabilitato per agentic_only — evita lead Maps spuri (es. Evolve Media)
            _allow_maps_fallback = False
            if _allow_maps_fallback and _agentic_only and agentic_count < max(3, min(25, job_max // 15)):
                print(
                    f"[worker_supabase] Agentic-only produced {agentic_count} leads — Maps+organic fallback",
                    flush=True,
                )
                try:
                    core_results = asyncio.run(
                        _run_core_scraper(
                            category=category,
                            location=location,
                            zone=zone,
                            on_result=_on_maps_result,
                            on_audit_done=_on_audit_done,
                            intent=intent,
                        )
                    )
                    maps_fmt = _format_results(core_results)
                    organic_raw = _discover_organic_website_leads(category=category, location=location)
                    organic_formatted = _format_results(organic_raw)
                    merged_fb = _merge_formatted_results(maps_fmt, organic_formatted)
                    formatted = _merge_formatted_results(
                        formatted if isinstance(formatted, list) else [],
                        merged_fb,
                    )
                    formatted = _filter_non_domestic_refrigeration_results(category, formatted)
                    formatted = _publish_job_results_safe(formatted, status="running")
                    print(
                        f"[worker_supabase] Maps fallback total leads: {len(formatted)}",
                        flush=True,
                    )
                except Exception as fb_e:
                    print(f"[worker_supabase] Maps fallback failed: {fb_e}", flush=True)

            if not _strict_shadow_pool:
                formatted = _cap_search_results(formatted, job_max, prioritize_hot=_agentic_only)
            formatted = _filter_results_by_confirmed_required_signals(formatted, intent if isinstance(intent, dict) else None, stage="final")
            pending_left = sum(1 for l in formatted if isinstance(l, dict) and _lead_has_pending_audit(l))
            # Maps scrape finished → mark completed so UI stops spinner; resume-audits finishes light audits.
            final_status = "pending" if agentic_resume_needed else "completed"
            _heartbeat_stop.set()
            if agentic_resume_needed:
                print(
                    f"[worker_supabase] Job {job_id}: auto-resume agentic "
                    f"({agentic_count}/{job_max}, reason={checkpoint_reason})",
                    flush=True,
                )
            if pending_left > 0:
                print(
                    f"[worker_supabase] Job {job_id}: {pending_left} audit leggeri pending — "
                    f"status={final_status} (resume via frontend/worker)",
                    flush=True,
                )

            formatted = _publish_job_results_safe(formatted, status=final_status)

            if agentic_exhaustion_msg:
                try:
                    merged_intent = dict(intent) if isinstance(intent, dict) else {}
                    merged_intent["completion_user_message"] = agentic_exhaustion_msg
                    supabase.table("searches").update({"intent": merged_intent}).eq("id", job_id).execute()
                    print(
                        f"[worker_supabase] Saved exhaustion message for job {job_id}",
                        flush=True,
                    )
                except Exception as _ex_msg_err:
                    print(f"[worker_supabase] exhaustion message save skipped: {_ex_msg_err}", flush=True)

            # ---- Universe sidecar ingest (Phase 3) — dopo audit + business events sync ----
            try:
                from universe.sidecar import ingest_leads_batch

                _u_stats = ingest_leads_batch(
                    supabase,
                    formatted if isinstance(formatted, list) else [],
                    source="maps_scrape",
                    user_id=job_user_id,
                    enable_live_sources=False,
                )
                if _u_stats["ingested"] or _u_stats["errors"]:
                    print(
                        f"[worker_supabase] universe ingest maps_scrape: "
                        f"{_u_stats['ingested']} ok, {_u_stats['errors']} err",
                        flush=True,
                    )
                _sync_neo4j_universe_safe(supabase, formatted)
            except Exception as _u_init_ex:
                print(f"[worker_supabase] universe ingest skipped: {_u_init_ex}", flush=True)

            enrich_business = os.getenv("ENRICH_BUSINESS_EVENTS", "1").strip().lower() in {"1", "true", "yes"}
            if enrich_business and formatted:
                _bg_formatted = [dict(x) if isinstance(x, dict) else x for x in formatted]
                _bg_user = str(job.get("user_id") or "").strip() or None

                def _bg_external_enrich() -> None:
                    try:
                        pending = [
                            x for x in _bg_formatted if isinstance(x, dict) and not x.get("business_events_external_at")
                        ]
                        if not pending:
                            return
                        # Use a fresh client in the background thread to avoid sharing
                        # the main-thread HTTP connection pool.
                        sb_bg = _create_fresh_supabase_client()

                        def _bg_publish(new_results, status=None):
                            try:
                                payload = {"results": new_results if isinstance(new_results, list) else []}
                                if status:
                                    payload["status"] = status
                                sb_bg.table("searches").update(payload).eq("id", job_id).execute()
                                _sync_search_leads_safe(
                                    sb_bg,
                                    job_id,
                                    _bg_user,
                                    new_results if isinstance(new_results, list) else [],
                                )
                                _sync_neo4j_leads_safe(new_results if isinstance(new_results, list) else [], job_id)
                            except Exception as e:
                                print(f"[worker_supabase] bg publish skipped: {e}", flush=True)

                        asyncio.run(
                            _run_business_events_enrichment(
                                pending,
                                location,
                                supabase=sb_bg,
                                user_id=_bg_user,
                                publish_cb=_bg_publish,
                                external_only=True,
                                intent=intent,
                            )
                        )
                        _bg_publish(_bg_formatted)
                        try:
                            from universe.sidecar import ingest_leads_batch

                            _u_ext = ingest_leads_batch(
                                sb_bg,
                                _bg_formatted,
                                source="business_events_external",
                                user_id=_bg_user,
                                enable_live_sources=True,
                            )
                            if _u_ext["ingested"] or _u_ext["errors"]:
                                print(
                                    f"[worker_supabase] universe re-ingest post-external: "
                                    f"{_u_ext['ingested']} ok, {_u_ext['errors']} err",
                                    flush=True,
                                )
                            _sync_neo4j_universe_safe(sb_bg, _bg_formatted)
                        except Exception as _u_ext_ex:
                            print(f"[worker_supabase] universe post-external skipped: {_u_ext_ex}", flush=True)
                    except Exception as ex:
                        print(f"[worker_supabase] background enrich failed: {ex}", flush=True)

                threading.Thread(target=_bg_external_enrich, daemon=True).start()

            # Cooldown between jobs (avoid hammering and give browser/OS time to settle)
            time.sleep(max(0, cooldown_s))

            if bool(getattr(args, "once", False)):
                print("[worker_supabase] --once richiesto: termino dopo 1 job.")
                return

        except KeyboardInterrupt:
            print("[worker_supabase] Stop richiesto dall'utente.")
            return
        except Exception as e:
            err = str(e) or e.__class__.__name__
            print("[worker_supabase] ERROR:", err)
            print(traceback.format_exc())

            try:
                if "_heartbeat_stop" in locals() and _heartbeat_stop is not None:
                    _heartbeat_stop.set()
            except Exception:
                pass

            # Best effort: if we have an id in scope, mark error
            try:
                if "job_id" in locals() and locals().get("job_id"):
                    current_results = []
                    try:
                        row = supabase.table("searches").select("results").eq("id", locals()["job_id"]).single().execute().data or {}
                        current_results = row.get("results") or []
                        if isinstance(current_results, str):
                            current_results = json.loads(current_results)
                    except Exception:
                        current_results = []
                    if isinstance(current_results, list) and current_results:
                        pending_left = sum(
                            1 for l in current_results if isinstance(l, dict) and _lead_has_pending_audit(l)
                        )
                        err_status = "completed"
                        error_payload: Dict[str, Any] = {"status": err_status, "results": current_results}
                        if _lease_supported:
                            error_payload.update(
                                {
                                    "worker_id": None,
                                    "heartbeat_at": None,
                                    "lease_expires_at": None,
                                    "progress": {
                                        "phase": err_status,
                                        "found": len(current_results),
                                        "target": job_max if "job_max" in locals() else None,
                                        "error": err,
                                        "updated_at": _utc_now_iso(),
                                    },
                                }
                            )
                        supabase.table("searches").update(error_payload).eq("id", locals()["job_id"]).execute()
                        _sync_search_leads_safe(
                            supabase,
                            locals().get("job_id"),
                            str(job.get("user_id") or "").strip() if "job" in locals() and isinstance(job, dict) else None,
                            current_results,
                        )
                        _sync_neo4j_leads_safe(current_results, job_id)
                    else:
                        error_payload = {
                            "status": "error",
                            "results": {
                                "error": err,
                                "trace": traceback.format_exc(),
                                "ts": _utc_now_iso(),
                            },
                        }
                        if _lease_supported:
                            error_payload.update(
                                {
                                    "worker_id": None,
                                    "heartbeat_at": None,
                                    "lease_expires_at": None,
                                    "progress": {
                                        "phase": "error",
                                        "found": 0,
                                        "target": job_max if "job_max" in locals() else None,
                                        "error": err,
                                        "updated_at": _utc_now_iso(),
                                    },
                                }
                            )
                        supabase.table("searches").update(
                            error_payload
                        ).eq("id", locals()["job_id"]).execute()
            except Exception:
                pass

            time.sleep(4)
async def _reaudit_single_lead(
    lead_data: Dict[str, Any],
    supabase,
) -> Optional[Dict[str, Any]]:
    """Re-audit a single lead's website and return updated dict (or None)."""
    logger = logging.getLogger("worker_supabase.reaudit")

    try:
        website = (lead_data.get("sito") or lead_data.get("website") or "").strip()
        if not website:
            return None

        url = website if website.startswith("http") else f"https://{website}"
        try:
            audit = await asyncio.wait_for(process_single_url(url), timeout=45.0)
        except asyncio.TimeoutError:
            try:
                logger.warning(f"[reaudit] Timeout per {website}")
            except Exception:
                pass
            return None
        except Exception as e:
            try:
                logger.warning(f"[reaudit] Errore audit per {website}: {e}")
            except Exception:
                pass
            return None

        if not isinstance(audit, dict):
            return None

        updated = _apply_audit_url_payload_to_lead(lead_data, audit)

        try:
            changes = _detect_changes(lead_data, updated)
            existing_changes = lead_data.get("change_history") or []
            if isinstance(existing_changes, list):
                updated["change_history"] = existing_changes + changes
            else:
                updated["change_history"] = changes

            if changes:
                try:
                    logger.info(
                        f"[reaudit] {lead_data.get('azienda','?')} — {len(changes)} cambiamenti"
                    )
                except Exception:
                    pass
        except Exception:
            pass

        return updated
    except Exception as e:
        try:
            logger.warning(f"[reaudit] Errore per lead: {e}")
        except Exception:
            pass
        return None


def run_reaudit_worker(max_leads: int = 20) -> None:
    """Background worker: re-audit stale leads stored in completed searches."""
    logger = logging.getLogger("worker_supabase.reaudit")
    try:
        logger.info(f"[reaudit] Avvio re-audit worker (max {max_leads} lead)")
    except Exception:
        pass

    try:
        supabase_key = _get_supabase_key()
        if create_client is None:
            try:
                logger.error("[reaudit] supabase-py non installato")
            except Exception:
                pass
            return

        supabase = create_client(SUPABASE_URL, supabase_key)
    except Exception:
        return

    reaudited = 0
    try:
        resp = (
            supabase.table("searches")
            .select("id, results, created_at")
            .eq("status", "completed")
            .not_.is_("results", "null")
            .order("created_at", desc=False)
            .limit(50)
            .execute()
        )
        rows = getattr(resp, "data", None) or []
        try:
            logger.info(f"[reaudit] Trovate {len(rows)} ricerche candidate")
        except Exception:
            pass

        for row in rows:
            if reaudited >= max_leads:
                break

            job_id = (row or {}).get("id")
            results = (row or {}).get("results") or []
            if not isinstance(results, list) or not results:
                continue

            updated_results: List[Any] = []
            changed = False

            for lead in results:
                if reaudited >= max_leads:
                    updated_results.append(lead)
                    continue
                if not isinstance(lead, dict):
                    updated_results.append(lead)
                    continue

                last_audited = lead.get("last_audited_at")
                freshness = _calc_freshness_score(last_audited)
                if freshness > 40 and last_audited:
                    updated_results.append(lead)
                    continue

                website = (lead.get("sito") or lead.get("website") or "").strip()
                if not website:
                    updated_results.append(lead)
                    continue

                try:
                    logger.info(f"[reaudit] Re-auditing: {lead.get('azienda','?')} | {website}")
                except Exception:
                    pass

                updated_lead = None
                try:
                    updated_lead = asyncio.run(_reaudit_single_lead(lead, supabase))
                except Exception:
                    updated_lead = None

                if updated_lead:
                    updated_results.append(updated_lead)
                    changed = True
                    reaudited += 1
                else:
                    updated_results.append(lead)

                try:
                    time.sleep(random.uniform(0.5, 1.5))
                except Exception:
                    pass

            if changed and job_id:
                try:
                    supabase.table("searches").update({"results": updated_results}).eq("id", job_id).execute()
                    _sync_search_leads_safe(supabase, job_id, None, updated_results)
                    _sync_neo4j_leads_safe(updated_results, job_id)
                    try:
                        logger.info(f"[reaudit] Job {job_id} aggiornato")
                    except Exception:
                        pass
                except Exception as e:
                    try:
                        logger.error(f"[reaudit] Errore salvataggio: {e}")
                    except Exception:
                        pass

            try:
                time.sleep(random.uniform(2.0, 4.0))
            except Exception:
                pass

    except Exception as e:
        try:
            logger.error(f"[reaudit] Errore critico: {e}")
        except Exception:
            pass

    try:
        logger.info(f"[reaudit] Completato. Lead ri-auditati: {reaudited}")
    except Exception:
        pass


from playwright.async_api import async_playwright


@app.post("/scrape-reviews")
async def scrape_reviews(data: dict):
    business_name = data.get("business_name", "")
    city = data.get("city", "")
    if not business_name:
        return {"reviews": [], "rating": 0, "total": 0}

    # Usa la funzione già esistente e funzionante
    try:
        result = await asyncio.wait_for(
            _scrape_reviews_and_competitors(
                business_name=business_name,
                category="",
                location=city,
            ),
            timeout=45.0
        )
        reviews = result.get("google_reviews", [])
        return {
            "reviews": reviews,
            "rating": 0,
            "total": len(reviews)
        }
    except Exception as e:
        return {"reviews": [], "rating": 0, "total": 0, "error": str(e)}


@app.post("/scrape-competitors")
async def scrape_competitors(data: dict):
    category = data.get("category", "")
    city = data.get("city", "")
    if not category or not city:
        return {"competitors": []}

    # Usa la funzione già esistente e funzionante
    try:
        result = await asyncio.wait_for(
            _scrape_reviews_and_competitors(
                business_name="",
                category=category,
                location=city,
            ),
            timeout=45.0
        )
        return {"competitors": result.get("local_competitors", [])}
    except Exception as e:
        return {"competitors": [], "error": str(e)}


@app.post("/track-competitor-signals")
async def track_competitor_signals(data: dict):
    """Fase 10 — waterfall segnali su competitor tracciato."""
    try:
        from competitor_track import track_competitor

        location = str(data.get("city") or data.get("citta") or data.get("location") or "Italia")
        result = await asyncio.wait_for(track_competitor(data, location), timeout=50.0)
        return result
    except Exception as e:
        return {"ok": False, "signals": [], "error": str(e)}


@app.post("/scrape-social")
async def scrape_social(data: dict):
    instagram_url = data.get("instagram_url", "")
    facebook_url = data.get("facebook_url", "")
    result = {}

    if not instagram_url and not facebook_url:
        return result

    try:
        async with async_playwright() as p:
            # User agent iPhone — unico modo per leggere Instagram
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Version/16.6 Mobile/15E148 Safari/604.1"
                ),
                locale="it-IT",
                viewport={"width": 390, "height": 844}
            )

            # INSTAGRAM
            if instagram_url:
                page = await context.new_page()
                try:
                    await page.goto(
                        instagram_url,
                        timeout=25000,
                        wait_until="domcontentloaded"
                    )
                    await page.wait_for_timeout(3000)

                    followers = "N/D"
                    posts = 0

                    # Metodo 1: meta description (più affidabile)
                    meta = await page.query_selector('meta[name="description"]')
                    if meta:
                        content = await meta.get_attribute('content') or ""
                        # Formato IT: "1.520 follower, 320 seguiti, 45 post"
                        # Formato EN: "1,520 Followers, 320 Following, 45 Posts"
                        f_match = re.search(
                            r'([\d.,KkMm]+)\s*(?:follower|Follower)',
                            content, re.I
                        )
                        if f_match:
                            followers = f_match.group(1)
                        p_match = re.search(
                            r'(\d+)\s*(?:post|Post)',
                            content, re.I
                        )
                        if p_match:
                            posts = int(p_match.group(1))

                    # Metodo 2: titolo pagina
                    if followers == "N/D":
                        title = await page.title()
                        if title:
                            f_match = re.search(
                                r'([\d.,KkMm]+)\s*(?:follower|Follower)',
                                title, re.I
                            )
                            if f_match:
                                followers = f_match.group(1)

                    result["instagram"] = {
                        "found": True,
                        "url": instagram_url,
                        "followers": followers,
                        "posts": posts
                    }
                except Exception as e:
                    result["instagram"] = {
                        "found": False,
                        "url": instagram_url,
                        "error": str(e)
                    }
                finally:
                    await page.close()

            # FACEBOOK
            if facebook_url:
                page = await context.new_page()
                try:
                    await page.goto(
                        facebook_url,
                        timeout=25000,
                        wait_until="domcontentloaded"
                    )
                    await page.wait_for_timeout(3000)

                    likes = "N/D"
                    followers_fb = "N/D"

                    # Metodo 1: meta description
                    meta = await page.query_selector('meta[name="description"]')
                    if meta:
                        content = await meta.get_attribute('content') or ""
                        f_match = re.search(
                            r'([\d.,KkMm]+)\s*(?:Mi piace|like|follower)',
                            content, re.I
                        )
                        if f_match:
                            likes = f_match.group(1)

                    # Metodo 2: testo pagina
                    if likes == "N/D":
                        body = await page.inner_text('body')
                        f_match = re.search(
                            r'([\d.,]+)\s*(?:Mi piace|persone seguono)',
                            body, re.I
                        )
                        if f_match:
                            likes = f_match.group(1)

                    result["facebook"] = {
                        "found": True,
                        "url": facebook_url,
                        "likes": likes,
                        "followers": followers_fb
                    }
                except Exception as e:
                    result["facebook"] = {
                        "found": False,
                        "url": facebook_url,
                        "error": str(e)
                    }
                finally:
                    await page.close()

            await context.close()
            await browser.close()
    except Exception as e:
        return {"error": str(e)}

    return result


@app.post("/scrape-registry")
async def scrape_registry(data: dict):
    business_name = data.get("business_name", "")
    city = data.get("city", "")
    if not business_name:
        return {"found": False}

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="it-IT"
            )
            page = await context.new_page()

            # Cerca su imprese.italia.it
            search_url = (
                "https://imprese.italia.it/ricerca-aziende?q="
                + quote(f"{business_name} {city}".strip())
            )
            await page.goto(search_url, timeout=20000,
                          wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            # Accetta cookie se presente
            try:
                await page.click(
                    'button:has-text("Accetta"), '
                    'button:has-text("Accetto"), '
                    'button:has-text("OK")',
                    timeout=2000
                )
                await page.wait_for_timeout(500)
            except:
                pass

            # Clicca primo risultato
            clicked = False
            for sel in [
                'a.company-name',
                'h3 a',
                '.result a',
                'table tbody tr:first-child a',
                'ul li:first-child a'
            ]:
                try:
                    el = await page.query_selector(sel)
                    if el:
                        await el.click()
                        await page.wait_for_timeout(2000)
                        clicked = True
                        break
                except:
                    continue

            if not clicked:
                await browser.close()
                return {"found": False}

            # Leggi testo completo e parsa i campi
            body_text = await page.inner_text('body')

            res = {"found": True}

            patterns = {
                "ragione_sociale": [
                    r'(?:Denominazione|Ragione sociale)[:\s]+([^\n]+)',
                    r'(?:Nome impresa)[:\s]+([^\n]+)'
                ],
                "forma_giuridica": [
                    r'(?:Forma giuridica|Natura giuridica)[:\s]+([^\n]+)'
                ],
                "codice_ateco": [
                    r'(?:Codice ATECO|ATECO)[:\s]+([^\n]+)',
                    r'(?:Attività principale)[:\s]+([^\n]+)'
                ],
                "data_costituzione": [
                    r'(?:Data (?:di )?costituzione|Costituita il|'
                    r'Data iscrizione)[:\s]+([^\n]+)'
                ],
                "sede_legale": [
                    r'(?:Sede legale|Indirizzo sede)[:\s]+([^\n]+)'
                ],
                "stato": [
                    r'(?:Stato attività|Stato impresa|Status)[:\s]+([^\n]+)'
                ]
            }

            for field, pats in patterns.items():
                val = "N/D"
                for pat in pats:
                    m = re.search(pat, body_text, re.I)
                    if m:
                        val = m.group(1).strip()[:100]
                        break
                res[field] = val

            await browser.close()

            # Se tutti N/D non abbiamo trovato nulla di utile
            filled = [
                v for k, v in res.items()
                if k != "found" and v != "N/D"
            ]
            if not filled:
                return {"found": False, "reason": "nessun_dato_estratto"}

            return res

    except Exception as e:
        return {"found": False, "error": str(e)}


if __name__ == "__main__":
    main()
