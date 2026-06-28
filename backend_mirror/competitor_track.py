#!/usr/bin/env python3
"""
Fase 10 — competitor signal tracking via waterfall enrichment.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

DEFAULT_TRACKED = ["hiring", "tender_won", "funding_received"]


async def track_competitor(competitor: Dict[str, Any], location: str = "") -> Dict[str, Any]:
    """Run MIRAX waterfall on a competitor record (same engine as leads)."""
    name = str(competitor.get("name") or competitor.get("nome") or "").strip()
    website = str(competitor.get("website") or competitor.get("sito") or "").strip()
    city = str(competitor.get("city") or competitor.get("citta") or location or "").strip()
    category = str(competitor.get("category") or competitor.get("categoria") or "").strip()
    tracked = competitor.get("tracked_signals") or DEFAULT_TRACKED
    if not isinstance(tracked, list):
        tracked = DEFAULT_TRACKED

    lead: Dict[str, Any] = {
        "azienda": name,
        "nome": name,
        "name": name,
        "sito": website,
        "website": website,
        "citta": city,
        "city": city,
        "categoria": category,
        "category": category,
    }

    if not name:
        return {"ok": False, "error": "name required", "signals": []}

    loc = city or location or "Italia"
    signals: List[Dict[str, Any]] = []

    try:
        from waterfall_enrich import WaterfallEnricher

        enricher = WaterfallEnricher()
        max_types = int(os.getenv("COMPETITOR_TRACK_MAX_SIGNALS", "3") or "3")
        targets = [str(t) for t in tracked[:max_types] if t]
        signals = await enricher.enrich_lead(lead, loc, required_signals=targets or None)
        lead["business_signals"] = signals
    except Exception as e:
        print(f"[competitor_track] waterfall skip: {e}", flush=True)
        try:
            from business_events_enrich import (
                detect_hiring_signal,
                detect_tender_signals,
                detect_signals_from_audit,
            )

            audit_signals = detect_signals_from_audit(lead)
            signals.extend(audit_signals or [])
            hiring = await detect_hiring_signal(lead, loc)
            if hiring:
                signals.extend(hiring)
            tender = detect_tender_signals(lead, loc)
            if tender:
                signals.extend(tender)
            lead["business_signals"] = signals
        except Exception as e2:
            print(f"[competitor_track] fallback skip: {e2}", flush=True)

    return {
        "ok": True,
        "signals": signals,
        "lead": lead,
        "tracked": tracked,
    }
