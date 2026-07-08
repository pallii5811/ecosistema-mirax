"""Persistent, process-safe cache for expensive page extraction results."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Dict, List, Optional


def _default_path() -> str:
    configured = os.getenv("AGENTIC_EXTRACTION_CACHE_DB")
    if configured:
        return configured
    data_dir = os.getenv("MIRAX_DATA_DIR")
    if not data_dir:
        data_dir = str(Path(__file__).resolve().parent.parent / "data")
    return str(Path(data_dir) / "agentic_extraction_cache.db")


class ExtractionCache:
    def __init__(self, path: Optional[str] = None, ttl_days: int = 30) -> None:
        self.path = path or _default_path()
        self.ttl_seconds = max(1, ttl_days) * 86_400
        self._lock = threading.Lock()
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _initialize(self) -> None:
        with self._lock, closing(self._connect()) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS extraction_cache (
                    cache_key TEXT PRIMARY KEY,
                    result_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    last_hit_at REAL NOT NULL,
                    hit_count INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS extraction_cache_created_idx ON extraction_cache(created_at)"
            )
            connection.commit()

    @staticmethod
    def key(plan: Dict[str, Any], source_url: str, chunk: str) -> str:
        plan_signature = {
            "sector": plan.get("sector"),
            "location": plan.get("location"),
            "required_signals": sorted(str(x) for x in plan.get("required_signals") or []),
            "extraction_schema": sorted(str(x) for x in plan.get("extraction_schema") or []),
            "commercial_hypothesis": plan.get("commercial_hypothesis") or {},
            "ranking_policy": plan.get("ranking_policy") or {},
            "research_questions": plan.get("research_questions") or [],
            "expected_evidence": [
                evidence
                for lane in plan.get("source_plan") or []
                if isinstance(lane, dict)
                for evidence in lane.get("expected_evidence") or []
            ],
        }
        payload = json.dumps(plan_signature, sort_keys=True, ensure_ascii=False)
        raw = f"{source_url.strip().lower()}\n{payload}\n{chunk}".encode("utf-8", errors="ignore")
        return hashlib.sha256(raw).hexdigest()

    def get(self, cache_key: str) -> Optional[List[Dict[str, Any]]]:
        cutoff = time.time() - self.ttl_seconds
        with self._lock, closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT result_json, created_at FROM extraction_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            if not row:
                return None
            if float(row[1]) < cutoff:
                connection.execute("DELETE FROM extraction_cache WHERE cache_key = ?", (cache_key,))
                connection.commit()
                return None
            connection.execute(
                "UPDATE extraction_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE cache_key = ?",
                (time.time(), cache_key),
            )
            connection.commit()
        try:
            value = json.loads(str(row[0]))
            return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else None
        except json.JSONDecodeError:
            return None

    def set(self, cache_key: str, result: List[Dict[str, Any]]) -> None:
        serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        now = time.time()
        with self._lock, closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO extraction_cache(cache_key, result_json, created_at, last_hit_at, hit_count)
                VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(cache_key) DO UPDATE SET
                    result_json = excluded.result_json,
                    created_at = excluded.created_at,
                    last_hit_at = excluded.last_hit_at
                """,
                (cache_key, serialized, now, now),
            )
            connection.commit()


_default_cache: Optional[ExtractionCache] = None
_default_lock = threading.Lock()


def get_extraction_cache() -> ExtractionCache:
    global _default_cache
    if _default_cache is None:
        with _default_lock:
            if _default_cache is None:
                ttl = int(os.getenv("AGENTIC_EXTRACTION_CACHE_TTL_DAYS", "30") or "30")
                _default_cache = ExtractionCache(ttl_days=ttl)
    return _default_cache
