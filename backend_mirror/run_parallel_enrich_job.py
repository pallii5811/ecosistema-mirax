#!/usr/bin/env python3
"""Enrichment parallelo one-shot per job completato."""
from __future__ import annotations

import asyncio
import json
import os
import sys

_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
for line in open(_ENV_PATH):
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.strip().split("=", 1)
        os.environ.setdefault(k, v)

from supabase import create_client
from business_events_enrich import enrich_results_business_events, resolve_enrichment_cap

JID = sys.argv[1] if len(sys.argv) > 1 else "b3593264-d378-4ec9-8f46-ca468b32b65d"
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
row = sb.table("searches").select("results,location").eq("id", JID).single().execute().data
results = row.get("results") or []
intent = {
    "query": "agenzie marketing a Milano che stanno assumendo commerciali",
    "hiring_roles": ["commerciale"],
    "target_profile": {"roles": ["commerciale"], "locations": ["Milano"]},
    "signals": [{"type": "hiring", "params": {"role": "commerciale"}}],
}
pending = [l for l in results if isinstance(l, dict) and not l.get("business_events_external_at")]
print(f"pending {len(pending)}", flush=True)
cap = resolve_enrichment_cap(intent, len(pending))
batch = pending[:cap]


async def run() -> None:
    await enrich_results_business_events(
        batch,
        row.get("location") or "Milano",
        max_leads=cap,
        external_only=True,
        intent=intent,
    )


asyncio.run(run())
by_key: dict = {}
for l in results:
    if isinstance(l, dict):
        by_key[(l.get("telefono") or "") + "|" + (l.get("azienda") or "")] = l
for l in batch:
    by_key[(l.get("telefono") or "") + "|" + (l.get("azienda") or "")] = l
merged = list(by_key.values())
hiring = sum(
    1
    for l in merged
    if any(isinstance(s, dict) and s.get("type") == "hiring" for s in (l.get("business_signals") or []))
)
comm = sum(
    1
    for l in merged
    if any(isinstance(s, dict) and s.get("type") == "hiring" for s in (l.get("business_signals") or []))
    and "commerc" in json.dumps(l).lower()
)
sb.table("searches").update({"results": merged}).eq("id", JID).execute()
print(
    f"done external={sum(1 for l in batch if l.get('business_events_external_at'))} hiring={hiring} commerciale={comm}",
    flush=True,
)
