#!/usr/bin/env python3
"""Open-world diverse query matrix — target 3 lifecycle leads per query.

Runs on staging via worker --once (persistent workers stay inactive+disabled).
Usage on server: python scripts/run_openworld_diverse_matrix.py [q2|q4|q7|all]
"""
from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
sys.path.insert(0, str(ROOT))

from contracts.commercial_search_plan import validate_commercial_search_plan

REQUESTED = 3
HARD_CAP = 0.25
ZONE_LEADS = 10

# Diverse verticals — not antincendio. Each is an independent open-world canary.
SPECS = {
    "q2_crm": {
        "label": "CRM adoption",
        "query": (
            "Vendiamo CRM per PMI. Trovami 3 aziende italiane con segnali recenti "
            "di adozione, migrazione o progetto CRM, con contatto pubblico."
        ),
        "signals": ["technology_adoption", "technology_migration"],
        "seller": {
            "offer_category": "crm_software",
            "offer_description": "Piattaforma CRM e servizi di implementazione/migrazione",
            "products_or_services": ["CRM", "migrazione CRM"],
            "problems_solved": ["CRM assente o inadeguato", "migrazione da legacy"],
            "sales_motion": "consultative_outbound",
            "preferred_buyer_roles": ["sales_director", "CTO", "operations"],
        },
        "target": {
            "entity_types": ["company"],
            "industries": ["PMI", "servizi B2B", "industria"],
            "company_sizes": ["small", "medium"],
            "geographies": ["Italia"],
            "local_business_preference": False,
            "required_attributes": ["azienda operativa in cerca di CRM"],
            "excluded_attributes": ["vendor CRM"],
            "excluded_entities": ["Salesforce", "HubSpot"],
        },
        "adapters": ["generic_web_research_v1"],
    },
    "q4_hiring": {
        "label": "Engineering hiring",
        "query": (
            "Trovami 3 aziende italiane che stanno assumendo ingegneri informatici "
            "o software engineer, con vacancy attiva e contatto pubblico."
        ),
        "signals": ["hiring_technology"],
        "seller": {
            "offer_category": "engineering_talent_services",
            "offer_description": "Servizi per team engineering e hiring tech",
            "products_or_services": ["recruiting tech"],
            "problems_solved": ["mancanza di capacita engineering"],
            "sales_motion": "consultative_outbound",
            "preferred_buyer_roles": ["CTO", "engineering_manager", "HR"],
        },
        "target": {
            "entity_types": ["company"],
            "industries": ["software", "industria", "servizi digitali"],
            "company_sizes": ["small", "medium"],
            "geographies": ["Italia"],
            "local_business_preference": False,
            "required_attributes": ["employer diretto con vacancy engineering attiva"],
            "excluded_attributes": ["recruiter anonimo"],
            "excluded_entities": [],
        },
        "adapters": ["structured_hiring_v1", "generic_web_research_v1"],
    },
    "q7_funding": {
        "label": "Startup funding",
        "query": (
            "Trovami 3 startup italiane che stanno raccogliendo o hanno appena "
            "raccolto fondi di investimento, con contatto pubblico."
        ),
        "signals": ["funding", "capital_investment"],
        "seller": {
            "offer_category": "startup_services",
            "offer_description": "Servizi per startup in fundraising",
            "products_or_services": ["advisory fundraising", "go-to-market"],
            "problems_solved": ["round in corso", "scale post-investimento"],
            "sales_motion": "consultative_outbound",
            "preferred_buyer_roles": ["founder", "CEO", "CFO"],
        },
        "target": {
            "entity_types": ["company"],
            "industries": ["startup", "tech", "innovazione"],
            "company_sizes": ["micro", "small", "medium"],
            "geographies": ["Italia"],
            "local_business_preference": False,
            "required_attributes": ["startup recipient di capitale"],
            "excluded_attributes": ["fondo", "banca", "investitore"],
            "excluded_entities": ["VC fund", "private equity"],
        },
        "adapters": ["generic_web_research_v1"],
    },
}


def build_plan(spec: dict) -> dict:
    fixture = json.loads(
        (ROOT / "contracts/fixtures/commercial-search-plan.valid.json").read_text(encoding="utf-8")
    )
    plan = copy.deepcopy(fixture)
    plan["search_id"] = str(uuid.uuid4())
    plan["raw_query"] = spec["query"]
    plan["language"] = "it"
    plan["seller"] = spec["seller"]
    plan["target"] = {**plan["target"], **spec["target"]}
    plan["signal_policy"] = {
        **(plan.get("signal_policy") or {}),
        "required_signals": list(spec["signals"]),
        "optional_signals": [],
        "excluded_signals": [],
    }
    plan["budget"] = {
        **(plan.get("budget") or {}),
        "hard_cost_eur": HARD_CAP,
        "target_cost_eur": round(HARD_CAP * 0.8, 4),
        "max_results": REQUESTED,
    }
    plan["source_policy"] = {
        **(plan.get("source_policy") or {}),
        "preferred_adapters": list(spec.get("adapters") or ["generic_web_research_v1"]),
    }
    return validate_commercial_search_plan(plan).model_dump(mode="json")


def run_one(spec_id: str, spec: dict, sb) -> dict:
    plan = build_plan(spec)
    search_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    intent = {
        "query": spec["query"],
        "original_query": spec["query"],
        "requested_leads": REQUESTED,
        "max_leads": REQUESTED,
        "lead_target": REQUESTED,
        "customer_visible": False,
        "lifecycle_stage": "v5_shadow",
        "source_adapter_shadow": True,
        "canonical_plan": plan,
        "execution_authorized": True,
        "execution_runtime": "source_adapter_shadow",
    }
    progress = {
        "stage": "source_adapter_shadow_prepared",
        "stop_reason": "matrix_preflight_clear",
        "published": 0,
        "qualified": 0,
    }
    sb.table("searches").insert({
        "id": search_id,
        "category": f"Open-World Matrix — {spec['label']}",
        "location": "Italia",
        "status": "pending",
        "results": [],
        "zone": str(ZONE_LEADS),
        "intent": intent,
        "progress": progress,
        "created_at": now,
    }).execute()
    try:
        sb.rpc("initialize_search_budget", {
            "p_search_id": search_id,
            "p_target_cost_eur": round(HARD_CAP * 0.8, 4),
            "p_hard_cost_eur": HARD_CAP,
        }).execute()
    except Exception as exc:
        print("budget_warn", spec_id, type(exc).__name__, str(exc)[:160])

    run_env = os.environ.copy()
    run_env.update({
        "MIRAX_WORKER_DISABLED": "0",
        "MIRAX_SEARCH_DISABLED": "0",
        "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1",
        "MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": str(HARD_CAP),
        "MIRAX_ORCHESTRATOR_MAX_SECONDS": "600",
        "MIRAX_ORCHESTRATOR_MAX_ROUNDS": "40",
        "PYTHONUNBUFFERED": "1",
        "PYTHONPATH": str(ROOT),
    })
    proc = subprocess.run(
        [
            "/home/worker/app/venv/bin/python", "-u", "worker_supabase.py",
            "--once", "--search-id", search_id, "--mode", "user",
            "--user-recent-minutes", "0", "--cooldown", "0",
        ],
        cwd=str(ROOT),
        env=run_env,
        capture_output=True,
        text=True,
    )
    print(proc.stdout[-6000:] if proc.stdout else "")
    if proc.stderr:
        print(proc.stderr[-2000:])
    row = sb.table("searches").select("id,status,results,progress").eq("id", search_id).single().execute().data
    results = row.get("results") or []
    if isinstance(results, str):
        results = json.loads(results)
    progress_out = row.get("progress") or {}
    out = {
        "spec_id": spec_id,
        "label": spec["label"],
        "search_id": search_id,
        "status": row.get("status"),
        "results_count": len(results) if isinstance(results, list) else 0,
        "stop_reason": progress_out.get("stop_reason") if isinstance(progress_out, dict) else None,
        "cost_eur": progress_out.get("cost_eur") if isinstance(progress_out, dict) else None,
        "worker_exit": proc.returncode,
        "leads": [
            {
                "azienda": r.get("azienda") or r.get("nome"),
                "domain": r.get("website_domain") or r.get("sito") or r.get("website"),
                "contact": r.get("email") or r.get("telefono") or r.get("phone"),
            }
            for r in (results if isinstance(results, list) else [])[:5]
        ],
    }
    print(json.dumps({"matrix_result": out}, ensure_ascii=False, indent=2))
    return out


def main() -> int:
    env = dotenv_values(ROOT / ".env")
    os.environ.update({k: v for k, v in env.items() if v is not None})
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    keys = list(SPECS.keys()) if arg == "all" else [arg]
    results = []
    for key in keys:
        if key not in SPECS:
            print("unknown_spec", key, "choices", list(SPECS))
            return 2
        print("=== MATRIX START", key, SPECS[key]["label"], "===")
        results.append(run_one(key, SPECS[key], sb))
    Path("/tmp/mirax_openworld_diverse_matrix.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    ok = all(r.get("results_count", 0) >= REQUESTED for r in results)
    print(json.dumps({"matrix_summary": results, "all_hit_target": ok}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
