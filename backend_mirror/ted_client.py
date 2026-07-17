"""Minimal discovery-first TED Contract Award Notice client.

No call happens at import time. The parser is intentionally fail-closed: only
contract-award notices with an explicit winning organization are returned.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List


TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search"
_TED_FIELDS = [
    "publication-number",
    "notice-type",
    "title-proc",
    "title-lot",
    "buyer-name",
    "buyer-country",
    "organisation-name-winner",
    "winner-name",
    "publication-date",
    "place-of-performance",
    "estimated-value-proc",
    "total-value",
    "links",
]


def _first(record: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _winner(record: Dict[str, Any]) -> Dict[str, Any]:
    for key in (
        "organisation-name-winner",
        "winner-name",
        "winner",
        "winningOrganisation",
        "winningOrganization",
        "contractor",
        "tenderer",
    ):
        value = record.get(key)
        if value in (None, "", [], {}):
            continue
        if isinstance(value, list):
            value = value[0] if value else {}
        if isinstance(value, dict):
            return value
        return {"name": value}
    return {}


def parse_ted_award_notice(record: Dict[str, Any]) -> Dict[str, Any] | None:
    notice_type = str(_first(record, "notice-type", "noticeType", "notice_type", "formType", "form_type", "ND") or "").upper()
    status_blob = f"{notice_type} {_first(record, 'status', 'procedureStatus', 'title', 'title-proc', 'TI') or ''}".lower()
    if not any(term in status_blob for term in ("can", "award", "aggiudic", "result", "contr-")):
        return None
    winner = _winner(record)
    winner_name = str(_first(winner, "name", "officialName", "organisationName") or winner.get("name") or "").strip()
    if not winner_name and isinstance(record.get("organisation-name-winner"), str):
        winner_name = str(record.get("organisation-name-winner") or "").strip()
    if not winner_name and isinstance(record.get("organisation-name-winner"), list):
        first = record.get("organisation-name-winner") or []
        winner_name = str(first[0] if first else "").strip()
    if not winner_name:
        return None
    notice_id = str(_first(record, "publication-number", "noticeId", "notice_id", "publicationNumber", "ND") or "").strip()
    source_url = str(_first(record, "url", "noticeUrl") or "").strip()
    links = record.get("links")
    if not source_url and isinstance(links, dict):
        source_url = str(links.get("html") or links.get("self") or "").strip()
    if not source_url and notice_id:
        source_url = f"https://ted.europa.eu/en/notice/-/detail/{notice_id}"
    title = str(
        _first(record, "title-proc", "title-lot", "title", "TI", "description") or "Contract award"
    )[:500]
    geography = " ".join(
        str(item)
        for item in (
            *_as_list(record.get("place-of-performance")),
            *_as_list(record.get("buyer-country")),
            _first(record, "region", "nuts", "country") or "",
        )
        if str(item or "").strip()
    ).strip()
    authority = str(_first(record, "buyer-name", "buyerName", "contractingAuthority", "buyer") or "").strip()
    if isinstance(record.get("buyer-name"), list):
        authority = str((record.get("buyer-name") or [""])[0] or "").strip() or authority
    return {
        "source_id": "ted_europa",
        "winner_name": winner_name,
        "winner_identifier": str(_first(winner, "identifier", "nationalRegistrationNumber", "vat") or "").strip(),
        "official_domain": str(_first(winner, "website", "url") or "").strip(),
        "award_id": notice_id,
        "title": title,
        "award_date": str(_first(record, "publication-date", "awardDate", "award_date", "publicationDate", "PD") or "")[:10],
        "amount": _first(record, "total-value", "estimated-value-proc", "awardValue", "value", "totalValue"),
        "cpv": str(_first(record, "cpv", "mainCpv", "classification") or "").strip(),
        "geography": geography or "Italia",
        "authority": authority,
        "publisher": "TED Europa",
        "source_url": source_url,
        "status": "contract_awarded",
        "role": "winner",
        "evidence_excerpt": f"Contract Award Notice {notice_id}: {winner_name}",
    }


def _expert_query(keywords: List[str], location: str, *, days: int = 30) -> str:
    end = date.today()
    start = end - timedelta(days=max(1, days))
    country = "IT"
    loc = str(location or "").strip().casefold()
    if loc and loc not in {"italia", "italy", "it", ""}:
        # Keep Italy as buyer country; location text is not a reliable TED field.
        country = "IT"
    # can-standard = contract award notice (eForms)
    return (
        f"(buyer-country = {country} OR place-of-performance = ITA) AND "
        f"(notice-type = can-standard OR notice-type = can OR notice-type = result) AND "
        f"publication-date >= {start.strftime('%Y%m%d')} AND publication-date <= {end.strftime('%Y%m%d')}"
    )


async def discover_ted_awards(keywords: List[str], *, location: str, page: int, limit: int) -> Dict[str, Any]:
    import httpx

    payload = {
        "query": _expert_query(keywords, location),
        "page": max(1, page),
        "limit": min(max(1, limit), 50),
        "scope": "ACTIVE",
        "checkQuerySyntax": True,
        "paginationMode": "PAGE_NUMBER",
        "fields": _TED_FIELDS,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            TED_SEARCH_URL,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        response.raise_for_status()
        data = response.json() or {}
    notices = data.get("notices") or data.get("results") or data.get("content") or []
    records = [parsed for item in notices if isinstance(item, dict) and (parsed := parse_ted_award_notice(item))]
    total = int(data.get("total") or data.get("totalCount") or data.get("totalNoticeCount") or len(records))
    return {"records": records, "exhausted": page * limit >= total or len(notices) < limit, "cost_eur": 0.0}
