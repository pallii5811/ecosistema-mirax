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
TERMINAL_URL_STATES = frozenset({
    "accepted", "rejected_final", "rejected_final_technical_exhausted",
    "duplicate", "duplicate_employer",
})


def canonical_url_key(value: Any) -> str:
    """Stable queue identity; URL position is never authoritative."""
    return str(value or "").strip().lower().rstrip("/")


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
    processed_terminal_urls: Tuple[str, ...] = ()
    retryable_urls: Tuple[str, ...] = ()
    pending_urls: Tuple[str, ...] = ()

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
        reconcile_hiring_url_queue(self)
        return len(self.pending_urls)

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
            "processed_terminal_urls": list(self.processed_terminal_urls),
            "retryable_urls": list(self.retryable_urls),
            "pending_urls": list(self.pending_urls),
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
            processed_terminal_urls=tuple(str(item) for item in payload.get("processed_terminal_urls") or ()),
            retryable_urls=tuple(str(item) for item in payload.get("retryable_urls") or payload.get("retry_urls") or ()),
            pending_urls=tuple(str(item) for item in payload.get("pending_urls") or ()),
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
        key = canonical_url_key(item.get("canonical_url") or item.get("url"))
        if key:
            mapped[key] = dict(item)
    return mapped


def reconcile_hiring_url_queue(state: HiringDiscoveryState) -> dict[str, int]:
    """Rebuild durable queue tiers from canonical identities and persisted outcomes.

    Legacy parser successes without active-status provenance require one refetch;
    a historical scalar offset can never turn them (or unseen outcomes) terminal.
    """
    from .hiring_retry_policy import apply_retry_policy

    unique_seen: list[str] = []
    seen_set: set[str] = set()
    for value in state.seen_urls:
        key = canonical_url_key(value)
        if key and key not in seen_set:
            seen_set.add(key)
            unique_seen.append(key)

    outcomes = url_outcomes_map(state)
    revalidation = {canonical_url_key(item) for item in state.revalidation_queue if canonical_url_key(item)}
    retryable = {
        canonical_url_key(item)
        for item in (*state.retry_urls, *state.retryable_urls)
        if canonical_url_key(item)
    }
    terminal: set[str] = set()
    rewritten: list[dict[str, Any]] = []
    for item in state.url_outcomes:
        row = dict(item)
        active_refetch_required = False
        key = canonical_url_key(row.get("canonical_url") or row.get("url"))
        if not key:
            continue
        parser_success = str(row.get("parser_result") or "") == "success"
        has_active = "active" in row or row.get("vacancy_active") is not None
        legacy_missing_provenance = not row.get("active_checked_at") and not row.get("active_verification_method")
        technical_refetch_failure = bool(row.get("cxs_failure_code") and row.get("cxs_attempt_count"))
        if parser_success and technical_refetch_failure and str(row.get("url_state") or "").startswith("retryable_active"):
            row.update({
                "parser_result": "empty",
                "validation_result": str(row.get("cxs_failure_code")),
                "rejection_code": str(row.get("cxs_failure_code")),
                "url_state": "retryable_parser_failure",
            })
            revalidation.discard(key)
            retryable.add(key)
        elif (
            parser_success
            and row.get("active") is None
            and row.get("active_checked_at")
            and str(row.get("url_state") or "").startswith("retryable_active")
        ):
            row.update({
                "validation_result": "VACANCY_ACTIVE_STATUS_UNVERIFIED_AFTER_REFETCH",
                "rejection_code": "VACANCY_ACTIVE_STATUS_UNVERIFIED_AFTER_REFETCH",
                "url_state": "rejected_final",
            })
            revalidation.discard(key)
            retryable.discard(key)
            terminal.add(key)
        elif parser_success and (not has_active or legacy_missing_provenance):
            row.update({
                "canonical_url": key,
                "active": None,
                "vacancy_active": None,
                "validation_result": "ACTIVE_STATUS_REFETCH_REQUIRED",
                "rejection_code": "ACTIVE_STATUS_REFETCH_REQUIRED",
                "url_state": "retryable_active_refetch",
            })
            revalidation.add(key)
            retryable.add(key)
            active_refetch_required = True

        if active_refetch_required:
            row.update({
                "retryable": True,
                "retry_strategy": "active_status_refetch",
                "retry_attempt_count": int(row.get("retry_attempt_count") or 0),
                "max_retry_attempts": 1,
                "terminal_after_reason": None,
            })
        else:
            row = apply_retry_policy(row)

        if str(row.get("url_state") or "") in TERMINAL_URL_STATES:
            terminal.add(key)
        elif bool(row.get("retryable")) and str(row.get("url_state") or "").startswith("retryable"):
            retryable.add(key)
        else:
            retryable.discard(key)
        rewritten.append(row)

    terminal.intersection_update(seen_set)
    retryable.intersection_update(seen_set)
    revalidation.intersection_update(seen_set)
    retryable.difference_update(terminal)
    revalidation.difference_update(terminal)
    pending = [key for key in unique_seen if key not in terminal and key not in retryable and key not in revalidation]
    retry_order = [key for key in unique_seen if key in retryable]
    retry_order.extend(sorted(retryable.difference(retry_order)))
    revalidation_order = [key for key in unique_seen if key in revalidation]
    revalidation_order.extend(sorted(revalidation.difference(revalidation_order)))

    # Telemetry only: contiguous terminal prefix in original discovery order.
    contiguous = 0
    for key in unique_seen:
        if key not in terminal:
            break
        contiguous += 1
    state.url_outcomes = tuple(rewritten)
    state.processed_terminal_urls = tuple(key for key in unique_seen if key in terminal)
    state.retryable_urls = tuple(retry_order)
    state.retry_urls = tuple(retry_order)
    state.revalidation_queue = tuple(revalidation_order)
    state.pending_urls = tuple(pending)
    state.discovery_url_offset = contiguous
    state.url_offset = contiguous
    return {
        "seen_urls": len(state.seen_urls),
        "unique_seen_urls": len(unique_seen),
        "unique_outcome_urls": len(outcomes),
        "terminal_urls": len(terminal),
        "retryable_urls": len(retryable),
        "recovered_unprocessed_urls": len(pending),
        "duplicates": len(state.seen_urls) - len(unique_seen),
        "reconciliation_total": len(terminal) + len(retryable) + len(pending),
    }


def has_executable_retry_work(state: HiringDiscoveryState) -> bool:
    """Retry URL presence is not evidence of executable provider work."""
    reconcile_hiring_url_queue(state)
    outcomes = url_outcomes_map(state)
    return any(bool(outcomes.get(canonical_url_key(url), {}).get("retryable")) for url in state.retryable_urls)


def hiring_provider_exhausted(state: HiringDiscoveryState, *, discovery_exhausted: bool) -> bool:
    reconcile_hiring_url_queue(state)
    return bool(
        discovery_exhausted
        and not state.pending_urls
        and not state.revalidation_queue
        and not has_executable_retry_work(state)
    )
