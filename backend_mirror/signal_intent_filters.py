"""Fase 12 — filtri multi-livello da signal_intent (post-audit worker)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _audit(lead: Dict[str, Any]) -> Dict[str, Any]:
    tr = lead.get("technical_report")
    return tr if isinstance(tr, dict) else {}


def filter_leads_by_intent(leads: List[Dict[str, Any]], intent_spec: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not intent_spec or not isinstance(intent_spec, dict):
        return leads

    tf = intent_spec.get("technical_filters") if isinstance(intent_spec.get("technical_filters"), dict) else {}
    bf = intent_spec.get("business_filters") if isinstance(intent_spec.get("business_filters"), dict) else {}
    out: List[Dict[str, Any]] = []

    for lead in leads:
        if not isinstance(lead, dict):
            continue
        audit = _audit(lead)
        match = True

        if tf.get("has_gtm") is True and not audit.get("has_gtm") and not lead.get("google_tag_manager"):
            match = False
        if tf.get("has_gtm") is False and (audit.get("has_gtm") or lead.get("google_tag_manager")):
            match = False
        if tf.get("errors_seo") is True and not (audit.get("html_errors") or audit.get("seo_disaster")):
            match = False
        if tf.get("has_ssl") is True and audit.get("has_ssl") is False:
            match = False
        if tf.get("has_ssl") is False and audit.get("has_ssl") is not False:
            match = False

        rev_min = bf.get("revenue_min")
        if isinstance(rev_min, (int, float)) and float(lead.get("fatturato") or lead.get("revenue") or 0) < float(rev_min):
            match = False
        emp_min = bf.get("employees_min")
        if isinstance(emp_min, (int, float)) and float(lead.get("dipendenti") or lead.get("employees") or 0) < float(emp_min):
            match = False

        if match:
            out.append(lead)

    return out
