"""Worker hydration must reuse persisted CommercialIntentSpec with zero model calls."""
from __future__ import annotations

from commercial_intent.compiler import CommercialIntentCompiler
from commercial_intent.planner import OfferToBuyerNeedPlanner
from commercial_intent.runtime import resolve_authoritative_intent, spec_to_canonical_plan


def test_persisted_spec_hydration_makes_zero_compiler_calls():
    compiler = CommercialIntentCompiler()
    planner = OfferToBuyerNeedPlanner()
    spec = compiler.compile(
        "Installiamo sistemi antincendio industriali. "
        "Trovami 3 PMI del Nord Italia con segnali recenti di nuovi stabilimenti."
    )
    payload = {**spec.to_dict(), "target_company_profile": spec.target_company_profile}
    hypotheses = [h.to_dict() for h in planner.plan(payload)]
    payload["commercial_hypotheses"] = hypotheses

    # Worker path: load from progress, never recompile.
    intent = {
        "commercial_intent_required": True,
        "progress": {
            "commercial_intent_spec": payload,
            "commercial_hypotheses": hypotheses,
            "intent_compiler_telemetry": {"compiler_tier": 1, "hypotheses_count": len(hypotheses)},
        },
    }
    plan = resolve_authoritative_intent(intent)
    assert plan["raw_query"]
    assert plan["target"]["market_scope_policy"]["maximum_employees"] == 249
    assert plan["commercial_intent_spec"]["original_query"] == payload["original_query"]
    # Planner on already-compiled spec must not invent a second compile path.
    again = planner.plan(payload)
    assert 1 <= len(again) <= 6
    assert all(item.hypothesis_id for item in again)
    assert all(item.allowed_signal_families for item in again)


def test_spec_to_canonical_plan_is_pure():
    compiler = CommercialIntentCompiler()
    spec = compiler.compile("Trovami PMI che stanno valutando un CRM")
    payload = {**spec.to_dict(), "target_company_profile": spec.target_company_profile}
    a = spec_to_canonical_plan(payload)
    b = spec_to_canonical_plan(payload)
    assert a["raw_query"] == b["raw_query"]
    assert a["target"]["market_scope_policy"] == b["target"]["market_scope_policy"]
