from __future__ import annotations

from backend_mirror.universe_neo4j_sync import (
    build_semantic_graph_records,
    sync_semantic_leads_to_graph,
)


def semantic_lead() -> dict:
    excerpt = "A Beta Srl sono state destinate nuove risorse per ampliare la produzione."
    return {
        "azienda": "Beta Srl", "sito": "https://beta.test", "citta": "Milano",
        "semantic_grounding": {
            "accepted": True, "contract_hash": "contract-1",
            "grounded_evidence": [{
                "interpretation": {
                    "schema_version": "semantic-event-v1", "event_type": "capital_received",
                    "predicate": "resources_allocated_to_target_company", "event_date": "2026-07-10",
                    "target_entity_role": "recipient", "technology": "Salesforce",
                    "satisfied_relationships": ["resources_allocated_to_target_company"],
                    "confidence": 0.95,
                },
                "verdict": {
                    "accepted": True, "schema_version": "semantic-grounding-v1",
                    "source_url": "https://news.test/beta", "source_publisher": "Economia Oggi",
                    "evidence_excerpt": excerpt,
                },
            }],
        },
    }


class Result:
    def consume(self):
        return self


class Session:
    def __init__(self, queries: list[tuple[str, dict]]) -> None:
        self.queries = queries

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def run(self, query: str, **params):
        self.queries.append((query, params))
        return Result()


class Driver:
    def __init__(self) -> None:
        self.queries: list[tuple[str, dict]] = []

    def session(self, **_kwargs):
        return Session(self.queries)


def test_semantic_graph_records_are_grounded_and_deterministic() -> None:
    first = build_semantic_graph_records([semantic_lead()], search_id="search-1")
    second = build_semantic_graph_records([semantic_lead()], search_id="search-1")
    assert len(first) == len(second) == 1
    for key in ("company", "event", "evidence", "source", "search", "location", "technology"):
        assert first[0][key]["canonical_id"] == second[0][key]["canonical_id"]
    assert first[0]["company"]["canonical_id"] == "company:beta.test"
    assert first[0]["source"]["publisher"] == "Economia Oggi"
    assert first[0]["event"]["target_role"] == "recipient"
    assert build_semantic_graph_records([{"semantic_grounding": {"accepted": False}}]) == []


def test_semantic_graph_writer_uses_idempotent_merge_and_required_edges(monkeypatch) -> None:
    monkeypatch.setenv("NEO4J_ENABLED", "1")
    monkeypatch.setenv("NEO4J_URI", "neo4j+s://fixture.invalid")
    driver = Driver()
    one = sync_semantic_leads_to_graph([semantic_lead()], search_id="search-1", driver=driver)
    two = sync_semantic_leads_to_graph([semantic_lead()], search_id="search-1", driver=driver)
    assert one == two == {"nodes": 8, "relationships": 8, "errors": 0}
    cypher = "\n".join(query for query, _params in driver.queries)
    for relationship in (
        "COMPANY_HAS_EVENT", "EVENT_HAS_EVIDENCE", "EVIDENCE_FROM_SOURCE",
        "EVENT_INVOLVES_COMPANY", "COMPANY_USES_TECHNOLOGY", "COMPANY_LOCATED_IN",
        "SEARCH_RETURNED_COMPANY", "EVENT_RELATES_TO_SIGNAL",
    ):
        assert f"MERGE" in cypher and relationship in cypher
    assert "CREATE (" not in cypher
