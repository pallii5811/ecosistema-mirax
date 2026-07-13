import tempfile

import pytest

from adaptive_audit import AdaptiveAuditCache, adaptive_modules
from url_safety import UnsafeUrlError, assert_safe_public_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "file:///etc/passwd",
        "http://user:pass@example.com/",
        "https://example.com:8443/",
    ],
)
def test_ssrf_guard_rejects_unsafe_destinations(url):
    with pytest.raises(UnsafeUrlError):
        assert_safe_public_url(url)


def test_adaptive_modules_are_policy_driven_and_contact_fail_safe():
    modules = adaptive_modules(
        {
            "collect_contacts": False,
            "collect_social_profiles": False,
            "detect_technologies": True,
            "detect_commercial_signals": False,
            "modules": [],
        },
        {"email": "info@example.com"},
    )
    assert modules == {"identity", "technology", "performance"}
    assert "contacts" in adaptive_modules({}, {})


def test_module_cache_is_domain_scoped_and_reusable():
    with tempfile.TemporaryDirectory() as directory:
        cache = AdaptiveAuditCache(f"{directory}/audit.sqlite")
        cache.put("https://www.example.com/path", "contacts", {"email": "info@example.com"})
        hit = cache.get_many("https://example.com/other", {"contacts", "technology"})
        assert hit == {"contacts": {"email": "info@example.com"}}
