"""Central absolute governor-cap calculation for shadow resumes.

Operators authorize only an incremental amount. The runtime always converts:
  absolute_governor_cap = current_charged_search_spend + additional_authorized_eur
so a residual must never be misread as an absolute hard cap.
"""
from __future__ import annotations

from typing import Mapping, Optional

_MAX_PRODUCT_CAP_EUR = 0.25


def resolve_absolute_governor_cap(
    *,
    current_charged_search_spend: float,
    additional_authorized_eur: float,
    product_max_eur: float = _MAX_PRODUCT_CAP_EUR,
) -> float:
    charged = max(0.0, float(current_charged_search_spend or 0.0))
    extra = max(0.0, float(additional_authorized_eur or 0.0))
    product = max(0.0, float(product_max_eur or _MAX_PRODUCT_CAP_EUR))
    return round(min(product, charged + extra), 6)


def resolve_shadow_hard_cap_eur(
    *,
    plan_hard_cost_eur: Optional[float],
    environ: Mapping[str, str],
    resume_state: Optional[Mapping[str, object]] = None,
    current_charged_search_spend: Optional[float] = None,
    absolute_max_eur: float = _MAX_PRODUCT_CAP_EUR,
) -> float:
    """Resolve the absolute shadow governor ceiling.

    Preference order:
    1. resume_state.additional_authorized_eur (+ charged spend) — operator-safe
    2. environ MIRAX_SOURCE_ADAPTER_SHADOW_ADDITIONAL_AUTHORIZED_EUR
    3. environ MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR as absolute (legacy)
    4. plan hard_cost_eur
    """
    resume = dict(resume_state or {})
    charged = float(
        current_charged_search_spend
        if current_charged_search_spend is not None
        else resume.get("prior_cost_eur")
        or resume.get("current_charged_search_spend")
        or 0.0
    )
    additional = resume.get("additional_authorized_eur")
    if additional is None:
        raw_extra = str(environ.get("MIRAX_SOURCE_ADAPTER_SHADOW_ADDITIONAL_AUTHORIZED_EUR") or "").strip()
        additional = float(raw_extra) if raw_extra else None
    if additional is not None:
        return resolve_absolute_governor_cap(
            current_charged_search_spend=charged,
            additional_authorized_eur=float(additional),
            product_max_eur=absolute_max_eur,
        )
    raw_abs = str(environ.get("MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR") or "").strip()
    if raw_abs:
        return max(0.0, min(absolute_max_eur, float(raw_abs)))
    plan_cap = float(plan_hard_cost_eur) if plan_hard_cost_eur is not None else absolute_max_eur
    return max(0.0, min(absolute_max_eur, plan_cap))
