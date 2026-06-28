#!/usr/bin/env python3
"""Unit tests — Blocco 1 worker merge + pending audit (run: python test_block1_worker.py)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("worker_supabase", ROOT / "worker_supabase.py")
worker = importlib.util.module_from_spec(spec)
sys.modules["worker_supabase"] = worker
spec.loader.exec_module(worker)

_merge_formatted_results = worker._merge_formatted_results
_pending = worker._lead_has_pending_audit
_quality = worker._lead_merge_quality


def test_merge_prefers_complete_audit_over_pending():
    pending = {
        "sito": "https://example.com",
        "telefono": "3331234567",
        "tech_stack": ["Verifica in corso"],
    }
    complete = {
        "sito": "https://example.com",
        "telefono": "3331234567",
        "tech_stack": ["SSL", "MISSING FB PIXEL", "GTM"],
        "technical_report": {"has_google_ads": False, "load_speed_seconds": 2.1},
        "last_audited_at": "2026-06-25T12:00:00+00:00",
        "audit_version": 2,
    }
    merged = _merge_formatted_results([pending], [complete])
    assert len(merged) == 1
    assert not _pending(merged[0])
    assert "Verifica in corso" not in " ".join(merged[0].get("tech_stack") or [])


def test_merge_keeps_phone_when_incoming_incomplete():
    base = {
        "sito": "https://foo.it",
        "telefono": "3339998888",
        "tech_stack": ["Verifica in corso"],
    }
    audited = {
        "sito": "https://foo.it",
        "tech_stack": ["SSL", "Meta Pixel"],
        "technical_report": {"has_google_ads": True},
    }
    merged = _merge_formatted_results([base], [audited])
    assert merged[0].get("telefono") == "3339998888"


def test_pending_detection():
    assert _pending({"tech_stack": ["Audit in arrivo"]})
    assert not _pending({"tech_stack": ["SSL"], "technical_report": {"has_google_ads": False}})


def main():
    tests = [
        test_merge_prefers_complete_audit_over_pending,
        test_merge_keeps_phone_when_incoming_incomplete,
        test_pending_detection,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print("OK", t.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", t.__name__, e)
    if failed:
        sys.exit(1)
    print("\nAll Block 1 worker tests passed.")


if __name__ == "__main__":
    main()
