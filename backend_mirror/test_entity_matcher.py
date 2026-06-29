#!/usr/bin/env python3
"""MIRAX v5 — entity matcher unit tests (homonyms, P.IVA, domain, city)."""
from __future__ import annotations

import sys

from entity_matcher import (
    EntityCandidate,
    filter_records_for_lead,
    is_ambiguous_match,
    lead_name,
    protect_canonical_fields,
    score_entity_match,
    validate_signal_for_lead,
)


def test_piva_exact():
    lead = {"azienda": "Rossi SRL", "partita_iva": "12345678901", "city": "Milano"}
    cand = EntityCandidate(name="Rossi Costruzioni", piva="12345678901")
    r = score_entity_match(lead, cand)
    assert r.accepted and r.score == 100, r


def test_piva_mismatch():
    lead = {"azienda": "Rossi SRL", "partita_iva": "12345678901"}
    cand = EntityCandidate(name="Rossi SRL", piva="10987654321")
    r = score_entity_match(lead, cand)
    assert not r.accepted, r


def test_homonym_city():
    lead = {"azienda": "Bianchi Edilizia SRL", "city": "Verona"}
    same_name = EntityCandidate(name="Bianchi Edilizia SRL", city="Torino", text_blob="Bianchi Edilizia Torino")
    r = score_entity_match(lead, same_name)
    assert not r.accepted, r


def test_strong_name_match():
    lead = {"azienda": "Ferrari Nautica SRL", "city": "La Spezia"}
    cand = EntityCandidate(
        name="Ferrari Nautica SRL",
        city="La Spezia",
        text_blob="Ferrari Nautica SRL La Spezia offerte lavoro",
    )
    r = score_entity_match(lead, cand)
    assert r.accepted and r.score >= 75, r


def test_ambiguous_homonyms():
    lead = {"azienda": "Rossi SRL", "city": "Milano"}
    cands = [
        EntityCandidate(name="Rossi SRL", city="Milano", text_blob="Rossi SRL edilizia Milano"),
        EntityCandidate(name="Rossi SRL", city="Milano", text_blob="Rossi SRL impianti Milano"),
    ]
    assert is_ambiguous_match(lead, cands)


def test_filter_anac_records():
    lead = {"azienda": "Edil Costruzioni Nord SRL", "city": "Padova"}
    records = [
        {"denominazione": "Edil Costruzioni Nord SRL", "comune": "Padova", "OGGETTO": "Ristrutturazione scuola"},
        {"denominazione": "Edil Costruzioni Nord SRL", "comune": "Bologna", "OGGETTO": "Altro"},
    ]
    matched = filter_records_for_lead(lead, records, fallback_name=lead_name(lead))
    assert len(matched) == 1
    assert "Padova" in str(matched[0].get("comune"))


def test_validate_hiring_signal():
    lead = {"azienda": "Acme Software SRL", "city": "Milano"}
    sig = {
        "type": "hiring",
        "source": "indeed_it",
        "title": "Sta assumendo",
        "evidence": [{"value": "Indeed", "company": "Acme Software SRL", "source": "indeed_it"}],
    }
    assert validate_signal_for_lead(lead, sig)


def test_reject_wrong_company_signal():
    lead = {"azienda": "Acme Software SRL", "city": "Milano"}
    sig = {
        "type": "tender_won",
        "source": "anac_opendata",
        "title": "Gara vinta",
        "evidence": [{"value": "Beta Impianti SpA Veneto", "source": "anac_opendata"}],
    }
    assert not validate_signal_for_lead(lead, sig)


def test_protect_canonical():
    lead = {"telefono": "+39 02 123456", "email": "info@acme.it", "nome": "Acme"}
    patch = {"telefono": "+39 06 999", "email": "wrong@test.it", "business_signals": []}
    safe = protect_canonical_fields(lead, patch)
    assert "telefono" not in safe
    assert "email" not in safe
    assert "business_signals" in safe


def main() -> int:
    tests = [
        test_piva_exact,
        test_piva_mismatch,
        test_homonym_city,
        test_strong_name_match,
        test_ambiguous_homonyms,
        test_filter_anac_records,
        test_validate_hiring_signal,
        test_reject_wrong_company_signal,
        test_protect_canonical,
    ]
    for fn in tests:
        fn()
    print(f"test_entity_matcher: {len(tests)}/{len(tests)} OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
