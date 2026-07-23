#!/usr/bin/env python3
"""DEPRECATED stub — production matrix path is TypeScript.

Use:
  npx tsx scripts/run_openworld_diverse_matrix.ts offline-check
  npx tsx scripts/run_openworld_diverse_matrix.ts budget
  npx tsx scripts/run_openworld_diverse_matrix.ts prepare --case=A --user-email=...
  npx tsx scripts/run_openworld_diverse_matrix.ts review --search-id=...

Do NOT run all cases. The previous Python runner manually built seller/target/
signals/adapters and bypassed the production NL → compiler → plan path.
"""
from __future__ import annotations

import sys


def main() -> int:
    print(
        "ERROR: scripts/run_openworld_diverse_matrix.py is retired.\n"
        "Use the production-path TypeScript runner:\n"
        "  npx tsx scripts/run_openworld_diverse_matrix.ts offline-check\n"
        "  npx tsx scripts/run_openworld_diverse_matrix.ts prepare --case=A --user-email=...\n"
        "Never pass 'all'.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
