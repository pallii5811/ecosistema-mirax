#!/usr/bin/env python3
"""Resume a shadow matrix search with dotenv-loaded worker env."""
from __future__ import annotations
import json, os, subprocess, sys
from pathlib import Path
from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
env = dotenv_values(ROOT / ".env")
os.environ.update({k: v for k, v in env.items() if v is not None})
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
sid = sys.argv[1]
row = sb.table("searches").select("id,status,progress").eq("id", sid).single().execute().data
prog = row.get("progress") or {}
sr = prog.get("shadow_resume") or {}
print(json.dumps({
    "search_id": sid,
    "status": row.get("status"),
    "resumable": sr.get("resumable"),
    "prior_cost": prog.get("cost_eur") or sr.get("prior_cost_eur"),
    "termination": prog.get("termination_reason"),
}, ensure_ascii=False))
if not sr.get("resumable"):
    print("NOT_RESUMABLE")
    sys.exit(2)
sb.table("searches").update({"status": "pending"}).eq("id", sid).execute()
run_env = os.environ.copy()
run_env.update({
    "MIRAX_WORKER_DISABLED": "0",
    "MIRAX_SEARCH_DISABLED": "0",
    "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1",
    "MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": "0.05",
    "MIRAX_ORCHESTRATOR_MAX_SECONDS": "300",
    "PYTHONUNBUFFERED": "1",
    "PYTHONPATH": str(ROOT),
})
proc = subprocess.run(
    [
        "/home/worker/app/venv/bin/python", "-u", "worker_supabase.py",
        "--once", "--search-id", sid, "--mode", "user",
        "--user-recent-minutes", "0", "--cooldown", "0",
    ],
    cwd=str(ROOT),
    env=run_env,
    capture_output=True,
    text=True,
)
print(proc.stdout[-4000:])
if proc.stderr:
    print(proc.stderr[-1500:])
print("WORKER_EXIT", proc.returncode)
