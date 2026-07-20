#!/usr/bin/env python3
import json
from collections import Counter
from dotenv import dotenv_values
from supabase import create_client

env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = "64578716-af8a-448b-a379-7684e429a900"
row = sb.table("searches").select("status,progress,results").eq("id", sid).single().execute().data
prog = row.get("progress") or {}
acq = (prog.get("shadow_resume") or {}).get("acquisition") or {}
outcomes = acq.get("url_outcomes") or []
print("status", row.get("status"), "cost", prog.get("cost_eur"), "term", prog.get("termination_reason"))
print("outcomes", len(outcomes), "rej", dict(Counter(o.get("rejection_code") for o in outcomes).most_common()))
italy = []
for o in outcomes:
    loc = str(o.get("location") or "")
    title = o.get("vacancy_title")
    if any(x in loc.lower() for x in ("ital", "milan", "roma", "turin", "torino", "bologna", "napoli", "padova")):
        italy.append({"loc": loc, "title": title, "emp": o.get("employer"), "rej": o.get("rejection_code"), "url": (o.get("url") or "")[:120]})
print("italy_like", json.dumps(italy[:15], ensure_ascii=False))
# executed queries from cursor
import base64, re
cur = None
for t in prog.get("adapter_telemetry") or []:
    if t.get("adapter_id") == "structured_hiring_v1":
        cur = t.get("next_cursor")
print("cursor", cur)
if cur and "hiring:v2:" in str(cur):
    raw = str(cur).split("hiring:v2:", 1)[1]
    try:
        import json as J
        # may be url-safe json
        data = J.loads(raw)
        print("queries", data.get("executed_query_keys"))
    except Exception as e:
        print("cursor_parse", e, raw[:200])
