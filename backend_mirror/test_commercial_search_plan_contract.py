import copy
import json
import os
from pathlib import Path

import pytest
from pydantic import ValidationError

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("MIRAX_WORKER_DISABLED", "1")

from contracts.commercial_search_plan import (
    COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION,
    CommercialSearchPlan,
    validate_commercial_search_plan,
)
from worker_supabase import _validate_canonical_plan_in_intent


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads(
    (ROOT / "contracts" / "fixtures" / "commercial-search-plan.valid.json").read_text(encoding="utf-8")
)
JSON_SCHEMA = json.loads(
    (ROOT / "contracts" / "commercial-search-plan.schema.json").read_text(encoding="utf-8")
)


def test_shared_fixture_and_version_validate():
    plan = validate_commercial_search_plan(FIXTURE)
    assert plan.schema_version == COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION
    assert JSON_SCHEMA["properties"]["schema_version"]["const"] == COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION
    required_model_fields = {
        name for name, field in CommercialSearchPlan.model_fields.items()
        if field.is_required()
    }
    assert set(JSON_SCHEMA["required"]) == required_model_fields
    assert CommercialSearchPlan.model_fields["semantic_query_contract"].is_required() is False


@pytest.mark.parametrize("mutation", ["unknown", "budget", "weights", "range"])
def test_contract_fails_closed(mutation):
    payload = copy.deepcopy(FIXTURE)
    if mutation == "unknown":
        payload["untrusted_llm_field"] = "must fail"
    elif mutation == "budget":
        payload["budget_policy"].update(target_cost_eur=1, hard_cost_eur=0.5)
    elif mutation == "weights":
        payload["ranking_policy"]["weight_need_gap"] = 0.5
    else:
        payload["target"]["employee_range"] = {"min": 250, "max": 10}
    with pytest.raises(ValidationError):
        validate_commercial_search_plan(payload)


def test_worker_boundary_validates_nested_canonical_plan():
    intent = {"uqe_plan": {"canonical_plan": copy.deepcopy(FIXTURE)}}
    normalized = _validate_canonical_plan_in_intent(intent)
    assert normalized["uqe_plan"]["canonical_plan"]["schema_version"] == "1.0.0"
    assert normalized is not intent


def test_worker_boundary_rejects_contract_drift():
    invalid = copy.deepcopy(FIXTURE)
    invalid["schema_version"] = "999.0.0"
    with pytest.raises(ValidationError):
        _validate_canonical_plan_in_intent({"uqe_plan": {"canonical_plan": invalid}})


def test_worker_boundary_rejects_unknown_source_class():
    invalid = copy.deepcopy(FIXTURE)
    invalid["source_policy"]["allowed_source_classes"].append("llm_invented_source")
    with pytest.raises(ValueError, match="unknown source classes"):
        _validate_canonical_plan_in_intent({"uqe_plan": {"canonical_plan": invalid}})


def test_worker_boundary_rejects_unknown_signal_id():
    invalid = copy.deepcopy(FIXTURE)
    invalid["signal_policy"]["optional_signals"].append("magic_hot_lead_signal")
    with pytest.raises(ValueError, match="unknown signal ids"):
        _validate_canonical_plan_in_intent({"uqe_plan": {"canonical_plan": invalid}})
