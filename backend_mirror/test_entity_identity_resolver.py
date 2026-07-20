"""Mandatory contract tests for the shared entity/official-domain resolver."""

from __future__ import annotations

import asyncio
from dataclasses import replace

from backend_mirror.agents.entity_identity_resolver import (
    COMMERCIAL_ENTITY_CLASSES,
    CachedEntityIdentity,
    EntityIdentityRequest,
    MemoryEntityDomainCache,
    classify_entity,
    normalize_company_name,
    resolve_entity_identity,
)
from backend_mirror.source_adapters.growth import GrowthSignalsAdapter
from backend_mirror.source_adapters.procurement import ProcurementAdapter, DomainResolutionResult
from backend_mirror.test_growth_signals_adapter import fixture_rows, request as growth_request, _async_result
from backend_mirror.test_procurement_adapter import request as procurement_request


def _verify_ok(company: str, url: str, location: str = ""):
    from backend_mirror.agents.entity_identity_resolver import host_of, identity_tokens

    host = host_of(url)
    host_label = host.split(".")[0].casefold()
    tokens = identity_tokens(company)
    # Reject clearly unrelated hosts; brand/acronym ownership is handled by the resolver gate.
    if tokens and not any(token in host_label or token in host.casefold() for token in tokens):
        # Still allow short brand-like hosts when any 3+ char stem overlaps company compact form.
        compact = "".join(tokens)
        if host_label not in compact and not any(host_label.startswith(token[:4]) for token in tokens if len(token) >= 4):
            if host_label not in {"nmitools", "asi", "acmegroup"}:
                return None
    return {
        "url": f"https://{host}/",
        "status": "verified",
        "confidence": 0.93,
        "score": 93,
        "evidence": ["company_tokens_in_host", "legal_name_in_page"],
        "resolution_method": "positive_page_identity",
        "resolution_source": "test_verify",
    }


def _serp_ok(company: str, location: str = "", max_results: int = 5):
    return {
        "url": "https://acme-industria.it/",
        "status": "verified",
        "confidence": 0.91,
        "score": 91,
        "evidence": ["company_tokens_in_host"],
        "resolution_method": "serp_identity",
        "resolution_source": "serp_identity",
    }


def test_1_ragione_sociale_maps_to_direct_domain() -> None:
    cache = MemoryEntityDomainCache()
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Acme Industria S.r.l.",
            presented_domain="acmeindustria.it",
            allow_serp=False,
        ),
        cache=cache,
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "verified"
    assert result.official_domain == "acmeindustria.it"
    assert result.entity_class == "operating_company"
    assert result.rejection_code is None


def test_2_brand_differs_from_legal_name() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Nuova Meccanica Italiana S.p.A.",
            brand_name="NMI Tools",
            presented_domain="nmitools.it",
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "verified"
    assert result.official_domain == "nmitools.it"
    assert result.operating_entity_name.startswith("Nuova Meccanica")


def test_3_valid_acronym() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Azienda Servizi Integrati S.r.l.",
            acronym="ASI",
            presented_domain="asi.it",
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "verified"
    assert result.official_domain == "asi.it"


def test_4_official_domain_from_company_page() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Beta Logistica Srl",
            evidence_url="https://betalogistica.it/newsroom/apertura",
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "verified"
    assert result.official_domain == "betalogistica.it"
    assert result.resolution_source == "evidence_url"


def test_5_cache_hit_without_serp() -> None:
    cache = MemoryEntityDomainCache()
    cache.put(
        "Cached Co Srl",
        "Italia",
        CachedEntityIdentity(
            official_domain="cached-co.it",
            operating_entity_name="Cached Co Srl",
            entity_class="operating_company",
            identity_confidence=0.95,
            identity_evidence=("cache_verified_domain",),
            resolution_method="cache_lookup",
            resolution_source="verified_domain_cache",
        ),
    )
    serp_calls = {"n": 0}

    def serp_fn(company, location="", max_results=5):
        serp_calls["n"] += 1
        raise AssertionError("SERP must not run on cache hit")

    result = resolve_entity_identity(
        EntityIdentityRequest(company_name="Cached Co Srl", geography="Italia", allow_serp=True, budget_eur=0.1),
        cache=cache,
        verify_fn=_verify_ok,
        serp_fn=serp_fn,
    )
    assert result.identity_status == "verified"
    assert result.official_domain == "cached-co.it"
    assert result.resolution_source == "verified_domain_cache"
    assert serp_calls["n"] == 0
    assert cache.hits >= 1


def test_6_directory_portals_rejected() -> None:
    for domain in ("fatturatoitalia.it", "companyreports.it"):
        result = resolve_entity_identity(
            EntityIdentityRequest(company_name="Dir Co Srl", presented_domain=domain, allow_serp=False),
            cache=MemoryEntityDomainCache(),
            verify_fn=_verify_ok,
            serp_fn=_serp_ok,
        )
        assert result.identity_status == "rejected"
        assert result.entity_class == "directory"
        assert result.rejection_code == "DIRECTORY_OR_PORTAL_DOMAIN"


def test_7_publisher_rejected() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Quotidiano Locale",
            presented_domain="quotidiano-locale.it",
            source_payload={"source_publisher": "Quotidiano Locale"},
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "rejected"
    assert result.entity_class == "publisher"
    assert result.rejection_code == "PUBLISHER_AS_COMPANY"


def test_8_public_body_rejected_for_company_query() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Comune di Roma",
            presented_domain="comune.roma.it",
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "rejected"
    assert result.entity_class == "public_authority"
    assert result.rejection_code == "PUBLIC_BODY_AS_COMPANY"


def test_9_association_and_union_rejected_for_company_query() -> None:
    association = resolve_entity_identity(
        EntityIdentityRequest(company_name="Associazione Commercianti Milano APS", allow_serp=False),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    union = resolve_entity_identity(
        EntityIdentityRequest(company_name="Sicet Liguria", presented_domain="sicetliguria.it", allow_serp=False),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert association.rejection_code == "ASSOCIATION_AS_COMPANY"
    assert union.rejection_code == "TRADE_UNION_AS_COMPANY"


def test_10_group_domain_with_proof_passes_controlled() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Acme Manufacturing Srl",
            presented_domain="acmegroup.it",
            group_domain_proof=True,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status == "verified"
    assert result.entity_class == "company_group"
    assert result.official_domain == "acmegroup.it"
    assert "group_domain_proof" in result.identity_evidence


def test_11_ambiguous_domain_unresolved() -> None:
    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Gamma Servizi Srl",
            presented_domain="example-portal.net",
            allow_serp=False,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_ok,
    )
    assert result.identity_status in {"unresolved", "rejected"}
    assert result.official_domain is None
    assert result.rejection_code in {"OFFICIAL_DOMAIN_AMBIGUOUS", "OFFICIAL_DOMAIN_UNRESOLVED"}


def test_12_max_cost_respected() -> None:
    serp_calls = {"n": 0}

    def serp_fn(company, location="", max_results=5):
        serp_calls["n"] += 1
        return _serp_ok(company, location, max_results)

    def verify_none(*_a, **_k):
        return None

    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Delta Srl",
            allow_serp=True,
            budget_eur=0.001,
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=verify_none,
        serp_fn=serp_fn,
    )
    assert result.rejection_code == "IDENTITY_BUDGET_EXCEEDED"
    assert result.cost_eur == 0.0
    assert serp_calls["n"] == 0


def test_13_procurement_identity_wiring_unchanged_discovery_contract() -> None:
    async def provider(_request, _offset, _limit):
        from backend_mirror.source_adapters.procurement import ProcurementProviderResult
        from datetime import date
        return ProcurementProviderResult(
            (
                {
                    "source_id": "anac_opendata",
                    "winner_name": "Winner Co Srl",
                    "winner_role": "winner",
                    "award_date": date.today().isoformat(),
                    "award_id": "A1",
                    "title": "Lavori edili manutenzione",
                    "geography": "Torino Piemonte",
                    "source_url": "https://dati.anticorruzione.it/opendata/A1",
                    "source_publisher": "ANAC",
                    "publisher": "ANAC",
                    "source_class": "public_procurement_portal",
                    "official_domain": "",
                    "amount": 100000,
                    "status": "award",
                    "role": "winner",
                },
            ),
            True,
            0.0,
        )

    async def resolver(name, presented, location, budget):
        return DomainResolutionResult(
            url="https://winner-co.it/",
            confidence=0.94,
            score=94,
            evidence=("company_tokens_in_host",),
            resolution_source="test",
            resolution_method="test",
            cost_eur=0.005,
            resolved_at="2026-07-17T00:00:00+00:00",
        )

    result = asyncio.run(
        ProcurementAdapter((provider,), domain_resolver=resolver).discover(
            replace(procurement_request(count=1, budget=0.1))
        )
    )
    assert len(result.candidates) == 1
    assert result.candidates[0].official_domain == "winner-co.it"


def test_14_growth_rejects_union_keeps_operating_company() -> None:
    rows = list(fixture_rows("expansion")[:1])
    rows[0] = {
        **rows[0],
        "company_name": "Sicet Liguria",
        "official_domain": "sicetliguria.it",
        "source_url": "https://sicetliguria.it/news",
        "evidence_excerpt": "Sicet Liguria inaugura una nuova sede a Chiavari.",
    }
    good = {
        **fixture_rows("expansion")[0],
        "company_name": "Beta Logistica Srl",
        "official_domain": "betalogistica.it",
        "source_url": "https://betalogistica.it/newsroom/apertura",
        "source_publisher": "Beta Logistica Srl",
        "evidence_excerpt": "Beta Logistica Srl inaugura una nuova sede a Milano.",
    }

    async def mixed(_request, _offset, _limit):
        from backend_mirror.source_adapters.growth import GrowthProviderResult
        return GrowthProviderResult((rows[0], good), True, 0.0)

    result = asyncio.run(GrowthSignalsAdapter((mixed,)).discover(growth_request("expansion", count=5)))
    assert all(item.official_domain != "sicetliguria.it" for item in result.candidates)
    assert any(item.official_domain == "betalogistica.it" for item in result.candidates)
    assert "TRADE_UNION_AS_COMPANY" in result.warnings


def test_15_normalize_legal_suffix_and_classifier_coverage() -> None:
    assert "srl" not in normalize_company_name("Acme Industria S.r.l.")
    assert classify_entity("Comune di Milano") == "public_authority"
    assert classify_entity("Associazione Sportiva APS") == "association"
    assert classify_entity("CGIL Lombardia") == "trade_union"
    assert classify_entity("Acme Industria Srl") == "operating_company"

def test_news_evidence_host_does_not_classify_target_as_directory() -> None:
    """Funding/news evidence URLs are portals; they must not poison company class."""
    def _serp_sirius(company: str, location: str = "", max_results: int = 5):
        return {
            "url": "https://siriusgame.it/",
            "status": "verified",
            "confidence": 0.91,
            "score": 91,
            "evidence": ["company_tokens_in_host"],
            "resolution_method": "serp_identity",
            "resolution_source": "serp_identity",
        }

    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Sirius Game",
            evidence_url="https://finanza.repubblica.it/News/2026/06/15/sirius_game_round/",
            presented_domain="",
            geography="Italia",
            budget_eur=0.005,
            allow_serp=True,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_sirius,
    )
    assert result.identity_status == "verified", result.rejection_code
    assert result.official_domain == "siriusgame.it"
    assert result.rejection_code is None


def test_domain_shaped_company_name_resolves_without_serp() -> None:
    """LexDo.it / Sintropy.AI style names imply a verifiable corporate host."""
    from backend_mirror.agents.entity_identity_resolver import domain_candidates_from_company_name

    assert "sintropy.ai" in domain_candidates_from_company_name("Sintropy.AI")
    assert "lexdo.it" in domain_candidates_from_company_name("LexDo.it")
    assert "acme.it" in domain_candidates_from_company_name("ACME S.p.A.") or "acme.com" in domain_candidates_from_company_name(
        "ACME S.p.A."
    )

    def _serp_must_not_run(*_a, **_k):
        raise AssertionError("SERP must not run when name-shaped host verifies")

    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Sintropy.AI",
            evidence_url="https://www.energiamercato.it/notizie/enertech/sintropy-ai-round/",
            presented_domain="",
            geography="Italia",
            budget_eur=0.0,
            allow_serp=True,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
            source_payload={"source_text": "Sintropy.AI chiude un round. Visita sintropy.ai per dettagli."},
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_must_not_run,
    )
    assert result.identity_status == "verified", result.rejection_code
    assert result.official_domain == "sintropy.ai"
    assert "free_owned_host_candidate" in result.identity_evidence


def test_compact_brand_host_guess_for_multi_token_name() -> None:
    def _serp_must_not_run(*_a, **_k):
        raise AssertionError("SERP must not run when compact host verifies")

    result = resolve_entity_identity(
        EntityIdentityRequest(
            company_name="Sirius Game",
            evidence_url="https://example-news.test/sirius",
            presented_domain="",
            geography="Italia",
            budget_eur=0.0,
            allow_serp=True,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
        ),
        cache=MemoryEntityDomainCache(),
        verify_fn=_verify_ok,
        serp_fn=_serp_must_not_run,
    )
    assert result.identity_status == "verified", result.rejection_code
    assert result.official_domain == "siriusgame.it"
