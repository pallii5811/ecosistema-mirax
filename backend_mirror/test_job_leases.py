import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path

from job_leases import build_claim_payload, is_processing_job_stale, parse_utc_timestamp


NOW = datetime(2026, 7, 8, 12, 0, tzinfo=timezone.utc)


def test_parse_utc_timestamp_accepts_z_and_rejects_invalid() -> None:
    assert parse_utc_timestamp("2026-07-08T12:00:00Z") == NOW
    assert parse_utc_timestamp("not-a-date") is None


def test_active_lease_is_not_stale_even_for_old_job() -> None:
    row = {
        "created_at": (NOW - timedelta(days=2)).isoformat(),
        "lease_expires_at": (NOW + timedelta(minutes=1)).isoformat(),
    }
    assert not is_processing_job_stale(row, now=NOW)


def test_expired_lease_is_stale() -> None:
    row = {"lease_expires_at": (NOW - timedelta(seconds=1)).isoformat()}
    assert is_processing_job_stale(row, now=NOW)


def test_legacy_job_uses_conservative_fallback() -> None:
    assert not is_processing_job_stale({"created_at": (NOW - timedelta(hours=11)).isoformat()}, now=NOW)
    assert is_processing_job_stale({"created_at": (NOW - timedelta(hours=13)).isoformat()}, now=NOW)


def test_claim_payload_increments_attempt_and_sets_deadline() -> None:
    payload = build_claim_payload(
        worker_id="worker-a",
        target=1_000,
        attempt_count=2,
        lease_minutes=30,
        now=NOW,
    )
    assert payload["attempt_count"] == 3
    assert payload["progress"]["target"] == 1_000
    assert parse_utc_timestamp(payload["lease_expires_at"]) == NOW + timedelta(minutes=30)


def test_worker_main_does_not_shadow_threading_import() -> None:
    worker_path = Path(__file__).with_name("worker_supabase.py")
    tree = ast.parse(worker_path.read_text(encoding="utf-8"))
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
    local_threading_imports = [
        node
        for node in ast.walk(main)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        and (
            any(alias.name == "threading" for alias in node.names)
            if isinstance(node, ast.Import)
            else node.module == "threading"
        )
    ]
    assert not local_threading_imports


if __name__ == "__main__":
    test_parse_utc_timestamp_accepts_z_and_rejects_invalid()
    test_active_lease_is_not_stale_even_for_old_job()
    test_expired_lease_is_stale()
    test_legacy_job_uses_conservative_fallback()
    test_claim_payload_increments_attempt_and_sets_deadline()
    test_worker_main_does_not_shadow_threading_import()
    print("test_job_leases: 6/6 OK")
