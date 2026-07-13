"""Public-tender relation extraction (ANAC + TED fallback).

The module is intentionally synchronous so it can be plugged into the
synchronous ``ingest_mirax_lead`` pipeline without an event-loop dance.
Network failures are swallowed and an empty result is returned.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx

from ..models import UniverseObservation, UniverseRelationship
from ..repository import UniverseRepository
from .business_signal_relations import _extract_tender_relations

logger = logging.getLogger(__name__)

ANAC_BASE_URL = "https://dati.anticorruzione.it/opendata"
ANAC_API_URL = f"{ANAC_BASE_URL}/api/3/action"

PACKAGE_QUERY_KEYWORDS = [
    "contratti",
    "appalti",
    "gare",
    "aggiudicazioni",
    "bandi",
    "pubblici",
]

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class TenderRelationsError(Exception):
    pass


def _headers() -> Dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "it-IT,it;q=0.9",
        "Referer": ANAC_BASE_URL + "/",
    }


def _normalize_record(record: Dict[str, Any]) -> Dict[str, Any]:
    return {str(k).lower().strip(): v for k, v in record.items() if isinstance(k, str)}


def _record_value(record: Dict[str, Any], *keys: str) -> Any:
    norm = _normalize_record(record)
    for k in keys:
        if k in norm and norm[k] is not None:
            return norm[k]
    return None


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
    if not value:
        return None
    text = str(value).strip()[:10]
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _to_signal(record: Dict[str, Any], company_name: str) -> Dict[str, Any]:
    """Convert a raw ANAC record into a MIRAX-style business signal."""
    obj = str(_record_value(record, "oggetto", "oggetto_gara", "descrizione") or "Appalto pubblico")[:200]
    cig = str(_record_value(record, "cig") or "").strip().upper()
    amount = _parse_amount(_record_value(record, "importo_aggiudicazione", "importo", "importo_complessivo"))
    date_str = _parse_date(_record_value(record, "data_aggiudicazione", "data_pubblicazione", "data"))
    authority = str(_record_value(record, "denominazione_amministrazione", "stazione_appaltante", "amministrazione") or "").strip()[:200]
    province = str(_record_value(record, "provincia", "provincia_amministrazione") or "").strip()[:50]
    region = str(_record_value(record, "regione", "regione_amministrazione") or "").strip()[:50]
    status = str(_record_value(record, "stato", "esito") or "").strip().lower()

    evidence: List[Dict[str, Any]] = [
        {"label": "Fonte", "value": f"ANAC — {company_name}", "source": "anac_opendata", "url": ANAC_BASE_URL, "company": company_name},
        {"label": "Oggetto", "value": obj, "source": "anac_opendata", "company": company_name},
    ]
    if cig:
        evidence.append({"label": "CIG", "value": cig, "source": "anac_opendata", "company": company_name})
    if amount:
        evidence.append({"label": "Importo", "value": f"{amount:,} EUR", "source": "anac_opendata", "company": company_name})

    return {
        "type": "tender_won",
        "signalType": "tender_won",
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
        "tender_source": "anac_opendata",
        "source_url": ANAC_BASE_URL,
        "status_detail": status,
    }


def _api_get(
    client: httpx.Client,
    action: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 20.0,
) -> Optional[Dict[str, Any]]:
    url = f"{ANAC_API_URL}/{action}"
    try:
        resp = client.get(url, params=params or {}, headers=_headers(), timeout=timeout)
        if resp.status_code != 200:
            return None
        ctype = (resp.headers.get("content-type") or "").lower()
        if "json" not in ctype:
            return None
        data = resp.json()
        if not data.get("success"):
            return None
        return data.get("result")
    except Exception as exc:  # noqa: BLE001
        logger.debug("ANAC %s failed: %s", action, exc)
        return None


def _discover_datastore_resource_ids(
    client: httpx.Client, max_keywords: int = 6
) -> List[str]:
    resource_ids: List[str] = []
    seen_packages: Set[str] = set()

    for keyword in PACKAGE_QUERY_KEYWORDS[:max_keywords]:
        result = _api_get(client, "package_search", {"q": keyword, "rows": 20})
        if not result:
            continue
        for pkg in result.get("results", []) or []:
            if not isinstance(pkg, dict):
                continue
            name = pkg.get("name") or pkg.get("id")
            if not name or name in seen_packages:
                continue
            seen_packages.add(name)
            pkg_detail = _api_get(client, "package_show", {"id": name})
            if not pkg_detail:
                continue
            for res in pkg_detail.get("resources", []) or []:
                if isinstance(res, dict) and res.get("datastore_active") and res.get("id"):
                    resource_ids.append(str(res["id"]))

    return resource_ids


def search_anac_tenders_sync(company_name: str, *, max_records: int = 5) -> List[Dict[str, Any]]:
    """Search ANAC OpenData for tender records matching ``company_name``.

    Returns a list of MIRAX-style business signals (``type == "tender_won"``).
    """
    name = (company_name or "").strip()
    if len(name) < 3:
        return []

    try:
        with httpx.Client(follow_redirects=True) as client:
            resource_ids = _discover_datastore_resource_ids(client)
            if not resource_ids:
                logger.debug("ANAC: no datastore resources discovered")
                return []

            cutoff = datetime.now() - timedelta(days=365 * 2)
            name_lower = name.lower()[:15]
            seen_cig: Set[str] = set()
            matched_records: List[Dict[str, Any]] = []

            for resource_id in resource_ids[:10]:
                result = _api_get(
                    client,
                    "datastore_search",
                    {"resource_id": resource_id, "q": name[:40], "limit": 20},
                )
                if not result:
                    continue
                records = result.get("records") or []
                for r in records:
                    if not isinstance(r, dict):
                        continue
                    blob = " ".join(str(v) for v in r.values()).lower()
                    if name_lower not in blob:
                        continue
                    date_val = _record_value(r, "data_aggiudicazione", "data_pubblicazione", "data")
                    date_str = _parse_date(date_val)
                    try:
                        if date_str and datetime.strptime(date_str, "%Y-%m-%d") < cutoff:
                            continue
                    except ValueError:
                        pass
                    cig = str(_record_value(r, "cig") or "").strip().upper()
                    if cig and cig in seen_cig:
                        continue
                    if cig:
                        seen_cig.add(cig)
                    matched_records.append(r)

            if not matched_records:
                return []

            def _sort_key(rec: Dict[str, Any]) -> tuple:
                dv = _parse_date(_record_value(rec, "data_aggiudicazione", "data_pubblicazione", "data")) or "1970-01-01"
                amt = _parse_amount(_record_value(rec, "importo_aggiudicazione", "importo", "importo_complessivo")) or 0
                return (dv, amt)

            matched_records.sort(key=_sort_key, reverse=True)
            return [_to_signal(r, name) for r in matched_records[:max_records]]
    except Exception as exc:  # noqa: BLE001
        logger.debug("search_anac_tenders_sync failed: %s", exc)
        return []


def extract_tender_relations(
    repo: UniverseRepository,
    company_id: str,
    company_name: str,
    source: str,
    observed_at: str,
    max_records: int = 5,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    """Extract tender relationships from ANAC for ``company_name``.

    Creates ``tender`` entities plus ``awarded_to``/``awarded_by`` edges,
    and mirrors ``customer_of``/``has_customer`` between the company and
    the awarding public body.
    """
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    if not company_name or len(company_name.strip()) < 3:
        return observations, relationships

    signals = search_anac_tenders_sync(company_name, max_records=max_records)
    if not signals:
        return observations, relationships

    for signal in signals:
        try:
            sig_obs, sig_rels = _extract_tender_relations(
                repo, company_id, signal, source, observed_at
            )
            observations.extend(sig_obs)
            relationships.extend(sig_rels)
        except Exception as exc:  # noqa: BLE001
            logger.warning("tender_relations skip signal: %s", exc)
            continue

    return observations, relationships
