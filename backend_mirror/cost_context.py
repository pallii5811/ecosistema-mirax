from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Any

_current_governor: ContextVar[Any] = ContextVar("mirax_cost_governor", default=None)


def set_current_cost_governor(governor: Any) -> Token[Any]:
    return _current_governor.set(governor)


def reset_current_cost_governor(token: Token[Any]) -> None:
    _current_governor.reset(token)


def current_cost_governor() -> Any:
    return _current_governor.get()
