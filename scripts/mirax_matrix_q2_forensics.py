#!/usr/bin/env python3
from collections import Counter
from dotenv import dotenv_values
from supabase import create_client

env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = "84a9ffa8-c7f1-4d60-9eed-1115a783805f"
rows = sb.table("search_cost_ledger").select(
    "operation_type,source_class,provider,actual_cost_eur,metadata"
).eq("search_id", sid).execute().data or []
c = Counter()
tot = 0.0
for r in rows:
    k = "|".join([
        str(r.get("operation_type")),
        str(r.get("source_class")),
        str(r.get("provider")),
    ])
    c[k] += 1
    tot += float(r.get("actual_cost_eur") or 0)
print("entries", len(rows), "total", round(tot, 6))
for k, v in c.most_common():
    print(v, k)
s = sb.table("searches").select("zone,intent,progress").eq("id", sid).single().execute().data
intent = s.get("intent") or {}
print("zone", s.get("zone"))
print(
    "requested",
    intent.get("requested_leads"),
    intent.get("max_leads"),
    intent.get("lead_target"),
)
print("mandatory", intent.get("mandatory_adapter_ids"))
print("source_plan", intent.get("source_plan"))
prog = s.get("progress") or {}
print("rejection_codes", prog.get("rejection_codes"))
print("coverage", prog.get("coverage_status"), prog.get("coverage_reasons"))
print("adapter_telemetry", prog.get("adapter_telemetry"))
