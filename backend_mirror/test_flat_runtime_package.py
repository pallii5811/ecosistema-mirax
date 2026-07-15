import os
import sys

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")

from backend_mirror import worker_supabase


def test_flat_runtime_installs_canonical_backend_package_alias(monkeypatch, tmp_path):
    original_package = sys.modules.get("backend_mirror")
    original_worker = sys.modules.get("backend_mirror.worker_supabase")
    monkeypatch.delitem(sys.modules, "backend_mirror", raising=False)
    monkeypatch.delitem(sys.modules, "backend_mirror.worker_supabase", raising=False)
    monkeypatch.setitem(sys.modules, "flat_worker_test", worker_supabase)

    installed = worker_supabase._install_flat_runtime_package_alias(
        str(tmp_path / "flat-release"),
        str(tmp_path / "parent-without-package"),
        module_name="flat_worker_test",
    )

    assert installed is True
    package = sys.modules["backend_mirror"]
    assert package.__path__ == [str(tmp_path / "flat-release")]
    assert sys.modules["backend_mirror.worker_supabase"] is worker_supabase

    if original_package is not None:
        sys.modules["backend_mirror"] = original_package
    if original_worker is not None:
        sys.modules["backend_mirror.worker_supabase"] = original_worker
