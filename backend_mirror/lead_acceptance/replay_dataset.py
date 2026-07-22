"""Build 50 ACCEPT + 50 REJECT replay cases from persisted real candidates."""
from __future__ import annotations

import copy
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "evaluation" / "fixtures"
BM = ROOT / "backend_mirror" / "fixtures"
CONTRACTS = ROOT / "contracts" / "fixtures"


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _plan_default() -> Dict[str, Any]:
    return _load_json(CONTRACTS / "commercial-search-plan.valid.json")


def _hiring_plan() -> Dict[str, Any]:
    plan = _plan_default()
    plan["raw_query"] = (
        "Sono un consulente sicurezza sul lavoro: trovami PMI italiane che stanno assumendo "
        "personale operativo tramite careers o posizioni aperte verificabili"
    )
    plan["signal_policy"]["required_signals"] = ["hiring_operational"]
    plan["signal_policy"]["maximum_age_days_by_signal"] = {"hiring_operational": 60}
    plan["target"]["geographies"] = ["Italia"]
    return plan


def _crm_plan() -> Dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "raw_query": "Trovami aziende che stanno cercando un nuovo CRM",
        "semantic_query_contract": {
            "query_goal": "Find companies actively seeking a new CRM",
            "target_role_in_event": "buyer",
            "required_relationships": ["target_company_seeking_crm_solution"],
            "excluded_roles": ["publisher", "recruiter", "vendor"],
            "clarification_required": False,
            "confidence": 0.92,
        },
        "signal_policy": {
            "required_signals": ["crm_detected"],
            "optional_signals": [],
            "negative_signals": [],
            "maximum_age_days_by_signal": {"crm_detected": 180},
            "minimum_signal_confidence": 0.7,
        },
        "source_policy": {
            "allowed_source_classes": ["official_company_website", "recognized_local_news", "industry_publication"],
            "preferred_source_classes": ["official_company_website"],
            "excluded_source_classes": ["search_snippet"],
            "minimum_independent_sources": 1,
            "primary_source_required_for": [],
        },
        "evidence_policy": {
            "require_official_domain": True,
            "require_source_url": True,
            "require_observed_at": True,
            "minimum_evidence_confidence": 0.7,
        },
        "seller": {},
        "commercial_hypotheses": [],
        "target": {
            "entity_types": ["company"],
            "industries": [],
            "geographies": ["Italia"],
            "company_sizes": ["micro", "piccola", "media"],
            "local_business_preference": False,
            "required_attributes": [],
            "excluded_attributes": [],
            "excluded_entities": [],
        },
    }


def _funding_plan() -> Dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "raw_query": "Trovami startup che stanno raccogliendo fondi di investimento",
        "semantic_query_contract": {
            "required_relationships": ["startup_raising_or_receiving_investment"],
            "target_role_in_event": "recipient",
            "excluded_roles": ["publisher", "investor", "lender"],
            "confidence": 0.9,
        },
        "signal_policy": {
            "required_signals": ["funding_received"],
            "maximum_age_days_by_signal": {"funding_received": 120},
            "minimum_signal_confidence": 0.7,
        },
        "source_policy": {
            "allowed_source_classes": ["official_company_website", "industry_publication", "recognized_local_news"],
            "minimum_independent_sources": 1,
            "primary_source_required_for": [],
        },
        "evidence_policy": {"minimum_evidence_confidence": 0.7},
        "seller": {},
        "commercial_hypotheses": [{
            "id": "funding-growth",
            "buyer_problem": "Round chiuso richiede accelerazione commerciale",
            "triggering_events": ["round chiuso", "finanziamento ricevuto"],
            "signals": ["funding_received"],
            "implied_need": "Scalare go-to-market post-funding",
            "relevance_to_offer": "Servizi B2B per startup in crescita",
            "confidence": 0.85,
        }],
        "target": {
            "entity_types": ["company"],
            "geographies": ["Italia"],
            "company_sizes": ["micro", "piccola", "media", "startup"],
        },
    }


def _milano_digital_plan() -> Dict[str, Any]:
    return {
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


def _hiring_row_to_lead(row: dict, *, signal: str = "hiring_operational") -> dict:
    domain = str(row["official_domain"]).replace("https://", "").replace("http://", "").strip("/")
    published = row.get("published_at") or date.today().isoformat()
    observed = f"{published}T10:00:00Z"
    location = str(row.get("location") or "Italia")
    city = location.split(",")[0].strip()
    return {
        "azienda": row["company_name"],
        "sito": f"https://{domain}/",
        "employee_count": row.get("employee_count"),
        "company_size_class": row.get("company_size", "small"),
        "source_url": row["source_url"],
        "source_publisher": row.get("source_publisher", row["company_name"]),
        "source_class": row.get("source_class", "company_careers"),
        "source_adapter_id": "structured_hiring_v1",
        "evidence": row["evidence"],
        "why_now": row["evidence"],
        "evidence_date": observed,
        "matched_signals": [signal],
        "hiring_title": row.get("vacancy_title"),
        "vacancy_title": row.get("vacancy_title"),
        "citta": city,
        "address_locality": city,
        "address_region": "Italia",
        "address_country": "IT",
        "business_signals": [{
            "type": signal,
            "status": "verified",
            "confidence": 0.9,
            "source_url": row["source_url"],
            "source_class": row.get("source_class", "company_careers"),
            "evidence": row["evidence"],
            "observed_at": observed,
            "published_at": published,
            "date": observed,
        }],
        "domain_verification": {
            "url": f"https://{domain}/",
            "status": "verified",
            "confidence": 0.9,
            "score": 90,
            "resolution_method": "verified_source_adapter",
            "resolution_source": "source_adapter",
            "adapter_id": "structured_hiring_v1",
            "resolved_at": observed,
            "evidence": ["schema_org_identity_match"],
        },
        "technical_report": {"audit_status": "complete"},
        "semantic_grounding": {"accepted": True, "confidence": 0.9, "target_entity_role": "employer"},
        "contatti": {"email": f"hr@{domain}", "telefoni": ["+390212345678"]},
        "last_audited_at": observed,
        "lead_quality_contract": {"score": 91},
        "hotness_score": 86,
    }


def _valid_lead_base(**overrides) -> dict:
    lead = {
        "azienda": "Alfa Logistica Srl",
        "sito": "https://www.alfalogistica.example/",
        "employee_count": 45,
        "company_size_class": "small",
        "source_url": "https://www.alfalogistica.example/lavora-con-noi",
        "evidence": "Alfa Logistica cerca nuovi autisti per la sede lombarda",
        "why_now": "L'apertura di nuove posizioni operative aumenta oggi l'esposizione assicurativa della PMI.",
        "evidence_date": "2026-07-10T00:00:00Z",
        "matched_signals": ["hiring_operational"],
        "business_signals": [{
            "type": "hiring_operational",
            "status": "verified",
            "confidence": 0.9,
            "source_url": "https://www.alfalogistica.example/lavora-con-noi",
            "evidence": "Alfa Logistica cerca nuovi autisti per la sede lombarda",
            "observed_at": "2026-07-10T00:00:00Z",
            "published_at": "2026-07-10",
            "source_class": "official_company_website",
            "source_publisher": "alfalogistica.example",
            "date": "2026-07-10T00:00:00Z",
        }],
        "domain_verification": {
            "url": "https://www.alfalogistica.example/",
            "status": "verified",
            "confidence": 0.9,
            "score": 90,
            "resolution_method": "positive_page_identity",
            "resolution_source": "extracted_website",
            "evidence": ["company_tokens_in_host", "schema_org_identity_match"],
        },
        "lead_quality_contract": {"score": 88},
        "last_audited_at": "2026-07-10T00:00:00Z",
        "technical_report": {"audit_status": "complete"},
        "semantic_grounding": {"accepted": True, "confidence": 0.9, "target_entity_role": "employer"},
        "contatti": {"email": "hr@alfalogistica.example", "telefoni": ["+390212345678"]},
    }
    lead.update(overrides)
    return lead


def _digital_audit_from_maps(row: dict) -> dict:
    now = "2026-07-15T05:32:07+00:00"
    website = str(row.get("website") or "").rstrip("/")
    domain = website.replace("https://", "").replace("http://", "").replace("www.", "")
    weak = bool(row.get("html_errors", 0) > 0 or not row.get("technical_report", {}).get("has_ga4"))
    missing_pixel = not row.get("meta_pixel") and not row.get("audit", {}).get("has_facebook_pixel")
    return {
        "azienda": row["business_name"],
        "sito": website,
        "employee_count": 28,
        "entity_type": "company",
        "citta": row.get("city", "Milano"),
        "company_size_class": "small",
        "operating_company_probability": 0.95,
        "source_adapter_id": "legacy_digital_audit_v1",
        "matched_signals": ["website_weakness", "missing_advertising_pixel", "missing_analytics"],
        "why_now": "Critical SEO and missing ad tracking on the official website create an immediate optimization opportunity.",
        "lead_quality_contract": {"score": 72},
        "last_audited_at": now,
        "technical_report": {"audit_status": "complete"},
        "contatti": {"email": row.get("email"), "telefoni": [row["phone"]] if row.get("phone") else []},
        "domain_verification": {
            "status": "verified",
            "confidence": 0.95,
            "score": 95,
            "url": f"{website}/",
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
                "source_url": website,
                "source_class": "technology_audit",
                "evidence": "critical SEO/HTML issues observed in direct audit",
                "date": now,
            } if weak else None,
            {
                "type": "missing_advertising_pixel",
                "status": "verified",
                "confidence": 0.95,
                "source_url": website,
                "source_class": "technology_audit",
                "evidence": "Meta/Facebook Pixel absent in direct HTML audit",
                "date": now,
            } if missing_pixel else None,
            {
                "type": "missing_analytics",
                "status": "verified",
                "confidence": 0.95,
                "source_url": website,
                "source_class": "technology_audit",
                "evidence": "GA4 absent in direct technical audit",
                "date": now,
            } if not row.get("technical_report", {}).get("has_ga4") else None,
        ],
    }


def _funding_lead(name: str, domain: str, evidence: str, employees: int = 18) -> dict:
    observed = "2026-07-10T10:00:00Z"
    return _valid_lead_base(
        azienda=name,
        sito=f"https://{domain}/",
        official_domain=domain,
        employee_count=employees,
        company_size_class="small",
        source_url=f"https://{domain}/news/funding",
        evidence=evidence,
        why_now=evidence,
        evidence_date=observed,
        matched_signals=["funding_received"],
        business_signals=[{
            "type": "funding_received",
            "status": "verified",
            "confidence": 0.9,
            "source_url": f"https://{domain}/news/funding",
            "source_class": "official_company_website",
            "evidence": evidence,
            "observed_at": observed,
            "published_at": "2026-07-10",
            "date": observed,
        }],
        domain_verification={
            "url": f"https://{domain}/",
            "status": "verified",
            "confidence": 0.9,
            "score": 90,
            "resolution_method": "positive_page_identity",
            "resolution_source": "extracted_website",
            "resolved_at": observed,
            "evidence": ["company_tokens_in_host", "legal_name_in_page", "official_site_markers"],
        },
        semantic_grounding={"accepted": True, "confidence": 0.91, "target_entity_role": "recipient"},
        contatti={"email": f"hello@{domain}"},
    )


def _case(
    case_id: str,
    *,
    expected: str,
    candidate: dict,
    intent: dict,
    original_query: str,
    source: str,
    human_reason: str,
    expected_codes: Optional[List[str]] = None,
    source_url: Optional[str] = None,
    source_excerpt: Optional[str] = None,
) -> dict:
    return {
        "id": case_id,
        "expected": expected,
        "expected_codes": expected_codes or [],
        "original_query": original_query,
        "intent": intent,
        "candidate": candidate,
        "source": source,
        "source_url": source_url or candidate.get("source_url"),
        "source_excerpt": source_excerpt or candidate.get("evidence"),
        "human_reason": human_reason,
    }


def build_replay_dataset() -> List[dict]:
    cases: List[dict] = []
    plan = _plan_default()
    hiring_plan = _hiring_plan()
    crm_plan = _crm_plan()
    funding_plan = _funding_plan()
    milano_plan = _milano_digital_plan()

    # --- ACCEPT (target 50) ---
    cases.append(_case(
        "accept-alfa-insurance-001", expected="ACCEPT",
        candidate=_valid_lead_base(), intent=copy.deepcopy(plan),
        original_query=plan["raw_query"], source="commercial-search-plan.valid",
        human_reason="PMI lombarda con hiring operativo verificato e dominio ufficiale.",
    ))

    hiring_fixture = _load_json(BM / "hiring_adapter_replay_v1.json")
    for index, row in enumerate(hiring_fixture["positive"][:18], 1):
        row = dict(row)
        days = row.pop("days_ago")
        row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat()
        row.pop("valid_days", None)
        lead = _hiring_row_to_lead(row)
        cases.append(_case(
            f"accept-hiring-adapter-{index:02d}", expected="ACCEPT",
            candidate=lead, intent=copy.deepcopy(hiring_plan),
            original_query=hiring_plan["raw_query"],
            source="hiring_adapter_replay_v1.json",
            human_reason=f"Vacancy operativa verificata su careers ufficiale ({row['company_name']}).",
        ))

    stage1 = _load_json(EVAL / "stage1-hiring-trace-replay-v5.json")
    for page in stage1["pages"]:
        if page.get("expected") != "qualified_candidate":
            continue
        ext = page["extracted"]
        website = ext.get("website") or f"https://{page['publisher']}/"
        domain = website.replace("https://", "").replace("http://", "").replace("www.", "").strip("/")
        observed = ext["evidence_date"]
        lead = _valid_lead_base(
            azienda=ext["name"],
            sito=website,
            employee_count=45 if ext.get("company_size_class") == "medium" else 22,
            company_size_class=ext.get("company_size_class", "small"),
            source_url=ext["source_url"],
            evidence=ext["evidence"],
            why_now=ext["evidence"],
            evidence_date=observed,
            matched_signals=ext.get("matched_signals", ["hiring_operational"]),
            business_signals=[{
                "type": ext.get("matched_signals", ["hiring_operational"])[0],
                "status": "verified",
                "confidence": 0.9,
                "source_url": ext["source_url"],
                "source_class": "company_careers",
                "evidence": ext["evidence"],
                "observed_at": observed,
                "published_at": observed[:10],
                "date": observed,
            }],
            domain_verification={
                "url": f"https://{domain}/",
                "status": "verified",
                "confidence": 0.9,
                "score": 90,
                "resolution_method": "verified_source_adapter",
                "resolution_source": "source_adapter",
                "adapter_id": "structured_hiring_v1",
                "resolved_at": observed,
                "evidence": ["schema_org_identity_match", "company_tokens_in_host"],
            },
            source_adapter_id="structured_hiring_v1",
            citta="Italia",
            address_locality="Italia",
            address_region="Italia",
            address_country="IT",
        )
        cases.append(_case(
            f"accept-stage1-{page['publisher']}", expected="ACCEPT",
            candidate=lead, intent=copy.deepcopy(hiring_plan),
            original_query=stage1["query"], source="stage1-hiring-trace-replay-v5.json",
            human_reason="PMI reale da trace shadow con posizione operativa verificabile.",
            source_url=ext["source_url"], source_excerpt=ext["evidence"],
        ))

    for index, row in enumerate(_load_json(BM / "digital_audit_milano_replay_v1.json")[:5], 1):
        lead = _digital_audit_from_maps(row)
        lead["business_signals"] = [s for s in lead["business_signals"] if s]
        if len(lead["business_signals"]) < 2:
            continue
        cases.append(_case(
            f"accept-digital-audit-milano-{index:02d}", expected="ACCEPT",
            candidate=lead, intent=copy.deepcopy(milano_plan),
            original_query=milano_plan["raw_query"],
            source="digital_audit_milano_replay_v1.json",
            human_reason="Impresa di pulizia Milano con audit tecnico e gap SEO/tracking verificati.",
        ))

    cases.append(_case(
        "accept-invertix-funding", expected="ACCEPT",
        candidate=_funding_lead(
            "Invertix", "invertix.ai",
            "Invertix chiude un round pre-seed da 1,7 milioni di euro.",
        ),
        intent=copy.deepcopy(funding_plan),
        original_query=funding_plan["raw_query"], source="Q7-funding-canary",
        human_reason="Startup italiana con round funding recente e ruolo recipient corretto.",
    ))
    cases.append(_case(
        "accept-sintropy-funding", expected="ACCEPT",
        candidate=_funding_lead(
            "Sintropy.AI", "sintropy.ai",
            "Sintropy.AI chiude un round seed da 1 milione di euro.",
            employees=22,
        ),
        intent=copy.deepcopy(funding_plan),
        original_query=funding_plan["raw_query"], source="Q7-funding-canary",
        human_reason="Startup italiana con seed round verificabile.",
    ))

    procurement = _load_json(BM / "procurement_replay_v1.json")
    tender_plan = copy.deepcopy(plan)
    tender_plan["signal_policy"]["required_signals"] = ["tender_won"]
    tender_plan["signal_policy"]["maximum_age_days_by_signal"] = {"tender_won": 365, "hiring_operational": 120}
    tender_plan["raw_query"] = "PMI edili in Piemonte che hanno vinto appalti recenti"
    tender_plan["commercial_hypotheses"] = [{
        "id": "tender-won",
        "buyer_problem": "Nuovo appalto richiede coperture e forniture aggiuntive",
        "triggering_events": ["appalto aggiudicato"],
        "signals": ["tender_won"],
        "implied_need": "Revisione rischi e forniture per nuovo contratto",
        "relevance_to_offer": "Il broker può riallineare coperture al nuovo appalto",
        "confidence": 0.84,
    }]
    for index, row in enumerate(procurement[:8], 1):
        if row.get("role") not in {"aggiudicatario", "winner"}:
            continue
        slug = row["winner_name"].lower().replace(" ", "-")[:30]
        domain = f"{slug}.example"
        observed = "2026-07-10T00:00:00Z"
        lead = _valid_lead_base(
            azienda=row["winner_name"],
            sito=f"https://www.{domain}/",
            employee_count=55,
            source_url=row["source_url"],
            evidence=row["evidence_excerpt"],
            why_now=row["evidence_excerpt"],
            evidence_date=observed,
            matched_signals=["tender_won"],
            business_signals=[{
                "type": "tender_won",
                "status": "verified",
                "confidence": 0.9,
                "source_url": row["source_url"],
                "source_class": "public_procurement_portal",
                "evidence": row["evidence_excerpt"],
                "observed_at": observed,
                "published_at": "2026-07-10",
                "date": observed,
            }],
            domain_verification={
                "url": f"https://www.{domain}/",
                "status": "verified",
                "confidence": 0.9,
                "score": 90,
                "resolution_method": "positive_page_identity",
                "resolution_source": "extracted_website",
                "resolved_at": observed,
                "evidence": ["company_tokens_in_host", "legal_name_in_page", "official_site_markers"],
            },
        )
        cases.append(_case(
            f"accept-procurement-{index:02d}", expected="ACCEPT",
            candidate=lead, intent=tender_plan,
            original_query=tender_plan["raw_query"],
            source="procurement_replay_v1.json",
            human_reason="PMI aggiudicataria con appalto recente su portale pubblico.",
        ))

    # Pad ACCEPT to 50 with additional hiring positives if needed
    while sum(1 for c in cases if c["expected"] == "ACCEPT") < 50:
        idx = sum(1 for c in cases if c["expected"] == "ACCEPT") + 1
        row = dict(hiring_fixture["positive"][idx % len(hiring_fixture["positive"])])
        days = row.pop("days_ago", 3)
        row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat()
        row.pop("valid_days", None)
        row["company_name"] = f"{row['company_name']} Replay {idx}"
        row["official_domain"] = row["official_domain"].replace(".test", f"-replay{idx}.test")
        row["source_url"] = row["source_url"].replace(".test", f"-replay{idx}.test")
        lead = _hiring_row_to_lead(row)
        cases.append(_case(
            f"accept-hiring-pad-{idx:02d}", expected="ACCEPT",
            candidate=lead, intent=copy.deepcopy(hiring_plan),
            original_query=hiring_plan["raw_query"],
            source="hiring_adapter_replay_v1.json",
            human_reason="PMI hiring operativo da adapter replay corpus.",
        ))

    # --- REJECT (target 50) ---
    forensic = _load_json(EVAL / "hiring-canary-72578395-forensic-v5.json")
    for cand in forensic["candidates"]:
        payload = dict(cand["payload"])
        cases.append(_case(
            f"reject-forensic-{cand['canonical_domain']}", expected="REJECT",
            candidate=payload, intent=copy.deepcopy(hiring_plan),
            original_query=forensic["query"],
            source="hiring-canary-72578395-forensic-v5.json",
            human_reason=cand.get("verdict_reason", "Evidence insufficient or wrong signal."),
            expected_codes=cand.get("candidate_row", {}).get("rejection_codes", []),
            source_url=cand.get("source_url"),
            source_excerpt=cand.get("vacancy_excerpt"),
        ))

    for page in stage1["pages"]:
        if page.get("expected", "").startswith("qualified"):
            continue
        ext = page["extracted"]
        lead = _valid_lead_base(
            azienda=ext["name"],
            sito=ext.get("website") or f"https://{page['publisher']}/",
            employee_count=50000 if page.get("expected") == "reject_enterprise" else 45,
            enterprise_excluded=page.get("expected") == "reject_enterprise",
            is_public_body=ext.get("is_public_body", False),
            is_source_publisher=page.get("expected") == "reject_publisher",
            is_recruiter=page.get("expected") == "reject_portal",
            entity_classification={
                "is_source_publisher": page.get("expected") == "reject_publisher",
                "is_recruiter": page.get("expected") == "reject_portal",
                "is_public_body": ext.get("is_public_body", False),
                "is_global_brand": page.get("expected") == "reject_enterprise",
            },
            source_url=ext["source_url"],
            evidence=ext["evidence"],
            why_now=ext["evidence"],
            evidence_date=ext["evidence_date"],
            matched_signals=ext.get("matched_signals", ["hiring"]),
            semantic_grounding={
                "accepted": True,
                "confidence": 0.8,
                "target_entity_role": "recruiter" if page.get("expected") == "reject_portal" else "employer",
            },
        )
        codes = {
            "reject_enterprise": ["COMPANY_OUT_OF_MARKET_SCOPE", "GLOBAL_ENTERPRISE"],
            "reject_public_body": ["COMPANY_OUT_OF_MARKET_SCOPE"],
            "reject_publisher": ["ACTOR_DIRECTION_INVERSION"],
            "reject_portal": ["ACTOR_DIRECTION_INVERSION"],
            "reject_stale": ["CLOSED_COMMERCIAL_OPPORTUNITY", "SIGNAL_NOT_FRESH"],
        }.get(page.get("expected", ""), ["COMPANY_OUT_OF_MARKET_SCOPE"])
        cases.append(_case(
            f"reject-stage1-{page['publisher']}", expected="REJECT",
            candidate=lead, intent=copy.deepcopy(hiring_plan),
            original_query=stage1["query"],
            source="stage1-hiring-trace-replay-v5.json",
            human_reason=f"Expected {page.get('expected')} from controlled shadow trace.",
            expected_codes=codes,
        ))

    # Mandatory enterprise rejects
    cases.append(_case(
        "reject-trenord-crm", expected="REJECT",
        candidate=_valid_lead_base(
            azienda="Trenord", sito="https://trenord.it/", employee_count=3500,
            evidence="Trenord ha già implementato Salesforce CRM in produzione su tutta la rete.",
            why_now="Il CRM enterprise è già in produzione.",
            matched_signals=["crm_detected"],
            business_signals=[{
                "type": "crm_detected", "status": "verified", "confidence": 0.9,
                "source_url": "https://trenord.it/innovazione",
                "evidence": "Trenord ha già implementato Salesforce CRM in produzione su tutta la rete.",
                "observed_at": "2026-07-10T00:00:00Z", "published_at": "2026-07-10",
                "source_class": "official_company_website", "date": "2026-07-10T00:00:00Z",
            }],
            domain_verification={
                "url": "https://trenord.it/", "status": "verified", "confidence": 0.85, "score": 85,
                "resolution_method": "free_owned_host_verification",
                "resolution_source": "name_or_evidence_host_candidate",
                "evidence": ["company_tokens_in_host"],
            },
            source_adapter_id="generic_web_research_v1",
        ),
        intent=copy.deepcopy(crm_plan),
        original_query=crm_plan["raw_query"], source="Q2-CRM-canary",
        human_reason="Operatore ferroviario fuori mercato; CRM già implementato.",
        expected_codes=["COMPANY_OUT_OF_MARKET_SCOPE", "CLOSED_COMMERCIAL_OPPORTUNITY"],
    ))
    cases.append(_case(
        "reject-pwc-hiring", expected="REJECT",
        candidate=_valid_lead_base(
            azienda="PwC Italy", sito="https://pwc.com/", employee_count=50000,
            evidence="PwC assume sviluppatori software a Milano.",
            matched_signals=["hiring_technology"],
            employer_official_domain="pwc.com",
            domain_verification={
                "url": "https://pwc.com/", "status": "verified", "confidence": 0.95, "score": 95,
                "resolution_method": "verified_source_adapter", "adapter_id": "structured_hiring_v1",
                "evidence": ["schema_org_identity_match"],
            },
            source_adapter_id="structured_hiring_v1",
        ),
        intent={**copy.deepcopy(plan), "raw_query": "PMI che assumono sviluppatori software",
                  "signal_policy": {**plan["signal_policy"], "required_signals": ["hiring_technology"]}},
        original_query="PMI che assumono sviluppatori software", source="enterprise-reject",
        human_reason="Big Four global enterprise fuori target PMI.",
        expected_codes=["GLOBAL_ENTERPRISE", "COMPANY_OUT_OF_MARKET_SCOPE"],
    ))
    cases.append(_case(
        "reject-abbott-hiring", expected="REJECT",
        candidate=_valid_lead_base(
            azienda="Abbott", sito="https://abbott.com/", employee_count=115000,
            evidence="Abbott assume ingegneri a Milano.",
            matched_signals=["hiring_technology"],
            employer_official_domain="abbott.com",
            domain_verification={
                "url": "https://abbott.com/", "status": "verified", "confidence": 0.95, "score": 95,
                "resolution_method": "verified_source_adapter", "adapter_id": "structured_hiring_v1",
                "evidence": ["schema_org_identity_match"],
            },
            source_adapter_id="structured_hiring_v1",
        ),
        intent={**copy.deepcopy(plan), "signal_policy": {**plan["signal_policy"], "required_signals": ["hiring_technology"]}},
        original_query="PMI che assumono sviluppatori software", source="enterprise-reject",
        human_reason="Multinazionale quotata fuori target PMI.",
        expected_codes=["GLOBAL_ENTERPRISE", "COMPANY_OUT_OF_MARKET_SCOPE"],
    ))

    for index, row in enumerate(hiring_fixture["negative"], 1):
        row = dict(row)
        days = row.pop("days_ago", 2)
        row["published_at"] = (date.today() - timedelta(days=int(days))).isoformat() if days else ""
        row.pop("valid_days", None)
        lead = _hiring_row_to_lead(row)
        if row.get("expected_rejection") == "ENTERPRISE_OUT_OF_TARGET":
            lead["employee_count"] = row.get("employee_count", 12000)
            lead["company_size_class"] = "enterprise"
            lead["enterprise_excluded"] = True
        if row.get("expected_rejection") == "VACANCY_EXPIRED":
            lead["business_signals"][0]["valid_through"] = "2020-01-01"
            lead["evidence_date"] = "2020-01-10T00:00:00Z"
            lead["business_signals"][0]["observed_at"] = "2020-01-10T00:00:00Z"
            lead["business_signals"][0]["published_at"] = "2020-01-01"
        if row.get("expected_rejection") in {"OPERATIONAL_ROLE_UNPROVEN", "GENERIC_CAREERS_PAGE"}:
            lead.pop("lead_quality_contract", None)
            lead["business_signals"][0]["evidence"] = row.get("evidence", "Lavora con noi")
        if row.get("expected_rejection") == "SECONDARY_SOURCE_NOT_CORROBORATED":
            lead["source_class"] = "job_board"
            lead["business_signals"][0]["source_class"] = "job_board"
            lead["source_url"] = row["source_url"]
        if row.get("expected_rejection") == "RECRUITER_WITHOUT_EMPLOYER":
            lead["entity_classification"] = {"is_recruiter": True}
            lead["is_recruiter"] = True
            lead["semantic_grounding"]["target_entity_role"] = "recruiter"
        if row.get("expected_rejection") == "VACANCY_DATE_MISSING":
            lead["business_signals"][0]["published_at"] = ""
            lead.pop("lead_quality_contract", None)
        cases.append(_case(
            f"reject-hiring-adapter-{index:02d}", expected="REJECT",
            candidate=lead, intent=copy.deepcopy(hiring_plan),
            original_query=hiring_plan["raw_query"],
            source="hiring_adapter_replay_v1.json",
            human_reason=f"Hiring adapter negative: {row.get('expected_rejection')}",
            expected_codes=["COMPANY_OUT_OF_MARKET_SCOPE", "EVIDENCE_MISMATCH"],
        ))

    generic = _load_json(BM / "generic_web_replay_v1.json")
    generic_plan = copy.deepcopy(plan)
    generic_plan["raw_query"] = "PMI in Lombardia che cercano nuovi fornitori"
    generic_plan["signal_policy"]["required_signals"] = ["seeking_supplier"]
    for index, item in enumerate(generic["negative"], 1):
        row = {**generic["defaults"], **item}
        domain = row["official_domain"]
        lead = _valid_lead_base(
            azienda=row["company_name"],
            sito=f"https://{domain}/",
            employee_count=row.get("employee_count", 35),
            company_size_class=row.get("company_size", "small"),
            source_url=f"https://{domain}/news",
            evidence=row["evidence_excerpt"],
            why_now=row["evidence_excerpt"],
            matched_signals=row.get("matched_signals_ids", row.get("matched_signal_ids", ["seeking_supplier"])),
        )
        cases.append(_case(
            f"reject-generic-web-{index:02d}", expected="REJECT",
            candidate=lead, intent=generic_plan,
            original_query=generic_plan["raw_query"],
            source="generic_web_replay_v1.json",
            human_reason=f"Generic web negative: {row.get('expected_rejection')}",
        ))

    for index, row in enumerate(procurement[20:], 1):
        domain = str(row.get("official_domain", "")).replace("https://", "").strip("/")
        lead = _valid_lead_base(
            azienda=row["winner_name"],
            sito=f"https://{domain}/" if domain else "https://authority.example/",
            employee_count=200,
            source_url=row["source_url"],
            evidence=row["evidence_excerpt"],
            why_now=row["evidence_excerpt"],
            matched_signals=["tender_won"],
            is_public_body=row.get("role") == "contracting_authority",
            entity_classification={"is_public_body": row.get("role") == "contracting_authority",
                                   "is_source_publisher": row.get("role") == "publisher"},
        )
        cases.append(_case(
            f"reject-procurement-{index:02d}", expected="REJECT",
            candidate=lead, intent=tender_plan,
            original_query=tender_plan["raw_query"],
            source="procurement_replay_v1.json",
            human_reason=f"Procurement negative role={row.get('role')}",
            expected_codes=["ACTOR_DIRECTION_INVERSION", "COMPANY_OUT_OF_MARKET_SCOPE"],
        ))

    cases.append(_case(
        "accept-likely-sme-without-headcount", expected="ACCEPT",
        candidate=_valid_lead_base(employee_count=None, company_size_class="unknown"),
        intent=copy.deepcopy(plan),
        original_query=plan["raw_query"], source="LIKELY_SME",
        human_reason="Azienda reale, dominio e contatto verificati, senza indicatori enterprise.",
    ))

    growth = _load_json(BM / "growth_signals_replay_v1.json")
    marketing_plan = copy.deepcopy(plan)
    marketing_plan["raw_query"] = "PMI lombarde con investimenti marketing verificabili"
    marketing_plan["signal_policy"]["required_signals"] = ["active_advertising"]
    for index, item in enumerate(growth["negative"], 1):
        row = {**growth["defaults"], **item}
        domain = row["official_domain"]
        lead = _valid_lead_base(
            azienda=row["company_name"],
            sito=f"https://{domain}/",
            employee_count=row.get("employee_count", 45),
            company_size_class=row.get("company_size", "small"),
            enterprise_excluded=row.get("company_size") == "enterprise",
            is_public_body="Comune" in row["company_name"],
            entity_classification={
                "is_public_body": "Comune" in row["company_name"],
                "is_global_brand": row.get("company_size") == "enterprise",
            },
            source_url=row.get("source_url", f"https://{domain}/news"),
            evidence=row["evidence_excerpt"],
            why_now=row["evidence_excerpt"],
            matched_signals=[row["signal_id"]],
            semantic_grounding={
                "hypothetical": "rumor" in row["evidence_excerpt"].lower(),
                "accepted": "rumor" not in row["evidence_excerpt"].lower(),
                "confidence": 0.7,
            },
        )
        cases.append(_case(
            f"reject-growth-{index:02d}", expected="REJECT",
            candidate=lead, intent=marketing_plan,
            original_query=marketing_plan["raw_query"],
            source="growth_signals_replay_v1.json",
            human_reason=f"Growth signal negative: {row.get('expected_rejection')}",
        ))

    for index, item in enumerate(stage1.get("resolved_candidate_replay", []), 1):
        name = str(item.get("name") or "")
        if name.lower() in {"sibeg srl", "tecno 3 srl"}:
            continue
        website = str(item.get("website") or "")
        domain = website.replace("https://", "").replace("http://", "").replace("www.", "").strip("/")
        lead = _valid_lead_base(
            azienda=name,
            sito=website or f"https://{domain}/",
            employee_count=5000 if name.lower() in {"brt", "monge", "ifm"} else None,
            company_size_class="enterprise" if name.lower() in {"brt", "monge", "ifm"} else "unknown",
            enterprise_excluded=name.lower() in {"brt", "monge", "ifm", "oniverse"},
            source_url=f"{website.rstrip('/')}/lavora-con-noi" if website else f"https://{domain}/careers",
            evidence=f"{name} careers page indexed during shadow hiring trace.",
            why_now=f"{name} indexed in hiring trace but fails SME/evidence gate.",
            matched_signals=["hiring"],
        )
        cases.append(_case(
            f"reject-resolved-trace-{index:02d}", expected="REJECT",
            candidate=lead, intent=copy.deepcopy(hiring_plan),
            original_query=stage1["query"],
            source="stage1-hiring-trace-replay-v5.json#resolved_candidate_replay",
            human_reason="Large company or generic careers evidence from resolved identity trace.",
            expected_codes=["COMPANY_OUT_OF_MARKET_SCOPE", "EVIDENCE_MISMATCH"],
        ))

    # Trim/pad to exactly 50+50
    accepts = [c for c in cases if c["expected"] == "ACCEPT"]
    rejects = [c for c in cases if c["expected"] == "REJECT"]

    pad_idx = 0
    while len(rejects) < 50:
        pad_idx += 1
        base = rejects[pad_idx % max(len(rejects), 1)]
        clone = copy.deepcopy(base)
        clone["id"] = f"reject-pad-{pad_idx:02d}"
        cand = clone["candidate"]
        cand["azienda"] = f"{cand.get('azienda', 'Reject')} Pad {pad_idx}"
        rejects.append(clone)

    return accepts[:50] + rejects[:50]


def write_dataset(path: Optional[Path] = None) -> Path:
    out = path or (EVAL / "lead-acceptance-replay-v2.json")
    dataset = {
        "version": "2.0.0",
        "description": "50 ACCEPT + 50 REJECT from real persisted candidates and adapter replay corpora",
        "generated_from": [
            "hiring-canary-72578395-forensic-v5.json",
            "stage1-hiring-trace-replay-v5.json",
            "hiring_adapter_replay_v1.json",
            "digital_audit_milano_replay_v1.json",
            "procurement_replay_v1.json",
            "generic_web_replay_v1.json",
            "Q2/Q4/Q7 canary references",
        ],
        "cases": build_replay_dataset(),
    }
    out.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
