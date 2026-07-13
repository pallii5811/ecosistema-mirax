"""Read-only Neo4j health check. Never prints credentials or entity data."""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

import sys

sys.path.insert(0, str(ROOT))
from universe_neo4j_sync import get_neo4j_database, get_neo4j_driver, is_neo4j_enabled


def main() -> None:
    if not is_neo4j_enabled():
        print(json.dumps({"enabled": False, "connected": False}))
        raise SystemExit(2)
    driver = get_neo4j_driver()
    database = get_neo4j_database()
    with driver.session(database=database) as session:
        nodes = int(session.run("MATCH (n) RETURN count(n) AS c").single()["c"])
        relationships = int(session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"])
        relationship_types = int(
            session.run("MATCH ()-[r]->() RETURN count(DISTINCT type(r)) AS c").single()["c"]
        )
    driver.close()
    print(
        json.dumps(
            {
                "enabled": True,
                "connected": True,
                "database_configured": bool(os.getenv("NEO4J_DATABASE")),
                "nodes": nodes,
                "relationships": relationships,
                "relationship_types": relationship_types,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
