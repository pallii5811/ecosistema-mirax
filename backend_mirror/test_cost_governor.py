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

def test_settle_clamps_actual_so_committed_never_exceeds_hard_cap():
    # S1 regression: actual>estimate must not push committed above hard (0.0656 class).
    governor = ResearchCostGovernor.from_plan(
        {"canonical_plan": {"budget_policy": {"target_cost_eur": 0.042, "hard_cost_eur": 0.05}}},
        2,
    )
    governor.reserve("compile", "intent_compilation", 0.005)
    governor.settle("compile", 0.005)
    governor.reserve("search:1", "search_web", 0.02)
    governor.settle("search:1", 0.02)
    governor.reserve("search:2", "search_web", 0.02)
    with pytest.raises(ResearchBudgetExceeded, match="partial_budget_exhausted"):
        governor.settle("search:2", 0.0306)  # would have made 0.0556 historically
    assert governor.snapshot()["committed_cost_eur"] <= 0.05 + 1e-9
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("search:3", "web_search", 0.005)


def test_sequential_remaining_budget_blocks_next_paid_operation():
    governor = ResearchCostGovernor.from_plan(
        {"canonical_plan": {"budget_policy": {"target_cost_eur": 0.04, "hard_cost_eur": 0.05}}},
        2,
    )
    governor.reserve("a", "web_search", 0.03)
    governor.settle("a", 0.03)
    governor.reserve("b", "web_search", 0.02)
    assert governor.remaining_eur == pytest.approx(0.0)
    with pytest.raises(ResearchBudgetExceeded):
        governor.reserve("c", "open_page", 0.0001)


def test_concurrent_style_reserve_only_one_fits_remaining():
    governor = ResearchCostGovernor.from_plan(
        {"canonical_plan": {"budget_policy": {"target_cost_eur": 0.04, "hard_cost_eur": 0.05}}},
        2,
    )
    governor.reserve("seed", "web_search", 0.045)
    governor.settle("seed", 0.045)
    winners = []
    for key in ("x", "y", "z"):
        try:
            governor.reserve(key, "web_search", 0.005)
            winners.append(key)
        except ResearchBudgetExceeded:
            pass
    assert len(winners) == 1
    assert governor.snapshot()["committed_cost_eur"] <= 0.05 + 1e-9
