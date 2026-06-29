"""
MIRAX v5 — Health monitor for external enrichment sources.
Skips unhealthy sources during cooldown; auto-recovers after RECOVERY_TIME.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class SourceHealth:
    name: str
    last_success: float = 0.0
    last_failure: float = 0.0
    consecutive_failures: int = 0
    avg_response_ms: float = 9999.0
    is_healthy: bool = True


class HealthMonitor:
    FAILURE_THRESHOLD = 3
    RECOVERY_TIME = 300  # seconds

    def __init__(self) -> None:
        self.sources: Dict[str, SourceHealth] = {}

    def record_success(self, source_name: str, response_ms: float) -> None:
        if source_name not in self.sources:
            self.sources[source_name] = SourceHealth(name=source_name)
        h = self.sources[source_name]
        h.last_success = time.time()
        h.consecutive_failures = 0
        h.avg_response_ms = (h.avg_response_ms * 0.8) + (response_ms * 0.2)
        h.is_healthy = True

    def record_failure(self, source_name: str) -> None:
        if source_name not in self.sources:
            self.sources[source_name] = SourceHealth(
                name=source_name,
                last_failure=time.time(),
                consecutive_failures=1,
            )
            return
        h = self.sources[source_name]
        h.last_failure = time.time()
        h.consecutive_failures += 1
        if h.consecutive_failures >= self.FAILURE_THRESHOLD:
            h.is_healthy = False

    def should_try(self, source_name: str) -> bool:
        if source_name not in self.sources:
            return True
        h = self.sources[source_name]
        if h.is_healthy:
            return True
        if time.time() - h.last_failure > self.RECOVERY_TIME:
            return True
        return False

    def get_status(self) -> Dict[str, Dict[str, object]]:
        return {
            name: {
                "healthy": h.is_healthy,
                "avg_ms": round(h.avg_response_ms, 0),
                "failures": h.consecutive_failures,
                "last_success": h.last_success,
                "last_failure": h.last_failure,
            }
            for name, h in self.sources.items()
        }


_default_monitor: Optional[HealthMonitor] = None


def get_health_monitor() -> HealthMonitor:
    global _default_monitor
    if _default_monitor is None:
        _default_monitor = HealthMonitor()
    return _default_monitor
