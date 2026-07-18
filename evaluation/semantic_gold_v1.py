"""Frozen deterministic MIRAX semantic gold-set specification (250 cases).

The textual variants are intentionally outside runtime code.  They measure the
semantic model and the deterministic grounding boundary; no adapter imports
these templates and no runtime keyword rule is derived from them.
"""

from __future__ import annotations

from typing import Any, Dict, List


COMPANIES = (
    "Alba Meccanica Srl", "Beta Industrie Srl", "Cobalto Logistica Srl", "Delta Food Srl",
    "Edera Servizi Srl", "Futura Packaging Srl", "Garda Impianti Srl", "Iride Tessile Srl",
    "Lario Componenti Srl", "Mosaico Retail Srl", "Nettuno Software Srl", "Orione Energia Srl",
    "Piana Arredi Srl", "Quercia Medicale Srl", "Riva Automazioni Srl", "Sestante Travel Srl",
    "Talea Cosmetics Srl", "Ulivo Engineering Srl", "Vela Sicurezza Srl", "Zaffiro Casa Srl",
)


def _split(kind_index: int, *, development: int, validation: int) -> str:
    if kind_index < development:
        return "development"
    if kind_index < development + validation:
        return "validation"
    return "holdout"


def _base(case_id: str, split: str, label: str, company: str, text: str) -> Dict[str, Any]:
    return {
        "id": case_id,
        "split": split,
        "label": label,
        "target_company": company,
        "target_entity_type": "operating_company",
        "source_text": text,
        "source_url": f"https://publisher.example/{case_id}",
        "publisher": "Osservatorio Imprese",
        "official_domain_verified": True,
        "official_domain_confidence": 0.94,
        "event_date": "2026-07-10",
        "maximum_age_days": 90,
        "negated": False,
        "hypothetical": False,
        "conditional": False,
        "rumor": False,
        "historical": False,
        "tags": ["publisher_differs_from_company"],
    }


def _positive_cases() -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    for index in range(100):
        company = COMPANIES[index % len(COMPANIES)]
        split = _split(index, development=40, validation=30)
        if index < 30:
            text = f"Il 10 luglio 2026, a {company} sono state destinate nuove risorse per aumentare la capacita produttiva."
            query = "Trova imprese a cui sono state destinate nuove risorse"
            role, relationship, event = "recipient", "new_resources_destination_is_target", "resource_allocation"
            tags = ["passive_voice", "no_canonical_keyword"]
        elif index < 60:
            text = f"{company} si assicura nuove risorse per estendere la produzione nel corso del 2026."
            query = "Quali aziende si sono assicurate mezzi aggiuntivi per crescere?"
            role, relationship, event = "recipient", "new_resources_secured_by_target", "resource_secured"
            tags = ["no_canonical_keyword"]
        elif index < 80:
            text = f"{company} amplia la squadra vendite inserendo due account executive dal 10 luglio 2026."
            query = "Aziende che stanno rafforzando la propria capacita commerciale con nuove persone"
            role, relationship, event = "employer", "sales_team_expanded_by_target", "workforce_expansion"
            tags = ["no_canonical_keyword"]
        elif index < 90:
            text = f"{company} estende la propria presenza nel territorio bergamasco con un nuovo presidio operativo aperto il 10 luglio 2026."
            query = "Imprese che stanno rendendo piu capillare la loro presenza in Lombardia"
            role, relationship, event = "expanding_company", "territorial_presence_extended_by_target", "territorial_expansion"
            tags = ["no_canonical_keyword"]
        else:
            text = f"{company} abbandona il vecchio gestionale a favore di Salesforce; il passaggio e iniziato il 10 luglio 2026."
            query = "Societa che hanno lasciato il sistema precedente per una piattaforma diversa"
            role, relationship, event = "technology_adopter", "technology_migrated_by_target", "technology_migration"
            tags = ["no_canonical_keyword"]
        item = _base(f"positive-{index:03d}", split, "positive", company, text)
        item.update({
            "query": query, "target_role": role, "required_relationships": [relationship],
            "acceptance_rubric": ["target_identity_verified", "target_role_verified", "event_observed"],
            "event_type": event, "expected_query_match": True, "expected_accept": True,
        })
        item["tags"].extend(tags)
        cases.append(item)
    return cases


def _negative_cases() -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    for index in range(100):
        company = COMPANIES[index % len(COMPANIES)]
        split = _split(index, development=40, validation=30)
        query = "Trova aziende che hanno realmente ottenuto nuove risorse finanziarie negli ultimi 90 giorni"
        role = "recipient"
        relationship = "capital_received_by_target"
        if index < 20:
            text = f"{company} non ha ricevuto le risorse annunciate e il progetto e stato cancellato il 10 luglio 2026."
            flags, tags, actual_role = {"negated": True}, ["negation", "no_canonical_keyword"], "recipient"
        elif index < 35:
            text = f"{company} potrebbe assicurarsi nuove risorse se il piano industriale venisse approvato."
            flags, tags, actual_role = {"hypothetical": True, "conditional": True}, ["hypothesis", "conditional", "no_canonical_keyword"], "recipient"
        elif index < 50:
            text = f"Secondo indiscrezioni non confermate, {company} starebbe valutando mezzi aggiuntivi per crescere."
            flags, tags, actual_role = {"rumor": True}, ["rumor", "no_canonical_keyword"], "recipient"
        elif index < 80:
            text = f"{company} mette a disposizione credito per le imprese che vogliono investire dal 10 luglio 2026."
            flags, tags, actual_role = {}, ["actor_recipient_inversion", "provider_not_recipient"], "provider"
        else:
            text = f"Il 10 luglio 2023 {company} ricevette nuove risorse per un piano ormai concluso."
            flags, tags, actual_role = {"historical": True}, ["stale", "historical"], "recipient"
        item = _base(f"negative-{index:03d}", split, "negative", company, text)
        item.update({
            "query": query, "target_role": role, "actual_target_role": actual_role,
            "required_relationships": [relationship],
            "acceptance_rubric": ["target_identity_verified", "target_is_recipient", "event_observed"],
            "event_type": "capital_received" if actual_role == "recipient" else "credit_offered",
            "expected_query_match": False, "expected_accept": False,
        })
        item.update(flags)
        if index >= 80:
            item["event_date"] = "2023-07-10"
        item["tags"].extend(tags)
        cases.append(item)
    return cases


def _multi_cases() -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    for index in range(50):
        company = COMPANIES[index % len(COMPANIES)]
        other = COMPANIES[(index + 7) % len(COMPANIES)]
        split = _split(index, development=20, validation=15)
        positive = index < 25
        if positive:
            text = (
                f"{company} apre un presidio a Bergamo e amplia la squadra vendite con tre account executive il 10 luglio 2026. "
                f"Nello stesso articolo {other} presenta soltanto il nuovo catalogo."
            )
        else:
            text = (
                f"{company} apre un presidio a Bergamo il 10 luglio 2026. "
                f"{other}, societa distinta, amplia la squadra vendite con tre account executive."
            )
        item = _base(f"multi-{index:03d}", split, "multi", company, text)
        item.update({
            "query": "Trova una singola azienda che stia estendendo la presenza territoriale e insieme rafforzando le vendite",
            "target_role": "subject_company",
            "required_relationships": ["territorial_presence_extended_by_target", "sales_team_expanded_by_target"],
            "acceptance_rubric": ["same_target_has_both_events", "events_observed", "target_identity_verified"],
            "event_type": "multi_signal_growth", "expected_query_match": positive,
            "expected_accept": positive, "other_companies": [other],
        })
        item["tags"].extend(["multi_entity", "multi_signal", "no_canonical_keyword"])
        if not positive:
            item["tags"].append("cross_entity_signal_leakage_trap")
        cases.append(item)
    return cases


SEMANTIC_GOLD_CASES = tuple(_positive_cases() + _negative_cases() + _multi_cases())


def composition() -> Dict[str, Any]:
    def count_tag(tag: str) -> int:
        return sum(tag in case["tags"] for case in SEMANTIC_GOLD_CASES)

    return {
        "total": len(SEMANTIC_GOLD_CASES),
        "labels": {
            label: sum(case["label"] == label for case in SEMANTIC_GOLD_CASES)
            for label in ("positive", "negative", "multi")
        },
        "splits": {
            split: sum(case["split"] == split for case in SEMANTIC_GOLD_CASES)
            for split in ("development", "validation", "holdout")
        },
        "no_canonical_keyword": count_tag("no_canonical_keyword"),
        "passive_voice": count_tag("passive_voice"),
        "negation_hypothesis_rumor": sum(
            any(tag in case["tags"] for tag in ("negation", "hypothesis", "rumor"))
            for case in SEMANTIC_GOLD_CASES
        ),
        "actor_recipient_inversion": count_tag("actor_recipient_inversion"),
        "publisher_differs": count_tag("publisher_differs_from_company"),
        "multi_entity": count_tag("multi_entity"),
        "stale": count_tag("stale"),
    }
