"""Offline replay of Case A final resume — zero providers / zero network.

Demonstrates why Kastamonu was re-interpreted and that the durable terminal
ledger + two-level cache + absolute governor cap close the hole.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path

import pytest

from backend_mirror.semantic_intelligence import (
    EVENT_SCHEMA_VERSION,
    SemanticEventInterpretation,
    SemanticQueryContract,
    SemanticResultCache,
    URL_STABLE_MODEL_MARKER,
    _digest,
    evaluate_temporal_evidence_valid,
    normalize_industrial_buyer_trigger_relationships,
    resolve_maximum_age_days,
    reverify_interpretation_offline,
    select_primary_rejection_code,
)
from backend_mirror.source_adapters.shadow_budget import (
    resolve_absolute_governor_cap,
    resolve_shadow_hard_cap_eur,
)
from backend_mirror.source_adapters.shadow_runtime import reopen_generic_web_resume_cursors
from backend_mirror.source_adapters.contracts import DiscoveryCursor
from backend_mirror.source_adapters.terminal_url_ledger import (
    STALE_EVENT,
    canonical_url_key,
    eligible_for_semantic_call,
    filter_nonterminal_urls,
    kastamonu_stale_record,
    ledger_from_mapping,
    ledger_to_mapping,
    mark_terminal,
    merge_ops_park_progress,
    merge_terminal_ledgers,
)

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tmp" / "openworld-matrix"
SEARCH_ID = "26272264-186a-45cd-84a2-cc930a7a0e83"
KASTAMONU_URL = (
    "https://www.confindustriaemilia.it/flex/cm/pages/ServeBLOB.php/L/IT/IDPagina/105348"
)
KASTAMONU_KEY = canonical_url_key(KASTAMONU_URL)


def _load_json(name: str):
    path = ARTIFACTS / name
    if not path.exists():
        pytest.skip(f"missing artifact {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _kastamonu_contract() -> SemanticQueryContract:
    required, rubric = normalize_industrial_buyer_trigger_relationships(
        [
            "factory_expansion_by_target_company",
            "production_line_automation_by_target_company",
            "new_machinery_installation_by_target_company",
        ],
        [
            "target_role_equipment_operator_grounded",
            "factory_expansion_by_target_company_grounded",
            "production_line_automation_by_target_company_grounded",
            "new_machinery_installation_by_target_company_grounded",
        ],
    )
    return SemanticQueryContract.from_model(
        {
            "query_goal": "industrial buyer triggers",
            "seller": {},
            "offer": {},
            "target_entity_types": ["operating_company"],
            "target_company_description": "Italian SME",
            "event_or_state_description": "factory expansion / automation / machinery",
            "target_role_in_event": "equipment_operator",
            "required_relationships": list(required),
            "optional_relationships": [],
            "excluded_roles": [],
            "excluded_entities": ["multinational_corporations"],
            "geography": ["Italy"],
            "industry": ["Manufacturing"],
            "size_constraints": {},
            "temporal_constraints": {"timeframe_months": 12, "recency": "recent"},
            "positive_conditions": [],
            "negative_conditions": [],
            "must_have_facts": ["target_company_identity"],
            "forbidden_inferences": ["publisher_is_target_company"],
            "data_requirements": ["official_domain", "source_url"],
            "ranking_objective": "fresh grounded triggers",
            "acceptance_rubric": list(rubric),
            "discovery_hypotheses": [],
            "clarification_required": False,
            "confidence": 0.9,
        },
        original_query="case-a",
        requested_count=3,
    )


def test_forensic_cache_miss_was_contract_hash_churn():
    """Exact cause: legacy cache key included contract_hash; umbrella OR changed it."""
    resume = _load_json(f"A-{SEARCH_ID}.resume-progress.json")
    latest = _load_json("A-26272264-latest-interp.json")
    assert latest["event_date"] == "2024-06-28"
    assert latest["target_company"] == "Kastamonu Italia"

    from backend_mirror.semantic_intelligence import _canonical_source_url

    url_hash = _digest({"source_url": _canonical_source_url(KASTAMONU_URL)})
    old_key = SemanticResultCache.key(
        content_hash=url_hash,
        semantic_query_contract_hash="pre_umbrella_contract",
        model_version="claude-haiku-4-5",
        interpreter_schema_version=EVENT_SCHEMA_VERSION,
    )
    new_key = SemanticResultCache.key(
        content_hash=url_hash,
        semantic_query_contract_hash=_kastamonu_contract().contract_hash,
        model_version="claude-haiku-4-5",
        interpreter_schema_version=EVENT_SCHEMA_VERSION,
    )
    assert old_key != new_key
    # Cursor reopen removed Kastamonu from processed_terminal_urls.
    assert "shadow_resume" in resume
    from backend_mirror.source_adapters.generic_web_budget import decode_generic_web_v2_payload

    cursor_val = resume["shadow_resume"]["resume_cursors"]["generic_web_research_v1"]
    payload = decode_generic_web_v2_payload(cursor_val)
    all_urls = " ".join(
        str(u)
        for u in list(payload.get("candidate_source_urls") or ())
        + list(payload.get("processed_terminal_urls") or ())
        + list(payload.get("salvaged_urls") or ())
    )
    assert "105348" in all_urls or "confindustriaemilia" in all_urls.casefold()


def test_ops_park_restore_merges_kastamonu_terminal():
    restored = _load_json(f"A-{SEARCH_ID}.resume-progress.json")
    live = {
        "stage": "ops_park_final",
        "grounding_rejects": [
            {
                "url": KASTAMONU_URL,
                "rejection_code": "EVENT_GROUNDING_FAILED",
                "primary_rejection_code": "EVENT_GROUNDING_FAILED",
                "false_checks": ["temporal_evidence_valid"],
                "failed_gate_codes": ["EVENT_GROUNDING_FAILED", "COMPANY_GROUNDING_FAILED"],
                "event_date": "2024-06-28",
                "classification": "VALID_EVENT_BUT_STALE_FOR_QUERY",
            }
        ],
        "shadow_resume": {"terminal_url_ledger": {"urls": {}}},
    }
    merged = merge_ops_park_progress(restored, live)
    ledger = ledger_from_mapping(merged["terminal_url_ledger"])
    assert KASTAMONU_KEY in ledger
    rec = ledger[KASTAMONU_KEY]
    assert rec.terminal_status == STALE_EVENT
    assert rec.terminal_reason == "temporal_evidence_valid_false"
    assert rec.eligible_for_semantic_call is False
    assert eligible_for_semantic_call(ledger, KASTAMONU_URL) is False


def test_reopen_does_not_requeue_kastamonu_terminal():
    restored = _load_json(f"A-{SEARCH_ID}.resume-progress.json")
    cursors = restored["shadow_resume"]["resume_cursors"]
    ledger = {
        KASTAMONU_KEY: kastamonu_stale_record(search_id=SEARCH_ID, url=KASTAMONU_URL),
    }
    out = reopen_generic_web_resume_cursors(
        {k: DiscoveryCursor(v) for k, v in cursors.items()},
        processed_employer_keys=(),
        terminal_ledger=ledger_to_mapping(ledger),
    )
    cursor_val = out["generic_web_research_v1"].value
    assert "generic-web:v2:" in cursor_val
    # Decode pending and ensure Kastamonu absent.
    from backend_mirror.source_adapters.generic_web_budget import decode_generic_web_v2_payload

    payload = decode_generic_web_v2_payload(cursor_val)
    pending = [canonical_url_key(u) for u in (payload.get("pending_urls") or ())]
    assert KASTAMONU_KEY not in pending
    terminals = [canonical_url_key(u) for u in (payload.get("processed_terminal_urls") or ())]
    assert KASTAMONU_KEY in terminals


def test_kastamonu_offline_reverify_primary_event_stale():
    latest = _load_json("A-26272264-latest-interp.json")
    fixture = ROOT / "backend_mirror" / "fixtures" / "case_a_26272264_kastamonu_semantic_page.json"
    page = json.loads(fixture.read_text(encoding="utf-8")) if fixture.exists() else {}
    source_text = str(page.get("source_text") or latest.get("evidence_excerpt") or "")
    # Ensure excerpt is literal in source for verifier.
    if latest.get("evidence_excerpt") and latest["evidence_excerpt"] not in source_text:
        source_text = latest["evidence_excerpt"] + "\n" + source_text
    interp = SemanticEventInterpretation.from_model(latest)
    contract = _kastamonu_contract()
    age = resolve_maximum_age_days(
        freshness_max_age_days=None,
        temporal_constraints=contract.temporal_constraints,
    )
    assert age == 360  # 12 * 30
    assert evaluate_temporal_evidence_valid(
        event_date="2024-06-28",
        source_published_at="2024-06-28",
        source_text=source_text,
        event_status="completed",
        historical=False,
        now=date(2026, 7, 23),
        maximum_age_days=age,
    ) is False

    verdict = reverify_interpretation_offline(
        contract=contract,
        interpretation=interp,
        source_text=source_text,
        source_url=KASTAMONU_URL,
        source_publisher="Confindustria Emilia",
        official_domain_verified=False,
        official_domain_confidence=0.0,
        entity_class="operating_company",
        candidate_company="Kastamonu Italia",
        maximum_age_days=age,
        now=date(2026, 7, 23),
        identity_verification_deferred=True,
    )
    assert verdict.primary_rejection_code == "EVENT_GROUNDING_FAILED"
    assert verdict.rejection_code == "EVENT_GROUNDING_FAILED"
    assert "temporal_evidence_valid" in verdict.false_checks
    assert "EVENT_GROUNDING_FAILED" in verdict.failed_gate_codes
    # Company/domain issues may also fail but must not erase stale primary.
    assert verdict.gate_results["event_grounding"] is False


def test_two_level_cache_avoids_paid_call_on_contract_churn(tmp_path: Path):
    cache = SemanticResultCache(path=str(tmp_path / "cache.db"))
    latest = _load_json("A-26272264-latest-interp.json")
    from backend_mirror.semantic_intelligence import _canonical_source_url

    content = str(latest.get("evidence_excerpt") or "x") * 20
    canonical = _canonical_source_url(KASTAMONU_URL)
    content_hash = _digest({"source_text": content, "source_url": canonical})
    model_key = SemanticResultCache.model_interpretation_key(
        content_hash=content_hash,
        model_version="fixture-model",
        event_schema_version=EVENT_SCHEMA_VERSION,
    )
    cache.set_model_interpretation(
        model_key,
        latest,
        content_hash=content_hash,
        model_version="fixture-model",
        event_schema_version=EVENT_SCHEMA_VERSION,
        canonical_url=canonical,
    )
    # Contract-hash churn must still hit model layer by URL.
    hit = cache.get_model_interpretation_for_url(canonical)
    assert hit is not None
    assert hit["target_company"] == "Kastamonu Italia"


def test_nonterminal_urls_remain_filterable():
    ledger = {
        KASTAMONU_KEY: kastamonu_stale_record(search_id=SEARCH_ID, url=KASTAMONU_URL),
    }
    urls = (
        KASTAMONU_URL,
        "https://focusonpcb.it/news-section/",
        "https://www.carel.it/chapter-six",
    )
    kept = filter_nonterminal_urls(urls, ledger)
    assert KASTAMONU_KEY not in [canonical_url_key(u) for u in kept]
    assert len(kept) == 2


def test_absolute_governor_cap_from_additional_authorized():
    absolute = resolve_absolute_governor_cap(
        current_charged_search_spend=0.048886,
        additional_authorized_eur=0.026114,
        product_max_eur=0.075,
    )
    assert absolute == 0.075
    # Misconfigured incremental-as-absolute must not be used when additional is set.
    cap = resolve_shadow_hard_cap_eur(
        plan_hard_cost_eur=0.075,
        environ={"MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": "0.026114"},
        resume_state={
            "prior_cost_eur": 0.048886,
            "additional_authorized_eur": 0.026114,
        },
        current_charged_search_spend=0.048886,
        absolute_max_eur=0.25,
    )
    assert cap == 0.075
    # Abort path: residual-only env without additional → absolute 0.026114 which
    # is below prior; callers must treat remaining<=0 as no-op (no provider).
    legacy = resolve_shadow_hard_cap_eur(
        plan_hard_cost_eur=0.075,
        environ={"MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR": "0.026114"},
        resume_state={"prior_cost_eur": 0.048886},
        absolute_max_eur=0.25,
    )
    assert legacy == 0.026114
    assert legacy < 0.048886


def test_primary_rejection_order_keeps_stale_over_company():
    code = select_primary_rejection_code(
        failed_gate_codes=["COMPANY_GROUNDING_FAILED", "EVENT_GROUNDING_FAILED"],
        false_checks=["temporal_evidence_valid", "official_domain_verified"],
    )
    assert code == "EVENT_GROUNDING_FAILED"


def test_merge_ledgers_never_drops_stale():
    a = {KASTAMONU_KEY: kastamonu_stale_record(search_id=SEARCH_ID, url=KASTAMONU_URL)}
    b = ledger_from_mapping({"urls": {}})
    merged = merge_terminal_ledgers(b, a)
    assert merged[KASTAMONU_KEY].terminal_status == STALE_EVENT
