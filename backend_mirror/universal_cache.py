"""
MIRAX v5 — In-memory TTL cache for external enrichment queries.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any, Dict, List, Optional


class UniversalCache:
    def __init__(self, ttl_seconds: int = 3600) -> None:
        self.ttl = ttl_seconds
        self._memory: Dict[str, Any] = {}
        self._timestamps: Dict[str, float] = {}

    def _key(self, source: str, query: str) -> str:
        digest = hashlib.md5(query.lower().strip().encode()).hexdigest()
        return f"{source}:{digest}"

    def get(self, source: str, query: str) -> Optional[Any]:
        key = self._key(source, query)
        if key not in self._memory:
            return None
        if time.time() - self._timestamps[key] > self.ttl:
            del self._memory[key]
            del self._timestamps[key]
            return None
        return self._memory[key]

    def set(self, source: str, query: str, value: Any) -> None:
        key = self._key(source, query)
        self._memory[key] = value
        self._timestamps[key] = time.time()

    def invalidate_source(self, source: str) -> None:
        prefix = f"{source}:"
        to_delete = [k for k in self._memory if k.startswith(prefix)]
        for k in to_delete:
            del self._memory[k]
            del self._timestamps[k]


_default_cache: Optional[UniversalCache] = None


def get_universal_cache() -> UniversalCache:
    global _default_cache
    if _default_cache is None:
        ttl = 3600
        try:
            import os

            ttl = int(os.getenv("MIRAX_CACHE_TTL_SECONDS", "3600"))
        except ValueError:
            pass
        _default_cache = UniversalCache(ttl_seconds=ttl)
    return _default_cache
