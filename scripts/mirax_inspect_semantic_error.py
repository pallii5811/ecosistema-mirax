#!/usr/bin/env python3
import json
from dotenv import dotenv_values
from supabase import create_client

env = dotenv_values("/home/worker/app/backend-staging/.env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = "590daa06-adf7-48f2-bc45-935f6a55e75a"
job = sb.table("searches").select("progress").eq("id", sid).single().execute().data
prog = job.get("progress") or {}
sr = prog.get("shadow_resume") or {}
# dump rejection / semantic details
for key in sorted(prog.keys()):
    if "semantic" in key.lower() or "reject" in key.lower() or "error" in key.lower():
        print(key, json.dumps(prog.get(key), default=str)[:800])
for key in sorted(sr.keys()):
    val = sr.get(key)
    if isinstance(val, dict):
        print("sr." + key, json.dumps(val, default=str)[:1200])
    else:
        print("sr." + key, val)
