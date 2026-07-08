"""Pure helpers for crash-safe search worker leases."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Mapping, Optional


def parse_utc_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def is_processing_job_stale(
    row: Mapping[str, Any],
    *,
    now: Optional[datetime] = None,
    legacy_after: timedelta = timedelta(hours=12),
) -> bool:
    """A leased job is stale only after its lease; legacy jobs use a long fallback."""
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    deadline = parse_utc_timestamp(row.get("lease_expires_at"))
    if deadline is not None:
        return deadline < current
    last_activity = parse_utc_timestamp(row.get("heartbeat_at")) or parse_utc_timestamp(row.get("created_at"))
    return last_activity is not None and last_activity < current - legacy_after


def build_claim_payload(
    *,
    worker_id: str,
    target: int,
    attempt_count: int,
    lease_minutes: int,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    now_iso = current.isoformat()
    return {
        "status": "processing",
        "worker_id": worker_id,
        "heartbeat_at": now_iso,
        "lease_expires_at": (current + timedelta(minutes=lease_minutes)).isoformat(),
        "attempt_count": max(0, int(attempt_count)) + 1,
        "progress": {"phase": "claimed", "found": 0, "target": target, "updated_at": now_iso},
    }
