"""Offline industrial buyer-trigger umbrella OR (Case A). Zero external calls."""
from __future__ import annotations

from datetime import date

from backend_mirror.semantic_intelligence import (
    INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY,
    INDUSTRIAL_BUYER_TRIGGER_CHILDREN,
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
    apply_industrial_buyer_trigger_proxy,
    normalize_industrial_buyer_trigger_relationships,
)


def _base_contract(**overrides):
    payload = {
        "query_goal": "Find Italian SMEs with recent industrial capex triggers",
        "seller": {
            "offer_category": "Predictive Maintenance",
            "products_or_services": ["Predictive maintenance solutions"],
            "problems_solved": ["Unplanned downtime reduction"],
            "preferred_buyer_roles": ["Plant Manager"],
        },
        "offer": {
            "description": "Predictive maintenance solutions for industrial equipment and production lines",
        },
        "target_entity_types": ["operating_company"],
        "target_company_description": "Italian industrial SMEs",
        "event_or_state_description": (
            "Recent factory expansion, production line automation, or new machinery installation"
        ),
        "target_role_in_event": "equipment_operator",
        "required_relationships": [
            "factory_expansion_by_target_company",
            "production_line_automation_by_target_company",
            "new_machinery_installation_by_target_company",
        ],
        "optional_relationships": [],
        "excluded_roles": ["publisher", "advisor", "recruiter"],
        "excluded_entities": ["large_enterprises", "multinational_corporations"],
        "geography": ["Italy"],
        "industry": ["Manufacturing"],
        "size_constraints": {"employee_count_max": 500},
        "temporal_constraints": {"timeframe_months": 12},
        "positive_conditions": [],
        "negative_conditions": [],
        "must_have_facts": ["target_company_identity", "source_evidence"],
        "forbidden_inferences": ["publisher_is_target_company"],
        "data_requirements": ["official_domain", "source_url", "observed_at"],
        "ranking_objective": "freshest verified trigger",
        "acceptance_rubric": [
            "target_role_equipment_operator_grounded",
            "factory_expansion_by_target_company_grounded",
            "production_line_automation_by_target_company_grounded",
            "new_machinery_installation_by_target_company_grounded",
        ],
        "discovery_hypotheses": [],
        "clarification_required": False,
        "confidence": 0.85,
        "canonical_signal_hints": [],
        "evidence_claim_type": "OBSERVED_EVENT",
    }
    payload.update(overrides)
    return SemanticQueryContract.from_model(
        payload,
        original_query=(
            "Vendiamo manutenzione predittiva alle PMI industriali. "
            "Trovami aziende italiane non enormi che hanno ampliato fabbriche, "
            "automatizzato linee o installato nuovi macchinari recentemente, con un contatto pubblico."
        ),
        requested_count=3,
    )


def _interp(**overrides):
    base = {
        "entities": [],
        "events": [],
        "relations": [],
        "target_company": "Tironi Spa",
        "target_entity_role": "equipment_operator",
        "event_type": "factory_expansion",
        "open_predicate": "has_expanded",
        "actor": "Tironi Spa",
        "recipient": None,
        "provider": None,
        "beneficiary": "Tironi Spa",
        "investor": None,
        "employer": "Tironi Spa",
        "recruiter": None,
        "publisher": "Industria News",
        "authority": None,
        "predicate": "factory_expansion",
        "direction": "subject_invests",
        "event_status": "observed",
        "event_date": "2026-03-01",
        "amount": None,
        "location": "Modena",
        "technology": None,
        "role": "equipment_operator",
        "negated": False,
        "hypothetical": False,
        "conditional": False,
        "rumor": False,
        "historical": False,
        "certainty": 0.92,
        "query_match": True,
        "query_match_reason": "expansion evidence",
        "satisfied_relationships": ["factory_expansion_by_target_company"],
        "acceptance_rubric_passed": [
            "target_role_equipment_operator_grounded",
            f"{INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY}_grounded",
        ],
        "buyer_need": "",
        "why_now": "",
        "evidence_excerpt": "",
        "evidence_start": -1,
        "evidence_end": -1,
        "confidence": 0.92,
        "rejection_reason": None,
    }
    base.update(overrides)
    return SemanticEventInterpretation.from_model(base)


def _verify(source: str, interpretation, contract=None, *, now=None, max_age=365, published_at=None):
    contract = contract or _base_contract()
    excerpt = interpretation.evidence_excerpt or source
    if excerpt and excerpt in source:
        start = source.find(excerpt)
        end = start + len(excerpt)
        interpretation = SemanticEventInterpretation.from_model(
            {
                **interpretation.to_dict(),
                "evidence_excerpt": excerpt,
                "evidence_start": start,
                "evidence_end": end,
            }
        )
    meta = {}
    if published_at:
        meta["source_published_at"] = published_at
        meta["published_at"] = published_at
    return SemanticEvidenceGroundingVerifier().verify(
        contract,
        interpretation,
        source_text=source,
        source_url="https://news.example.it/tironi-stabilimento",
        source_publisher="Industria News",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company="Tironi Spa",
        maximum_age_days=max_age,
        now=now or date(2026, 7, 1),
        structured_metadata=meta,
    )


def test_normalize_collapses_and_of_three_into_umbrella_or():
    required, rubric = normalize_industrial_buyer_trigger_relationships(
        [
            "factory_expansion_by_target_company",
            "production_line_automation_by_target_company",
            "new_machinery_installation_by_target_company",
        ],
        [
            "factory_expansion_by_target_company_grounded",
            "production_line_automation_by_target_company_grounded",
            "new_machinery_installation_by_target_company_grounded",
        ],
    )
    assert required == (INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY,)
    assert f"{INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY}_grounded" in rubric
    assert not set(rubric).intersection({f"{c}_grounded" for c in INDUSTRIAL_BUYER_TRIGGER_CHILDREN})


def test_contract_from_model_uses_umbrella_or():
    contract = _base_contract()
    assert contract.required_relationships == (INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY,)


def test_ampliamento_vero_pass():
    source = (
        "Modena, 1 marzo 2026 — Tironi Spa ha inaugurato il nuovo stabilimento produttivo "
        "a Modena, ampliando la capacità del gruppo."
    )
    verdict = _verify(source, _interp(evidence_excerpt=source, event_date="2026-03-01"))
    assert verdict.accepted is True
    assert INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY in (
        apply_industrial_buyer_trigger_proxy(
            _base_contract(), _interp(), source_text=source, candidate_company="Tironi Spa"
        ).satisfied_relationships
    )


def test_automazione_vera_pass():
    source = (
        "Tironi Spa ha completato l'automazione della linea di produzione a Modena "
        "nel febbraio 2026, riducendo i tempi ciclo."
    )
    verdict = _verify(
        source,
        _interp(
            evidence_excerpt=source,
            event_type="production_line_automation",
            satisfied_relationships=["production_line_automation_by_target_company"],
            event_date="2026-02-10",
        ),
    )
    assert verdict.accepted is True


def test_nuovi_macchinari_veri_pass():
    source = (
        "Tironi Spa ha installato una nuova pressa di nobilitazione nello stabilimento "
        "di Modena (gennaio 2026)."
    )
    verdict = _verify(
        source,
        _interp(
            evidence_excerpt=source,
            event_type="new_machinery_installation",
            satisfied_relationships=["new_machinery_installation_by_target_company"],
            event_date="2026-01-20",
        ),
    )
    assert verdict.accepted is True


def test_revamping_vero_pass():
    source = (
        "Tironi Spa ha avviato il revamping della linea produttiva principale a Modena "
        "a maggio 2026."
    )
    verdict = _verify(
        source,
        _interp(
            evidence_excerpt=source,
            event_type="plant_revamping",
            satisfied_relationships=["plant_revamping_by_target_company"],
            event_date="2026-05-12",
        ),
    )
    assert verdict.accepted is True


def test_un_solo_trigger_sufficiente():
    source = "Tironi Spa inaugura il nuovo stabilimento a Modena il 1 marzo 2026."
    enriched = apply_industrial_buyer_trigger_proxy(
        _base_contract(),
        _interp(satisfied_relationships=[], acceptance_rubric_passed=["target_role_equipment_operator_grounded"]),
        source_text=source,
        candidate_company="Tironi Spa",
    )
    assert INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY in enriched.satisfied_relationships
    assert len(set(enriched.satisfied_relationships).intersection(INDUSTRIAL_BUYER_TRIGGER_CHILDREN)) >= 1
    verdict = _verify(source, enriched)
    assert verdict.accepted is True
    assert verdict.checks["required_relationships_supported"] is True


def test_vendor_macchinari_reject():
    source = (
        "VendorMacchine Spa vende impianti e macchinari industriali alle PMI. "
        "Catalogo presse e linee automatiche 2026."
    )
    contract = _base_contract()
    interpretation = _interp(
        target_company="VendorMacchine Spa",
        evidence_excerpt=source,
        satisfied_relationships=[],
        acceptance_rubric_passed=[],
        query_match=False,
        event_date="2026-04-01",
    )
    verdict = SemanticEvidenceGroundingVerifier().verify(
        contract,
        interpretation,
        source_text=source,
        source_url="https://vendormacchine.example/catalogo",
        source_publisher="VendorMacchine",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company="VendorMacchine Spa",
        maximum_age_days=365,
        now=date(2026, 7, 1),
    )
    assert verdict.accepted is False


def test_publisher_non_diventa_target():
    source = (
        "Confindustria Emilia — comunicato: Tironi Spa ha inaugurato il nuovo stabilimento a Modena."
    )
    enriched = apply_industrial_buyer_trigger_proxy(
        _base_contract(),
        _interp(
            target_company="Confindustria Emilia",
            target_entity_role="publisher",
            publisher="Confindustria Emilia",
            satisfied_relationships=[],
        ),
        source_text=source,
        candidate_company="Confindustria Emilia",
    )
    assert INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY not in enriched.satisfied_relationships


def test_pagina_statica_senza_evento_reject():
    source = "Tironi Spa — chi siamo. Produzione di componenti industriali dal 1980. Contatti."
    verdict = _verify(
        source,
        _interp(
            evidence_excerpt=source,
            satisfied_relationships=[],
            acceptance_rubric_passed=[],
            query_match=False,
            event_date="2026-06-01",
        ),
    )
    assert verdict.accepted is False


def test_progetto_ipotetico_reject():
    source = (
        "Tironi Spa potrebbe valutare un nuovo stabilimento a Modena se otterrà i fondi."
    )
    verdict = _verify(
        source,
        _interp(
            evidence_excerpt=source,
            hypothetical=True,
            event_status="hypothetical",
            satisfied_relationships=["factory_expansion_by_target_company"],
            event_date="2026-06-01",
        ),
    )
    assert verdict.accepted is False
    assert verdict.checks["not_negated_hypothetical_conditional_or_rumor"] is False


def test_excerpt_offset_letterali():
    source = "xxx Tironi Spa ha inaugurato il nuovo stabilimento a Modena yyy"
    excerpt = "Tironi Spa ha inaugurato il nuovo stabilimento a Modena"
    start = source.find(excerpt)
    verdict = _verify(
        source,
        _interp(evidence_excerpt=excerpt, evidence_start=start, evidence_end=start + len(excerpt)),
    )
    assert verdict.checks["excerpt_literal"] is True
    assert source[verdict.evidence_start:verdict.evidence_end] == verdict.evidence_excerpt


def test_source_published_at_supports_recency_without_becoming_event_date():
    source = "Tironi Spa ha inaugurato il nuovo stabilimento a Modena."
    # Stale event_date, fresh source_published_at → temporal can pass; event_date unchanged.
    verdict = _verify(
        source,
        _interp(evidence_excerpt=source, event_date="2024-06-28"),
        now=date(2026, 7, 1),
        max_age=365,
        published_at="2026-06-15",
    )
    assert verdict.event_date == "2024-06-28"
    assert verdict.checks["temporal_evidence_valid"] is True


def test_nessuna_data_reject():
    source = "Tironi Spa ha inaugurato il nuovo stabilimento a Modena."
    verdict = _verify(
        source,
        _interp(evidence_excerpt=source, event_date=None),
        published_at="2026-06-15",
    )
    assert verdict.checks["temporal_evidence_valid"] is False
    assert verdict.accepted is False


def test_no_predictive_maintenance_phrase_required_on_page():
    source = "Tironi Spa ha installato una nuova pressa nello stabilimento di Modena a marzo 2026."
    assert "manutenzione predittiva" not in source.casefold()
    enriched = apply_industrial_buyer_trigger_proxy(
        _base_contract(),
        _interp(satisfied_relationships=[], buyer_need=""),
        source_text=source,
        candidate_company="Tironi Spa",
    )
    assert INDUSTRIAL_BUYER_TRIGGER_BY_TARGET_COMPANY in enriched.satisfied_relationships
    assert "manutenzione predittiva" not in (enriched.evidence_excerpt or "").casefold()
    assert enriched.buyer_need  # inferred from seller offer, not page phrase
