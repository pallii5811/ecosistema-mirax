"""Integration tests: persisted CommercialIntentSpec → worker acceptance plan."""
from __future__ import annotations

import pytest

from commercial_intent.compiler import CommercialIntentCompiler
from commercial_intent.runtime import (
    extract_persisted_spec,
    resolve_authoritative_intent,
    spec_to_canonical_plan,
)


def _compiled_spec() -> dict:
    compiler = CommercialIntentCompiler()
    spec = compiler.compile("Trovami PMI che stanno valutando un CRM")
    return {
        **spec.to_dict(),
        "target_company_profile": spec.target_company_profile,
    }


def test_extract_persisted_spec_from_progress():
    spec = _compiled_spec()
    intent = {"progress": {"commercial_intent_spec": spec}}
    extracted = extract_persisted_spec(intent)
    assert extracted is not None
    assert extracted["original_query"] == spec["original_query"]


def test_resolve_authoritative_intent_maps_market_scope():
    spec = _compiled_spec()
    plan = resolve_authoritative_intent({"commercial_intent_spec": spec})
    assert plan["raw_query"] == spec["original_query"]
    policy = plan["target"]["market_scope_policy"]
    assert policy["maximum_employees"] == 249
    assert policy["enterprise_opt_in"] is False


def test_commercial_intent_required_fails_closed():
    with pytest.raises(ValueError, match="COMMERCIAL_INTENT_SPEC_MISSING"):
        resolve_authoritative_intent({"commercial_intent_required": True})


def test_spec_to_canonical_plan_preserves_hypotheses():
    spec = _compiled_spec()
    spec["commercial_hypotheses"] = [
        {
            "id": "h1",
            "hypothesis_id": "h1",
            "buyer_archetype": "PMI che valuta un CRM",
            "target_company_profile": spec["target_company_profile"],
            "target_role": "buyer",
            "buyer_problem": "CRM obsoleto",
            "expected_outcome": "selezione di un nuovo CRM",
            "observable_event": "valutazione fornitori",
            "observable_event_types": ["vendor_evaluation"],
            "required_relationship": "buyer",
            "required_relationships": ["buyer"],
            "allowed_signal_families": ["technology_evaluation"],
            "excluded_signal_families": ["hiring", "funding"],
            "sources": ["official_company_website"],
            "source_classes": ["official_company_website"],
            "evidence_claim_type": "DIRECT_DEMAND",
            "query_templates": ["azienda valuta nuovo CRM"],
            "false_positive_risks": ["consulente"],
            "expected_yield": "medium",
            "expected_cost": "medium",
            "intent_strength": "direct",
        }
    ]
    plan = spec_to_canonical_plan(spec)
    assert len(plan["commercial_hypotheses"]) == 1
    assert plan["signal_policy"]["required_signals"]
