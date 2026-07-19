"""Hiring semantic evidence bridge + deterministic verifier proxy tests."""

from __future__ import annotations

from datetime import date

from backend_mirror.semantic_intelligence import (
    EVENT_SCHEMA_VERSION,
    GROUNDING_SCHEMA_VERSION,
    HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP,
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
    apply_hiring_relationship_proxy,
)
from backend_mirror.source_adapters.hiring_semantic_bridge import (
    build_hiring_semantic_evidence_bundle,
    find_customer_acquisition_duty,
    has_customer_acquisition_duty,
)


def _s1_contract() -> SemanticQueryContract:
    return SemanticQueryContract.from_model(
        {
            "query_goal": "Aziende lombarde che ampliano la squadra commerciale new business",
            "seller": {"description": "B2B"},
            "offer": {"description": "sales enablement"},
            "target_entity_types": ["operating_company"],
            "target_company_description": "employer hiring sales",
            "event_or_state_description": "active sales vacancy with customer acquisition duties",
            "target_role_in_event": "employer",
            "required_relationships": [HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP],
            "optional_relationships": [],
            "excluded_roles": ["recruiter", "publisher", "authority"],
            "excluded_entities": ["anonymous clients"],
            "geography": ["Lombardia"],
            "industry": [],
            "size_constraints": {},
            "temporal_constraints": {"maximum_age_days": 180},
            "positive_conditions": ["active vacancy", "customer acquisition duty"],
            "negative_conditions": ["customer care only", "title without duties"],
            "must_have_facts": ["employer", "vacancy url", "duty excerpt"],
            "forbidden_inferences": ["title alone proves acquisition"],
            "data_requirements": ["official_domain", "source_url", "event_date"],
            "ranking_objective": "freshest grounded employer",
            "acceptance_rubric": [
                "target_role_employer_grounded",
                "sales_customer_acquisition_team_expansion_by_target_company_grounded",
            ],
            "discovery_hypotheses": [],
            "clarification_required": False,
            "confidence": 0.95,
            "canonical_signal_hints": ["hiring_sales"],
        },
        original_query="Trova aziende lombarde che stanno ampliando la squadra incaricata di sviluppare nuovi clienti.",
        requested_count=2,
    )


def _base_interpretation(text: str, company: str = "VitalAire", **overrides) -> SemanticEventInterpretation:
    payload = {
        "entities": [{"name": company, "type": "operating_company", "role": "employer"}],
        "events": [{"type": "active_job_opening", "status": "active"}],
        "relations": [],
        "target_company": company,
        "target_entity_role": "employer",
        "event_type": "active_job_opening",
        "open_predicate": "hiring sales",
        "actor": company,
        "recipient": None,
        "provider": None,
        "beneficiary": None,
        "investor": None,
        "employer": company,
        "recruiter": None,
        "publisher": "careers",
        "authority": None,
        "predicate": "hires",
        "direction": "employer_to_role",
        "event_status": "active",
        "event_date": "2026-07-01",
        "amount": None,
        "location": "Lombardia",
        "technology": None,
        "role": "Commerciale",
        "negated": False,
        "hypothetical": False,
        "conditional": False,
        "rumor": False,
        "historical": False,
        "certainty": 0.9,
        "query_match": False,
        "query_match_reason": "model uncertain about team expansion phrasing",
        "satisfied_relationships": [],
        "acceptance_rubric_passed": [],
        "buyer_need": "",
        "why_now": "open vacancy",
        "evidence_excerpt": text[:120],
        "evidence_start": 0,
        "evidence_end": min(120, len(text)),
        "confidence": 0.9,
        "rejection_reason": None,
    }
    payload.update(overrides)
    return SemanticEventInterpretation.from_model(payload)


def _verify(text: str, company: str = "VitalAire", meta=None, **interp_overrides):
    contract = _s1_contract()
    interpretation = _base_interpretation(text, company=company, **interp_overrides)
    if meta is None:
        bundle = build_hiring_semantic_evidence_bundle({
            "company_name": company,
            "vacancy_title": interp_overrides.get("role") or "Commerciale - Lombardia Nord",
            "description": text,
            "location": "Lombardia Nord",
            "published_at": "2026-07-01",
            "source_url": "https://careers.airliquide.com/vacancy/commerciale",
            "employer_official_domain": "airliquide.com",
            "active": True,
            "employer_is_direct": True,
        })
        meta = bundle.to_structured_metadata()
    interpretation, early = apply_hiring_relationship_proxy(
        contract, interpretation, source_text=text, structured_metadata=meta,
    )
    if early:
        return early, None
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract,
        interpretation,
        source_text=text,
        source_url="https://careers.airliquide.com/vacancy/commerciale",
        source_publisher="careers.airliquide.com",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company=company,
        maximum_age_days=180,
        now=date(2026, 7, 17),
        structured_metadata=meta,
    )
    return None, verdict


def test_schema_versions_bumped_for_cache_invalidation():
    assert EVENT_SCHEMA_VERSION.endswith("v4")
    assert GROUNDING_SCHEMA_VERSION.endswith("v2")


def test_positive_duty_sviluppare_acquisire():
    text = "VitalAire. Sviluppare e acquisire nuovi clienti nel territorio assegnato."
    early, verdict = _verify(text)
    assert early is None
    assert verdict is not None and verdict.accepted
    assert verdict.checks["customer_acquisition_duty_literal"] is True
    assert verdict.checks["required_relationships_supported"] is True


def test_positive_duty_prospecting():
    text = "Acme SpA. Prospecting e apertura di nuove opportunità commerciali."
    early, verdict = _verify(text, company="Acme SpA", role="Business Developer")
    assert early is None and verdict is not None and verdict.accepted


def test_positive_duty_new_business_portfolio():
    text = "Beta Srl. Ampliare il portafoglio clienti attraverso attività new business."
    early, verdict = _verify(text, company="Beta Srl", role="Business Developer")
    assert early is None and verdict is not None and verdict.accepted


def test_positive_business_developer_lombardia():
    text = (
        "Gamma SpA cerca Business Developer. "
        "Acquisizione e sviluppo clienti: Individua e seleziona nuovi potenziali clienti e opportunità."
    )
    early, verdict = _verify(text, company="Gamma SpA", role="Business Developer")
    assert early is None and verdict is not None and verdict.accepted


def test_negative_existing_customers_only():
    text = "Delta SpA. Gestione e assistenza dei clienti già acquisiti."
    assert not has_customer_acquisition_duty(text)
    early, verdict = _verify(text, company="Delta SpA")
    assert early == "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"
    assert verdict is None


def test_negative_title_without_duties():
    text = "VitalAire cerca Commerciale - Lombardia Nord"
    early, verdict = _verify(text, role="Commerciale - Lombardia Nord")
    assert early == "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"
    assert verdict is None


def test_negative_recruiter_anonymous():
    text = (
        "Agenzia XYZ cerca Commerciale per cliente anonimo. "
        "Sviluppare e acquisire nuovi clienti nel territorio assegnato."
    )
    meta = build_hiring_semantic_evidence_bundle({
        "company_name": "Cliente Anonimo",
        "vacancy_title": "Commerciale",
        "description": text,
        "location": "Milano",
        "published_at": "2026-07-01",
        "source_url": "https://recruiter.example/job/1",
        "employer_official_domain": "recruiter.example",
        "active": True,
        "employer_is_direct": False,
    }).to_structured_metadata()
    early, verdict = _verify(text, company="Cliente Anonimo", meta=meta)
    assert early is None
    assert verdict is not None
    assert not verdict.accepted


def test_negative_generic_careers_page():
    text = "Join our team. Explore open positions at VitalAire careers."
    early, _verdict = _verify(text)
    assert early == "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"


def test_negative_expired_vacancy_via_inactive_bundle():
    text = "VitalAire. Sviluppare e acquisire nuovi clienti nel territorio assegnato."
    meta = build_hiring_semantic_evidence_bundle({
        "company_name": "VitalAire",
        "vacancy_title": "Commerciale",
        "description": text,
        "location": "Milano",
        "published_at": "2026-07-01",
        "source_url": "https://careers.airliquide.com/vacancy/commerciale",
        "employer_official_domain": "airliquide.com",
        "active": False,
        "employer_is_direct": True,
    }).to_structured_metadata()
    early, verdict = _verify(
        text,
        meta=meta,
        event_status="closed",
    )
    # Proxy does not enrich inactive vacancies; relationship stays unsupported.
    assert early is None
    assert verdict is not None
    assert not verdict.accepted


def test_negative_sales_training_without_vacancy():
    text = (
        "Corso di sales training: imparare prospecting e new business. "
        "Nessuna posizione aperta."
    )
    meta = build_hiring_semantic_evidence_bundle({
        "company_name": "Training Co",
        "vacancy_title": "Sales training",
        "description": text,
        "location": "Milano",
        "published_at": "2026-07-01",
        "source_url": "https://example.com/training",
        "employer_official_domain": "example.com",
        "active": False,
        "employer_is_direct": True,
    }).to_structured_metadata()
    early, verdict = _verify(text, company="Training Co", meta=meta, event_status="historical")
    assert early is None
    assert verdict is not None
    assert not verdict.accepted


def test_negative_article_not_hiring():
    text = (
        "VitalAire cresce in Lombardia e parla di acquisizione clienti nel mercato. "
        "Nessuna vacancy pubblicata."
    )
    meta = build_hiring_semantic_evidence_bundle({
        "company_name": "VitalAire",
        "vacancy_title": "Comunicato stampa",
        "description": text,
        "location": "Milano",
        "published_at": "2026-07-01",
        "source_url": "https://news.example/vitalaire",
        "employer_official_domain": "airliquide.com",
        "active": False,
        "employer_is_direct": True,
    }).to_structured_metadata()
    early, verdict = _verify(text, role="Comunicato stampa", meta=meta, event_status="historical")
    if early is not None:
        assert early == "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"
    else:
        assert verdict is not None and not verdict.accepted


def test_vitalaire_offline_bridge_case_b():
    """Case B: page has literal acquisition duty; synthetic title-only evidence must not win."""
    duties = (
        "Acquisizione e sviluppo clienti: Individua e seleziona nuovi potenziali clienti e opportunità "
        "nel territorio Lombardia Nord."
    )
    record = {
        "company_name": "VitalAire",
        "vacancy_title": "Commerciale - Lombardia Nord",
        "description": duties,
        "evidence": "VitalAire cerca Commerciale - Lombardia Nord",
        "location": "Lombardia Nord",
        "published_at": "2026-06-20",
        "source_url": "https://careers.airliquide.com/job/commerciale-lombardia",
        "employer_official_domain": "airliquide.com",
        "active": True,
        "employer_is_direct": True,
    }
    bundle = build_hiring_semantic_evidence_bundle(record)
    assert bundle.customer_acquisition_duty_proven is True
    assert "acquis" in bundle.evidence_excerpt.casefold() or "nuov" in bundle.evidence_excerpt.casefold()
    source_text = f"VitalAire\nCommerciale - Lombardia Nord\nLombardia Nord\n{duties}"
    excerpt, start, end = find_customer_acquisition_duty(source_text)
    assert start >= 0 and source_text[start:end] == excerpt
    early, verdict = _verify(source_text, meta=bundle.to_structured_metadata(), role="Commerciale - Lombardia Nord")
    assert early is None
    assert verdict is not None and verdict.accepted
    assert verdict.rejection_code is None
