#!/usr/bin/env python3
import json, sys
from dotenv import dotenv_values
from supabase import create_client

env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = sys.argv[1]
s = sb.table("searches").select("progress,results").eq("id", sid).single().execute().data
prog = s.get("progress") or {}
print("rejection_codes", json.dumps(prog.get("rejection_codes"), ensure_ascii=False))
print("adapter_telemetry", json.dumps(prog.get("adapter_telemetry"), ensure_ascii=False)[:6000])
print("shadow_resume_acq", json.dumps((prog.get("shadow_resume") or {}).get("acquisition"), ensure_ascii=False)[:4000])
print("projection", json.dumps(prog.get("projection_traces"), ensure_ascii=False)[:3000])
cands = sb.table("search_candidates").select("stage,rejection_code,canonical_domain,payload").eq("search_id", sid).limit(20).execute().data or []
print("candidates_rows", len(cands))
for c in cands[:10]:
    p = c.get("payload") or {}
    print(json.dumps({
        "stage": c.get("stage"),
        "rej": c.get("rejection_code"),
        "domain": c.get("canonical_domain"),
        "title": p.get("vacancy_title") or p.get("hiring_title") or p.get("company_name"),
        "name": p.get("ragione_sociale") or p.get("company_name"),
    }, ensure_ascii=False))
