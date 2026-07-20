#!/usr/bin/env python3
"""Quick forensic dump for a single search id."""
import json
import os
import sys
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
env = dotenv_values(ROOT / ".env")
os.environ.update({k: v for k, v in env.items() if v})
sid = sys.argv[1]
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
j = sb.table("searches").select("status,progress,results").eq("id", sid).single().execute().data
p = j["progress"]
sr = p.get("shadow_resume") or {}
acq = sr.get("acquisition") or {}
tel = (p.get("adapter_telemetry") or [{}])[0]
outcomes = acq.get("url_outcomes") or []
codes: dict[str, int] = {}
for o in outcomes:
    c = o.get("rejection_code") or o.get("status") or "unknown"
    codes[c] = codes.get(c, 0) + 1
print(json.dumps({"progress_keys": list(p.keys()), "shadow_resume_keys": list(sr.keys())}, indent=2))
url_meta = gw.get("url_meta") or {}
meta_codes: dict[str, int] = {}
for _u, meta in url_meta.items():
    c = meta.get("rejection_code") or meta.get("status") or "unknown"
    meta_codes[c] = meta_codes.get(c, 0) + 1
semantic = sr.get("semantic") or {}
print(
    json.dumps(
        {
            "status": j["status"],
            "stop": p.get("stop_reason"),
            "fallback": p.get("fallback_reason"),
            "error_type": p.get("error_type"),
            "telemetry": {k: tel.get(k) for k in (
                "pages_fetched", "raw_candidates", "semantic_calls", "grounded",
                "qualified", "rejection_histogram", "last_error", "termination",
                "query_telemetry", "semantic_grounding",
            )},
            "generic_web": {k: gw.get(k) for k in (
                "pending_urls", "pages_fetched", "serp_calls", "budget_exhausted",
            )},
            "url_meta_count": len(url_meta),
            "url_meta_codes": meta_codes,
            "url_meta_samples": [
                {"url": u[:90], **{k: m.get(k) for k in (
                    "status", "rejection_code", "company_hint", "http_status",
                    "semantic_error", "grounding_accepted",
                )}}
                for u, m in list(url_meta.items())[:25]
            ],
            "semantic_summary": {k: semantic.get(k) for k in ("calls", "grounded", "errors")},
            "outcome_codes": codes,
            "results": j.get("results") or [],
        },
        ensure_ascii=False,
        indent=2,
    )
)
