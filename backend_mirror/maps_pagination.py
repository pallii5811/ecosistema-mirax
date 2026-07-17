"""Pure deterministic page selection for the legacy Maps audit runner."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Mapping
from urllib.parse import urlparse


def _website_domain(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    return (parsed.hostname or "").removeprefix("www.")


def maps_identity_hash(item: Mapping[str, Any]) -> str:
    place_id = str(item.get("place_id") or "").strip()
    maps_url = str(item.get("maps_url") or item.get("google_maps_url") or "").strip()
    # The pre-audit record normally contains a full URL while the audited
    # record stores the canonical host.  Hash the same canonical value at
    # both boundaries or resume will audit the same company again.
    website = _website_domain(item.get("website"))
    name = re.sub(r"\s+", " ", str(item.get("business_name") or item.get("name") or "").strip().casefold())
    address = re.sub(r"\s+", " ", str(item.get("address") or "").strip().casefold())
    identity = place_id or maps_url or website or f"{name}|{address}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]


def select_digital_audit_maps_page(
    raw_items: List[Dict[str, Any]],
    intent: Mapping[str, Any],
) -> List[Dict[str, Any]]:
    start_index = max(0, int(intent.get("maps_start_index") or 0))
    page_size = max(1, int(intent.get("maps_page_size") or len(raw_items) or 1))
    processed_hashes = {
        str(item) for item in intent.get("processed_identity_hashes") or () if str(item)
    }
    provider_page = raw_items[start_index:start_index + page_size]
    page = [
        {
            **item,
            "_maps_acquired_total": len(raw_items),
            "_maps_fetch_cap": int(intent.get("maps_fetch_cap") or start_index + page_size),
            "_maps_provider_page_count": len(provider_page),
        }
        for item in provider_page
        if maps_identity_hash(item) not in processed_hashes
    ]
    if page:
        return page
    return [{
        "_maps_control_only": True,
        "_maps_acquired_total": len(raw_items),
        "_maps_fetch_cap": int(intent.get("maps_fetch_cap") or start_index + page_size),
        "_maps_provider_page_count": len(provider_page),
    }]
