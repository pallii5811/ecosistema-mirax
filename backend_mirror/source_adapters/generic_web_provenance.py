"""Provenance helpers and fail-closed gates for generic_web_research_v1."""
from __future__ import annotations

import hashlib
import re
from typing import Any, Mapping, MutableMapping, Optional

from careers_host import is_careers_only_host

_MIN_SOURCE_TEXT_CHARS = 120


def source_text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip().encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


def page_fetch_id(*, search_scope: str, url: str, wave_index: int) -> str:
    token = f"{search_scope}|{url.lower().rstrip('/')}|{wave_index}"
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:20]


def semantic_call_id(*, contract_hash: str, source_url: str) -> str:
    token = f"{contract_hash}|{source_url.lower().rstrip('/')}"
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:20]


def attach_generic_provenance(
    record: MutableMapping[str, Any],
    *,
    adapter_id: str,
    search_scope: str,
    execution_round: int,
    provider_call_id: str,
    page_fetch_id_value: str,
    source_text: str,
    cursor_version: str = "generic-web:v2",
) -> None:
    text = str(source_text or "").strip()
    record["origin_adapter_id"] = adapter_id
    record["origin_execution_round"] = int(execution_round)
    record["origin_provider_call_id"] = str(provider_call_id)
    record["origin_page_fetch_id"] = str(page_fetch_id_value)
    record["origin_source_text_hash"] = source_text_hash(text) if text else ""
    record["origin_cursor_version"] = cursor_version
    record["source_text"] = text[:250_000]


def generic_record_has_fetch_provenance(record: Mapping[str, Any]) -> tuple[bool, str]:
    if not str(record.get("origin_page_fetch_id") or "").strip():
        return False, "PAGE_FETCH_PROVENANCE_MISSING"
    text = str(record.get("source_text") or "").strip()
    if len(text) < _MIN_SOURCE_TEXT_CHARS:
        return False, "SOURCE_TEXT_MISSING"
    if not str(record.get("origin_source_text_hash") or "").strip():
        return False, "SOURCE_TEXT_HASH_MISSING"
    if not str(record.get("evidence_excerpt") or "").strip():
        return False, "LITERAL_EXCERPT_MISSING"
    return True, ""


def evidence_has_fetch_provenance(provenance: Mapping[str, Any]) -> tuple[bool, str]:
    if not str(provenance.get("origin_page_fetch_id") or "").strip():
        return False, "PAGE_FETCH_PROVENANCE_MISSING"
    text = str(provenance.get("source_text") or "").strip()
    if len(text) < _MIN_SOURCE_TEXT_CHARS:
        return False, "SOURCE_TEXT_MISSING"
    if not str(provenance.get("origin_source_text_hash") or "").strip():
        return False, "SOURCE_TEXT_HASH_MISSING"
    return True, ""


def append_query_telemetry(
    technical_filters: MutableMapping[str, Any],
    *,
    query_text: str,
    raw_provider_hits: int,
    prefilter_accepted: int,
    prefilter_rejected: int,
    rejection_histogram: Mapping[str, int],
    provider_error: Optional[str],
    cost_eur: float,
) -> None:
    bucket = technical_filters.get("generic_web_query_telemetry")
    if not isinstance(bucket, list):
        bucket = []
        technical_filters["generic_web_query_telemetry"] = bucket
    bucket.append({
        "query_text": query_text,
        "raw_provider_hits": int(raw_provider_hits),
        "rich_hits_before_prefilter": int(raw_provider_hits),
        "prefilter_accepted": int(prefilter_accepted),
        "prefilter_rejected": int(prefilter_rejected),
        "rejection_histogram": dict(rejection_histogram),
        "provider_error": provider_error,
        "cost": round(float(cost_eur), 6),
    })
