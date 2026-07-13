"""Universe sidecar helpers — gated ingest, never breaks legacy flows."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def is_universe_enabled() -> bool:
    return os.getenv("UNIVERSE_ENABLED", "0").strip().lower() in {"1", "true", "yes"}


def _is_retryable_error(ex: Exception) -> bool:
    msg = str(ex).lower()
    return any(
        phrase in msg
        for phrase in [
            "server disconnected",
            "connection reset",
            "connection closed",
            "timeout",
            "pool timeout",
            "remote end closed",
        ]
    )


def ingest_leads_batch(
    supabase: Any,
    leads: List[Dict[str, Any]],
    source: str,
    user_id: Optional[str] = None,
    enable_live_sources: bool = False,
) -> Dict[str, int]:
    """Ingest MIRAX leads into Universe when UNIVERSE_ENABLED=1.

    Processes leads in small chunks with retry on transient connection errors.
    """
    if not is_universe_enabled() or not supabase or not leads:
        return {"ingested": 0, "errors": 0}

    ingested = 0
    errors = 0
    try:
        from universe import UniverseRepository, ingest_mirax_lead

        repo = UniverseRepository(supabase)
        chunk_size = 3
        for i in range(0, len(leads), chunk_size):
            chunk = leads[i : i + chunk_size]
            for lead in chunk:
                if not isinstance(lead, dict):
                    continue
                last_err = None
                for attempt in range(3):
                    try:
                        result = ingest_mirax_lead(
                            repo,
                            lead,
                            source=source,
                            user_id=user_id,
                            enable_live_sources=enable_live_sources,
                        )
                        lead["universe_entity_id"] = result.entity_id
                        ingested += 1
                        break
                    except Exception as ex:
                        last_err = ex
                        if _is_retryable_error(ex) and attempt < 2:
                            time.sleep(0.5 * (attempt + 1))
                            continue
                        errors += 1
                        logger.warning("universe ingest lead failed (%s): %s", source, ex)
                        break
            # Brief pause between chunks to avoid hammering the Supabase pooler.
            if i + chunk_size < len(leads):
                time.sleep(0.2)
    except Exception as ex:
        logger.warning("universe ingest init failed (%s): %s", source, ex)
        errors += sum(1 for lead in leads if isinstance(lead, dict))

    return {"ingested": ingested, "errors": errors}


def ingest_single_lead(
    supabase: Any,
    lead: Dict[str, Any],
    source: str,
    user_id: Optional[str] = None,
    enable_live_sources: bool = False,
) -> bool:
    stats = ingest_leads_batch(
        supabase,
        [lead],
        source=source,
        user_id=user_id,
        enable_live_sources=enable_live_sources,
    )
    return stats["ingested"] > 0
