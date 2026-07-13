import sys
import types
import os

import pytest

os.environ.setdefault("SUPABASE_URL", "https://validation.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "validation-only-not-a-secret")

import worker_supabase
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
