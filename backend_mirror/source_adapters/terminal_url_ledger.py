"""Durable terminal-URL ledger for semantic acquisition resumes.

A URL marked terminal for a search must be excluded before fetch, parse,
semantic cache lookup, or a paid LLM call. ops_park restores MERGE ledgers;
they never replace a richer ledger with an incomplete cursor snapshot.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple


STALE_EVENT = "STALE_EVENT"
IRRELEVANT = "IRRELEVANT"
WRONG_ACTOR = "WRONG_ACTOR"
WRONG_ENTITY = "WRONG_ENTITY"
ENTERPRISE = "ENTERPRISE"
UNOFFICIAL_DOMAIN = "UNOFFICIAL_DOMAIN"
SEMANTICALLY_REJECTED = "SEMANTICALLY_REJECTED"

TERMINAL_STATUSES = frozenset({
    STALE_EVENT,
    IRRELEVANT,
    WRONG_ACTOR,
    WRONG_ENTITY,
    ENTERPRISE,
    UNOFFICIAL_DOMAIN,
    SEMANTICALLY_REJECTED,
})

# Map grounding / market rejection codes onto durable terminal statuses.
REJECTION_TO_TERMINAL = {
    "EVENT_GROUNDING_FAILED": STALE_EVENT,
    "TARGET_ROLE_UNVERIFIED": WRONG_ACTOR,
    "COMPANY_GROUNDING_FAILED": WRONG_ENTITY,
    "HYPOTHESIS_COMPATIBILITY_FAILED": IRRELEVANT,
    "MARKET_SCOPE_REJECTED": ENTERPRISE,
    "ACTOR_ROLE_EXCLUDED": WRONG_ACTOR,
}


def canonical_url_key(url: str) -> str:
    text = str(url or "").strip().casefold()
    if not text:
        return ""
    for marker in ("#", "?"):
        if marker in text:
            text = text.split(marker, 1)[0]
    return text.rstrip("/")


@dataclass
class TerminalUrlRecord:
    search_id: str
    canonical_url: str
    content_hash: str = ""
    fetch_status: str = ""
    semantic_interpretation_id: str = ""
    terminal_status: str = SEMANTICALLY_REJECTED
    terminal_reason: str = ""
    terminal_at: str = ""
    source_published_at: Optional[str] = None
    event_date: Optional[str] = None
    primary_rejection_code: Optional[str] = None
    failed_gate_codes: Tuple[str, ...] = ()
    false_checks: Tuple[str, ...] = ()
    eligible_for_semantic_call: bool = False

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["failed_gate_codes"] = list(self.failed_gate_codes)
        payload["false_checks"] = list(self.false_checks)
        payload["eligible_for_semantic_call"] = False if self.terminal_status in TERMINAL_STATUSES else bool(
            self.eligible_for_semantic_call
        )
        return payload

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "TerminalUrlRecord":
        return cls(
            search_id=str(value.get("search_id") or ""),
            canonical_url=canonical_url_key(str(value.get("canonical_url") or value.get("url") or "")),
            content_hash=str(value.get("content_hash") or ""),
            fetch_status=str(value.get("fetch_status") or ""),
            semantic_interpretation_id=str(value.get("semantic_interpretation_id") or ""),
            terminal_status=str(value.get("terminal_status") or SEMANTICALLY_REJECTED),
            terminal_reason=str(value.get("terminal_reason") or ""),
            terminal_at=str(value.get("terminal_at") or ""),
            source_published_at=(str(value["source_published_at"]) if value.get("source_published_at") else None),
            event_date=(str(value["event_date"]) if value.get("event_date") else None),
            primary_rejection_code=(
                str(value["primary_rejection_code"]) if value.get("primary_rejection_code") else None
            ),
            failed_gate_codes=tuple(
                str(item) for item in (value.get("failed_gate_codes") or ()) if str(item).strip()
            ),
            false_checks=tuple(str(item) for item in (value.get("false_checks") or ()) if str(item).strip()),
            eligible_for_semantic_call=False,
        )


def _newer(left: str, right: str) -> bool:
    return str(left or "") >= str(right or "")


def merge_terminal_records(
    *records: Optional[TerminalUrlRecord],
) -> Optional[TerminalUrlRecord]:
    """Prefer the richer / more recent terminal record for the same URL."""
    alive = [item for item in records if item is not None and item.canonical_url]
    if not alive:
        return None
    best = alive[0]
    for item in alive[1:]:
        if item.canonical_url != best.canonical_url:
            continue
        # Keep terminal status if either side is terminal.
        if item.terminal_status in TERMINAL_STATUSES and best.terminal_status not in TERMINAL_STATUSES:
            best = item
            continue
        if _newer(item.terminal_at, best.terminal_at):
            # Merge fields so ops_park restore never drops prior terminal reasons.
            best = TerminalUrlRecord(
                search_id=item.search_id or best.search_id,
                canonical_url=best.canonical_url,
                content_hash=item.content_hash or best.content_hash,
                fetch_status=item.fetch_status or best.fetch_status,
                semantic_interpretation_id=item.semantic_interpretation_id or best.semantic_interpretation_id,
                terminal_status=item.terminal_status if item.terminal_status in TERMINAL_STATUSES else best.terminal_status,
                terminal_reason=item.terminal_reason or best.terminal_reason,
                terminal_at=item.terminal_at or best.terminal_at,
                source_published_at=item.source_published_at or best.source_published_at,
                event_date=item.event_date or best.event_date,
                primary_rejection_code=item.primary_rejection_code or best.primary_rejection_code,
                failed_gate_codes=tuple(dict.fromkeys((*best.failed_gate_codes, *item.failed_gate_codes))),
                false_checks=tuple(dict.fromkeys((*best.false_checks, *item.false_checks))),
                eligible_for_semantic_call=False,
            )
        else:
            best = TerminalUrlRecord(
                search_id=best.search_id or item.search_id,
                canonical_url=best.canonical_url,
                content_hash=best.content_hash or item.content_hash,
                fetch_status=best.fetch_status or item.fetch_status,
                semantic_interpretation_id=best.semantic_interpretation_id or item.semantic_interpretation_id,
                terminal_status=best.terminal_status if best.terminal_status in TERMINAL_STATUSES else item.terminal_status,
                terminal_reason=best.terminal_reason or item.terminal_reason,
                terminal_at=best.terminal_at or item.terminal_at,
                source_published_at=best.source_published_at or item.source_published_at,
                event_date=best.event_date or item.event_date,
                primary_rejection_code=best.primary_rejection_code or item.primary_rejection_code,
                failed_gate_codes=tuple(dict.fromkeys((*item.failed_gate_codes, *best.failed_gate_codes))),
                false_checks=tuple(dict.fromkeys((*item.false_checks, *best.false_checks))),
                eligible_for_semantic_call=False,
            )
    return best


def ledger_from_mapping(value: Any) -> Dict[str, TerminalUrlRecord]:
    raw = value if isinstance(value, Mapping) else {}
    rows = raw.get("urls") if isinstance(raw.get("urls"), Mapping) else raw
    out: Dict[str, TerminalUrlRecord] = {}
    if not isinstance(rows, Mapping):
        return out
    for key, item in rows.items():
        if not isinstance(item, Mapping):
            continue
        record = TerminalUrlRecord.from_mapping({**item, "canonical_url": item.get("canonical_url") or key})
        if not record.canonical_url:
            continue
        out[record.canonical_url] = record
    return out


def ledger_to_mapping(ledger: Mapping[str, TerminalUrlRecord]) -> Dict[str, Any]:
    return {
        "urls": {key: record.to_dict() for key, record in sorted(ledger.items())},
    }


def merge_terminal_ledgers(*ledgers: Mapping[str, TerminalUrlRecord]) -> Dict[str, TerminalUrlRecord]:
    merged: Dict[str, TerminalUrlRecord] = {}
    for ledger in ledgers:
        for key, record in (ledger or {}).items():
            url = canonical_url_key(key) or record.canonical_url
            if not url:
                continue
            merged[url] = merge_terminal_records(merged.get(url), record) or record
    return merged


def is_terminal_url(ledger: Mapping[str, TerminalUrlRecord], url: str) -> bool:
    record = ledger.get(canonical_url_key(url))
    return bool(record and record.terminal_status in TERMINAL_STATUSES)


def eligible_for_semantic_call(ledger: Mapping[str, TerminalUrlRecord], url: str) -> bool:
    return not is_terminal_url(ledger, url)


def filter_nonterminal_urls(urls: Sequence[str], ledger: Mapping[str, TerminalUrlRecord]) -> Tuple[str, ...]:
    return tuple(url for url in urls if str(url).strip() and eligible_for_semantic_call(ledger, url))


def mark_terminal(
    ledger: MutableMapping[str, TerminalUrlRecord],
    *,
    search_id: str,
    url: str,
    terminal_status: str,
    terminal_reason: str,
    content_hash: str = "",
    fetch_status: str = "fetched",
    semantic_interpretation_id: str = "",
    source_published_at: Optional[str] = None,
    event_date: Optional[str] = None,
    primary_rejection_code: Optional[str] = None,
    failed_gate_codes: Sequence[str] = (),
    false_checks: Sequence[str] = (),
) -> TerminalUrlRecord:
    status = str(terminal_status or SEMANTICALLY_REJECTED)
    if status not in TERMINAL_STATUSES:
        status = SEMANTICALLY_REJECTED
    record = TerminalUrlRecord(
        search_id=str(search_id or ""),
        canonical_url=canonical_url_key(url),
        content_hash=str(content_hash or ""),
        fetch_status=str(fetch_status or ""),
        semantic_interpretation_id=str(semantic_interpretation_id or ""),
        terminal_status=status,
        terminal_reason=str(terminal_reason or ""),
        terminal_at=datetime.now(timezone.utc).isoformat(),
        source_published_at=source_published_at,
        event_date=event_date,
        primary_rejection_code=primary_rejection_code,
        failed_gate_codes=tuple(str(item) for item in failed_gate_codes if str(item).strip()),
        false_checks=tuple(str(item) for item in false_checks if str(item).strip()),
        eligible_for_semantic_call=False,
    )
    ledger[record.canonical_url] = merge_terminal_records(ledger.get(record.canonical_url), record) or record
    return ledger[record.canonical_url]


def terminal_status_for_rejection(
    *,
    primary_rejection_code: Optional[str],
    false_checks: Sequence[str] = (),
) -> Tuple[str, str]:
    code = str(primary_rejection_code or "")
    checks = {str(item) for item in false_checks}
    if "temporal_evidence_valid" in checks or code == "EVENT_GROUNDING_FAILED":
        return STALE_EVENT, "temporal_evidence_valid_false"
    if code in REJECTION_TO_TERMINAL:
        return REJECTION_TO_TERMINAL[code], code.lower()
    return SEMANTICALLY_REJECTED, code.lower() or "semantically_rejected"


def merge_ops_park_progress(
    restored_progress: Mapping[str, Any],
    live_progress: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Restore cursor/progress while MERGING terminal ledgers (never replace)."""
    restored = dict(restored_progress or {})
    live = dict(live_progress or {})
    restored_ledger = ledger_from_mapping(
        (restored.get("shadow_resume") or {}).get("terminal_url_ledger")
        if isinstance(restored.get("shadow_resume"), Mapping)
        else restored.get("terminal_url_ledger")
    )
    live_ledger = ledger_from_mapping(
        (live.get("shadow_resume") or {}).get("terminal_url_ledger")
        if isinstance(live.get("shadow_resume"), Mapping)
        else live.get("terminal_url_ledger")
    )
    grounding_rows = []
    for bucket in (
        restored.get("grounding_rejects"),
        live.get("grounding_rejects"),
        ((restored.get("shadow_resume") or {}) if isinstance(restored.get("shadow_resume"), Mapping) else {}).get(
            "grounding_rejects"
        ),
    ):
        if isinstance(bucket, list):
            grounding_rows.extend(item for item in bucket if isinstance(item, Mapping))

    for row in grounding_rows:
        url = str(row.get("url") or "")
        if not url:
            continue
        status, reason = terminal_status_for_rejection(
            primary_rejection_code=str(row.get("primary_rejection_code") or row.get("rejection_code") or ""),
            false_checks=list(row.get("false_checks") or ()),
        )
        # Classification stamp from Case A forensic fixture.
        if str(row.get("classification") or "") == "VALID_EVENT_BUT_STALE_FOR_QUERY":
            status, reason = STALE_EVENT, "temporal_evidence_valid_false"
        mark_terminal(
            restored_ledger,
            search_id=str(row.get("search_id") or restored.get("search_id") or ""),
            url=url,
            terminal_status=status,
            terminal_reason=reason,
            event_date=(str(row["event_date"]) if row.get("event_date") else None),
            primary_rejection_code=str(row.get("primary_rejection_code") or row.get("rejection_code") or "") or None,
            failed_gate_codes=list(row.get("failed_gate_codes") or ()),
            false_checks=list(row.get("false_checks") or ()),
            content_hash=str(row.get("content_hash") or ""),
        )

    merged = merge_terminal_ledgers(live_ledger, restored_ledger)
    shadow = dict(restored.get("shadow_resume") or {})
    if isinstance(live.get("shadow_resume"), Mapping):
        # Merge shadow keys; terminal ledger always from merged ledgers.
        live_shadow = dict(live.get("shadow_resume") or {})
        for key, value in live_shadow.items():
            if key == "terminal_url_ledger":
                continue
            if key not in shadow or shadow.get(key) in (None, {}, [], ""):
                shadow[key] = value
    shadow["terminal_url_ledger"] = ledger_to_mapping(merged)
    restored["shadow_resume"] = shadow
    restored["terminal_url_ledger"] = ledger_to_mapping(merged)
    return restored


def kastamonu_stale_record(*, search_id: str, url: str) -> TerminalUrlRecord:
    return TerminalUrlRecord(
        search_id=search_id,
        canonical_url=canonical_url_key(url),
        terminal_status=STALE_EVENT,
        terminal_reason="temporal_evidence_valid_false",
        terminal_at=datetime.now(timezone.utc).isoformat(),
        event_date="2024-06-28",
        source_published_at="2024-06-28",
        primary_rejection_code="EVENT_GROUNDING_FAILED",
        failed_gate_codes=("EVENT_GROUNDING_FAILED",),
        false_checks=("temporal_evidence_valid",),
        eligible_for_semantic_call=False,
        fetch_status="fetched",
    )
