#!/usr/bin/env python3
import json
from dotenv import dotenv_values
from supabase import create_client

env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

for sid in [
    "590daa06-adf7-48f2-bc45-935f6a55e75a",
    "84da94c5-6eee-4dfa-9393-bf29a26548c0",
    "8ed5e2a1-d78d-43ac-be36-050b43f44d76",
]:
    job = sb.table("searches").select("status,progress,intent,results").eq("id", sid).single().execute().data
    prog = job.get("progress") or {}
    sr = prog.get("shadow_resume") or {}
    acq = sr.get("acquisition") or {}
    print("===", sid[:8], job.get("status"), "===")
    print("stop", prog.get("stop_reason"))
    for tel in prog.get("adapter_telemetry") or []:
        if tel.get("adapter_id") == "generic_web_research_v1":
            print("generic", json.dumps({k: tel.get(k) for k in (
                "provider_queries", "pages_fetched", "raw_candidates", "semantic_calls",
                "rejection_histogram", "last_error", "semantic_grounding",
            )}, default=str)[:2000])
    qual = sr.get("qualification") or {}
    if qual:
        print("qual", json.dumps(qual, default=str)[:1500])
    print("url_outcomes", len(acq.get("url_outcomes") or []), "pending", len(acq.get("queued_urls") or []))
    print("results", len(job.get("results") or []))
    print()
