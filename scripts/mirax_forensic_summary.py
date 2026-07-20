#!/usr/bin/env python3
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path("/tmp")))
from mirax_forensic_provenance import extract

IDS = {
    "q7_live": "590daa06-adf7-48f2-bc45-935f6a55e75a",
    "q2_live": "84da94c5-6eee-4dfa-9393-bf29a26548c0",
    "q4_live": "8ed5e2a1-d78d-43ac-be36-050b43f44d76",
    "q4_baseline": "d12c29bb-32f5-4cca-93d4-6e579e92d489",
    "q7_baseline": "71e2fe92-43c4-485c-9cf7-213b731b459b",
    "q2_baseline": "313b7df7-a9a5-40a0-9a31-4e8a27460472",
}

keys = sys.argv[1:] or ["q7_live", "q2_live", "q4_live"]
for key in keys:
    sid = IDS[key]
    d = extract(sid)
    tel = d.get("adapter_telemetry") or []
    out = {
        "key": key,
        "search_id": sid,
        "status": d.get("status"),
        "stop_reason": d.get("stop_reason") or d.get("termination"),
        "qualified": d.get("qualified"),
        "target": d.get("target"),
        "cost_ledger_total": d.get("cost_ledger_total"),
        "ledger_ops": d.get("ledger_ops"),
        "adapter_summary": [
            {x: t.get(x) for x in (
                "adapter_id", "provider_queries", "pages_fetched", "raw_candidates", "semantic_calls",
                "grounded", "qualified", "actual_cost", "termination", "rejection_histogram", "query_telemetry",
            )}
            for t in tel
        ],
        "final_leads": d.get("final_leads"),
        "candidates": d.get("candidates"),
        "rejection_codes": d.get("rejection_codes"),
    }
    print(json.dumps(out, ensure_ascii=False))
