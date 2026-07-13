import asyncio
import uuid

import pytest

from agents import data_extractor, web_researcher
from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor


def _governor() -> ResearchCostGovernor:
    return ResearchCostGovernor.from_plan(
        {"canonical_plan": {"budget_policy": {"target_cost_eur": 1.0, "hard_cost_eur": 1.25}}},
        50,
    )


def test_extract_reserves_before_provider_and_settles_usage(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    governor = _governor()
    observed = {"reserved_before_call": False}

    async def fake_provider(plan, source_url, chunk, chunk_index, chunk_total, telemetry=None):
        observed["reserved_before_call"] = any(
            item.operation == "llm_extract" and item.status == "reserved"
            for item in governor.reservations.values()
        )
        telemetry["anthropic_requests"] += 1
        telemetry["input_tokens"] += 1_000
        telemetry["output_tokens"] += 100
        return [{"name": "Acme Srl", "evidence": "Acme Srl sta assumendo un sales manager."}]

    monkeypatch.setattr(data_extractor, "_call_anthropic_extract", fake_provider)
    telemetry = {
        "openai_requests": 0,
        "anthropic_requests": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_hits": 0,
        "cache_misses": 0,
    }
    nonce = uuid.uuid4().hex
    result = asyncio.run(
        data_extractor._llm_extract_companies(
            {"required_signals": ["hiring"]},
            f"https://atomic-cost-test.example/jobs/{nonce}",
            f"Acme Srl sta assumendo un sales manager. unique-atomic-cost-test-{nonce}",
            0,
            1,
            telemetry=telemetry,
            cost_governor=governor,
        )
    )
    assert result
    assert observed["reserved_before_call"] is True
    operation = next(item for item in governor.reservations.values() if item.operation == "llm_extract")
    assert operation.status == "settled"
    assert operation.actual_micro_eur == 4_500


def test_extract_blocks_paid_provider_without_governor(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    called = {"value": False}

    async def should_not_run(*args, **kwargs):
        called["value"] = True
        return []

    monkeypatch.setattr(data_extractor, "_call_anthropic_extract", should_not_run)
    nonce = uuid.uuid4().hex
    with pytest.raises(ResearchBudgetExceeded, match="requires an atomic cost governor"):
        asyncio.run(
            data_extractor._llm_extract_companies(
                {"required_signals": ["hiring"]},
                f"https://no-governor-test.example/jobs/{nonce}",
                f"No Governor Srl sta assumendo. unique-no-governor-test-{nonce}",
                0,
                1,
                telemetry={"openai_requests": 0, "anthropic_requests": 0, "input_tokens": 0, "output_tokens": 0},
            )
        )
    assert called["value"] is False


def test_query_generation_reserves_settles_and_deduplicates(monkeypatch):
    monkeypatch.setenv("UQE_ANTHROPIC_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    governor = _governor()
    calls = {"count": 0, "reserved_before_call": False}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "usage": {"input_tokens": 1_000, "output_tokens": 100},
                "content": [
                    {
                        "type": "tool_use",
                        "name": "submit_search_queries",
                        "input": {"queries": ["acme hiring sales manager"] * 5},
                    }
                ],
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            calls["count"] += 1
            calls["reserved_before_call"] = any(
                item.operation == "llm_query_generation" and item.status == "reserved"
                for item in governor.reservations.values()
            )
            return FakeResponse()

    monkeypatch.setattr(web_researcher.httpx, "AsyncClient", FakeClient)
    plan = {"original_query": "imprese che assumono sales manager", "_discovery_round": 99}
    first = asyncio.run(web_researcher._call_anthropic_search_queries(plan, 5, governor))
    second = asyncio.run(web_researcher._call_anthropic_search_queries(plan, 5, governor))
    assert first
    assert second == []
    assert calls == {"count": 1, "reserved_before_call": True}
    operation = next(item for item in governor.reservations.values() if item.operation == "llm_query_generation")
    assert operation.status == "settled"
