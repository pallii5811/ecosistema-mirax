"""Shared MIRAX commercial signal ontology loader and validator."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

from .source_registry import load_source_registry

_HERE = Path(__file__).resolve().parent
_ONTOLOGY_CANDIDATES = [
    _HERE / "signal-ontology.v1.json",
    _HERE.parents[1] / "contracts" / "signal-ontology.v1.json",
]
ONTOLOGY_PATH = next((path for path in _ONTOLOGY_CANDIDATES if path.is_file()), _ONTOLOGY_CANDIDATES[0])


@lru_cache(maxsize=1)
def load_signal_ontology() -> Dict[str, Any]:
    payload = json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "1.0.0":
        raise ValueError("invalid signal ontology version")
    sources = load_source_registry()
    signals: Dict[str, Dict[str, Any]] = {}
    for seed in payload.get("signals") or []:
        signal_id = str(seed.get("id") or "").strip()
        if not signal_id or signal_id in signals:
            raise ValueError("missing or duplicate signal id")
        for source in list(seed.get("sources") or []) + list(seed.get("preferred") or []):
            if source not in sources:
                raise ValueError(f"signal {signal_id} references unknown source {source}")
        signals[signal_id] = {
            "id": signal_id,
            "family": seed["family"],
            "description": seed["description"],
            "applicable_problems": seed["problems"],
            "related_events": seed["events"],
            "likely_source_classes": seed["sources"],
            "preferred_source_classes": seed["preferred"],
            "evidence_rules": [
                "source_url_required", "observed_at_required",
                "official_domain_required", "search_snippet_not_evidence",
            ],
            "default_freshness_days": int(seed["freshness_days"]),
            "freshness_decay_function": "exponential_half_life",
            "default_strength": float(seed["strength"]),
            "false_positive_risks": seed["risks"],
            "extraction_hints": seed["hints"],
        }
    aliases = {str(k): str(v) for k, v in (payload.get("aliases") or {}).items()}
    if any(target not in signals for target in aliases.values()):
        raise ValueError("signal alias references unknown target")
    return {"schema_version": "1.0.0", "signals": signals, "aliases": aliases}


def canonical_signal_id(value: str) -> Optional[str]:
    normalized = str(value or "").strip().lower().replace("-", " ").replace(" ", "_")
    ontology = load_signal_ontology()
    canonical = ontology["aliases"].get(normalized, normalized)
    return canonical if canonical in ontology["signals"] else None


def validate_plan_signals(plan: Dict[str, Any]) -> None:
    policy = plan.get("signal_policy") if isinstance(plan.get("signal_policy"), dict) else {}
    hypotheses = plan.get("commercial_hypotheses") if isinstance(plan.get("commercial_hypotheses"), list) else []
    values = list(policy.get("required_signals") or []) + list(policy.get("optional_signals") or [])
    for hypothesis in hypotheses:
        if isinstance(hypothesis, dict):
            values.extend(hypothesis.get("signals") or [])
    unknown = sorted({str(value) for value in values if canonical_signal_id(str(value)) is None})
    if unknown:
        raise ValueError(f"unknown signal ids: {', '.join(unknown)}")
