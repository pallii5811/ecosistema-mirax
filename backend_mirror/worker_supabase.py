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
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
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


_CORE_NORMALIZE_PHONE = None


app = FastAPI() if FastAPI is not None else None


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
    out: Dict[str, Optional[str]] = {"email": _extract_real_email_from_html(html_home), "phone": _extract_phone_from_html_any(html_home)}
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
            
            pixel_found = False
            gtm_found = False
            requests_log = []
            page_title = None
            
            page.on("request", lambda req: requests_log.append(req.url))
            
            await page.goto(url, timeout=20000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)
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
                    timeout=12,
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
            
            # SSL
            result["has_ssl"] = url.startswith("https")
            
    except Exception as e:
        print(f"[process_single_url] error: {e}")
    
    # Run technical audit for SEO and speed
    try:
        tech = await asyncio.to_thread(run_technical_audit, url)
        result["seo_errors"] = tech.get("seo_issues", [])
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
            "missing_instagram": False,
        }
    except Exception:
        pass
    
    return result


if app is not None:
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

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None

try:
    from supabase import create_client  # type: ignore
except Exception:  # pragma: no cover
    create_client = None


SUPABASE_URL = "https://rtjmnjromqpsfqsgyfvp.supabase.co"
_SUPABASE_PUBLISHABLE_FALLBACK = "sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp"


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

    # Prefer service role key (server-side only) to bypass RLS.
    # Do NOT hardcode secrets in source code.
    k = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if k:
        return k
    return _SUPABASE_PUBLISHABLE_FALLBACK


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
        citta = (str(citta_raw).strip() if citta_raw is not None else "")
        if not citta:
            citta = "N/A"

        tech_stack_list_raw = r.get("tech_stack")
        tech_stack_list: List[str] = []
        if isinstance(tech_stack_list_raw, list):
            for x in tech_stack_list_raw:
                sx = str(x).strip()
                if sx:
                    tech_stack_list.append(sx)
        if not tech_stack_list:
            tech_stack_list = ["Verifica in corso"]

        result_dict: Dict[str, Any] = {
                "azienda": azienda,
                "telefono": telefono,
                "email": email,
                "sito": website,
                "website": website,
                "citta": citta,
                "categoria": r.get("category") or r.get("categoria") or "",
                "category": r.get("category") or r.get("categoria") or "",
                "tech_stack": tech_stack_list,

                "rating": r.get("rating"),
                "reviews_count": int(r.get("reviews_count") or 0),
                "is_claimed": r.get("is_claimed"),

                "instagram": r.get("instagram"),
                "facebook": r.get("facebook"),
                "meta_ads_library": r.get("meta_ads_library"),
                "decision_maker": r.get("decision_maker") or "N/D",
                "meta_pixel": bool(r.get("meta_pixel")),
                "google_tag_manager": bool(r.get("google_tag_manager")),
                "html_errors": int(r.get("html_errors") or 0),
                "technical_report": r.get("technical_report") or {},

                # Freshness
                "last_audited_at": _utc_now_iso(),
                "freshness_score": 100,
                "audit_version": 2,
            }

        try:
            result_dict["opportunity_score"] = _calc_opportunity_score(result_dict)
        except Exception:
            result_dict["opportunity_score"] = 0

        out.append(result_dict)
    return out


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
    updated["last_audited_at"] = _utc_now_iso()
    updated["freshness_score"] = 100
    updated["audit_version"] = 2
    try:
        updated["opportunity_score"] = _calc_opportunity_score(updated)
    except Exception:
        pass
    return updated


async def _finish_pending_audits(formatted: List[Dict[str, Any]], publish_cb=None) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = [dict(x) if isinstance(x, dict) else x for x in formatted]
    pending_idxs = [i for i, l in enumerate(out) if isinstance(l, dict) and _lead_has_pending_audit(l)]
    if not pending_idxs:
        return out
    print(f"[worker_supabase] Completion pass: {len(pending_idxs)} lead con audit pending", flush=True)
    for i in pending_idxs:
        lead = out[i]
        if not isinstance(lead, dict):
            continue
        site = (lead.get("sito") or lead.get("website") or "").strip()
        if not site or site.upper() in {"N/D", "N/A", "N.D.", "N/D."}:
            lead = dict(lead)
            lead["tech_stack"] = ["NO WEBSITE"]
            lead["technical_report"] = lead.get("technical_report") or {"has_google_ads": False}
            lead["last_audited_at"] = _utc_now_iso()
            out[i] = lead
            if publish_cb:
                try:
                    publish_cb(out)
                except Exception:
                    pass
            continue
        url = site if site.startswith("http") else f"https://{site}"
        try:
            audit = await asyncio.wait_for(process_single_url(url), timeout=55.0)
            if isinstance(audit, dict):
                out[i] = _apply_audit_url_payload_to_lead(lead, audit)
                if publish_cb:
                    try:
                        publish_cb(out)
                    except Exception:
                        pass
        except Exception as e:
            print(f"[worker_supabase] completion-pass audit failed {url}: {e}", flush=True)
    return out


def _organic_env_int(name: str, default: int, min_value: int, max_value: int) -> int:
    try:
        raw = os.getenv(name)
        value = int(str(raw).strip()) if raw is not None else default
        return max(min_value, min(max_value, value))
    except Exception:
        return default


def _organic_enabled() -> bool:
    raw = os.getenv("ORGANIC_DISCOVERY_ENABLED", "true")
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


def _organic_extract_search_links(html: str, max_results: int) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html or '', re.I | re.S):
        href = _organic_decode_search_url(unquote(unescape(m.group(1) or '')).split('#', 1)[0])
        if href.startswith('/url?'):
            href = parse_qs(urlparse(href).query).get('q', [''])[0]
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
        found = _organic_extract_search_links(html, max_results)
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


def _discover_organic_website_leads(category: str, location: str) -> List[Dict[str, Any]]:
    if not _organic_enabled() or not category or not location:
        return []
    max_sites = _organic_env_int("ORGANIC_DISCOVERY_MAX_SITES", 12, 0, 24)
    if max_sites <= 0:
        return []
    c = str(category or '').lower()
    is_frigo = any(x in c for x in ['frigo', 'frigor', 'refriger', 'celle frigor'])
    if is_frigo:
        queries = [
            f'{category} {location}',
            f'celle frigorifere industriali {location}',
            f'impianti frigoriferi industriali {location}',
            f'refrigerazione industriale {location}',
            f'frigoristi industriali {location}',
            f'refrigerazione commerciale {location}',
        ]
    else:
        queries = [f'{category} {location} azienda contatti', f'{category} {location} sito ufficiale', f'{category} {location}']
    candidates: List[Dict[str, str]] = []
    seen_hosts = set()
    for q in queries:
        for item in _organic_google_urls(q, max_sites):
            origin = _organic_origin(item.get('url') or '')
            if not origin:
                continue
            host = urlparse(origin).netloc.lower().replace('www.', '')
            if host in seen_hosts:
                continue
            seen_hosts.add(host)
            candidates.append({'origin': origin, 'url': item.get('url') or origin, 'title': item.get('title') or '', 'query': q})
            if len(candidates) >= max_sites:
                break
        if len(candidates) >= max_sites:
            break
    leads: List[Dict[str, Any]] = []
    rejected_no_evidence = 0
    for item in candidates:
        origin = item['origin']
        title = item.get('title') or ''
        evidence_blob = f"{title} {origin} {item.get('query') or ''}"
        if not _organic_category_evidence(category, evidence_blob):
            rejected_no_evidence += 1
            continue
        leads.append({
            'business_name': _organic_business_name(title, origin),
            'phone': '',
            'email': '',
            'website': origin,
            'city': location,
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
    return score


def _merge_formatted_results(primary: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []

    def key_for(item: Dict[str, Any]) -> str:
        site = str(item.get("sito") or item.get("website") or "").lower().strip().replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/")
        phone = re.sub(r"\D+", "", str(item.get("telefono") or ""))
        name = re.sub(r"\W+", "", str(item.get("azienda") or item.get("nome") or "").lower())
        return site or phone or name

    for item in list(primary or []) + list(extra or []):
        k = key_for(item)
        if not k:
            continue
        if k not in by_key:
            order.append(k)
            by_key[k] = item
            continue
        if _lead_merge_quality(item) > _lead_merge_quality(by_key[k]):
            by_key[k] = item
    return [by_key[k] for k in order if k in by_key]


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


async def _run_core_scraper(category: str, location: str, zone: Optional[str] = None, on_result=None, on_audit_done=None) -> List[Dict[str, Any]]:
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
    results: List[Dict[str, Any]] = []

    for i, item in enumerate(raw or []):
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
                ) = await asyncio.wait_for(audit_website_with_status(website_norm), timeout=25.0)
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

        results.append(
            {
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
        )

        # Progressive update: notify caller with current results (includes email)
        if on_audit_done:
            try:
                on_audit_done(list(results))
            except Exception:
                pass

    # Arricchisci ogni lead con recensioni e competitor
    # Lo facciamo DOPO il loop principale per non interferire con lo scraping
    for lead in results:
        try:
            enrichment = await asyncio.wait_for(
                _scrape_reviews_and_competitors(
                    business_name=lead.get("business_name", ""),
                    category=category,
                    location=location,
                ),
                timeout=45.0
            )
            lead["google_reviews"] = enrichment.get("google_reviews", [])
            lead["local_competitors"] = enrichment.get("local_competitors", [])
            await asyncio.sleep(random.uniform(1.0, 2.0))
        except Exception as e:
            print(f"[enrichment] Errore per {lead.get('business_name','?')}: {e}")
            # Non crashare — i campi restano liste vuote

    return results


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

    args, _unknown = parser.parse_known_args()

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
    if supabase_key == _SUPABASE_PUBLISHABLE_FALLBACK:
        print(
            "[worker_supabase] WARNING: stai usando la publishable key come fallback. "
            "Se hai RLS attiva, setta la variabile d'ambiente SUPABASE_SERVICE_ROLE_KEY."
        )

    supabase = create_client(SUPABASE_URL, supabase_key)

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
    print(f"[worker_supabase] Supabase URL: {SUPABASE_URL}")
    print("[worker_supabase] Polling tabella: searches (status=pending) ogni 4 secondi")

    mode = str(getattr(args, "mode", "all") or "all").strip().lower()
    if mode not in {"all", "user", "backlog"}:
        mode = "all"
    try:
        cooldown_s = int(getattr(args, "cooldown", 20) or 20)
    except Exception:
        cooldown_s = 20
    try:
        user_recent_minutes = int(getattr(args, "user_recent_minutes", 10) or 10)
    except Exception:
        user_recent_minutes = 10

    if user_recent_minutes < 0:
        user_recent_minutes = 0

    while True:
        try:
            # Desync workers to reduce stampedes / race windows.
            try:
                time.sleep(random.uniform(1.0, 5.0))
            except Exception:
                pass

            rows = []
            expected_pending_status = "pending"
            if mode in {"all", "user"}:
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

            # Backlog selection
            if (not rows) and mode in {"all", "backlog"}:
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
                time.sleep(4)
                continue

            job = rows[0]

            job_id = job.get("id")
            category = (job.get("category") or "").strip()
            location = (job.get("location") or "").strip()
            zone = (job.get("zone") or None)

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
            try:
                job_max = 500
                z = job.get("zone")
                if isinstance(z, str) and z.strip().isdigit():
                    job_max = max(100, int(z.strip()))
                elif isinstance(z, dict) and z.get("max_results"):
                    job_max = max(100, int(z.get("max_results") or 500))
                os.environ["DEMO_MAX_RESULTS"] = str(job_max)
                print(f"[worker_supabase] Job max_results={job_max}", flush=True)
            except Exception:
                os.environ["DEMO_MAX_RESULTS"] = "500"

            # Atomic claim: only one worker should be able to update pending -> processing.
            claim = (
                supabase.table("searches")
                .update(
                    {
                        "status": "processing",
                    }
                )
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
                try:
                    current = _load_current_job_results_safe()
                    merged = _merge_formatted_results(current, new_results if isinstance(new_results, list) else [])
                    filtered = _filter_non_domestic_refrigeration_results(category, merged)
                    if current and not filtered:
                        print(f"[worker_supabase] Safe publish preserved current results because filter returned empty: current={len(current)}", flush=True)
                        filtered = current
                    merged = filtered
                    with _rt_lock:
                        _rt_results.clear()
                        _rt_results.extend(merged)
                    payload = {"results": merged}
                    if status:
                        payload["status"] = status
                    supabase.table("searches").update(payload).eq("id", job_id).execute()
                    return merged
                except Exception as e:
                    print(f"[worker_supabase] Safe publish skipped: {e}", flush=True)
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

            core_results = asyncio.run(_run_core_scraper(category=category, location=location, zone=zone, on_result=_on_maps_result, on_audit_done=_on_audit_done))
            formatted = _format_results(core_results)
            try:
                organic_raw = _discover_organic_website_leads(category=category, location=location)
                organic_formatted = _format_results(organic_raw)
                if organic_formatted:
                    with _rt_lock:
                        formatted = _merge_formatted_results(_rt_results, formatted)
                    print(f"[worker_supabase] Organic website discovery final merge uses audited progressive leads only; raw_candidates={len(organic_formatted)}")
            except Exception as e:
                print(f"[worker_supabase] Organic website discovery skipped: {e}")

            formatted = _filter_non_domestic_refrigeration_results(category, formatted)

            try:
                if formatted:
                    print(f"DEBUG DATA: {formatted[0]}")
                    print("[worker_supabase] Debug first result:")
                    print(json.dumps(formatted[0], ensure_ascii=False))
            except Exception:
                pass

            print(f"[worker_supabase] Job {job_id} completato. Risultati: {len(formatted)}")

            try:
                formatted = asyncio.run(_finish_pending_audits(formatted, publish_cb=lambda snap: _publish_job_results_safe(snap)))
            except Exception as e:
                print(f"[worker_supabase] completion-pass skipped: {e}", flush=True)

            pending_left = sum(1 for l in formatted if isinstance(l, dict) and _lead_has_pending_audit(l))
            final_status = "completed" if pending_left == 0 else "processing"
            if pending_left > 0:
                print(f"[worker_supabase] Job {job_id}: {pending_left} audit ancora pending — status={final_status}", flush=True)

            formatted = _publish_job_results_safe(formatted, status=final_status)

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
                        err_status = "processing" if pending_left > 0 else "completed"
                        supabase.table("searches").update({"status": err_status, "results": current_results}).eq("id", locals()["job_id"]).execute()
                    else:
                        supabase.table("searches").update(
                            {
                                "status": "error",
                                "results": {
                                    "error": err,
                                    "trace": traceback.format_exc(),
                                    "ts": _utc_now_iso(),
                                },
                            }
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

        # Import from backend
        try:
            for _p in (_BACKEND_DIR, _REPO_ROOT):
                if _p not in sys.path:
                    sys.path.insert(0, _p)
            from backend import main as core  # type: ignore
        except Exception:
            return None

        audit_fn = getattr(core, "audit_website_with_status", None)
        if not audit_fn:
            return None

        try:
            (
                audit,
                tech_stack,
                load_speed_s,
                domain_creation_date,
                domain_expiration_date,
                email,
                http_status,
                error,
                html,
                error_line,
                error_hint,
            ) = await asyncio.wait_for(audit_fn(website), timeout=20.0)
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

        updated: Dict[str, Any] = dict(lead_data)
        try:
            updated["meta_pixel"] = bool(getattr(audit, "has_facebook_pixel", False))
        except Exception:
            pass
        try:
            updated["google_tag_manager"] = bool(getattr(audit, "has_gtm", False))
        except Exception:
            pass

        updated["last_audited_at"] = _utc_now_iso()
        updated["freshness_score"] = 100
        updated["audit_version"] = 2

        try:
            updated["opportunity_score"] = _calc_opportunity_score(updated)
        except Exception:
            pass

        try:
            if email and not lead_data.get("email"):
                updated["email"] = email
        except Exception:
            pass

        # Detect what changed
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
                    "--disable-blink-features=AutomationControlled"
                ]
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
                args=["--no-sandbox", "--disable-setuid-sandbox"]
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
