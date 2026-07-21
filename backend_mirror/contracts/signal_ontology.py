"""Shared MIRAX commercial signal ontology loader and validator."""
from __future__ import annotations

import json
import re
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

# Event language only: these patterns identify observable commercial facts,
# never professions or seller-specific offers.  Values are existing ontology
# IDs and therefore cannot create parallel signals.
_QUERY_SIGNAL_PATTERNS = (
    ("production_expansion", r"\b(nuov[oi]\s+(?:stabiliment[oi]|impiant[oi]|line[ae]\s+produttiv[ae])|ampliament\w*\s+produttiv\w*|capacita\s+produttiva|production\s+expansion)\b"),
    ("new_location", r"\b(nuov[ae]\s+(?:sed[ei]|filial[ei]|uffic[io]|magazzin\w*|stabiliment\w*)|apert\w+\s+(?:sed[ei]|filial[ei])|new\s+(?:office|site|facility|location))\b"),
    ("geographic_expansion", r"\b(espansion\w+\s+(?:geografic\w*|all.estero)|entra\w*\s+nel\s+mercato|expanding\s+abroad|new\s+market)\b"),
    ("hiring_sales", r"\b(assum\w*|cerca\w*|ricerca\w*)\b.{0,70}\b(commercial\w*|sales|business\s+developer|account\s+manager|sdr|bdr)\b"),
    ("hiring_marketing", r"\b(assum\w*|cerca\w*|ricerca\w*)\b.{0,70}\b(marketing|social\s+media|performance\s+marketer|media\s+buyer|growth)\b"),
    ("hiring_technology", r"\b(assum\w*|cerca\w*|ricerca\w*)\b.{0,70}\b(programmator\w*|sviluppator\w*|software|it\b|cyber|data\s+engineer)\b"),
    ("funding", r"\b(round|funding|seed|pre[- ]?seed|ha\s+raccolto|finanziat\w+\s+da)\b"),
    ("supplier_search", r"\b(cerca\w*|ricerca\w*|selezion\w*)\b.{0,50}\b(fornitor\w*|supplier|proposte|rfp)\b"),
    ("product_launch", r"\b(lancia\w*|nuov[oi]\s+prodott\w*|product\s+launch)\b"),
    ("internationalization", r"\b(export|internazionalizz\w*|espansion\w+\s+all.estero|expanding\s+abroad)\b"),
    ("new_equipment", r"\b(nuov[oi]\s+macchinar\w*|automatizz\w+\s+line\w*|equipment\s+purchase)\b"),
    ("technology_adoption", r"\b(adott\w*|implement\w*|nuov[ae]\s+piattaform\w*|trasformazion\w+\s+digital\w*|(?:valut\w*|scegli\w*|cerca\w*)\s+(?:un\s+)?(?:nuov\w+\s+)?(?:crm|erp|software|piattaforma))\b"),
    ("technology_migration", r"\b(migrazion\w*|sostituzion\w+\s+(?:crm|erp|piattaform\w*|sistem\w*))\b"),
    ("website_weakness", r"\b(criticita\s+seo|problemi\s+seo|sito\s+(?:vecchio|lento|debole)|online\s+(?:mess[oa]\s+male|debole))\b"),
    ("missing_analytics", r"\b(senza\s+(?:analytics|gtm)|assenza\s+(?:di\s+)?(?:analytics|gtm)|missing\s+(?:analytics|gtm))\b"),
    ("missing_advertising_pixel", r"\b(senza\s+(?:pixel|tracciamento\s+pubblicitario)|assenza\s+(?:di\s+)?(?:pixel|tracking)|missing\s+(?:pixel|tracking))\b"),
    ("regulatory_change", r"\b(adeguament\w+\s+(?:normativ\w*|documentat\w*)|nuov\w+\s+normativ\w*|regulatory\s+change)\b"),
    ("certification", r"\b(ottien\w*|rinnov\w*|cerca\w*|necessita\w*|scadenz\w*)\b.{0,50}\b(certificazion\w*|iso\s*(?:9001|14001|27001))\b"),
)


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


def match_query_signals(query: str) -> list[str]:
    """Extract explicit observable events while preserving ontology IDs."""
    normalized = str(query or "").casefold().replace("à", "a")
    matched = [signal for signal, pattern in _QUERY_SIGNAL_PATTERNS if re.search(pattern, normalized, re.I)]
    return list(dict.fromkeys(signal for signal in matched if canonical_signal_id(signal)))


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
