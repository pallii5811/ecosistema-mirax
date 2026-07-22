"""Blacklist condivisa portali fonte + colossi (USE)."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

SOURCE_PORTAL_DOMAINS = frozenset({
    "indeed.it", "indeed.com", "infojobs.it", "linkedin.com", "glassdoor.com",
    "jobeka.com", "talent.com", "monster.it", "jooble.org", "helplavoro.it",
    "bebee.com", "bebee.it",
    "ilsole24ore.com", "repubblica.it", "corriere.it", "ansa.it", "lastampa.it",
    "startupitalia.eu", "startupitalia.it", "italian.tech", "italiantech.info",
    "wired.it", "milanofinanza.it", "forbes.it", "fortune.com", "huffingtonpost.it",
    "pmi.com",
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "wikipedia.org", "wikidata.org", "paginegialle.it", "paginebianche.it",
    "registroimprese.it", "infocamere.it", "anac.gov.it", "gazzettaufficiale.it",
    "fatturatoitalia.it", "reportaziende.it", "companyreports.it", "aziende.it",
    "informazione-aziende.it", "reteimprese.it", "misterimprese.it", "infoimprese.it",
    "ufficiocamerale.it", "europages.it", "europages.com", "kompass.com", "kompass.it",
    "cylex.it", "atoka.io", "cerved.com", "crif.com", "dati.anticorruzione.it", "ted.europa.eu",
    "amazon.com", "amazon.it", "amazonaws.com", "google.com", "google.it",
    "microsoft.com", "microsoft.it", "apple.com", "meta.com", "ibm.com",
    "oracle.com", "sap.com", "nttdata.com", "ntt.com", "accenture.com",
    "deloitte.com", "pwc.com", "ey.com", "kpmg.com", "capgemini.com",
    "infosys.com", "tcs.com", "wipro.com", "cognizant.com",
    "salesforce.com", "hubspot.com", "zoho.com", "pipedrive.com",
    "outreach.io", "apollo.io", "zoominfo.com", "cognism.com", "clearbit.com",
    "linkedin.com", "salesloft.com", "clari.com", "seamless.ai",
    "tp-link.com", "tplink.com", "cisco.com", "dell.com", "hp.com", "hpe.com",
    "lenovo.com", "samsung.com", "lg.com", "siemens.com", "ge.com",
    "bosch.com", "philips.com", "sony.com", "panasonic.com",
    "vodafone.it", "vodafone.com", "fastweb.it", "windtre.it",
    "enel.it", "enel.com", "eni.com", "leonardo.com", "ferroviedellostato.it",
    "poste.it", "unicredit.it", "intesasanpaolo.com", "generali.com",
    "allianz.com", "axa.com", "mckinsey.com", "bcg.com", "bain.com",
    "bending-spoons.com", "bendingspoons.com", "tim.it", "telecomitalia.it",
    "canonical.com", "canonical.io", "factorial.it", "factorialhr.com",
    "jethr.com", "jet-hr.com", "personio.com", "monday.com", "notion.so",
    "atlassian.com", "shopify.com", "servicenow.com", "workday.com",
    "stripe.com", "paypal.com", "squareup.com", "adobe.com",
    "bmw.it", "bmw.com", "simest.it", "confindustria.it", "confindustria.com",
    "emergency.it", "italiaonline.it", "adecco.it", "glassdoor.it",
    "staff.it", "wuerth.it", "q8.it", "lactalisvaloreitalia.it",
    "leroymerlin.it", "skyscanner.it", "jeffersonwells.it", "manpower.it",
    "randstad.it", "gigroupholding.it", "gigroup.it", "hays.it",
    "michaelpage.it",
    "nike.com", "nike.it", "ferrari.com", "store.ferrari.com", "mini.it", "mini.com",
    "uniqlo.com", "uniqlo.it", "primark.com", "urbanoutfitters.com",
    "urbanoutfitters.it", "yesmilano.it", "galleriavittorioemanueleii.com",
    "youtrend.it", "unicusano.it",
    "jobcentre.it", "prontopro.it",
    "cliclavoro.gov.it", "siae.it", "zetema.it", "asp.asti.it",
    "posteitaliane.it", "atac.roma.it", "terna.it", "gruppohera.it", "stradeanas.it",
    "novonordisk.it", "decathlon-careers.it", "mondoconv.it", "saint-gobain.it",
    "vaillant.it", "bosch.it", "cargill.it", "arriva.it",
    "etjca.it", "direzionelavorogroup.it",
    "bancadellecase.it", "wikicasa.it", "immobiliare.it", "idealista.it",
    "casa.it", "ti-aiuto.it", "kitlavoro.it", "hackerone.com",
    # Code hosts, package registries, tech giants (never valid PMI targets)
    "github.com", "github.io", "gitlab.com", "stackoverflow.com", "stackexchange.com",
    "npmjs.com", "pypi.org", "medium.com", "substack.com", "brave.com",
    "mozilla.org", "mozilla.com", "opera.com",
})

# Evidence portals are allowed as sources but never as target domains. Keep
# them separate from famous enterprise/brand domains: a brand's own careers
# page is not a portal and must be rejected before paid extraction.
EVIDENCE_SOURCE_PORTAL_DOMAINS = frozenset({
    "indeed.it", "indeed.com", "infojobs.it", "linkedin.com", "glassdoor.com",
    "jobeka.com", "talent.com", "monster.it", "jooble.org", "helplavoro.it",
    "bebee.com", "bebee.it",
    "ilsole24ore.com", "repubblica.it", "corriere.it", "ansa.it", "lastampa.it",
    "startupitalia.eu", "startupitalia.it", "italian.tech", "italiantech.info",
    "wired.it", "milanofinanza.it", "forbes.it", "fortune.com", "huffingtonpost.it",
    "pmi.com", "registroimprese.it", "infocamere.it", "anac.gov.it",
    "gazzettaufficiale.it", "ted.europa.eu", "paginegialle.it", "paginebianche.it",
    "fatturatoitalia.it", "reportaziende.it", "companyreports.it", "aziende.it",
    "informazione-aziende.it", "reteimprese.it", "misterimprese.it", "infoimprese.it",
    "ufficiocamerale.it", "dati.anticorruzione.it",
})

# Evidence sources and lead websites are different trust domains. News, job
# boards and public registers are useful evidence, but must never become the
# official website of the company mentioned in them.
EXTRACTION_BLOCKED_SOURCE_DOMAINS = frozenset({
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "wikipedia.org", "wikidata.org", "paginegialle.it", "paginebianche.it",
    "amazon.com", "amazon.it", "amazonaws.com", "google.com", "google.it",
    "github.com", "github.io", "gitlab.com", "stackoverflow.com", "stackexchange.com",
    "npmjs.com", "pypi.org", "medium.com", "substack.com",
})

# Substring roots matched case-insensitively on normalized host (e.g. api.github.com)
BLACKLIST_DOMAIN_ROOTS = (
    "github.", "gitlab.", "stackoverflow.", "stackexchange.", "npmjs.", "pypi.",
    "medium.", "substack.", "brave.com", "mozilla.", "opera.", "apple.", "microsoft.",
    "canonical.", "factorial.", "factorialhr.", "jethr.", "jet-hr.", "personio.",
    "monday.", "notion.", "atlassian.", "shopify.", "servicenow.", "workday.",
    "confindustria.", "simest.", "italiaonline.", "adecco.", "glassdoor.",
    "wuerth.", "leroymerlin.", "skyscanner.", "jeffersonwells.", "manpower.",
    "randstad.", "gigroup.", "hays.", "michaelpage.",
    "nike.", "ferrari.", "mini.", "uniqlo.", "primark.", "urbanoutfitters.",
    "yesmilano.",
    "youtrend.", "unicusano.",
    "jobcentre.", "prontopro.",
    "bancadellecase.", "wikicasa.", "immobiliare.", "idealista.",
    "casa.it", "ti-aiuto.", "kitlavoro.", "hackerone.",
    "fatturatoitalia.", "reportaziende.", "companyreports.", "informazione-aziende.",
    "reteimprese.", "misterimprese.", "infoimprese.", "ufficiocamerale.",
    # Public healthcare trusts (ASST/ASL) are not industrial PMI buyers.
    "asst-", "asl.", "ospedale.",
    # Local news / TV publishers must never become the target official domain.
    "ecodibergamo.", "bergamotv.", "corriere.", "repubblica.", "lastampa.",
    "ilsole24ore.", "gazzetta.", "today.it",
)

BLACKLIST_NAME_PATTERNS = (
    r"\bindeed\b", r"\blinkedin\b", r"\bil\s*sole\s*24\s*ore\b", r"\brepubblica\b",
    r"\bamazon\b", r"\bgoogle\b", r"\bmicrosoft\b", r"\bapple\b", r"\bmeta\b",
    r"\bsalesforce\b", r"\bhubspot\b", r"\bzoho\b", r"\bpipedrive\b",
    r"\boutreach\b", r"\bapollo\b", r"\bzoominfo\b", r"\bcognism\b",
    r"\bclearbit\b", r"\bsalesloft\b", r"\bclari\b", r"\bseamless\b",
    r"\btp[\s-]*link\b", r"\bcisco\b", r"\bdell\b", r"\bhp\b", r"\bhpe\b",
    r"\blenovo\b", r"\bsamsung\b", r"\bsiemens\b", r"\bbosch\b",
    r"\bvodafone\b", r"\bfastweb\b", r"\bwind\s*tre\b", r"\benel\b",
    r"\beni\b", r"\bleonardo\b", r"\bposte\s*italiane\b",
    r"\bunicredit\b", r"\bintesa\s*sanpaolo\b", r"\bgenerali\b",
    r"\ballianz\b", r"\baxa\b", r"\bmckinsey\b", r"\bbcg\b", r"\bbain\b",
    r"\bfacebook\b", r"\bntt\s*data\b", r"\bntt\b", r"\bibm\b", r"\baccenture\b",
    r"\bdeloitte\b", r"\bstartup\s*italia\b", r"\bfortune\s*500\b", r"\bfortune\b",
    r"\bgithub\b", r"\bgitlab\b", r"\bstackoverflow\b", r"\bstackexchange\b",
    r"\bnpm\b", r"\bpypi\b", r"\bmedium\b", r"\bsubstack\b", r"\bbrave\b",
    r"\bmozilla\b", r"\bopera\b",
    r"\bcanonical\b", r"\bfactorial\b", r"\bjet\s*hr\b", r"\bpersonio\b",
    r"\bmonday\.?com\b", r"\bnotion\b", r"\batlassian\b", r"\bshopify\b",
    r"\bservice\s*now\b", r"\bworkday\b", r"\bstripe\b", r"\bpaypal\b",
    r"\badobe\b",
    r"\bbmw\b", r"\bsimest\b", r"\bconfindustria\b", r"\bemergency\b",
    r"\bitaliaonline\b", r"\badecco\b", r"\bglassdoor\b", r"\bwuerth\b",
    r"\bq8\b", r"\blactalis\b", r"\bleroy\s*merlin\b", r"\bskyscanner\b",
    r"\bjefferson\s*wells\b", r"\bmanpower\b", r"\brandstad\b",
    r"\bgi\s*group\b", r"\bhays\b", r"\bmichael\s*page\b",
    r"\bnike\b", r"\bferrari\b", r"\bmini\b", r"\buniqlo\b", r"\bprimark\b",
    r"\burban\s*outfitters\b", r"\bgalleria\s+vittorio\s+emanuele\b",
    r"\byes\s*milano\b",
    r"\byoutrend\b", r"\bunicusano\b",
    r"\bjob\s*centre\b", r"\bpronto\s*pro\b", r"\bprontopro\b",
    r"\bbanca\s*delle\s*case\b", r"\bbancadellecase\b", r"\bwikicasa\b",
    r"\bimmobiliare\.?it\b", r"\bidealista\b", r"\bti\s*aiuto\b",
    r"\bkit\s*lavoro\b", r"\bkitlavoro\b", r"\bhackerone\b",
    r"\bsegnalibro\b", r"\bnon\s+interessato\b", r"\bper\s+rafforzare\b",
    r"\bmercato\s+italiano\b", r"^\s*it\s*$", r"^\s*cloud\s*$",
    r"\bbusiness\s+development\s+representative\b", r"\bsales\s+development\s+representative\b",
    r"\bsales\s+representative\b", r"\binside\s+sales\b", r"\baccount\s+executive\b",
)

_BLACKLIST_NAME_RES = [re.compile(p, re.I) for p in BLACKLIST_NAME_PATTERNS]


def normalize_domain(url: str) -> str:
    raw = (url or "").strip().lower()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = urlparse(raw).netloc or urlparse(raw).path
    except Exception:
        host = raw
    return host.replace("www.", "").split(":")[0].rstrip("/")


def is_blacklisted_domain(domain: str) -> bool:
    d = normalize_domain(domain)
    if not d:
        return False
    d_lower = d.lower()
    for root in BLACKLIST_DOMAIN_ROOTS:
        if root in d_lower:
            return True
    for blocked in SOURCE_PORTAL_DOMAINS:
        if d == blocked or d.endswith("." + blocked) or blocked in d:
            return True
    return False


def is_extraction_blocked_source(url: str) -> bool:
    """True for code repos, package registries, news/tech giants — skip LLM extraction."""
    domain = normalize_domain(url)
    if not domain:
        return True
    return any(
        domain == blocked or domain.endswith("." + blocked)
        for blocked in EXTRACTION_BLOCKED_SOURCE_DOMAINS
    )


def is_blacklisted_name(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    return any(rx.search(n) for rx in _BLACKLIST_NAME_RES)


def is_source_portal_url(url: str) -> bool:
    domain = normalize_domain(url)
    return any(
        domain == portal or domain.endswith("." + portal)
        for portal in EVIDENCE_SOURCE_PORTAL_DOMAINS
    )


def is_known_non_sme_domain(url: str) -> bool:
    """True for a known enterprise/brand domain, never an evidence portal."""
    domain = normalize_domain(url)
    return bool(domain and is_blacklisted_domain(domain) and not is_source_portal_url(url))
