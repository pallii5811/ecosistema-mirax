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
from typing import Any, Callable, Dict, List, Optional, Set
from urllib.parse import quote

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
    return str(lead.get("business_name") or lead.get("azienda") or "").strip()


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
) -> Dict[str, Any]:
    ev = evidence or []
    source = ev[0].get("source", "mirax_audit") if ev else "mirax_audit"
    return {
        "type": signal_type,
        "title": title,
        "severity": severity if severity in {"critical", "high", "medium"} else "medium",
        "confidence": max(0, min(100, int(confidence))),
        "evidence": ev,
        "source": source,
    }


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
                "crm_detected",
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


async def detect_hiring_signal(company_name: str, city: str) -> List[Dict[str, Any]]:
    """Indeed IT via HTTP — no Playwright."""
    name = (company_name or "").strip()
    loc = (city or "").strip().split(",")[0].strip() or "Italia"
    if len(name) < 2:
        return []
    try:
        import httpx

        await asyncio.sleep(random.uniform(1.5, 3.0))
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
                jobs.append({"title": title[:200], "source": "indeed_it", "date": _utc_now_iso()})
                if len(jobs) >= 3:
                    break
        except ImportError:
            for m in re.finditer(r'class="jobTitle"[^>]*>.*?<span[^>]*>([^<]{5,200})</span>', html, re.S | re.I):
                title = re.sub(r"\s+", " ", m.group(1)).strip()
                if title:
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
                evidence=[{"label": "Fonte", "value": f"Indeed IT — {len(jobs)} annunci", "source": "indeed_it", "url": url}],
            )
        ]
    except Exception as e:
        print(f"[enrich] Indeed error per {name[:30]}: {e}", flush=True)
        return []


async def detect_tender_signals(company_name: str) -> List[Dict[str, Any]]:
    """ANAC Open Data — best effort."""
    name = (company_name or "").strip()
    if len(name) < 3:
        return []
    try:
        import httpx

        url = "https://dati.anticorruzione.it/opendata/api/3/action/datastore_search"
        params = {"q": name[:40], "limit": 8}
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                return []
            data = resp.json() or {}
        records = (data.get("result") or {}).get("records") or []
        if not records:
            return []

        cutoff = datetime.now() - timedelta(days=365)
        name_lower = name.lower()[:15]
        recent: List[Dict[str, Any]] = []
        for r in records:
            if not isinstance(r, dict):
                continue
            blob = " ".join(str(v) for v in r.values()).lower()
            if name_lower not in blob:
                continue
            date_str = str(r.get("DATA_AGGIUDICAZIONE") or r.get("data_aggiudicazione") or r.get("data") or "")[:10]
            try:
                if date_str and datetime.strptime(date_str, "%Y-%m-%d") < cutoff:
                    continue
            except ValueError:
                pass
            recent.append(r)

        if not recent:
            return []

        obj = str(recent[0].get("OGGETTO") or recent[0].get("oggetto") or "Appalto pubblico")[:80]
        return [
            _make_signal(
                "tender_won",
                f"Gara vinta: {obj}",
                severity="high",
                confidence=80,
                evidence=[
                    {
                        "label": "Fonte",
                        "value": "ANAC — Autorità Nazionale Anticorruzione",
                        "source": "anac_opendata",
                        "url": "https://dati.anticorruzione.it/opendata",
                    }
                ],
            )
        ]
    except Exception as e:
        print(f"[enrich] ANAC error per {name[:30]}: {e}", flush=True)
        return []


def apply_signals_to_lead(lead: Dict[str, Any], signals: List[Dict[str, Any]]) -> None:
    """Popola campi legacy sul lead per badge UI."""
    if not signals:
        return
    lead["business_signals"] = signals
    for sig in signals:
        st = sig.get("type")
        if st == "hiring":
            jobs = lead.get("business_hiring_jobs")
            if not isinstance(jobs, list):
                lead["business_hiring_jobs"] = [{"title": sig.get("title", ""), "source": "indeed_it", "date": _utc_now_iso()}]
        elif st == "tender_won":
            lead["business_tender_hits"] = [{"title": sig.get("title", ""), "source": "anac_opendata", "date": _utc_now_iso()}]
        elif st == "sector_investment":
            lead["business_sector_hits"] = lead.get("business_sector_hits") or [{"keyword": "sector", "snippet": sig.get("title", "")}]


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


async def enrich_lead_external_signals(
    lead: Dict[str, Any],
    location: str,
    *,
    want_hiring: bool = True,
    want_tender: bool = True,
) -> List[Dict[str, Any]]:
    """Fonti esterne — parallelo con timeout."""
    name = _lead_name(lead)
    piva = _lead_piva(lead)
    tasks = []
    if want_hiring and name:
        tasks.append(asyncio.wait_for(detect_hiring_signal(name, location), timeout=12.0))
    if want_tender and name:
        tasks.append(asyncio.wait_for(detect_tender_signals(name), timeout=10.0))
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
) -> Dict[str, Any]:
    """Arricchisce un singolo lead — non solleva eccezioni."""
    name = _lead_name(lead)

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

    if not skip_external:
        try:
            external = await asyncio.wait_for(
                enrich_lead_external_signals(lead, location, want_hiring=want_hiring, want_tender=want_tender),
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
    lead["business_events_enriched_at"] = _utc_now_iso()
    return lead


def enrich_lead_audit_only(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fase sync pre-completed — solo audit, zero network."""
    signals: List[Dict[str, Any]] = []
    signals.extend(detect_signals_from_audit(lead))
    signals.extend(detect_registry_signals_from_lead(lead))
    text_parts = [str(lead.get("category") or lead.get("categoria") or ""), _lead_name(lead)]
    sector_hits = detect_sector_hits("\n".join(text_parts))
    if sector_hits:
        lead["business_sector_hits"] = sector_hits
    apply_signals_to_lead(lead, signals)
    lead["business_events_enriched_at"] = _utc_now_iso()
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
) -> List[Dict[str, Any]]:
    """Enrichment batch post-audit."""
    if not results:
        return results
    cap = min(len(results), max(1, max_leads))
    total_signals = 0
    for i, lead in enumerate(results[:cap]):
        try:
            if audit_only:
                sigs = enrich_lead_audit_only(lead)
                total_signals += len(sigs)
            elif external_only:
                existing = list(lead.get("business_signals") or [])
                try:
                    extra = await enrich_lead_external_signals(lead, location, want_hiring=(i < 8), want_tender=True)
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
                lead["business_events_enriched_at"] = _utc_now_iso()
                total_signals += count_lead_signals(lead)
            else:
                await enrich_lead_business_events(
                    lead,
                    location,
                    sector_keywords=sector_keywords,
                    skip_external=(i >= 8),
                )
                total_signals += count_lead_signals(lead)
            if supabase and user_id:
                sigs = lead.get("business_signals") or []
                persist_signals_to_db(supabase, user_id, lead, sigs if isinstance(sigs, list) else [])
            name = _lead_name(lead)[:40]
            n = count_lead_signals(lead)
            if n:
                types = [s.get("type") if isinstance(s, dict) else "?" for s in (lead.get("business_signals") or [])[:3]]
                print(f"[enrich] '{name}' → {n} segnali ({', '.join(types)})", flush=True)
            if on_progress and (i + 1) % 2 == 0:
                on_progress(list(results), total_signals)
        except Exception as e:
            print(f"[enrich] lead error: {e}", flush=True)
    phase = "audit" if audit_only else ("external" if external_only else "full")
    print(f"[enrich] Job batch ({phase}): {cap} lead, {total_signals} segnali totali", flush=True)
    return results
