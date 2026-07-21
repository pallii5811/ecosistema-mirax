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
HARD_CAP = 0.10  # certification hard cap; zone must allow product formula (≥4 → €0.10)
ZONE_LEADS = 10  # product formula headroom; acceptance stops via lead_target=3
SIGNALS = ["production_expansion", "geographic_expansion", "new_location"]


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
        **plan["target"],
        "entity_types": ["company"],
        "industries": ["manifatturiero", "logistica", "produzione industriale"],
        "company_sizes": ["micro", "small", "medium"],
        "employee_range": None,
        "revenue_range": None,
        "geographies": ["Nord Italia", "Lombardia", "Veneto", "Piemonte", "Emilia-Romagna"],
        "local_business_preference": True,
        "required_attributes": ["PMI operativa", "stabilimento o sede produttiva"],
        "excluded_attributes": ["multinazionale", "brand famoso", "azienda quotata"],
        "excluded_entities": [],
    }
    mapped = []
    for hyp in hypotheses[:6]:
        hypothesis_signals = [
            str(item)
            for item in hyp.get("allowed_signal_families") or ()
            if str(item) in SIGNALS
        ]
        # This immutable canary certifies documented facility expansion.  A
        # hypothesis from another explicit OR branch (for example compliance)
        # must not inherit expansion signals or leak into its retrieval plan.
        if not hypothesis_signals:
            continue
        observable_events = [
            str(item)
            for item in hyp.get("observable_event_types") or ()
            if str(item)
        ]
        mapped.append({
            "id": hyp.get("hypothesis_id") or hyp.get("id") or f"hyp-{len(mapped)+1}",
            "buyer_problem": hyp.get("buyer_problem") or "Necessita di adeguamento antincendio",
            "triggering_events": observable_events or [
                hyp.get("observable_event") or "ampliamento produttivo documentato"
            ],
            "signals": hypothesis_signals,
            "implied_need": hyp.get("buyer_problem") or "Valutare sistemi antincendio e adeguamenti",
            "relevance_to_offer": (
                f"Il segnale '{hyp.get('observable_event')}' rende attuale "
                "la valutazione di sistemi antincendio industriali."
            ),
            "confidence": 0.82,
        })
    if not mapped:
        raise ValueError("immutable canary compiler produced no expansion-bound hypothesis")
    plan_signals = list(dict.fromkeys(
        signal for hypothesis in mapped for signal in hypothesis.get("signals") or ()
    ))
    plan["commercial_hypotheses"] = mapped
    plan["signal_policy"] = {
        "required_signals": plan_signals,
        "optional_signals": [],
        "negative_signals": ["business_closed"],
        "maximum_age_days_by_signal": {s: 180 for s in plan_signals},
        "minimum_signal_confidence": 0.7,
    }
    plan["source_policy"] = {
        "preferred_source_classes": [
            "official_company_website", "recognized_local_news", "municipal_register",
        ],
        "allowed_source_classes": [
            "official_company_website", "recognized_local_news", "industry_publication",
            "municipal_register", "public_procurement_portal",
        ],
        "excluded_source_classes": ["search_snippet", "generic_blog", "directory"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    }
    plan["budget_policy"] = {
        "target_cost_eur": round(HARD_CAP * 0.8, 4),
        "hard_cost_eur": HARD_CAP,
        "maximum_search_calls": 40,
        "maximum_pages_opened": 120,
        "maximum_llm_evaluations": 20,
    }
    plan["ranking_policy"] = {
        "weight_buyer_fit": 0.25,
        "weight_signal_strength": 0.25,
        "weight_freshness": 0.15,
        "weight_evidence_confidence": 0.2,
        "weight_contactability": 0.1,
        "weight_need_gap": 0.05,
    }
    plan["ambiguity"] = {"score": 0.1, "assumptions": [], "unresolved_fields": []}
    plan["planner_metadata"] = {
        "planner": "llm",
        "prompt_version": "commercial-intent-v1.4.2",
        "model": "commercial-intent-compiler+planner",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    plan["semantic_query_contract"] = {
        "original_query": QUERY,
        "query_goal": spec.get("buyer_need") or QUERY,
        "seller": {"description": "sistemi antincendio industriali"},
        "offer": {"description": "sistemi antincendio industriali"},
        "target_entity_types": ["operating_company"],
        "target_company_description": "PMI industriali del Nord Italia con stabilimenti o ampliamenti",
        "event_or_state_description": mapped[0]["buyer_problem"],
        "target_role_in_event": "expanding_company",
        "required_relationships": ["company_opening_or_expanding_facility"],
        "optional_relationships": [],
        "excluded_roles": ["publisher", "advisor", "recruiter"],
        "excluded_entities": [],
        "geography": ["Nord Italia", "Italia"],
        "industry": ["manifatturiero", "produzione industriale"],
        "size_constraints": {},
        "temporal_constraints": {"maximum_age_days": 180},
        "positive_conditions": [
            "nuovo stabilimento o ampliamento produttivo documentato",
            "contatto pubblico disponibile",
        ],
        "negative_conditions": ["multinazionale", "brand famoso", "publisher as target"],
        "must_have_facts": ["official_domain", "source_url", "literal_excerpt", "event_date"],
        "forbidden_inferences": ["generic growth implies need", "vendor page as buyer evidence"],
        "data_requirements": ["official_domain", "source_url", "event_date", "excerpt"],
        "ranking_objective": "freshest grounded expansion evidence",
        "acceptance_rubric": ["expanding_company_grounded", "company_opening_or_expanding_facility_grounded"],
        "discovery_hypotheses": [
            {
                "id": h["id"],
                "query": QUERY,
                "source_classes": list(plan["source_policy"]["preferred_source_classes"]),
                "signals": list(h.get("signals") or SIGNALS),
                "buyer_problem": h.get("buyer_problem"),
                "implied_need": h.get("implied_need"),
                "evidence_claim_type": "OBSERVED_EVENT",
                "required_target_role": "expanding_company",
                "prohibited_roles": ["publisher", "advisor", "investor", "vendor"],
            }
            for h in mapped
        ],
        "clarification_required": False,
        "confidence": float(spec.get("confidence") or 0.85),
        "canonical_signal_hints": plan_signals,
    }
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
            # Buyer expansion evidence only — never include seller offer terms
            # (antincendio) or SERPs collapse onto fire-protection vendors.
            "nuovo stabilimento OR ampliamento produttivo Nord Italia 2025 OR 2026 Spa OR Srl",
            "inaugura nuovo stabilimento Lombardia OR Veneto OR Emilia 2025 OR 2026",
            "ampliamento dello stabilimento OR nuova unita produttiva PMI Nord Italia",
        ],
        "expected_evidence": SIGNALS,
        "execution_mode": "search",
    }]
    intent = {
        "query": QUERY,
        "original_query": QUERY,
        "search_mode": "agentic_only",
        "search_strategy": "organic_web_search",
        "max_leads": ZONE_LEADS,
        "requested_leads": ZONE_LEADS,
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
        "zone": str(ZONE_LEADS),
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
