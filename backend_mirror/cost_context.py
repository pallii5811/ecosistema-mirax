from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_current_governor: ContextVar[Any] = ContextVar("mirax_cost_governor", default=None)


def set_current_cost_governor(governor: Any) -> None:
    _current_governor.set(governor)


def current_cost_governor() -> Any:
    return _current_governor.get()
