#!/usr/bin/env python3
"""One-shot open-world canary: antincendio industriale, requested_count=3."""
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

from commercial_intent.compiler import CommercialIntentCompiler
from commercial_intent.planner import OfferToBuyerNeedPlanner
from contracts.commercial_intent import normalize_commercial_intent
from contracts.commercial_search_plan import validate_commercial_search_plan

QUERY = (
    "Installiamo sistemi antincendio industriali. "
    "Trovami 3 PMI del Nord Italia con segnali recenti di nuovi stabilimenti, "
    "ampliamenti produttivi o adeguamenti documentati, con un contatto pubblico."
)
REQUESTED = 3
HARD_CAP = 0.05  # product hard cap on staging; certification records actual spend
SIGNALS = ["geographic_expansion", "facility_upgrade", "regulatory_compliance"]


def build_schema_valid_plan(spec: dict, hypotheses: list[dict]) -> dict:
    fixture = json.loads(
        (ROOT / "contracts/fixtures/commercial-search-plan.valid.json").read_text(encoding="utf-8")
    )
    plan = copy.deepcopy(fixture)
    plan["search_id"] = str(uuid.uuid4())
    plan["raw_query"] = QUERY
    plan["language"] = "it"
    plan["seller"] = {
        "offer_category": "industrial_fire_protection",
        "offer_description": "sistemi antincendio industriali",
        "products_or_services": ["sistemi antincendio industriali", "adeguamenti antincendio"],
        "problems_solved": [
            "nuovi stabilimenti senza copertura antincendio adeguata",
            "ampliamenti produttivi che richiedono adeguamenti documentati",
        ],
        "sales_motion": "consultative_outbound",
        "preferred_buyer_roles": ["titolare", "responsabile operations", "RSPP"],
    }
    plan["target"] = {
        "entity_types": ["company"],
        "industries": ["manifatturiero", "logistica", "produzione industriale"],
        "company_sizes": ["micro", "small", "medium"],
        "employee_range": {"min": 2, "max": 249},
        "revenue_range": {"max": 50000000, "currency": "EUR"},
        "geographies": ["Nord Italia", "Lombardia", "Veneto", "Piemonte", "Emilia-Romagna"],
        "local_business_preference": True,
        "required_attributes": ["PMI operativa", "stabilimento o sede produttiva"],
        "excluded_attributes": ["multinazionale", "brand famoso", "azienda quotata"],
        "excluded_entities": [],
    }
    mapped = []
    for hyp in hypotheses[:6]:
        mapped.append({
            "id": hyp.get("id") or f"hyp-{len(mapped)+1}",
            "buyer_problem": hyp.get("buyer_problem") or "Necessita di adeguamento antincendio",
            "triggering_events": [hyp.get("observable_event") or "ampliamento produttivo documentato"],
            "signals": SIGNALS[:2],
            "implied_need": hyp.get("buyer_problem") or "Valutare sistemi antincendio e adeguamenti",
            "relevance_to_offer": (
                f"Il segnale '{hyp.get('observable_event')}' rende attuale "
                "la valutazione di sistemi antincendio industriali."
            ),
            "confidence": 0.82,
        })
    if not mapped:
        mapped = [{
            "id": "antincendio-expansion",
            "buyer_problem": "Nuovo stabilimento o ampliamento richiede adeguamento antincendio",
            "triggering_events": ["nuovo stabilimento", "ampliamento produttivo", "adeguamento documentato"],
            "signals": SIGNALS,
            "implied_need": "Progettazione e installazione sistemi antincendio",
            "relevance_to_offer": "Espansione produttiva crea bisogno immediato di protezione antincendio",
            "confidence": 0.85,
        }]
    plan["commercial_hypotheses"] = mapped
    plan["signal_policy"] = {
        "required_signals": SIGNALS[:2],
        "optional_signals": SIGNALS[2:],
        "negative_signals": ["business_closed"],
        "maximum_age_days_by_signal": {s: 180 for s in SIGNALS},
        "minimum_signal_confidence": 0.7,
    }
    plan["source_policy"] = {
        "preferred_source_classes": [
            "official_company_website", "recognized_local_news", "public_registry",
        ],
        "allowed_source_classes": [
            "official_company_website", "recognized_local_news", "industry_publication",
            "public_registry", "public_procurement_portal",
        ],
        "excluded_source_classes": ["search_snippet", "generic_blog", "directory"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": SIGNALS[:1],
    }
    plan["budget_policy"] = {
        "target_cost_eur": round(HARD_CAP * 0.8, 4),
        "hard_cost_eur": HARD_CAP,
        "maximum_search_calls": 40,
        "maximum_pages_opened": 120,
        "maximum_llm_evaluations": 20,
    }
    plan["planner_metadata"] = {
        "planner": "llm",
        "prompt_version": "commercial-intent-v1.4.2",
        "model": "commercial-intent-compiler+planner",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    sqc = plan.get("semantic_query_contract") or {}
    sqc.update({
        "original_query": QUERY,
        "query_goal": spec.get("buyer_need") or QUERY,
        "target_role_in_event": "expanding_company",
        "required_relationships": ["company_opening_or_expanding_facility"],
        "geography": ["Nord Italia", "Italia"],
        "industry": ["manifatturiero", "produzione industriale"],
        "canonical_signal_hints": SIGNALS,
        "confidence": float(spec.get("confidence") or 0.85),
        "clarification_required": False,
    })
    plan["semantic_query_contract"] = sqc
    return validate_commercial_search_plan(plan).model_dump(mode="json")


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
    plan = build_schema_valid_plan(spec, hypotheses)

    search_id = str(uuid.uuid4())
    canary_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    source_plan = [{
        "lane_id": "antincendio_web",
        "source_types": plan["source_policy"]["preferred_source_classes"],
        "query_templates": [
            QUERY,
            "nuovo stabilimento OR ampliamento produttivo antincendio Nord Italia 2025 OR 2026",
            "adeguamento antincendio PMI Lombardia Veneto Emilia",
        ],
        "expected_evidence": SIGNALS,
        "execution_mode": "search",
    }]
    intent = {
        "query": QUERY,
        "original_query": QUERY,
        "search_mode": "agentic_only",
        "search_strategy": "organic_web_search",
        "max_leads": REQUESTED,
        "requested_leads": REQUESTED,
        "lead_target": REQUESTED,
        "canonical_plan": plan,
        "uqe_plan": {
            "canonical_plan": plan,
            "required_signals": SIGNALS,
            "source_plan": source_plan,
            "search_strategy": "organic_web_search",
            "original_query": QUERY,
            "location": "Nord Italia",
            "sector": "manifatturiero",
            "source_coverage": {"adapter_ids": ["generic_web_research_v1"]},
        },
        "commercial_intent_spec": spec,
        "commercial_hypotheses": hypotheses,
        "commercial_intent_required": True,
        "required_signals": SIGNALS,
        "source_plan": source_plan,
        "intent_compiler_telemetry": {
            "compiler_tier": 1,
            "confidence": spec.get("confidence"),
            "request_mode": spec.get("request_mode"),
            "seller_offer": (spec.get("seller_offer") or {}).get("description"),
            "buyer_need": spec.get("buyer_need"),
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
        "mandatory_adapter_ids": ["generic_web_research_v1"],
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
        "prepare_complete": True,
        "execution_authorized": True,
        "target": REQUESTED,
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
            "release_id": (ROOT / ".release-id").read_text(encoding="utf-8").strip()
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
            "p_target_cost_eur": round(HARD_CAP * 0.8, 4),
            "p_hard_cost_eur": HARD_CAP,
        }).execute()
        print("budget_ok", HARD_CAP)
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
        "required_signals": SIGNALS,
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
    print(proc.stdout[-10000:] if proc.stdout else "")
    if proc.stderr:
        print(proc.stderr[-4000:])
    print("WORKER_EXIT", proc.returncode)

    row = sb.table("searches").select("id,status,results,progress").eq("id", search_id).single().execute().data
    results = row.get("results") or []
    if isinstance(results, str):
        results = json.loads(results)
    progress_out = row.get("progress") or {}
    summary = {
        "search_id": search_id,
        "status": row.get("status"),
        "results_count": len(results) if isinstance(results, list) else 0,
        "progress": progress_out if isinstance(progress_out, dict) else {},
        "leads": results if isinstance(results, list) else [],
    }
    print(json.dumps({
        "summary": {
            "search_id": search_id,
            "status": summary["status"],
            "results_count": summary["results_count"],
            "stop_reason": progress_out.get("stop_reason") if isinstance(progress_out, dict) else None,
            "cost_eur": progress_out.get("cost_eur") if isinstance(progress_out, dict) else None,
            "qualified": progress_out.get("qualified") if isinstance(progress_out, dict) else None,
            "leads": [
                {
                    "azienda": r.get("azienda") or r.get("nome") or r.get("company"),
                    "domain": r.get("website_domain") or r.get("sito") or r.get("website"),
                    "why_fit": r.get("why_fit") or r.get("motivo"),
                    "why_now": r.get("why_now"),
                    "contact": r.get("email") or r.get("telefono") or r.get("phone"),
                    "acceptance": r.get("_lead_acceptance") or r.get("lead_acceptance"),
                }
                for r in (results if isinstance(results, list) else [])[:5]
            ],
        }
    }, ensure_ascii=False, indent=2))
    Path("/tmp/mirax_openworld_canary_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    return 0 if summary["results_count"] >= REQUESTED else 1


if __name__ == "__main__":
    raise SystemExit(main())
