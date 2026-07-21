"""Regression guard: publication must flow through LeadAcceptanceService."""
from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _python_files():
    for path in ROOT.rglob("*.py"):
        if any(part in {"__pycache__", ".venv", "node_modules"} for part in path.parts):
            continue
        yield path


def test_worker_publish_path_uses_persist_and_publish_candidates():
    source = (ROOT / "worker_supabase.py").read_text(encoding="utf-8")
    assert "persist_and_publish_candidates" in source
    assert "if canonical_lifecycle_plan is not None:" not in source.split("_publish_job_results_safe")[1].split("def ")[0]
    assert "_commercial_intent_for_acceptance" in source


def test_commercial_lifecycle_stamps_acceptance_authority():
    source = (ROOT / "commercial_lifecycle.py").read_text(encoding="utf-8")
    assert "_lead_acceptance_authority" in source
    assert "LeadAcceptanceService" in source


def test_no_direct_results_publish_without_acceptance_marker():
    # Static scan: searches.results updates outside worker publish helper must mention acceptance.
    skip = {"test_no_publication_bypass.py"}
    offenders = []
    for path in _python_files():
        if path.name in {"worker_supabase.py", "run_parallel_enrich_job.py", "test_lead_acceptance_service.py"}:
            continue
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        if rel in skip:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if 'table("searches").update' in text and '"results"' in text:
            if "LeadAcceptanceService" not in text and "persist_and_publish_candidates" not in text:
                offenders.append(str(path.relative_to(ROOT)))
    assert offenders == [], f"Direct results publish bypass: {offenders}"


def test_evaluate_publication_gate_delegates_to_lead_acceptance_service():
    tree = ast.parse((ROOT / "commercial_lifecycle.py").read_text(encoding="utf-8"))
    fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "evaluate_publication_gate")
    src = ast.get_source_segment((ROOT / "commercial_lifecycle.py").read_text(encoding="utf-8"), fn) or ""
    assert "evaluate_lead" in src
