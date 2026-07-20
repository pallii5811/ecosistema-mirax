#!/usr/bin/env python3
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path("/tmp")))
from mirax_forensic_provenance import extract

IDS = sys.argv[1:] or [
    "4a238ca1-b86c-425c-9c75-fd04f4d9fb7e",
    "c035c8e4-2997-48bd-b2cb-7dda8cfc897b",
    "bd419328-88d1-4182-b077-9ffe1de92def",
]
for sid in IDS:
    d = extract(sid)
    tel = d.get("adapter_telemetry") or []
    print(json.dumps({
        "search_id": sid,
        "status": d.get("status"),
        "stop_reason": d.get("stop_reason"),
        "qualified": d.get("qualified"),
        "cost_ledger_total": d.get("cost_ledger_total"),
        "ledger_ops": d.get("ledger_ops"),
        "adapter_summary": [{k: t.get(k) for k in (
            "adapter_id", "provider_queries", "pages_fetched", "raw_candidates",
            "semantic_calls", "grounded", "qualified", "rejection_histogram", "query_telemetry",
        )} for t in tel],
        "final_leads": d.get("final_leads"),
        "rejection_codes": d.get("rejection_codes"),
    }, ensure_ascii=False))
