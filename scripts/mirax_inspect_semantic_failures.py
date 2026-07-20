#!/usr/bin/env python3
import json
import sys
from dotenv import dotenv_values
from supabase import create_client

sid = sys.argv[1] if len(sys.argv) > 1 else "4a238ca1-b86c-425c-9c75-fd04f4d9fb7e"
env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
job = sb.table("searches").select("progress").eq("id", sid).single().execute().data
prog = job.get("progress") or {}
print(json.dumps({
    "rejection_codes": prog.get("rejection_codes"),
    "adapter_telemetry": prog.get("adapter_telemetry"),
    "semantic_failures": [
        item for item in (prog.get("adapter_telemetry") or [])
        if item.get("rejection_histogram")
    ],
}, ensure_ascii=False, default=str)[:8000])
