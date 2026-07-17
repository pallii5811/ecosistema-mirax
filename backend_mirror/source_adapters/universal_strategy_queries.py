"""Shared helper: inject universal strategy queries into adapter search lists."""

from __future__ import annotations

from typing import List, Mapping, Sequence, Tuple

from .signal_strategy_planner import DiscoveryStrategy


def universal_strategy_queries_from_filters(
    technical_filters: Mapping[str, object] | None,
    *,
    signal_ids: Sequence[str] = (),
    max_queries: int = 8,
) -> Tuple[str, ...]:
    """Read strategies written by UniversalSignalDiscoveryEngine into technical_filters."""
    filters = technical_filters or {}
    active = filters.get("universal_active_strategies") or filters.get("universal_strategies") or ()
    queries: List[str] = []
    wanted = {str(item).strip() for item in signal_ids if str(item).strip()}
    for item in active:
        if isinstance(item, DiscoveryStrategy):
            signal = item.signal_type
            query = item.search_query
        elif isinstance(item, Mapping):
            signal = str(item.get("signal_type") or "")
            query = str(item.get("search_query") or "").strip()
        else:
            continue
        if wanted and signal and signal not in wanted:
            continue
        if query and query not in queries:
            queries.append(query)
        if len(queries) >= max_queries:
            break
    # Also accept a flat list of search strings.
    for query in filters.get("universal_search_queries") or ():
        text = str(query or "").strip()
        if text and text not in queries:
            queries.append(text)
        if len(queries) >= max_queries:
            break
    return tuple(queries)
