"""
MIRAX — Business events enrichment (worker-side).
Fonti: audit lead (sempre), OpenAPI, Indeed IT, ANAC Open Data.
Non-blocking: timeout brevi, mai blocca il job.
"""
from __future__ import annotations

import asyncio
import os
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import quote, urljoin

from anac_client import search_anac_tenders

CRM_PATTERNS: List[tuple[str, re.Pattern[str]]] = [
    ("HubSpot", re.compile(r"hubspot|js\.hs-scripts\.com|hsforms\.net", re.I)),
    ("Salesforce", re.compile(r"salesforce|force\.com|pardot\.com", re.I)),
    ("Pipedrive", re.compile(r"pipedrive|pipedriveassets\.com", re.I)),
    ("Zoho CRM", re.compile(r"zoho|zohopublic\.com", re.I)),
    ("Microsoft Dynamics", re.compile(r"dynamics\s*365|dynamics\.com", re.I)),
    ("Freshsales", re.compile(r"freshsales|freshworks\.com", re.I)),
]

HEADERS_POOL = [
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
    },
]

SECTOR_KEYWORDS = [
    "fotovoltaico",
    "fotovoltaica",
    "pannelli solari",
    "impianti solari",
    "energia solare",
    "rinnovabili",
]

CURRENT_YEAR = datetime.now().year


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lead_name(lead: Dict[str, Any]) -> str:
    for key in ("business_name", "azienda", "nome", "name", "company"):
        val = str(lead.get(key) or "").strip()
        if val:
            return val
    return ""


def _lead_has_valid_website(lead: Dict[str, Any]) -> bool:
    raw = _lead_website(lead)
    if not raw or raw in {"none", "n/a", "null", "no website", "no-website"}:
        return False
    if "no website" in raw:
        return False
    stack = _tech_stack_text(lead).lower()
    if "no website" in stack:
        return False
    return True


def _lead_website(lead: Dict[str, Any]) -> str:
    raw = str(lead.get("website") or lead.get("sito") or "").strip().lower()
    return raw.rstrip("/")


def _lead_piva(lead: Dict[str, Any]) -> str:
    for key in ("partita_iva", "piva", "vat", "vat_number"):
        val = lead.get(key)
        if val:
            digits = re.sub(r"\D+", "", str(val))
            if len(digits) == 11:
                return digits
    openapi = lead.get("openapi_enriched") or lead.get("openapi") or {}
    if isinstance(openapi, dict):
        for key in ("partita_iva", "piva", "vatCode"):
            val = openapi.get(key)
            if val:
                digits = re.sub(r"\D+", "", str(val))
                if len(digits) == 11:
                    return digits
    return ""


def _tech_report(lead: Dict[str, Any]) -> Dict[str, Any]:
    tr = lead.get("technical_report")
    return tr if isinstance(tr, dict) else {}


def _tech_stack_text(lead: Dict[str, Any]) -> str:
    stack = lead.get("tech_stack") or []
    if isinstance(stack, list):
        return " ".join(str(x) for x in stack)
    return str(stack or "")


def detect_crm_from_html(html: Optional[str]) -> List[str]:
    if not html:
        return []
    found: List[str] = []
    for label, pat in CRM_PATTERNS:
        if pat.search(html):
            found.append(label)
    return list(dict.fromkeys(found))


def detect_crm_signal(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Segnale CRM rilevato sul sito o nello stack tecnologico."""
    crms = lead.get("detected_crm_stack") or []
    if not isinstance(crms, list) or not crms:
        stack = _tech_stack_text(lead).lower()
        crms = detect_crm_from_html(stack)
    if not crms:
        return []
    website = _lead_website(lead)
    return [
        _make_signal(
            "crm_installed",
            f"CRM rilevato: {', '.join(str(c) for c in crms[:3])}",
            severity="medium",
            confidence=85,
            evidence=[
                {"label": "CRM", "value": str(crms[0]), "source": "mirax_audit", "url": website or None},
                {"label": "Tecnologie", "value": ", ".join(str(c) for c in crms[:3]), "source": "mirax_audit"},
            ],
        )
    ]


def detect_marketing_investment_signal(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Segnale investimento marketing — solo Meta Ad Library verificata (non pixel/tag tecnici)."""
    signals: List[Dict[str, Any]] = []
    tr = _tech_report(lead)
    website = _lead_website(lead)

    active_meta = tr.get("active_meta_ads") or lead.get("active_meta_ads")
    meta_verified = bool(tr.get("meta_ads_verified") or lead.get("meta_ads_verified"))
    try:
        active_count = int(active_meta) if active_meta is not None else 0
    except (TypeError, ValueError):
        active_count = 0

    if meta_verified and active_count > 0:
        signals.append(
            _make_signal(
                "investing_marketing",
                f"Investe in Meta Advertising — {active_count} inserzioni attive",
                severity="high",
                confidence=94,
                evidence=[
                    {
                        "label": "Meta Ad Library",
                        "value": f"{active_count} inserzioni attive",
                        "source": "meta_ad_library",
                        "url": website or None,
                    }
                ],
            )
        )
    return signals


def _intent_signal_types(intent: Optional[Dict[str, Any]]) -> Set[str]:
    if not isinstance(intent, dict):
        return set()
    signals = intent.get("signals") or []
    return {str(s.get("type", "")).lower() for s in signals if isinstance(s, dict) and s.get("type")}


def _intent_hiring_roles(intent: Optional[Dict[str, Any]]) -> List[str]:
    """Ruoli hiring da CommercialIntent, SignalIntentSpec legacy e params segnali."""
    if not isinstance(intent, dict):
        return []
    out: List[str] = []
    seen: Set[str] = set()

    def _add(role: Any) -> None:
        r = str(role or "").strip()
        if not r:
            return
        key = r.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(r)

    for s in intent.get("signals") or []:
        if not isinstance(s, dict) or str(s.get("type", "")).lower() != "hiring":
            continue
        params = s.get("params") or {}
        _add(params.get("role"))
        for r in params.get("roles") or []:
            _add(r)
    for r in intent.get("hiring_roles") or []:
        _add(r)
    tp = intent.get("target_profile") or {}
    if isinstance(tp, dict):
        for r in tp.get("roles") or []:
            _add(r)
    return out


_EXTERNAL_SIGNAL_TYPES = frozenset(
    {
        "hiring",
        "tender_won",
        "funding_received",
        "executive_change",
        "website_changed",
        "crm_change",
        "crm_installed",
    }
)


def intent_requires_external_enrichment(intent: Optional[Dict[str, Any]]) -> bool:
    """True se la query richiede fonti live (Indeed, ANAC, careers, …)."""
    if not isinstance(intent, dict):
        return False
    if _intent_signal_types(intent) & _EXTERNAL_SIGNAL_TYPES:
        return True
    req = intent.get("required_signals") or []
    if isinstance(req, list):
        return bool({str(x).lower() for x in req} & _EXTERNAL_SIGNAL_TYPES)
    return False


def resolve_enrichment_cap(intent: Optional[Dict[str, Any]], total_leads: int) -> int:
    """Cap lead da arricchire — più alto quando servono segnali live (hiring, gare)."""
    base = int(os.getenv("ENRICH_BUSINESS_EVENTS_MAX", "40") or "40")
    hard_max = int(os.getenv("ENRICH_BUSINESS_EVENTS_HARD_MAX", "120") or "120")
    cap = max(1, min(base, hard_max))
    if intent_requires_external_enrichment(intent):
        cap = max(cap, min(max(1, total_leads), hard_max))
    return cap


def _roles_from_query_text(intent: Optional[Dict[str, Any]]) -> List[str]:
    """Fallback: estrae ruoli hiring dalla query originale se i params segnali sono vuoti."""
    if not isinstance(intent, dict):
        return []
    q = str(intent.get("query") or intent.get("original_query") or "").lower()
    if not q:
        return []
    out: List[str] = []
    if re.search(r"\bcommercial\w*\b", q):
        out.append("commerciale")
    if re.search(r"\bprogrammator\w*|developer\w*|sviluppat\w*\b", q):
        out.append("programmatore")
    if re.search(r"\bmarketing\s+manager\b|\bcopywriter\b|\bseo\b", q):
        out.append("marketing")
    return out


def _intent_hiring_roles_full(intent: Optional[Dict[str, Any]]) -> List[str]:
    roles = _intent_hiring_roles(intent)
    if roles:
        return roles
    return _roles_from_query_text(intent)


def _intent_sector_keywords(intent: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(intent, dict):
        return []
    industries = intent.get("target_profile", {}).get("industries") or []
    return [str(i).strip() for i in industries if str(i).strip()]


def detect_sector_hits(text: str, extra_keywords: Optional[List[str]] = None) -> List[Dict[str, str]]:
    if not text:
        return []
    lower = text.lower()
    terms = list(SECTOR_KEYWORDS)
    if extra_keywords:
        terms.extend(extra_keywords)
    hits: List[Dict[str, str]] = []
    for kw in terms:
        k = kw.strip().lower()
        if k and k in lower:
            idx = lower.find(k)
            snippet = text[max(0, idx - 40) : idx + len(k) + 60].replace("\n", " ").strip()
            hits.append({"keyword": kw, "snippet": snippet[:180]})
    return hits[:5]


def _make_signal(
    signal_type: str,
    title: str,
    *,
    severity: str = "medium",
    confidence: int = 80,
    evidence: Optional[List[Dict[str, Any]]] = None,
    entity_verified: bool = False,
    status: str = "confirmed",
) -> Dict[str, Any]:
    ev = evidence or []
    source = ev[0].get("source", "mirax_audit") if ev else "mirax_audit"
    out: Dict[str, Any] = {
        "type": signal_type,
        "title": title,
        "severity": severity if severity in {"critical", "high", "medium"} else "medium",
        "confidence": max(0, min(100, int(confidence))),
        "evidence": ev,
        "source": source,
        "status": status if status in {"confirmed", "unknown", "inferred"} else "confirmed",
    }
    if entity_verified:
        out["entity_verified"] = True
    return out


def detect_signals_from_audit(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Segnali da dati audit già nel lead — zero network."""
    signals: List[Dict[str, Any]] = []
    name = _lead_name(lead) or "Azienda"
    website = _lead_website(lead)
    tr = _tech_report(lead)
    stack = _tech_stack_text(lead).lower()

    load_speed = tr.get("load_speed_seconds") or tr.get("load_speed_s") or lead.get("load_speed_s")
    try:
        load_speed_f = float(load_speed) if load_speed is not None else None
    except (TypeError, ValueError):
        load_speed_f = None

    html_errors = int(lead.get("html_errors") or tr.get("html_errors") or 0)

    if load_speed_f is not None and load_speed_f >= 4.0:
        signals.append(
            _make_signal(
                "site_stale",
                f"Sito lento ({load_speed_f:.1f}s) — manutenzione insufficiente",
                severity="high" if load_speed_f >= 6 else "medium",
                confidence=78,
                evidence=[
                    {"label": "Velocità caricamento", "value": f"{load_speed_f:.1f}s", "source": "mirax_audit", "url": website or None},
                    {"label": "Soglia consigliata", "value": "< 2.5s", "source": "mirax_audit"},
                ],
            )
        )
    elif "sito lento" in stack:
        signals.append(
            _make_signal(
                "site_stale",
                "Sito lento — segnale di manutenzione insufficiente",
                severity="medium",
                confidence=75,
                evidence=[{"label": "Audit tecnico", "value": "SITO LENTO nel tech stack", "source": "mirax_audit", "url": website or None}],
            )
        )

    if html_errors >= 1:
        signals.append(
            _make_signal(
                "site_stale",
                f"Sito con {html_errors} problemi HTML/SEO rilevati",
                severity="high" if html_errors >= 10 else "medium",
                confidence=72,
                evidence=[{"label": "Errori HTML/SEO", "value": str(html_errors), "source": "mirax_audit", "url": website or None}],
            )
        )

    if tr.get("seo_disaster"):
        signals.append(
            _make_signal(
                "site_stale",
                "SEO critico — problemi strutturali rilevati nell'audit",
                severity="high",
                confidence=80,
                evidence=[{"label": "SEO disaster", "value": "true", "source": "mirax_audit", "url": website or None}],
            )
        )

    if website and website not in {"none", "n/a", ""}:
        if not bool(lead.get("meta_pixel")) and ("missing fb pixel" in stack or "no pixel" in stack):
            signals.append(
                _make_signal(
                    "site_stale",
                    "Meta Pixel assente — tracking advertising non configurato",
                    severity="medium",
                    confidence=84,
                    evidence=[{"label": "Audit tecnico", "value": "Meta Pixel non rilevato", "source": "mirax_audit", "url": website}],
                )
            )
        if not bool(lead.get("google_tag_manager")) and "missing gtm" in stack:
            signals.append(
                _make_signal(
                    "site_stale",
                    "Google Tag Manager assente — analytics incompleto",
                    severity="medium",
                    confidence=82,
                    evidence=[{"label": "Audit tecnico", "value": "GTM non rilevato", "source": "mirax_audit", "url": website}],
                )
            )
        if not tr.get("has_spf") and not tr.get("has_dmarc"):
            signals.append(
                _make_signal(
                    "site_stale",
                    "Email aziendale a rischio — SPF/DMARC non configurati",
                    severity="medium",
                    confidence=76,
                    evidence=[
                        {"label": "SPF", "value": "non rilevato", "source": "mirax_audit", "url": website},
                        {"label": "DMARC", "value": "non rilevato", "source": "mirax_audit", "url": website},
                    ],
                )
            )

    has_google = bool(tr.get("has_google_ads")) or "google ads" in stack and "missing google ads" not in stack
    has_ga4 = bool(tr.get("has_ga4"))
    if has_google or has_ga4:
        signals.append(
            _make_signal(
                "google_ads_started",
                "Google Ads / Analytics attivi sul sito",
                severity="high",
                confidence=92 if has_google else 80,
                evidence=[
                    {
                        "label": "Tag rilevato",
                        "value": "Google Ads" if has_google else "GA4",
                        "source": "mirax_audit",
                        "url": website or None,
                    }
                ],
            )
        )

    if bool(lead.get("meta_pixel")) or bool(tr.get("has_meta_pixel")):
        signals.append(
            _make_signal(
                "meta_ads_started",
                "Meta Pixel attivo — investimento advertising probabile",
                severity="high",
                confidence=95,
                evidence=[{"label": "Pixel rilevato", "value": "Meta/Facebook Pixel", "source": "mirax_audit", "url": website or None}],
            )
        )

    crm_blob = " ".join(
        [
            stack,
            str(lead.get("detected_crm_stack") or ""),
            str(tr),
        ]
    )
    crms = detect_crm_from_html(crm_blob)
    existing = lead.get("detected_crm_stack")
    if isinstance(existing, list):
        crms = list(dict.fromkeys([*crms, *[str(c) for c in existing if c]]))
    if crms:
        lead["detected_crm_stack"] = crms
        signals.append(
            _make_signal(
                "crm_installed",
                f"CRM rilevato — {', '.join(crms[:2])}",
                severity="medium",
                confidence=88,
                evidence=[{"label": "CRM", "value": c, "source": "mirax_audit", "url": website or None} for c in crms[:3]],
            )
        )

    changes = lead.get("audit_changes")
    if isinstance(changes, list):
        for ch in changes:
            if not isinstance(ch, dict):
                continue
            field = str(ch.get("field") or "").lower()
            if "crm" in field or str(ch.get("label") or "").lower() == "crm":
                signals.append(
                    _make_signal(
                        "crm_change",
                        str(ch.get("signal") or "Cambio stack CRM rilevato"),
                        severity="high",
                        confidence=88,
                        evidence=[{"label": "Dettaglio", "value": str(ch.get("signal") or ch.get("label") or "CRM change"), "source": "audit_delta"}],
                    )
                )
                break

    return signals


def detect_registry_signals_from_lead(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Registry da openapi_enriched già presente nel lead."""
    signals: List[Dict[str, Any]] = []
    openapi = lead.get("openapi_enriched") or lead.get("openapi") or {}
    if not isinstance(openapi, dict):
        return signals
    storico = openapi.get("storico_bilanci") or lead.get("storico_bilanci")
    if not isinstance(storico, list) or len(storico) < 2:
        return signals

    def _sort_key(row: Any) -> int:
        if isinstance(row, dict):
            try:
                return int(row.get("anno") or 0)
            except (TypeError, ValueError):
                return 0
        return 0

    rows = [r for r in storico if isinstance(r, dict)]
    rows.sort(key=_sort_key, reverse=True)
    if len(rows) < 2:
        return signals
    latest, prev = rows[0], rows[1]
    piva = _lead_piva(lead)

    try:
        ld = int(latest.get("dipendenti") or 0)
        pd = int(prev.get("dipendenti") or 0)
        if pd > 0 and ld > pd:
            growth = (ld - pd) / pd
            if growth >= 0.10:
                signals.append(
                    _make_signal(
                        "registry_change",
                        f"Crescita organico +{round(growth * 100)}% (Camera di Commercio)",
                        severity="high" if growth >= 0.30 else "medium",
                        confidence=90,
                        evidence=[
                            {"label": "Dipendenti", "value": f"{pd} → {ld}", "source": "openapi_cciaa", "url": f"https://company.openapi.com/IT-advanced/{piva}" if piva else None},
                        ],
                    )
                )
    except (TypeError, ValueError):
        pass

    try:
        lf = float(latest.get("fatturato") or 0)
        pf = float(prev.get("fatturato") or 0)
        if pf > 0 and lf > pf:
            growth = (lf - pf) / pf
            if growth >= 0.15:
                signals.append(
                    _make_signal(
                        "registry_change",
                        f"Crescita fatturato +{round(growth * 100)}% (Camera di Commercio)",
                        severity="high" if growth >= 0.40 else "medium",
                        confidence=88,
                        evidence=[
                            {"label": "Fatturato", "value": f"€{pf:,.0f} → €{lf:,.0f}", "source": "openapi_cciaa", "url": f"https://company.openapi.com/IT-advanced/{piva}" if piva else None},
                        ],
                    )
                )
    except (TypeError, ValueError):
        pass

    return signals


async def detect_registry_signals_api(piva: str) -> List[Dict[str, Any]]:
    """OpenAPI IT-advanced — best effort."""
    key = os.getenv("OPENAPI_API_KEY") or os.getenv("OPENAPI_IT_TOKEN") or ""
    if not key or not piva or len(piva) != 11:
        return []
    try:
        import httpx

        url = f"https://company.openapi.com/IT-advanced/{piva}"
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
            if resp.status_code != 200:
                return []
            data = resp.json() or {}
        company = data.get("data") or data.get("company") or data
        if not isinstance(company, dict):
            return []
        bilanci = company.get("storico_bilanci") or company.get("balanceSheets") or []
        fake_lead = {"openapi_enriched": {"storico_bilanci": bilanci}, "partita_iva": piva}
        return detect_registry_signals_from_lead(fake_lead)
    except Exception as e:
        print(f"[enrich] OpenAPI error per {piva}: {e}", flush=True)
        return []


_HIRING_WORDS = [
    "lavora", "candidati", "posizioni aperte", "job", "careers", "assumiamo",
    "opportunità", "lavoro", "team", "join us", "lavora con noi", "carriere",
    "work with us", "we are hiring", "diventa parte", "invia cv",
]

_CAREER_LINK_KEYWORDS = [
    "lavora", "careers", "jobs", "posizioni", "lavoro", "join us", "assumiamo",
    "carriere", "work with us", "lavora con noi",
]

_HIRING_CAREERS_PATHS = [
    "/lavora-con-noi",
    "/careers",
    "/jobs",
    "/lavora",
    "/posizioni-aperte",
    "/carriere",
    "/work-with-us",
]

_JOB_TITLE_HINTS = (
    "commerc", "sales", "vendit", "marketing", "developer", "programm", "designer",
    "manager", "specialist", "consultant", "assistent", "account", "stage", "tirocinio",
    "junior", "senior", "coordinator", "analyst", "engineer", "copywriter", "seo",
)


def _extract_job_titles_from_careers_html(html: str, role_variants: Optional[List[str]] = None) -> List[str]:
    """Estrae titoli offerte da HTML pagina careers (deterministico, testabile)."""
    if not html:
        return []
    titles: List[str] = []
    seen: Set[str] = set()
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for el in soup.find_all(["h1", "h2", "h3", "h4", "li", "a", "p", "strong", "span"]):
            t = el.get_text(" ", strip=True)
            if not (5 <= len(t) <= 140):
                continue
            tl = t.lower()
            if tl in seen or tl in {"lavora con noi", "careers", "jobs", "carriere", "candidati", "work with us"}:
                continue
            job_like = any(h in tl for h in _JOB_TITLE_HINTS)
            if role_variants:
                if not any(r in tl for r in role_variants):
                    continue
            elif not job_like:
                continue
            seen.add(tl)
            titles.append(t[:200])
            if len(titles) >= 5:
                break
    except Exception:
        pass
    return titles


def _careers_html_qualifies(lower: str, role_variants: List[str]) -> bool:
    if not any(w in lower for w in _HIRING_WORDS):
        return False
    if role_variants:
        for r in role_variants:
            if len(r) <= 4:
                if re.search(rf"\b{re.escape(r)}\b", lower):
                    return True
            elif r in ("commerciale", "commercial"):
                if re.search(r"\bcommerciale\b|\bcommercial\b|\bsales\b|\bvenditor\w*\b", lower):
                    return True
            elif r in lower:
                return True
        return False
    return True


def _hiring_signal_from_careers_jobs(
    name: str,
    url: str,
    job_titles: List[str],
    *,
    role_specific: bool,
) -> List[Dict[str, Any]]:
    if not job_titles:
        return []
    primary = job_titles[0]
    title = (
        f"Sta assumendo — {primary}"
        if len(job_titles) == 1
        else f"Sta assumendo — {len(job_titles)} posizioni aperte"
    )
    evidence: List[Dict[str, Any]] = [
        {"label": "Fonte", "value": "Sito aziendale", "source": "website_careers", "url": url, "company": name},
    ]
    for jt in job_titles[:3]:
        evidence.append({"label": "Offerta", "value": jt, "source": "website_careers", "url": url, "company": name})
    return [
        _make_signal(
            "hiring",
            title,
            severity="high" if role_specific else "medium",
            confidence=85 if role_specific else 70,
            evidence=evidence,
        )
    ]


def _hiring_signals_for_careers_html(
    name: str,
    url: str,
    html: str,
    role_variants: List[str],
) -> List[Dict[str, Any]]:
    lower = (html or "").lower()
    if not _careers_html_qualifies(lower, role_variants):
        return []
    titles = _extract_job_titles_from_careers_html(html, role_variants or None)
    if role_variants and not titles:
        matched = [r for r in role_variants if r in lower]
        if matched:
            titles = [f"{matched[0].title()} — pagina careers"]
    if not titles and not role_variants:
        titles = ["Posizioni aperte — pagina careers"]
    if not titles:
        return []
    return _hiring_signal_from_careers_jobs(name, url, titles, role_specific=bool(role_variants))


async def detect_hiring_via_website(lead: Dict[str, Any], roles: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Fallback se Indeed/InfoJobs falliscono: cerca pagine careers sul sito aziendale."""
    website = _lead_website(lead)
    name = _lead_name(lead)
    if not website:
        return []
    role_variants = _expand_hiring_roles(roles or [])
    try:
        import httpx

        headers = dict(random.choice(HEADERS_POOL))

        async def _fetch(url: str, client: httpx.AsyncClient) -> Tuple[int, str]:
            try:
                resp = await client.get(url, headers=headers)
                return resp.status_code, resp.text or ""
            except Exception:
                return 0, ""

        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            urls_to_fetch = [website] + [website.rstrip("/") + p for p in _HIRING_CAREERS_PATHS]
            fetched = await asyncio.gather(*[_fetch(u, client) for u in urls_to_fetch])

            for url, (status, text) in zip(urls_to_fetch, fetched):
                if status != 200:
                    continue
                sigs = _hiring_signals_for_careers_html(name, url, text, role_variants)
                if sigs:
                    return sigs

            home_status, home_text = fetched[0]
            if home_status == 200 and home_text:
                from bs4 import BeautifulSoup

                soup = BeautifulSoup(home_text, "html.parser")
                careers_links: List[str] = []
                for a in soup.find_all("a", href=True):
                    href = str(a.get("href") or "").lower()
                    text = a.get_text(" ", strip=True).lower()
                    if any(k in href or k in text for k in _CAREER_LINK_KEYWORDS):
                        full = urljoin(website, a["href"])
                        if full.startswith("http") and full not in careers_links:
                            careers_links.append(full)
                careers_links = careers_links[:3]
                if careers_links:
                    link_results = await asyncio.gather(*[_fetch(u, client) for u in careers_links])
                    for url, (status, text) in zip(careers_links, link_results):
                        if status != 200:
                            continue
                        sigs = _hiring_signals_for_careers_html(name, url, text, role_variants)
                        if sigs:
                            return sigs
    except Exception as e:
        print(f"[enrich] website hiring skip: {e}", flush=True)
    return []


def _expand_hiring_roles(roles: List[str]) -> List[str]:
    """Espande un ruolo in varianti italiane/inglesi per match sui titoli Indeed."""
    synonyms: Dict[str, List[str]] = {
        "sviluppatore": ["sviluppatore", "developer", "programmatore", "software engineer", "software developer", "full stack", "frontend", "backend", "web developer"],
        "developer": ["developer", "sviluppatore", "programmatore", "software engineer", "software developer", "full stack", "frontend", "backend"],
        "programmatore": ["programmatore", "sviluppatore", "developer", "software engineer", "software developer"],
        "commerciale": [
            "commerciale", "commercial", "sales", "account manager", "business developer",
            "sales manager", "venditore", "venditrice", "venditori", "area manager",
            "sales representative", "business development", "inside sales", "field sales",
        ],
        "marketing": ["marketing", "digital marketing", "marketing manager", "growth", "seo", "copywriter"],
        "designer": ["designer", "graphic designer", "ux designer", "ui designer", "web designer"],
        "project manager": ["project manager", "pm", "product manager"],
        "cameriere": ["cameriere", "cameriera", "waiter", "waitress", "food and beverage", "f&b", "sala"],
    }
    out: Set[str] = set()
    for r in roles:
        key = r.strip().lower()
        out.update(synonyms.get(key, [key]))
        out.add(key)
    return sorted(out)


async def detect_hiring_signal(company_name: str, city: str, roles: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Indeed IT via HTTP — no Playwright. Se roles è fornito, filtra i titoli per ruolo."""
    name = (company_name or "").strip()
    loc = (city or "").strip().split(",")[0].strip() or "Italia"
    if len(name) < 2:
        return []
    target_roles = [r.strip().lower() for r in (roles or []) if str(r).strip()]
    role_variants = _expand_hiring_roles(target_roles) if target_roles else []
    try:
        import httpx

        await asyncio.sleep(random.uniform(0.3, 0.8) if os.getenv("ENRICH_PARALLEL_WORKERS") else random.uniform(1.0, 2.0))
        # Query: ruolo + azienda quando richiesto (semantic intent)
        if role_variants:
            q = quote(f"{role_variants[0]} {name}")
        else:
            q = quote(f'"{name}"')
        l = quote(loc)
        url = f"https://it.indeed.com/jobs?q={q}&l={l}&sort=date&fromage=30"
        headers = dict(random.choice(HEADERS_POOL))
        headers["Accept-Language"] = "it-IT,it;q=0.9"
        headers["Accept"] = "text/html,application/xhtml+xml"

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return []
            html = resp.text or ""

        jobs: List[Dict[str, str]] = []
        name_lower = name.lower()[:20]

        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")
            cards = soup.find_all("div", class_=lambda c: c and "job_seen_beacon" in c)
            if not cards:
                cards = soup.select("div.resultContent, div[data-jk]")
            for card in cards[:8]:
                text = card.get_text(" ", strip=True).lower()
                title_el = card.select_one("h2.jobTitle span, h2 span, a.jcs-JobTitle")
                title = title_el.get_text(strip=True) if title_el else ""
                if not title or len(title) < 3:
                    continue
                if name_lower and name_lower not in text and name_lower[:8] not in text:
                    continue
                title_lower = title.lower()
                if role_variants and not any(r in title_lower for r in role_variants):
                    continue
                jobs.append({"title": title[:200], "source": "indeed_it", "date": _utc_now_iso()})
                if len(jobs) >= 3:
                    break
        except ImportError:
            for m in re.finditer(r'class="jobTitle"[^>]*>.*?<span[^>]*>([^<]{5,200})</span>', html, re.S | re.I):
                title = re.sub(r"\s+", " ", m.group(1)).strip()
                if title:
                    title_lower = title.lower()
                    if role_variants and not any(r in title_lower for r in role_variants):
                        continue
                    jobs.append({"title": title[:200], "source": "indeed_it", "date": _utc_now_iso()})
                if len(jobs) >= 3:
                    break

        if not jobs:
            return []

        return [
            _make_signal(
                "hiring",
                f"Sta assumendo — {len(jobs)} offerta/e su Indeed",
                severity="high",
                confidence=75,
                evidence=[
                    {
                        "label": "Fonte",
                        "value": f"Indeed IT — {len(jobs)} annunci",
                        "source": "indeed_it",
                        "url": url,
                        "company": name,
                    },
                    *[{"label": "Offerta", "value": j.get("title", ""), "source": "indeed_it", "company": name} for j in jobs[:2]],
                ],
            )
        ]
    except Exception as e:
        print(f"[enrich] Indeed error per {name[:30]}: {e}", flush=True)
        return []




async def detect_tender_signals(company_name: str, cf: Optional[str] = None) -> List[Dict[str, Any]]:
    """ANAC Open Data — structured tender records via anac_client."""
    return await search_anac_tenders(company_name, cf=cf, max_records=5)


def _hiring_jobs_from_signal(sig: Dict[str, Any]) -> List[Dict[str, str]]:
    """Deriva business_hiring_jobs da evidenze strutturate del segnale hiring."""
    jobs: List[Dict[str, str]] = []
    for ev in sig.get("evidence") or []:
        if not isinstance(ev, dict):
            continue
        if ev.get("label") not in ("Offerta", "Ruolo", "Posizione"):
            continue
        val = str(ev.get("value") or "").strip()
        if len(val) < 4:
            continue
        jobs.append(
            {
                "title": val[:200],
                "source": str(ev.get("source") or sig.get("source") or "website_careers"),
                "date": _utc_now_iso(),
            }
        )
    if jobs:
        return jobs
    title = str(sig.get("title") or "").strip()
    if title and "pagina careers rilevata" not in title.lower():
        return [{"title": title[:200], "source": "indeed_it", "date": _utc_now_iso()}]
    return []


def apply_signals_to_lead(lead: Dict[str, Any], signals: List[Dict[str, Any]]) -> None:
    """Popola campi legacy sul lead per badge UI. Deduplica per tipo segnale."""
    if not signals:
        return
    # Keep first signal of each type to avoid noisy duplicates (e.g. multiple site_stale).
    seen_types: Set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for sig in signals:
        st = sig.get("type")
        if st in seen_types:
            continue
        seen_types.add(st)
        deduped.append(sig)
    lead["business_signals"] = deduped
    for sig in deduped:
        st = sig.get("type")
        if st == "hiring":
            parsed = _hiring_jobs_from_signal(sig)
            if parsed:
                lead["business_hiring_jobs"] = parsed
            elif not isinstance(lead.get("business_hiring_jobs"), list):
                generic = str(sig.get("title") or "").strip()
                if generic and "pagina careers rilevata" not in generic.lower():
                    lead["business_hiring_jobs"] = [{"title": generic[:200], "source": "indeed_it", "date": _utc_now_iso()}]
        elif st == "tender_won":
            hit = {
                "title": sig.get("title", ""),
                "source": "anac_opendata",
                "date": sig.get("date") or _utc_now_iso(),
                "cig": sig.get("cig"),
                "object": sig.get("object"),
                "amount": sig.get("amount"),
                "authority": sig.get("authority"),
                "region": sig.get("region"),
                "province": sig.get("province"),
                "status": sig.get("tender_status") or sig.get("status"),
                "source_url": sig.get("source_url"),
            }
            lead["business_tender_hits"] = [hit]
        elif st == "sector_investment":
            lead["business_sector_hits"] = lead.get("business_sector_hits") or [{"keyword": "sector", "snippet": sig.get("title", "")}]
        elif st == "investing_marketing":
            lead["business_investing_marketing"] = True
        elif st == "crm_installed":
            lead["business_crm_detected"] = True


def persist_signals_to_db(
    supabase: Any,
    user_id: Optional[str],
    lead: Dict[str, Any],
    signals: List[Dict[str, Any]],
) -> int:
    if not supabase or not user_id or not signals:
        return 0
    website = _lead_website(lead) or f"name:{_lead_name(lead).lower()[:80]}"
    name = _lead_name(lead) or None
    saved = 0
    for sig in signals:
        try:
            row = {
                "user_id": user_id,
                "lead_website": website,
                "lead_name": name,
                "signal_type": sig.get("type"),
                "title": sig.get("title"),
                "severity": sig.get("severity", "medium"),
                "confidence": sig.get("confidence", 80),
                "evidence": sig.get("evidence") or [],
                "source": sig.get("source") or "mirax_audit",
                "detected_at": _utc_now_iso(),
            }
            supabase.table("lead_business_signals").upsert(
                row,
                on_conflict="user_id,lead_website,signal_type,title",
            ).execute()
            saved += 1
        except Exception as e:
            print(f"[enrich] DB upsert skip: {e}", flush=True)
    return saved


async def enrich_poor_lead_fallback(lead: Dict[str, Any], location: str = "") -> List[Dict[str, Any]]:
    """Lead senza sito valido: prova OpenAPI registry (piva) come segnale minimo."""
    if _lead_has_valid_website(lead):
        return []
    piva = _lead_piva(lead)
    if not piva:
        return []
    try:
        return await asyncio.wait_for(detect_registry_signals_api(piva), timeout=9.0)
    except Exception:
        return []


async def enrich_lead_external_signals(
    lead: Dict[str, Any],
    location: str,
    *,
    want_hiring: bool = True,
    want_tender: bool = True,
    hiring_roles: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Fonti esterne — parallelo con timeout."""
    name = _lead_name(lead)
    piva = _lead_piva(lead)
    tasks = []
    if want_hiring and name:
        tasks.append(asyncio.wait_for(detect_hiring_signal(name, location, roles=hiring_roles), timeout=12.0))
    if want_tender and name:
        tasks.append(asyncio.wait_for(detect_tender_signals(name, cf=piva), timeout=15.0))
    if piva:
        tasks.append(asyncio.wait_for(detect_registry_signals_api(piva), timeout=9.0))

    out: List[Dict[str, Any]] = []
    if not tasks:
        return out
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            continue
        if isinstance(r, list):
            out.extend(r)
    # Fallback multi-fonte hiring (Indeed → InfoJobs → Google Jobs → LinkedIn → careers)
    if want_hiring and name and not any(s.get("type") == "hiring" for s in out):
        from hiring_sources import (
            detect_hiring_via_google_jobs,
            detect_hiring_via_infojobs_it,
            detect_hiring_via_linkedin_jobs,
        )

        roles = hiring_roles
        for fetcher, timeout in (
            (detect_hiring_via_infojobs_it, 10.0),
            (detect_hiring_via_google_jobs, 11.0),
            (detect_hiring_via_linkedin_jobs, 9.0),
        ):
            try:
                extra = await asyncio.wait_for(fetcher(name, location, roles=roles), timeout=timeout)
                if extra:
                    out.extend(extra)
                    break
            except Exception:
                continue
    if want_hiring and name and not any(s.get("type") == "hiring" for s in out):
        try:
            fallback = await asyncio.wait_for(detect_hiring_via_website(lead, roles=hiring_roles), timeout=10.0)
            out.extend(fallback)
        except Exception:
            pass
    return out


async def enrich_lead_business_events(
    lead: Dict[str, Any],
    location: str,
    *,
    html: Optional[str] = None,
    old_lead: Optional[Dict[str, Any]] = None,
    sector_keywords: Optional[List[str]] = None,
    skip_external: bool = False,
    want_hiring: bool = True,
    want_tender: bool = True,
    intent: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Arricchisce un singolo lead — non solleva eccezioni."""
    name = _lead_name(lead)
    intent_types = _intent_signal_types(intent)
    intent_roles = _intent_hiring_roles_full(intent)
    intent_sectors = _intent_sector_keywords(intent)
    if intent_sectors:
        sector_keywords = list({*(sector_keywords or []), *intent_sectors})

    if html:
        crms = detect_crm_from_html(html)
        if crms:
            lead["detected_crm_stack"] = crms
    elif lead.get("website") or lead.get("sito"):
        crms = detect_crm_from_html(_tech_stack_text(lead))
        if crms:
            lead["detected_crm_stack"] = crms

    text_parts = [str(lead.get("category") or lead.get("categoria") or ""), name, html or ""]
    sector_hits = detect_sector_hits("\n".join(text_parts), sector_keywords)
    if sector_hits:
        lead["business_sector_hits"] = sector_hits
        apply_signals_to_lead(
            lead,
            [
                _make_signal(
                    "sector_investment",
                    f"Investimento settore — {sector_hits[0].get('keyword', '')}",
                    severity="medium",
                    confidence=70,
                    evidence=[{"label": "Keyword", "value": h.get("keyword", ""), "source": "mirax_audit"} for h in sector_hits[:2]],
                )
            ],
        )

    signals: List[Dict[str, Any]] = []
    signals.extend(detect_signals_from_audit(lead))
    signals.extend(detect_registry_signals_from_lead(lead))

    if "crm_installed" in intent_types or "crm_change" in intent_types:
        signals.extend(detect_crm_signal(lead))
    if "investing_marketing" in intent_types:
        signals.extend(detect_marketing_investment_signal(lead))

    if not _lead_has_valid_website(lead):
        try:
            fallback = await enrich_poor_lead_fallback(lead, location)
            signals.extend(fallback)
        except Exception:
            pass

    if not skip_external:
        try:
            external = await asyncio.wait_for(
                enrich_lead_external_signals(
                    lead,
                    location,
                    want_hiring=want_hiring or ("hiring" in intent_types),
                    want_tender=want_tender or ("tender_won" in intent_types),
                    hiring_roles=intent_roles,
                ),
                timeout=14.0,
            )
            signals.extend(external)
        except Exception:
            pass

    if old_lead and isinstance(old_lead, dict):
        merge_crm_change_events(old_lead, lead)

    # Dedupe by type+title
    seen: Set[str] = set()
    unique: List[Dict[str, Any]] = []
    for s in signals:
        key = f"{s.get('type')}::{s.get('title')}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)

    apply_signals_to_lead(lead, unique)
    if not skip_external:
        lead["business_events_external_at"] = _utc_now_iso()
    lead["business_events_enriched_at"] = _utc_now_iso()
    return lead


def enrich_lead_audit_only(lead: Dict[str, Any], intent: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Fase sync pre-completed — solo audit, zero network."""
    intent_types = _intent_signal_types(intent)
    signals: List[Dict[str, Any]] = []
    signals.extend(detect_signals_from_audit(lead))
    signals.extend(detect_registry_signals_from_lead(lead))
    if "crm_installed" in intent_types or "crm_change" in intent_types:
        signals.extend(detect_crm_signal(lead))
    if "investing_marketing" in intent_types:
        signals.extend(detect_marketing_investment_signal(lead))
    if not signals and not _lead_has_valid_website(lead) and _lead_piva(lead):
        lead.setdefault("enrich_note", "no_website_piva_only")
    text_parts = [str(lead.get("category") or lead.get("categoria") or ""), _lead_name(lead)]
    intent_sectors = _intent_sector_keywords(intent)
    sector_hits = detect_sector_hits("\n".join(text_parts), intent_sectors)
    if sector_hits:
        lead["business_sector_hits"] = sector_hits
    apply_signals_to_lead(lead, signals)
    lead["business_events_audit_at"] = _utc_now_iso()
    return signals


def merge_crm_change_events(old: Dict[str, Any], new: Dict[str, Any]) -> List[Dict[str, Any]]:
    old_crms = set(old.get("detected_crm_stack") or [])
    new_crms = set(new.get("detected_crm_stack") or [])
    if old_crms == new_crms:
        return list(new.get("audit_changes") or [])
    changes = list(new.get("audit_changes") or [])
    if old_crms and new_crms and old_crms != new_crms:
        changes.append(
            {
                "field": "crm_stack",
                "label": "CRM",
                "from": sorted(old_crms),
                "to": sorted(new_crms),
                "detected_at": _utc_now_iso(),
                "signal": f"CRM cambiato: {', '.join(old_crms)} → {', '.join(new_crms)}",
            }
        )
    new["audit_changes"] = changes
    return changes


def count_lead_signals(lead: Dict[str, Any]) -> int:
    if isinstance(lead.get("business_signals"), list) and lead["business_signals"]:
        return len(lead["business_signals"])
    n = 0
    if lead.get("business_hiring_jobs"):
        n += 1
    if lead.get("business_tender_hits"):
        n += 1
    if lead.get("business_sector_hits"):
        n += 1
    if lead.get("detected_crm_stack"):
        n += 1
    return n


async def _enrich_one_lead_external(
    lead: Dict[str, Any],
    location: str,
    *,
    intent: Optional[Dict[str, Any]],
    intent_types: Set[str],
    intent_roles: List[str],
    supabase: Any,
    user_id: Optional[str],
    index: int,
) -> int:
    """Enrichment live singolo lead — ritorna count segnali."""
    use_wf = os.getenv("USE_WATERFALL_ENRICH", "1").strip().lower() in {"1", "true", "yes"}
    if use_wf:
        try:
            from waterfall_enrich import get_waterfall_enricher

            wf = get_waterfall_enricher(supabase)
            required = list(intent_types) if intent_types else [
                "hiring", "tender_won", "funding_received", "executive_change", "website_changed"
            ]
            await wf.enrich_lead(
                lead, location, required_signals=required, skip_audit=True, hiring_roles=intent_roles
            )
        except Exception as e:
            print(f"[enrich] waterfall external skip: {e}", flush=True)
    else:
        existing = list(lead.get("business_signals") or [])
        try:
            extra = await enrich_lead_external_signals(
                lead,
                location,
                want_hiring=("hiring" in intent_types) or (index < 8),
                want_tender=("tender_won" in intent_types) or True,
                hiring_roles=intent_roles,
            )
        except Exception:
            extra = []
        merged = existing + extra
        seen: Set[str] = set()
        unique: List[Dict[str, Any]] = []
        for s in merged:
            if not isinstance(s, dict):
                continue
            key = f"{s.get('type')}::{s.get('title')}"
            if key in seen:
                continue
            seen.add(key)
            unique.append(s)
        apply_signals_to_lead(lead, unique)
        lead["business_events_external_at"] = _utc_now_iso()
        lead["business_events_enriched_at"] = _utc_now_iso()
    if supabase and user_id:
        sigs = lead.get("business_signals") or []
        persist_signals_to_db(supabase, user_id, lead, sigs if isinstance(sigs, list) else [])
    n = count_lead_signals(lead)
    if n:
        name = _lead_name(lead)[:40]
        types = [s.get("type") if isinstance(s, dict) else "?" for s in (lead.get("business_signals") or [])[:3]]
        print(f"[enrich] '{name}' → {n} segnali ({', '.join(types)})", flush=True)
    return n


async def enrich_results_business_events(
    results: List[Dict[str, Any]],
    location: str,
    *,
    max_leads: int = 15,
    sector_keywords: Optional[List[str]] = None,
    supabase: Any = None,
    user_id: Optional[str] = None,
    audit_only: bool = False,
    external_only: bool = False,
    on_progress: Optional[Callable[[List[Dict[str, Any]], int], None]] = None,
    intent: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Enrichment batch post-audit."""
    if not results:
        return results
    cap = min(len(results), max(1, max_leads))
    intent_types = _intent_signal_types(intent)
    needs_external = intent_requires_external_enrichment(intent)
    batch = list(results[:cap])
    if needs_external:
        batch.sort(key=lambda l: (0 if _lead_has_valid_website(l) else 1))
    total_signals = 0

    if external_only and batch:
        os.environ["ENRICH_PARALLEL_WORKERS"] = os.getenv("ENRICH_PARALLEL_WORKERS", "6")
        workers = int(os.environ["ENRICH_PARALLEL_WORKERS"] or "6")
        workers = max(1, min(workers, 12))
        intent_roles = _intent_hiring_roles_full(intent)
        sem = asyncio.Semaphore(workers)
        done = 0

        async def _run_one(i: int, lead: Dict[str, Any]) -> int:
            nonlocal done, total_signals
            async with sem:
                try:
                    n = await _enrich_one_lead_external(
                        lead,
                        location,
                        intent=intent,
                        intent_types=intent_types,
                        intent_roles=intent_roles,
                        supabase=supabase,
                        user_id=user_id,
                        index=i,
                    )
                except Exception as e:
                    print(f"[enrich] lead error: {e}", flush=True)
                    n = 0
                done += 1
                total_signals += n
                if on_progress and done % 5 == 0:
                    on_progress(list(results), total_signals)
                return n

        await asyncio.gather(*[_run_one(i, lead) for i, lead in enumerate(batch)])
        if on_progress:
            on_progress(list(results), total_signals)
    else:
        for i, lead in enumerate(batch):
            try:
                if audit_only:
                    sigs = enrich_lead_audit_only(lead, intent=intent)
                    total_signals += len(sigs)
                else:
                    await enrich_lead_business_events(
                        lead,
                        location,
                        sector_keywords=sector_keywords,
                        skip_external=(i >= 8),
                        intent=intent,
                    )
                    total_signals += count_lead_signals(lead)
                if supabase and user_id:
                    sigs = lead.get("business_signals") or []
                    persist_signals_to_db(supabase, user_id, lead, sigs if isinstance(sigs, list) else [])
                if on_progress and (i + 1) % 2 == 0:
                    on_progress(list(results), total_signals)
            except Exception as e:
                print(f"[enrich] lead error: {e}", flush=True)

    phase = "audit" if audit_only else ("external" if external_only else "full")
    print(f"[enrich] Job batch ({phase}): {cap} lead, {total_signals} segnali totali", flush=True)
    return results
