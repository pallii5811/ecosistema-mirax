"""Static regression: no publication bypass outside lead_acceptance.publication."""
from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent

_PUBLISH_MARKERS = {
    "publish_accepted_leads",
    "publish_search_candidate",
    'table("searches").update',
    '"results"',
}

_ALLOWED_DIRECT_PUBLISH = {
    "commercial_lifecycle.py",
    "lead_acceptance/publication.py",
    "worker_supabase.py",
    "run_parallel_enrich_job.py",
    "test_lead_acceptance_service.py",
    "test_commercial_lifecycle.py",
    "test_publication_path_guard.py",
    "test_no_publication_bypass.py",
}


def _python_files():
    for path in ROOT.rglob("*.py"):
        if any(part in {"__pycache__", ".venv", "node_modules"} for part in path.parts):
            continue
        yield path


def test_no_publication_bypass_without_publish_accepted_leads():
    offenders = []
    for path in _python_files():
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        if rel in _ALLOWED_DIRECT_PUBLISH:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if 'table("searches").update' in text and '"results"' in text:
            if "publish_accepted_leads" not in text:
                offenders.append(rel)
        if "publish_search_candidate" in text and "publish_accepted_leads" not in text:
            offenders.append(rel)
    assert offenders == [], f"Publication bypass detected: {offenders}"


def test_publication_module_exports_authoritative_entrypoint():
    from lead_acceptance.publication import publish_accepted_leads

    assert callable(publish_accepted_leads)


def test_lead_acceptance_service_delegates_to_package():
    tree = ast.parse((ROOT / "lead_acceptance_service.py").read_text(encoding="utf-8"))
    imports_package = any(
        isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("lead_acceptance")
        for node in tree.body
    )
    assert imports_package
