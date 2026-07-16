import copy
import json
from pathlib import Path

from commercial_lifecycle import (
    canonical_domain,
    evaluate_publication_gate,
    evidence_records,
    persist_and_publish_candidates,
)

HERE = Path(__file__).resolve().parent
FIXTURE_CANDIDATES = [
    HERE / "contracts/fixtures/commercial-search-plan.valid.json",
    HERE.parent / "contracts/fixtures/commercial-search-plan.valid.json",
]
FIXTURE = next((path for path in FIXTURE_CANDIDATES if path.is_file()), FIXTURE_CANDIDATES[0])
PLAN = json.loads(FIXTURE.read_text(encoding="utf-8"))
MILANO_PLAN = {
    "schema_version": "1.0.0",
    "raw_query": (
        "Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e "
        "assenza di strumenti di tracciamento pubblicitario."
    ),
    "target": {
        "industries": ["imprese di pulizia"],
        "geographies": ["Milano"],
        "entity_types": ["company"],
        "company_sizes": ["micro", "piccola", "media"],
        "local_business_preference": True,
        "required_attributes": ["sito web ufficiale attivo"],
        "excluded_attributes": [],
        "excluded_entities": [],
    },
    "signal_policy": {
        "required_signals": ["website_weakness", "missing_advertising_pixel", "missing_analytics"],
        "optional_signals": [],
        "negative_signals": [],
        "minimum_signal_confidence": 0.75,
        "maximum_age_days_by_signal": {
            "website_weakness": 30,
            "missing_analytics": 14,
            "missing_advertising_pixel": 14,
        },
    },
    "source_policy": {
        "allowed_source_classes": ["technology_audit"],
        "preferred_source_classes": ["technology_audit"],
        "excluded_source_classes": ["search_snippet"],
        "minimum_independent_sources": 1,
        "primary_source_required_for": [],
    },
    "evidence_policy": {
        "require_official_domain": True,
        "require_source_url": True,
        "require_observed_at": True,
        "minimum_evidence_confidence": 0.75,
    },
    "budget_policy": {"hard_cost_eur": 0.125, "target_cost_eur": 0.105},
    "commercial_hypotheses": [],
    "seller": {
        "offer_category": "Digital marketing / SEO / Web analytics services",
        "products_or_services": ["Audit e ottimizzazione SEO"],
        "problems_solved": ["Scarsa visibilità organica sui motori di ricerca"],
        "preferred_buyer_roles": ["Titolare/Owner"],
    },
}


def valid_lead():
    return {
        "azienda": "Alfa Logistica Srl",
        "sito": "https://www.alfalogistica.example/",
        "source_url": "https://www.alfalogistica.example/lavora-con-noi",
        "evidence": "Alfa Logistica cerca nuovi autisti per la sede lombarda",
        "why_now": "L'apertura di nuove posizioni operative aumenta oggi l'esposizione assicurativa della PMI.",
        "evidence_date": "2026-07-10T00:00:00Z",
        "matched_signals": ["hiring_operational"],
        "business_signals": [{
            "type": "hiring_operational", "status": "verified", "confidence": 0.9,
            "source_url": "https://www.alfalogistica.example/lavora-con-noi",
            "source_class": "company_careers", "evidence": "Ricerca autisti", "date": "2026-07-10T00:00:00Z",
        }],
        "domain_verification": {
            "status": "verified", "confidence": 0.95, "score": 95,
            "url": "https://www.alfalogistica.example/",
            "resolution_source": "extracted_website",
            "resolution_method": "positive_page_identity",
            "resolved_at": "2026-07-10T00:00:00Z",
            "evidence": ["company_tokens_in_host", "legal_name_in_page", "official_site_markers"],
        },
        "lead_quality_contract": {"score": 91},
        "technical_report": {"audit_status": "complete"},
        "last_audited_at": "2026-07-11T00:00:00Z",
        "hotness_score": 88,
        "company_size_class": "small",
    }


def test_publication_gate_passes_only_complete_verified_lead():
    gate = evaluate_publication_gate(valid_lead(), PLAN, cost_within_budget=True)
    assert gate["publishable"] is True
    assert gate["failures"] == []
    assert len(gate["evidence"]) >= 1


def test_publication_gate_fails_probable_domain():
    lead = valid_lead()
    lead["domain_verification"]["status"] = "probable"
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["publishable"] is False
    assert "official_domain_verified" in gate["failures"]


def test_publication_gate_fails_missing_audit_or_signal():
    lead = valid_lead()
    lead.pop("last_audited_at")
    lead["business_signals"] = []
    lead["matched_signals"] = []
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["publishable"] is False
    assert "audit_completed" in gate["failures"]
    assert "relevant_buying_signal_present" in gate["failures"]


def test_evidence_rejects_snippet_as_publishable_source():
    lead = valid_lead()
    lead["business_signals"][0]["source_class"] = "search_snippet"
    lead["business_signals"][0]["source_url"] = "https://www.google.com/search?q=alfa"
    lead["source_url"] = "https://www.google.com/search?q=alfa"
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["publishable"] is False
    assert "evidence_supports_signal" in gate["failures"]


def test_domain_normalization_and_evidence_dedupe():
    lead = valid_lead()
    lead["business_signals"].append(copy.deepcopy(lead["business_signals"][0]))
    assert canonical_domain("https://WWW.Example.IT/path") == "example.it"
    assert len(evidence_records(lead)) == 2


def test_evidence_never_fabricates_missing_observation_date():
    lead = valid_lead()
    lead.pop("evidence_date")
    lead.pop("last_audited_at")
    lead["business_signals"][0].pop("date")
    assert evidence_records(lead) == []
    assert evaluate_publication_gate(lead, PLAN, cost_within_budget=True)["publishable"] is False


def test_stale_evidence_is_rejected_even_when_every_other_gate_is_valid():
    lead = valid_lead()
    lead["evidence_date"] = "2020-01-01T00:00:00Z"
    lead["business_signals"][0]["date"] = "2020-01-01T00:00:00Z"
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["publishable"] is False
    assert gate["freshness_pass"] is False
    assert "SIGNAL_NOT_FRESH" in gate["rejection_codes"]


def test_unknown_source_class_and_contradiction_are_not_publishable():
    lead = valid_lead()
    lead["business_signals"][0]["source_class"] = "invented_source"
    assert evaluate_publication_gate(lead, PLAN, cost_within_budget=True)["evidence_supports_signal"] is False
    lead = valid_lead()
    lead["business_signals"][0]["contradiction_status"] = "confirmed"
    assert evaluate_publication_gate(lead, PLAN, cost_within_budget=True)["evidence_supports_signal"] is False


def test_verified_label_without_positive_resolution_proof_is_rejected():
    lead = valid_lead()
    lead["domain_verification"] = {"status": "verified", "confidence": 0.99}
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["official_domain_verified"] is False
    assert gate["publishable"] is False


def test_trusted_hiring_adapter_identity_is_accepted_with_exact_proof_contract():
    lead = valid_lead()
    lead["source_adapter_id"] = "structured_hiring_v1"
    lead["citta"] = "Milano, Lombardia, Italia"
    lead["vacancy_title"] = "Autista"
    lead["domain_verification"].update({
        "adapter_id": "structured_hiring_v1",
        "resolution_source": "source_adapter",
        "resolution_method": "verified_source_adapter",
        "evidence": ["company_careers_host_match", "legal_name_in_page"],
    })
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["official_domain_verified"] is True
    assert gate["publishable"] is True


def test_source_adapter_identity_rejects_unknown_forged_or_incomplete_proof():
    lead = valid_lead()
    lead["source_adapter_id"] = "unknown_adapter"
    lead["domain_verification"].update({
        "adapter_id": "unknown_adapter",
        "resolution_source": "source_adapter",
        "resolution_method": "verified_source_adapter",
        "evidence": ["schema_org_identity_match", "official_page_host_match"],
    })
    assert evaluate_publication_gate(lead, PLAN, cost_within_budget=True)["official_domain_verified"] is False

    lead["source_adapter_id"] = "structured_hiring_v1"
    assert evaluate_publication_gate(lead, PLAN, cost_within_budget=True)["official_domain_verified"] is False

    lead["domain_verification"]["adapter_id"] = "structured_hiring_v1"
    lead["domain_verification"]["evidence"] = ["company_careers_host_match"]
    assert evaluate_publication_gate(lead, PLAN, cost_within_budget=True)["official_domain_verified"] is False


def test_publication_gate_requires_budget_and_why_now_and_causal_plan():
    lead = valid_lead()
    assert evaluate_publication_gate(lead, PLAN)["cost_within_budget"] is False
    lead.pop("why_now")
    gate = evaluate_publication_gate(lead, PLAN, cost_within_budget=True)
    assert gate["why_now_present"] is False
    assert "NO_PROBLEM_FIT" in gate["rejection_codes"]
    weak_plan = copy.deepcopy(PLAN)
    weak_plan["seller"]["problems_solved"] = []
    gate = evaluate_publication_gate(valid_lead(), weak_plan, cost_within_budget=True)
    assert gate["signal_semantically_linked_to_seller_offer"] is False


def test_explicit_or_signal_policy_accepts_one_verified_signal_but_and_requires_all():
    plan = copy.deepcopy(PLAN)
    plan["raw_query"] = "PMI con assunzioni operative oppure nuovi appalti"
    plan["signal_policy"]["required_signals"] = ["hiring_operational", "tender_won"]
    plan["commercial_hypotheses"][0]["signals"] = ["hiring_operational", "tender_won"]
    gate = evaluate_publication_gate(valid_lead(), plan, cost_within_budget=True)
    assert gate["signal_match_mode"] == "any"
    assert gate["relevant_buying_signal_present"] is True
    plan["raw_query"] = "PMI con assunzioni operative e nuovi appalti"
    gate = evaluate_publication_gate(valid_lead(), plan, cost_within_budget=True)
    assert gate["signal_match_mode"] == "all"
    assert gate["relevant_buying_signal_present"] is False


class _Response:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, owner, table):
        self.owner = owner
        self.table = table
        self.operation = "select"
        self.payload = None

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def upsert(self, payload, **_kwargs):
        self.operation = "upsert"
        self.payload = payload
        return self

    def execute(self):
        self.owner.calls.append((self.table, self.operation, self.payload))
        if self.table == "search_budget_state":
            return _Response([{"hard_cost_eur": 0.125, "committed_cost_eur": 0.05, "status": "active"}])
        if self.table == "search_candidates" and self.operation == "select":
            return _Response([])
        if self.table == "search_candidates" and self.operation == "insert":
            return _Response([{"id": "candidate-shadow-1"}])
        return _Response([])


class _FakeSupabase:
    def __init__(self):
        self.calls = []
        self.rpc_calls = []

    def table(self, name):
        return _FakeQuery(self, name)

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        return _FakeQuery(self, "rpc")


def test_shadow_persists_canonical_gate_without_customer_publication():
    service = _FakeSupabase()
    lead = valid_lead()
    released = persist_and_publish_candidates(
        service,
        search_id="shadow-search",
        user_id=None,
        leads=[lead],
        canonical_plan=PLAN,
        shadow_mode=True,
    )
    assert released == [lead]
    candidate_inserts = [call for call in service.calls if call[0] == "search_candidates" and call[1] == "insert"]
    assert len(candidate_inserts) == 1
    assert candidate_inserts[0][2]["user_id"] is None
    assert candidate_inserts[0][2]["stage"] == "qualified"
    assert service.rpc_calls == []


def test_ownerless_non_shadow_never_persists_or_publishes():
    service = _FakeSupabase()
    assert persist_and_publish_candidates(
        service,
        search_id="unsafe-ownerless-production",
        user_id=None,
        leads=[valid_lead()],
        canonical_plan=PLAN,
    ) == []
    assert service.calls == []
    assert service.rpc_calls == []


def digital_audit_lead(**overrides):
    now = "2026-07-15T05:32:07+00:00"
    lead = {
        "azienda": "Shine Cleaning – Impresa di Pulizie Milano",
        "sito": "https://shinecleaning.it",
        "entity_type": "company",
        "citta": "Milano",
        "company_size_class": "unknown",
        "operating_company_probability": 0.95,
        "source_adapter_id": "legacy_digital_audit_v1",
        "matched_signals": ["website_weakness", "missing_advertising_pixel", "missing_analytics"],
        "why_now": "Critical SEO and missing ad tracking on the official website create an immediate optimization opportunity for this Milano cleaning company.",
        "lead_quality_contract": {"score": 72},
        "last_audited_at": now,
        "technical_report": {"audit_status": "complete"},
        "domain_verification": {
            "status": "verified",
            "confidence": 0.95,
            "score": 95,
            "url": "https://shinecleaning.it/",
            "resolution_source": "source_adapter",
            "resolution_method": "verified_source_adapter",
            "adapter_id": "legacy_digital_audit_v1",
            "resolved_at": now,
            "evidence": ["maps_business_website", "direct_website_audit"],
        },
        "business_signals": [
            {
                "type": "website_weakness",
                "status": "verified",
                "confidence": 0.95,
                "source_url": "https://shinecleaning.it/",
                "source_class": "technology_audit",
                "evidence": "critical SEO/HTML issues observed in direct audit",
                "date": now,
            },
            {
                "type": "missing_advertising_pixel",
                "status": "verified",
                "confidence": 0.95,
                "source_url": "https://shinecleaning.it/",
                "source_class": "technology_audit",
                "evidence": "Meta/Facebook Pixel absent in direct HTML audit",
                "date": now,
            },
            {
                "type": "missing_analytics",
                "status": "verified",
                "confidence": 0.95,
                "source_url": "https://shinecleaning.it/",
                "source_class": "technology_audit",
                "evidence": "GA4 absent in direct technical audit",
                "date": now,
            },
        ],
    }
    lead.update(overrides)
    return lead


def test_digital_audit_buyer_fit_passes_with_verified_signal_groups():
    gate = evaluate_publication_gate(digital_audit_lead(), MILANO_PLAN, cost_within_budget=True)
    assert gate["publishable"] is True
    assert gate["buyer_fit_method"] == "category_scoped_digital_audit_deterministic"
    assert gate["buyer_fit_pass"] is True
    assert gate["buyer_fit_score"] >= 88


def test_digital_audit_buyer_fit_passes_exact_seo_only_query():
    plan = copy.deepcopy(MILANO_PLAN)
    plan["raw_query"] = "Imprese di pulizia a Milano con errori SEO."
    plan["signal_policy"]["required_signals"] = ["website_weakness"]
    plan["signal_policy"]["maximum_age_days_by_signal"] = {"website_weakness": 30}
    lead = digital_audit_lead(
        matched_signals=["website_weakness"],
        required_signals=["website_weakness"],
        business_signals=[digital_audit_lead()["business_signals"][0]],
    )

    gate = evaluate_publication_gate(lead, plan, cost_within_budget=True)

    assert gate["publishable"] is True
    assert gate["buyer_fit_pass"] is True
    assert gate["buyer_fit_evidence"]["signal_groups_verified"] is True


def test_digital_audit_buyer_fit_rejects_seo_only_query_without_seo_evidence():
    plan = copy.deepcopy(MILANO_PLAN)
    plan["raw_query"] = "Imprese di pulizia a Milano con errori SEO."
    plan["signal_policy"]["required_signals"] = ["website_weakness"]
    plan["signal_policy"]["maximum_age_days_by_signal"] = {"website_weakness": 30}
    lead = digital_audit_lead(
        matched_signals=["missing_analytics"],
        required_signals=["website_weakness"],
        business_signals=[digital_audit_lead()["business_signals"][2]],
    )

    gate = evaluate_publication_gate(lead, plan, cost_within_budget=True)

    assert gate["publishable"] is False
    assert gate["buyer_fit_pass"] is False
    assert gate["buyer_fit_evidence"]["signal_groups_verified"] is False


def test_digital_audit_buyer_fit_fails_wrong_category():
    lead = digital_audit_lead(matched_signals=[], business_signals=[])
    gate = evaluate_publication_gate(lead, MILANO_PLAN, cost_within_budget=True)
    assert gate["publishable"] is False


def test_digital_audit_buyer_fit_fails_wrong_geography():
    gate = evaluate_publication_gate(digital_audit_lead(citta="Roma"), MILANO_PLAN, cost_within_budget=True)
    assert gate["publishable"] is False
    assert "buyer_fit_verified" in gate["failures"] or "relevant_buying_signal_present" in gate["failures"]


def test_digital_audit_buyer_fit_fails_unofficial_domain():
    lead = digital_audit_lead()
    lead["domain_verification"]["status"] = "probable"
    gate = evaluate_publication_gate(lead, MILANO_PLAN, cost_within_budget=True)
    assert gate["official_domain_verified"] is False
    assert gate["publishable"] is False


def test_digital_audit_buyer_fit_fails_without_seo_signal():
    lead = digital_audit_lead(
        matched_signals=["missing_advertising_pixel", "missing_analytics"],
        business_signals=[
            item for item in digital_audit_lead()["business_signals"] if item["type"] != "website_weakness"
        ],
    )
    gate = evaluate_publication_gate(lead, MILANO_PLAN, cost_within_budget=True)
    assert gate["publishable"] is False
    assert "relevant_buying_signal_present" in gate["failures"]


def test_digital_audit_buyer_fit_fails_with_complete_tracking():
    lead = digital_audit_lead(
        matched_signals=["website_weakness"],
        business_signals=[digital_audit_lead()["business_signals"][0]],
    )
    gate = evaluate_publication_gate(lead, MILANO_PLAN, cost_within_budget=True)
    assert gate["publishable"] is False


def test_digital_audit_missing_generic_hypothesis_does_not_block_deterministic_fit():
    plan = copy.deepcopy(MILANO_PLAN)
    plan["commercial_hypotheses"] = []
    gate = evaluate_publication_gate(digital_audit_lead(), plan, cost_within_budget=True)
    assert gate["publishable"] is True
    assert gate["signal_semantically_linked_to_seller_offer"] is True
