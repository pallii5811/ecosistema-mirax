import pytest

from cost_governor import ResearchBudgetExceeded, ResearchCostGovernor


def test_governor_is_idempotent_and_stops_before_hard_cap():
    governor = ResearchCostGovernor.from_plan({}, 1)
    governor.reserve("search:1", "search_web", 0.005)
    governor.reserve("search:1", "search_web", 0.005)
    assert governor.snapshot()["committed_cost_eur"] == 0.005
    governor.reserve("crawl:1", "open_page", 0.016)
    assert governor.strategy == "economy"
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("llm:1", "llm", 0.005)
    assert governor.snapshot()["committed_cost_eur"] <= 0.025


def test_governor_uses_canonical_budget():
    plan = {"canonical_plan": {"budget_policy": {"target_cost_eur": 1.0, "hard_cost_eur": 1.25}}}
    governor = ResearchCostGovernor.from_plan(plan, 100)
    assert governor.snapshot()["hard_cost_eur"] == 1.25
    governor.reserve("batch", "search_web", 1.24)
    assert governor.remaining_eur == pytest.approx(0.01)


def test_governor_carries_prior_resume_cost():
    governor = ResearchCostGovernor.from_plan({"_prior_cost_eur": 0.02}, 1)
    assert governor.snapshot()["committed_cost_eur"] == 0.02
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("next", "search_web", 0.006)


def test_governor_persistent_resume_seeds_settled_prior_cost_without_rpc_reserve():
    class _RpcResult:
        data = {"id": "ledger-row"}

        def execute(self):
            return self

    class _PersistentClient:
        def __init__(self):
            self.calls = []

        def rpc(self, name, payload):
            self.calls.append(name)
            return _RpcResult()

    client = _PersistentClient()
    governor = ResearchCostGovernor.from_plan(
        {"_prior_cost_eur": 0.125},
        5,
        persistent_client=client,
        search_id="00000000-0000-0000-0000-000000000001",
    )
    assert governor.snapshot()["committed_cost_eur"] == pytest.approx(0.125)
    assert "reserve_search_cost" not in client.calls
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("search:next", "web_search", 0.005)


class _RpcResult:
    data = {"id": "ledger-row"}

    def execute(self):
        return self


class _PersistentClient:
    def __init__(self):
        self.calls = []

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        return _RpcResult()


def test_governor_uses_persistent_atomic_reservation():
    client = _PersistentClient()
    governor = ResearchCostGovernor.from_plan(
        {}, 10, persistent_client=client, search_id="00000000-0000-0000-0000-000000000001"
    )
    governor.reserve("search:round:1", "web_search", 0.01)
    names = [name for name, _ in client.calls]
    assert names[:2] == ["initialize_search_budget", "release_stale_search_costs"]
    assert names[-1] == "reserve_search_cost"
    assert client.calls[-1][1]["p_idempotency_key"] == "search:round:1"


def test_governor_fails_closed_when_persistent_reservation_fails():
    class FailingClient(_PersistentClient):
        def rpc(self, name, payload):
            if name == "reserve_search_cost":
                raise RuntimeError("database unavailable")
            return super().rpc(name, payload)

    governor = ResearchCostGovernor.from_plan(
        {}, 10, persistent_client=FailingClient(), search_id="00000000-0000-0000-0000-000000000001"
    )
    with pytest.raises(ResearchBudgetExceeded, match="persistent cost reservation failed"):
        governor.reserve("search:round:1", "web_search", 0.01)
    assert governor.snapshot()["committed_cost_eur"] == 0
