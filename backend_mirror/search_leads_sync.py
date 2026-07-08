"""
Dual-write: searches.results (legacy JSONB) + search_leads (normalized).
Strangler Fig — isolato da worker_supabase.py (Phase 1.3).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

try:
    from entity_matcher import lead_city, lead_domain, lead_name, lead_piva, lead_phone, normalize_domain
except ImportError:
    lead_name = lead_city = lead_domain = lead_piva = lead_phone = None  # type: ignore
    normalize_domain = None  # type: ignore

logger = logging.getLogger("search_leads_sync")

UPSERT_CHUNK_SIZE = 100
_EMPTY = {"", "n/a", "n/d", "n.d.", "none", "null", "-", "?"}


def _pick_str(lead: Dict[str, Any], keys: tuple[str, ...]) -> Optional[str]:
    for k in keys:
        v = lead.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s and s.lower() not in _EMPTY:
            return s
    return None


def extract_website_domain(lead: Dict[str, Any]) -> Optional[str]:
    if normalize_domain and lead_domain:
        d = lead_domain(lead)
        return d or None
    raw = _pick_str(lead, ("sito", "website", "url")) or ""
    if not raw:
        return None
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = urlparse(raw).netloc or urlparse(raw).path
    except Exception:
        host = raw
    host = host.lower().replace("www.", "").split(":")[0].rstrip("/")
    return host or None


def extract_partita_iva(lead: Dict[str, Any]) -> Optional[str]:
    if lead_piva:
        p = lead_piva(lead)
        return p or None
    for key in ("partita_iva", "piva", "vat", "vat_number"):
        digits = re.sub(r"\D+", "", str(lead.get(key) or ""))
        if len(digits) == 11:
            return digits
    openapi = lead.get("openapi_enriched") or lead.get("openapi") or {}
    if isinstance(openapi, dict):
        for key in ("partita_iva", "piva", "vatCode"):
            digits = re.sub(r"\D+", "", str(openapi.get(key) or ""))
            if len(digits) == 11:
                return digits
    return None


def extract_has_pixel(lead: Dict[str, Any]) -> Optional[bool]:
    """None = audit non eseguito; True/False = esito."""
    tr = lead.get("technical_report")
    if isinstance(tr, dict) and tr:
        for key in ("has_meta_pixel", "has_facebook_pixel", "meta_pixel"):
            if key in tr and tr[key] is not None:
                return bool(tr[key])
    mp = lead.get("meta_pixel")
    if mp is None:
        stack = lead.get("tech_stack") or []
        if isinstance(stack, list):
            hay = " ".join(str(x).lower() for x in stack)
            if "verifica in corso" in hay or "audit in arrivo" in hay or "stack in arrivo" in hay:
                return None
        tr_empty = not (isinstance(tr, dict) and tr)
        tech_empty = not stack or (
            isinstance(stack, list)
            and len(stack) == 1
            and "verifica in corso" in str(stack[0]).lower()
        )
        if tr_empty and tech_empty:
            return None
        return None
    return bool(mp)


def build_dedupe_key(lead: Dict[str, Any], position: int) -> str:
    domain = extract_website_domain(lead)
    if domain:
        return f"web:{domain}"
    phone = (lead_phone(lead) if lead_phone else "") or _pick_str(lead, ("telefono", "phone")) or ""
    digits = re.sub(r"\D+", "", phone)
    if len(digits) >= 8:
        return f"tel:{digits[-9:]}"
    name = (lead_name(lead) if lead_name else None) or _pick_str(lead, ("azienda", "nome", "name", "company")) or ""
    city = (lead_city(lead) if lead_city else None) or _pick_str(lead, ("citta", "city", "localita")) or ""
    name_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    city_slug = re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-")[:30]
    if name_slug and city_slug:
        return f"name:{name_slug}:{city_slug}"
    if name_slug:
        return f"name:{name_slug}:{position}"
    return f"idx:{position}"


def _audit_status(lead: Dict[str, Any]) -> str:
    tr = lead.get("technical_report")
    if isinstance(tr, dict) and tr:
        return "complete"
    stack = lead.get("tech_stack") or []
    if isinstance(stack, list):
        hay = " ".join(str(x).lower() for x in stack)
        if "verifica in corso" in hay or "audit in arrivo" in hay:
            return "pending"
    return "complete"


def _enrich_status(lead: Dict[str, Any]) -> str:
    if lead.get("business_events_external_at"):
        return "complete"
    if lead.get("business_events_audit_at") or lead.get("business_events_enriched_at"):
        return "partial"
    if lead.get("business_signals") or lead.get("business_hiring_jobs"):
        return "partial"
    return "pending"


def _rating(lead: Dict[str, Any]) -> Optional[float]:
    r = lead.get("rating")
    if r is None:
        return None
    try:
        v = float(r)
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None


def lead_row_from_dict(
    lead: Dict[str, Any],
    *,
    search_id: str,
    user_id: Optional[str],
    position: int,
) -> Dict[str, Any]:
    azienda = _pick_str(lead, ("azienda", "nome", "name", "company", "business_name"))
    telefono = _pick_str(lead, ("telefono", "phone"))
    email = _pick_str(lead, ("email", "mail"))
    sito = _pick_str(lead, ("sito", "website", "url"))
    citta = _pick_str(lead, ("citta", "city", "localita"))
    categoria = _pick_str(lead, ("categoria", "category"))
    domain = extract_website_domain(lead)
    piva = extract_partita_iva(lead)
    pixel = extract_has_pixel(lead)
    dedupe = build_dedupe_key(lead, position)

    row: Dict[str, Any] = {
        "search_id": search_id,
        "user_id": user_id,
        "position": position,
        "azienda": azienda,
        "telefono": telefono,
        "email": email,
        "sito": sito,
        "citta": citta,
        "categoria": categoria,
        "rating": _rating(lead),
        "website_domain": domain,
        "partita_iva": piva,
        "has_pixel": pixel,
        "dedupe_key": dedupe,
        "payload": lead,
        "audit_status": _audit_status(lead),
        "enrich_status": _enrich_status(lead),
    }
    ext_at = lead.get("business_events_external_at")
    if ext_at:
        row["enriched_at"] = ext_at
    return row


def normalize_search_lead_rows(
    search_id: str,
    user_id: Optional[str],
    results_array: List[Any],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not search_id or not isinstance(results_array, list):
        return rows
    for idx, item in enumerate(results_array):
        if not isinstance(item, dict):
            continue
        rows.append(lead_row_from_dict(item, search_id=search_id, user_id=user_id, position=idx))

    # A single Postgres UPSERT statement cannot contain the same conflict key
    # twice. Streaming sources may legitimately rediscover a domain in one
    # snapshot, so collapse it here and retain the richest/latest payload.
    unique: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for row in rows:
        key = str(row.get("dedupe_key") or "")
        if key not in unique:
            unique[key] = row
            order.append(key)
            continue
        previous = unique[key]
        merged = dict(previous)
        for field, value in row.items():
            if value not in (None, "", [], {}):
                merged[field] = value
        previous_payload = previous.get("payload") if isinstance(previous.get("payload"), dict) else {}
        incoming_payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        merged["payload"] = {**previous_payload, **incoming_payload}
        merged["position"] = min(int(previous.get("position") or 0), int(row.get("position") or 0))
        unique[key] = merged
    return [unique[key] for key in order]


def normalize_and_upsert_search_leads(
    supabase_client: Any,
    search_id: str,
    user_id: Optional[str],
    results_array: List[Any],
) -> Dict[str, int]:
    """
    Bulk UPSERT su search_leads (search_id, dedupe_key).
    Non solleva eccezioni — il chiamante gestisce resilienza legacy.
    """
    stats = {"rows": 0, "upserted": 0, "errors": 0}
    if not supabase_client or not search_id:
        return stats

    rows = normalize_search_lead_rows(search_id, user_id, results_array)
    stats["rows"] = len(rows)
    if not rows:
        return stats

    for i in range(0, len(rows), UPSERT_CHUNK_SIZE):
        chunk = rows[i : i + UPSERT_CHUNK_SIZE]
        try:
            supabase_client.table("search_leads").upsert(
                chunk,
                on_conflict="search_id,dedupe_key",
            ).execute()
            stats["upserted"] += len(chunk)
        except Exception as exc:
            stats["errors"] += len(chunk)
            logger.warning(
                "search_leads upsert chunk failed search_id=%s chunk=%s-%s: %s",
                search_id,
                i,
                i + len(chunk),
                exc,
            )
            print(
                f"[search_leads_sync] upsert chunk failed search_id={search_id} "
                f"size={len(chunk)} err={exc}",
                flush=True,
            )

    if stats["upserted"]:
        print(
            f"[search_leads_sync] upserted {stats['upserted']}/{stats['rows']} "
            f"search_id={search_id}",
            flush=True,
        )
    return stats


def upsert_single_search_lead(
    supabase_client: Any,
    search_id: str,
    user_id: Optional[str],
    lead: Dict[str, Any],
    position: int,
) -> bool:
    """UPSERT singola riga search_leads — trigger Realtime 1-a-1."""
    if not supabase_client or not search_id or not isinstance(lead, dict):
        return False
    try:
        row = lead_row_from_dict(lead, search_id=search_id, user_id=user_id, position=position)
        supabase_client.table("search_leads").upsert(
            row,
            on_conflict="search_id,dedupe_key",
        ).execute()
        return True
    except Exception as exc:
        logger.warning(
            "search_leads single upsert failed search_id=%s dedupe=%s: %s",
            search_id,
            lead.get("dedupe_key") or build_dedupe_key(lead, position),
            exc,
        )
        print(
            f"[search_leads_sync] single upsert failed search_id={search_id} err={exc}",
            flush=True,
        )
        return False


def delete_search_lead_by_dedupe_key(
    supabase_client: Any,
    search_id: str,
    dedupe_key: str,
) -> bool:
    if not supabase_client or not search_id or not dedupe_key:
        return False
    try:
        supabase_client.table("search_leads").delete().eq("search_id", search_id).eq(
            "dedupe_key", dedupe_key
        ).execute()
        return True
    except Exception as exc:
        logger.warning("search_leads delete failed search_id=%s key=%s: %s", search_id, dedupe_key, exc)
        return False


def _self_check() -> None:
    lead = {
        "azienda": "Acme SRL",
        "sito": "https://www.example.com/path",
        "telefono": "02 12345678",
        "citta": "Milano",
        "meta_pixel": False,
        "technical_report": {"has_meta_pixel": False},
    }
    assert extract_website_domain(lead) == "example.com"
    assert extract_has_pixel(lead) is False
    assert build_dedupe_key(lead, 0) == "web:example.com"
    row = lead_row_from_dict(lead, search_id="00000000-0000-0000-0000-000000000001", user_id=None, position=0)
    assert row["dedupe_key"] == "web:example.com"
    assert row["has_pixel"] is False
    assert row["payload"]["azienda"] == "Acme SRL"


if __name__ == "__main__":
    _self_check()
    print("search_leads_sync self-check OK")
