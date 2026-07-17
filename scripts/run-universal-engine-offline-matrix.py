#!/usr/bin/env python3
"""Offline matrix for UniversalSignalDiscoveryEngine — QuerySpec + strategies (no live IO)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend_mirror"))

from backend_mirror.source_adapters.universal_query_spec import (  # noqa: E402
    CANARY_QUERY_SPECS,
    canary_plan_from_seed,
    compile_universal_query_spec,
)
from backend_mirror.source_adapters.signal_strategy_planner import plan_strategies  # noqa: E402
from backend_mirror.source_adapters.cheap_discovery_prefilter import DiscoveryHit, cheap_rank_hits  # noqa: E402
from backend_mirror.source_adapters.universal_evidence import extract_evidence_from_text  # noqa: E402


def main() -> int:
    rows = []
    for seed in CANARY_QUERY_SPECS:
        plan = canary_plan_from_seed(seed, requested_count=5)
        spec = compile_universal_query_spec(plan, requested_count=5)
        strategies = plan_strategies(spec)
        adapters = sorted({
            adapter
            for item in strategies
            for adapter in (item.adapter_affinity or ("generic_web_research_v1",))
        })
        rows.append({
            "id": seed["id"],
            "query": seed["query"],
            "required_signals": list(spec.required_signals),
            "cost_budget": spec.cost_budget,
            "strategies": len(strategies),
            "strategy_samples": [item.search_query for item in strategies[:3]],
            "adapters_affinity": adapters,
            "capability_status_seed": spec.capability_status,
        })

    # Smoke cheap prefilter + evidence on a synthetic page (not a lead claim).
    hits = cheap_rank_hits([
        DiscoveryHit(
            "Acme Spa inaugura nuova sede a Milano",
            "https://www.acme-demo.example/news/sede",
            "Acme Spa ha aperto una nuova sede operativa nel 2026 e assume un commerciale.",
        ),
        DiscoveryHit("Elenco PagineGialle", "https://www.paginegialle.it/x", "directory"),
    ])
    evidence = extract_evidence_from_text(
        text="Acme Spa ha inaugurato una nuova sede a Milano il 10 gennaio 2026 e assume un commerciale.",
        source_url="https://www.acme-demo.example/news/sede",
        source_class="corporate_newsroom",
        publisher="Acme Spa",
        company_name_hint="Acme Spa",
        requested_signals=("new_location", "hiring_sales"),
    )

    out = {
        "engine": "UniversalSignalDiscoveryEngine",
        "offline_queries": len(rows),
        "target_qualified_per_query": 5,
        "target_total_qualified": 50,
        "live_queries": 0,
        "rows": rows,
        "prefilter_accepted": len(hits),
        "evidence_events": [item.event_type for item in evidence],
        "customer_visible": False,
        "production_untouched": True,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
