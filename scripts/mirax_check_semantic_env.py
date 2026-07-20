#!/usr/bin/env python3
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

from semantic_intelligence import AnthropicSemanticModel

m = AnthropicSemanticModel()
print("model", m.tier1_model)
print("key_set", bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("MIRAX_ANTHROPIC_API_KEY")))
