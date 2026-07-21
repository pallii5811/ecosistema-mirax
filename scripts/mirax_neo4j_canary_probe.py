#!/usr/bin/env python3
"""Neo4j staging canary: connect, read, write, sync Q7 leads."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(os.environ.get("MIRAX_BACKEND_ROOT", "/home/worker/app/backend-staging"))
env = dotenv_values(ROOT / ".env")
os.environ.update({k: v for k, v in env.items() if v})
sys.path.insert(0, str(ROOT))

from supabase import create_client
from universe_neo4j_sync import (
    get_neo4j_database,
    get_neo4j_driver,
    is_neo4j_enabled,
    sync_leads_to_graph,
)

Q7_SEARCH = os.environ.get("MIRAX_Q7_SEARCH_ID", "f6ae74ae-2175-45e0-b932-8cd15772f58f")


def main() -> int:
    report = {
        "neo4j_connected": False,
        "neo4j_readable": False,
        "neo4j_writable": False,
        "postgres_to_neo4j": "FAIL",
    }
    if not is_neo4j_enabled():
        print(json.dumps(report))
        return 1
    try:
        driver = get_neo4j_driver()
        db = get_neo4j_database()
        with driver.session(database=db) as session:
            report["neo4j_connected"] = True
            report["neo4j_readable"] = session.run("RETURN 1 AS ok").single()["ok"] == 1
            session.run(
                "MERGE (h:MiraxGraphHealth {id: $id}) SET h.checked_at = datetime(), h.ok = true",
                id="staging_canary_probe",
            ).consume()
            report["neo4j_writable"] = True
        sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
        leads = sb.table("searches").select("results").eq("id", Q7_SEARCH).single().execute().data.get("results") or []
        stats = sync_leads_to_graph(leads, driver=driver)
        report["postgres_to_neo4j"] = "PASS" if stats.get("synced", 0) >= 1 else "FAIL"
        report["sync_stats"] = stats
    except Exception as exc:  # pragma: no cover
        report["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(report, ensure_ascii=False))
        return 1
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["postgres_to_neo4j"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
