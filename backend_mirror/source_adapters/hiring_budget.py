"""Hiring shadow budget pools and discovery cursor state."""
from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass, field
from typing import Any, Mapping, MutableMapping, Sequence, Tuple

from .contracts import DiscoveryCursor


HARD_CAP_EUR = 0.125
PLANNING_CAP_EUR = 0.025
DISCOVERY_CAP_EUR = 0.050
PARSING_CAP_EUR = 0.025
DOMAIN_CAP_EUR = 0.025
QUERY_COST_EUR = 0.005
QUERIES_PER_BATCH = 4
URLS_PER_BATCH = 24


@dataclass
class HiringDiscoveryState:
    query_index: int = 0
    url_offset: int = 0
    discovery_spent_eur: float = 0.0
    parsing_spent_eur: float = 0.0
    domain_spent_eur: float = 0.0
    executed_query_keys: Tuple[str, ...] = ()
    seen_urls: Tuple[str, ...] = ()
    url_meta: Tuple[Mapping[str, Any], ...] = ()
    zero_yield_sources: Tuple[str, ...] = ()
    query_stats: Tuple[Mapping[str, Any], ...] = ()
    prefetch_traces: Tuple[Mapping[str, Any], ...] = ()
    url_outcomes: Tuple[Mapping[str, Any], ...] = ()
    retry_urls: Tuple[str, ...] = ()
    parser_epoch: int = 1
    discovery_url_offset: int = 0
    parsed_candidate_queue: Tuple[str, ...] = ()
    revalidation_queue: Tuple[str, ...] = ()
    qualification_validator_epoch: int = 1

    @property
    def total_spent_eur(self) -> float:
        return self.discovery_spent_eur + self.parsing_spent_eur + self.domain_spent_eur

    def discovery_remaining_eur(self) -> float:
        remaining = max(0.0, min(DISCOVERY_CAP_EUR - self.discovery_spent_eur, HARD_CAP_EUR - self.total_spent_eur))
        return round(remaining, 6)

    def max_queries_this_batch(self) -> int:
        if self.discovery_remaining_eur() + 1e-9 < QUERY_COST_EUR:
            return 0
        return min(QUERIES_PER_BATCH, int(math.floor(self.discovery_remaining_eur() / QUERY_COST_EUR)))

    def discovery_locked(self) -> bool:
        return self.discovery_remaining_eur() + 1e-9 < QUERY_COST_EUR

    def queue_pending(self) -> int:
        offset = self.discovery_url_offset or self.url_offset
        return max(0, len(self.seen_urls) - offset)

    @property
    def retry_fetch_queue(self) -> Tuple[str, ...]:
        return self.retry_urls

    def to_dict(self) -> dict[str, Any]:
        return {
            "query_index": self.query_index,
            "url_offset": self.url_offset,
            "discovery_spent_eur": round(self.discovery_spent_eur, 6),
            "parsing_spent_eur": round(self.parsing_spent_eur, 6),
            "domain_spent_eur": round(self.domain_spent_eur, 6),
            "executed_query_keys": list(self.executed_query_keys),
            "seen_urls": list(self.seen_urls),
            "url_meta": [dict(item) for item in self.url_meta],
            "zero_yield_sources": list(self.zero_yield_sources),
            "query_stats": [dict(item) for item in self.query_stats],
            "prefetch_traces": [dict(item) for item in self.prefetch_traces],
            "url_outcomes": [dict(item) for item in self.url_outcomes],
            "retry_urls": list(self.retry_urls),
            "parser_epoch": int(self.parser_epoch),
            "discovery_url_offset": int(self.discovery_url_offset or self.url_offset),
            "parsed_candidate_queue": list(self.parsed_candidate_queue),
            "revalidation_queue": list(self.revalidation_queue),
            "qualification_validator_epoch": int(self.qualification_validator_epoch),
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any] | None) -> "HiringDiscoveryState":
        if not isinstance(payload, Mapping):
            return cls()
        return cls(
            query_index=int(payload.get("query_index") or 0),
            url_offset=int(payload.get("url_offset") or 0),
            discovery_spent_eur=float(payload.get("discovery_spent_eur") or 0.0),
            parsing_spent_eur=float(payload.get("parsing_spent_eur") or 0.0),
            domain_spent_eur=float(payload.get("domain_spent_eur") or 0.0),
            executed_query_keys=tuple(str(item) for item in payload.get("executed_query_keys") or ()),
            seen_urls=tuple(str(item) for item in payload.get("seen_urls") or ()),
            url_meta=tuple(
                dict(item) for item in payload.get("url_meta") or () if isinstance(item, Mapping)
            ),
            zero_yield_sources=tuple(str(item) for item in payload.get("zero_yield_sources") or ()),
            query_stats=tuple(dict(item) for item in payload.get("query_stats") or () if isinstance(item, Mapping)),
            prefetch_traces=tuple(
                dict(item) for item in payload.get("prefetch_traces") or () if isinstance(item, Mapping)
            ),
            url_outcomes=tuple(
                dict(item) for item in payload.get("url_outcomes") or () if isinstance(item, Mapping)
            ),
            retry_urls=tuple(str(item) for item in payload.get("retry_urls") or ()),
            parser_epoch=int(payload.get("parser_epoch") or 1),
            discovery_url_offset=int(payload.get("discovery_url_offset") or payload.get("url_offset") or 0),
            parsed_candidate_queue=tuple(str(item) for item in payload.get("parsed_candidate_queue") or ()),
            revalidation_queue=tuple(str(item) for item in payload.get("revalidation_queue") or ()),
            qualification_validator_epoch=int(payload.get("qualification_validator_epoch") or 1),
        )


def load_discovery_state(cursor: DiscoveryCursor | None, technical_filters: Mapping[str, Any] | None) -> HiringDiscoveryState:
    filters = technical_filters if isinstance(technical_filters, Mapping) else {}
    embedded = filters.get("hiring_discovery")
    if isinstance(embedded, Mapping):
        return HiringDiscoveryState.from_dict(embedded)
    if cursor and str(cursor.value).startswith("hiring:v2:"):
        raw = str(cursor.value)[len("hiring:v2:"):]
        try:
            payload = json.loads(base64.urlsafe_b64decode(raw + "==").decode("utf-8"))
            if isinstance(payload, Mapping):
                return HiringDiscoveryState.from_dict(payload)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            pass
    if cursor and str(cursor.value).startswith("hiring:v1:"):
        try:
            offset = int(str(cursor.value).split(":", 2)[2])
        except (IndexError, ValueError):
            offset = 0
        return HiringDiscoveryState(url_offset=offset)
    return HiringDiscoveryState()


def encode_discovery_cursor(state: HiringDiscoveryState) -> DiscoveryCursor:
    payload = base64.urlsafe_b64encode(json.dumps(state.to_dict(), separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
    return DiscoveryCursor(f"hiring:v2:{payload}", partition="hiring_sources")


def url_outcomes_map(state: HiringDiscoveryState) -> dict[str, dict[str, Any]]:
    mapped: dict[str, dict[str, Any]] = {}
    for item in state.url_outcomes:
        if not isinstance(item, Mapping):
            continue
        key = str(item.get("canonical_url") or item.get("url") or "").lower().rstrip("/")
        if key:
            mapped[key] = dict(item)
    return mapped
