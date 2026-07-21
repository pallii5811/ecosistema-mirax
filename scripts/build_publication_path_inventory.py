"""Generate publication path inventory for CI guard."""
from __future__ import annotations

import ast
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend_mirror"
ARTIFACTS = ROOT / "artifacts"

MARKERS = {
    "searches_results_write": re.compile(r'table\s*\(\s*["\']searches["\']\s*\)\s*\.\s*update'),
    "publish_search_candidate_call": re.compile(r"publish_search_candidate\s*\("),
    "publish_accepted_leads_call": re.compile(r"publish_accepted_leads\s*\("),
}

AUTHORIZED = {
    "lead_acceptance/publication.py",
    "commercial_lifecycle.py",
    "worker_supabase.py",
    "run_parallel_enrich_job.py",
}

SKIP_FILES = {
    "test_cost_quality_guards.py",
    "test_hiring_canary_forensic_replay.py",
    "test_hiring_unique_employer.py",
    "test_shadow_resume.py",
    "test_source_adapter_dispatcher_canary.py",
    "test_universal_engine_live_path.py",
    "test_publication_path_inventory.py",
    "test_no_publication_bypass.py",
    "test_publication_path_guard.py",
}


def _scan_file(path: Path) -> List[Dict[str, Any]]:
    rel = str(path.relative_to(BACKEND)).replace("\\", "/")
    if rel in SKIP_FILES or path.name.startswith("test_"):
        return []
    text = path.read_text(encoding="utf-8", errors="ignore")
    hits: List[Dict[str, Any]] = []
    for name, pattern in MARKERS.items():
        if not pattern.search(text):
            continue
        has_las = "LeadAcceptanceService" in text or "evaluate_lead" in text or "lead_acceptance" in text
        has_pub = "publish_accepted_leads" in text or "persist_and_publish_candidates" in text
        bypass = rel not in AUTHORIZED and not has_pub
        hits.append({
            "marker": name,
            "file": rel,
            "lead_acceptance_service": has_las,
            "publish_accepted_leads": has_pub,
            "bypass_status": "unauthorized" if bypass else "authorized",
        })
    return hits


def build_inventory() -> Dict[str, Any]:
    paths: List[Dict[str, Any]] = []
    for path in BACKEND.rglob("*.py"):
        if any(p in path.parts for p in {"__pycache__", ".venv"}):
            continue
        paths.extend(_scan_file(path))
    unauthorized = [p for p in paths if p["bypass_status"] == "unauthorized"]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "paths": paths,
        "unauthorized_count": len(unauthorized),
        "unauthorized_paths": unauthorized,
    }


def write_inventory(out: Path | None = None) -> Path:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    target = out or ARTIFACTS / "publication-path-inventory.json"
    inv = build_inventory()
    target.write_text(json.dumps(inv, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


if __name__ == "__main__":
    path = write_inventory()
    inv = json.loads(path.read_text(encoding="utf-8"))
    print(f"Wrote {path} unauthorized={inv['unauthorized_count']}")
