from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Mapping

from backend_mirror.semantic_intelligence import (
    AnthropicSemanticModel,
    CallableSemanticModel,
    SemanticCommercialEventInterpreter,
    SemanticCommercialQueryInterpreter,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
    SemanticResultCache,
)
from backend_mirror.cost_context import reset_current_cost_governor, set_current_cost_governor
from backend_mirror.cost_governor import ResearchBudgetExceeded, ResearchCostGovernor


def query_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query_goal": "Find operating companies that recently received new financial resources",
        "seller": {"description": "B2B seller"},
        "offer": {"description": "growth software"},
        "target_entity_types": ["operating_company"],
        "target_company_description": "Italian operating companies receiving fresh capital",
        "event_or_state_description": "new capital or financing was received by the target company",
        "target_role_in_event": "recipient",
        "required_relationships": ["capital_or_financing_received_by_target_company"],
        "optional_relationships": ["resources_used_for_expansion"],
        "excluded_roles": ["lender", "provider", "investor", "publisher", "authority", "advisor"],
        "excluded_entities": ["banks acting only as lenders", "news publishers"],
        "geography": ["Italia"],
        "industry": [],
        "size_constraints": {"preferred": ["micro", "small", "medium"]},
        "temporal_constraints": {"maximum_age_days": 180},
        "positive_conditions": ["the company actually received resources"],
        "negative_conditions": ["the company merely offers credit"],
        "must_have_facts": ["recipient company", "event date", "literal evidence"],
        "forbidden_inferences": ["publisher is target", "provider is recipient"],
        "data_requirements": ["official_domain", "source_url", "event_date"],
        "ranking_objective": "freshest grounded recipient first",
        "acceptance_rubric": ["target_is_recipient", "resources_are_real", "event_is_recent"],
        "discovery_hypotheses": [{"source_classes": ["recognized_news"], "query": "new resources Italy"}],
        "clarification_required": False,
        "confidence": 0.96,
        "canonical_signal_hints": ["funding"],
    }
    payload.update(overrides)
    return payload


def event_payload(text: str, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "entities": [{"name": "Beta Srl", "type": "operating_company", "role": "recipient"}],
        "events": [{"type": "capital_received", "status": "completed"}],
        "relations": [{"subject": "Beta Srl", "predicate": "received", "object": "eight million euro"}],
        "target_company": "Beta Srl",
        "target_entity_role": "recipient",
        "event_type": "capital_received",
        "open_predicate": "new resources allocated to target company",
        "actor": None,
        "recipient": "Beta Srl",
        "provider": None,
        "beneficiary": "Beta Srl",
        "investor": None,
        "employer": None,
        "recruiter": None,
        "publisher": "Economia Oggi",
        "authority": None,
        "predicate": "capital_or_financing_received_by_target_company",
        "direction": "provider_to_recipient",
        "event_status": "completed",
        "event_date": "2026-07-10",
        "amount": "otto milioni",
        "location": "Italia",
        "technology": None,
        "role": None,
        "negated": False,
        "hypothetical": False,
        "conditional": False,
        "rumor": False,
        "historical": False,
        "certainty": 0.97,
        "query_match": True,
        "query_match_reason": "Beta is explicitly the recipient",
        "satisfied_relationships": ["capital_or_financing_received_by_target_company"],
        "acceptance_rubric_passed": ["target_is_recipient", "resources_are_real", "event_is_recent"],
        "buyer_need": "capacity expansion",
        "why_now": "fresh capital is available for expansion",
        "evidence_excerpt": text,
        "evidence_start": 0,
        "evidence_end": len(text),
        "confidence": 0.95,
        "rejection_reason": None,
    }
    payload.update(overrides)
    return payload


class QueueModel:
    model_version = "offline-semantic-model-v1"

    def __init__(self, *responses: Mapping[str, Any]) -> None:
        self.responses = list(responses)
        self.calls = 0
        self.requests: list[dict[str, Any]] = []

    async def complete_json(self, **kwargs: Any) -> Mapping[str, Any]:
        self.calls += 1
        self.requests.append(dict(kwargs))
        return self.responses.pop(0)


def cache(tmp_path: Path) -> SemanticResultCache:
    return SemanticResultCache(str(tmp_path / "semantic.sqlite"))


def test_query_interpreter_preserves_open_world_predicate_and_roles(tmp_path: Path) -> None:
    model = QueueModel(query_payload(
        event_or_state_description="Nuove risorse sono state destinate all'azienda, qualunque sia il lessico usato",
        required_relationships=["new_resources_destination_is_target_company"],
        canonical_signal_hints=[],
    ))
    interpreter = SemanticCommercialQueryInterpreter(model, cache=cache(tmp_path))
    contract = asyncio.run(interpreter.interpret(
        "Trova imprese a cui sono state destinate nuove risorse", 25,
    ))
    assert contract.required_relationships == ("new_resources_destination_is_target_company",)
    assert contract.target_role_in_event == "recipient"
    assert contract.canonical_signal_hints == ()
    assert model.calls == 1
    assert model.requests[0]["tier"] == 2


def test_event_interpretation_remains_on_economical_tier_one(tmp_path: Path) -> None:
    text = "Beta Srl ha ricevuto nuove risorse il 10 luglio 2026."
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="Trova aziende finanziate", requested_count=5,
    )
    model = QueueModel(event_payload(text))

    asyncio.run(SemanticCommercialEventInterpreter(model, cache=cache(tmp_path)).interpret(
        contract, title="Risorse per Beta", snippet=text, source_text=text,
        source_url="https://example.test/evento", publisher="Editore",
    ))

    assert model.requests[0]["tier"] == 1


def test_query_contract_cache_uses_query_model_and_schema(tmp_path: Path) -> None:
    model = QueueModel(query_payload())
    interpreter = SemanticCommercialQueryInterpreter(model, cache=cache(tmp_path))
    one = asyncio.run(interpreter.interpret("Aziende che hanno ricevuto finanziamenti", 5))
    two = asyncio.run(interpreter.interpret("Aziende che hanno ricevuto finanziamenti", 5))
    assert one == two
    assert model.calls == 1
    assert interpreter.telemetry.semantic_cache_hits == 1


def test_passive_recipient_is_grounded_without_keyword_authority(tmp_path: Path) -> None:
    text = "Il 10 luglio 2026, a Beta Srl sono stati destinati otto milioni per ampliare lo stabilimento."
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="aziende che hanno ottenuto nuove risorse", requested_count=5,
    )
    model = QueueModel(event_payload(text))
    interpretation = asyncio.run(SemanticCommercialEventInterpreter(model, cache=cache(tmp_path)).interpret(
        contract, title="Risorse per Beta", snippet=text, source_text=text,
        source_url="https://economia.example/beta", publisher="Economia Oggi",
    ))
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract, interpretation, source_text=text,
        source_url="https://economia.example/beta", source_publisher="Economia Oggi",
        official_domain_verified=True, official_domain_confidence=0.91,
        entity_class="operating_company", candidate_company="Beta Srl",
        maximum_age_days=30,
    )
    assert verdict.accepted is True
    assert verdict.rejection_code is None


def test_grounder_derives_exact_offsets_for_unique_literal_excerpt(tmp_path: Path) -> None:
    excerpt = "Beta Srl ha ricevuto nuove risorse."
    text = f"Prefisso. {excerpt} Suffisso."
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="Trova aziende finanziate", requested_count=5,
    )
    raw = event_payload(
        excerpt, target_company="Beta Srl", recipient="Beta Srl",
        evidence_start=0, evidence_end=len(excerpt),
    )
    interpretation = asyncio.run(SemanticCommercialEventInterpreter(
        QueueModel(raw), cache=cache(tmp_path),
    ).interpret(
        contract, title="Risorse per Beta", snippet=excerpt, source_text=text,
        source_url="https://example.test/evento", publisher="Editore",
    ))
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract, interpretation, source_text=text,
        source_url="https://example.test/evento", source_publisher="Editore",
        official_domain_verified=True, official_domain_confidence=0.95,
        entity_class="operating_company", candidate_company="Beta Srl",
        maximum_age_days=3650,
    )
    assert verdict.accepted is True
    assert verdict.evidence_start == text.index(excerpt)
    assert verdict.evidence_end == text.index(excerpt) + len(excerpt)


def test_grounder_rejects_ambiguous_repeated_excerpt_with_wrong_offsets(tmp_path: Path) -> None:
    excerpt = "Beta Srl ha ricevuto nuove risorse."
    text = f"{excerpt} {excerpt}"
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="Trova aziende finanziate", requested_count=5,
    )
    raw = event_payload(
        excerpt, target_company="Beta Srl", recipient="Beta Srl",
        evidence_start=1, evidence_end=len(excerpt) + 1,
    )
    interpretation = asyncio.run(SemanticCommercialEventInterpreter(
        QueueModel(raw), cache=cache(tmp_path),
    ).interpret(
        contract, title="Risorse per Beta", snippet=excerpt, source_text=text,
        source_url="https://example.test/evento", publisher="Editore",
    ))
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract, interpretation, source_text=text,
        source_url="https://example.test/evento", source_publisher="Editore",
        official_domain_verified=True, official_domain_confidence=0.95,
        entity_class="operating_company", candidate_company="Beta Srl",
        maximum_age_days=3650,
    )
    assert verdict.accepted is False
    assert verdict.rejection_code == "EVIDENCE_GROUNDING_FAILED"


def test_grounder_accepts_descriptive_role_when_required_relation_is_grounded(tmp_path: Path) -> None:
    text = "Beta Srl ha ricevuto nuove risorse il 10 luglio 2026."
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="Trova aziende finanziate", requested_count=5,
    )
    raw = event_payload(
        text,
        target_entity_role="Recipient of funding or resources for growth",
        event_status="occurred",
        relations=[{
            "subject": "Beta Srl",
            "predicate": "capital_or_financing_received_by_target_company",
            "object": "new resources",
        }],
    )
    interpretation = asyncio.run(SemanticCommercialEventInterpreter(
        QueueModel(raw), cache=cache(tmp_path),
    ).interpret(
        contract, title="Risorse per Beta", snippet=text, source_text=text,
        source_url="https://example.test/evento", publisher="Editore",
    ))
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract, interpretation, source_text=text,
        source_url="https://example.test/evento", source_publisher="Editore",
        official_domain_verified=True, official_domain_confidence=0.95,
        entity_class="operating_company", candidate_company="Beta Srl",
        maximum_age_days=3650,
    )
    assert verdict.accepted is True


def test_financing_provider_is_not_recipient(tmp_path: Path) -> None:
    text = "Gamma Banca mette a disposizione credito per le imprese italiane."
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="aziende che hanno ricevuto finanziamenti", requested_count=5,
    )
    model = QueueModel(event_payload(
        text,
        entities=[{"name": "Gamma Banca", "type": "operating_company", "role": "provider"}],
        target_company="Gamma Banca", target_entity_role="provider", recipient=None,
        provider="Gamma Banca", beneficiary=None, event_type="credit_offered",
        open_predicate="credit offered to other companies", direction="provider_to_unknown_recipients",
        query_match=False, query_match_reason="Gamma provides rather than receives financing",
        satisfied_relationships=[], acceptance_rubric_passed=[],
        rejection_reason="target has an excluded inverse role",
    ))
    interpretation = asyncio.run(SemanticCommercialEventInterpreter(model, cache=cache(tmp_path)).interpret(
        contract, title="Credito alle imprese", snippet=text, source_text=text,
        source_url="https://news.example/gamma", publisher="News Example",
    ))
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract, interpretation, source_text=text,
        source_url="https://news.example/gamma", source_publisher="News Example",
        official_domain_verified=True, official_domain_confidence=0.90,
        entity_class="operating_company", candidate_company="Gamma Banca",
    )
    assert verdict.accepted is False
    assert verdict.rejection_code == "TARGET_ROLE_UNVERIFIED"


def test_negation_hypothesis_fail_closed_after_safe_offset_recovery(tmp_path: Path) -> None:
    text = "Delta potrebbe ricevere capitale, ma il round non e stato concluso."
    contract = SemanticQueryContract.from_model(
        query_payload(), original_query="aziende che hanno ricevuto capitale", requested_count=5,
    )
    raw = event_payload(
        text, target_company="Delta", recipient="Delta", hypothetical=True, negated=True,
        query_match=False, event_status="hypothetical", evidence_start=1,
        evidence_end=len(text) + 1, rejection_reason="hypothetical and explicitly not completed",
    )
    interpretation = asyncio.run(SemanticCommercialEventInterpreter(QueueModel(raw), cache=cache(tmp_path)).interpret(
        contract, title="Possibile round", snippet=text, source_text=text,
        source_url="https://news.example/delta", publisher="News Example",
    ))
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract, interpretation, source_text=text,
        source_url="https://news.example/delta", source_publisher="News Example",
        official_domain_verified=True, official_domain_confidence=0.90,
        entity_class="operating_company", candidate_company="Delta",
    )
    assert verdict.accepted is False
    assert verdict.rejection_code == "SEMANTIC_QUERY_MISMATCH"


def test_callable_model_rejects_non_object() -> None:
    async def callback(**_: Any) -> Any:
        return []

    model = CallableSemanticModel(callback, "bad-model")
    try:
        asyncio.run(model.complete_json())
    except ValueError as exc:
        assert "non-object" in str(exc)
    else:
        raise AssertionError("non-object model response must fail closed")


def test_semantic_provider_call_is_blocked_before_network_when_unaffordable(monkeypatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-key")
    governor = ResearchCostGovernor(target_micro_eur=1, hard_micro_eur=1)
    token = set_current_cost_governor(governor)
    try:
        model = AnthropicSemanticModel()
        try:
            asyncio.run(model.complete_json(
                task="semantic_query_contract", system_prompt="ground exactly",
                payload={"query": "open world commercial event"},
                schema={"type": "object", "properties": {}}, tier=1,
            ))
        except ResearchBudgetExceeded:
            pass
        else:
            raise AssertionError("unaffordable semantic call must fail before provider execution")
        assert governor.reservations == {}
    finally:
        reset_current_cost_governor(token)


def test_truncated_provider_output_is_charged_and_not_returned(monkeypatch) -> None:
    import sys
    from types import SimpleNamespace

    bodies: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "stop_reason": "max_tokens",
                "usage": {"input_tokens": 100, "output_tokens": 2000},
                "content": [{"type": "tool_use", "name": "submit_semantic_result", "input": {}}],
            }

    class FakeClient:
        def __init__(self, **_: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_: Any) -> None:
            return None

        async def post(self, _url: str, **kwargs: Any) -> FakeResponse:
            bodies.append(kwargs["json"])
            return FakeResponse()

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-key")
    monkeypatch.delenv("MIRAX_SEMANTIC_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("MIRAX_SEMANTIC_EVENT_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.setitem(sys.modules, "httpx", SimpleNamespace(AsyncClient=FakeClient))
    governor = ResearchCostGovernor(target_micro_eur=100_000, hard_micro_eur=100_000)
    token = set_current_cost_governor(governor)
    try:
        model = AnthropicSemanticModel()
        try:
            asyncio.run(model.complete_json(
                task="semantic_commercial_event", system_prompt="ground exactly",
                payload={"source_text": "Beta grows"},
                schema={"type": "object", "properties": {}}, tier=1,
            ))
        except ValueError as exc:
            assert str(exc) == "SEMANTIC_OUTPUT_TRUNCATED"
        else:
            raise AssertionError("truncated tool output must fail closed")
        assert bodies[0]["max_tokens"] == 2000
        assert governor.committed_micro_eur == 10_100
        assert next(iter(governor.reservations.values())).status == "settled"
    finally:
        reset_current_cost_governor(token)


def test_tier_one_actual_cost_uses_economy_rates() -> None:
    assert AnthropicSemanticModel._actual_cost(1_000_000, 1_000_000, tier=1) == 6.0
    assert AnthropicSemanticModel._actual_cost(1_000_000, 1_000_000, tier=2) == 18.0
