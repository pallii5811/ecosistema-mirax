#!/usr/bin/env python3
from collections import Counter
from dotenv import dotenv_values
from supabase import create_client
import json, sys

env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = sys.argv[1]
s = sb.table("searches").select("status,progress,results").eq("id", sid).single().execute().data
prog = s.get("progress") or {}
rows = sb.table("search_cost_ledger").select(
    "operation_type,source_class,provider,actual_cost_eur,metadata"
).eq("search_id", sid).execute().data or []
c = Counter()
tot = 0.0
ops = Counter()
for r in rows:
    ops[str(r.get("operation_type"))] += 1
    c[f"{r.get('operation_type')}|{r.get('source_class')}|{r.get('provider')}"] += 1
    tot += float(r.get("actual_cost_eur") or 0)
tel = (prog.get("adapter_telemetry") or [{}])[0] if prog.get("adapter_telemetry") else {}
out = {
    "status": s.get("status"),
    "cost_total": round(tot, 6),
    "ledger_entries": len(rows),
    "ops": dict(ops),
    "by_class": dict(c),
    "target": prog.get("target"),
    "qualified": prog.get("qualified"),
    "raw": prog.get("raw"),
    "termination": prog.get("termination_reason"),
    "stop": prog.get("stop_reason"),
    "rejection_codes": prog.get("rejection_codes"),
    "coverage": prog.get("coverage_status"),
    "coverage_reasons": prog.get("coverage_reasons"),
    "missing_signals": prog.get("missing_signals"),
    "adapter": {
        "provider_queries": tel.get("provider_queries"),
        "results_received": tel.get("results_received"),
        "pages_fetched": tel.get("pages_fetched"),
        "raw_candidates": tel.get("raw_candidates"),
        "semantic_calls": tel.get("semantic_calls"),
        "grounded": tel.get("grounded"),
        "qualified": tel.get("qualified"),
        "actual_cost": tel.get("actual_cost"),
        "termination": tel.get("termination"),
        "rejection_histogram": tel.get("rejection_histogram"),
        "rejected_candidates": (tel.get("rejected_candidates") or [])[:8],
    },
    "limitations": prog.get("shadow_resume", {}).get("limitations") if isinstance(prog.get("shadow_resume"), dict) else None,
}
# Also peek first few ledger metadata result counts
out["ledger_meta_sample"] = [
    {
        "op": r.get("operation_type"),
        "cost": r.get("actual_cost_eur"),
        "rc": (r.get("metadata") or {}).get("result_count"),
        "model": r.get("model"),
    }
    for r in rows[:15]
]
print(json.dumps(out, ensure_ascii=False, default=str)[:12000])
