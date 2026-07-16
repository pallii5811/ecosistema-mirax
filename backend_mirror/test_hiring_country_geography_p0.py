from __future__ import annotations

import asyncio

import pytest

from backend_mirror.commercial_lifecycle import evaluate_publication_gate
from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.hiring import HiringAdapter, HiringProviderResult
from backend_mirror.source_adapters.hiring_budget import HiringDiscoveryState
from backend_mirror.source_adapters.hiring_qualification import (
    collect_processed_employer_keys,
    evaluate_vacancy_geography,
)
from backend_mirror.source_adapters.shadow_runtime import (
    candidate_to_lifecycle_shadow_payload,
    revalidate_hiring_payload_geographies,
)


ITALY_PLAN = {
    "schema_version": "1.0.0",
    "raw_query": "Trovami aziende in Italia che stanno assumendo marketing manager.",
    "target": {"entity_types": ["company"], "geographies": ["Italia"], "required_attributes": []},
    "signal_policy": {
        "required_signals": ["hiring_marketing"],
        "maximum_age_days_by_signal": {"hiring_marketing": 60},
    },
    "source_policy": {
        "allowed_source_classes": ["company_careers", "job_board"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    },
    "evidence_policy": {"minimum_evidence_confidence": 0.75},
    "commercial_hypotheses": [{
        "signals": ["hiring_marketing"],
        "buyer_problem": "La crescita marketing richiede nuove competenze.",
        "implied_need": "Servizi per accelerare il marketing.",
        "relevance_to_offer": "Vacancy marketing verificata.",
        "triggering_events": ["vacancy marketing attiva"],
    }],
    "seller": {
        "offer_category": "b2b",
        "products_or_services": ["sales intelligence"],
        "problems_solved": ["pipeline growth"],
        "preferred_buyer_roles": ["marketing manager"],
    },
}


def _request(geographies=("Italia",)) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=("hiring_marketing",),
        signal_match_mode="all",
        geographies=tuple(geographies),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=0.125,
        query="marketing manager",
        sectors=(),
        technical_filters={},
        cursor=None,
    )


def _record(**overrides):
    record = {
        "company_name": "Acme Italia Srl",
        "vacancy_title": "Marketing Manager",
        "location": "Bologna, Italia",
        "published_at": "2026-07-10",
        "active": True,
        "active_evidence": "live_jobposting_page",
        "active_verification_method": "http_200_jsonld_jobposting",
        "source_url": "https://careers.acme.test/jobs/marketing-manager-12345",
        "source_publisher": "careers.acme.test",
        "source_class": "company_careers",
        "extraction_method": "schema_org_jobposting",
        "employer_official_domain": "acme.test",
        "official_domain_verified": True,
        "employer_is_direct": True,
        "entity_class": "operating_company",
        "domain_verification_evidence": ["company_careers_host_match", "legal_name_in_page"],
        "evidence": "Acme Italia Srl cerca Marketing Manager (pubblicata 2026-07-10)",
    }
    record.update(overrides)
    return record


async def _adapter_result(record, geographies=("Italia",)):
    async def provider(request, state, limit):
        del request, limit
        return HiringProviderResult(
            records=(record,),
            exhausted=True,
            discovery_state=state if isinstance(state, HiringDiscoveryState) else HiringDiscoveryState(),
            urls_processed=1,
            urls_discovered_total=1,
        )

    return await HiringAdapter(providers=(provider,)).discover(_request(geographies))


@pytest.mark.parametrize(
    ("case", "record_overrides", "geographies", "expected", "method"),
    [
        ("italia_bologna", {"location": "Bologna, Italia"}, ("Italia",), True, "explicit_country_location"),
        ("italia_milano", {"location": "Milano, Italy"}, ("Italia",), True, "explicit_country_location"),
        ("structured_it", {"location": "", "address_country": "IT"}, ("Italia",), True, "structured_address_country"),
        ("usa", {"location": "Wilmington, Delaware, United States"}, ("Italia",), False, "no_match"),
        ("australia", {"location": "Sydney, Australia"}, ("Italia",), False, "no_match"),
        ("mexico", {"location": "Mexico City, Mexico"}, ("Italia",), False, "no_match"),
        ("workday_locale_not_geo", {"location": "Boston, United States", "source_url": "https://acme.wd1.myworkdayjobs.com/it-it/jobs/job/marketing-manager_r12345"}, ("Italia",), False, "no_match"),
        ("it_title_not_geo", {"location": "", "vacancy_title": "IT Marketing Manager"}, ("Italia",), False, "no_match"),
        ("europe", {"location": "Europe"}, ("Italia",), False, "no_match"),
        ("remote_italy", {"location": "Remote - Italy"}, ("Italia",), True, "explicit_country_location"),
        ("lombardia_milano", {"location": "Milano, Italia"}, ("Lombardia",), True, "lombardia_location_mapping"),
        ("lombardia_bologna", {"location": "Bologna, Italia"}, ("Lombardia",), False, "no_match"),
        ("multi_italy", {"location": "Paris, France", "additional_locations": ["Roma, Italia"]}, ("Italia",), True, "additional_location_explicit_country"),
        ("multi_foreign", {"location": "Paris, France", "additional_locations": ["Berlin, Germany"]}, ("Italia",), False, "no_match"),
    ],
)
def test_country_geography_contract_through_adapter_shadow_and_lifecycle(
    case, record_overrides, geographies, expected, method
):
    record = _record(**record_overrides)
    assessment = evaluate_vacancy_geography(
        location=record.get("location", ""),
        title=record.get("vacancy_title", ""),
        address_locality=record.get("address_locality", ""),
        address_region=record.get("address_region", ""),
        address_country=record.get("address_country", ""),
        additional_locations=record.get("additional_locations", ()),
        source_url=record.get("source_url", ""),
        geographies=geographies,
    )
    assert assessment.geography_match is expected, case
    assert assessment.geography_match_method == method, case
    assert assessment.geography_rejection_code == ("" if expected else "GEO_OUT_OF_SCOPE")

    adapter_result = asyncio.run(_adapter_result(record, geographies))
    if expected:
        assert len(adapter_result.candidates) == 1, case
        candidate = adapter_result.candidates[0]
        payload = candidate_to_lifecycle_shadow_payload(candidate, opportunity_value_score=0.9)
        plan = {**ITALY_PLAN, "target": {**ITALY_PLAN["target"], "geographies": list(geographies)}}
        gate = evaluate_publication_gate(payload, plan, cost_within_budget=True)
        assert payload["geography_match"] is True
        assert payload["geography_match_method"] == method
        assert gate["geography_matches_target"] is True
        assert "GEO_OUT_OF_SCOPE" not in gate["rejection_codes"]
    else:
        assert adapter_result.candidates == (), case
        assert "GEO_OUT_OF_SCOPE" in adapter_result.warnings
        legacy_payload = {
            "source_adapter_id": "structured_hiring_v1",
            "matched_signals": ["hiring_marketing"],
            "azienda": record["company_name"],
            "sito": "https://acme.test",
            "citta": record.get("location", ""),
            "vacancy_title": record.get("vacancy_title", ""),
            "vacancy_url": record.get("source_url", ""),
            "address_country": record.get("address_country", ""),
            "additional_locations": record.get("additional_locations", ()),
        }
        accepted, rejected = revalidate_hiring_payload_geographies([legacy_payload], geographies)
        assert accepted == []
        assert len(rejected) == 1
        assert rejected[0]["rejection_code"] == "GEO_OUT_OF_SCOPE"


def _existing_payload(name, domain, location):
    return {
        "source_adapter_id": "structured_hiring_v1",
        "matched_signals": ["hiring_marketing"],
        "azienda": name,
        "sito": f"https://{domain}",
        "citta": location,
        "vacancy_title": "Marketing Manager",
        "vacancy_url": f"https://jobs.example/{domain}/marketing-manager",
    }


def test_revalidate_five_existing_payloads_removes_four_from_resume_count():
    payloads = [
        _existing_payload("Red Bull S.r.l.", "redbull.com", "Bologna, Emilia-Romagna, Italia"),
        _existing_payload("DuPont", "dupont.com", "Wilmington, Delaware, United States"),
        _existing_payload("Flexera", "flexera.com", "Sydney, Australia"),
        _existing_payload("LivaNova", "livanova.com", "US Remote, United States"),
        _existing_payload("Viatris", "viatris.com", "Mexico City, Mexico"),
    ]
    accepted, rejected = revalidate_hiring_payload_geographies(payloads, ("Italia",))
    assert [item["azienda"] for item in accepted] == ["Red Bull S.r.l."]
    assert {item["azienda"] for item in rejected} == {"DuPont", "Flexera", "LivaNova", "Viatris"}
    assert all(item["rejection_code"] == "GEO_OUT_OF_SCOPE" for item in rejected)
    processed = collect_processed_employer_keys((), accepted)
    assert processed == ("domain:redbull.com",)
    assert len(processed) == 1


def test_geography_rejections_remain_identity_deduplicated_across_resume_rounds():
    rejected = _existing_payload("DuPont", "dupont.com", "United States")
    rejected["rejection_code"] = "GEO_OUT_OF_SCOPE"
    repeated = dict(rejected)
    by_employer = {
        key: payload
        for payload in (rejected, repeated)
        if (key := next(iter(collect_processed_employer_keys((), [payload])), ""))
    }
    assert list(by_employer) == ["domain:dupont.com"]
    assert len(by_employer) == 1
