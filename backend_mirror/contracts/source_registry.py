"""Deterministic source trust/cost registry shared with the TypeScript compiler."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict


_HERE = Path(__file__).resolve().parent
_REGISTRY_CANDIDATES = [
    _HERE / "source-registry.v1.json",
    _HERE.parents[1] / "contracts" / "source-registry.v1.json",
]
REGISTRY_PATH = next((path for path in _REGISTRY_CANDIDATES if path.is_file()), _REGISTRY_CANDIDATES[0])


@lru_cache(maxsize=1)
def load_source_registry() -> Dict[str, Dict[str, Any]]:
    payload = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "1.0.0" or not isinstance(payload.get("sources"), list):
        raise ValueError("invalid source registry contract")
    sources: Dict[str, Dict[str, Any]] = {}
    for source in payload["sources"]:
        source_id = str(source.get("id") or "").strip()
        if not source_id or source_id in sources:
            raise ValueError("source registry contains missing or duplicate ids")
        trust = float(source.get("trust_level", -1))
        cost = float(source.get("cost_eur_per_operation", -1))
        if trust < 0 or trust > 1 or cost < 0:
            raise ValueError(f"invalid trust/cost metadata for source {source_id}")
        implementation_id = str(source.get("implementation_id") or "").strip()
        capability_version = str(source.get("capability_version") or "").strip()
        runtime_coverage = str(source.get("runtime_coverage") or "unsupported").strip()
        if bool(implementation_id) != bool(capability_version):
            raise ValueError(f"incomplete runtime binding for source {source_id}")
        if runtime_coverage not in {"supported", "unsupported", "generic_fallback_partial"}:
            raise ValueError(f"invalid runtime coverage for source {source_id}")
        if runtime_coverage != "unsupported" and not implementation_id:
            raise ValueError(f"runtime coverage without implementation for source {source_id}")
        sources[source_id] = source
    return sources


def source_supports_signal(source_id: str, signal: str) -> bool:
    source = load_source_registry().get(source_id)
    supported = source.get("signals_supported") if isinstance(source, dict) else []
    return isinstance(supported, list) and ("*" in supported or signal in supported)


def source_runtime_coverage(source_id: str) -> str:
    source = load_source_registry().get(source_id)
    if not isinstance(source, dict) or not source.get("implementation_id") or not source.get("capability_version"):
        return "unsupported"
    return str(source.get("runtime_coverage") or "unsupported")


def validate_plan_source_policy(plan: Dict[str, Any]) -> None:
    registry = load_source_registry()
    policy = plan.get("source_policy") if isinstance(plan.get("source_policy"), dict) else {}
    allowed = [str(value) for value in policy.get("allowed_source_classes") or []]
    preferred = [str(value) for value in policy.get("preferred_source_classes") or []]
    unknown = [source for source in allowed if source not in registry]
    if unknown:
        raise ValueError(f"unknown source classes: {', '.join(unknown)}")
    if any(source not in allowed for source in preferred):
        raise ValueError("preferred source classes must also be allowed")
    signal_policy = plan.get("signal_policy") if isinstance(plan.get("signal_policy"), dict) else {}
    for signal in [str(value) for value in signal_policy.get("required_signals") or []]:
        if not any(source_supports_signal(source, signal) for source in allowed):
            raise ValueError(f"required signal has no viable source: {signal}")
