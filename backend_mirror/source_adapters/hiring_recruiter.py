"""Deterministic recruiter/staffing classification for hiring adapter."""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional
from urllib.parse import urlparse

from backend_mirror.agents.portal_blacklist import normalize_domain


STAFFING_BRAND_ALIASES: dict[str, tuple[str, ...]] = {
    "synergie": ("synergie", "synergie-italia", "synergieitalia"),
    "manpower": ("manpower",),
    "randstad": ("randstad",),
    "adecco": ("adecco",),
    "gi group": ("gi group", "gigroup", "gi-group"),
    "umana": ("umana",),
    "openjobmetis": ("openjobmetis", "open job metis"),
    "orienta": ("orienta",),
    "etjca": ("etjca", "etj.ca"),
    "during": ("during",),
    "e-work": ("e-work", "ework"),
    "humangest": ("humangest", "human gest"),
    "temporary": ("temporary", "tempor spa"),
    "staffing": ("staffing", "jobox", "job partner", "lavoropiù", "lavoropiu"),
}

_CLIENT_PLACEHOLDER_RE = re.compile(
    r"\b(?:per\s+(?:importante\s+)?(?:azienda\s+)?cliente|nostro\s+cliente|azienda\s+cliente|"
    r"azienda\s+operante\s+nel\s+settore|importante\s+realta\s+del\s+settore|"
    r"per\s+conto\s+di\s+un\s+cliente)\b",
    re.I,
)
_SECTOR_FOR_CLIENT_RE = re.compile(
    r"\b(?:settore\s+[a-zà-ù]+|per\s+il\s+settore\s+[a-zà-ù]+)\b",
    re.I,
)
_INTERNAL_STAFFING_ROLE_RE = re.compile(
    r"\b(?:interno|interna|synergie\s+italia|addetto\s+back\s*office|hr\s+interno|"
    r"recruiter\s+interno|consulente\s+interno)\b",
    re.I,
)
_NAMED_FINAL_EMPLOYER_RE = re.compile(
    r"\b(?:presso|per)\s+([A-ZÀ-Ú][A-Za-zÀ-ú0-9&\.\-\']+(?:\s+[A-ZÀ-Ú][A-Za-zÀ-ú0-9&\.\-\']+){0,4})\b",
)


def _host(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return normalize_domain(parsed.hostname or "")


def _brand_match(blob: str, domain: str) -> Optional[str]:
    hay = f"{blob} {domain}".casefold()
    for brand, aliases in STAFFING_BRAND_ALIASES.items():
        if any(alias in hay or alias.replace(" ", "") in domain for alias in aliases):
            return brand
    return None


def classify_hiring_employer(record: Mapping[str, Any]) -> dict[str, Any]:
    company = str(record.get("company_name") or record.get("name") or "").strip()
    title = str(record.get("vacancy_title") or record.get("hiring_title") or "").strip()
    evidence = " ".join(
        str(record.get(key) or "")
        for key in ("evidence", "evidence_excerpt", "description", "hiring_title", "vacancy_title")
    ).strip()
    blob = f"{company} {title} {evidence}"
    domain = _host(record.get("employer_official_domain") or record.get("official_domain") or record.get("website"))
    publisher = _host(record.get("vacancy_source_domain") or record.get("source_publisher") or record.get("source_url"))
    brand = _brand_match(company, domain) or _brand_match(publisher, publisher)
    employer_is_recruiter = brand is not None
    final_employer_name = str(record.get("final_employer_name") or "").strip()
    final_employer_domain = _host(record.get("final_employer_domain"))
    if not final_employer_name:
        named = _NAMED_FINAL_EMPLOYER_RE.search(blob)
        if named and brand and brand not in named.group(1).casefold():
            final_employer_name = named.group(1).strip()
    hiring_for_self = False
    employer_resolution_method = "direct_operating_company"
    rejection_code = ""
    if employer_is_recruiter:
        sector_for_client = bool(_SECTOR_FOR_CLIENT_RE.search(blob)) or bool(
            re.search(r"\|\s*[A-ZÀ-Ú]{3,}", title)
        )
        client_placeholder = bool(_CLIENT_PLACEHOLDER_RE.search(blob))
        internal_role = bool(_INTERNAL_STAFFING_ROLE_RE.search(blob))
        named_client = bool(final_employer_name) and final_employer_domain and brand not in final_employer_domain
        if internal_role and not sector_for_client and not client_placeholder:
            hiring_for_self = True
            employer_resolution_method = "staffing_internal_vacancy"
        elif named_client:
            hiring_for_self = False
            employer_resolution_method = "staffing_named_final_employer"
        else:
            employer_resolution_method = "staffing_client_unresolved"
            rejection_code = "RECRUITER_FINAL_EMPLOYER_UNRESOLVED"
    return {
        "employer_is_recruiter": employer_is_recruiter,
        "staffing_brand": brand,
        "hiring_for_self": hiring_for_self,
        "final_employer_name": final_employer_name or None,
        "final_employer_domain": final_employer_domain or None,
        "employer_resolution_method": employer_resolution_method,
        "rejection_code": rejection_code,
    }


def enrich_record_with_recruiter_fields(record: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(record)
    classification = classify_hiring_employer(payload)
    payload.update(classification)
    if classification["employer_is_recruiter"] and classification["hiring_for_self"]:
        payload["employer_is_direct"] = True
    elif classification["employer_is_recruiter"] and classification["final_employer_domain"]:
        payload["employer_is_direct"] = True
        payload["employer_official_domain"] = classification["final_employer_domain"]
        if classification["final_employer_name"]:
            payload["company_name"] = classification["final_employer_name"]
            payload["name"] = classification["final_employer_name"]
    elif classification["employer_is_recruiter"]:
        payload["employer_is_direct"] = False
    return payload
