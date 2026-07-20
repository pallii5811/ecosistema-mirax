#!/usr/bin/env python3
"""Poll matrix search status from staging Supabase."""
from __future__ import annotations
import json, os, sys
from pathlib import Path
from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
env = dotenv_values(ROOT / ".env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = sys.argv[1] if len(sys.argv) > 1 else None
if not sid:
    meta = json.loads(Path("/tmp/mirax_matrix_last_ids.json").read_text(encoding="utf-8"))
    sid = meta["search_id"]
    print("meta", json.dumps(meta, ensure_ascii=False))

row = sb.table("searches").select("id,status,progress,results,intent").eq("id", sid).limit(1).execute().data
if not row:
    print(json.dumps({"error": "not_found", "search_id": sid}))
    sys.exit(1)
s = row[0]
prog = s.get("progress") or {}
results = s.get("results") or []
intent = s.get("intent") or {}
leads = []
for r in results[:5]:
    if not isinstance(r, dict):
        continue
    leads.append({
        "company_name": r.get("company_name") or r.get("name") or r.get("ragione_sociale"),
        "official_domain": r.get("official_domain") or r.get("domain") or r.get("sito_web"),
        "target_role": r.get("target_role") or (r.get("semantic") or {}).get("target_role"),
        "source_url": r.get("source_url") or r.get("url") or (r.get("evidence") or [{}])[0].get("url") if isinstance(r.get("evidence"), list) and r.get("evidence") else r.get("source_url"),
        "why_now": r.get("why_now"),
        "why_fit": r.get("why_fit"),
        "confidence": r.get("confidence") or r.get("score"),
        "capability": r.get("capability_status") or r.get("capability"),
    })
out = {
    "search_id": sid,
    "status": s.get("status"),
    "result_count": len(results),
    "cost_eur": prog.get("cost_eur") or prog.get("spent_eur") or prog.get("total_cost_eur"),
    "termination": prog.get("termination_reason") or prog.get("stop_reason") or prog.get("capability_status"),
    "progress_keys": sorted(list(prog.keys()))[:40],
    "progress_snip": {k: prog.get(k) for k in ("phase", "message", "accepted", "qualified", "raw", "grounded", "capability_status", "termination_reason", "stop_reason", "cost_eur", "spent_eur", "target") if k in prog},
    "leads": leads,
    "compiler": (intent.get("query_compiler_telemetry") or {}),
}
print(json.dumps(out, ensure_ascii=False, default=str)[:8000])
