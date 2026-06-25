import asyncio
import csv
import io
import json
import os
import random
import sys
import re
import time
import uuid
import traceback
import html as _html
import threading
from urllib.parse import quote
from urllib.parse import urlparse
from datetime import date, datetime
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, List, Literal, Optional, Tuple

from audit_engine import run_technical_audit
from report_generator import generate_audit_pdf

try:
    from colorama import Fore, Style, init as colorama_init

    colorama_init(autoreset=True)
except Exception:  # pragma: no cover
    Fore = None  # type: ignore
    Style = None  # type: ignore

# Windows: Playwright spawns browser subprocesses. SelectorEventLoop on Windows
# does NOT support subprocess; ensure Proactor is used.
if os.name == "nt":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

import httpx
from bs4 import BeautifulSoup
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    import whois as _whois  # type: ignore
except Exception:  # pragma: no cover
    _whois = None

try:
    from playwright.async_api import async_playwright
except Exception:  # pragma: no cover
    async_playwright = None

try:
    from playwright.sync_api import sync_playwright
except Exception:  # pragma: no cover
    sync_playwright = None

try:
    from supabase import create_client  # type: ignore
except Exception:  # pragma: no cover
    create_client = None  # type: ignore


_LEAD_HISTORY_LOCK = threading.Lock()


def _lead_history_path() -> str:
    # Persist next to the executable in PyInstaller builds; otherwise next to this file.
    try:
        if getattr(sys, "frozen", False) and getattr(sys, "executable", None):
            base_dir = os.path.dirname(os.path.abspath(sys.executable))
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
    except Exception:
        base_dir = os.getcwd()
    return os.path.join(base_dir, "lead_history.json")


def _normalize_phone_id(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    p = str(phone).strip()
    if not p:
        return None
    # Keep only digits and leading '+' (if present)
    keep_plus = p.startswith("+")
    digits = re.sub(r"\D+", "", p)
    if not digits:
        return None
    # IMPORTANT: never infer foreign prefixes. We only normalize Italian mobiles by forcing +39
    # when they are given as local 9/10 digits starting with '3'.
    if not keep_plus and len(digits) in (9, 10) and digits.startswith("3"):
        return "+39" + digits
    return ("+" if keep_plus else "") + digits


def normalize_phone_italy(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        m = re.search(
            r"(?:(?:\+|00)39)?[\s-]?([03]\d{1,4}[\s-]?\d{3,4}[\s-]?\d{3,4})",
            str(value),
        )
        if not m:
            return None
        raw = m.group(1) or ""
        digits = re.sub(r"\D+", "", raw)
        if not digits:
            return None
        # Validate Italian phone lengths (exclude +39): 8..11 digits
        if len(digits) < 8 or len(digits) > 11:
            return None
        if digits.startswith("3"):
            return "+39" + digits
        if digits.startswith("0"):
            return digits
        return None
    except Exception:
        return None


async def deep_scrape_email_from_website(website: str, html_home: Optional[str] = None) -> Optional[str]:
    base = normalize_website(website) or website
    if not base:
        return None

    try:
        found = extract_email_from_html(html_home or "") if html_home else None
        if found:
            return found
    except Exception:
        pass

    candidates = [
        "/contatti",
        "/contatti/",
        "/contatto",
        "/contact",
        "/contact/",
    ]

    try:
        from urllib.parse import urljoin

        timeout = httpx.Timeout(10.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False) as client:
            for path in candidates:
                try:
                    url = urljoin(base, path)
                    r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                    if not getattr(r, "text", None):
                        continue
                    em = extract_email_from_html(r.text)
                    if em:
                        return em
                except Exception:
                    continue
    except Exception:
        pass

    return None


def clean_phone(raw_phone):
    if not raw_phone:
        return None, False

    # Rimuovi tutto tranne numeri e +
    num = re.sub(r"[^\d+]", "", str(raw_phone))

    # Rimuovi prefisso italiano
    if num.startswith("+39"):
        num = num[3:]
    elif num.startswith("0039"):
        num = num[4:]

    if not num:
        return None, False

    # REGOLE FERREE SUI FISSI E MOBILI
    if num.startswith("0"):
        # È UN FISSO
        if num.startswith("00"):
            num = num[1:]
        return num, False

    elif num.startswith("3"):
        # È UN CELLULARE
        return num, True

    return num, False


_MOBILE_IT_RE = re.compile(r"\b(3[2-9]\d{1}\s?\d{3}\s?\d{3,4})\b")

# Strict mobile regex requested for robust extraction from raw HTML (including cookie-consent blocks)
_MOBILE_IT_STRICT_RE = re.compile(
    r"(?<!\d)(?:(?:\+|00)39)?[\s\.\-]*3\d{2}[\s\.\-]*\d{6,7}(?!\d)",
    flags=re.IGNORECASE,
)


def _extract_mobile_it_from_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = _MOBILE_IT_RE.search(text)
    if not m:
        return None
    candidate = m.group(1) or ""
    num, is_mobile = clean_phone(candidate)
    if not num or not is_mobile:
        return None
    # Anti-P.IVA guardrail: only accept local mobile lengths.
    digits = re.sub(r"\D+", "", num)
    if len(digits) > 10:
        return None
    if digits.startswith("0"):
        return None
    if not digits.startswith("3"):
        return None
    return "+39" + digits


def _extract_mobile_it_from_html(html: Optional[str]) -> Optional[str]:
    if not html:
        return None
    # Metodo A: Bottoni/Link sicuri
    try:
        soup = BeautifulSoup(html, "html.parser")
        for a in soup.select("a[href]"):
            href = (a.get("href") or "").strip()
            if not href:
                continue

            href_l = href.lower()
            phone_candidate: Optional[str] = None

            if href_l.startswith("tel:"):
                phone_candidate = href.split(":", 1)[1]
            elif "wa.me/" in href_l:
                # e.g. https://wa.me/393331234567
                phone_candidate = href.split("wa.me/", 1)[1]
            elif "api.whatsapp.com/send" in href_l:
                # e.g. https://api.whatsapp.com/send?phone=393331234567
                m = re.search(r"[?&]phone=([^&]+)", href, flags=re.IGNORECASE)
                if m:
                    phone_candidate = m.group(1)

            if not phone_candidate:
                continue

            num, is_mobile = clean_phone(phone_candidate)
            if not num or not is_mobile:
                continue
            digits = re.sub(r"\D+", "", num)
            if len(digits) > 10:
                continue
            return "+39" + digits
    except Exception:
        pass

    # Metodo B: Testo visibile (vietato regex su HTML grezzo)
    try:
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text(separator=" ")
    except Exception:
        text = None
    return _extract_mobile_it_from_text(text)


def _extract_mobile_it_strict_from_raw_html(html: Optional[str]) -> Optional[str]:
    if not html:
        return None
    try:
        m = _MOBILE_IT_STRICT_RE.search(str(html))
        if not m:
            return None
        raw = m.group(0) or ""
        # Clean spaces/dashes and remove any +/00 prefix, then validate length.
        raw = re.sub(r"[\s\-\.]", "", raw)
        raw = raw.replace("+", "")
        if raw.startswith("00"):
            raw = raw[2:]
        if raw.startswith("39"):
            raw = raw[2:]
        digits = re.sub(r"\D+", "", raw)
        if not digits or not digits.startswith("3"):
            return None
        if len(digits) not in (9, 10):
            return None
        return "+39" + digits
    except Exception:
        return None


def _find_contact_url_from_html(base_url: str, html: str) -> Optional[str]:
    try:
        from urllib.parse import urljoin

        soup = BeautifulSoup(html or "", "html.parser")
        for a in soup.select("a[href]"):
            href = (a.get("href") or "").strip()
            if not href:
                continue
            href_l = href.lower()
            if "contatt" in href_l or "contact" in href_l:
                return urljoin(base_url, href)
    except Exception:
        return None
    return None


async def deep_scrape_mobile_from_website(website: str, html_home: Optional[str] = None) -> Optional[str]:
    base = normalize_website(website) or website
    if not base:
        return None

    # Scan already fetched home HTML first (raw HTML strict regex, then legacy heuristics).
    found = _extract_mobile_it_strict_from_raw_html(html_home) or _extract_mobile_it_from_html(html_home)
    if found:
        return found

    # If we have home HTML, try to discover a real contact page via internal link.
    contact_url: Optional[str] = None
    try:
        if html_home:
            contact_url = _find_contact_url_from_html(base, str(html_home))
    except Exception:
        contact_url = None

    # Then try common internal pages (must remain lightweight)
    candidates = [
        "/contatti",
        "/contatti/",
        "/contatto",
        "/contact",
        "/contact/",
    ]

    # Prefer discovered contact url first.
    if contact_url:
        try:
            candidates = [contact_url] + candidates
        except Exception:
            pass

    try:
        from urllib.parse import urljoin

        timeout = httpx.Timeout(6.0, connect=4.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            for path in candidates:
                try:
                    url = path if str(path).lower().startswith(("http://", "https://")) else urljoin(base, path)
                    r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                    if r.status_code >= 400:
                        continue
                    raw = r.text or ""
                    found = _extract_mobile_it_strict_from_raw_html(raw) or _extract_mobile_it_from_html(raw)
                    if found:
                        return found
                except Exception:
                    continue
    except Exception:
        return None

    return None


def _make_lead_id(business_name: Optional[str], address: Optional[str], phone: Optional[str]) -> str:
    phone_id = _normalize_phone_id(phone)
    if phone_id:
        return f"tel:{phone_id}"
    name_part = (business_name or "").strip().lower()
    addr_part = (address or "").strip().lower()
    return f"na:{name_part}|{addr_part}"


def _load_lead_history() -> set[str]:
    path = _lead_history_path()
    with _LEAD_HISTORY_LOCK:
        try:
            if not os.path.exists(path):
                try:
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump([], f)
                except Exception:
                    pass
                return set()
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return {str(x) for x in data if str(x).strip()}
        except Exception:
            return set()
    return set()


def _append_lead_history(lead_id: str) -> None:
    if not lead_id:
        return
    path = _lead_history_path()
    with _LEAD_HISTORY_LOCK:
        try:
            existing: List[str] = []
            try:
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as f:
                        d = json.load(f)
                        if isinstance(d, list):
                            existing = [str(x) for x in d]
            except Exception:
                existing = []

            if lead_id in set(existing):
                return
            existing.append(lead_id)

            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        except Exception:
            # Best-effort persistence; don't break the job if history can't be written.
            return


class StartJobRequest(BaseModel):
    category: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=120)
    zone: Optional[str] = None
    user_id: Optional[str] = None


def _get_supabase_client():
    """Best-effort Supabase client builder.

    Returns None if Supabase is not configured or supabase-py is not installed.
    """

    if create_client is None:
        return None

    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
        or ""
    ).strip()
    if not url or not key:
        return None

    try:
        return create_client(url, key)
    except Exception:
        return None


def _map_search_row_to_job_status(row: Dict[str, Any]) -> "JobStatus":
    status = str((row or {}).get("status") or "").strip().lower()
    state: JobState
    progress = 0
    message = "—"

    if status == "pending":
        state = "queued"
        progress = 0
        message = "In coda"
    elif status == "processing":
        state = "running"
        progress = 35
        message = "In lavorazione"
    elif status == "completed":
        state = "done"
        progress = 100
        message = "Completato"
    elif status == "error":
        state = "error"
        progress = 100
        message = "Errore"
    else:
        state = "queued"
        progress = 0
        message = f"Stato: {status or 'unknown'}"

    results = (row or {}).get("results")
    results_count = len(results) if isinstance(results, list) else 0
    err = None
    if status == "error" and isinstance(results, dict):
        err = str(results.get("error") or "") or None

    started_at = None
    try:
        started_at = float(time.time())
    except Exception:
        started_at = time.time()

    return JobStatus(
        id=str((row or {}).get("id") or ""),
        state=state,
        progress=progress,
        message=message,
        started_at=started_at,
        finished_at=None,
        error=err,
        results_count=results_count,
    )


class AuditSignals(BaseModel):
    has_facebook_pixel: bool = False
    has_tiktok_pixel: bool = False
    has_gtm: bool = False
    has_ssl: bool = False
    is_mobile_responsive: bool = False
    missing_instagram: bool = False


class BusinessResult(BaseModel):
    result_index: int
    business_name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    website_status: Literal["HAS_WEBSITE", "MISSING_WEBSITE"]
    tech_stack: str = "Custom HTML"
    load_speed_s: Optional[float] = None
    load_speed: Optional[float] = None
    domain_creation_date: Optional[str] = None
    domain_expiration_date: Optional[str] = None
    website_http_status: Optional[int] = None
    website_error: Optional[str] = None
    website_has_html: bool = False
    website_error_line: Optional[int] = None
    website_error_hint: Optional[str] = None
    instagram_missing: Optional[bool] = None
    tiktok_missing: Optional[bool] = None
    pixel_missing: Optional[bool] = None
    audit: AuditSignals


class JobStatus(BaseModel):
    id: str
    state: Literal["queued", "running", "done", "error"]
    progress: int
    message: str
    started_at: float
    finished_at: Optional[float] = None
    error: Optional[str] = None
    results_count: int = 0


@dataclass
class Job:
    id: str
    category: str
    city: str
    zone: Optional[str] = None
    state: str = "queued"
    progress: int = 0
    message: str = "Queued"
    started_at: float = field(default_factory=lambda: time.time())
    finished_at: Optional[float] = None
    error: Optional[str] = None
    results: List[BusinessResult] = field(default_factory=list)
    events: asyncio.Queue = field(default_factory=asyncio.Queue)
    site_html: Dict[int, str] = field(default_factory=dict)
    technical_audits: Dict[int, Dict[str, Any]] = field(default_factory=dict)

    async def emit(self, progress: int, message: str) -> None:
        self.progress = max(0, min(100, progress))
        self.message = message
        await self.events.put(
            {
                "progress": self.progress,
                "message": message,
                "state": self.state,
                "error": self.error,
                "results_count": len(self.results),
            }
        )


JOBS: Dict[str, Job] = {}

app = FastAPI(title="Lead Gen & Audit Backend", version="0.1.0")


def resource_path(*parts: str) -> str:
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(str(base), *parts)
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(repo_root, *parts)


_FRONTEND_OUT_DIR = resource_path("frontend", "out")
_HAS_FRONTEND_OUT = os.path.isdir(_FRONTEND_OUT_DIR) and os.path.isfile(
    os.path.join(_FRONTEND_OUT_DIR, "index.html")
)

_allow_all = os.getenv("CORS_ALLOW_ALL", "1") == "1"

_demo_city = (os.getenv("DEMO_CITY") or "").strip()
_demo_categories_raw = (os.getenv("DEMO_CATEGORIES") or "").strip()
_demo_categories = [c.strip() for c in _demo_categories_raw.split(",") if c.strip()]
try:
    _demo_max_results = int((os.getenv("DEMO_MAX_RESULTS") or "0").strip() or "0")
except Exception:
    _demo_max_results = 0

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _allow_all else ["http://localhost:3000"],
    # IMPORTANT: browsers disallow '*' with credentials. For local standalone we don't need cookies.
    allow_credentials=False if _allow_all else True,
    allow_methods=["*"] ,
    allow_headers=["*"],
)


if _HAS_FRONTEND_OUT:
    app.mount(
        "/_next",
        StaticFiles(directory=os.path.join(_FRONTEND_OUT_DIR, "_next")),
        name="next-assets",
    )


PIXEL_PATTERNS = {
    "facebook": re.compile(r"fbevents\\.js", re.IGNORECASE),
    "tiktok": re.compile(r"tiktok\\.com/i18n/pixel", re.IGNORECASE),
    "gtm": re.compile(r"googletagmanager\\.com", re.IGNORECASE),
}


async def fetch_html(url: str) -> str:
    raise RuntimeError("fetch_html signature changed; use fetch_html_with_final_url")


async def fetch_html_with_final_url(url: str) -> Tuple[str, str]:
    timeout = httpx.Timeout(8.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False) as client:
        r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        return r.text, str(r.url)


async def fetch_html_with_final_url_and_status(
    url: str,
) -> Tuple[Optional[str], str, Optional[int], Optional[str], Optional[float]]:
    timeout = httpx.Timeout(15.0, connect=7.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False) as client:
        try:
            t0 = time.perf_counter()
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            status = int(getattr(r, "status_code", 0) or 0)
            final_url = str(r.url)
            elapsed_s: Optional[float] = None
            try:
                elapsed = getattr(r, "elapsed", None)
                if elapsed is not None:
                    elapsed_s = round(float(elapsed.total_seconds()), 2)
            except Exception:
                elapsed_s = None
            if elapsed_s is None:
                try:
                    elapsed_s = round(float(time.perf_counter() - t0), 2)
                except Exception:
                    elapsed_s = None
            # Return body even on errors (many sites serve an error page HTML)
            if status >= 400:
                return r.text, final_url, status, f"HTTP {status}", elapsed_s
            return r.text, final_url, status, None, elapsed_s
        except httpx.HTTPStatusError as e:
            try:
                status = int(getattr(e.response, "status_code", 0) or 0)
                final_url = str(getattr(e.response, "url", "") or url)
            except Exception:
                status = None
                final_url = url
            return None, final_url, status, f"HTTP {status}" if status else str(e), None
        except Exception as e:
            return None, url, None, str(e), None


def _coerce_date_to_iso(d: Any) -> Optional[str]:
    if d is None:
        return None
    if isinstance(d, list) and d:
        d = d[0]
    if isinstance(d, datetime):
        return d.date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    try:
        s = str(d).strip()
        return s or None
    except Exception:
        return None


def _extract_domain_from_url(url: str) -> Optional[str]:
    try:
        host = urlparse(url).hostname
        if not host:
            return None
        host = host.strip().lower()
        if host.startswith("www."):
            host = host[4:]
        return host or None
    except Exception:
        return None


async def whois_lookup_dates(final_url: str) -> Tuple[Optional[str], Optional[str]]:
    if _whois is None:
        return None, None
    domain = _extract_domain_from_url(final_url)
    if not domain:
        return None, None
    try:
        # Brutal timeout: python-whois can block on socket operations for ~20s.
        # asyncio.wait_for alone cannot stop a running thread; we also enforce a socket default timeout
        # and silence whois logger during the call.

        def _whois_call() -> Any:
            import socket
            import logging

            # Best-effort: enforce socket timeout for the lifetime of this call.
            prev_to = None
            try:
                prev_to = socket.getdefaulttimeout()
            except Exception:
                prev_to = None
            try:
                socket.setdefaulttimeout(2.0)
            except Exception:
                pass

            logger = logging.getLogger("whois.whois")
            prev_level = None
            try:
                prev_level = logger.level
                logger.setLevel(logging.CRITICAL)
            except Exception:
                prev_level = None

            try:
                return _whois.whois(domain)
            finally:
                try:
                    if prev_level is not None:
                        logger.setLevel(prev_level)
                except Exception:
                    pass
                try:
                    socket.setdefaulttimeout(prev_to)
                except Exception:
                    pass

        data = await asyncio.wait_for(asyncio.to_thread(_whois_call), timeout=2.5)
        created = _coerce_date_to_iso(getattr(data, "creation_date", None))
        expires = _coerce_date_to_iso(getattr(data, "expiration_date", None))
        return created, expires
    except (asyncio.TimeoutError, Exception):
        return None, None


def normalize_website(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    u = url.strip()
    if not u:
        return None
    if not u.startswith("http://") and not u.startswith("https://"):
        u = "https://" + u
    return u


def audit_from_html(html: str) -> AuditSignals:
    s = AuditSignals()
    if PIXEL_PATTERNS["facebook"].search(html):
        s.has_facebook_pixel = True
    if PIXEL_PATTERNS["tiktok"].search(html):
        s.has_tiktok_pixel = True
    if PIXEL_PATTERNS["gtm"].search(html):
        s.has_gtm = True

    soup = BeautifulSoup(html, "html.parser")

    has_insta = False
    try:
        if "instagram.com" in (html or "").lower():
            has_insta = True
    except Exception:
        pass
    try:
        for a in soup.select("a[href]"):
            href = (a.get("href") or "").strip().lower()
            if "instagram.com" in href:
                has_insta = True
                break
    except Exception:
        has_insta = False
    s.missing_instagram = not has_insta

    viewport = soup.find("meta", attrs={"name": re.compile(r"viewport", re.IGNORECASE)})
    s.is_mobile_responsive = viewport is not None
    return s


def detect_tech_stack(html: str) -> str:
    lower = (html or "").lower()
    # WordPress
    if (
        "/wp-content/" in lower
        or "/wp-includes/" in lower
        or 'name="generator" content="wordpress' in lower
        or "wp-emoji-release.min.js" in lower
    ):
        return "WordPress"

    # Wix
    if (
        "wix.com" in lower
        or "x-wix-request-id" in lower
        or "wixsite" in lower
        or "wixdata" in lower
        or "wix-ui" in lower
        or "id=\"comp-" in lower
        or "id='comp-" in lower
        or " comp-" in lower
    ):
        return "Wix"

    # Shopify
    if (
        "cdn.shopify.com" in lower
        or "shopify.theme" in lower
        or "shopify" in lower
        or "myshopify.com" in lower
        or "shopifyanalytics" in lower
    ):
        return "Shopify"

    # Squarespace
    if "squarespace" in lower or "static1.squarespace.com" in lower:
        return "Squarespace"
    return "Custom HTML"


def extract_email_from_html(html: str) -> Optional[str]:
    try:
        soup = BeautifulSoup(html, "html.parser")
        email_re = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
        banned_suffixes = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")
        for a in soup.select('a[href^="mailto:"]'):
            href = a.get("href") or ""
            if not href.lower().startswith("mailto:"):
                continue
            value = href.split(":", 1)[1].strip()
            value = value.split("?", 1)[0].strip()
            value = value.strip("<>\"' ")
            if not value:
                continue
            m = email_re.search(value)
            if not m:
                continue
            candidate = (m.group(0) or "").strip()
            cand_l = candidate.lower()
            if cand_l.endswith(banned_suffixes):
                continue
            if cand_l.startswith("sentry@"):  # common false positive
                continue
            return candidate
        return None
    except Exception:
        return None


async def audit_website(website: str) -> Tuple[AuditSignals, Optional[str]]:
    website = normalize_website(website) or website
    signals = AuditSignals()
    for attempt in range(2):
        try:
            html, final_url = await fetch_html_with_final_url(website)
            parsed = audit_from_html(html)
            parsed.has_ssl = final_url.lower().startswith("https://")
            email = extract_email_from_html(html)
            return parsed, email
        except Exception:
            if attempt == 0:
                await asyncio.sleep(0.6)
                continue
            return signals, None


async def audit_website_with_status(
    website: str,
) -> Tuple[
    AuditSignals,
    str,
    Optional[float],
    Optional[str],
    Optional[str],
    Optional[int],
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[int],
    Optional[str],
]:
    website = normalize_website(website) or website
    signals = AuditSignals()
    for attempt in range(2):
        try:
            html, final_url, status, err, elapsed_s = await fetch_html_with_final_url_and_status(website)
            if html is None:
                created, expires = await whois_lookup_dates(final_url)
                return (
                    signals,
                    "Custom HTML",
                    elapsed_s,
                    created,
                    expires,
                    None,
                    status,
                    ("Timeout/Unreachable" if (err or "").strip().lower() in {"timeout", "audit failed"} else err),
                    None,
                    None,
                    None,
                )
            # Basic hint/line extraction (best-effort; HTML is not always formatted)
            hint = None
            line = None
            try:
                lower = html.lower()
                if err and isinstance(status, int) and status >= 400:
                    hint = f"HTTP {status}"
                    # try to highlight the most descriptive part of the error page
                    needles = [
                        "<title>",
                        "<h1",
                        "404",
                        "not found",
                        "pagina non trovata",
                        "500",
                        "server error",
                        "bad gateway",
                        "service unavailable",
                        "nginx",
                        "cloudflare",
                        "error",
                    ]
                    idx = -1
                    for n in needles:
                        idx = lower.find(n)
                        if idx >= 0:
                            break
                    if idx >= 0:
                        line = html[:idx].count("\n") + 1
                    else:
                        line = 1
                elif "uncaught" in lower:
                    hint = "Uncaught"
                elif "failed to load resource" in lower:
                    hint = "Failed to load resource"
                if hint:
                    idx = lower.find(hint.lower())
                    if idx >= 0:
                        line = html[:idx].count("\n") + 1
            except Exception:
                hint = None
                line = None
            parsed = audit_from_html(html)
            parsed.has_ssl = final_url.lower().startswith("https://")
            email = extract_email_from_html(html)
            if not email:
                try:
                    email = await deep_scrape_email_from_website(final_url, html_home=html)
                except Exception:
                    email = None
            tech_stack = detect_tech_stack(html)
            created, expires = await whois_lookup_dates(final_url)
            return parsed, tech_stack, elapsed_s, created, expires, email, status, err, html, line, hint
        except Exception as e:
            if attempt == 0:
                await asyncio.sleep(0.6)
                continue
            return signals, "Custom HTML", None, None, None, None, None, "Timeout/Unreachable", None, None, None


def _compose_maps_query(category: str, city: str, zone: Optional[str]) -> str:
    z = (zone or "").strip()
    if not z or z.lower() == "tutta la città".lower():
        return f"{category} {city}"
    return f"{category} {city} {z}"


async def scrape_google_maps_playwright(category: str, city: str, zone: Optional[str] = None, on_result=None) -> List[Dict[str, Any]]:
    # NOTE: On Windows + Python 3.13, Playwright async API may fail with
    # NotImplementedError due to asyncio subprocess limitations.
    # Using sync_playwright inside a thread avoids asyncio subprocess entirely.
    if sync_playwright is None:
        raise RuntimeError("Playwright not installed")

    return await asyncio.to_thread(_scrape_google_maps_sync, category, city, zone, on_result=on_result)


async def scrape_google_maps_playwright_with_alarm(
    category: str, city: str, zone: Optional[str], alarm_cb
) -> List[Dict[str, Any]]:
    if sync_playwright is None:
        raise RuntimeError("Playwright not installed")
    return await asyncio.to_thread(_scrape_google_maps_sync, category, city, zone, alarm_cb)


def _scrape_google_maps_sync(category: str, city: str, zone: Optional[str] = None, alarm_cb=None, on_result=None) -> List[Dict[str, Any]]:
    base_query = _compose_maps_query(category, city, zone)
    query_variants = [base_query, f"{base_query}, Italia"]
    last_error: Optional[str] = None
    started = time.time()

    # IMPORTANT: a global cross-run lead history can dramatically reduce the number of returned
    # results (it will skip items already seen in previous runs), making it impossible to reach
    # cap_new (e.g. 60) even when Maps has plenty of results. Keep it opt-in.
    lead_history: set[str] = set()
    try:
        if (os.getenv("KEEP_LEAD_HISTORY") or "").strip() in {"1", "true", "TRUE", "yes", "YES"}:
            lead_history = _load_lead_history()
    except Exception:
        lead_history = set()

    with sync_playwright() as p:
        for attempt, q in enumerate(query_variants, start=1):
            results: List[Dict[str, Any]] = []
            try:
                browser = p.chromium.launch(
                    headless=True,
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

                def _alarm(url: str, err: str) -> None:
                    try:
                        msg = f"[ALLARME SITO] -> {url} -> {err}"
                        if Fore is not None and Style is not None:
                            print(Style.BRIGHT + Fore.RED + msg + Style.RESET_ALL)
                        else:
                            print("\033[91m\033[1m" + msg + "\033[0m")
                        if alarm_cb is not None:
                            try:
                                alarm_cb(url, err)
                            except Exception:
                                pass
                    except Exception:
                        pass

                def _attach_passive_error_listeners() -> None:
                    try:
                        def should_emit(text: str) -> bool:
                            try:
                                t = (text or "").strip()
                                if not t:
                                    return False
                                if t in {"_.lp", "_.kb"}:
                                    return False
                                if "Failed to load resource" in t:
                                    return True
                                if "Uncaught" in t:
                                    return True
                                return False
                            except Exception:
                                return False

                        def on_console(message) -> None:
                            try:
                                if getattr(message, "type", None) and message.type == "error":
                                    if should_emit(getattr(message, "text", "") or ""):
                                        _alarm(page.url or "(unknown)", message.text)
                            except Exception:
                                pass

                        def on_pageerror(exc) -> None:
                            try:
                                s = str(exc)
                                if should_emit(s):
                                    _alarm(page.url or "(unknown)", s)
                            except Exception:
                                pass

                        def on_response(response) -> None:
                            try:
                                status = int(getattr(response, "status", 0) or 0)
                                if status in (404, 429, 500) or status >= 500:
                                    _alarm(str(getattr(response, "url", "(unknown)")), f"HTTP {status}")
                            except Exception:
                                pass

                        page.on("console", on_console)
                        page.on("pageerror", on_pageerror)
                        page.on("response", on_response)
                    except Exception:
                        pass

                _attach_passive_error_listeners()
                page.set_default_timeout(20000)
                try:
                    page.set_extra_http_headers({"Accept-Language": "it-IT,it;q=0.9,en;q=0.8"})
                except Exception:
                    pass

                def try_handle_consent() -> None:
                    texts = [
                        "Accetta tutto",
                        "Rifiuta tutto",
                        "I agree",
                        "Accept all",
                        "Reject all",
                    ]

                    def click_in_frame(frame) -> bool:
                        # Try common Google consent button id as well
                        try:
                            btn_css = frame.locator('#L2AGLb')
                            if btn_css.count() and btn_css.is_visible():
                                btn_css.click(timeout=2000)
                                page.wait_for_timeout(600)
                                return True
                        except Exception:
                            pass
                        for t in texts:
                            try:
                                btn = frame.get_by_role("button", name=t).first
                                if btn.count() and btn.is_visible():
                                    btn.click(timeout=2500)
                                    page.wait_for_timeout(700)
                                    return True
                            except Exception:
                                continue
                        return False

                    try:
                        if click_in_frame(page):
                            return
                    except Exception:
                        pass

                    for fr in page.frames:
                        try:
                            if fr == page.main_frame:
                                continue
                            if click_in_frame(fr):
                                return
                        except Exception:
                            continue

                # Reset search context to avoid location stickiness across different cities.
                # 1) Go to Maps home
                try:
                    page.goto("https://www.google.com/maps?hl=it&gl=it", wait_until="domcontentloaded", timeout=55000)
                except Exception:
                    pass
                page.wait_for_timeout(1400)
                # Consent banner can appear late and block the UI; try multiple times.
                try_handle_consent()
                page.wait_for_timeout(700)
                try_handle_consent()
                # Some popups can be dismissed via Escape.
                try:
                    page.keyboard.press("Escape")
                except Exception:
                    pass

                # 2) Clear the searchbox and run the query via UI (more reliable than relying on previous map state)
                try:
                    search_input = None
                    for css in (
                        "input#searchboxinput",
                        "input[aria-label*='Cerca']",
                        "input[aria-label*='Search']",
                    ):
                        try:
                            el = page.locator(css).first
                            if el.count() and el.is_visible():
                                search_input = el
                                break
                        except Exception:
                            continue

                    if search_input is not None:
                        try:
                            search_input.click(timeout=2500)
                        except Exception:
                            pass
                        try:
                            search_input.fill("", timeout=2500)
                        except Exception:
                            try:
                                page.keyboard.press("Control+A")
                                page.keyboard.press("Backspace")
                            except Exception:
                                pass

                        try:
                            search_input.fill(q, timeout=3500)
                        except Exception:
                            try:
                                page.keyboard.type(q, delay=12)
                            except Exception:
                                pass

                        try:
                            page.keyboard.press("Enter")
                        except Exception:
                            pass
                except Exception:
                    pass

                # 3) Verify city/location and force refresh with direct URL if not matching.
                search_url = f"https://www.google.com/maps/search/{quote(q)}?hl=it&gl=it&entry=ttu"
                expected_city = (city or "").strip().lower()
                page.wait_for_timeout(5000)
                try:
                    ok = False
                    try:
                        if expected_city and expected_city in (page.url or "").lower():
                            ok = True
                    except Exception:
                        ok = False
                    if not ok:
                        try:
                            v = ""
                            try:
                                v = (page.locator("input#searchboxinput").first.input_value(timeout=1200) or "").lower()
                            except Exception:
                                v = ""
                            if expected_city and expected_city in v:
                                ok = True
                        except Exception:
                            ok = False

                    if not ok:
                        try:
                            page.goto(search_url, wait_until="domcontentloaded", timeout=55000)
                            page.wait_for_timeout(1800)
                            try_handle_consent()
                            page.wait_for_timeout(700)
                            try_handle_consent()
                            try:
                                page.keyboard.press("Escape")
                            except Exception:
                                pass
                        except Exception:
                            pass
                except Exception:
                    pass

                # Maps can be slow; wait a bit more before checking result counts.
                page.wait_for_timeout(3000)

                # Guard rail: if we're close to the global 240s timeout, bail out early.
                if time.time() - started > 210:
                    context.close()
                    browser.close()
                    return results

                # Wait for either results or any blocking state
                feed = page.locator('div[role="feed"]').first
                try:
                    feed.wait_for(state="visible", timeout=30000)
                except Exception:
                    pass

                # Use flexible selectors scoped to the feed (avoid picking unrelated elements on the page).
                cards = feed.locator('div[role="article"]')
                alt_cards = feed.locator('div.Nv2PK')
                place_links = feed.locator('a[href*="/maps/place"]')

                for _ in range(24):
                    try_handle_consent()
                    try:
                        page.keyboard.press("Escape")
                    except Exception:
                        pass

                    if cards.count() > 0 or alt_cards.count() > 0 or place_links.count() > 0:
                        break
                    # Sometimes feed/results appear later; give it a bit more time overall (~20s)
                    page.wait_for_timeout(900)

                # Prefer role=article, otherwise fallback to Nv2PK, otherwise use place links.
                if cards.count() == 0 and alt_cards.count() > 0:
                    cards = alt_cards
                if cards.count() == 0 and place_links.count() > 0:
                    # Use the link list as a last resort indicator that results exist.
                    cards = place_links

                if cards.count() == 0:
                    html = page.content().lower()
                    if "unusual traffic" in html or "captcha" in html:
                        last_error = (
                            "Google blocked the request (captcha/unusual traffic). Try again later or from another network."
                        )
                    else:
                        last_error = (
                            "Google Maps returned 0 results. Trying a slightly different query or city may help."
                        )
                    context.close()
                    browser.close()
                    # Retry with next variant if available
                    if attempt < len(query_variants):
                        time.sleep(1.0)
                        continue
                    raise RuntimeError(last_error)

                # Scroll feed to load more results
                # Build a larger pool to bypass lazy-loading, then shuffle and sample for variety.
                pool_target = 120
                cap_new = 500
                if _demo_max_results > 0:
                    cap_new = max(cap_new, _demo_max_results)
                pool_target = max(pool_target, cap_new, 120)

                def _scroll_once() -> None:
                    try:
                        feed.evaluate("(el) => { el.scrollBy(0, 1400); }")
                    except Exception:
                        try:
                            page.mouse.wheel(0, 1200)
                        except Exception:
                            pass
                    page.wait_for_timeout(350)

                def _wait_results_stable(timeout_ms: int = 6500) -> None:
                    # Best-effort: wait for Maps loading spinners to disappear and for titles to be present.
                    # On some locales the spinner is role=progressbar.
                    try:
                        page.locator('div[role="progressbar"]').first.wait_for(state="hidden", timeout=timeout_ms)
                    except Exception:
                        pass
                    try:
                        # Ensure at least one business title is visible in the feed.
                        feed.locator('.fontHeadlineSmall').first.wait_for(state="visible", timeout=timeout_ms)
                    except Exception:
                        pass

                def _auto_scroll_pool() -> None:
                    # Try to load as many results as possible in the sidebar.
                    seen_hrefs: set = set()
                    last_seen = 0
                    stagnant = 0
                    max_rounds = max(80, min(200, pool_target + 40))  # more scroll rounds for larger targets
                    scroll_timeout_s = max(240, pool_target * 2)
                    for ri in range(max_rounds):
                        if time.time() - started > scroll_timeout_s:
                            break
                        try:
                            _wait_results_stable(timeout_ms=4500)
                        except Exception:
                            pass
                        # IMPORTANT: Google Maps result list is often virtualized (DOM count stays ~10-15).
                        # We therefore track unique place hrefs while scrolling.
                        try:
                            hrefs = feed.evaluate(
                                "(el) => Array.from(el.querySelectorAll('a.hfpxzc')).map(a => a.href).filter(Boolean)"
                            )
                            if isinstance(hrefs, list):
                                for h in hrefs:
                                    try:
                                        hs = str(h).strip()
                                        if hs:
                                            seen_hrefs.add(hs)
                                    except Exception:
                                        continue
                        except Exception:
                            pass

                        if len(seen_hrefs) >= pool_target:
                            break

                        if len(seen_hrefs) <= last_seen:
                            stagnant += 1
                        else:
                            stagnant = 0
                        if stagnant >= 6:
                            break
                        last_seen = len(seen_hrefs)

                        try:
                            if ri % 5 == 0:
                                print(f"[maps] Sto vedendo {len(seen_hrefs)} elementi (target={pool_target})")
                        except Exception:
                            pass

                        try:
                            feed.evaluate("(el) => { el.scrollTo(0, el.scrollHeight); }")
                        except Exception:
                            try:
                                page.keyboard.press("PageDown")
                            except Exception:
                                _scroll_once()
                        page.wait_for_timeout(1700)
                        try:
                            _wait_results_stable(timeout_ms=6500)
                        except Exception:
                            pass

                    return list(seen_hrefs)

                # Pre-load some cards
                for _ in range(15):
                    _scroll_once()

                try:
                    _wait_results_stable(timeout_ms=6500)
                except Exception:
                    pass

                try:
                    place_hrefs_pool = _auto_scroll_pool() or []
                except Exception:
                    place_hrefs_pool = []

                def _normalize_phone_text(value: Optional[str]) -> Optional[str]:
                    if not value:
                        return None
                    v = " ".join(str(value).split())
                    v = re.sub(r"^telefono\s*:??\s*", "", v, flags=re.IGNORECASE)
                    v = v.strip()
                    return v or None

                def _extract_rating_reviews_best_effort(base) -> Tuple[Optional[float], int]:
                    # Anti-crash: if selectors change or data is missing, return defaults.
                    rating_val: Optional[float] = None
                    reviews_val: int = 0
                    try:
                        # Common Maps selectors in the detail panel
                        candidates_rating = [
                            "div.F7nice span.MW4etd",
                            "span.MW4etd",
                            "span[aria-label*='stelle']",
                            "span[aria-label*='stars']",
                        ]
                        for css in candidates_rating:
                            try:
                                t = (base.locator(css).first.text_content(timeout=900) or "").strip()
                                if not t:
                                    continue
                                t = t.replace(",", ".")
                                m = re.search(r"\d+(?:\.\d+)?", t)
                                if m:
                                    rating_val = float(m.group(0))
                                    break
                            except Exception:
                                continue

                        candidates_reviews = [
                            "div.F7nice span.UY7F9",
                            "span.UY7F9",
                            "button[jsaction*='reviews']",
                            "a[href*='reviews']",
                        ]
                        for css in candidates_reviews:
                            try:
                                t = (base.locator(css).first.text_content(timeout=900) or "").strip()
                                if not t:
                                    continue
                                # e.g. "(123)" or "123 recensioni"
                                t = t.replace(".", "")
                                m = re.search(r"\d+", t)
                                if m:
                                    reviews_val = int(m.group(0))
                                    break
                            except Exception:
                                continue
                    except Exception:
                        rating_val = None
                        reviews_val = 0
                    return rating_val, reviews_val

                def _extract_rating_reviews_from_card_best_effort(card) -> Tuple[Optional[float], int]:
                    # IMPORTANT: Must be scoped to the CURRENT result node to avoid repeating the first value.
                    rating_val: Optional[float] = None
                    reviews_val: int = 0
                    try:
                        try:
                            aria = (card.get_attribute("aria-label") or "").strip()
                        except Exception:
                            aria = ""
                        if aria:
                            # Examples (IT/EN): "4,5 stelle e 841 recensioni", "4.5 stars 841 reviews"
                            a = aria.replace(",", ".")
                            m_r = re.search(r"(\d+(?:\.\d+)?)\s*(?:stelle|stars)", a, flags=re.IGNORECASE)
                            if m_r:
                                try:
                                    rating_val = float(m_r.group(1))
                                except Exception:
                                    rating_val = None
                            m_c = re.search(r"(\d[\d\.]*)\s*(?:recensioni|reviews)", a, flags=re.IGNORECASE)
                            if m_c:
                                try:
                                    reviews_val = int(m_c.group(1).replace(".", ""))
                                except Exception:
                                    reviews_val = 0

                        # Fallback: common spans inside the card itself (works for Nv2PK blocks)
                        if rating_val is None:
                            try:
                                t = (card.locator("span.MW4etd").first.text_content(timeout=700) or "").strip()
                                t = t.replace(",", ".")
                                m = re.search(r"\d+(?:\.\d+)?", t)
                                if m:
                                    rating_val = float(m.group(0))
                            except Exception:
                                pass
                        if reviews_val == 0:
                            try:
                                t = (card.locator("span.UY7F9").first.text_content(timeout=700) or "").strip()
                                t = t.replace(".", "")
                                m = re.search(r"\d+", t)
                                if m:
                                    reviews_val = int(m.group(0))
                            except Exception:
                                pass
                    except Exception:
                        rating_val = None
                        reviews_val = 0
                    return rating_val, reviews_val

                def _extract_phone_best_effort() -> Optional[str]:
                    # Use page-level locators on the currently opened details panel.
                    # IMPORTANT: keep per-iteration resets to avoid bleeding.
                    try:
                        v = page.locator('button[data-item-id^="phone"]').first.text_content(timeout=1700)
                        nv = _normalize_phone_text(v)
                        if nv:
                            return nv
                    except Exception:
                        pass

                    # Fallback: tel: links (sometimes present in the details panel)
                    try:
                        href = page.locator('a[href^="tel:"]').first.get_attribute("href", timeout=1400)
                        if href:
                            hv = href.split(":", 1)[1]
                            hv = hv.split("?", 1)[0]
                            nv = _normalize_phone_text(hv)
                            if nv:
                                return nv
                    except Exception:
                        pass

                    return None

                def _extract_website_best_effort() -> Optional[str]:
                    # Primary selector (classic Maps detail panel)
                    try:
                        href = page.locator('a[data-item-id="authority"]').first.get_attribute(
                            "href", timeout=1700
                        )
                        if href:
                            return href
                    except Exception:
                        pass

                    # Fallbacks: aria-label based (IT/EN)
                    candidates = [
                        'a[aria-label^="Sito"]',
                        'a[aria-label^="Website"]',
                        'a[aria-label*="Sito web"]',
                        'a[href^="http"]',
                    ]
                    for css in candidates:
                        try:
                            el = page.locator(css).first
                            href = el.get_attribute("href", timeout=900)
                            if href and href.startswith("http"):
                                # Avoid returning Google internal links
                                if "google.com/maps" not in href:
                                    return href
                        except Exception:
                            continue
                    return None

                # Recompute final pool and shuffle indices for variety.
                try:
                    primary_cards = feed.locator('div[role="article"]')
                    alt_cards = feed.locator('div.Nv2PK')
                    cards = primary_cards if primary_cards.count() > 0 else alt_cards
                except Exception:
                    cards = feed.locator('div.Nv2PK')

                pool_count = 0
                try:
                    pool_count = int(len(place_hrefs_pool)) if place_hrefs_pool else int(cards.count())
                except Exception:
                    pool_count = 0
                # Extract results using scroll-pagination.
                # Rationale: Maps result list is virtualized; many entries are not present in the DOM at the end.
                seen_names: set = set()
                stagnant_rounds = 0
                last_results_len = len(results)
                max_extract_rounds = 60
                for ri in range(max_extract_rounds):
                    if len(results) >= cap_new:
                        break
                    if time.time() - started > 420:
                        break

                    try:
                        _wait_results_stable(timeout_ms=6500)
                    except Exception:
                        pass

                    try:
                        primary_cards = feed.locator('div[role="article"]')
                        alt_cards2 = feed.locator('div.Nv2PK')
                        active_cards = primary_cards if primary_cards.count() > 0 else alt_cards2
                        visible_count = int(active_cards.count())
                    except Exception:
                        active_cards = cards
                        try:
                            visible_count = int(active_cards.count())
                        except Exception:
                            visible_count = 0

                    try:
                        print(f"[maps] Round {ri+1}: cards visibili={visible_count} | results={len(results)}/{cap_new}")
                    except Exception:
                        pass

                    for idx in range(visible_count):
                        if len(results) >= cap_new:
                            break
                        if time.time() - started > 420:
                            break

                        card = active_cards.nth(idx)

                        try:
                            name = (
                                card.locator(".fontHeadlineSmall").first.text_content(timeout=1500) or ""
                            ).strip()
                        except Exception:
                            name = ""
                            try:
                                al = (card.get_attribute("aria-label", timeout=900) or "").strip()
                                if al:
                                    name = al
                            except Exception:
                                name = ""

                        if not name:
                            continue

                        key = name.strip().lower()
                        if key in seen_names:
                            continue
                        seen_names.add(key)

                        # Rating/reviews MUST be read from the current card node, not from the page.
                        current_rating: Optional[float] = None
                        current_reviews: int = 0
                        try:
                            current_rating, current_reviews = _extract_rating_reviews_from_card_best_effort(card)
                        except Exception:
                            current_rating, current_reviews = None, 0

                        try:
                            card.click()
                            page.wait_for_timeout(2500)
                        except Exception:
                            pass

                        # Best-effort: wait for the details panel title to reflect the clicked business
                        try:
                            panel_title = page.locator("h1.DUwDvf").first
                            for _ in range(5):
                                try:
                                    t = (panel_title.text_content(timeout=700) or "").strip()
                                except Exception:
                                    t = ""
                                if t and name and t.lower() == name.lower():
                                    break
                                page.wait_for_timeout(300)
                        except Exception:
                            pass

                        # Best-effort: wait for website link to appear in the details panel.
                        try:
                            page.locator('a[data-item-id="authority"]').first.wait_for(state="attached", timeout=7000)
                        except Exception:
                            pass

                        is_claimed: Optional[bool] = None
                        try:
                            claim_texts = [
                                "rivendica questa attività",
                                "rivendica questa azienda",
                                "claim this business",
                                "claim this business profile",
                            ]
                            panel = page.locator('div[role="main"]').first
                            panel_text = ""
                            try:
                                panel_text = (panel.inner_text(timeout=1200) or "").lower()
                            except Exception:
                                panel_text = ""

                            found_claim = False
                            if panel_text:
                                for t in claim_texts:
                                    if t in panel_text:
                                        found_claim = True
                                        break

                            is_claimed = False if found_claim else True
                        except Exception:
                            is_claimed = None

                        address: Optional[str] = None
                        try:
                            address = page.locator('button[data-item-id="address"]').first.text_content(timeout=1500)
                        except Exception:
                            address = None

                        # Location integrity: discard leads whose address does not contain the expected city.
                        try:
                            expected_city = (city or "").strip().lower()
                            addr_l = (address or "").strip().lower()
                            if expected_city and addr_l and expected_city not in addr_l:
                                continue
                        except Exception:
                            pass

                        try:
                            phone = _extract_phone_best_effort()
                        except Exception:
                            phone = None

                        try:
                            website = _extract_website_best_effort()
                        except Exception:
                            website = None

                        try:
                            print(f"DEBUG MAPS: {name} -> Rating: {current_rating}, Recensioni: {current_reviews}")
                        except Exception:
                            pass

                        phone_for_id = normalize_phone_italy(phone.strip()) if phone else None
                        lead_id = _make_lead_id(name, address.strip() if address else None, phone_for_id)
                        if lead_id in lead_history:
                            print("Già presente in storico - SALTO")
                            continue

                        fb = None
                        ig = None
                        results.append(
                            {
                                "business_name": name,
                                "address": address.strip() if address else None,
                                "phone": normalize_phone_italy(phone.strip()) if phone else None,
                                "website": website,
                                "rating": current_rating,
                                "reviews_count": current_reviews,
                                "is_claimed": is_claimed,
                                "facebook": fb,
                                "instagram": ig,
                            }
                        )
                        if on_result:
                            try:
                                on_result(results[-1])
                            except Exception:
                                pass

                        page.wait_for_timeout(220)

                    # After consuming current visible cards, scroll to load new ones.
                    try:
                        feed.evaluate("(el) => { el.scrollBy(0, 1600); }")
                    except Exception:
                        try:
                            page.mouse.wheel(0, 1400)
                        except Exception:
                            pass
                    page.wait_for_timeout(900)

                    try:
                        _wait_results_stable(timeout_ms=6500)
                    except Exception:
                        pass

                    if len(results) <= last_results_len:
                        stagnant_rounds += 1
                    else:
                        stagnant_rounds = 0
                        last_results_len = len(results)

                    if stagnant_rounds >= 6:
                        break

                try:
                    context.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass

                return results

            except Exception as e:
                try:
                    context.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass
                last_error = str(e) or last_error
                # Small backoff then next variant
                if attempt < len(query_variants):
                    time.sleep(1.0)
                    continue
                raise


async def run_job(job: Job) -> None:
    job.state = "running"
    await job.emit(3, "Scraping Maps...")

    try:
        loop = asyncio.get_running_loop()

        def alarm_cb(url: str, err: str) -> None:
            try:
                asyncio.run_coroutine_threadsafe(
                    job.events.put(
                        {
                            "type": "alarm",
                            "url": url,
                            "error": err,
                            "ts": time.time(),
                        }
                    ),
                    loop,
                )
            except Exception:
                pass

        raw = await scrape_google_maps_playwright_with_alarm(job.category, job.city, job.zone, alarm_cb)

        if not raw:
            raise RuntimeError("No results returned from Google Maps. Try a different query or city.")

        await job.emit(12, f"Trovate {len(raw)} attività. Avvio audit...")

        results: List[BusinessResult] = []
        total = max(1, len(raw))

        for i, item in enumerate(raw):
            name = item.get("business_name") or "Unknown"
            website = item.get("website")
            website_norm = normalize_website(website) if website else None

            # Normalize phone with strict Italy logic
            phone_norm = normalize_phone_italy(item.get("phone"))

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
                await job.emit(
                    12 + int((i / total) * 80),
                    f"Analizzando sito web di {name}...",
                )
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
                    ) = await asyncio.wait_for(audit_website_with_status(website_norm), timeout=25.0)
                except asyncio.TimeoutError:
                    audit, email = AuditSignals(), None
                    tech_stack = "Custom HTML"
                    load_speed_s = None
                    domain_creation_date = None
                    domain_expiration_date = None
                    website_http_status, website_error = None, "Timeout"
                    website_error_line, website_error_hint = None, "Timeout"
                website_status: Literal["HAS_WEBSITE", "MISSING_WEBSITE"] = "HAS_WEBSITE"
            else:
                audit = AuditSignals()
                email = None
                tech_stack = "Custom HTML"
                load_speed_s = None
                domain_creation_date = None
                domain_expiration_date = None
                website_status = "MISSING_WEBSITE"

            # Deep mobile scraping: if we have a website, try to find Italian mobile numbers
            # on home + /contatti (lightweight). Overwrite fixed/unknown phone if a mobile is found.
            if website_norm:
                try:
                    deep_mobile = await asyncio.wait_for(
                        deep_scrape_mobile_from_website(website_norm, website_html),
                        timeout=8.0,
                    )
                    if deep_mobile and (not phone_norm or not str(phone_norm).startswith("+393")):
                        phone_norm = deep_mobile
                except Exception:
                    pass

            if website_html:
                try:
                    # Cap to avoid huge memory usage (HTML can be very large)
                    job.site_html[i] = website_html[:200000]
                    website_has_html = True
                except Exception:
                    pass

            results.append(
                BusinessResult(
                    result_index=i,
                    business_name=name,
                    address=item.get("address"),
                    phone=phone_norm,
                    email=email,
                    website=website_norm,
                    website_status=website_status,
                    tech_stack=tech_stack,
                    load_speed_s=load_speed_s,
                    load_speed=None if load_speed_s is None else round(float(load_speed_s), 2),
                    domain_creation_date=domain_creation_date,
                    domain_expiration_date=domain_expiration_date,
                    website_http_status=website_http_status,
                    website_error=website_error,
                    website_has_html=website_has_html,
                    website_error_line=website_error_line,
                    website_error_hint=website_error_hint,
                    instagram_missing=bool(getattr(audit, "missing_instagram", False)),
                    tiktok_missing=not bool(getattr(audit, "has_tiktok_pixel", False)),
                    pixel_missing=not bool(getattr(audit, "has_facebook_pixel", False)),
                    audit=audit,
                )
            )
            if on_result:
                try:
                    on_result(results[-1])
                except Exception:
                    pass

            # Persist lead to history immediately after completing its audit.
            try:
                lead_id = item.get("lead_id")
                if not lead_id:
                    lead_id = _make_lead_id(name, item.get("address"), item.get("phone"))
                _append_lead_history(str(lead_id))
            except Exception:
                pass

            # Stream partial results so the UI can update in real-time.
            job.results = list(results)
            try:
                await job.emit(
                    12 + int(((i + 1) / total) * 80),
                    f"Audit in corso: {i + 1}/{len(raw)}",
                )
            except Exception:
                pass

        job.results = results
        job.state = "done"
        job.finished_at = time.time()
        await job.emit(100, "Audit completato. Risultati pronti.")
    except Exception as e:
        job.state = "error"
        job.finished_at = time.time()
        job.error = str(e)
        print("JOB ERROR:", job.error)
        print(traceback.format_exc())
        await job.emit(100, f"Errore: {job.error}")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs", response_model=JobStatus)
async def start_job(payload: StartJobRequest, background: BackgroundTasks, request: Request) -> JobStatus:
    if _demo_city:
        if payload.city.strip() != _demo_city:
            raise HTTPException(status_code=400, detail=f"DEMO: città consentita: {_demo_city}")
    if _demo_categories:
        if payload.category.strip() not in _demo_categories:
            raise HTTPException(
                status_code=400,
                detail=f"DEMO: categorie consentite: {', '.join(_demo_categories)}",
            )

    # Preferred path (production): enqueue into Supabase 'searches' table and let worker_supabase do the work.
    supabase = _get_supabase_client()
    if supabase is not None:
        try:
            header_user_id = (request.headers.get("x-user-id") or "").strip() or None
            user_id = (payload.user_id or "").strip() or header_user_id

            row = {
                "status": "pending",
                "category": payload.category,
                "location": payload.city,
                "results": None,
            }
            try:
                row["created_at"] = datetime.now(timezone.utc).isoformat()
            except Exception:
                pass
            if payload.zone:
                row["zone"] = payload.zone
            if user_id:
                row["user_id"] = user_id
                row["status"] = "pending"

            resp = supabase.table("searches").insert(row).execute()
            data = getattr(resp, "data", None)
            if isinstance(data, list) and data:
                return _map_search_row_to_job_status(data[0])
            raise RuntimeError("Supabase insert returned empty data")
        except Exception as e:
            # Fall back to in-memory behavior in case of any Supabase issue.
            try:
                print("[backend] WARNING: enqueue Supabase fallita, fallback in-memory:", str(e))
            except Exception:
                pass

    # Fallback path (dev/standalone): run job in-process and store results in memory
    job_id = str(uuid.uuid4())
    job = Job(id=job_id, category=payload.category, city=payload.city, zone=payload.zone)
    JOBS[job_id] = job
    background.add_task(run_job, job)

    return JobStatus(
        id=job.id,
        state=job.state,
        progress=job.progress,
        message=job.message,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error=job.error,
    )


@app.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str) -> JobStatus:
    supabase = _get_supabase_client()
    if supabase is not None:
        try:
            resp = supabase.table("searches").select("*").eq("id", job_id).limit(1).execute()
            rows = getattr(resp, "data", None) or []
            if rows:
                return _map_search_row_to_job_status(rows[0])
        except Exception:
            pass

    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatus(
        id=job.id,
        state=job.state,
        progress=job.progress,
        message=job.message,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error=job.error,
        results_count=len(job.results),
    )


@app.get("/jobs/{job_id}/results", response_model=List[BusinessResult])
async def get_results(job_id: str) -> List[BusinessResult]:
    supabase = _get_supabase_client()
    if supabase is not None:
        try:
            resp = (
                supabase.table("searches")
                .select("status,results")
                .eq("id", job_id)
                .limit(1)
                .execute()
            )
            rows = getattr(resp, "data", None) or []
            if not rows:
                raise HTTPException(status_code=404, detail="Job not found")

            row = rows[0] or {}
            status = str(row.get("status") or "").strip().lower()
            if status != "completed":
                # Keep API consistent: results are only available when completed.
                raise HTTPException(status_code=409, detail=f"Job not completed (status={status})")

            results = row.get("results")
            if isinstance(results, list):
                return results  # type: ignore[return-value]
            return []
        except HTTPException:
            raise
        except Exception:
            pass

    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.results


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def gen() -> AsyncGenerator[bytes, None]:
        yield b"retry: 1000\n\n"
        # Send an initial snapshot immediately.
        init_payload = json.dumps(
            {
                "progress": job.progress,
                "message": job.message,
                "state": job.state,
                "error": job.error,
                "results_count": len(job.results),
            },
            ensure_ascii=False,
        )
        yield f"data: {init_payload}\n\n".encode("utf-8")
        while True:
            try:
                event = await asyncio.wait_for(job.events.get(), timeout=10.0)
            except asyncio.TimeoutError:
                # Keep-alive comment line (SSE clients ignore it)
                yield b": keep-alive\n\n"
                continue
            payload = json.dumps(event, ensure_ascii=False)
            data = f"data: {payload}\n\n"
            yield data.encode("utf-8")
            if job.state in {"done", "error"} and job.progress >= 100:
                break

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/jobs/{job_id}/export.csv")
async def export_csv(job_id: str) -> Response:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    def _classify_phone_type(phone: Optional[str]) -> str:
        raw = (phone or "").strip()
        if not raw:
            return "☎️ FISSO"
        v = raw
        v = v.replace(" ", "")
        v = v.replace("-", "")
        v = v.replace("(", "")
        v = v.replace(")", "")
        if v.startswith("+39"):
            v = v[3:]
        if v.startswith("0039"):
            v = v[4:]
        v = re.sub(r"\D+", "", v)
        if v.startswith("3"):
            return "📱 CELLULARE"
        return "☎️ FISSO"

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Business Name",
            "Address",
            "Phone",
            "TIPO_NUMERO",
            "Website",
            "Website Status",
            "Tech Stack",
            "Load Speed (s)",
            "Domain Created",
            "Domain Expires",
            "Website HTTP Status",
            "Website Error",
            "Has SSL",
            "Mobile Responsive",
            "Facebook Pixel",
            "TikTok Pixel",
            "GTM",
        ]
    )

    def _sort_key(r: BusinessResult) -> Tuple[int, int]:
        t = _classify_phone_type(getattr(r, "phone", None))
        pri = 0 if t == "📱 CELLULARE" else 1
        return (pri, int(getattr(r, "result_index", 0) or 0))

    for r in sorted(list(job.results), key=_sort_key):
        phone_type = _classify_phone_type(getattr(r, "phone", None))
        writer.writerow(
            [
                r.business_name,
                r.address or "",
                r.phone or "",
                phone_type,
                r.website or "",
                r.website_status,
                getattr(r, "tech_stack", "Custom HTML"),
                "" if getattr(r, "load_speed_s", None) is None else str(getattr(r, "load_speed_s", "")),
                getattr(r, "domain_creation_date", "") or "",
                getattr(r, "domain_expiration_date", "") or "",
                str(r.website_http_status or ""),
                r.website_error or "",
                "YES" if r.audit.has_ssl else "NO",
                "YES" if r.audit.is_mobile_responsive else "NO",
                "YES" if r.audit.has_facebook_pixel else "NO",
                "YES" if r.audit.has_tiktok_pixel else "NO",
                "YES" if r.audit.has_gtm else "NO",
            ]
        )

    data = output.getvalue().encode("utf-8")
    filename = f"audit_{job.category}_{job.city}.csv".replace(" ", "_")

    return Response(
        content=data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/jobs/{job_id}/sites/{result_index}/html")
async def view_site_html(job_id: str, result_index: int, line: Optional[int] = None) -> Response:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    src = job.site_html.get(result_index)
    if not src:
        raise HTTPException(status_code=404, detail="HTML not available for this result")

    lines = src.splitlines()
    highlight = None
    try:
        if line is not None and int(line) > 0:
            highlight = int(line)
    except Exception:
        highlight = None

    out: List[str] = []
    out.append("<html><head><meta charset='utf-8'>")
    out.append("<title>HTML View</title>")
    out.append(
        "<style>body{font-family:ui-monospace,Consolas,monospace;background:#0b0b0c;color:#eaeaea;}"
        ".wrap{max-width:1200px;margin:24px auto;padding:0 16px;}"
        ".line{white-space:pre-wrap;word-break:break-word;border-bottom:1px solid #1b1b1c;padding:2px 0;}"
        ".n{display:inline-block;width:64px;color:#8a8a8a;}"
        ".hl{background:rgba(255,0,0,0.12);}"
        "a{color:#9bd;}"
        "</style>"
    )
    out.append("</head><body><div class='wrap'>")
    if highlight:
        out.append(f"<div style='margin-bottom:12px'>Highlight line: <a href='#L{highlight}'>L{highlight}</a></div>")
    for i, l in enumerate(lines, start=1):
        cls = "line hl" if highlight == i else "line"
        out.append(
            f"<div id='L{i}' class='{cls}'><span class='n'>{i:>6}</span>{_html.escape(l)}</div>"
        )
    out.append("</div></body></html>")

    return Response(content="\n".join(out).encode("utf-8"), media_type="text/html")


@app.get("/jobs/{job_id}/results/{result_index}/technical-audit")
async def technical_audit(job_id: str, result_index: int) -> Dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        idx = int(result_index)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid result_index")

    if idx in job.technical_audits:
        return job.technical_audits[idx]

    if idx < 0 or idx >= len(job.results):
        raise HTTPException(status_code=404, detail="Result not found")

    row = job.results[idx]
    if row.website_status != "HAS_WEBSITE" or not row.website:
        raise HTTPException(status_code=400, detail="No website to audit")

    try:
        report = await asyncio.to_thread(run_technical_audit, row.website)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Technical audit failed: {str(e)}")

    job.technical_audits[idx] = report
    return report


@app.get("/jobs/{job_id}/results/{result_index}/report.pdf")
async def download_pdf_report(job_id: str, result_index: int) -> Response:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        idx = int(result_index)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid result_index")

    if idx < 0 or idx >= len(job.results):
        raise HTTPException(status_code=404, detail="Result not found")

    row = job.results[idx]
    issues: List[Dict[str, Any]] = []
    if row.website_status == "HAS_WEBSITE" and row.website:
        cached = job.technical_audits.get(idx)
        if cached is None:
            try:
                cached = await asyncio.to_thread(run_technical_audit, row.website)
                job.technical_audits[idx] = cached
            except Exception:
                cached = None
        if cached and isinstance(cached.get("issues"), list):
            issues = cached["issues"]

    try:
        pdf_bytes = await asyncio.to_thread(
            generate_audit_pdf,
            business_name=row.business_name,
            phone=row.phone,
            issues=issues,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

    filename = f"AUDIT_{row.business_name}".replace(" ", "_")
    filename = re.sub(r"[^a-zA-Z0-9_\-]", "", filename)[:60] or "AUDIT"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"},
    )


# Logica per trovare il frontend sia in DEV che in EXE
if getattr(sys, 'frozen', False):
    # Se siamo in EXE
    base_path = sys._MEIPASS
else:
    # Se siamo in sviluppo
    base_path = os.path.dirname(os.path.abspath(__file__))
# Cerca la cartella 'out' dentro 'frontend'
frontend_path = os.path.join(base_path, "frontend", "out")
# Fallback se non siamo nell'EXE e la cartella è 'su di uno'
if not os.path.exists(frontend_path) and not getattr(sys, 'frozen', False):
     frontend_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "out")
# Monta il frontend
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="static")
else:
    print(f"ATTENZIONE: Frontend non trovato in {frontend_path}")


if __name__ == "__main__":
    import uvicorn
    import threading
    import webbrowser

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    url = f"http://{host}:{port}"
    print(f"ClientSniper running on {url}")

    def _open_browser() -> None:
        try:
            webbrowser.open_new(url)
        except Exception:
            pass

    try:
        threading.Timer(1.5, _open_browser).start()
    except Exception:
        pass
    uvicorn.run(app, host=host, port=port, log_level="info")
