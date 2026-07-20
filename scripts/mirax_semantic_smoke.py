#!/usr/bin/env python3
import asyncio
import json
import os
import types
import sys
from pathlib import Path

ROOT = Path("/home/worker/app/backend-staging")
sys.path.insert(0, str(ROOT))
pkg = types.ModuleType("backend_mirror")
pkg.__path__ = [str(ROOT)]
sys.modules["backend_mirror"] = pkg

from dotenv import dotenv_values
env = dotenv_values(ROOT / ".env")
os.environ.update({k: v for k, v in env.items() if v})

from semantic_intelligence import AnthropicSemanticModel, SemanticCommercialEventInterpreter, SemanticQueryContract


async def main() -> None:
    contract = SemanticQueryContract.from_model({
        "target_role_in_event": "recipient",
        "required_relationships": ["startup_raising_or_receiving_investment"],
        "acceptance_rubric": ["startup recipient with literal evidence"],
        "excluded_roles": ["investor", "authority", "publisher"],
    }, original_query="startup funding", requested_count=2)
    model = AnthropicSemanticModel()
    interpreter = SemanticCommercialEventInterpreter(model)
    text = (
        "La startup TextYess ha chiuso un round seed da 2,4 milioni di euro guidato da VC fund. "
        "L'azienda operativa utilizzerà i fondi per espandere il team commerciale."
        * 3
    )
    try:
        result = await interpreter.interpret(
            contract,
            title="Startup funding round",
            snippet="round seed",
            source_text=text,
            source_url="https://example.it/news",
            publisher="example.it",
            structured_metadata={},
            entity_hints=("TextYess", "textyess.com"),
        )
        print(json.dumps({"ok": True, "role": result.target_entity_role, "rels": list(result.satisfied_relationships)}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__, "message": str(exc)[:500]}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
