from __future__ import annotations

import copy
import os

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("MIRAX_WORKER_DISABLED", "1")

from commercial_lifecycle import evaluate_publication_gate
from source_adapters.hiring_qualification import employer_key_from_payload
from test_commercial_lifecycle import MILANO_PLAN, digital_audit_lead
from worker_supabase import _upgrade_legacy_digital_audit_resume_geography


SEARCH_ID = "0b48d6f0-9938-4e0b-b2d3-eae269085978"


def regional_plan():
    plan = copy.deepcopy(MILANO_PLAN)
    plan["search_id"] = SEARCH_ID
    plan["target"]["geographies"] = ["Lombardia"]
    plan["signal_policy"]["required_signals"] = ["website_weakness"]
    return plan


def legacy_payload(index: int, **overrides):
    domain = f"pulizie-{index}.example"
    lead = digital_audit_lead(
        azienda=f"Pulizie {index}",
        sito=f"https://{domain}",
        employer_official_domain=domain,
        citta="Milano",
        matched_signals=["website_weakness"],
        required_signals=["website_weakness"],
        business_signals=[digital_audit_lead()["business_signals"][0]],
    )
    lead["domain_verification"] = {
        **lead["domain_verification"],
        "url": f"https://{domain}/",
    }
    lead.update(overrides)
    return lead


def resume_state(payloads):
    return {
        "resume_cursors": {"legacy_digital_audit_v1": "da:v3:checkpoint"},
        "qualified_lead_payloads": copy.deepcopy(payloads),
        "processed_employer_keys": [employer_key_from_payload(item) for item in payloads],
        "processed_domains": [item["employer_official_domain"] for item in payloads],
        "processed_place_ids_ref": "persisted-ref",
        "acquisition": {
            "partition_count": 36,
            "partition_index": 2,
            "next_partition_index": 3,
            "partition_category": "servizi di pulizia",
            "partition_location": "Milano",
            "cumulative_raw_unique": 81,
            "cumulative_audited": 83,
        },
    }


def upgrade(payloads, *, plan=None, state=None):
    return _upgrade_legacy_digital_audit_resume_geography(
        payloads,
        search_id=SEARCH_ID,
        canonical_plan=plan or regional_plan(),
        resume_state=state if state is not None else resume_state(payloads),
    )


def test_legacy_regional_payload_requires_same_search_persisted_partition_provenance():
    lead = legacy_payload(1)
    restored = upgrade([lead])[0]
    assert restored["geography_match"] is True
    assert restored["requested_geographies"] == ["Lombardia"]
    assert restored["geography_match_method"] == "legacy_resume_partition_provenance"
    assert restored["geography_match_evidence"]["search_id"] == SEARCH_ID
    assert evaluate_publication_gate(restored, regional_plan(), cost_within_budget=True)["publishable"] is True

    unproven = upgrade([lead], state={})[0]
    gate = evaluate_publication_gate(unproven, regional_plan(), cost_within_budget=True)
    assert gate["publishable"] is False
    assert "GEO_UNVERIFIED" in gate["rejection_codes"]


def test_explicit_region_contradiction_stays_out_of_scope():
    lead = legacy_payload(2, citta="Roma", address_region="Lazio")
    rejected = upgrade([lead])[0]
    gate = evaluate_publication_gate(rejected, regional_plan(), cost_within_budget=True)
    assert gate["publishable"] is False
    assert "GEO_OUT_OF_SCOPE" in gate["rejection_codes"]


def test_payload_from_other_search_is_not_upgraded():
    lead = legacy_payload(6)
    other_plan = copy.deepcopy(regional_plan())
    other_plan["search_id"] = "other-search-id"
    restored = upgrade([lead], plan=other_plan)[0]
    gate = evaluate_publication_gate(restored, other_plan, cost_within_budget=True)
    assert restored.get("geography_match_method") != "legacy_resume_partition_provenance"
    assert gate["publishable"] is False
    assert "GEO_UNVERIFIED" in gate["rejection_codes"]


def test_employer_not_in_historical_checkpoint_is_not_upgraded():
    lead = legacy_payload(7)
    state = resume_state([legacy_payload(8)])
    state["processed_employer_keys"] = [employer_key_from_payload(legacy_payload(8))]
    restored = upgrade([lead], state=state)[0]
    gate = evaluate_publication_gate(restored, regional_plan(), cost_within_budget=True)
    assert restored.get("geography_match_method") != "legacy_resume_partition_provenance"
    assert gate["publishable"] is False
    assert "GEO_UNVERIFIED" in gate["rejection_codes"]


def test_new_controlled_payload_and_exact_locality_behavior_are_unchanged():
    controlled = legacy_payload(
        3,
        geography_match=True,
        requested_geographies=["Lombardia"],
        matched_geography="Milano",
        geography_match_method="controlled_maps_partition",
    )
    assert upgrade([controlled])[0] == controlled

    exact_plan = copy.deepcopy(MILANO_PLAN)
    exact_plan["search_id"] = SEARCH_ID
    exact_milano = digital_audit_lead(employer_official_domain="shinecleaning.it")
    exact_roma = digital_audit_lead(
        azienda="Shine Cleaning Roma",
        citta="Roma",
        sito="https://shinecleaning-roma.it",
        employer_official_domain="shinecleaning-roma.it",
    )
    exact_roma["domain_verification"] = {
        **exact_roma["domain_verification"],
        "url": "https://shinecleaning-roma.it/",
    }
    upgraded = upgrade([exact_milano, exact_roma], plan=exact_plan)
    assert upgraded == [exact_milano, exact_roma]
    assert evaluate_publication_gate(upgraded[0], exact_plan, cost_within_budget=True)["publishable"] is True
    assert evaluate_publication_gate(upgraded[1], exact_plan, cost_within_budget=True)["publishable"] is False


def test_offline_affected_search_replay_restores_12_and_preserves_3_without_side_effects():
    historical = [legacy_payload(index) for index in range(12)]
    new = [legacy_payload(
        100 + index,
        geography_match=True,
        requested_geographies=["Lombardia"],
        matched_geography="Milano",
        geography_match_method="controlled_maps_partition",
    ) for index in range(3)]
    payloads = historical + new
    plan = regional_plan()
    state = resume_state(payloads)
    plan_before = copy.deepcopy(plan)
    state_before = copy.deepcopy(state)

    hydrated = upgrade(payloads, plan=plan, state=state)
    gates = [evaluate_publication_gate(item, plan, cost_within_budget=True) for item in hydrated]

    assert sum(item.get("geography_match_method") == "legacy_resume_partition_provenance" for item in hydrated) == 12
    assert sum(item.get("geography_match_method") == "controlled_maps_partition" for item in hydrated) == 3
    assert sum(gate["publishable"] for gate in gates) == 15
    assert plan == plan_before
    assert state == state_before
    assert plan["target"]["industries"] == plan_before["target"]["industries"]
    assert state["resume_cursors"] == state_before["resume_cursors"]
    assert state["acquisition"] == state_before["acquisition"]
