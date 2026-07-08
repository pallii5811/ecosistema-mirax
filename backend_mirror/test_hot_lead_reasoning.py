from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from agents.agentic_gap_fill import (
    build_mirax_query_plan_from_job,
    extracted_to_lead_stub,
    prepare_agentic_extracted_item,
)
from agents.web_researcher import _heuristic_search_queries


HYPOTHESIS = {
    "offer": "Software lead generation e Sales Intelligence",
    "target_profile": ["PMI B2B italiane"],
    "buyer_pains": ["prospecting manuale"],
    "buying_signals": ["assunzione SDR/BDR con outbound"],
    "hiring_roles": ["Sales Development Representative", "Business Development Representative"],
    "decision_maker_roles": ["Head of Sales"],
    "disqualifiers": ["nessuna prova"],
}

RANKING = {
    "signal_match_mode": "any",
    "max_signal_age_days": 180,
    "require_concrete_evidence": True,
    "weights": {
        "intent_fit": 0.25,
        "signal_strength": 0.30,
        "recency": 0.20,
        "evidence_quality": 0.15,
        "contactability": 0.10,
    },
}


def test_query_plan_preserves_commercial_reasoning() -> None:
    plan = build_mirax_query_plan_from_job(
        {
            "required_signals": ["hiring"],
            "uqe_plan": {
                "sector": "PMI B2B con team commerciale in espansione",
                "location": "Italia",
                "commercial_hypothesis": HYPOTHESIS,
                "ranking_policy": RANKING,
                "extraction_schema": ["email", "linkedin", "decision_maker", "source_url"],
            },
        },
        "PMI B2B",
        "Italia",
        original_query="PMI calde per software lead generation",
    )
    assert plan["commercial_hypothesis"]["hiring_roles"][0] == "Sales Development Representative"
    assert plan["ranking_policy"]["signal_match_mode"] == "any"
    assert "decision_maker" in plan["extraction_schema"]
    assert "Sales Development Representative" in plan["hiring_roles"]


def test_any_signal_mode_and_hotness_scoring() -> None:
    item = {
        "name": "Acme Italia Srl",
        "website": "https://acme.example",
        "evidence": "Acme cerca un Sales Development Representative per outbound, prospecting e nuova pipeline.",
        "source_url": "https://jobs.example/acme-sdr",
        "evidence_date": datetime.now(timezone.utc).date().isoformat(),
        "hiring_title": "Sales Development Representative",
        "matched_signals": ["hiring"],
        "_required_signals": ["hiring", "expansion"],
        "_signal_match_mode": "any",
        "_ranking_policy": RANKING,
        "_commercial_hypothesis": HYPOTHESIS,
    }
    with patch(
        "agents.domain_resolver.resolve_company_identity",
        return_value={"url": "https://acme.example", "status": "verified", "confidence": 0.98},
    ):
        prepared = prepare_agentic_extracted_item(item, location="Italia")
    assert prepared is not None
    stub = extracted_to_lead_stub(prepared, category="PMI B2B", location="Italia")
    assert stub["query_match_status"] == "verified"
    assert stub["hotness_score"] >= 90
    assert stub["lead_temperature"] == "hot"
    assert stub["why_now"]
    assert "lead generation" in stub["pitch_angle"].lower()


def test_research_queries_target_observable_sales_signal() -> None:
    queries = _heuristic_search_queries(
        {
            "original_query": "PMI calde a cui vendere lead generation",
            "sector": "PMI B2B",
            "location": "Italia",
            "required_signals": ["hiring"],
            "commercial_hypothesis": HYPOTHESIS,
            "source_plan": [],
        }
    )
    joined = " ".join(queries).lower()
    assert "sales development representative" in joined
    assert "outbound" in joined or "pipeline" in joined
    assert all("-site:github.com" in query and "-site:medium.com" in query for query in queries)


if __name__ == "__main__":
    test_query_plan_preserves_commercial_reasoning()
    test_any_signal_mode_and_hotness_scoring()
    test_research_queries_target_observable_sales_signal()
    print("test_hot_lead_reasoning: 3/3 OK")
