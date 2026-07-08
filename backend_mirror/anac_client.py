"""ANAC Open Data client — local SQLite index for tender records.

ANAC CKAN no longer exposes datastore-active resources.  We maintain a local
SQLite index built from the monthly "aggiudicazioni" + "aggiudicatari" CSV
archives (see anac_indexer.py).  This module turns matching rows into MIRAX
signals.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import anac_indexer

logger = logging.getLogger(__name__)

BASE_URL = "https://dati.anticorruzione.it/opendata"


def _parse_amount(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    text = str(value).replace(".", "").replace(",", ".").strip()
    try:
        n = float(text)
        return int(n) if n > 0 else None
    except ValueError:
        return None


def _parse_date(value: Any) -> Optional[str]:
    from datetime import datetime

    if not value:
        return None
    text = str(value).strip()[:10]
    if __import__("re").match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _to_signal(record: Dict[str, Any], company_name: str) -> Dict[str, Any]:
    obj = str(record.get("object") or "Appalto pubblico")[:200]
    cig = str(record.get("cig") or "").strip().upper()
    amount = _parse_amount(record.get("amount"))
    date_str = _parse_date(record.get("date"))
    authority = str(record.get("authority") or "").strip()[:200]
    province = str(record.get("province") or "").strip()[:50]
    region = str(record.get("region") or "").strip()[:50]
    status = str(record.get("status") or "").strip().lower()
    role = str(record.get("role") or "").strip()

    evidence: List[Dict[str, Any]] = [
        {"label": "Fonte", "value": f"ANAC — {company_name}", "source": "anac_opendata", "url": BASE_URL, "company": company_name},
        {"label": "Oggetto", "value": obj, "source": "anac_opendata", "company": company_name},
    ]
    if cig:
        evidence.append({"label": "CIG", "value": cig, "source": "anac_opendata", "company": company_name})
    if amount:
        evidence.append({"label": "Importo", "value": f"{amount:,} EUR", "source": "anac_opendata", "company": company_name})
    if role:
        evidence.append({"label": "Ruolo", "value": role, "source": "anac_opendata", "company": company_name})

    signal: Dict[str, Any] = {
        "type": "tender_won",
        "title": f"Gara vinta: {obj[:80]}",
        "severity": "high",
        "confidence": 85 if cig else 75,
        "evidence": evidence,
        "source": "anac_opendata",
        "status": "confirmed",
        "entity_verified": True,
        "cig": cig,
        "object": obj,
        "amount": amount,
        "date": date_str,
        "authority": authority,
        "province": province,
        "region": region,
        "tender_status": status,
        "tender_source": "anac_opendata",
        "source_url": BASE_URL,
    }
    return signal


async def search_anac_tenders(company_name: str, *, cf: Optional[str] = None, max_records: int = 5) -> List[Dict[str, Any]]:
    """Search the local ANAC index for tenders won by company_name."""
    name = (company_name or "").strip()
    if len(name) < 3 and not (cf or "").strip():
        return []

    try:
        await asyncio.to_thread(anac_indexer.ensure_index)
        records = await asyncio.to_thread(
            anac_indexer.search_company,
            name,
            cf=cf,
            max_records=max_records,
        )
        if not records:
            return []
        return [_to_signal(r, name) for r in records]
    except Exception as exc:
        logger.debug("search_anac_tenders failed: %s", exc)
        return []


async def discover_anac_companies(
    keywords: List[str],
    *,
    location: str = "",
    max_records: int = 100,
) -> List[Dict[str, Any]]:
    """Return extraction-shaped tender winners for the agentic source lane."""
    try:
        path = await asyncio.to_thread(anac_indexer.ensure_index)
        records = await asyncio.to_thread(
            anac_indexer.discover_companies,
            keywords,
            location=location,
            max_records=max_records,
            db_path=path,
        )
    except Exception as exc:
        logger.warning("discover_anac_companies failed: %s", exc)
        return []

    leads: List[Dict[str, Any]] = []
    for record in records:
        name = str(record.get("company_name") or "").strip()
        if not name:
            continue
        signal = _to_signal(record, name)
        evidence = f"{signal.get('title', 'Gara vinta')}"
        amount = signal.get("amount")
        if amount:
            evidence += f" - importo EUR {amount:,}"
        leads.append(
            {
                "name": name,
                "website": "",
                "evidence": evidence[:300],
                "matched_signals": ["tender_won"],
                "source_url": BASE_URL,
                "partita_iva": str(record.get("cf") or "").strip(),
                "evidence_date": str(signal.get("date") or ""),
                "structured_signal": signal,
            }
        )
    return leads
