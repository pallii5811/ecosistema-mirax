"""Central per-job marginal-cost governor using integer micro-EUR accounting."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


class ResearchBudgetExceeded(RuntimeError):
    code = "RESEARCH_HARD_BUDGET_EXCEEDED"


def _micro(eur: float) -> int:
    return max(0, int(round(float(eur) * 1_000_000)))


@dataclass
class CostReservation:
    key: str
    operation: str
    estimated_micro_eur: int
    actual_micro_eur: int | None = None
    status: str = "reserved"
    provider: Optional[str] = None
    model: Optional[str] = None
    cache_hit: bool = False


@dataclass
class ResearchCostGovernor:
    target_micro_eur: int
    hard_micro_eur: int
    reservations: Dict[str, CostReservation] = field(default_factory=dict)
    persistent_client: Any = field(default=None, repr=False)
    search_id: Optional[str] = None

    @classmethod
    def from_plan(
        cls,
        plan: Dict[str, Any],
        requested_leads: int,
        *,
        persistent_client: Any = None,
        search_id: Optional[str] = None,
    ) -> "ResearchCostGovernor":
        canonical = plan.get("canonical_plan") if isinstance(plan.get("canonical_plan"), dict) else {}
        policy = canonical.get("budget_policy") if isinstance(canonical.get("budget_policy"), dict) else {}
        target = float(policy.get("target_cost_eur") or max(1, requested_leads) * 0.021)
        hard = float(policy.get("hard_cost_eur") or max(1, requested_leads) * 0.025)
        governor = cls(_micro(target), _micro(hard))
        prior_cost = float(plan.get("_prior_cost_eur") or 0.0)
        if prior_cost > 0:
            governor.reserve("prior-resume-cost", "prior_job_operations", prior_cost)
        governor.persistent_client = persistent_client
        governor.search_id = str(search_id) if search_id else None
        if persistent_client is not None and search_id:
            persistent_client.rpc(
                "initialize_search_budget",
                {
                    "p_search_id": str(search_id),
                    "p_target_cost_eur": target,
                    "p_hard_cost_eur": hard,
                },
            ).execute()
            try:
                persistent_client.rpc(
                    "release_stale_search_costs", {"p_search_id": str(search_id)}
                ).execute()
            except Exception:
                # Stale cleanup is recovery hygiene; reservation itself remains fail-closed.
                pass
        return governor

    @property
    def committed_micro_eur(self) -> int:
        return sum(
            item.actual_micro_eur if item.actual_micro_eur is not None else item.estimated_micro_eur
            for item in self.reservations.values()
            if item.status not in {"released", "failed"}
        )

    @property
    def remaining_eur(self) -> float:
        return max(0, self.hard_micro_eur - self.committed_micro_eur) / 1_000_000

    @property
    def strategy(self) -> str:
        if self.committed_micro_eur >= self.hard_micro_eur:
            return "hard_stop"
        if self.committed_micro_eur >= self.target_micro_eur:
            return "economy"
        return "normal"

    def reserve(
        self,
        key: str,
        operation: str,
        estimated_eur: float,
        *,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        source_class: Optional[str] = None,
        candidate_id: Optional[str] = None,
        units: float = 1.0,
        cache_hit: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CostReservation:
        if key in self.reservations:
            return self.reservations[key]
        amount = _micro(estimated_eur)
        if self.committed_micro_eur + amount > self.hard_micro_eur:
            raise ResearchBudgetExceeded(f"{operation} would exceed hard budget")
        persistent_row: Dict[str, Any] = {}
        if self.persistent_client is not None and self.search_id:
            try:
                response = self.persistent_client.rpc(
                    "reserve_search_cost",
                    {
                        "p_search_id": self.search_id,
                        "p_idempotency_key": key,
                        "p_operation_type": operation,
                        "p_estimated_cost_eur": amount / 1_000_000,
                        "p_provider": provider,
                        "p_model": model,
                        "p_source_class": source_class,
                        "p_candidate_id": candidate_id,
                        "p_units": max(0.0, float(units)),
                        "p_cache_hit": bool(cache_hit),
                        "p_metadata": {
                            "runtime": "python_worker",
                            **(metadata or {}),
                        },
                    },
                ).execute()
                if getattr(response, "data", None) is None:
                    raise ResearchBudgetExceeded("persistent reservation returned no ledger row")
                if isinstance(response.data, dict):
                    persistent_row = response.data
            except Exception as exc:
                if "RESEARCH_HARD_BUDGET_EXCEEDED" in str(exc) or "SEARCH_BUDGET_HALTED" in str(exc):
                    raise ResearchBudgetExceeded(str(exc)) from exc
                raise ResearchBudgetExceeded(f"persistent cost reservation failed: {exc}") from exc
        persisted_status = str(persistent_row.get("status") or "reserved")
        persisted_actual = persistent_row.get("actual_cost_eur")
        item = CostReservation(
            key,
            operation,
            _micro(persistent_row.get("estimated_cost_eur") or amount / 1_000_000),
            actual_micro_eur=(
                _micro(persisted_actual) if persisted_actual is not None else None
            ),
            status=persisted_status,
            provider=provider,
            model=model,
            cache_hit=bool(cache_hit),
        )
        self.reservations[key] = item
        return item

    def settle(
        self,
        key: str,
        actual_eur: float,
        *,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CostReservation:
        item = self.reservations.get(key)
        if item is None:
            raise ResearchBudgetExceeded("cost settlement has no matching reservation")
        if item.status == "settled":
            return item
        if item.status != "reserved":
            raise ResearchBudgetExceeded(f"cost reservation is not settleable: {item.status}")
        amount = _micro(actual_eur)
        if self.persistent_client is not None and self.search_id:
            try:
                response = self.persistent_client.rpc(
                    "settle_search_cost",
                    {
                        "p_search_id": self.search_id,
                        "p_idempotency_key": key,
                        "p_actual_cost_eur": amount / 1_000_000,
                        "p_metadata": {
                            "runtime": "python_worker",
                            **(metadata or {}),
                        },
                    },
                ).execute()
                if getattr(response, "data", None) is None:
                    raise RuntimeError("persistent settlement returned no ledger row")
            except Exception as exc:
                # The provider may already have charged the request. Stop all
                # subsequent paid work rather than silently losing the debit.
                raise ResearchBudgetExceeded(f"persistent cost settlement failed: {exc}") from exc
        item.actual_micro_eur = amount
        item.status = "settled"
        if self.committed_micro_eur > self.hard_micro_eur:
            raise ResearchBudgetExceeded("actual cost exceeded hard budget; paid work halted")
        return item

    def release(self, key: str, *, failed: bool = False, error_code: Optional[str] = None) -> None:
        item = self.reservations.get(key)
        if item is None or item.status in {"released", "failed", "settled"}:
            return
        status = "failed" if failed else "released"
        if self.persistent_client is not None and self.search_id:
            try:
                response = self.persistent_client.rpc(
                    "release_search_cost",
                    {
                        "p_search_id": self.search_id,
                        "p_idempotency_key": key,
                        "p_status": status,
                        "p_error_code": error_code,
                    },
                ).execute()
                if getattr(response, "data", None) is None:
                    raise RuntimeError("persistent release returned no ledger row")
            except Exception as exc:
                raise ResearchBudgetExceeded(f"persistent cost release failed: {exc}") from exc
        item.status = status

    def snapshot(self) -> Dict[str, Any]:
        return {
            "target_cost_eur": self.target_micro_eur / 1_000_000,
            "hard_cost_eur": self.hard_micro_eur / 1_000_000,
            "committed_cost_eur": self.committed_micro_eur / 1_000_000,
            "remaining_cost_eur": self.remaining_eur,
            "strategy": self.strategy,
            "operation_count": len(self.reservations),
            "operations": [
                {
                    "idempotency_key": item.key,
                    "operation_type": item.operation,
                    "estimated_cost_eur": item.estimated_micro_eur / 1_000_000,
                    "actual_cost_eur": (
                        item.actual_micro_eur / 1_000_000 if item.actual_micro_eur is not None else None
                    ),
                    "status": item.status,
                    "provider": item.provider,
                    "model": item.model,
                    "cache_hit": item.cache_hit,
                }
                for item in self.reservations.values()
            ],
        }
