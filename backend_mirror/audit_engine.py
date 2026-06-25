import re
import time
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


@dataclass
class TechnicalIssue:
    code: str
    severity: str
    message: str
    line: Optional[int] = None
    context: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "line": self.line,
            "context": self.context,
        }


def _find_line_number(html: str, needle: str) -> Optional[int]:
    if not html or not needle:
        return None
    idx = html.lower().find(needle.lower())
    if idx < 0:
        return None
    return html[:idx].count("\n") + 1


def _extract_context(html: str, needle: str, radius: int = 180) -> Optional[str]:
    if not html or not needle:
        return None
    idx = html.lower().find(needle.lower())
    if idx < 0:
        return None
    start = max(0, idx - radius)
    end = min(len(html), idx + len(needle) + radius)
    snippet = html[start:end]
    snippet = snippet.replace("\r\n", "\n").replace("\r", "\n")
    return snippet.strip()


def fetch_homepage_html(url: str, timeout_s: float = 14.0) -> Tuple[str, str, int, float]:
    t0 = time.monotonic()
    r = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=timeout_s,
        allow_redirects=True,
    )
    elapsed_s: float = 0.0
    try:
        # requests provides elapsed, but keep a timer fallback.
        elapsed_obj = getattr(r, "elapsed", None)
        if elapsed_obj is not None:
            elapsed_s = float(elapsed_obj.total_seconds())
        else:
            elapsed_s = float(time.monotonic() - t0)
    except Exception:
        elapsed_s = float(time.monotonic() - t0)

    final_url = str(getattr(r, "url", "") or url)
    status = int(getattr(r, "status_code", 0) or 0)
    return final_url, (r.text or ""), status, elapsed_s


def _is_valid_existing_phone(value: Optional[str]) -> bool:
    try:
        v = (value or "").strip()
        if not v:
            return False
        if v.upper() in {"N/D", "N/A", "NONE", "NULL"}:
            return False
        return True
    except Exception:
        return False


_SAFE_PHONE_RE = re.compile(
    r"\b(?:(?:\+|00)39[\s-]?)?((?:3\d{2}|0\d{1,4})[\s-]?\d{6,9})\b",
    flags=re.IGNORECASE,
)


def _normalize_phone_candidate(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    v = (value or "").strip()
    if not v:
        return None
    v = v.replace("\u00a0", " ")
    v = re.sub(r"\s+", " ", v).strip()
    if v.startswith("00"):
        v = "+" + v[2:]
    # Keep only digits, spaces, + and - for readability
    v = re.sub(r"[^0-9+\s-]", "", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v or None


def extract_phone_safe_from_html(html: Optional[str], existing_phone: Optional[str] = None) -> Optional[str]:
    if _is_valid_existing_phone(existing_phone):
        return (existing_phone or "").strip()
    if not html:
        return None

    soup = BeautifulSoup(html or "", "html.parser")

    # 1) Prefer official tel: links
    try:
        for a in soup.select('a[href^="tel:"]'):
            href = (a.get("href") or "").strip()
            if not href:
                continue
            raw = href.split(":", 1)[1]
            raw = raw.split("?", 1)[0]
            raw = raw.split("#", 1)[0]
            candidate = _normalize_phone_candidate(raw)
            if not candidate:
                continue

            m = _SAFE_PHONE_RE.search(candidate)
            if not m:
                continue
            digits = re.sub(r"\D+", "", m.group(1) or "")
            if len(digits) == 11 and digits[0] in {"0", "1"}:
                continue
            return _normalize_phone_candidate(m.group(0))
    except Exception:
        pass

    # 2) Fallback: visible text only (never regex on raw HTML)
    try:
        text = soup.get_text(separator=" ")
    except Exception:
        text = ""

    if not text:
        return None

    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()

    try:
        m = _SAFE_PHONE_RE.search(text)
        if not m:
            return None
        digits = re.sub(r"\D+", "", m.group(1) or "")
        if len(digits) == 11 and digits[0] in {"0", "1"}:
            return None
        return _normalize_phone_candidate(m.group(0))
    except Exception:
        return None


def run_technical_audit(url: str, timeout_s: float = 14.0, existing_phone: Optional[str] = None) -> Dict[str, Any]:
    final_url, html, status, load_speed_seconds = fetch_homepage_html(url, timeout_s=timeout_s)

    issues: List[TechnicalIssue] = []
    soup = BeautifulSoup(html or "", "html.parser")

    phone = None
    try:
        phone = extract_phone_safe_from_html(html or "", existing_phone=existing_phone)
    except Exception:
        phone = (existing_phone or "").strip() if _is_valid_existing_phone(existing_phone) else None

    title = soup.find("title")
    missing_title = title is None or not (title.get_text() or "").strip()
    if missing_title:
        needle = "<title" if title is None else str(title)
        issues.append(
            TechnicalIssue(
                code="SEO_MISSING_TITLE",
                severity="critical",
                message="SEO: tag <title> mancante o vuoto.",
                line=_find_line_number(html, "<title"),
                context=_extract_context(html, "<title"),
            )
        )

    h1 = soup.find("h1")
    missing_h1 = h1 is None or not (h1.get_text() or "").strip()
    if missing_h1:
        issues.append(
            TechnicalIssue(
                code="SEO_MISSING_H1",
                severity="critical",
                message="SEO: tag <h1> mancante o vuoto.",
                line=_find_line_number(html, "<h1"),
                context=_extract_context(html, "<h1"),
            )
        )

    meta_desc = soup.find("meta", attrs={"name": re.compile(r"^description$", re.IGNORECASE)})
    meta_desc_content = (meta_desc.get("content") if meta_desc else "") or ""
    if meta_desc is None or not meta_desc_content.strip():
        issues.append(
            TechnicalIssue(
                code="SEO_MISSING_META_DESCRIPTION",
                severity="critical",
                message='SEO: <meta name="description"> mancante o vuoto.',
                line=_find_line_number(html, "name=\"description\"")
                or _find_line_number(html, "name='description'")
                or _find_line_number(html, "description"),
                context=_extract_context(html, "description"),
            )
        )

    viewport = soup.find("meta", attrs={"name": re.compile(r"^viewport$", re.IGNORECASE)})
    if viewport is None:
        issues.append(
            TechnicalIssue(
                code="MOBILE_MISSING_VIEWPORT",
                severity="critical",
                message='ERRORE CRITICO: Viewport mancante. Il sito non è ottimizzato per mobile (es. iPhone).',
                line=_find_line_number(html, "viewport"),
                context=_extract_context(html, "viewport"),
            )
        )

    parsed_final = urlparse(final_url)
    is_https = parsed_final.scheme.lower() == "https"
    if is_https:
        mixed: List[Tuple[str, str]] = []
        for tag, attr in (("script", "src"), ("img", "src"), ("link", "href")):
            for el in soup.find_all(tag):
                val = (el.get(attr) or "").strip()
                if not val:
                    continue
                abs_url = urljoin(final_url, val)
                if abs_url.lower().startswith("http://"):
                    mixed.append((tag, abs_url))

        if mixed:
            first_tag, first_url = mixed[0]
            issues.append(
                TechnicalIssue(
                    code="SECURITY_MIXED_CONTENT",
                    severity="critical",
                    message=f"Security: Mixed Content. Risorsa caricata in HTTP su pagina HTTPS ({first_tag}: {first_url}).",
                    line=_find_line_number(html, "http://"),
                    context=_extract_context(html, "http://"),
                )
            )

    has_google_ads = False
    has_ga4 = False
    has_chatbot = False
    has_booking_system = False
    has_ecommerce = False
    has_spf = False
    has_dmarc = False
    decision_maker = "N/D"
    seo_disaster = bool(missing_title or missing_h1)
    try:
        lower = (html or "").lower()
        # Google Ads conversion IDs often include AW-XXXXXXXXX
        if re.search(r"\bAW-[A-Z0-9]+\b", html or ""):
            has_google_ads = True
        # GA4 measurement IDs often include G-XXXXXXXXXX
        if re.search(r"\bG-[A-Z0-9]+\b", html or ""):
            has_ga4 = True

        # Chatbot providers (best-effort)
        chatbot_needles = [
            "tidio.co",
            "tidiochat",
            "intercom.io",
            "intercomcdn.com",
            "widget.intercom",
            "crisp.chat",
            "crisp.",
            "tawk.to",
            "zendesk",
            "zopim",
            "livechatinc",
            "smartsupp",
            "chatbase",
            "botpress",
        ]
        if any(n in lower for n in chatbot_needles):
            has_chatbot = True

        booking_needles = [
            "calendly.com",
            "treatwell",
            "thefork",
            "fork-cdn",
            "youcanbook",
            "youcanbook.me",
        ]
        if any(n in lower for n in booking_needles):
            has_booking_system = True

        ecommerce_needles = [
            "shopify",
            "cdn.shopify.com",
            "woocommerce",
            "wp-content/plugins/woocommerce",
            "magento",
        ]
        if any(n in lower for n in ecommerce_needles):
            has_ecommerce = True

        # Decision maker: prefer direct mailto emails.
        try:
            m = re.search(r"mailto:([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})", html or "", flags=re.IGNORECASE)
            if m:
                decision_maker = m.group(1).strip()
            else:
                # Fallback: detect company identifiers / titles
                needles = ["p.iva", "partita iva", "titolare", "dott.", "avv.", "amministratore", "ceo", "founder"]
                for n in needles:
                    if n in lower:
                        decision_maker = n.upper()
                        break
        except Exception:
            decision_maker = "N/D"
    except Exception:
        has_google_ads = False
        has_ga4 = False
        has_chatbot = False
        has_booking_system = False
        has_ecommerce = False
        decision_maker = "N/D"

    # Human-readable error list (for UI/report). Keep it lightweight and stable.
    error_details: List[str] = []
    try:
        for i in issues:
            sev = (getattr(i, "severity", "") or "").strip().upper() or "INFO"
            msg = (getattr(i, "message", "") or "").strip()
            if msg:
                error_details.append(f"{sev}: {msg}")
    except Exception:
        error_details = []

    if seo_disaster:
        try:
            error_details.append("CRITICAL: DISASTRO SEO (NO H1/TITLE)")
        except Exception:
            pass

    # DMARC/SPF radar (best-effort, short timeout)
    try:
        domain = (urlparse(final_url).netloc or "").strip()
        domain = domain.split(":", 1)[0].lower()
        if domain.startswith("www."):
            domain = domain[4:]

        txt_records: List[str] = []
        try:
            import dns.resolver  # type: ignore

            try:
                answers = dns.resolver.resolve(domain, "TXT", lifetime=2.0)
                for rdata in answers:
                    try:
                        parts = getattr(rdata, "strings", None)
                        if parts:
                            txt_records.append("".join([p.decode("utf-8", errors="ignore") for p in parts]))
                        else:
                            txt_records.append(str(rdata))
                    except Exception:
                        txt_records.append(str(rdata))
            except Exception:
                pass

            try:
                answers = dns.resolver.resolve(f"_dmarc.{domain}", "TXT", lifetime=2.0)
                for rdata in answers:
                    try:
                        parts = getattr(rdata, "strings", None)
                        if parts:
                            txt_records.append("".join([p.decode("utf-8", errors="ignore") for p in parts]))
                        else:
                            txt_records.append(str(rdata))
                    except Exception:
                        txt_records.append(str(rdata))
            except Exception:
                pass
        except Exception:
            # Fallback to nslookup (Windows-friendly)
            try:
                p1 = subprocess.run(
                    ["nslookup", "-type=txt", domain],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                txt_records.append(p1.stdout or "")
            except Exception:
                pass
            try:
                p2 = subprocess.run(
                    ["nslookup", "-type=txt", f"_dmarc.{domain}"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                txt_records.append(p2.stdout or "")
            except Exception:
                pass

        joined = "\n".join([t for t in txt_records if t])
        has_spf = "v=spf1" in joined.lower()
        has_dmarc = "v=dmarc1" in joined.lower()
    except Exception:
        has_spf = False
        has_dmarc = False

    return {
        "url": url,
        "final_url": final_url,
        "http_status": status,
        "phone": phone,
        "load_speed_seconds": float(load_speed_seconds or 0.0),
        "issues": [i.to_dict() for i in issues],
        "error_details": error_details,
        "has_google_ads": has_google_ads,
        "has_ga4": has_ga4,
        "has_chatbot": has_chatbot,
        "has_booking_system": has_booking_system,
        "has_ecommerce": has_ecommerce,
        "has_spf": has_spf,
        "has_dmarc": has_dmarc,
        "seo_disaster": seo_disaster,
        "decision_maker": decision_maker,
        "has_critical": any(i.severity == "critical" for i in issues),
    }
