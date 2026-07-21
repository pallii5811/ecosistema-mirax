#!/usr/bin/env python3
"""One-shot open-world canary: antincendio industriale, requested_count=3, hard cap €0.10."""
from __future__ import annotations

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

    from commercial_intent.compiler import CommercialIntentCompiler
    from commercial_intent.planner import OfferToBuyerNeedPlanner
    from commercial_intent.runtime import spec_to_canonical_plan
    from contracts.commercial_intent import normalize_commercial_intent

    QUERY = (
        "Installiamo sistemi antincendio industriali. "
        "Trovami 3 PMI del Nord Italia con segnali recenti di nuovi stabilimenti, "
        "ampliamenti produttivi o adeguamenti documentati, con un contatto pubblico."
    )
    REQUESTED = 3
    HARD_CAP = 0.10


    def main() -> int:
        env = dotenv_values(ROOT / ".env")
        os.environ.update({k: v for k, v in env.items() if v is not None})
        sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

        compiler = CommercialIntentCompiler()
        planner = OfferToBuyerNeedPlanner()
        spec_obj = compiler.compile(QUERY)
        spec = normalize_commercial_intent({
            **spec_obj.to_dict(),
            "target_company_profile": spec_obj.target_company_profile,
        })
        hypotheses = [h.to_dict() for h in planner.plan(spec)]
        spec["commercial_hypotheses"] = hypotheses
        canonical_plan = spec_to_canonical_plan(spec)

    search_id = str(uuid.uuid4())
    canary_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    intent = {
        "query": QUERY,
        "original_query": QUERY,
        "search_mode": "agentic_only",
        "search_strategy": "organic_web_search",
        "max_leads": REQUESTED,
        "requested_leads": REQUESTED,
        "lead_target": REQUESTED,
        "canonical_plan": canonical_plan,
        "uqe_plan": {"canonical_plan": canonical_plan},
        "commercial_intent_spec": spec,
        "commercial_hypotheses": hypotheses,
        "commercial_intent_required": True,
        "intent_compiler_telemetry": {
            "compiler_tier": 1,
            "confidence": spec.get("confidence"),
            "request_mode": spec.get("request_mode"),
            "seller_offer": (spec.get("seller_offer") or {}).get("description"),
            "buyer_need": spec.get("buyer_need"),
            "target_role": spec.get("target_role"),
            "hypotheses_count": len(hypotheses),
            "requested_count": REQUESTED,
            "hard_cap_eur": HARD_CAP,
        },
        "lifecycle_stage": "v5_shadow",
        "customer_visible": False,
        "prepare_only": False,
        "execution_authorized": True,
        "source_adapter_shadow": True,
        "execution_runtime": "source_adapter_orchestrator",
    }
    progress = {
        "stage": "intent_compiled",
        "commercial_intent_spec": spec,
        "commercial_hypotheses": hypotheses,
        "intent_compiler_telemetry": intent["intent_compiler_telemetry"],
        "requested_count": REQUESTED,
        "accepted_unique_published_count": 0,
        "remaining_count": REQUESTED,
        "hard_cap_eur": HARD_CAP,
        "stop_when_accepted": REQUESTED,
    }

    sb.table("searches").insert({
        "id": search_id,
        "category": "Antincendio Industriale Open-World Canary",
        "location": "Nord Italia",
        "status": "pending",
        "results": [],
        "zone": str(REQUESTED),
        "intent": intent,
        "progress": progress,
        "created_at": now,
    }).execute()

    try:
        sb.table("evaluation_runs").insert({
            "id": run_id,
            "dataset_version": "mirax-open-world-antincendio-v1",
            "release_id": Path(ROOT / ".release-id").read_text(encoding="utf-8").strip()
            if (ROOT / ".release-id").exists() else "local",
            "mode": "shadow_research",
            "status": "running",
            "configuration": {
                "query": QUERY,
                "requested_count": REQUESTED,
                "hard_budget_eur": HARD_CAP,
                "customer_visible": False,
            },
        }).execute()
        sb.table("canary_runs").insert({
            "id": canary_id,
            "evaluation_run_id": run_id,
            "search_id": search_id,
            "canary_type": "open_world_antincendio",
            "exact_query": QUERY,
            "max_leads": REQUESTED,
            "hard_budget_eur": HARD_CAP,
            "shadow_mode": True,
            "customer_visible": False,
            "worker_limit": 1,
            "status": "running",
        }).execute()
    except Exception as exc:
        print("canary_meta_warn", type(exc).__name__, str(exc)[:200])

    try:
        sb.rpc("initialize_search_budget", {
            "p_search_id": search_id,
            "p_target_cost_eur": HARD_CAP * 0.8,
            "p_hard_cost_eur": HARD_CAP,
        }).execute()
    except Exception as exc:
        print("budget_warn", type(exc).__name__, str(exc)[:200])

    meta = {
        "search_id": search_id,
        "canary_id": canary_id,
        "run_id": run_id,
        "request_mode": spec.get("request_mode"),
        "seller_offer": (spec.get("seller_offer") or {}).get("description"),
        "buyer_need": spec.get("buyer_need"),
        "hypotheses_count": len(hypotheses),
        "market_scope": (spec.get("target_company_profile") or {}).get("market_scope_policy"),
    }
    print(json.dumps({"prepared": meta}, ensure_ascii=False, indent=2))
    Path("/tmp/mirax_openworld_canary.json").write_text(json.dumps(meta), encoding="utf-8")

    run_env = os.environ.copy()
    run_env.update({
        "MIRAX_WORKER_DISABLED": "0",
        "MIRAX_SEARCH_DISABLED": "0",
        "MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED": "1",
        "MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": str(HARD_CAP),
        "MIRAX_ORCHESTRATOR_MAX_SECONDS": "900",
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
    print(proc.stdout[-8000:] if proc.stdout else "")
    if proc.stderr:
        print(proc.stderr[-3000:])
    print("WORKER_EXIT", proc.returncode)

    row = sb.table("searches").select("id,status,results,progress,intent").eq("id", search_id).single().execute().data
    results = row.get("results") or []
    if isinstance(results, str):
        results = json.loads(results)
    progress = row.get("progress") or {}
    summary = {
        "search_id": search_id,
        "status": row.get("status"),
        "results_count": len(results) if isinstance(results, list) else 0,
        "progress": {
            k: progress.get(k)
            for k in (
                "accepted_unique_published_count", "remaining_count", "stop_reason",
                "cost_eur", "qualified", "rejected", "stage",
            )
            if isinstance(progress, dict)
        },
        "leads": [
            {
                "azienda": r.get("azienda") or r.get("nome") or r.get("company"),
                "domain": r.get("website_domain") or r.get("sito") or r.get("website"),
                "acceptance": r.get("_lead_acceptance") or r.get("lead_acceptance"),
                "why_fit": r.get("why_fit") or r.get("motivo"),
                "why_now": r.get("why_now"),
                "contact": r.get("email") or r.get("telefono") or r.get("phone"),
            }
            for r in (results if isinstance(results, list) else [])[:5]
        ],
    }
    print(json.dumps({"summary": summary}, ensure_ascii=False, indent=2))
    Path("/tmp/mirax_openworld_canary_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    accepted = summary["results_count"]
    return 0 if accepted >= REQUESTED and proc.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
