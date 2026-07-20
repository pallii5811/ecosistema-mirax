#!/usr/bin/env python3
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mirax_forensic_provenance import extract

IDS = {
    "q4": "d12c29bb-32f5-4cca-93d4-6e579e92d489",
    "q7": "71e2fe92-43c4-485c-9cf7-213b731b459b",
    "q2": "313b7df7-a9a5-40a0-9a31-4e8a27460472",
}

for key, sid in IDS.items():
    d = extract(sid)
    tel = d.get("adapter_telemetry") or []
    out = {
        "search_id": d["search_id"],
        "status": d["status"],
        "termination": d["termination"],
        "stop_reason": d.get("stop_reason"),
        "target": d.get("target"),
        "qualified": d.get("qualified"),
        "cost_ledger_total": d.get("cost_ledger_total"),
        "ledger_ops": d.get("ledger_ops"),
        "candidates": d.get("candidates"),
        "final_leads": d.get("final_leads"),
        "rejection_codes": d.get("rejection_codes"),
        "adapter_summary": [
            {k: t.get(k) for k in (
                "adapter_id", "provider_queries", "pages_fetched", "raw_candidates",
                "semantic_calls", "grounded", "qualified", "actual_cost", "termination",
                "rejection_histogram",
            )}
            for t in tel
        ],
    }
    print(f"=== {key} ===")
    print(json.dumps(out, ensure_ascii=False, indent=2))
