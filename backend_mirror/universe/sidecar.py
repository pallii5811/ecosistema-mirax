"""Universe sidecar helpers — gated ingest, never breaks legacy flows."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def is_universe_enabled() -> bool:
    return os.getenv("UNIVERSE_ENABLED", "0").strip().lower() in {"1", "true", "yes"}


def ingest_leads_batch(
    supabase: Any,
    leads: List[Dict[str, Any]],
    source: str,
    user_id: Optional[str] = None,
) -> Dict[str, int]:
    """Ingest MIRAX leads into Universe when UNIVERSE_ENABLED=1."""
    if not is_universe_enabled() or not supabase or not leads:
        return {"ingested": 0, "errors": 0}

    ingested = 0
    errors = 0
    try:
        from universe import UniverseRepository, ingest_mirax_lead

        repo = UniverseRepository(supabase)
        for lead in leads:
            if not isinstance(lead, dict):
                continue
            try:
                result = ingest_mirax_lead(repo, lead, source=source, user_id=user_id)
                lead["universe_entity_id"] = result.entity_id
                ingested += 1
            except Exception as ex:
                errors += 1
                logger.warning("universe ingest lead failed (%s): %s", source, ex)
    except Exception as ex:
        logger.warning("universe ingest init failed (%s): %s", source, ex)
        errors += sum(1 for lead in leads if isinstance(lead, dict))

    return {"ingested": ingested, "errors": errors}


def ingest_single_lead(
    supabase: Any,
    lead: Dict[str, Any],
    source: str,
    user_id: Optional[str] = None,
) -> bool:
    stats = ingest_leads_batch(supabase, [lead], source=source, user_id=user_id)
    return stats["ingested"] > 0
