"""Base utilities for Universe relation extractors."""

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..canonical import normalize_domain, slugify_name


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return text


def normalize_name(value: str) -> str:
    text = value.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def stable_hash(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def company_canonical_id(name: str, domain: Optional[str] = None) -> Optional[str]:
    if domain:
        return normalize_domain(domain)
    name_clean = clean_text(name)
    if len(name_clean) >= 3:
        return slugify_name(name_clean)
    return None


def tender_canonical_id(signal: Dict[str, Any]) -> Optional[str]:
    """Stable canonical id for a tender entity from a business signal."""
    cig = clean_text(signal.get("cig") or signal.get("tender_cig") or signal.get("CIG"))
    if cig and len(cig) >= 5:
        return f"tender:cig:{cig.lower()}"
    title = clean_text(signal.get("title") or signal.get("oggetto") or signal.get("object"))
    authority = clean_text(signal.get("authority") or signal.get("stazione_appaltante") or signal.get("tender_authority"))
    amount = signal.get("amount") or signal.get("importo") or signal.get("tender_amount")
    date = signal.get("date") or signal.get("data") or signal.get("tender_date")
    if title and len(title) >= 5:
        return f"tender:hash:{stable_hash({'title': title, 'authority': authority, 'amount': amount, 'date': date})}"
    return None


def investor_canonical_id(name: str) -> Optional[str]:
    name_clean = clean_text(name)
    if len(name_clean) >= 2:
        return f"investor:{slugify_name(name_clean)}"
    return None


def person_canonical_id(name: str, role: Optional[str] = None) -> Optional[str]:
    name_clean = clean_text(name)
    if len(name_clean) < 2:
        return None
    base = f"person:{slugify_name(name_clean)}"
    if role:
        return f"{base}:{slugify_name(role)}"
    return base


def to_number(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit())
        if digits:
            n = int(digits)
            return n if n > 0 else None
    return None
