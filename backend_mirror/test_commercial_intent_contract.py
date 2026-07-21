"""Contract parity and compiler/planner tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

pytest.importorskip("jsonschema")

from commercial_intent.compiler import CommercialIntentCompiler
from commercial_intent.planner import OfferToBuyerNeedPlanner
from contracts.commercial_intent import DEFAULT_MIRAX_MARKET_SCOPE_POLICY, normalize_commercial_intent


def test_default_market_scope_policy_matches_spec():
    assert DEFAULT_MIRAX_MARKET_SCOPE_POLICY["maximum_employees"] == 249
    assert DEFAULT_MIRAX_MARKET_SCOPE_POLICY["enterprise_opt_in"] is False


def test_compiler_produces_valid_spec():
    compiler = CommercialIntentCompiler()
    spec = compiler.compile("Sono consulente marketing: trovami PMI lombarde con campagne attive")
    payload = normalize_commercial_intent({
        **spec.to_dict(),
        "target_company_profile": spec.target_company_profile,
    })
    assert payload["request_mode"] == "seller_driven_lead_discovery"
    assert payload["target_company_profile"]["market_scope_policy"]["maximum_employees"] == 249


@pytest.mark.parametrize(
    "query",
    [
        "manutenzione predittiva per impianti industriali",
        "recupero crediti per PMI",
        "sistemi antincendio industriali",
        "packaging compostabile",
        "passaggio generazionale aziendale",
        "catena del freddo industriale",
        "certificazione ISO 9001",
        "camere bianche pharmaceutical",
        "consulenza dazi doganali",
        "ottimizzazione consumi industriali",
    ],
)
def test_open_world_planner_does_not_invent_unrequested_event_families(query: str):
    compiler = CommercialIntentCompiler()
    planner = OfferToBuyerNeedPlanner()
    spec = compiler.compile(f"Sono un fornitore: {query}")
    hypotheses = planner.plan(spec.to_dict())
    assert hypotheses == []
    assert spec.target_company_profile["market_scope_policy"]["maximum_employees"] == 249


def test_schema_file_loads():
    schema = json.loads((ROOT / "contracts" / "commercial_intent.schema.json").read_text(encoding="utf-8"))
    assert schema["$defs"]["targetCompanyProfile"]["required"] == ["market_scope_policy"]
