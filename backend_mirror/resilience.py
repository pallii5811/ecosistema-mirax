"""
MIRAX v5 — Resilience helpers: emergency unknown signals, shared monitor/cache.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from health_monitor import get_health_monitor
from universal_cache import get_universal_cache

SIGNAL_LABELS: Dict[str, str] = {
    "hiring": "Assunzioni",
    "tender_won": "Gare pubbliche",
    "funding_received": "Finanziamenti",
    "executive_change": "Cambi management",
    "registry_change": "Dati registro",
    "website_changed": "Sito modificato",
    "funding_news": "Notizie",
}


def emergency_mock(signal_type: str, company_name: str) -> Dict[str, Any]:
    """Unknown signal when all sources fail — lead stays visible."""
    label = SIGNAL_LABELS.get(signal_type, signal_type.replace("_", " ").title())
    return {
        "type": signal_type,
        "title": f"{label}: dato non disponibile per {company_name[:60]}",
        "severity": "medium",
        "confidence": 0,
        "status": "unknown",
        "retry_after_minutes": 30,
        "evidence": [
            {
                "label": "Stato",
                "value": "Fonti dati temporaneamente non raggiungibili o nessun match verificato",
                "source": "system",
                "url": None,
            }
        ],
        "source": "system",
    }


def enrich_cache_key(lead: Dict[str, Any], signal_type: str, location: str) -> str:
    name = ""
    for key in ("business_name", "azienda", "nome", "name"):
        name = str(lead.get(key) or "").strip()
        if name:
            break
    piva = ""
    for key in ("partita_iva", "piva"):
        raw = str(lead.get(key) or "")
        if raw:
            piva = raw
            break
    return f"{name}|{piva}|{location}|{signal_type}"


def attach_unknown_if_empty(
    lead: Dict[str, Any],
    signal_type: str,
    signals: List[Dict[str, Any]],
    *,
    required: bool = False,
) -> List[Dict[str, Any]]:
    """Add emergency mock when no validated signal exists for type."""
    has_type = any(isinstance(s, dict) and s.get("type") == signal_type for s in signals)
    if has_type or not required:
        return signals
    name = ""
    for key in ("business_name", "azienda", "nome", "name"):
        name = str(lead.get(key) or "").strip()
        if name:
            break
    if not name:
        name = "azienda"
    out = list(signals)
    out.append(emergency_mock(signal_type, name))
    return out


def get_resilience_status() -> Dict[str, Any]:
    return {
        "health": get_health_monitor().get_status(),
        "cache_entries": len(get_universal_cache()._memory),
    }
