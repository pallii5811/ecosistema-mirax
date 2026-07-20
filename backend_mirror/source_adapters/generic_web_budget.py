"""Progressive discovery budget pools for generic_web_research_v1."""
from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass
from typing import Any, Mapping, MutableMapping, Sequence, Tuple

from .contracts import DiscoveryCursor

QUERY_COST_EUR = 0.005
# Discovery must leave room for ≥1 paid semantic reserve (~€0.028–0.032 on
# typical news pages). €0.020 soft-cap exhausted the €0.05 hard budget before
# the second lead could reserve interpretation.
DISCOVERY_SOFT_CAP_EUR = 0.015
SEMANTIC_RESERVE_EUR = 0.020
IDENTITY_RESERVE_EUR = 0.005
BUFFER_EUR = 0.005
INITIAL_SERP_QUERIES = 1
URLS_PER_WAVE = 5
TERMINAL_URL_STATES = frozenset({"fetched", "rejected_prefilter", "rejected_fetch", "rejected_parse"})


def _url_key(value: Any) -> str:
    return str(value or "").strip().lower().rstrip("/")


@dataclass
class GenericWebDiscoveryState:
    legacy_offset: int = 0
    query_index: int = 0
    discovery_spent_eur: float = 0.0
    executed_query_keys: Tuple[str, ...] = ()
    pending_urls: Tuple[str, ...] = ()
    url_meta: Tuple[Mapping[str, Any], ...] = ()
    processed_terminal_urls: Tuple[str, ...] = ()
    pages_fetched: int = 0
    provider_calls: int = 0
    wave_terminal_rejections: int = 0
    followup_queries: Tuple[str, ...] = ()

    def discovery_cap_eur(self, hard_cap_eur: float) -> float:
        """SERP pool stays inside hard_cap minus semantic/identity reserves."""
        hard = float(hard_cap_eur)
        reserved = self.reserved_floor_eur()
        # Tiny hard caps (unit tests / single-SERP fixtures) cannot reserve the
        # full semantic floor — still allow discovery within the hard cap.
        if hard + 1e-9 < reserved:
            return min(DISCOVERY_SOFT_CAP_EUR, hard)
        hard_discovery = max(0.0, hard - reserved)
        base = min(DISCOVERY_SOFT_CAP_EUR, hard_discovery)
        if self.followup_queries:
            return hard_discovery
        return base

    def discovery_remaining_eur(self, hard_cap_eur: float) -> float:
        return round(max(0.0, self.discovery_cap_eur(hard_cap_eur) - self.discovery_spent_eur), 6)

    def reserved_floor_eur(self) -> float:
        return SEMANTIC_RESERVE_EUR + IDENTITY_RESERVE_EUR + BUFFER_EUR

    def can_reserve_serp(self, *, hard_cap_eur: float, spent_eur: float, governor_remaining: float) -> bool:
        if self.discovery_remaining_eur(hard_cap_eur) + 1e-9 < QUERY_COST_EUR:
            return False
        if float(hard_cap_eur) + 1e-9 < self.reserved_floor_eur():
            return governor_remaining + 1e-9 >= QUERY_COST_EUR
        # Content-shell follow-ups run after semantic may already have spent the
        # reserve floor. Only require room for the SERP itself.
        if self.followup_queries:
            return governor_remaining + 1e-9 >= QUERY_COST_EUR
        need = QUERY_COST_EUR + self.reserved_floor_eur()
        if governor_remaining + 1e-9 < need and spent_eur + QUERY_COST_EUR > hard_cap_eur - self.reserved_floor_eur() + 1e-9:
            return False
        return True

    def max_serp_this_wave(self, hard_cap_eur: float) -> int:
        if self.discovery_remaining_eur(hard_cap_eur) + 1e-9 < QUERY_COST_EUR:
            return 0
        soft_left = max(0.0, self.discovery_cap_eur(hard_cap_eur) - self.discovery_spent_eur)
        soft_queries = int(math.floor(soft_left / QUERY_COST_EUR))
        hard_queries = int(math.floor(self.discovery_remaining_eur(hard_cap_eur) / QUERY_COST_EUR))
        if self.provider_calls == 0:
            return min(INITIAL_SERP_QUERIES, soft_queries or hard_queries, hard_queries)
        return min(1, hard_queries)

    def queue_has_work(self) -> bool:
        terminal = {_url_key(item) for item in self.processed_terminal_urls}
        if any(_url_key(url) not in terminal for url in self.pending_urls):
            return True
        if self.followup_queries:
            return True
        return any(
            _url_key(meta.get("url")) not in terminal
            for meta in self.url_meta
            if isinstance(meta, Mapping) and meta.get("url")
        )

    def wave_urls_terminal(self) -> bool:
        if self.pages_fetched > 0:
            return True
        return self.wave_terminal_rejections > 0 and not self.queue_has_work()

    def to_dict(self) -> dict[str, Any]:
        return {
            "legacy_offset": self.legacy_offset,
            "query_index": self.query_index,
            "discovery_spent_eur": self.discovery_spent_eur,
            "executed_query_keys": list(self.executed_query_keys),
            "pending_urls": list(self.pending_urls),
            "url_meta": [dict(item) for item in self.url_meta],
            "processed_terminal_urls": list(self.processed_terminal_urls),
            "pages_fetched": self.pages_fetched,
            "provider_calls": self.provider_calls,
            "wave_terminal_rejections": self.wave_terminal_rejections,
            "followup_queries": list(self.followup_queries),
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any] | None) -> "GenericWebDiscoveryState":
        if not isinstance(payload, Mapping):
            return cls()
        return cls(
            legacy_offset=int(payload.get("legacy_offset") or 0),
            query_index=int(payload.get("query_index") or 0),
            discovery_spent_eur=float(payload.get("discovery_spent_eur") or 0.0),
            executed_query_keys=tuple(str(item) for item in payload.get("executed_query_keys") or ()),
            pending_urls=tuple(str(item) for item in payload.get("pending_urls") or ()),
            url_meta=tuple(dict(item) for item in payload.get("url_meta") or () if isinstance(item, Mapping)),
            processed_terminal_urls=tuple(str(item) for item in payload.get("processed_terminal_urls") or ()),
            pages_fetched=int(payload.get("pages_fetched") or 0),
            provider_calls=int(payload.get("provider_calls") or 0),
            wave_terminal_rejections=int(payload.get("wave_terminal_rejections") or 0),
            followup_queries=tuple(str(item) for item in payload.get("followup_queries") or () if str(item).strip()),
        )


def load_generic_web_state(
    cursor: DiscoveryCursor | None,
    technical_filters: Mapping[str, Any] | None,
) -> GenericWebDiscoveryState:
    bucket = (technical_filters or {}).get("generic_web_discovery")
    if isinstance(bucket, Mapping):
        return GenericWebDiscoveryState.from_dict(bucket)
    if cursor and cursor.value.startswith("generic-web:v2:"):
        payload = decode_generic_web_v2_payload(cursor.value)
        if isinstance(payload, Mapping):
            return GenericWebDiscoveryState.from_dict(payload)
    if cursor and cursor.value.startswith("generic-web:v1:"):
        try:
            legacy_offset = int(cursor.value.split("generic-web:v1:", 1)[1] or "0")
        except ValueError:
            legacy_offset = 0
        # Migration bridge: keep old pagination progress and emit v2 onward.
        return GenericWebDiscoveryState(legacy_offset=max(0, legacy_offset))
    return GenericWebDiscoveryState()


def decode_generic_web_v2_payload(value: str) -> Mapping[str, Any] | None:
    if not value.startswith("generic-web:v2:"):
        return None
    raw = value.split("generic-web:v2:", 1)[1]
    try:
        padded = raw + "=" * (-len(raw) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        return payload if isinstance(payload, Mapping) else None
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def encode_generic_web_cursor(state: GenericWebDiscoveryState) -> DiscoveryCursor:
    payload = json.dumps(state.to_dict(), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    token = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return DiscoveryCursor(f"generic-web:v2:{token}", partition="progressive_web")


def persist_generic_web_state(
    technical_filters: MutableMapping[str, Any],
    state: GenericWebDiscoveryState,
) -> None:
    technical_filters["generic_web_discovery"] = state.to_dict()
