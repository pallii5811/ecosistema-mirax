"""Universe repository — Python sidecar to Supabase."""

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from postgrest.exceptions import APIError

from .models import (
    IngestResult,
    UniverseEntity,
    UniverseEntityAlias,
    UniverseEvent,
    UniverseObservation,
    UniverseRelationship,
)

logger = logging.getLogger(__name__)


class UniverseError(Exception):
    def __init__(self, code: str, message: str, cause: Optional[Exception] = None):
        super().__init__(message)
        self.code = code
        self.cause = cause


def _stable_hash(payload: Any) -> str:
    """Deterministic hash compatible with TypeScript stablePayloadHash (MD5 over compact sorted JSON)."""
    s = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _observation_dedup_key(entity_id: str, attribute: str, source: str, observed_at: str) -> str:
    return f"{entity_id}:{attribute}:{source}:{observed_at[:10]}"


def _event_dedup_key(
    entity_id: str, event_type: str, source: str, occurred_at: str, payload: Any
) -> str:
    return f"{entity_id}:{event_type}:{source}:{occurred_at[:10]}:{_stable_hash(payload)}"


def _relationship_dedup_key(
    source_entity_id: str, target_entity_id: str, relationship_type: str, observed_at: str
) -> str:
    # Align with unique constraint (source_entity_id, target_entity_id, relationship_type)
    return f"{source_entity_id}:{target_entity_id}:{relationship_type}"


class UniverseRepository:
    def __init__(self, supabase_client):
        self.sb = supabase_client

    # ------------------------------------------------------------------
    # Entities
    # ------------------------------------------------------------------
    def upsert_entity(
        self, entity: UniverseEntity, aliases: Optional[List[UniverseEntityAlias]] = None
    ) -> tuple[UniverseEntity, bool]:
        now = datetime.now(timezone.utc).isoformat()
        existing = self.get_entity_by_canonical_id(entity.canonical_id, entity.entity_type)

        if existing:
            update_payload = {
                "name": entity.name,
                "slug": entity.slug or existing.slug,
                "country": entity.country or existing.country,
                "city": entity.city if entity.city is not None else existing.city,
                "region": entity.region if entity.region is not None else existing.region,
                "metadata": {**(existing.metadata or {}), **(entity.metadata or {})},
                "confidence": entity.confidence or existing.confidence,
                "last_seen_at": now,
            }
            resp = self.sb.table("universe_entities").update(update_payload).eq("id", existing.id).execute()
            updated = resp.data[0] if resp.data else None
            if not updated:
                raise UniverseError("DATABASE_ERROR", "upsert_entity update returned no data")
            if aliases:
                self._upsert_aliases(existing.id, aliases)
            return self._dict_to_entity(updated), False

        insert_payload = entity.to_dict()
        insert_payload["first_seen_at"] = now
        insert_payload["last_seen_at"] = now
        resp = self.sb.table("universe_entities").insert(insert_payload).execute()
        created = resp.data[0] if resp.data else None
        if not created:
            raise UniverseError("DATABASE_ERROR", "upsert_entity insert returned no data")
        if aliases:
            self._upsert_aliases(created["id"], aliases)
        return self._dict_to_entity(created), True

    def _resolve_entity_id(self, entity_id: str) -> str:
        """Follow merge chain to the canonical surviving entity."""
        seen = set()
        current = entity_id
        while current and current not in seen:
            seen.add(current)
            resp = (
                self.sb.table("universe_entities")
                .select("merged_into_id")
                .eq("id", current)
                .maybe_single()
                .execute()
            )
            data = resp.data if resp else None
            if not data or not data.get("merged_into_id"):
                return current
            current = data["merged_into_id"]
        return current

    def get_entity_by_id(self, entity_id: str) -> Optional[UniverseEntity]:
        resolved_id = self._resolve_entity_id(entity_id)
        resp = self.sb.table("universe_entities").select("*").eq("id", resolved_id).maybe_single().execute()
        data = resp.data if resp else None
        return self._dict_to_entity(data) if data else None

    def get_entity_by_canonical_id(
        self, canonical_id: str, entity_type: str
    ) -> Optional[UniverseEntity]:
        resp = (
            self.sb.table("universe_entities")
            .select("*")
            .eq("canonical_id", canonical_id)
            .eq("entity_type", entity_type)
            .maybe_single()
            .execute()
        )
        data = resp.data if resp else None
        if not data:
            return None
        resolved_id = self._resolve_entity_id(data["id"])
        if resolved_id == data["id"]:
            return self._dict_to_entity(data)
        return self.get_entity_by_id(resolved_id)

    def get_entity_by_alias(
        self, alias_type: str, alias_value: str, entity_type: Optional[str] = None
    ) -> Optional[UniverseEntity]:
        resp = self.sb.rpc(
            "universe_resolve_entity_by_alias",
            {
                "p_alias_type": alias_type,
                "p_alias_value": alias_value,
                "p_entity_type": entity_type,
            },
        ).execute()
        entity_id = resp.data if resp and resp.data else None
        if not entity_id:
            return None
        return self.get_entity_by_id(entity_id)

    def _upsert_aliases(self, entity_id: str, aliases: List[UniverseEntityAlias]) -> None:
        rows = [
            {
                "entity_id": entity_id,
                "alias_type": a.alias_type,
                "alias_value": a.alias_value,
                "confidence": a.confidence,
            }
            for a in aliases
        ]
        self.sb.table("universe_entity_aliases").upsert(
            rows, on_conflict="entity_id,alias_type,alias_value"
        ).execute()

    def merge_entities(self, source_id: str, target_id: str) -> UniverseEntity:
        """Merge source entity into target, moving aliases/observations/relationships.

        Surviving entity is returned. The source row is kept with merged_into_id set,
        so external references remain resolvable.
        """
        if source_id == target_id:
            raise UniverseError("MERGE_SELF", "Cannot merge an entity into itself")
        source = self.get_entity_by_id(source_id)
        target = self.get_entity_by_id(target_id)
        if not source or not target:
            raise UniverseError("MERGE_MISSING", "Source or target entity not found")
        if source.merged_into_id:
            raise UniverseError("MERGE_ALREADY", "Source entity is already merged")

        now = datetime.now(timezone.utc).isoformat()

        # Move aliases to target (skip exact duplicates).
        alias_resp = (
            self.sb.table("universe_entity_aliases")
            .select("*")
            .eq("entity_id", source_id)
            .execute()
        )
        alias_rows = alias_resp.data if alias_resp else []
        if alias_rows:
            self.sb.table("universe_entity_aliases").upsert(
                [
                    {
                        "entity_id": target_id,
                        "alias_type": row["alias_type"],
                        "alias_value": row["alias_value"],
                        "confidence": row.get("confidence", 1.0),
                    }
                    for row in alias_rows
                ],
                on_conflict="entity_id,alias_type,alias_value",
            ).execute()
            self.sb.table("universe_entity_aliases").delete().eq("entity_id", source_id).execute()

        # Move observations, regenerating dedup keys for the target entity.
        obs_resp = (
            self.sb.table("universe_observations")
            .select("*")
            .eq("entity_id", source_id)
            .execute()
        )
        obs_rows = obs_resp.data if obs_resp else []
        if obs_rows:
            new_obs = []
            for row in obs_rows:
                observed_at = row.get("observed_at") or now
                new_obs.append(
                    {
                        "entity_id": target_id,
                        "attribute": row["attribute"],
                        "value": row.get("value"),
                        "observed_at": observed_at,
                        "source": row.get("source"),
                        "confidence": row.get("confidence", 1.0),
                        "metadata": row.get("metadata") or {},
                        "dedup_key": _observation_dedup_key(
                            target_id, row["attribute"], row.get("source", ""), observed_at
                        ),
                    }
                )
            self.sb.table("universe_observations").upsert(new_obs, on_conflict="dedup_key").execute()
            self.sb.table("universe_observations").delete().eq("entity_id", source_id).execute()

        # Move relationships, regenerating dedup keys.
        rel_resp = (
            self.sb.table("universe_relationships")
            .select("*")
            .or_(f"source_entity_id.eq.{source_id},target_entity_id.eq.{source_id}")
            .execute()
        )
        rel_rows = rel_resp.data if rel_resp else []
        if rel_rows:
            new_rels = []
            for row in rel_rows:
                src = row.get("source_entity_id")
                tgt = row.get("target_entity_id")
                if src == source_id:
                    src = target_id
                if tgt == source_id:
                    tgt = target_id
                if src == tgt:
                    continue
                observed_at = row.get("observed_at") or now
                new_rels.append(
                    {
                        "source_entity_id": src,
                        "target_entity_id": tgt,
                        "relationship_type": row["relationship_type"],
                        "observed_at": observed_at,
                        "source": row.get("source"),
                        "confidence": row.get("confidence", 1.0),
                        "metadata": row.get("metadata") or {},
                        "dedup_key": _relationship_dedup_key(
                            src, tgt, row["relationship_type"], observed_at
                        ),
                    }
                )
            self.sb.table("universe_relationships").upsert(new_rels, on_conflict="dedup_key").execute()
            self.sb.table("universe_relationships").delete().or_(
                f"source_entity_id.eq.{source_id},target_entity_id.eq.{source_id}"
            ).execute()

        # Mark source as merged.
        update_resp = (
            self.sb.table("universe_entities")
            .update({"merged_into_id": target_id, "last_seen_at": now})
            .eq("id", source_id)
            .execute()
        )
        if not (update_resp.data and update_resp.data[0]):
            raise UniverseError("DATABASE_ERROR", "merge update returned no data")
        return target

    def _dict_to_entity(self, data: Dict[str, Any]) -> UniverseEntity:
        return UniverseEntity(
            id=data.get("id"),
            canonical_id=data["canonical_id"],
            entity_type=data["entity_type"],
            name=data["name"],
            slug=data.get("slug"),
            country=data.get("country"),
            city=data.get("city"),
            region=data.get("region"),
            metadata=data.get("metadata") or {},
            merged_into_id=data.get("merged_into_id"),
            confidence=data.get("confidence", 1.0),
            first_seen_at=data.get("first_seen_at"),
            last_seen_at=data.get("last_seen_at"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    # ------------------------------------------------------------------
    # Observations
    # ------------------------------------------------------------------
    def create_observations(self, observations: List[UniverseObservation]) -> int:
        if not observations:
            return 0
        rows = [o.to_dict() for o in observations]
        for row in rows:
            if not row.get("dedup_key"):
                row["dedup_key"] = _observation_dedup_key(
                    row["entity_id"],
                    row["attribute"],
                    row["source"],
                    row["observed_at"],
                )
        try:
            resp = self.sb.table("universe_observations").upsert(
                rows, on_conflict="dedup_key"
            ).execute()
            return len(resp.data) if resp.data else 0
        except APIError as e:
            logger.warning("create_observations APIError: %s", e)
            return 0

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    def create_relationships(self, relationships: List[UniverseRelationship]) -> int:
        if not relationships:
            return 0
        rows = [r.to_dict() for r in relationships]
        # Deduplicate within the batch by the actual unique constraint columns.
        seen: Dict[tuple, Dict[str, Any]] = {}
        for row in rows:
            if not row.get("dedup_key"):
                row["dedup_key"] = _relationship_dedup_key(
                    row["source_entity_id"],
                    row["target_entity_id"],
                    row["relationship_type"],
                    row["observed_at"],
                )
            key = (row["source_entity_id"], row["target_entity_id"], row["relationship_type"])
            existing = seen.get(key)
            if existing is None or (row.get("observed_at") or "") > (existing.get("observed_at") or ""):
                seen[key] = row
        unique_rows = list(seen.values())
        try:
            resp = self.sb.table("universe_relationships").upsert(
                unique_rows, on_conflict="source_entity_id,target_entity_id,relationship_type"
            ).execute()
            return len(resp.data) if resp.data else 0
        except APIError as e:
            logger.warning("create_relationships APIError: %s", e)
            return 0

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------
    def append_events(self, events: List[UniverseEvent]) -> int:
        if not events:
            return 0
        rows = [e.to_dict() for e in events]
        for row in rows:
            if not row.get("dedup_key"):
                row["dedup_key"] = _event_dedup_key(
                    row["entity_id"],
                    row["event_type"],
                    row["source"],
                    row["occurred_at"],
                    row["payload"],
                )
        try:
            resp = self.sb.table("universe_events").upsert(
                rows, on_conflict="dedup_key"
            ).execute()
            return len(resp.data) if resp.data else 0
        except APIError as e:
            logger.warning("append_events APIError: %s", e)
            return 0
