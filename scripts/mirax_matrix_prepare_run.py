#!/usr/bin/env python3
"""Prepare + run demo-matrix queries with schema-valid commercial plans."""
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

env = dotenv_values(ROOT / ".env")
os.environ.update({k: v for k, v in env.items() if v is not None})
sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
FIXTURE = json.loads((ROOT / "contracts/fixtures/commercial-search-plan.valid.json").read_text(encoding="utf-8"))

SPECS = {
    "q2": {
        "query": "Trovami aziende che stanno cercando un nuovo CRM.",
        "signals": ["technology_adoption"],
        "optional_signals": ["technology_migration"],
        "seller": {
            "offer_category": "crm_software",
            "offer_description": "Piattaforma CRM e servizi di implementazione/migrazione",
            "products_or_services": ["CRM", "migrazione CRM", "integrazione CRM"],
            "problems_solved": ["CRM assente o inadeguato", "migrazione da legacy", "processo commerciale non tracciato"],
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
            "excluded_attributes": ["vendor CRM", "software house CRM"],
            "excluded_entities": ["Salesforce", "HubSpot", "Microsoft Dynamics vendor pages"],
        },
        "hypotheses": [
            {
                "id": "crm-rfp-migration",
                "buyer_problem": (
                    "L'azienda cerca, seleziona, adotta o implementa un CRM "
                    "(progetto, gara, migrazione o annuncio di adozione)"
                ),
                "triggering_events": [
                    "gara CRM", "RFP CRM", "migrazione CRM", "adotta CRM", "sceglie CRM",
                    "progetto CRM", "bando software CRM",
                ],
                "signals": ["technology_adoption", "technology_migration"],
                "implied_need": "Selezione, implementazione o migrazione CRM",
                "relevance_to_offer": "Il bisogno CRM esplicito e attuale rende il lead acquistabile",
                "confidence": 0.9,
            },
            {
                "id": "crm-project-vacancy",
                "buyer_problem": "Progetto CRM annunciato o vacancy CRM owner",
                "triggering_events": ["implementazione CRM", "CRM manager", "digital transformation CRM"],
                "signals": ["technology_adoption"],
                "implied_need": "Partner o piattaforma per il progetto CRM",
                "relevance_to_offer": "Un progetto o ruolo CRM esplicito indica spesa imminente",
                "confidence": 0.85,
            },
        ],
        "sources_pref": ["official_company_website", "public_procurement_portal", "recognized_local_news"],
        "sources_allow": [
            "official_company_website", "public_procurement_portal", "company_careers",
            "recognized_local_news", "industry_publication",
        ],
        "adapters": ["generic_web_research_v1"],
        "role": "buyer",
        "relationships": [
            "target_company_seeking_crm_solution",
        ],
        "optional_relationships": [
            "target_company_migrating_crm_platform",
            "target_company_issuing_crm_rfp",
        ],
        "positive": [
            "CRM RFP or public tender", "declared CRM migration/replacement",
            "announced CRM project", "vacancy owning CRM implementation",
            "CRM partner/consultant request",
            "explicit CRM selection or evaluation in progress",
            "operating company adopts or chooses a CRM platform",
        ],
        "negative": [
            "mere CRM absence", "generic CRM article", "CRM vendor as target",
            "old completed case study", "supplier SEO page", "how-to CRM guide",
        ],
    },
    "q4": {
        "query": "Trovami aziende che stanno assumendo ingegneri informatici.",
        "signals": ["hiring_technology"],
        "optional_signals": [],
        "seller": {
            "offer_category": "engineering_talent_services",
            "offer_description": "Servizi per team engineering e hiring tech",
            "products_or_services": ["recruiting tech", "engineering enablement"],
            "problems_solved": ["mancanza di capacita engineering", "delivery software in ritardo"],
            "sales_motion": "consultative_outbound",
            "preferred_buyer_roles": ["CTO", "engineering_manager", "HR"],
        },
        "target": {
            "entity_types": ["company"],
            "industries": ["software", "industria", "servizi digitali"],
            "company_sizes": ["small", "medium", "large"],
            "geographies": ["Italia"],
            "local_business_preference": False,
            "required_attributes": ["employer diretto con vacancy engineering attiva"],
            "excluded_attributes": ["recruiter anonimo"],
            "excluded_entities": [],
        },
        "hypotheses": [{
            "id": "hiring-engineers",
            "buyer_problem": "Il team engineering e insufficiente rispetto alla domanda",
            "triggering_events": ["vacancy software engineer", "data engineer", "IT engineer"],
            "signals": ["hiring_technology"],
            "implied_need": "Supporto a hiring, onboarding e delivery engineering",
            "relevance_to_offer": "Una vacancy engineering attiva indica bisogno immediato di capacita tecnica",
            "confidence": 0.92,
        }],
        "sources_pref": ["company_careers", "job_board"],
        "sources_allow": ["company_careers", "job_board", "official_company_website"],
        "adapters": ["structured_hiring_v1", "generic_web_research_v1"],
        "role": "employer",
        "relationships": ["employer_hiring_software_or_it_engineers"],
        "positive": ["active engineer vacancy", "direct employer", "official domain", "literal excerpt"],
        "negative": ["anonymous recruiter client", "expired vacancy", "non-engineering role"],
    },
    "q7": {
        "query": "Trovami startup che stanno raccogliendo fondi di investimento.",
        "signals": ["funding"],
        "optional_signals": ["capital_investment"],
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
            "excluded_attributes": ["fondo", "banca", "investitore", "acceleratore"],
            "excluded_entities": ["VC fund", "private equity", "bank lender"],
        },
        "hypotheses": [{
            "id": "startup-raising",
            "buyer_problem": "La startup sta chiudendo o ha appena chiuso un round",
            "triggering_events": ["ha raccolto", "round di investimento", "series", "seed"],
            "signals": ["funding", "capital_investment"],
            "implied_need": "Servizi operativi e go-to-market post-raise",
            "relevance_to_offer": "Un round attivo o recente implica budget e urgenza di scale",
            "confidence": 0.9,
        }],
        "sources_pref": ["recognized_local_news", "industry_publication", "official_company_website"],
        "sources_allow": [
            "recognized_local_news", "industry_publication", "official_company_website",
        ],
        "adapters": ["generic_web_research_v1"],
        "role": "recipient",
        "relationships": ["startup_raising_or_receiving_investment"],
        "positive": ["active or recently closed round", "startup as recipient", "amount/date when present"],
        "negative": ["bank", "fund", "investor", "lender", "advisor", "accelerator", "publisher"],
    },
}


def clear_actives() -> None:
    for c in sb.table("canary_runs").select("id").in_("status", ["created", "running"]).execute().data or []:
        sb.table("canary_runs").update({
            "status": "quarantined",
            "stop_reason": "matrix_preflight_clear",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", c["id"]).execute()
    for j in sb.table("searches").select("id,status").in_(
        "status", ["planning", "pending", "pending_user", "processing", "running"]
    ).execute().data or []:
        if j["status"] in {"planning", "pending", "pending_user"}:
            sb.table("searches").update({"status": "cancelled"}).eq("id", j["id"]).execute()


def build_plan(spec_id: str, hard: float = 0.05) -> tuple[dict, dict]:
    spec = SPECS[spec_id]
    plan = copy.deepcopy(FIXTURE)
    plan["search_id"] = str(uuid.uuid4())
    plan["raw_query"] = spec["query"]
    plan["seller"] = spec["seller"]
    plan["target"] = {
        **plan["target"],
        **spec["target"],
        "employee_range": None,
        "revenue_range": None,
    }
    plan["commercial_hypotheses"] = spec["hypotheses"]
    plan["signal_policy"] = {
        "required_signals": spec["signals"],
        "optional_signals": list(spec.get("optional_signals") or []),
        "negative_signals": [],
        "maximum_age_days_by_signal": {
            s: (365 if spec_id == "q2" else 180)
            for s in list(spec["signals"]) + list(spec.get("optional_signals") or [])
        },
        "minimum_signal_confidence": 0.75,
    }
    plan["ranking_policy"] = {
        "weight_buyer_fit": 0.25,
        "weight_signal_strength": 0.25,
        "weight_freshness": 0.15,
        "weight_evidence_confidence": 0.2,
        "weight_contactability": 0.1,
        "weight_need_gap": 0.05,
    }
    plan["source_policy"] = {
        "preferred_source_classes": spec["sources_pref"],
        "allowed_source_classes": spec["sources_allow"],
        "excluded_source_classes": ["generic_blog", "directory", "search_snippet"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    }
    plan["budget_policy"] = {
        "target_cost_eur": round(hard * 0.8, 4),
        "hard_cost_eur": hard,
        "maximum_search_calls": 4,
        "maximum_pages_opened": 40,
        "maximum_llm_evaluations": 6,
    }
    excluded_roles = (
        ["publisher", "investor", "lender", "advisor", "recruiter"]
        if spec_id == "q7"
        else ["publisher", "recruiter"]
    )
    plan["semantic_query_contract"] = {
        "original_query": spec["query"],
        "query_goal": spec["query"],
        "seller": {"description": spec["seller"]["offer_description"]},
        "offer": {"description": spec["seller"]["offer_description"]},
        "target_entity_types": ["operating_company"],
        "target_company_description": spec["target"]["required_attributes"][0],
        "event_or_state_description": spec["hypotheses"][0]["buyer_problem"],
        "target_role_in_event": spec["role"],
        "required_relationships": spec["relationships"],
        "optional_relationships": list(spec.get("optional_relationships") or []),
        "excluded_roles": excluded_roles,
        "excluded_entities": spec["target"]["excluded_entities"],
        "geography": spec["target"]["geographies"],
        "industry": spec["target"]["industries"],
        "size_constraints": {},
        # Q2 CRM seeking evidence often appears in older trade press / case-study
        # pages even when the CRM project is still active. Relax only for q2.
        "temporal_constraints": {"maximum_age_days": 365 if spec_id == "q2" else 180},
        "positive_conditions": spec["positive"],
        "negative_conditions": spec["negative"],
        "must_have_facts": ["official_domain", "source_url", "literal_excerpt", "event_date"],
        "forbidden_inferences": ["generic growth implies need", "vendor page as buyer evidence"],
        "data_requirements": ["official_domain", "source_url", "event_date", "excerpt"],
        "ranking_objective": "freshest grounded target",
        "acceptance_rubric": [f"{spec['role']}_grounded"] + [
            f"{rel}_grounded" for rel in spec["relationships"][:1]
        ],
        "discovery_hypotheses": [
            {
                "id": h["id"],
                "query": spec["query"],
                "source_classes": list(spec["sources_pref"]),
                "signals": list(h.get("signals") or spec["signals"]),
                "buyer_problem": h.get("buyer_problem"),
                "implied_need": h.get("implied_need"),
            }
            for h in spec["hypotheses"]
        ],
        "clarification_required": False,
        "confidence": 0.9,
        "canonical_signal_hints": spec["signals"],
    }
    plan["planner_metadata"] = {
        "planner": "llm",
        "prompt_version": "demo-matrix-v1",
        "model": "schema-valid-fixture-adaptation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    plan["ambiguity"] = {"score": 0.1, "assumptions": [], "unresolved_fields": []}
    validated = validate_commercial_search_plan(plan).model_dump(mode="json")
    return validated, spec


def prepare_and_run(spec_id: str) -> dict:
    clear_actives()
    plan, spec = build_plan(spec_id)
    max_leads = 2
    hard = 0.05
    search_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    canary_id = str(uuid.uuid4())
    source_plan = [{
        "lane_id": f"{spec_id}_web",
        "source_types": spec["sources_pref"],
        "query_templates": [spec["query"], f'{spec["query"]} Italia 2025 OR 2026'],
        "expected_evidence": spec["signals"],
        "execution_mode": "search",
    }]
    uqe = {
        "canonical_plan": plan,
        "required_signals": spec["signals"],
        "source_plan": source_plan,
        "search_strategy": "organic_web_search",
        "semantic_query_contract": plan["semantic_query_contract"],
        "sector": spec["target"]["industries"][0] if spec["target"]["industries"] else "Italia",
        "location": "Italia",
        "source_coverage": {"adapter_ids": spec["adapters"]},
        "parse_source": "llm",
        "original_query": spec["query"],
    }
    intent = {
        "original_query": spec["query"],
        "query": spec["query"],
        "requested_leads": max_leads,
        "max_leads": max_leads,
        "lead_target": max_leads,
        "customer_visible": False,
        "lifecycle_stage": "v5_shadow",
        "execution_runtime": "source_adapter_orchestrator",
        "source_adapter_shadow": True,
        "mandatory_adapter_ids": spec["adapters"],
        "required_signals": spec["signals"],
        "signals": [{"type": s, "params": {}} for s in spec["signals"]],
        "source_plan": source_plan,
        "search_strategy": "organic_web_search",
        "uqe_plan": uqe,
        "query_compiler_telemetry": {
            "query_compilation_status": "schema_valid_adaptation",
            "query_compilation_cost": 0.0,
            "matrix_vertical": spec_id,
        },
        "prepare_only": False,
        "execution_authorized": True,
    }
    sb.table("searches").insert({
        "id": search_id,
        "category": f"Matrix {spec_id}",
        "location": "Italia",
        "zone": str(max_leads),
        "status": "pending",
        "results": [],
        "intent": intent,
        "progress": {
            "prepare_complete": True,
            "execution_authorized": True,
            "target": max_leads,
            "cost_eur": 0.0,
        },
    }).execute()
    sb.table("evaluation_runs").insert({
        "id": run_id,
        "dataset_version": "mirax-demo-matrix-v1",
        "release_id": "20260719_221346",
        "mode": "shadow_research",
        "status": "running",
        "configuration": {
            "vertical": spec_id,
            "query": spec["query"],
            "max_leads": max_leads,
            "hard_budget_eur": hard,
            "customer_visible": False,
        },
    }).execute()
    sb.table("canary_runs").insert({
        "id": canary_id,
        "evaluation_run_id": run_id,
        "search_id": search_id,
        "canary_type": f"matrix_{spec_id}",
        "exact_query": spec["query"],
        "max_leads": max_leads,
        "hard_budget_eur": hard,
        "shadow_mode": True,
        "customer_visible": False,
        "worker_limit": 1,
        "status": "running",
    }).execute()
    try:
        sb.rpc("initialize_search_budget", {
            "p_search_id": search_id,
            "p_target_cost_eur": hard * 0.8,
            "p_hard_cost_eur": hard,
        }).execute()
    except Exception as exc:  # pragma: no cover
        print("budget_warn", type(exc).__name__, str(exc)[:120])

    meta = {
        "ok": True,
        "vertical": spec_id,
        "search_id": search_id,
        "canary_id": canary_id,
        "run_id": run_id,
        "required_signals": spec["signals"],
        "adapters": spec["adapters"],
        "target_role": spec["role"],
        "relationships": spec["relationships"],
    }
    print(json.dumps(meta, ensure_ascii=False))
    Path("/tmp/mirax_matrix_last_ids.json").write_text(json.dumps(meta), encoding="utf-8")

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
            "--once", "--search-id", search_id, "--mode", "user",
            "--user-recent-minutes", "0", "--cooldown", "0",
        ],
        cwd=str(ROOT),
        env=run_env,
        capture_output=True,
        text=True,
    )
    print(proc.stdout[-5000:])
    if proc.stderr:
        print(proc.stderr[-2000:])
    print("WORKER_EXIT", proc.returncode)
    return meta


if __name__ == "__main__":
    prepare_and_run(sys.argv[1] if len(sys.argv) > 1 else "q2")
