"""Regression for the immutable antincendio canary's canonical plan."""

from __future__ import annotations

from pathlib import Path

from commercial_intent.compiler import CommercialIntentCompiler
from commercial_intent.planner import OfferToBuyerNeedPlanner
from scripts import run_openworld_antincendio_canary as canary


def test_canary_plan_preserves_only_hypothesis_bound_expansion_signals(monkeypatch) -> None:
    repository = Path(__file__).resolve().parents[1]
    monkeypatch.setattr(canary, "ROOT", repository)
    intent = CommercialIntentCompiler().compile(canary.QUERY).to_dict()
    hypotheses = [item.to_dict() for item in OfferToBuyerNeedPlanner().plan(intent)]

    plan = canary.build_schema_valid_plan(intent, hypotheses)

    assert plan["signal_policy"]["required_signals"] == ["production_expansion"]
    assert canary.execution_required_signals(plan) == ["production_expansion"]
    assert canary.execution_required_signals(plan) != canary.SIGNALS
    assert plan["signal_policy"]["optional_signals"] == []
    assert plan["semantic_query_contract"]["canonical_signal_hints"] == ["production_expansion"]
    assert plan["commercial_hypotheses"]
    for hypothesis in plan["commercial_hypotheses"]:
        assert hypothesis["signals"] == ["production_expansion"]
        assert "funding" not in hypothesis["signals"]


def test_canary_plan_fails_closed_without_expansion_hypothesis(monkeypatch) -> None:
    repository = Path(__file__).resolve().parents[1]
    monkeypatch.setattr(canary, "ROOT", repository)
    intent = CommercialIntentCompiler().compile(canary.QUERY).to_dict()
    unrelated = [{
        "hypothesis_id": "hyp-funding",
        "allowed_signal_families": ["funding"],
        "observable_event_types": ["funding"],
        "buyer_problem": "capital received",
    }]

    try:
        canary.build_schema_valid_plan(intent, unrelated)
    except ValueError as exc:
        assert "no expansion-bound hypothesis" in str(exc)
    else:  # pragma: no cover - explicit fail-closed assertion
        raise AssertionError("unrelated hypothesis must not be silently replaced")


def test_canary_execution_signals_fail_closed_when_plan_has_none() -> None:
    try:
        canary.execution_required_signals({"signal_policy": {"required_signals": []}})
    except ValueError as exc:
        assert "no canonical required signals" in str(exc)
    else:  # pragma: no cover - explicit fail-closed assertion
        raise AssertionError("execution cannot restore broad aliases after validation")
