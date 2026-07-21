"""Shared operating-entity + official-domain identity resolver.

Converts company name + evidence URL + source payload into a verified
identity contract. Discovery adapters (ANAC/Growth SERP/parse) stay untouched;
they call this only for identity resolution.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Mapping, MutableMapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain

COMMERCIAL_ENTITY_CLASSES = frozenset({"operating_company", "company_group"})
ENTITY_CLASSES = (
    "operating_company",
    "company_group",
    "public_authority",
    "association",
    "trade_union",
    "publisher",
    "directory",
    "unknown",
)

_SERP_COST_EUR = 0.005
_OWNERSHIP_EVIDENCE = frozenset({"company_tokens_in_host", "official_page_host_match", "cache_verified_domain"})
_LEGAL_SUFFIX_RE = re.compile(
    r"\b(?:s\.?\s*r\.?\s*l\.?s?|s\.?\s*p\.?\s*a\.?|s\.?\s*a\.?\s*s\.?|s\.?\s*n\.?\s*c\.?|"
    r"srl|spa|srls|sas|snc|societa['\s]+a\s+responsabilita\s+limitata)\b",
    re.I,
)
_PUBLIC_RE = re.compile(
    r"\b(?:comune|citt[aà]\s+metropolitana|provincia|regione|ministero|prefettura|"
    r"camera\s+di\s+commercio|asl\b|inps\b|agenzia\s+delle\s+entrate|ente\s+pubblico)\b",
    re.I,
)
_ASSOCIATION_RE = re.compile(
    r"\b(?:associazione|aps\b|odv\b|ets\b|onlus|fondazione|circolo)\b",
    re.I,
)
_UNION_RE = re.compile(
    r"\b(?:sindacat[oi]|cgil|cisl|uil|sicet|usb\b|cobas|confsal|uilta)\b",
    re.I,
)
_PUBLISHER_RE = re.compile(
    r"\b(?:giornale|quotidiano|rivista|redazione|editore|newsroom|corriere|"
    r"repubblica|ansa|lastampa)\b",
    re.I,
)
_GROUP_RE = re.compile(r"\b(?:gruppo|holding|group)\b", re.I)
_LEGAL_TOKENS = {
    "srl", "spa", "srls", "sas", "snc", "societa", "cooperativa", "coop",
    "italia", "italy", "group", "gruppo", "holding", "the", "and", "di", "del", "della",
}


@dataclass(frozen=True)
class EntityIdentityRequest:
    company_name: str
    evidence_url: str = ""
    presented_domain: str = ""
    source_payload: Mapping[str, Any] = field(default_factory=dict)
    geography: str = ""
    budget_eur: float = 0.0
    allow_serp: bool = True
    allowed_entity_classes: Sequence[str] = field(default_factory=lambda: tuple(COMMERCIAL_ENTITY_CLASSES))
    page_html: str = ""
    page_links: Sequence[str] = ()
    brand_name: str = ""
    acronym: str = ""
    group_domain_proof: bool = False


@dataclass(frozen=True)
class EntityIdentityResult:
    official_domain: Optional[str]
    operating_entity_name: str
    entity_class: str
    identity_status: str
    identity_confidence: float
    identity_evidence: Tuple[str, ...]
    resolution_method: str
    resolution_source: str
    identity_resolved_at: str
    cost_eur: float
    rejection_code: Optional[str] = None


@dataclass(frozen=True)
class CachedEntityIdentity:
    official_domain: str
    operating_entity_name: str
    entity_class: str
    identity_confidence: float
    identity_evidence: Tuple[str, ...]
    resolution_method: str
    resolution_source: str


class MemoryEntityDomainCache:
    """Process-local verified-domain cache (priority-1 resolution source)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_key: Dict[str, CachedEntityIdentity] = {}
        self._by_domain: Dict[str, CachedEntityIdentity] = {}
        self.hits = 0
        self.misses = 0
        self.serp_calls = 0

    def _key(self, name: str, geography: str = "") -> str:
        return f"{normalize_company_name(name)}|{normalize_company_name(geography)}"

    def get(self, name: str, geography: str = "", domain: str = "") -> Optional[CachedEntityIdentity]:
        with self._lock:
            if domain:
                hit = self._by_domain.get(normalize_domain(domain) or "")
                if hit:
                    self.hits += 1
                    return hit
            hit = self._by_key.get(self._key(name, geography))
            if hit:
                self.hits += 1
                return hit
            self.misses += 1
            return None

    def put(self, name: str, geography: str, value: CachedEntityIdentity) -> None:
        with self._lock:
            self._by_key[self._key(name, geography)] = value
            if value.official_domain:
                self._by_domain[normalize_domain(value.official_domain) or value.official_domain] = value


_DEFAULT_CACHE = MemoryEntityDomainCache()

VerifyFn = Callable[[str, str, str], Optional[Mapping[str, Any]]]
SerpFn = Callable[[str, str, int], Optional[Mapping[str, Any]]]


def normalize_company_name(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip().casefold()
    text = _LEGAL_SUFFIX_RE.sub(" ", text)
    text = re.sub(r"[^\w\sà-ü]", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def identity_tokens(value: str) -> Tuple[str, ...]:
    normalized = normalize_company_name(value)
    return tuple(token for token in normalized.split() if len(token) >= 3 and token not in _LEGAL_TOKENS)


def host_of(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def company_owns_host(company_name: str, host: str, *, brand_name: str = "", acronym: str = "") -> bool:
    if not host or is_blacklisted_domain(host):
        return False
    host_compact = re.sub(r"[^a-z0-9]", "", host.split(".")[0].casefold())
    candidates = [company_name, brand_name, acronym]
    for candidate in candidates:
        tokens = identity_tokens(candidate)
        if not tokens:
            compact = re.sub(r"[^a-z0-9]", "", normalize_company_name(candidate))
            if len(compact) >= 3 and compact in host_compact:
                return True
            continue
        hits = sum(1 for token in tokens if token in host_compact)
        if hits >= max(1, (len(tokens) + 1) // 2):
            return True
        joined = "".join(tokens)
        if len(joined) >= 4 and joined in host_compact:
            return True
    return False


# Brand names that already look like hostnames (LexDo.it, Sintropy.AI).
_DOMAIN_SHAPED_NAME_RE = re.compile(
    r"^([A-Za-z0-9][A-Za-z0-9-]{1,40})\.(ai|io|it|com|eu|co|net|app|dev|tech|cloud)$",
    re.I,
)
_DOMAIN_IN_TEXT_RE = re.compile(
    r"(?:https?://(?:www\.)?)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,24}){1,2})",
    re.I,
)
_COMMON_CORPORATE_TLDS = ("it", "com", "ai", "io", "eu", "net", "co")


def domain_candidates_from_company_name(company_name: str) -> Tuple[str, ...]:
    """Deterministic hostname candidates derived only from the company name."""
    text = re.sub(r"\s+", " ", str(company_name or "")).strip()
    if not text:
        return ()
    out: list[str] = []
    shaped = _DOMAIN_SHAPED_NAME_RE.match(text)
    if shaped:
        out.append(f"{shaped.group(1).casefold()}.{shaped.group(2).casefold()}")
    # Strip legal suffix then retry shape on the commercial core.
    core = _LEGAL_SUFFIX_RE.sub(" ", text).strip(" ,.-")
    if core and core.casefold() != text.casefold():
        shaped_core = _DOMAIN_SHAPED_NAME_RE.match(core)
        if shaped_core:
            out.append(f"{shaped_core.group(1).casefold()}.{shaped_core.group(2).casefold()}")
    tokens = identity_tokens(text)
    if tokens:
        joined = "".join(tokens)
        if len(joined) >= 4:
            for tld in _COMMON_CORPORATE_TLDS:
                out.append(f"{joined}.{tld}")
        if len(tokens) >= 2:
            hyphen = "-".join(tokens)
            if len(hyphen) >= 5:
                for tld in ("it", "com", "eu"):
                    out.append(f"{hyphen}.{tld}")
    return tuple(dict.fromkeys(item for item in out if item and not is_blacklisted_domain(item)))


def domain_candidates_from_evidence_text(
    company_name: str,
    text: str,
    *,
    brand_name: str = "",
    acronym: str = "",
) -> Tuple[str, ...]:
    """Pull hostname mentions from already-fetched evidence that the company owns."""
    blob = str(text or "")
    if not blob or not company_name:
        return ()
    out: list[str] = []
    for match in _DOMAIN_IN_TEXT_RE.finditer(blob):
        host = host_of(match.group(1))
        if not host or is_blacklisted_domain(host):
            continue
        if company_owns_host(company_name, host, brand_name=brand_name, acronym=acronym):
            out.append(host)
    return tuple(dict.fromkeys(out))


def classify_entity(
    company_name: str,
    *,
    host: str = "",
    source_payload: Mapping[str, Any] | None = None,
) -> str:
    payload = source_payload or {}
    # Classify from the entity's own name/host — never from news evidence_excerpt
    # or third-party publisher names. Industrial articles often mention
    # "associazione"/Confindustria and falsely rejected operating companies
    # (open-world antincendio: Pizzoli on confindustriaemilia.it).
    if host and is_blacklisted_domain(host):
        return "directory"
    if _PUBLIC_RE.search(company_name) or _PUBLIC_RE.search(host.replace("-", " ").replace(".", " ")):
        return "public_authority"
    if _UNION_RE.search(company_name) or _UNION_RE.search(host.replace("-", " ").replace(".", " ")):
        return "trade_union"
    # Association class must come from the target name/host only. Publisher hosts
    # like confindustriaemilia.it often report on real PMI and must not poison class.
    if _ASSOCIATION_RE.search(company_name) or _ASSOCIATION_RE.search(
        host.replace("-", " ").replace(".", " ")
    ):
        return "association"
    publisher_name = str(payload.get("source_publisher") or "")
    if _PUBLISHER_RE.search(company_name) or (
        _PUBLISHER_RE.search(publisher_name)
        and normalize_company_name(company_name) == normalize_company_name(publisher_name)
    ):
        return "publisher"
    explicit = str(payload.get("entity_class") or payload.get("entity_type") or "").strip().casefold()
    if explicit in {"company_group", "operating_company", "unknown"}:
        if explicit == "company_group" or _GROUP_RE.search(company_name) or bool(payload.get("group_domain_proof")):
            return "company_group" if explicit == "company_group" or _GROUP_RE.search(company_name) or bool(payload.get("group_domain_proof")) else explicit
        return explicit
    if _GROUP_RE.search(company_name) or bool(payload.get("group_domain_proof")):
        return "company_group"
    if _LEGAL_SUFFIX_RE.search(company_name) or identity_tokens(company_name):
        return "operating_company"
    return "unknown"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _reject(
    name: str,
    entity_class: str,
    code: str,
    *,
    evidence: Sequence[str] = (),
    cost_eur: float = 0.0,
    method: str = "entity_class_gate",
    source: str = "classifier",
) -> EntityIdentityResult:
    return EntityIdentityResult(
        official_domain=None,
        operating_entity_name=name,
        entity_class=entity_class,
        identity_status="rejected",
        identity_confidence=0.0,
        identity_evidence=tuple(evidence),
        resolution_method=method,
        resolution_source=source,
        identity_resolved_at=_now(),
        cost_eur=cost_eur,
        rejection_code=code,
    )


def _unresolved(
    name: str,
    entity_class: str,
    code: str,
    *,
    evidence: Sequence[str] = (),
    cost_eur: float = 0.0,
) -> EntityIdentityResult:
    return EntityIdentityResult(
        official_domain=None,
        operating_entity_name=name,
        entity_class=entity_class,
        identity_status="unresolved",
        identity_confidence=0.0,
        identity_evidence=tuple(evidence),
        resolution_method="unresolved",
        resolution_source="none",
        identity_resolved_at=_now(),
        cost_eur=cost_eur,
        rejection_code=code,
    )


def _accept(
    *,
    name: str,
    domain: str,
    entity_class: str,
    confidence: float,
    evidence: Sequence[str],
    method: str,
    source: str,
    cost_eur: float,
    cache: MemoryEntityDomainCache,
    geography: str,
) -> EntityIdentityResult:
    host = normalize_domain(domain) or host_of(domain)
    result = EntityIdentityResult(
        official_domain=host,
        operating_entity_name=name,
        entity_class=entity_class,
        identity_status="verified",
        identity_confidence=float(confidence),
        identity_evidence=tuple(str(item) for item in evidence if str(item)),
        resolution_method=method,
        resolution_source=source,
        identity_resolved_at=_now(),
        cost_eur=cost_eur,
        rejection_code=None,
    )
    cache.put(
        name,
        geography,
        CachedEntityIdentity(
            official_domain=host,
            operating_entity_name=name,
            entity_class=entity_class,
            identity_confidence=result.identity_confidence,
            identity_evidence=result.identity_evidence,
            resolution_method=method,
            resolution_source=source,
        ),
    )
    return result


def _verify_candidate(
    verify_fn: VerifyFn,
    company_name: str,
    url_or_domain: str,
    geography: str,
) -> Optional[Mapping[str, Any]]:
    host = host_of(url_or_domain) or normalize_domain(url_or_domain)
    if not host or is_blacklisted_domain(host):
        return None
    url = url_or_domain if "://" in url_or_domain else f"https://{host}/"
    raw = verify_fn(company_name, url, geography)
    if not raw:
        return None
    if str(raw.get("status") or "").lower() not in {"verified", "probable", "cached"}:
        # offline/tests may omit status; accept scored ownership
        if int(raw.get("score") or 0) < 70 and float(raw.get("confidence") or 0) < 0.70:
            return None
    evidence = {str(item) for item in (raw.get("evidence") or ())}
    if not evidence.intersection(_OWNERSHIP_EVIDENCE) and "cache_verified_domain" not in evidence:
        # allow explicit ownership helpers from callers
        if not company_owns_host(company_name, host_of(str(raw.get("url") or url))):
            return None
        evidence = set(evidence) | {"company_tokens_in_host"}
        raw = {**dict(raw), "evidence": tuple(evidence)}
    return raw


def resolve_entity_identity(
    request: EntityIdentityRequest,
    *,
    cache: Optional[MemoryEntityDomainCache] = None,
    verify_fn: Optional[VerifyFn] = None,
    serp_fn: Optional[SerpFn] = None,
) -> EntityIdentityResult:
    """Resolve official domain + operating entity with contractual output."""
    active_cache = cache or _DEFAULT_CACHE
    name = re.sub(r"\s+", " ", str(request.company_name or "")).strip()
    if not name:
        return _reject("", "unknown", "COMPANY_MISSING")

    presented = host_of(request.presented_domain) or normalize_domain(request.presented_domain) or ""
    evidence_host = host_of(request.evidence_url)
    # Classify the target company from its own presented host / name.
    # Never treat a third-party evidence host (news, ATS, register) as the
    # company's identity class — that falsely rejects news-grounded leads.
    entity_class = classify_entity(name, host=presented, source_payload=request.source_payload)
    if request.group_domain_proof and entity_class == "operating_company":
        entity_class = "company_group"

    allowed = {str(item) for item in request.allowed_entity_classes} or set(COMMERCIAL_ENTITY_CLASSES)
    if presented and is_blacklisted_domain(presented):
        return _reject(name, "directory", "DIRECTORY_OR_PORTAL_DOMAIN", evidence=("presented_blacklisted_domain",))
    if entity_class == "directory":
        return _reject(name, "directory", "DIRECTORY_OR_PORTAL_DOMAIN", evidence=("directory_classifier",))
    if entity_class == "publisher":
        return _reject(name, "publisher", "PUBLISHER_AS_COMPANY", evidence=("publisher_classifier",))
    if entity_class == "public_authority" and entity_class not in allowed:
        return _reject(name, "public_authority", "PUBLIC_BODY_AS_COMPANY", evidence=("public_authority_classifier",))
    if entity_class == "association" and entity_class not in allowed:
        return _reject(name, "association", "ASSOCIATION_AS_COMPANY", evidence=("association_classifier",))
    if entity_class == "trade_union" and entity_class not in allowed:
        return _reject(name, "trade_union", "TRADE_UNION_AS_COMPANY", evidence=("trade_union_classifier",))
    if entity_class not in allowed and entity_class not in COMMERCIAL_ENTITY_CLASSES:
        if entity_class == "unknown":
            pass  # may still resolve via ownership
        else:
            return _reject(name, entity_class, "ENTITY_CLASS_NOT_ALLOWED", evidence=(entity_class,))

    cached = active_cache.get(name, request.geography, presented or evidence_host)
    if cached and cached.entity_class in allowed.union(COMMERCIAL_ENTITY_CLASSES):
        return EntityIdentityResult(
            official_domain=cached.official_domain,
            operating_entity_name=cached.operating_entity_name or name,
            entity_class=cached.entity_class,
            identity_status="verified",
            identity_confidence=cached.identity_confidence,
            identity_evidence=tuple(dict.fromkeys([*cached.identity_evidence, "cache_hit"])),
            resolution_method="cache_lookup",
            resolution_source="verified_domain_cache",
            identity_resolved_at=_now(),
            cost_eur=0.0,
            rejection_code=None,
        )

    if verify_fn is None or serp_fn is None:
        from backend_mirror.agents.domain_resolver import resolve_official_identity, verify_company_domain

        verify_fn = verify_fn or verify_company_domain
        serp_fn = serp_fn or (lambda company, location, max_results: resolve_official_identity(company, location, max_results=max_results))

    brand = request.brand_name or str(request.source_payload.get("brand_name") or "")
    acronym = request.acronym or str(request.source_payload.get("acronym") or "")
    cost = 0.0

    # 2) evidence URL host when company-owned
    if evidence_host and company_owns_host(name, evidence_host, brand_name=brand, acronym=acronym):
        raw = _verify_candidate(verify_fn, name, request.evidence_url or evidence_host, request.geography)
        if raw:
            return _accept(
                name=name,
                domain=str(raw.get("url") or evidence_host),
                entity_class="company_group" if request.group_domain_proof else (
                    "operating_company" if entity_class == "unknown" else entity_class
                ),
                confidence=float(raw.get("confidence") or 0.9),
                evidence=tuple(raw.get("evidence") or ()) + ("company_owned_evidence_host",),
                method=str(raw.get("resolution_method") or "company_owned_source_host"),
                source="evidence_url",
                cost_eur=cost,
                cache=active_cache,
                geography=request.geography,
            )

    # 3) provider-presented domain
    if presented:
        if is_blacklisted_domain(presented):
            return _reject(name, "directory", "DIRECTORY_OR_PORTAL_DOMAIN", evidence=("presented_blacklisted_domain",))
        raw = _verify_candidate(verify_fn, name, presented, request.geography)
        if raw and (
            company_owns_host(name, presented, brand_name=brand, acronym=acronym)
            or request.group_domain_proof
            or "company_tokens_in_host" in {str(x) for x in (raw.get("evidence") or ())}
        ):
            cls = "company_group" if request.group_domain_proof or entity_class == "company_group" else "operating_company"
            return _accept(
                name=name,
                domain=str(raw.get("url") or presented),
                entity_class=cls,
                confidence=float(raw.get("confidence") or 0.9),
                evidence=tuple(raw.get("evidence") or ()) + (("group_domain_proof",) if request.group_domain_proof else ()),
                method=str(raw.get("resolution_method") or "presented_domain_verification"),
                source="provider_presented_domain",
                cost_eur=cost,
                cache=active_cache,
                geography=request.geography,
            )
        if not company_owns_host(name, presented, brand_name=brand, acronym=acronym) and not request.group_domain_proof:
            # ambiguous presented host without ownership
            if not request.allow_serp:
                return _unresolved(name, entity_class or "unknown", "OFFICIAL_DOMAIN_AMBIGUOUS", evidence=("presented_domain_unproven",))

    # 4) official links present in page/payload
    link_candidates = list(request.page_links or ())
    payload_links = request.source_payload.get("official_links") or request.source_payload.get("page_links") or ()
    if isinstance(payload_links, (list, tuple)):
        link_candidates.extend(str(item) for item in payload_links)
    for link in link_candidates:
        host = host_of(link)
        if not host or is_blacklisted_domain(host):
            continue
        if not company_owns_host(name, host, brand_name=brand, acronym=acronym):
            continue
        raw = _verify_candidate(verify_fn, name, link, request.geography)
        if raw:
            return _accept(
                name=name,
                domain=str(raw.get("url") or host),
                entity_class="operating_company" if entity_class in {"unknown", "operating_company"} else entity_class,
                confidence=float(raw.get("confidence") or 0.88),
                evidence=tuple(raw.get("evidence") or ()) + ("page_official_link",),
                method="page_link_verification",
                source="page_links",
                cost_eur=cost,
                cache=active_cache,
                geography=request.geography,
            )

    # 5) structured data / legal identity in payload
    structured = request.source_payload.get("organization_url") or request.source_payload.get("sameAs") or ""
    structured_host = host_of(str(structured))
    if structured_host and not is_blacklisted_domain(structured_host):
        raw = _verify_candidate(verify_fn, name, str(structured), request.geography)
        if raw and company_owns_host(name, structured_host, brand_name=brand, acronym=acronym):
            return _accept(
                name=name,
                domain=str(raw.get("url") or structured_host),
                entity_class="operating_company",
                confidence=float(raw.get("confidence") or 0.92),
                evidence=tuple(raw.get("evidence") or ()) + ("structured_data_identity",),
                method="structured_data_verification",
                source="structured_data",
                cost_eur=cost,
                cache=active_cache,
                geography=request.geography,
            )

    # 5b) Free candidates from name shape + already-fetched evidence text.
    # News SERPs often bury the corporate homepage; verifying an owned host
    # mentioned in source_text (or implied by Brand.TLD names) costs €0.
    evidence_blobs = [
        str(request.page_html or ""),
        str(request.source_payload.get("source_text") or ""),
        str(request.source_payload.get("evidence_excerpt") or ""),
        str(request.source_payload.get("page_title") or ""),
        str(request.source_payload.get("search_snippet") or ""),
    ]
    free_hosts: list[str] = []
    free_hosts.extend(domain_candidates_from_company_name(name))
    if brand:
        free_hosts.extend(domain_candidates_from_company_name(brand))
    for blob in evidence_blobs:
        free_hosts.extend(
            domain_candidates_from_evidence_text(
                name, blob, brand_name=brand, acronym=acronym
            )
        )
    free_attempts = 0
    for host in dict.fromkeys(free_hosts):
        if free_attempts >= 6:
            break
        if not company_owns_host(name, host, brand_name=brand, acronym=acronym):
            continue
        free_attempts += 1
        raw = _verify_candidate(verify_fn, name, f"https://{host}/", request.geography)
        if raw:
            return _accept(
                name=name,
                domain=str(raw.get("url") or host),
                entity_class="operating_company" if entity_class in {"unknown", "operating_company"} else entity_class,
                confidence=float(raw.get("confidence") or 0.9),
                evidence=tuple(raw.get("evidence") or ()) + ("free_owned_host_candidate",),
                method="free_owned_host_verification",
                source="name_or_evidence_host_candidate",
                cost_eur=cost,
                cache=active_cache,
                geography=request.geography,
            )

    # 6) SERP fallback only
    if not request.allow_serp:
        return _unresolved(name, entity_class or "unknown", "OFFICIAL_DOMAIN_UNRESOLVED", evidence=("serp_disabled",), cost_eur=cost)
    if request.budget_eur + 1e-9 < _SERP_COST_EUR:
        return _unresolved(name, entity_class or "unknown", "IDENTITY_BUDGET_EXCEEDED", evidence=("budget_too_low_for_serp",), cost_eur=cost)

    active_cache.serp_calls += 1
    raw = serp_fn(name, request.geography, 5)
    cost += _SERP_COST_EUR
    if not raw or str(raw.get("status") or "").lower() != "verified":
        return _unresolved(name, entity_class or "unknown", "OFFICIAL_DOMAIN_UNRESOLVED", evidence=("serp_unresolved",), cost_eur=cost)
    host = host_of(str(raw.get("url") or ""))
    if not host or is_blacklisted_domain(host):
        return _reject(name, "directory", "DIRECTORY_OR_PORTAL_DOMAIN", evidence=("serp_blacklisted_domain",), cost_eur=cost)
    evidence = tuple(str(item) for item in (raw.get("evidence") or ()) if str(item))
    if not set(evidence).intersection(_OWNERSHIP_EVIDENCE) and not company_owns_host(name, host, brand_name=brand, acronym=acronym):
        return _unresolved(name, entity_class or "unknown", "OFFICIAL_DOMAIN_AMBIGUOUS", evidence=evidence or ("serp_ownership_unproven",), cost_eur=cost)
    return _accept(
        name=name,
        domain=str(raw.get("url") or host),
        entity_class="operating_company" if entity_class in {"unknown", "operating_company"} else entity_class,
        confidence=float(raw.get("confidence") or 0.0),
        evidence=evidence or ("company_tokens_in_host",),
        method=str(raw.get("resolution_method") or "serp_identity"),
        source=str(raw.get("resolution_source") or "serp_identity"),
        cost_eur=cost,
        cache=active_cache,
        geography=request.geography,
    )


def default_cache() -> MemoryEntityDomainCache:
    return _DEFAULT_CACHE


def reset_default_cache() -> None:
    _DEFAULT_CACHE._by_key.clear()
    _DEFAULT_CACHE._by_domain.clear()
    _DEFAULT_CACHE.hits = 0
    _DEFAULT_CACHE.misses = 0
    _DEFAULT_CACHE.serp_calls = 0
