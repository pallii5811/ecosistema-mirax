"""
MIRAX Fase 5 — Waterfall Enrichment Engine.
Cascata intelligente tra fonti per segnali d'acquisto.
"""
from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
import os
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlparse

from business_events_enrich import (
    _lead_name,
    _lead_piva,
    _lead_website,
    _make_signal,
    _utc_now_iso,
    apply_signals_to_lead,
    detect_hiring_signal,
    detect_hiring_via_website,
    detect_registry_signals_api,
    detect_registry_signals_from_lead,
    detect_signals_from_audit,
    detect_tender_signals,
)
from entity_matcher import validate_signal_for_lead
from health_monitor import get_health_monitor
from resilience import enrich_cache_key, emergency_mock
from universal_cache import get_universal_cache

# ── Registry (mirror TypeScript src/lib/signals/registry.ts) ───────────────

SIGNAL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "hiring": {
        "sources": [
            {"name": "mirax_audit", "timeout_ms": 500},
            {"name": "indeed_it", "timeout_ms": 5000},
            {"name": "infojobs_it", "timeout_ms": 5000},
            {"name": "google_jobs", "timeout_ms": 6000},
            {"name": "linkedin_jobs", "timeout_ms": 5000},
            {"name": "website_careers", "timeout_ms": 8000},
        ],
        "max_sources_to_try": 5,
        "parallel": False,
    },
    "tender_won": {
        "sources": [
            {"name": "mirax_audit", "timeout_ms": 500},
            {"name": "anac_opendata", "timeout_ms": 60000},
            {"name": "ted_europa", "timeout_ms": 10000},
        ],
        "max_sources_to_try": 3,
        "parallel": False,
    },
    "funding_received": {
        "sources": [
            {"name": "news_api", "timeout_ms": 4000},
            {"name": "google_news_scrape", "timeout_ms": 4000},
        ],
        "max_sources_to_try": 2,
        "parallel": True,
    },
    "executive_change": {
        "sources": [
            {"name": "news_api", "timeout_ms": 4000},
        ],
        "max_sources_to_try": 2,
        "parallel": True,
    },
    "website_changed": {
        "sources": [{"name": "mirax_diff_engine", "timeout_ms": 2000}],
        "max_sources_to_try": 1,
        "parallel": False,
    },
    "site_stale": {"sources": [{"name": "mirax_audit", "timeout_ms": 500}], "max_sources_to_try": 1, "parallel": False},
    "google_ads_started": {"sources": [{"name": "mirax_audit", "timeout_ms": 500}], "max_sources_to_try": 1, "parallel": False},
    "meta_ads_started": {"sources": [{"name": "mirax_audit", "timeout_ms": 500}], "max_sources_to_try": 1, "parallel": False},
    "crm_installed": {"sources": [{"name": "mirax_audit", "timeout_ms": 500}], "max_sources_to_try": 1, "parallel": False},
    "registry_change": {
        "sources": [
            {"name": "mirax_audit", "timeout_ms": 500},
            {"name": "openapi_cciaa", "timeout_ms": 5000},
        ],
        "max_sources_to_try": 2,
        "parallel": False,
    },
}

# In-memory fallback snapshot store (production: Supabase website_snapshots)
_WEBSITE_SNAPSHOTS: Dict[str, str] = {}


def _snapshot_url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _load_snapshot(supabase_client: Any, url_hash: str) -> Optional[str]:
    if supabase_client is None:
        return _WEBSITE_SNAPSHOTS.get(url_hash)
    try:
        resp = (
            supabase_client.table("website_snapshots")
            .select("snapshot_text")
            .eq("url_hash", url_hash)
            .maybe_single()
            .execute()
        )
        data = resp.data if resp else None
        return data.get("snapshot_text") if data else None
    except Exception as e:
        print(f"[snapshot] load error: {e}", flush=True)
        return _WEBSITE_SNAPSHOTS.get(url_hash)


def _save_snapshot(supabase_client: Any, url_hash: str, url: str, text: str) -> None:
    _WEBSITE_SNAPSHOTS[url_hash] = text
    if supabase_client is None:
        return
    try:
        html_hash = hashlib.sha256((text or "").encode("utf-8")).hexdigest()
        supabase_client.table("website_snapshots").upsert(
            {"url_hash": url_hash, "lead_website": url, "url": url, "snapshot_text": text, "html_hash": html_hash},
            on_conflict="url_hash",
        ).execute()
    except Exception as e:
        print(f"[snapshot] save error: {e}", flush=True)


class EnrichmentSource(ABC):
    name: str = "base"

    @abstractmethod
    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        ...


class AuditSource(EnrichmentSource):
    name = "mirax_audit"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        all_sigs = detect_signals_from_audit(lead)
        all_sigs.extend(detect_registry_signals_from_lead(lead))
        if signal_type == "all":
            return all_sigs
        return [s for s in all_sigs if s.get("type") == signal_type]


class IndeedSource(EnrichmentSource):
    name = "indeed_it"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "hiring":
            return []
        roles = lead.get("_hiring_roles")
        return await detect_hiring_signal(_lead_name(lead), location, roles=roles)


class InfojobsSource(EnrichmentSource):
    name = "infojobs_it"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "hiring":
            return []
        from hiring_sources import detect_hiring_via_infojobs_it

        roles = lead.get("_hiring_roles")
        return await detect_hiring_via_infojobs_it(_lead_name(lead), location, roles=roles)


class GoogleJobsSource(EnrichmentSource):
    name = "google_jobs"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "hiring":
            return []
        from hiring_sources import detect_hiring_via_google_jobs

        roles = lead.get("_hiring_roles")
        return await detect_hiring_via_google_jobs(_lead_name(lead), location, roles=roles)


class LinkedInJobsSource(EnrichmentSource):
    name = "linkedin_jobs"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "hiring":
            return []
        from hiring_sources import detect_hiring_via_linkedin_jobs

        roles = lead.get("_hiring_roles")
        return await detect_hiring_via_linkedin_jobs(_lead_name(lead), location, roles=roles)


class InfojobsLegacySource(EnrichmentSource):
    """Alias legacy infojobs → infojobs_it."""
    name = "infojobs"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        return await InfojobsSource().fetch(lead, signal_type, location)


class WebsiteCareersSource(EnrichmentSource):
    name = "website_careers"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "hiring":
            return []
        roles = lead.get("_hiring_roles")
        return await detect_hiring_via_website(lead, roles=roles)


class ANACSource(EnrichmentSource):
    name = "anac_opendata"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "tender_won":
            return []
        return await detect_tender_signals(_lead_name(lead), cf=_lead_piva(lead))


class TEDSource(EnrichmentSource):
    name = "ted_europa"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "tender_won":
            return []
        name = _lead_name(lead)
        if len(name) < 3:
            return []
        try:
            import httpx

            url = "https://ted.europa.eu/api/v2.0/notices/search"
            payload = {"query": name[:40], "page": 1, "limit": 5, "scope": "ALL", "language": "IT"}
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(url, json=payload, headers={"Accept": "application/json"})
                if resp.status_code != 200:
                    return []
                data = resp.json() or {}
            notices = data.get("notices") or data.get("results") or []
            if not notices:
                return []
            title = str(notices[0].get("title") or notices[0].get("TI") or "Appalto pubblico UE")[:80]
            return [
                _make_signal(
                    "tender_won",
                    f"Gara UE: {title}",
                    severity="high",
                    confidence=78,
                    evidence=[
                        {
                            "label": "Fonte",
                            "value": "TED Europa",
                            "source": "ted_europa",
                            "url": "https://ted.europa.eu/",
                        }
                    ],
                )
            ]
        except Exception as e:
            print(f"[waterfall] ted skip: {e}", flush=True)
            return []


class OpenAPISource(EnrichmentSource):
    name = "openapi_cciaa"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type != "registry_change":
            return []
        piva = _lead_piva(lead)
        if not piva:
            return []
        return await detect_registry_signals_api(piva)


class NewsAPISource(EnrichmentSource):
    name = "news_api"

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        name = _lead_name(lead)
        if len(name) < 3:
            return []
        key = os.getenv("NEWS_API_KEY") or os.getenv("GNEWS_API_KEY") or ""
        if not key:
            return await self._gnews_free(name, signal_type)
        try:
            import httpx

            keywords = {
                "funding_received": "funding OR investimento OR round",
                "executive_change": "CEO OR CTO OR amministratore delegato",
                "partnership": "partnership OR accordo OR collaborazione",
            }
            extra = keywords.get(signal_type, "news")
            q = quote(f'"{name}" {extra}')
            url = f"https://newsapi.org/v2/everything?q={q}&language=it&pageSize=3&sortBy=publishedAt"
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(url, headers={"X-Api-Key": key})
                if resp.status_code != 200:
                    return []
                articles = (resp.json() or {}).get("articles") or []
            if not articles:
                return []
            art = articles[0]
            stype = signal_type if signal_type in {"funding_received", "executive_change", "partnership"} else "funding_news"
            return [
                _make_signal(
                    stype,
                    str(art.get("title") or "Notizia rilevante")[:120],
                    severity="high",
                    confidence=72,
                    evidence=[
                        {
                            "label": "Fonte",
                            "value": str(art.get("source", {}).get("name") or "NewsAPI"),
                            "source": "news_api",
                            "url": str(art.get("url") or ""),
                        }
                    ],
                )
            ]
        except Exception as e:
            print(f"[waterfall] news_api skip: {e}", flush=True)
            return []

    async def _gnews_free(self, name: str, signal_type: str) -> List[Dict[str, Any]]:
        try:
            import httpx

            q = quote(f"{name} Italia")
            url = f"https://gnews.io/api/v4/search?q={q}&lang=it&max=2&token=demo"
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return []
                articles = (resp.json() or {}).get("articles") or []
            if not articles:
                return []
            art = articles[0]
            stype = signal_type if signal_type in {"funding_received", "executive_change"} else "funding_news"
            return [
                _make_signal(
                    stype,
                    str(art.get("title") or "")[:120],
                    severity="medium",
                    confidence=60,
                    evidence=[{"label": "Fonte", "value": "GNews", "source": "news_api", "url": str(art.get("url") or "")}],
                )
            ]
        except Exception:
            return []


class WebsiteDiffSource(EnrichmentSource):
    name = "mirax_diff_engine"

    def __init__(self, supabase_client: Any = None) -> None:
        self.supabase_client = supabase_client

    async def fetch(self, lead: Dict[str, Any], signal_type: str, location: str = "") -> List[Dict[str, Any]]:
        if signal_type not in {"website_changed", "price_change"}:
            return []
        website = _lead_website(lead)
        if not website or website in {"none", "n/a"}:
            return []
        try:
            import httpx

            url = website if website.startswith("http") else f"https://{website}"
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "MIRAX-Diff/1.0"})
                if resp.status_code != 200:
                    return []
                html = resp.text or ""
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))[:8000]
            key = _snapshot_url_hash(url)
            prev = _load_snapshot(self.supabase_client, key)
            _save_snapshot(self.supabase_client, key, url, text)
            if not prev:
                return []
            ratio = difflib.SequenceMatcher(None, prev[:4000], text[:4000]).ratio()
            if ratio > 0.92:
                return []
            diff_lines = list(difflib.unified_diff(prev.split()[:200], text.split()[:200], lineterm="", n=0))[:8]
            summary = " ".join(diff_lines)[:200] if diff_lines else "Contenuto modificato"
            return [
                _make_signal(
                    "website_changed",
                    "Sito web modificato significativamente",
                    severity="medium",
                    confidence=80,
                    evidence=[
                        {"label": "Diff", "value": summary[:180], "source": "mirax_diff_engine", "url": url},
                        {"label": "Similarity", "value": f"{ratio:.0%}", "source": "mirax_diff_engine"},
                    ],
                )
            ]
        except Exception as e:
            print(f"[waterfall] diff skip: {e}", flush=True)
            return []


class WaterfallEnricher:
    """Per ogni segnale, prova fonti in cascata con timeout rigido."""

    def __init__(self, supabase_client: Any = None) -> None:
        self.supabase_client = supabase_client
        self.sources: Dict[str, EnrichmentSource] = {
            "mirax_audit": AuditSource(),
            "indeed_it": IndeedSource(),
            "infojobs": InfojobsLegacySource(),
            "infojobs_it": InfojobsSource(),
            "google_jobs": GoogleJobsSource(),
            "linkedin_jobs": LinkedInJobsSource(),
            "website_careers": WebsiteCareersSource(),
            "company_careers_page": WebsiteCareersSource(),
            "anac_opendata": ANACSource(),
            "ted_europa": TEDSource(),
            "openapi_cciaa": OpenAPISource(),
            "news_api": NewsAPISource(),
            "mirax_diff_engine": WebsiteDiffSource(supabase_client),
        }
        self.monitor = get_health_monitor()
        self.cache = get_universal_cache()

    def _validate_signals(self, lead: Dict[str, Any], signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for sig in signals:
            if not isinstance(sig, dict):
                continue
            if validate_signal_for_lead(lead, sig):
                if "status" not in sig:
                    sig = dict(sig)
                    sig["status"] = "confirmed"
                out.append(sig)
        return out

    async def _fetch_source(
        self,
        lead: Dict[str, Any],
        source: EnrichmentSource,
        sig_type: str,
        location: str,
        timeout_s: float,
    ) -> List[Dict[str, Any]]:
        src_name = source.name
        if not self.monitor.should_try(src_name):
            print(f"[waterfall] skip {src_name} unhealthy/cooldown", flush=True)
            return []

        cache_q = enrich_cache_key(lead, sig_type, location)
        cached = self.cache.get(src_name, cache_q)
        if cached is not None:
            print(f"[waterfall] cache hit {src_name} {sig_type}", flush=True)
            return cached if isinstance(cached, list) else []

        start = time.time()
        try:
            signals = await asyncio.wait_for(source.fetch(lead, sig_type, location), timeout=timeout_s)
            elapsed_ms = (time.time() - start) * 1000
            validated = self._validate_signals(lead, signals or [])
            if validated:
                self.monitor.record_success(src_name, elapsed_ms)
                self.cache.set(src_name, cache_q, validated)
                return validated
            if signals:
                print(f"[waterfall] {src_name} results rejected by entity_match", flush=True)
            self.monitor.record_success(src_name, elapsed_ms)
            self.cache.set(src_name, cache_q, [])
            return []
        except asyncio.TimeoutError:
            self.monitor.record_failure(src_name)
            print(f"[waterfall] TIMEOUT {src_name} per {sig_type}", flush=True)
            return []
        except Exception as e:
            self.monitor.record_failure(src_name)
            print(f"[waterfall] ERROR {src_name}: {e}", flush=True)
            return []

    async def enrich_lead(
        self,
        lead: Dict[str, Any],
        location: str,
        required_signals: Optional[List[str]] = None,
        *,
        skip_audit: bool = False,
        hiring_roles: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        all_signals: List[Dict[str, Any]] = []

        if hiring_roles:
            lead["_hiring_roles"] = hiring_roles

        if not skip_audit:
            audit = await self.sources["mirax_audit"].fetch(lead, "all", location)
            all_signals.extend(audit)
        elif lead.get("business_signals"):
            all_signals.extend(list(lead.get("business_signals") or []))

        targets = required_signals or list(SIGNAL_REGISTRY.keys())
        external_targets = [t for t in targets if t not in {"site_stale", "google_ads_started", "meta_ads_started", "crm_detected"}]

        async def _waterfall_one(sig_type: str) -> List[Dict[str, Any]]:
            cfg = SIGNAL_REGISTRY.get(sig_type)
            if not cfg:
                return []
            found: List[Dict[str, Any]] = []
            for src_cfg in cfg["sources"][: cfg.get("max_sources_to_try", 2)]:
                if found and not cfg.get("parallel"):
                    break
                src_name = src_cfg["name"]
                if src_name == "mirax_audit":
                    continue  # già fatto
                source = self.sources.get(src_name)
                if not source:
                    continue
                timeout_s = src_cfg.get("timeout_ms", 4000) / 1000.0
                signals = await self._fetch_source(lead, source, sig_type, location, timeout_s)
                if signals:
                    print(f"[waterfall] {sig_type} → {src_name} OK ({len(signals)} segnali)", flush=True)
                    found.extend(signals)
                    if not cfg.get("parallel"):
                        break
                else:
                    print(f"[waterfall] {sig_type} → {src_name} empty, next", flush=True)
            # No emergency mocks: only real signals with evidence.
            return found

        if external_targets:
            parallel_cfg = [t for t in external_targets if SIGNAL_REGISTRY.get(t, {}).get("parallel")]
            serial_cfg = [t for t in external_targets if t not in parallel_cfg]

            if parallel_cfg:
                results = await asyncio.gather(*[_waterfall_one(t) for t in parallel_cfg], return_exceptions=True)
                for r in results:
                    if isinstance(r, list):
                        all_signals.extend(r)

            for st in serial_cfg:
                all_signals.extend(await _waterfall_one(st))

        # Dedupe
        seen: set[str] = set()
        unique: List[Dict[str, Any]] = []
        for s in all_signals:
            key = f"{s.get('type')}::{s.get('title')}"
            if key in seen:
                continue
            seen.add(key)
            unique.append(s)

        apply_signals_to_lead(lead, unique)
        lead["business_events_external_at"] = _utc_now_iso()
        lead["business_events_enriched_at"] = _utc_now_iso()
        return unique


_default_enricher: Optional[WaterfallEnricher] = None
_default_enricher_client: Any = None


def get_waterfall_enricher(supabase_client: Any = None) -> WaterfallEnricher:
    global _default_enricher, _default_enricher_client
    if _default_enricher is None or _default_enricher_client != supabase_client:
        _default_enricher = WaterfallEnricher(supabase_client)
        _default_enricher_client = supabase_client
    return _default_enricher
