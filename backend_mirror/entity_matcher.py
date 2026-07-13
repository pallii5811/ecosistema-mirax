"""
MIRAX v5 — Entity matching for enrichment attachment.

Maps/audit contact fields are CANONICAL — this module never overwrites them.
It only validates that external enrichment belongs to this lead entity.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

# Fields sourced from Maps scrape + website audit — never modified by enrichment.
CANONICAL_CONTACT_FIELDS: frozenset[str] = frozenset(
    {
        "telefono",
        "phone",
        "email",
        "nome",
        "azienda",
        "business_name",
        "name",
        "sito",
        "website",
        "instagram",
        "facebook",
        "technical_report",
        "tech_stack",
        "last_audited_at",
        "audit_version",
        "audit_status",
        "audit_changes",
    }
)

COMPANY_FORM_RE = re.compile(
    r"\b(s\.?\s*r\.?\s*l\.?|s\.?\s*p\.?\s*a\.?|s\.?\s*a\.?\s*s\.?|s\.?\s*n\.?\s*c\.?|"
    r"societa|responsabilita\s+limitata|srl|spa|sas|snc|group|holding)\b",
    re.I,
)

GENERIC_NAME_TOKENS: Set[str] = {
    "srl",
    "spa",
    "sas",
    "snc",
    "group",
    "holding",
    "italia",
    "italy",
    "service",
    "services",
    "impresa",
    "imprese",
    "azienda",
    "company",
    "societa",
    "studio",
    "centro",
}


def normalize_text(value: str) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D+", "", value or "")
    if digits.startswith("39") and len(digits) > 10:
        digits = digits[2:]
    return digits[-10:] if len(digits) >= 9 else digits


def normalize_domain(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = urlparse(raw).netloc or urlparse(raw).path
    except Exception:
        host = raw
    host = host.lower().replace("www.", "").split(":")[0].rstrip("/")
    return host


def normalize_piva(value: str) -> str:
    digits = re.sub(r"\D+", "", value or "")
    return digits if len(digits) == 11 else ""


def _name_tokens(name: str) -> List[str]:
    norm = normalize_text(name)
    tokens = [t for t in norm.split() if len(t) >= 2 and t not in GENERIC_NAME_TOKENS]
    return tokens


def lead_name(lead: Dict[str, Any]) -> str:
    for key in ("business_name", "azienda", "nome", "name", "company"):
        val = str(lead.get(key) or "").strip()
        if val:
            return val
    return ""


ITALIAN_REGIONS: frozenset[str] = frozenset(
    {
        "lombardia",
        "lazio",
        "campania",
        "sicilia",
        "veneto",
        "emilia-romagna",
        "emilia romagna",
        "piemonte",
        "puglia",
        "toscana",
        "calabria",
        "sardegna",
        "liguria",
        "marche",
        "abruzzo",
        "friuli-venezia giulia",
        "friuli venezia giulia",
        "trentino-alto adige",
        "umbria",
        "basilicata",
        "molise",
        "valle d'aosta",
        "valle d aosta",
        "italia",
        "italy",
    }
)


def is_italian_region(name: str) -> bool:
    n = normalize_text(name or "")
    if not n:
        return False
    return n in ITALIAN_REGIONS


def city_from_address(address: str) -> str:
    addr = (address or "").strip()
    if not addr:
        return ""
    m = re.search(r"\b(\d{5})\s+([A-Za-zÀ-ÿ'\-\s]+?)(?:\s+\([A-Z]{2}\)|\s+[A-Z]{2})?\b", addr)
    if m:
        candidate = m.group(2).strip()
        if candidate and not is_italian_region(candidate):
            return candidate.title()
    parts = [p.strip() for p in addr.split(",") if p.strip()]
    for part in reversed(parts):
        cleaned = re.sub(r"^\d{5}\s*", "", part).strip()
        cleaned = re.sub(r"\s+[A-Z]{2}$", "", cleaned).strip()
        if cleaned and len(cleaned) > 2 and not is_italian_region(cleaned) and not re.fullmatch(r"\d+", cleaned):
            return cleaned.title()
    return ""


def resolve_lead_city(
    city: Optional[str] = None,
    address: Optional[str] = None,
    search_location: Optional[str] = None,
) -> str:
    """Non usare la regione (es. Lombardia) come città — estrai dal CAP/indirizzo."""
    parsed = city_from_address(address or "")
    if parsed:
        return parsed
    c = (city or "").strip()
    if c and not is_italian_region(c):
        return c.split(",")[0].strip()
    loc = (search_location or "").strip()
    if loc and not is_italian_region(loc):
        return loc.split(",")[0].strip()
    return "N/A"


def lead_city(lead: Dict[str, Any]) -> str:
    parsed = city_from_address(str(lead.get("indirizzo") or lead.get("address") or ""))
    if parsed:
        return parsed
    for key in ("city", "citta", "comune", "localita"):
        val = str(lead.get(key) or "").strip()
        if val and not is_italian_region(val):
            return val.split(",")[0].strip()
    loc = str(lead.get("location") or "").strip()
    if loc and not is_italian_region(loc):
        return loc.split(",")[0].strip()
    return ""


def lead_piva(lead: Dict[str, Any]) -> str:
    for key in ("partita_iva", "piva", "vat", "vat_number"):
        p = normalize_piva(str(lead.get(key) or ""))
        if p:
            return p
    openapi = lead.get("openapi_enriched") or lead.get("openapi") or {}
    if isinstance(openapi, dict):
        for key in ("partita_iva", "piva", "vatCode"):
            p = normalize_piva(str(openapi.get(key) or ""))
            if p:
                return p
    return ""


def lead_domain(lead: Dict[str, Any]) -> str:
    return normalize_domain(str(lead.get("website") or lead.get("sito") or ""))


def lead_phone(lead: Dict[str, Any]) -> str:
    return normalize_phone(str(lead.get("telefono") or lead.get("phone") or ""))


@dataclass
class MatchResult:
    accepted: bool
    score: float
    reason: str
    method: str = ""


@dataclass
class EntityCandidate:
    """External record to match against a lead."""

    name: str = ""
    city: str = ""
    piva: str = ""
    domain: str = ""
    phone: str = ""
    text_blob: str = ""


def _token_overlap_score(a_tokens: List[str], b_tokens: List[str]) -> float:
    if not a_tokens or not b_tokens:
        return 0.0
    set_a = set(a_tokens)
    set_b = set(b_tokens)
    overlap = len(set_a & set_b)
    if overlap == 0:
        return 0.0
    min_req = min(2, len(set_a), len(set_b))
    if overlap < min_req:
        return 0.0
    return (overlap / max(len(set_a), len(set_b))) * 100.0


def _fuzzy_name_score(a: str, b: str) -> float:
    na, nb = normalize_text(a), normalize_text(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 100.0
    if na in nb or nb in na:
        return 92.0
    return SequenceMatcher(None, na, nb).ratio() * 100.0


def _city_matches(lead_city_val: str, candidate_city: str, text_blob: str) -> bool:
    lc = normalize_text(lead_city_val)
    if not lc:
        return True
    cc = normalize_text(candidate_city)
    blob = normalize_text(text_blob)
    if cc and (lc in cc or cc in lc):
        return True
    if blob and lc in blob:
        return True
    return False


def score_entity_match(lead: Dict[str, Any], candidate: EntityCandidate) -> MatchResult:
    """Score how well candidate belongs to lead. Rejects homonyms and weak matches."""
    lp = lead_piva(lead)
    cp = normalize_piva(candidate.piva)
    if lp and cp:
        if lp == cp:
            return MatchResult(True, 100.0, "piva_exact", "piva")
        return MatchResult(False, 0.0, "piva_mismatch", "piva")

    ld = lead_domain(lead)
    cd = normalize_domain(candidate.domain)
    if ld and cd and ld == cd:
        return MatchResult(True, 95.0, "domain_exact", "domain")

    lph = lead_phone(lead)
    cph = normalize_phone(candidate.phone)
    if lph and cph and lph == cph:
        return MatchResult(True, 90.0, "phone_exact", "phone")

    lname = lead_name(lead)
    cname = candidate.name or ""
    blob = candidate.text_blob or cname

    if not lname:
        return MatchResult(False, 0.0, "missing_lead_name", "none")

    ltokens = _name_tokens(lname)
    if not ltokens:
        return MatchResult(False, 0.0, "generic_lead_name", "none")

    ctokens = _name_tokens(cname) if cname else []
    blob_norm = normalize_text(blob)

    token_score = _token_overlap_score(ltokens, ctokens)
    if token_score == 0 and blob_norm:
        blob_tokens = [t for t in blob_norm.split() if len(t) >= 2]
        token_score = _token_overlap_score(ltokens, blob_tokens)

    fuzzy = _fuzzy_name_score(lname, cname or blob[:120])
    name_score = max(token_score, fuzzy)

    city_ok = _city_matches(lead_city(lead), candidate.city, blob)
    if not city_ok:
        return MatchResult(False, name_score * 0.5, "city_mismatch", "name_city")

    if name_score >= 75 and token_score >= 50:
        return MatchResult(True, name_score, "name_city_ok", "name_city")

    if name_score >= 88 and len(ltokens) >= 2:
        return MatchResult(True, name_score, "strong_fuzzy_name", "fuzzy")

    if name_score >= 92 and len(ltokens) == 1 and len(ltokens[0]) >= 6:
        return MatchResult(True, name_score, "unique_single_token", "fuzzy")

    return MatchResult(False, name_score, "insufficient_name_match", "name")


def is_ambiguous_match(lead: Dict[str, Any], candidates: List[EntityCandidate]) -> bool:
    """True if top two candidates score too close — homonym risk."""
    if len(candidates) < 2:
        return False
    scores = sorted((score_entity_match(lead, c).score for c in candidates), reverse=True)
    best, second = scores[0], scores[1]
    if best < 75:
        return True
    if second >= best * 0.85:
        return True
    return False


def validate_signal_for_lead(lead: Dict[str, Any], signal: Dict[str, Any]) -> bool:
    """Return True only if external signal evidence matches this lead entity."""
    source = str(signal.get("source") or "")
    if source in {"mirax_audit", "mirax_diff_engine"}:
        return True
    if signal.get("status") == "unknown":
        return True

    stype = str(signal.get("type") or "")
    if stype == "registry_change" and lead_piva(lead):
        return True

    if signal.get("entity_verified") is True:
        return True

    evidence = signal.get("evidence") or []
    blob_parts: List[str] = [str(signal.get("title") or "")]
    for ev in evidence:
        if isinstance(ev, dict):
            blob_parts.append(str(ev.get("value") or ""))
            blob_parts.append(str(ev.get("label") or ""))
            blob_parts.append(str(ev.get("company") or ""))

    blob = " ".join(blob_parts)
    candidate = EntityCandidate(name=lead_name(lead), text_blob=blob)

    result = score_entity_match(lead, candidate)
    if result.accepted:
        return True

    # Hiring/tender: search was keyed on lead name — accept if name tokens appear in evidence
    ltokens = _name_tokens(lead_name(lead))
    blob_norm = normalize_text(blob)
    if ltokens and all(t in blob_norm for t in ltokens[:2]):
        return True

    print(
        f"[entity_match] REJECT {stype}/{source} for '{lead_name(lead)[:40]}' "
        f"score={result.score:.0f} reason={result.reason}",
        flush=True,
    )
    return False


def candidate_from_record(record: Dict[str, Any], *, fallback_name: str = "") -> EntityCandidate:
    """Build candidate from ANAC/TED/OpenAPI record."""
    parts = [str(v) for v in record.values() if v is not None]
    blob = " ".join(parts)
    name = str(
        record.get("ragione_sociale")
        or record.get("denominazione")
        or record.get("aggiudicatario")
        or record.get("company")
        or fallback_name
        or ""
    )
    city = str(record.get("citta") or record.get("comune") or record.get("city") or "")
    piva = normalize_piva(
        str(record.get("partita_iva") or record.get("piva") or record.get("codice_fiscale") or "")
    )
    return EntityCandidate(name=name, city=city, piva=piva, text_blob=blob)


def filter_records_for_lead(
    lead: Dict[str, Any],
    records: List[Dict[str, Any]],
    *,
    fallback_name: str = "",
) -> List[Dict[str, Any]]:
    """Filter external records — keep only those matching lead entity."""
    if not records:
        return []
    candidates = [candidate_from_record(r, fallback_name=fallback_name) for r in records]
    if is_ambiguous_match(lead, candidates):
        print(f"[entity_match] AMBIGUOUS homonym risk for '{lead_name(lead)[:40]}'", flush=True)
        return []
    matched: List[Dict[str, Any]] = []
    for rec, cand in zip(records, candidates):
        res = score_entity_match(lead, cand)
        if res.accepted:
            matched.append(rec)
    return matched


def protect_canonical_fields(lead: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Merge patch into lead without overwriting Maps/audit canonical fields."""
    out = dict(patch)
    for key in CANONICAL_CONTACT_FIELDS:
        if key in lead and lead.get(key):
            out.pop(key, None)
    return out
