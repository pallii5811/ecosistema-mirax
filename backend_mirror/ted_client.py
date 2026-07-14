"""Minimal discovery-first TED Contract Award Notice client.

No call happens at import time. The parser is intentionally fail-closed: only
contract-award notices with an explicit winning organization are returned.
"""

from __future__ import annotations

from typing import Any, Dict, List


TED_SEARCH_URL = "https://ted.europa.eu/api/v2.0/notices/search"


def _first(record: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _winner(record: Dict[str, Any]) -> Dict[str, Any]:
    value = _first(record, "winner", "winningOrganisation", "winningOrganization", "contractor", "tenderer")
    if isinstance(value, list):
        value = value[0] if value else {}
    return value if isinstance(value, dict) else {"name": value} if value else {}


def parse_ted_award_notice(record: Dict[str, Any]) -> Dict[str, Any] | None:
    notice_type = str(_first(record, "noticeType", "notice_type", "formType", "form_type", "ND") or "").upper()
    status_blob = f"{notice_type} {_first(record, 'status', 'procedureStatus', 'title', 'TI') or ''}".lower()
    if not any(term in status_blob for term in ("can", "award", "aggiudic", "result")):
        return None
    winner = _winner(record)
    winner_name = str(_first(winner, "name", "officialName", "organisationName") or "").strip()
    if not winner_name:
        return None
    notice_id = str(_first(record, "noticeId", "notice_id", "publicationNumber", "ND") or "").strip()
    source_url = str(_first(record, "url", "noticeUrl") or "").strip()
    if not source_url and notice_id:
        source_url = f"https://ted.europa.eu/en/notice/-/detail/{notice_id}"
    return {
        "source_id": "ted_europa",
        "winner_name": winner_name,
        "winner_identifier": str(_first(winner, "identifier", "nationalRegistrationNumber", "vat") or "").strip(),
        "official_domain": str(_first(winner, "website", "url") or "").strip(),
        "award_id": notice_id,
        "title": str(_first(record, "title", "TI", "description") or "Contract award")[:500],
        "award_date": str(_first(record, "awardDate", "award_date", "publicationDate", "PD") or "")[:10],
        "amount": _first(record, "awardValue", "value", "totalValue"),
        "cpv": str(_first(record, "cpv", "mainCpv", "classification") or "").strip(),
        "geography": str(_first(record, "placeOfPerformance", "region", "nuts", "country") or "").strip(),
        "authority": str(_first(record, "buyerName", "contractingAuthority", "buyer") or "").strip(),
        "publisher": "TED Europa",
        "source_url": source_url,
        "status": "contract_awarded",
        "role": "winner",
        "evidence_excerpt": f"Contract Award Notice {notice_id}: {winner_name}",
    }


async def discover_ted_awards(keywords: List[str], *, location: str, page: int, limit: int) -> Dict[str, Any]:
    import httpx

    query = " ".join([*keywords, location, "contract award notice"]).strip()
    payload = {"query": query[:500], "page": max(1, page), "limit": min(max(1, limit), 100), "scope": "ALL", "language": "IT"}
    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.post(TED_SEARCH_URL, json=payload, headers={"Accept": "application/json"})
        response.raise_for_status()
        data = response.json() or {}
    notices = data.get("notices") or data.get("results") or []
    records = [parsed for item in notices if isinstance(item, dict) and (parsed := parse_ted_award_notice(item))]
    total = int(data.get("total") or data.get("totalCount") or len(records))
    return {"records": records, "exhausted": page * limit >= total or len(notices) < limit, "cost_eur": 0.0}
