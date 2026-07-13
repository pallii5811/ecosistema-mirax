"""Plan-driven audit modules with domain/module/freshness caching."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from contextlib import closing
from typing import Any, Dict, Iterable, List, Set
from urllib.parse import urlparse

AUDIT_CACHE_VERSION = "adaptive-audit-v1"
MODULE_TTL_SECONDS = {
    "identity": 7 * 86400,
    "contacts": 3 * 86400,
    "social_profiles": 3 * 86400,
    "technology": 86400,
    "commercial_signals": 12 * 3600,
    "performance": 12 * 3600,
}


def adaptive_modules(audit_policy: Dict[str, Any] | None, lead: Dict[str, Any]) -> Set[str]:
    policy = audit_policy if isinstance(audit_policy, dict) else {}
    requested = {str(item).strip().lower() for item in policy.get("modules") or [] if str(item).strip()}
    modules: Set[str] = {"identity"}
    if policy.get("collect_contacts", True):
        modules.add("contacts")
    if policy.get("collect_social_profiles", True):
        modules.add("social_profiles")
    if policy.get("detect_technologies", True) or requested.intersection({"technology", "tech_stack", "seo"}):
        modules.update({"technology", "performance"})
    if policy.get("detect_commercial_signals", True) or requested.intersection({"signals", "ads", "commercial"}):
        modules.add("commercial_signals")
    if not lead.get("email") and not lead.get("telefono"):
        modules.add("contacts")
    return modules


def module_payload(module: str, audit: Dict[str, Any]) -> Dict[str, Any]:
    keys = {
        "identity": {"nome", "sito", "indirizzo", "citta", "categoria"},
        "contacts": {"telefono", "email"},
        "social_profiles": {"instagram", "facebook", "linkedin", "instagram_missing"},
        "technology": {"tech_stack", "seo_errors", "has_pixel", "has_gtm", "has_google_ads"},
        "commercial_signals": {"has_pixel", "has_gtm", "has_google_ads", "audit"},
        "performance": {"has_ssl", "load_speed_seconds"},
    }.get(module, set())
    return {key: audit.get(key) for key in keys if key in audit}


class AdaptiveAuditCache:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv(
            "MIRAX_AUDIT_CACHE_PATH",
            os.path.join(os.path.dirname(__file__), "data", "mirax_audit_cache.sqlite"),
        )
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self._lock = threading.Lock()
        with closing(self._connect()) as db:
            db.execute(
                """create table if not exists audit_module_cache (
                    domain text not null, module text not null, version text not null,
                    payload text not null, expires_at real not null, created_at real not null,
                    primary key(domain, module, version)
                )"""
            )
            db.commit()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    @staticmethod
    def domain(url: str) -> str:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")

    def get_many(self, url: str, modules: Iterable[str]) -> Dict[str, Dict[str, Any]]:
        domain = self.domain(url)
        if not domain:
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        now = time.time()
        with self._lock, closing(self._connect()) as db:
            for module in modules:
                row = db.execute(
                    "select payload from audit_module_cache where domain=? and module=? and version=? and expires_at>?",
                    (domain, module, AUDIT_CACHE_VERSION, now),
                ).fetchone()
                if row:
                    try:
                        out[module] = json.loads(row[0])
                    except (TypeError, json.JSONDecodeError):
                        pass
        return out

    def put(self, url: str, module: str, payload: Dict[str, Any]) -> None:
        domain = self.domain(url)
        if not domain or module not in MODULE_TTL_SECONDS:
            return
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        # Avoid caching empty/failed module states as successful audits.
        if not payload or not hashlib.sha256(encoded.encode()).hexdigest():
            return
        now = time.time()
        with self._lock, closing(self._connect()) as db:
            db.execute(
                """insert into audit_module_cache(domain,module,version,payload,expires_at,created_at)
                   values(?,?,?,?,?,?) on conflict(domain,module,version) do update set
                   payload=excluded.payload,expires_at=excluded.expires_at,created_at=excluded.created_at""",
                (domain, module, AUDIT_CACHE_VERSION, encoded, now + MODULE_TTL_SECONDS[module], now),
            )
            db.commit()
