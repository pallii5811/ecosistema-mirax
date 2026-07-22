"""Offline checks for antincendio canary 45acce51 first-loss.

SERP soft-cap reset across industrial strategies + URLS_PER_WAVE=5 left
TEXA/Mancinardi pending while budget died on supplemental SERPs.
"""
from __future__ import annotations

from source_adapters.cheap_discovery_prefilter import DiscoveryHit, prefilter_discovery_hit
from source_adapters.generic_web_budget import GenericWebDiscoveryState, QUERY_COST_EUR


def test_prefilter_rejects_orvieto_and_bmw():
    welcare = DiscoveryHit(
        title="Welcare inaugura il nuovo stabilimento produttivo di Orvieto",
        url="https://labomar.com/2025/09/29/welcare-inaugura-nuovo-stabilimento-produttivo-orvieto/",
        snippet="Il 26 settembre 2025 è stato inaugurato a Orvieto (TR) il nuovo stabilimento",
    )
    assert prefilter_discovery_hit(welcare).accepted is False
    assert prefilter_discovery_hit(welcare).reason == "out_of_scope_geography"

    bmw = DiscoveryHit(
        title="Nel 2025 BMW Group riduce ulteriormente le emissioni",
        url="https://www.press.bmwgroup.com/italy/article/detail/T0455373IT/x",
        snippet="BMW Group inaugura il nuovo stabilimento e riduce le emissioni della flotta",
    )
    assert prefilter_discovery_hit(bmw).accepted is False
    assert prefilter_discovery_hit(bmw).reason == "famous_or_global_brand"


def test_cumulative_serp_blocks_soft_cap_reset():
    hard = 0.10
    state = GenericWebDiscoveryState(discovery_spent_eur=0.0, provider_calls=0)
    # Simulate engine injecting prior industrial batches' SERP burn.
    prior = 14 * QUERY_COST_EUR
    state.discovery_spent_eur = max(state.discovery_spent_eur, prior)
    # Soft first-wave pool is exhausted; no more discovery SERP without followups.
    assert state.discovery_remaining_eur(hard) + 1e-9 < QUERY_COST_EUR


if __name__ == "__main__":
    test_prefilter_rejects_orvieto_and_bmw()
    test_cumulative_serp_blocks_soft_cap_reset()
    print("ok")
