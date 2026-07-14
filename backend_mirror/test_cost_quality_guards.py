import asyncio
import os

import pytest

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("MIRAX_WORKER_DISABLED", "1")

from agents import extraction_cache
from agents.data_extractor import DataExtractor, _llm_budget_allows_next_call, page_has_required_signal
from agents.portal_blacklist import is_known_non_sme_domain, is_source_portal_url
from agents.agentic_gap_fill import (
    _has_active_marketing_investment_evidence,
    _looks_like_marketing_provider_noise,
    extracted_to_lead_stub,
)
from agents.web_researcher import _should_skip_url, _signal_boolean_queries
from worker_supabase import (
    _agentic_stream_one_lead,
    _filter_results_by_confirmed_required_signals,
    _lead_satisfies_confirmed_required_signals,
    _normalize_one_shot_search_id,
    _shadow_execution_is_authorized,
    _should_sync_graph_for_publish_status,
)


def test_one_shot_search_id_requires_once_and_uuid():
    search_id = "32c8873d-bae0-481b-a07f-8e41283853fc"
    assert _normalize_one_shot_search_id(search_id, once=True) == search_id
    assert _normalize_one_shot_search_id("", once=False) == ""
    with pytest.raises(ValueError, match="richiede --once"):
        _normalize_one_shot_search_id(search_id, once=False)
    with pytest.raises(ValueError, match="UUID valido"):
        _normalize_one_shot_search_id("not-an-id", once=True)


def test_shadow_worker_requires_explicit_post_prepare_authorization():
    base = {
        "lifecycle_stage": "v5_shadow",
        "customer_visible": False,
        "prepare_only": True,
        "execution_authorized": False,
    }
    assert _shadow_execution_is_authorized(base) is False
    assert _shadow_execution_is_authorized({**base, "prepare_only": False}) is False
    assert _shadow_execution_is_authorized({
        **base,
        "prepare_only": False,
        "execution_authorized": True,
    }) is True
    assert _shadow_execution_is_authorized({"lifecycle_stage": "customer_search"}) is True


def test_llm_extraction_budget_is_allocated_once_per_required_lane(monkeypatch):
    monkeypatch.setenv("MIRAX_LLM_MAX_CHUNKS_PER_PAGE", "1")
    monkeypatch.setenv("MIRAX_HEURISTIC_OFFICIAL_FIRST", "0")
    plan = {
        "required_signals": ["hiring_operational", "contract_awarded", "production_expansion"],
    }
    extractor = DataExtractor(plan, [], chunk_size=180, chunk_overlap=0)
    calls = []

    async def fake_extract(source_url, chunk, chunk_index, chunk_total, plan_override=None):
        calls.append((source_url, tuple((plan_override or {}).get("required_signals") or [])))
        return []

    monkeypatch.setattr(extractor, "_extract_chunk", fake_extract)
    production_text = ("Nuovo stabilimento e ampliamento produttivo con nuova linea produttiva. " * 8)
    procurement_text = ("Appalto aggiudicato e gara affidata alla PMI con CIG pubblicato. " * 8)
    hiring_text = ("Posizione aperta per operai, tecnici e manutentori di produzione. " * 8)

    asyncio.run(extractor.extract_page({
        "url": "https://acme.example/news/plant",
        "raw_text": production_text,
        "expected_signals": ["production_expansion"],
    }))
    asyncio.run(extractor.extract_page({
        "url": "https://acme.example/news/plant-2",
        "raw_text": production_text,
        "expected_signals": ["production_expansion"],
    }))
    asyncio.run(extractor.extract_page({
        "url": "https://anac.example/award",
        "raw_text": procurement_text,
        "expected_signals": ["contract_awarded"],
    }))
    asyncio.run(extractor.extract_page({
        "url": "https://acme.example/careers",
        "raw_text": hiring_text,
        "expected_signals": ["hiring_operational"],
    }))

    assert calls == [
        ("https://acme.example/news/plant", ("production_expansion",)),
        ("https://anac.example/award", ("contract_awarded",)),
        ("https://acme.example/careers", ("hiring_operational",)),
    ]


def test_official_signal_page_uses_zero_cost_identity_extraction(monkeypatch):
    extractor = DataExtractor({"required_signals": ["production_expansion"]}, [])

    async def paid_extract_must_not_run(*_args, **_kwargs):
        raise AssertionError("official evidence must not consume an LLM call")

    monkeypatch.setattr(extractor, "_extract_chunk", paid_extract_must_not_run)
    leads = asyncio.run(extractor.extract_page({
        "url": "https://officine-rossi.it/news/ampliamento",
        "raw_text": (
            "Officine Rossi annuncia un nuovo stabilimento e un ampliamento produttivo "
            "con una nuova linea produttiva in Italia. " * 5
        ),
        "expected_signals": ["production_expansion"],
        "source_lane": "web_evidence",
        "source_types": ["official_company_website"],
        "query_source": "nuovo stabilimento PMI Italia",
        "observed_at": "2026-07-14T10:00:00+00:00",
    }))

    assert len(leads) == 1
    assert leads[0]["website"] == "https://officine-rossi.it/"
    assert leads[0]["matched_signals"] == ["production_expansion"]
    assert leads[0]["source_lane"] == "web_evidence"
    assert leads[0]["source_types"] == ["official_company_website"]
    assert leads[0]["query_source"] == "nuovo stabilimento PMI Italia"
    assert leads[0]["source_publisher"] == "officine-rossi.it"
    assert leads[0]["source_observation_date"] == "2026-07-14T10:00:00+00:00"


def test_known_enterprise_careers_page_is_rejected_before_paid_extraction(monkeypatch):
    assert is_known_non_sme_domain("https://www.mini.it/it_IT/home/footer/careers.html")
    assert is_source_portal_url("https://www.indeed.it/viewjob?id=123")
    assert not is_known_non_sme_domain("https://www.indeed.it/viewjob?id=123")
    extractor = DataExtractor({"required_signals": ["hiring_operational"]}, [])

    async def paid_extract_must_not_run(*_args, **_kwargs):
        raise AssertionError("known enterprise must be rejected before LLM")

    monkeypatch.setattr(extractor, "_extract_chunk", paid_extract_must_not_run)
    leads = asyncio.run(extractor.extract_page({
        "url": "https://www.mini.it/it_IT/home/footer/careers.html",
        "raw_text": "Posizioni aperte per operai, tecnici e manutentori di produzione. " * 5,
        "expected_signals": ["hiring_operational"],
    }))
    assert leads == []
    assert extractor.telemetry["prefilter_skips"] == 1


def test_graph_sync_only_after_terminal_qualified_publish():
    assert _should_sync_graph_for_publish_status("completed") is True
    for status in (None, "running", "processing", "pending", "error", "cancelled"):
        assert _should_sync_graph_for_publish_status(status) is False


def test_marketing_investment_prefilter_blocks_generic_pages(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("MIRAX_LLM_MAX_REQUESTS_PER_JOB", "10")
    plan = {"required_signals": ["investing_marketing"]}
    extractor = DataExtractor(plan, [])

    leads = asyncio.run(
        extractor.extract_page(
            {
                "url": "https://example.it/news",
                "raw_text": (
                    "Azienda Alfa Srl apre una nuova sede a Milano e presenta il nuovo showroom. "
                    "Il comunicato parla di design, vendita al dettaglio e ampliamento degli spazi, "
                    "con focus su assortimento, orari, personale di negozio e servizi post vendita."
                ),
            }
        )
    )

    assert leads == []
    assert extractor.telemetry["prefilter_skips"] == 1
    assert extractor.telemetry["anthropic_requests"] == 0


def test_marketing_signal_budget_zero_disables_weak_fallback(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("MIRAX_LLM_MAX_REQUESTS_PER_JOB", "0")
    monkeypatch.setenv("MIRAX_LLM_MAX_COST_USD_PER_JOB", "0")
    monkeypatch.setenv("AGENTIC_EXTRACTION_CACHE_DB", str(tmp_path / "cache.db"))
    extraction_cache._default_cache = None
    plan = {"required_signals": ["investing_marketing"]}
    extractor = DataExtractor(plan, [])

    leads = asyncio.run(
        extractor.extract_page(
            {
                "url": "https://aziendatest.it/landing",
                "raw_text": (
                    "Azienda Test Srl investe in Google Ads e usa una landing page "
                    "con conversion tracking per richiedi preventivo a Milano. "
                    "La pagina descrive una campagna paid media attiva e un funnel di acquisizione contatti."
                ),
            }
        )
    )

    assert leads == []
    assert extractor.telemetry["anthropic_requests"] == 0
    assert extractor.telemetry["llm_budget_exhausted"] == 1


def test_marketing_noise_source_is_blocked_before_llm(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("MIRAX_LLM_MAX_REQUESTS_PER_JOB", "10")
    monkeypatch.setenv("MIRAX_LLM_MAX_COST_USD_PER_JOB", "1")
    monkeypatch.setenv("AGENTIC_EXTRACTION_CACHE_DB", str(tmp_path / "cache-noise.db"))
    extraction_cache._default_cache = None
    extractor = DataExtractor({"required_signals": ["investing_marketing"]}, [])

    leads = asyncio.run(
        extractor.extract_page(
            {
                "url": "https://atenasolution.it/gestione-social-per-aziende/",
                "raw_text": (
                    "Agenzia marketing: offriamo gestione social media marketing, "
                    "campagne Google Ads e Meta Ads per aziende che vogliono acquisire clienti."
                ),
            }
        )
    )

    assert leads == []
    assert extractor.telemetry["blocked_pages"] == 1
    assert extractor.telemetry["anthropic_requests"] == 0


def test_openai_extract_is_retired_even_if_env_enabled(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "0")
    monkeypatch.setenv("OPENAI_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("MIRAX_LLM_MAX_REQUESTS_PER_JOB", "10")
    monkeypatch.setenv("MIRAX_LLM_MAX_COST_USD_PER_JOB", "1")
    monkeypatch.setenv("AGENTIC_EXTRACTION_CACHE_DB", str(tmp_path / "cache-openai-retired.db"))
    extraction_cache._default_cache = None
    plan = {"required_signals": ["investing_marketing"]}
    extractor = DataExtractor(plan, [])

    leads = asyncio.run(
        extractor.extract_page(
            {
                "url": "https://aziendatest.it/landing",
                "raw_text": (
                    "Azienda Test Srl investe in Google Ads con landing page "
                    "e conversion tracking per acquisire nuovi clienti."
                ),
            }
        )
    )

    assert extractor.telemetry["openai_requests"] == 0
    assert extractor.telemetry["anthropic_requests"] == 0
    assert isinstance(leads, list)


def test_llm_budget_reserves_next_call_cost(monkeypatch):
    monkeypatch.setenv("MIRAX_LLM_MAX_REQUESTS_PER_JOB", "10")
    monkeypatch.setenv("MIRAX_LLM_MAX_COST_USD_PER_JOB", "0.04")
    monkeypatch.setenv("MIRAX_LLM_RESERVED_USD_PER_CALL", "0.015")
    monkeypatch.setenv("MIRAX_LLM_INPUT_USD_PER_M", "3")
    monkeypatch.setenv("MIRAX_LLM_OUTPUT_USD_PER_M", "15")
    telemetry = {
        "input_tokens": 9000,
        "output_tokens": 500,
        "anthropic_requests": 2,
        "openai_requests": 0,
    }

    assert _llm_budget_allows_next_call(telemetry) is False
    assert telemetry["llm_budget_exhausted"] == 1


def test_marketing_prefilter_requires_observable_spend_signal():
    plan = {"required_signals": ["investing_marketing"]}
    assert not page_has_required_signal(
        "Autocentri Balduina vende auto e ha una sede commerciale.",
        plan,
    )
    assert page_has_required_signal(
        "Autocentri Balduina usa Google Ads, landing page e conversion tracking.",
        plan,
    )
    assert not page_has_required_signal(
        "La nostra agenzia social media marketing offre gestione campagne Google Ads e Meta Ads per aziende.",
        plan,
    )
    assert page_has_required_signal(
        "Case study cliente: PMI Alfa Srl ha attivato campagne Google Ads con landing page e conversion tracking.",
        plan,
    )


def test_hiring_category_pages_are_blocked_before_llm(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("MIRAX_LLM_MAX_REQUESTS_PER_JOB", "10")
    extractor = DataExtractor({"required_signals": ["hiring"]}, [])
    leads = asyncio.run(extractor.extract_page({
        "url": "https://www.infojobs.it/offerte-lavoro/sviluppatore-web",
        "raw_text": "Offerte sviluppatore web. Molte aziende assumono. " * 20,
    }))
    assert leads == []
    assert extractor.telemetry["prefilter_skips"] == 1
    assert extractor.telemetry["anthropic_requests"] == 0


def test_specialized_signal_prefilters_are_not_unknown_pass_through():
    assert page_has_required_signal(
        "Acme Srl cerca un data engineer per la nuova piattaforma cloud.",
        {"required_signals": ["hiring_technology"]},
    )
    assert not page_has_required_signal(
        "Acme Srl presenta la nuova collezione primavera.",
        {"required_signals": ["hiring_technology"]},
    )
    assert page_has_required_signal(
        "Il team gestisce ancora processi manuali su Excel.",
        {"required_signals": ["manual_processes"]},
    )


def test_web_researcher_skips_noisy_documents_and_public_sources():
    assert _should_skip_url("https://example.it/elenco-beneficiari.csv")
    assert _should_skip_url("https://regione.lazio.it/bando-marketing")
    assert _should_skip_url("https://www.ospedaleniguarda.it/news/campagna")
    assert _should_skip_url("https://www.unicusano.it/blog/marketing/meta-ads-cose/")
    assert _should_skip_url("https://www.youtrend.it/sondaggi/aziende-investono-marketing/")
    assert _should_skip_url("https://ojs.sijm.it/index.php/sinergie/article/view/marketing")
    assert _should_skip_url("https://www.karon.it/pubblicazioni/marketing-pmi")
    assert _should_skip_url("https://atenasolution.it/gestione-social-per-aziende/")
    assert not _should_skip_url("https://www.piccolaimpresasrl.it/landing-google-ads")


def test_web_researcher_commercialista_uses_admin_roles_not_sales_roles():
    queries = _signal_boolean_queries(
        {
            "original_query": "sono un commercialista, trovami clienti caldi per contabilita e fiscalita",
            "sector": "PMI, nuove societa e attivita in crescita con bisogno amministrativo/fiscale",
            "location": "Italia",
            "required_signals": ["new_company", "registry_change", "hiring", "expansion"],
            "commercial_hypothesis": {
                "offer": "Servizi di commercialista",
                "hiring_roles": ["Impiegato amministrativo", "Addetto contabilita", "Payroll specialist"],
            },
        }
    )
    joined = "\n".join(queries)
    assert "Impiegato amministrativo" in joined
    assert "Addetto contabilita" in joined
    assert "costituzione società" in joined
    assert "StartupItalia" not in joined
    assert "round di finanziamento" not in joined
    assert "SDR" not in joined
    assert "BDR" not in joined


def test_web_researcher_insurance_broker_uses_risk_and_procurement_lanes():
    queries = _signal_boolean_queries(
        {
            "original_query": "sono un broker assicurativo, trovami aziende calde per polizze aziendali",
            "sector": "PMI con rischio assicurabile, crescita operativa, personale, mezzi o appalti",
            "location": "Italia",
            "required_signals": ["hiring", "expansion", "tender_won", "new_company", "regulatory"],
            "commercial_hypothesis": {
                "offer": "Servizi di brokeraggio assicurativo",
                "hiring_roles": ["Autista", "Operaio", "Tecnico", "HSE"],
            },
        }
    )
    joined = "\n".join(queries)
    assert "Autista" in joined
    assert "Operaio" in joined
    assert "aggiudicazione appalto" in joined or "appalto aggiudicato" in joined
    assert "adeguamento normativo" in joined
    assert "round di finanziamento" not in joined
    assert "SDR" not in joined


def test_web_researcher_web_agency_generates_audit_queries():
    queries = _signal_boolean_queries(
        {
            "original_query": "sono un sales manager di agenzia web, trovami aziende a cui rifare il sito",
            "sector": "PMI locali con sito migliorabile, tracking assente o domanda digitale attiva",
            "location": "Italia",
            "required_signals": ["site_stale", "no_pixel", "no_gtm", "investing_marketing", "new_company"],
            "commercial_hypothesis": {
                "offer": "Servizi di agenzia web",
                "hiring_roles": ["Marketing Specialist"],
            },
        }
    )
    joined = "\n".join(queries)
    assert "copyright 2019" in joined
    assert "sito in costruzione" in joined
    assert "Google Ads" in joined or "Meta Ads" in joined
    assert "nuova apertura" in joined


def test_no_pixel_is_not_marketing_investment_evidence():
    assert not _has_active_marketing_investment_evidence("No Pixel sul sito, nessuna campagna verificata.")
    assert not _has_active_marketing_investment_evidence("Senza pixel e senza tracking conversioni.")
    assert _has_active_marketing_investment_evidence(
        "Campagna Google Ads attiva con landing page e conversion tracking."
    )
    assert _looks_like_marketing_provider_noise(
        "Agenzia marketing: offriamo gestione campagne Google Ads e social media marketing per aziende."
    )
    assert _looks_like_marketing_provider_noise(
        "https://atenasolution.it/gestione-social-per-aziende/ gestione-social media marketing"
    )
    assert not _looks_like_marketing_provider_noise(
        "Case study cliente: PMI Alfa Srl ha attivato campagne Google Ads e landing page."
    )


def test_agentic_stub_requires_confirmed_marketing_signal():
    weak = extracted_to_lead_stub(
        {
            "name": "Azienda Debole Srl",
            "website": "https://aziendadebole.it/",
            "evidence": "No Pixel sul sito e nessuna prova di campagne.",
            "source_url": "https://aziendadebole.it/",
            "matched_signals": ["investing_marketing"],
            "_required_signals": ["investing_marketing"],
            "domain_verification": {"status": "verified", "confidence": 0.9},
        },
        category="PMI che investono in marketing",
        location="Milano",
    )
    assert not _lead_satisfies_confirmed_required_signals(weak)

    strong = extracted_to_lead_stub(
        {
            "name": "Azienda Forte Srl",
            "website": "https://aziendaforte.it/",
            "evidence": "Campagna Google Ads attiva con landing page e conversion tracking.",
            "source_url": "https://aziendaforte.it/",
            "matched_signals": ["investing_marketing"],
            "_required_signals": ["investing_marketing"],
            "domain_verification": {"status": "verified", "confidence": 0.9},
        },
        category="PMI che investono in marketing",
        location="Milano",
    )
    assert _lead_satisfies_confirmed_required_signals(strong)
    assert any(s.get("type") == "investing_marketing" for s in strong.get("business_signals") or [])


def test_final_gate_drops_legacy_leads_without_confirmed_required_signal():
    intent = {"required_signals": ["investing_marketing"]}
    rows = [
        {
            "azienda": "Autocentri Debole",
            "sito": "https://autocentriesempio.it/",
            "business_signals": [{"type": "site_stale", "status": "confirmed"}],
        },
        {
            "azienda": "PMI Forte",
            "sito": "https://pmiforte.it/",
            "business_signals": [{"type": "investing_marketing", "status": "confirmed"}],
        },
    ]
    kept = _filter_results_by_confirmed_required_signals(rows, intent, stage="test")
    assert [lead["azienda"] for lead in kept] == ["PMI Forte"]


def test_final_gate_honors_hiring_alias_and_any_match_mode():
    hiring = {
        "azienda": "PMI Operativa Srl",
        "required_signals": ["hiring_operational", "contract_awarded", "production_expansion"],
        "business_signals": [{"type": "hiring", "status": "confirmed"}],
    }
    assert _lead_satisfies_confirmed_required_signals({**hiring, "signal_match_mode": "any"})
    assert not _lead_satisfies_confirmed_required_signals({**hiring, "signal_match_mode": "all"})
    assert _lead_satisfies_confirmed_required_signals({
        **hiring,
        "required_signals": ["hiring_operational"],
    })


def test_final_gate_rejects_global_brands_for_smb_signal_query():
    intent = {
        "query": "trovami aziende a Milano e Torino che stanno investendo in marketing",
        "required_signals": ["investing_marketing"],
    }
    confirmed_signal = [{"type": "investing_marketing", "status": "confirmed"}]
    rows = [
        {"azienda": "Uniqlo", "sito": "https://www.uniqlo.com/it/it/", "business_signals": confirmed_signal},
        {"azienda": "Ferrari Flagship Store Milano", "sito": "https://store.ferrari.com/", "business_signals": confirmed_signal},
        {"azienda": "Nike Milano", "sito": "https://www.nike.com/it/retail/", "business_signals": confirmed_signal},
        {"azienda": "Primark", "sito": "https://www.primark.com/it-it", "business_signals": confirmed_signal},
        {"azienda": "Studio Rossi Growth Srl", "sito": "https://studiorossigrowth.it/", "business_signals": confirmed_signal},
    ]

    kept = _filter_results_by_confirmed_required_signals(rows, intent, stage="test")

    assert [lead["azienda"] for lead in kept] == ["Studio Rossi Growth Srl"]


def test_final_gate_rejects_source_portals_as_leads_for_signal_query():
    intent = {
        "query": "trovami aziende a Milano e Torino che stanno investendo in marketing",
        "required_signals": ["investing_marketing"],
    }
    confirmed_signal = [{"type": "investing_marketing", "status": "confirmed"}]
    rows = [
        {"azienda": "Youtrend", "sito": "https://www.youtrend.it/", "business_signals": confirmed_signal},
        {"azienda": "Unicusano", "sito": "https://www.unicusano.it/", "business_signals": confirmed_signal},
        {"azienda": "Bancadellecase", "sito": "https://www.bancadellecase.it/", "business_signals": confirmed_signal},
        {"azienda": "Ti Aiuto", "sito": "https://ti-aiuto.it/", "business_signals": confirmed_signal},
        {"azienda": "Studio Growth B2B Srl", "sito": "https://studiogrowthb2b.it/", "business_signals": confirmed_signal},
    ]

    kept = _filter_results_by_confirmed_required_signals(rows, intent, stage="test")

    assert [lead["azienda"] for lead in kept] == ["Studio Growth B2B Srl"]


def test_enterprise_guard_does_not_block_local_homonym_pmi():
    intent = {
        "query": "PMI locali che investono in marketing",
        "required_signals": ["investing_marketing"],
    }
    rows = [
        {
            "azienda": "Ferrari Nautica Srl",
            "sito": "https://ferrarinautica.it/",
            "business_signals": [{"type": "investing_marketing", "status": "confirmed"}],
        }
    ]

    kept = _filter_results_by_confirmed_required_signals(rows, intent, stage="test")

    assert [lead["azienda"] for lead in kept] == ["Ferrari Nautica Srl"]


def test_agentic_signal_stream_defers_pending_publish_and_upsert(monkeypatch):
    import agents.agentic_gap_fill as gap_fill
    import worker_supabase

    monkeypatch.setattr(
        gap_fill,
        "prepare_agentic_extracted_item",
        lambda item, location="": {
            **item,
            "website": "https://studio-growth-b2b.it/",
            "domain_verification": {"status": "verified", "confidence": 0.95, "url": "https://studio-growth-b2b.it/"},
        },
    )
    monkeypatch.setattr(
        gap_fill,
        "extracted_to_lead_stub",
        lambda prepared, category, location: {
            "azienda": prepared["name"],
            "sito": prepared["website"],
            "required_signals": ["investing_marketing"],
            "business_signals": [{"type": "investing_marketing", "status": "confirmed"}],
        },
    )
    monkeypatch.setattr(gap_fill, "lead_dedupe_key", lambda name="", website="", azienda="": "web:studio-growth-b2b.it")
    upserts = []
    publishes = []
    monkeypatch.setattr(worker_supabase, "_upsert_single_search_lead_safe", lambda *args, **kwargs: upserts.append(args))

    ok = _agentic_stream_one_lead(
        {
            "name": "Studio Growth B2B Srl",
            "evidence": "Campagna Google Ads attiva con landing page e conversion tracking.",
            "matched_signals": ["investing_marketing"],
            "_required_signals": ["investing_marketing"],
        },
        accumulated=[],
        seen=set(),
        category="PMI che investono in marketing",
        location="Milano",
        publish_cb=lambda *args, **kwargs: publishes.append((args, kwargs)),
        supabase=None,
        search_id="test-search",
        user_id="test-user",
        defer_publish_until_audit=True,
    )

    assert ok is True
    assert publishes == []
    assert upserts == []


def test_agentic_marketing_stream_rejects_event_festival_non_buyer(monkeypatch):
    import agents.agentic_gap_fill as gap_fill

    monkeypatch.setattr(
        gap_fill,
        "prepare_agentic_extracted_item",
        lambda item, location="": {
            **item,
            "website": "https://www.selvaticafestival.net/",
            "domain_verification": {"status": "verified", "confidence": 0.95, "url": "https://www.selvaticafestival.net/"},
        },
    )
    monkeypatch.setattr(
        gap_fill,
        "extracted_to_lead_stub",
        lambda prepared, category, location: {
            "azienda": prepared["name"],
            "sito": prepared["website"],
            "required_signals": ["investing_marketing"],
            "business_signals": [{"type": "investing_marketing", "status": "confirmed"}],
        },
    )
    monkeypatch.setattr(gap_fill, "lead_dedupe_key", lambda name="", website="", azienda="": "web:selvaticafestival.net")

    accumulated = []
    ok = _agentic_stream_one_lead(
        {
            "name": "Selvatica - Arte e Natura in Festival",
            "evidence": "Campagna Google Ads attiva con landing page e conversion tracking.",
            "matched_signals": ["investing_marketing"],
            "_required_signals": ["investing_marketing"],
        },
        accumulated=accumulated,
        seen=set(),
        category="PMI che investono in marketing",
        location="Milano",
        publish_cb=lambda *args, **kwargs: None,
        supabase=None,
        search_id="test-search",
        user_id="test-user",
        defer_publish_until_audit=True,
    )

    assert ok is False
    assert accumulated == []
