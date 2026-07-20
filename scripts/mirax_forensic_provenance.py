#!/usr/bin/env python3
"""Search-ID-scoped forensic provenance extraction."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
env = dotenv_values(ROOT / ".env")
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

SEARCH_IDS = {
    "q4": "d12c29bb-32f5-4cca-93d4-6e579e92d489",
    "q7": "71e2fe92-43c4-485c-9cf7-213b731b459b",
    "q2": "313b7df7-a9a5-40a0-9a31-4e8a27460472",
}


def _rows(table: str, sid: str, select: str = "*") -> list:
    try:
        return sb.table(table).select(select).eq("search_id", sid).execute().data or []
    except Exception as exc:
        return [{"_error": str(exc), "table": table}]


def extract(sid: str) -> dict:
    job = sb.table("searches").select("id,status,created_at,updated_at,intent,progress,results").eq("id", sid).single().execute().data
    prog = job.get("progress") or {}
    intent = job.get("intent") or {}
    ledger = _rows("search_cost_ledger", sid)
    candidates = _rows("search_candidates", sid)
    evidence = _rows("search_evidence", sid)
    publications = _rows("search_publications", sid)
    budget = _rows("search_budget_state", sid)

    ops = Counter()
    total_cost = 0.0
    for row in ledger:
        ops[str(row.get("operation_type"))] += 1
        total_cost += float(row.get("actual_cost_eur") or 0)

    adapter_tel = prog.get("adapter_telemetry") or []
    shadow = prog.get("shadow_resume") or {}
    leads = []
    for r in job.get("results") or []:
        if not isinstance(r, dict):
            continue
        leads.append({
            "company_name": r.get("company_name") or r.get("ragione_sociale"),
            "official_domain": r.get("official_domain"),
            "sito": r.get("sito"),
            "website": r.get("website"),
            "employer_official_domain": r.get("employer_official_domain"),
            "source_url": r.get("source_url") or r.get("url"),
            "field_provenance_domain": ((r.get("field_provenance") or {}).get("official_domain") or {}).get("value"),
        })

    cand_rows = []
    for c in candidates:
        p = c.get("payload") or {}
        cand_rows.append({
            "id": c.get("id"),
            "stage": c.get("stage"),
            "rejection_code": c.get("rejection_code"),
            "canonical_domain": c.get("canonical_domain"),
            "official_domain_verified": c.get("official_domain_verified"),
            "semantic_authority_passed": c.get("semantic_authority_passed"),
            "company": p.get("company_name") or p.get("ragione_sociale"),
            "official_domain": p.get("official_domain"),
            "sito": p.get("sito"),
            "employer_official_domain": p.get("employer_official_domain"),
            "source_url": p.get("source_url") or p.get("url"),
            "origin_adapter_id": p.get("origin_adapter_id") or (p.get("provenance") or {}).get("origin_adapter_id"),
            "origin_page_fetch_id": p.get("origin_page_fetch_id"),
            "origin_semantic_call_id": p.get("origin_semantic_call_id"),
            "origin_source_text_hash": p.get("origin_source_text_hash"),
        })

    return {
        "search_id": sid,
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "vertical": (intent.get("query_compiler_telemetry") or {}).get("matrix_vertical"),
        "mandatory_adapters": intent.get("mandatory_adapter_ids"),
        "termination": prog.get("termination_reason") or prog.get("stop_reason"),
        "stop_reason": prog.get("stop_reason"),
        "target": prog.get("target"),
        "qualified": prog.get("qualified"),
        "cost_eur_progress": prog.get("cost_eur"),
        "cost_ledger_total": round(total_cost, 6),
        "ledger_ops": dict(ops),
        "ledger_entries": len(ledger),
        "ledger_sample": ledger[:12],
        "adapter_telemetry": adapter_tel,
        "resume_cursor": prog.get("resume_cursor"),
        "shadow_resume_keys": sorted(shadow.keys()) if isinstance(shadow, dict) else [],
        "acquisition_summary": {
            "queued_urls": (shadow.get("acquisition") or {}).get("queued_urls"),
            "url_outcomes_count": len((shadow.get("acquisition") or {}).get("url_outcomes") or []),
            "rejection_histogram": Counter(
                o.get("rejection_code") for o in (shadow.get("acquisition") or {}).get("url_outcomes") or []
            ),
        },
        "rejection_codes": prog.get("rejection_codes"),
        "candidates": cand_rows,
        "evidence_rows": len(evidence),
        "publications": len(publications),
        "budget_state": budget,
        "final_leads": leads,
    }


def main() -> None:
    ids = SEARCH_IDS
    if len(sys.argv) > 1:
        ids = {"custom": sys.argv[1]}
    out = {k: extract(v) for k, v in ids.items()}
    print(json.dumps(out, ensure_ascii=False, default=str)[:50000])


if __name__ == "__main__":
    main()
