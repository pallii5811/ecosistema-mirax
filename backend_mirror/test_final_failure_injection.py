import asyncio
import sys
import types
import os

import pytest

os.environ.setdefault("SUPABASE_URL", "https://validation.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "validation-only-not-a-secret")

import worker_supabase
from agents import data_extractor
from agents.web_researcher import WebResearcher
from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor
from url_safety import UnsafeUrlError, assert_safe_public_url


def test_neo4j_failure_cannot_undo_authoritative_postgres_publication(monkeypatch):
    failing = types.SimpleNamespace(
        is_neo4j_enabled=lambda: True,
        sync_leads_to_graph=lambda _rows: (_ for _ in ()).throw(RuntimeError("neo4j unavailable")),
    )
    monkeypatch.setitem(sys.modules, "universe_neo4j_sync", failing)
    # Sidecar failure is swallowed after authoritative Postgres publication.
    worker_supabase._sync_neo4j_leads_safe([{"azienda": "Valid Srl"}])
    assert worker_supabase._should_sync_graph_for_publish_status("completed") is True
    assert worker_supabase._should_sync_graph_for_publish_status("running") is False


def test_cost_database_failure_stops_next_paid_operation():
    class BrokenRpc:
        def rpc(self, *_args, **_kwargs):
            raise RuntimeError("database temporarily unavailable")

    governor = ResearchCostGovernor(21_000, 25_000, persistent_client=BrokenRpc(), search_id="search")
    with pytest.raises(ResearchBudgetExceeded, match="persistent cost reservation failed"):
        governor.reserve("paid-op", "web_search", 0.001)
    assert governor.committed_micro_eur == 0


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1", "http://169.254.169.254/latest/meta-data", "file:///tmp/a"],
)
def test_invalid_or_private_redirect_target_is_blocked(url):
    with pytest.raises(UnsafeUrlError):
        assert_safe_public_url(url)


def test_budget_exhaustion_is_preventive_not_reactive():
    governor = ResearchCostGovernor(20_000, 25_000)
    governor.reserve("first", "web_search", 0.02)
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("blocked-before-execution", "llm_extract", 0.006)
    assert governor.committed_micro_eur == 20_000


def test_source_timeout_returns_zero_candidates_without_crashing(monkeypatch):
    researcher = WebResearcher(
        {
            "original_query": "PMI con nuovi appalti",
            "required_signals": ["contract_awarded"],
            "source_plan": [{
                "lane": "public_procurement",
                "source_types": ["public_procurement_portal"],
                "expected_evidence": ["contract_awarded"],
                "query_templates": ["appalto aggiudicato PMI Italia"],
            }],
        },
        max_queries=3,
        max_urls_per_query=1,
    )

    async def queries():
        return ["q1", "q2", "q3"]

    async def timeout(_query):
        raise asyncio.TimeoutError("source timed out")

    monkeypatch.setattr(researcher, "generate_search_queries", queries)
    monkeypatch.setattr(researcher, "_discover_urls_for_query", timeout)
    assert asyncio.run(researcher.run()) == []
    assert researcher.search_queries_executed == 3
    assert researcher.pages_scheduled == 0


def test_malformed_llm_tool_payload_is_diagnostic_and_fail_closed(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "usage": {"input_tokens": 100, "output_tokens": 10},
                "content": [{
                    "type": "tool_use",
                    "name": data_extractor.TOOL_NAME,
                    "input": {"companies": "not-an-array"},
                }],
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(data_extractor.httpx, "AsyncClient", FakeClient)
    telemetry = {
        "anthropic_requests": 0,
        "provider_failures": 0,
        "input_tokens": 0,
        "output_tokens": 0,
    }
    result = asyncio.run(data_extractor._call_anthropic_extract(
        {"required_signals": ["contract_awarded"]},
        "https://anac.example/award",
        "Appalto aggiudicato ad Acme Srl.",
        0,
        1,
        telemetry,
    ))
    assert result is None
    assert telemetry["anthropic_requests"] == 1
    assert telemetry["provider_failures"] == 1


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": "A", "evidence": "evidenza valida abbastanza"},
        {"name": "Acme Srl", "evidence": "short"},
        {"name": "unknown", "evidence": "Appalto aggiudicato ad azienda ignota"},
    ],
)
def test_partial_or_invalid_extraction_payload_never_becomes_candidate(payload):
    assert data_extractor._sanitize_company(payload, "https://anac.example/award") is None
