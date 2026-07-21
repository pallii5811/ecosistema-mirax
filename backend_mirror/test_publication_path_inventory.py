"""CI guard: unauthorized publication paths must be zero."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_publication_path_inventory_no_unauthorized_bypasses():
    script = ROOT / "scripts" / "build_publication_path_inventory.py"
    subprocess.run([sys.executable, str(script)], check=True, cwd=str(ROOT))
    out = ROOT / "artifacts" / "publication-path-inventory.json"
    inv = json.loads(out.read_text(encoding="utf-8"))
    offenders = inv.get("unauthorized_paths") or []
    assert inv["unauthorized_count"] == 0, f"Unauthorized publication paths: {offenders}"
