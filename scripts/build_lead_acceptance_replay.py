#!/usr/bin/env python3
"""Generate evaluation/fixtures/lead-acceptance-replay-v2.json."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend_mirror"))

from lead_acceptance.replay_dataset import write_dataset  # noqa: E402

if __name__ == "__main__":
    path = write_dataset()
    print(path)
