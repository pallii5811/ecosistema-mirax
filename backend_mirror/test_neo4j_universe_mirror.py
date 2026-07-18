from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

from universe_neo4j_sync import ensure_neo4j_schema, sync_universe_graph_to_neo4j


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)

    def select(self, *_args, **_kwargs):
        return self

    def in_(self, column, values):
        allowed = set(values)
        self.rows = [row for row in self.rows if row.get(column) in allowed]
        return self

    def range(self, start, end):
        self.rows = self.rows[start : end + 1]
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self.tables.get(name, []))


class FakeResult:
    def consume(self):
        return None


class FakeSession:
    def __init__(self, queries):
        self.queries = queries

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def run(self, query, **params):
        self.queries.append((query, params))
        return FakeResult()


class FakeDriver:
    def __init__(self):
        self.queries = []

    def session(self, **_kwargs):
        return FakeSession(self.queries)


def test_schema_constraints_are_idempotent() -> None:
    driver = FakeDriver()
    ensure_neo4j_schema(driver, "test")
    assert len(driver.queries) == 14
    assert all("IF NOT EXISTS" in query for query, _ in driver.queries)
    assert any("mirax_event_canonical" in query for query, _ in driver.queries)
    assert any("mirax_evidence_canonical" in query for query, _ in driver.queries)


def test_rich_universe_relationship_is_mirrored() -> None:
    company_id = "company-1"
    customer_id = "company-2"
    relationship_id = "rel-1"
    sb = FakeSupabase(
        {
            "universe_entities": [
                {
                    "id": company_id,
                    "canonical_id": "source.it",
                    "entity_type": "company",
                    "name": "Source Srl",
                    "city": "Milano",
                    "metadata": {},
                },
                {
                    "id": customer_id,
                    "canonical_id": "customer.it",
                    "entity_type": "company",
                    "name": "Customer Spa",
                    "city": "Roma",
                    "metadata": {},
                },
            ],
            "universe_relationships": [
                {
                    "id": relationship_id,
                    "source_entity_id": company_id,
                    "target_entity_id": customer_id,
                    "relationship_type": "has_customer",
                    "confidence": 0.8,
                    "source": "website",
                    "observed_at": "2026-07-08T00:00:00Z",
                    "metadata": {"source_url": "https://source.it/clienti"},
                },
                {
                    "id": "legacy-noise",
                    "source_entity_id": company_id,
                    "target_entity_id": customer_id,
                    "relationship_type": "partner_of",
                    "confidence": 0.4,
                    "source": "website",
                    "observed_at": "2026-07-08T00:00:00Z",
                    "metadata": {},
                },
            ],
        }
    )
    driver = FakeDriver()
    with patch.dict(os.environ, {"NEO4J_ENABLED": "1", "NEO4J_URI": "bolt://test"}, clear=False):
        stats = sync_universe_graph_to_neo4j(sb, [company_id], driver=driver)
    assert stats == {"nodes": 2, "relationships": 1, "errors": 0}
    rendered = "\n".join(query for query, _ in driver.queries)
    assert "HAS_CUSTOMER" in rendered
    assert "PARTNER_OF" not in rendered
    assert "UniverseEntity" in rendered


def test_full_mirror_prunes_stale_nodes_and_relationships() -> None:
    sb = FakeSupabase(
        {
            "universe_entities": [
                {
                    "id": "company-1",
                    "canonical_id": "source.it",
                    "entity_type": "company",
                    "name": "Source Srl",
                    "metadata": {},
                }
            ],
            "universe_relationships": [],
        }
    )
    driver = FakeDriver()
    with patch.dict(os.environ, {"NEO4J_ENABLED": "1", "NEO4J_URI": "bolt://test"}, clear=False):
        stats = sync_universe_graph_to_neo4j(sb, driver=driver)
    assert stats == {"nodes": 1, "relationships": 0, "errors": 0}
    rendered = "\n".join(query for query, _ in driver.queries)
    assert "DETACH DELETE n" in rendered
    assert "DELETE r" in rendered


if __name__ == "__main__":
    test_schema_constraints_are_idempotent()
    test_rich_universe_relationship_is_mirrored()
    test_full_mirror_prunes_stale_nodes_and_relationships()
    print("test_neo4j_universe_mirror: 3/3 OK")
