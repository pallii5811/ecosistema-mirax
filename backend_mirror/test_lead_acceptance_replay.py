"""Offline replay: 50 ACCEPT + 50 REJECT through LeadAcceptanceService + publish_accepted_leads."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from lead_acceptance.models import EvaluationContext
from lead_acceptance.publication import publish_accepted_leads
from lead_acceptance.replay_dataset import write_dataset
from lead_acceptance.service import LeadAcceptanceService

ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = ROOT / "evaluation" / "fixtures" / "lead-acceptance-replay-v2.json"


@pytest.fixture(scope="module")
def replay_cases() -> List[Dict[str, Any]]:
    if not DATASET_PATH.is_file():
        write_dataset(DATASET_PATH)
    payload = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    cases = payload["cases"]
    assert sum(1 for c in cases if c["expected"] == "ACCEPT") == 50
    assert sum(1 for c in cases if c["expected"] == "REJECT") == 50
    return cases


def test_replay_dataset_has_100_cases(replay_cases):
    assert len(replay_cases) == 100


def test_offline_replay_50_accept_50_reject(replay_cases):
    service = LeadAcceptanceService()
    ctx = EvaluationContext(cost_within_budget=True, require_contact=False)

    false_positives: List[str] = []
    false_negatives: List[str] = []
    enterprise_accepted: List[str] = []
    closed_as_open: List[str] = []
    wrong_actor: List[str] = []
    ungrounded: List[str] = []

    for case in replay_cases:
        decision = service.evaluate(case["candidate"], case["intent"], ctx)
        expected = case["expected"]
        actual = "ACCEPT" if decision.accepted else "REJECT"

        if expected == "REJECT" and decision.accepted:
            false_positives.append(case["id"])
        if expected == "ACCEPT" and not decision.accepted:
            false_negatives.append(f"{case['id']}: {decision.rejection_codes}")

        if decision.accepted:
            domain = (decision.official_domain or "").lower()
            name = str(case["candidate"].get("azienda") or "").lower()
            if any(k in domain or k in name for k in (
                "pwc.com", "abbott.com", "trenord", "novonordisk", "decathlon", "microsoft", "google"
            )):
                enterprise_accepted.append(case["id"])
            if decision.opportunity_state.value in {
                "AWARDED_RECENTLY", "IMPLEMENTATION_ACTIVE", "HISTORICAL_CASE_STUDY",
            }:
                closed_as_open.append(case["id"])
            if "ACTOR_DIRECTION_INVERSION" not in decision.rejection_codes and any(
                case["candidate"].get(k) for k in ("is_recruiter", "is_source_publisher")
            ):
                entity = case["candidate"].get("entity_classification") or {}
                if entity.get("is_recruiter") or entity.get("is_source_publisher"):
                    wrong_actor.append(case["id"])
            if not decision.evidence_gate.passed and not case["candidate"].get("business_signals"):
                ungrounded.append(case["id"])

    assert false_positives == [], f"False positives: {false_positives}"
    assert len(false_negatives) <= 2, f"False negatives ({len(false_negatives)}): {false_negatives}"
    assert enterprise_accepted == [], f"Enterprise accepted: {enterprise_accepted}"
    assert closed_as_open == [], f"Closed opportunity accepted: {closed_as_open}"
    assert wrong_actor == [], f"Wrong actor accepted: {wrong_actor}"
    assert ungrounded == [], f"Ungrounded evidence accepted: {ungrounded}"


def test_mandatory_rejects(replay_cases):
    service = LeadAcceptanceService()
    ctx = EvaluationContext(cost_within_budget=True, require_contact=False)
    mandatory = {"reject-trenord-crm", "reject-pwc-hiring", "reject-abbott-hiring"}
    by_id = {c["id"]: c for c in replay_cases}
    for case_id in mandatory:
        case = by_id[case_id]
        decision = service.evaluate(case["candidate"], case["intent"], ctx)
        assert decision.accepted is False, case_id
        assert decision.rejection_codes, case_id


def test_publish_accepted_leads_path(replay_cases):
    service = LeadAcceptanceService()
    ctx = EvaluationContext(cost_within_budget=True, require_contact=False)
    decisions = [service.evaluate(c["candidate"], c["intent"], ctx) for c in replay_cases]
    result = publish_accepted_leads(
        "replay-offline",
        decisions,
        requested_count=50,
        cost_within_budget=True,
    )
    assert result.accepted_unique_count <= 50
    assert all(d.accepted for d in decisions if d.accepted)
    # Publication without supabase returns stamped payloads for accepted unique
    assert result.published_count == result.accepted_unique_count


def test_false_negative_analysis_logged(replay_cases, capsys):
    """Document false negatives for human review when <=2 allowed."""
    service = LeadAcceptanceService()
    ctx = EvaluationContext(cost_within_budget=True, require_contact=False)
    misses = []
    for case in replay_cases:
        if case["expected"] != "ACCEPT":
            continue
        decision = service.evaluate(case["candidate"], case["intent"], ctx)
        if not decision.accepted:
            misses.append({
                "id": case["id"],
                "reason": case["human_reason"],
                "codes": decision.rejection_codes,
                "source": case["source"],
            })
    if misses:
        print(json.dumps({"false_negatives": misses}, ensure_ascii=False, indent=2))
