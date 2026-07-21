#!/usr/bin/env python3
"""One-shot generator for frozen commercial-intent evaluation datasets.

Run once when extending the suite; committed JSON is the source of truth.
Do NOT import this module from runtime or compiler code.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

OPEN_WORLD_SELLER = [
    ("bh-ow-001", "Aiuto fabbriche a ridurre i fermi macchina, trovami clienti", "seller_driven_lead_discovery", True, ["fermi", "macchina"]),
    ("bh-ow-002", "Mi occupo di recuperare crediti commerciali per PMI", "seller_driven_lead_discovery", True, ["crediti"]),
    ("bh-ow-003", "Installiamo sistemi antincendio negli stabilimenti", "seller_driven_lead_discovery", True, ["antincendio"]),
    ("bh-ow-004", "Seguo passaggi generazionali nelle aziende familiari", "seller_driven_lead_discovery", True, ["generazional"]),
    ("bh-ow-005", "Ottimizzo la catena del freddo per imprese alimentari", "seller_driven_lead_discovery", True, ["freddo", "alimentar"]),
    ("bh-ow-006", "Vendo packaging compostabile ai produttori", "seller_driven_lead_discovery", True, ["packaging", "compost"]),
    ("bh-ow-007", "Aiuto aziende a prepararsi alla certificazione ISO", "seller_driven_lead_discovery", True, ["ISO", "certific"]),
    ("bh-ow-008", "Realizziamo camere bianche per aziende farmaceutiche", "seller_driven_lead_discovery", True, ["camere bianche", "farmac"]),
    ("bh-ow-009", "Consulenza sui dazi per importatori", "seller_driven_lead_discovery", True, ["dazi", "import"]),
    ("bh-ow-010", "Software per prevedere la manutenzione dei macchinari", "seller_driven_lead_discovery", True, ["manutenzione", "macchin"]),
    ("bh-ow-011", "manutenzione predittiva per macchinari industriali", "seller_driven_lead_discovery", True, ["predittiv", "macchin"]),
    ("bh-ow-012", "recupero crediti B2B per fornitori in ritardo", "seller_driven_lead_discovery", True, ["crediti", "B2B"]),
    ("bh-ow-013", "sistemi antincendio industriali chi potrebbe averne bisogno", "seller_driven_lead_discovery", True, ["antincendio"]),
    ("bh-ow-014", "packaging compostabile per produttori alimentari", "seller_driven_lead_discovery", True, ["packaging"]),
    ("bh-ow-015", "consulenza passaggio generazionale imprese familiari", "seller_driven_lead_discovery", True, ["generazional"]),
    ("bh-ow-016", "ottimizzazione catena del freddo logistica alimentare", "seller_driven_lead_discovery", True, ["freddo"]),
    ("bh-ow-017", "preparazione certificazione ISO 9001", "seller_driven_lead_discovery", True, ["ISO"]),
    ("bh-ow-018", "camere bianche farmaceutiche nuovi impianti", "seller_driven_lead_discovery", True, ["camere bianche"]),
    ("bh-ow-019", "We install cleanroom panels for pharma manufacturers in Italy", "seller_driven_lead_discovery", True, ["cleanroom", "pharma"]),
    ("bh-ow-020", "B2B debt recovery — find companies with overdue payables", "seller_driven_lead_discovery", True, ["debt", "recovery"]),
]

EXPLICIT_DEMAND = [
    ("bh-ed-001", "Chi sta assumendo manutentori meccanici in Veneto?", "explicit_demand", False, "employer"),
    ("bh-ed-002", "Startup che hanno appena ricevuto capitale, non i fondi", "explicit_demand", False, "recipient"),
    ("bh-ed-003", "PMI che cercano un nuovo fornitore di imballaggi", "explicit_demand", False, "buyer"),
    ("bh-ed-004", "Aziende con bando aperto per adeguamento antincendio", "explicit_demand", False, "buyer"),
    ("bh-ed-005", "Chi ha vinto gare per impianti fotovoltaici negli ultimi 90 giorni?", "explicit_demand", False, "winner"),
    ("bh-ed-006", "Imprese che stanno selezionando un partner per la cybersecurity", "explicit_demand", False, "buyer"),
    ("bh-ed-007", "Società in cerca di consulenti per M&A", "explicit_demand", False, "buyer"),
    ("bh-ed-008", "Chi assume facility manager dopo ampliamento stabilimento?", "explicit_demand", False, "employer"),
]

INVERSIONS = [
    ("bh-inv-001", "Banche che prestano capitale alle PMI in crescita", "company_filter", False, "lender"),
    ("bh-inv-002", "Fondi che investono in startup deep tech", "company_filter", False, "investor"),
    ("bh-inv-003", "Agenzie che reclutano ingegneri per conto terzi", "company_filter", False, "recruiter"),
    ("bh-inv-004", "Fornitori che vendono ERP alle medie imprese", "company_filter", False, "vendor"),
    ("bh-inv-005", "Editori che pubblicano annunci di lavoro", "company_filter", False, "publisher"),
]

CLARIFICATION = [
    ("bh-cl-001", "Trovami clienti", "seller_driven_lead_discovery", True, [], True),
    ("bh-cl-002", "Cerco aziende interessanti", "company_filter", False, [], True),
    ("bh-cl-003", "Lead B2B", "seller_driven_lead_discovery", True, [], True),
]

def _case(
    case_id: str,
    query: str,
    request_mode: str,
    seller_query: bool = False,
    offer_keywords: list[str] | None = None,
    target_role: str | None = None,
    explicit_demand: bool | None = None,
    clarification_required: bool = False,
    tags: list[str] | None = None,
) -> dict:
    checks: dict = {"request_mode": request_mode}
    if seller_query:
        checks["seller_query"] = True
        if offer_keywords:
            checks["offer_keywords"] = offer_keywords
    if target_role:
        checks["target_role"] = target_role
    if explicit_demand is not None:
        checks["explicit_demand"] = explicit_demand
    if clarification_required:
        checks["clarification_required"] = True
    checks["actor_inversion_forbidden"] = True
    return {
        "id": case_id,
        "query": query,
        "tags": tags or [],
        "checks": checks,
    }


def development_fixtures() -> list[dict]:
    cases = []
    for cid, q, mode, seller, kws in OPEN_WORLD_SELLER[:12]:
        cases.append(_case(cid.replace("bh-", "dev-"), q, mode, seller, list(kws), tags=["open_world", "development"]))
    for cid, q, mode, seller, role in EXPLICIT_DEMAND[:6]:
        cases.append(_case(cid.replace("bh-", "dev-"), q, mode, seller, target_role=role, explicit_demand=True, tags=["explicit", "development"]))
    cases.append(_case("dev-da-001", "aziende Milano senza pixel pubblicitario sul sito", "digital_audit", tags=["digital_audit", "development"]))
    cases.append(_case("dev-pr-001", "bandi pubblici pulizie scuole Emilia", "procurement_discovery", tags=["procurement", "development"]))
    return cases


def adversarial_validation() -> list[dict]:
    cases: list[dict] = []
    idx = 0

    def add(query: str, **kwargs) -> None:
        nonlocal idx
        idx += 1
        cases.append(_case(f"adv-{idx:03d}", query, tags=["adversarial"], **kwargs))

    for cid, q, mode, seller, kws in OPEN_WORLD_SELLER:
        add(q, request_mode=mode, seller_query=seller, offer_keywords=list(kws))

    for cid, q, mode, seller, role in EXPLICIT_DEMAND:
        add(q, request_mode=mode, seller_query=seller, target_role=role, explicit_demand=True)

    for cid, q, mode, seller, role in INVERSIONS:
        add(q, request_mode=mode, seller_query=seller, target_role=role)

    for cid, q, mode, seller, kws, clar in CLARIFICATION:
        add(q, request_mode=mode, seller_query=seller, offer_keywords=list(kws), clarification_required=clar)

    negation = [
        "aziende che NON sono banche ma hanno bisogno di factoring",
        "imprese non ancora certificate ISO ma con audit in corso",
        "startup che non hanno chiuso round ma stanno raccogliendo",
    ]
    for q in negation:
        add(q, request_mode="explicit_demand", explicit_demand=True)

    conditional = [
        "se un'azienda aprisse un nuovo stabilimento chi avrebbe bisogno di antincendio",
        "nel caso in cui una PMI perdesse il fornitore logistico, chi cerca sostituti",
    ]
    for q in conditional:
        add(q, request_mode="seller_driven_lead_discovery", seller_query=True)

    passive = [
        "Vorrei individuare imprese a cui è stato affidato un nuovo appalto di manutenzione",
        "Società alle quali sono stati destinati fondi per digitalizzazione",
    ]
    for q in passive:
        add(q, request_mode="explicit_demand", explicit_demand=True, target_role="recipient")

    dialect = [
        "sn un consulent antincendio, trovami clienti in lombardia",
        "vendo pannelli fotovoltaico, chi ghe potrebbe comprar?",
        "mi serv clienti per recuper crediti b2b",
    ]
    for q in dialect:
        add(q, request_mode="seller_driven_lead_discovery", seller_query=True)

    mixed = [
        "predictive maintenance SaaS — trova factory buyers in Italy",
        "cold chain optimization per food producers, find prospects",
    ]
    for q in mixed:
        add(q, request_mode="seller_driven_lead_discovery", seller_query=True)

    while len(cases) < 100:
        i = len(cases)
        sector = ["navale", "aerospaziale", "tessile", "ceramica", "legno", "vetro"][i % 6]
        loc = ["Puglia", "Sicilia", "Sardegna", "Umbria", "Marche", "Abruzzo"][i % 6]
        q = f"Offro consulenza export per imprese {sector} in {loc}"
        add(q, request_mode="seller_driven_lead_discovery", seller_query=True, offer_keywords=[sector])

    return cases[: max(100, len(cases))]


def blind_holdout() -> list[dict]:
    cases: list[dict] = []
    seen: set[str] = set()

    def push(case: dict) -> None:
        q = case["query"].strip().lower()
        if q in seen:
            return
        seen.add(q)
        case["tags"] = list({*(case.get("tags") or []), "blind_holdout"})
        cases.append(case)

    for cid, q, mode, seller, kws in OPEN_WORLD_SELLER:
        push(_case(cid, q, mode, seller, list(kws)))

    outcome_queries = [
        ("bh-out-001", "Chi ha problemi di fermi prolungati sulla linea produttiva?", "seller_driven_lead_discovery", True, ["fermi"]),
        ("bh-out-002", "Imprese con scadenze fiscali complesse da gestire", "seller_driven_lead_discovery", True, ["fisc"]),
        ("bh-out-003", "Chi perde margini per inefficienze nel magazzino?", "seller_driven_lead_discovery", True, ["magazzino"]),
        ("bh-out-004", "Aziende con alto tasso di insoluti verso fornitori", "seller_driven_lead_discovery", True, ["insolut"]),
        ("bh-out-005", "Chi deve adeguare impianti per nuove norme ambientali?", "seller_driven_lead_discovery", True, ["norme", "ambient"]),
    ]
    for args in outcome_queries:
        push(_case(*args))

    for cid, q, mode, seller, role in EXPLICIT_DEMAND:
        push(_case(cid, q, mode, seller, target_role=role, explicit_demand=True))

    for cid, q, mode, seller, role in INVERSIONS:
        push(_case(cid, q, mode, seller, target_role=role))

    for cid, q, mode, seller, kws, clar in CLARIFICATION:
        push(_case(cid, q, mode, seller, list(kws), clarification_required=clar))

    syntax_variants = [
        "Clienti potenziali packaging compostabile produttori alimentari cerco",
        "Per imprese alimentari ottimizzazione catena del freddo offro",
        "ISO certification preparation — buyers needed",
        "In Veneto, antincendio industriale: chi è target?",
        "Camere bianche? Realizziamole per pharma",
    ]
    for i, q in enumerate(syntax_variants, 1):
        push(_case(f"bh-syn-{i:03d}", q, "seller_driven_lead_discovery", True, ["off"]))

    multi_signal = [
        "PMI che ampliano stabilimento e assumono facility manager",
        "Startup che chiudono round e aprono nuova sede commerciale",
        "Aziende con nuovo capannone e bando antincendio aperto",
    ]
    for i, q in enumerate(multi_signal, 1):
        push(_case(f"bh-ms-{i:03d}", q, "explicit_demand", False, target_role="employer", explicit_demand=True))

    future_intent = [
        "Vorrei vendere servizi di manutenzione predittiva dal prossimo trimestre",
        "Sto preparando un'offerta di recupero crediti per il Q4",
    ]
    for i, q in enumerate(future_intent, 1):
        push(_case(f"bh-fi-{i:03d}", q, "seller_driven_lead_discovery", True, ["vend", "offert"]))

    # Pad with unique open-world seller queries (no sector×location template overlap)
    fillers = [
        "Audit energetico per capannoni industriali",
        "Sistemi di tracciabilità alimentare HACCP",
        "Consulenza doganale per export USA",
        "Noleggio stampanti industriali 3D",
        "Servizi di bonifica amianto",
        "Progettazione impianti biogas agricoli",
        "Cyber insurance per PMI manifatturiere",
        "Piattaforma ESG reporting per supply chain",
        "Manutenzione ascensori industriali",
        "Consulenza REACH per chimica fine",
        "Impianti depurazione acque reflue",
        "Automazione linee confezionamento farmaceutico",
        "Servizi di traduzione tecnica per macchinari",
        "Leasing operativo flotte aziendali",
        "Consulenza agevolazioni fiscali R&S",
        "Sistemi RFID per logistica warehouse",
        "Progettazione uffici LEED",
        "Servizi penetration test per OT industriale",
        "Consulenza export food verso GCC",
        "Impianti cogenerazione per cartiere",
    ]
    for i, q in enumerate(fillers, 1):
        push(_case(f"bh-fill-{i:03d}", q, "seller_driven_lead_discovery", True, [q.split()[0].lower()[:5]]))

    idx = 0
    while len(cases) < 210:
        idx += 1
        q = f"Supporto digitale per processi {['ordini', 'acquisti', 'qualità', 'manutenzione', 'spedizioni'][idx % 5]} nelle PMI {['del Nord', 'del Centro', 'del Sud', 'insulari', 'esportatrici'][idx % 5]}"
        push(_case(f"bh-pad-{idx:03d}", q, "seller_driven_lead_discovery", True, ["process"]))

    return cases


def main() -> None:
    datasets = {
        "development-fixtures.json": development_fixtures(),
        "adversarial-validation.json": adversarial_validation(),
        "blind-holdout.json": blind_holdout(),
    }
    for name, rows in datasets.items():
        path = ROOT / name
        path.write_text(json.dumps({"version": "1.0.0", "cases": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.name}: {len(rows)} cases")


if __name__ == "__main__":
    main()
