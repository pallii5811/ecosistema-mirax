#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
from dotenv import dotenv_values
from supabase import create_client
ROOT = Path("/home/worker/app/backend-staging")
env = dotenv_values(ROOT / ".env")
os.environ.update({k: v for k, v in env.items() if v})
sid = sys.argv[1] if len(sys.argv) > 1 else "a5b341c3-95f4-405e-86c4-a0d4f79f9d75"
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
j = sb.table("searches").select("status,progress,results").eq("id", sid).single().execute().data
p = j["progress"]
t = (p.get("adapter_telemetry") or [{}])[0]
ledger = sb.table("search_cost_ledger").select("operation_type,actual_cost_eur").eq("search_id", sid).execute().data or []
print(json.dumps({
    "search_id": sid,
    "status": j["status"],
    "fallback_reason": p.get("fallback_reason"),
    "error_type": p.get("error_type"),
    "runtime_started": p.get("runtime_started"),
    "qualified": p.get("qualified"),
    "target": p.get("target"),
    "stop": p.get("stop_reason"),
    "rejection": p.get("rejection_codes"),
    "hist": t.get("rejection_histogram"),
    "pages": t.get("pages_fetched"),
    "raw": t.get("raw_candidates"),
    "grounded": t.get("grounded"),
    "qual_adapter": t.get("qualified"),
    "cost": round(sum(float(r["actual_cost_eur"]) for r in ledger), 4),
    "leads": [(r.get("company_name"), r.get("official_domain")) for r in (j.get("results") or [])],
}, ensure_ascii=False))
