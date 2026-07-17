"""Discovery-first ANAC/TED procurement adapter."""

from __future__ import annotations

import re
import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from .contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    ContactRecord,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceExhaustion,
)


@dataclass(frozen=True)
class ProcurementProviderResult:
    records: Tuple[Mapping[str, Any], ...]
    exhausted: bool
    cost_eur: float = 0.0


ProcurementProvider = Callable[[AdapterDiscoveryRequest, int, int], Awaitable[ProcurementProviderResult]]
_DOMAIN_SEARCH_COST_EUR = 0.005


@dataclass(frozen=True)
class DomainResolutionResult:
    url: str
    confidence: float
    score: int
    evidence: Tuple[str, ...]
    resolution_source: str
    resolution_method: str
    cost_eur: float = 0.0
    resolved_at: Optional[str] = None


DomainResolver = Callable[[str, str, str, float], Awaitable[Optional[DomainResolutionResult]]]
_OWNERSHIP_EVIDENCE = frozenset({"company_tokens_in_host", "schema_org_identity_match"})


async def _default_domain_resolver(
    company_name: str,
    presented_url: str,
    location: str,
    budget_eur: float,
) -> Optional[DomainResolutionResult]:
    """Resolve and positively verify ownership; probable/dead domains fail closed."""
    from backend_mirror.agents.domain_resolver import resolve_official_identity, verify_company_domain
    from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain

    if presented_url:
        raw = await asyncio.to_thread(verify_company_domain, company_name, presented_url, location)
        cost = 0.0
        source = "extracted_website"
    else:
        if budget_eur + 1e-9 < _DOMAIN_SEARCH_COST_EUR:
            return None
        raw = await asyncio.to_thread(resolve_official_identity, company_name, location, max_results=5)
        cost = _DOMAIN_SEARCH_COST_EUR
        source = str((raw or {}).get("resolution_source") or "serp_identity")
    if not raw or str(raw.get("status") or "").lower() != "verified":
        return None
    confidence = float(raw.get("confidence") or 0.0)
    score = int(raw.get("score") or 0)
    evidence = tuple(str(item) for item in raw.get("evidence") or () if str(item))
    if confidence < 0.70 or score < 70 or not evidence:
        return None
    if not _OWNERSHIP_EVIDENCE.intersection(evidence):
        return None
    url = str(raw.get("url") or "")
    if not url or is_blacklisted_domain(normalize_domain(url)):
        return None
    return DomainResolutionResult(
        url=url, confidence=confidence, score=score,
        evidence=evidence, resolution_source=source,
        resolution_method=str(raw.get("resolution_method") or "positive_page_identity"),
        cost_eur=cost,
        resolved_at=str(raw.get("resolved_at") or "") or datetime.now(timezone.utc).isoformat(),
    )


def _text(value: Any) -> Optional[str]:
    result = str(value or "").strip()
    return result or None


def _iso_date(value: Any) -> Optional[str]:
    text = _text(value)
    if not text:
        return None
    for fmt in (None, "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return (date.fromisoformat(text[:10]) if fmt is None else datetime.strptime(text[:10], fmt).date()).isoformat()
        except ValueError:
            continue
    return None


def _domain(value: Any) -> Optional[str]:
    text = _text(value)
    if not text:
        return None
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.hostname or "").lower().removeprefix("www.") or None


def _amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            value = value.replace(".", "").replace(",", ".")
        parsed = float(value)
        return parsed if parsed >= 0 else None
    except (TypeError, ValueError):
        return None


def _cursor_offset(cursor: Optional[DiscoveryCursor]) -> int:
    if not cursor:
        return 0
    match = re.fullmatch(r"procurement:v1:(\d+)", cursor.value)
    if not match:
        raise ValueError("invalid procurement cursor")
    return int(match.group(1))


def _target_tokens(request: AdapterDiscoveryRequest) -> set[str]:
    stop = {"impresa", "imprese", "azienda", "aziende", "pmi", "italia", "italiane", "settore"}
    return {
        token
        for value in request.sectors
        for token in re.findall(r"[a-z0-9]{4,}", value.lower())
        if token not in stop
    }


def _geography_matches(record: Mapping[str, Any], request: AdapterDiscoveryRequest) -> bool:
    requested = {item.casefold().strip() for item in request.geographies if item.strip()}
    if not requested:
        return True
    source_id = (_text(record.get("source_id")) or "").casefold()
    geography = (_text(record.get("geography") or record.get("province") or record.get("region")) or "").casefold()
    geo_tokens = set(re.findall(r"[a-z0-9]+", geography))
    italy_requested = bool(requested.intersection({"italy", "italia", "it", "ita"}))
    country_matches = bool(
        source_id == "anac_opendata"
        or geo_tokens.intersection({"italy", "italia", "italian", "it", "ita"})
        or any(token.startswith("it") and 3 <= len(token) <= 5 for token in geo_tokens)
    )
    local_requested = requested.difference({"italy", "italia", "it", "ita"})
    local_matches = any(item in geography for item in local_requested)
    if local_requested:
        return bool(local_matches and (country_matches if italy_requested else True))
    return bool(country_matches if italy_requested else True)


def _record_is_valid(record: Mapping[str, Any], request: AdapterDiscoveryRequest, today: date) -> Tuple[bool, str]:
    name = _text(record.get("winner_name") or record.get("company_name"))
    role = (_text(record.get("role")) or "").lower()
    status = (_text(record.get("status")) or "").lower()
    if not name:
        return False, "WINNER_MISSING"
    if name.casefold() in {(_text(record.get("authority")) or "").casefold(), (_text(record.get("publisher")) or "").casefold()}:
        return False, "PUBLISHER_OR_AUTHORITY_AS_WINNER"
    # ANAC Open Data labels winners as "operatore economico ..."; TED uses winner/contractor.
    winner_role_ok = (not role) or any(
        term in role
        for term in (
            "winner", "aggiudicat", "contractor", "operatore economico",
            "mandataria", "monosoggett",
        )
    )
    # Exclude pure auxiliary / authority-side roles.
    if role and any(term in role for term in ("ausiliar", "subappalt", "progettista", "contracting", "stazione")):
        return False, "ENTITY_NOT_WINNER"
    if not winner_role_ok:
        return False, "ENTITY_NOT_WINNER"
    if not any(term in status for term in ("award", "aggiudic", "affidat", "contract")):
        return False, "NOT_AWARDED"
    awarded_at = _iso_date(record.get("award_date") or record.get("date"))
    if not awarded_at:
        return False, "AWARD_DATE_MISSING"
    awarded_date = date.fromisoformat(awarded_at)
    if awarded_date > today:
        return False, "AWARD_DATE_INVALID"
    if request.freshness_max_age_days is not None and (today - awarded_date).days > request.freshness_max_age_days:
        return False, "AWARD_STALE"
    if not _geography_matches(record, request):
        return False, "GEOGRAPHY_MISMATCH"
    tokens = _target_tokens(request)
    title = (_text(record.get("title") or record.get("object")) or "").lower()
    if tokens and title and not any(token in title for token in tokens):
        return False, "TARGET_FIT_MISMATCH"
    if tokens and not title:
        # Country-wide ANAC award rows may omit object text in the current CSV schema;
        # do not invent sector fit, but do not reject solely for an empty title.
        pass
    if not _text(record.get("source_url")) or not _text(record.get("publisher")):
        return False, "SOURCE_PROVENANCE_MISSING"
    return True, ""


async def _anac_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> ProcurementProviderResult:
    import asyncio
    from backend_mirror import anac_indexer

    days = request.freshness_max_age_days or anac_indexer.CUTOFF_DAYS
    path = await asyncio.to_thread(anac_indexer.ensure_index)
    records = await asyncio.to_thread(
        anac_indexer.discover_companies,
        list(request.sectors) or [request.query],
        location=next((geo for geo in request.geographies if geo.lower() not in {"italy", "italia"}), ""),
        max_records=offset + limit,
        days=days,
        db_path=path,
    )
    normalized = []
    for record in records[offset:offset + limit]:
        cig = _text(record.get("cig")) or ""
        object_text = _text(record.get("object")) or (
            f"Contratto pubblico aggiudicato (CIG {cig})" if cig else "Contratto pubblico aggiudicato"
        )
        normalized.append({
            "source_id": "anac_opendata",
            "winner_name": record.get("company_name"),
            "winner_identifier": record.get("cf"),
            "official_domain": "",
            "award_id": record.get("cig"),
            "title": object_text,
            "award_date": record.get("date"),
            "amount": record.get("amount"),
            "cpv": record.get("cpv"),
            "geography": " ".join(filter(None, (record.get("province"), record.get("region")))) or "Italia",
            "authority": record.get("authority"),
            "publisher": "ANAC",
            "source_url": (
                f"https://dati.anticorruzione.it/opendata/cig/{record.get('cig')}"
                if record.get("cig")
                else "https://dati.anticorruzione.it/opendata"
            ),
            "status": record.get("status") or "aggiudicata",
            "role": record.get("role") or "aggiudicatario",
            "evidence_excerpt": f"CIG {record.get('cig')}: {record.get('company_name')} aggiudicataria - {object_text}",
        })
    return ProcurementProviderResult(tuple(normalized), len(records) < offset + limit, 0.0)


async def _ted_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> ProcurementProviderResult:
    from backend_mirror.ted_client import discover_ted_awards

    page = offset // max(1, limit) + 1
    result = await discover_ted_awards(
        list(request.sectors) or [request.query],
        location=next((geo for geo in request.geographies if str(geo).strip()), ""),
        page=page,
        limit=limit,
    )
    return ProcurementProviderResult(tuple(result["records"]), bool(result["exhausted"]), float(result.get("cost_eur") or 0))


class ProcurementAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="public_procurement_v1",
        adapter_version="1.0.0",
        supported_intents=("organic_web_search", "commercial_search", "public_procurement"),
        supported_signals=("tender_won", "contract_awarded"),
        source_classes=("public_procurement_portal",),
        geographic_coverage=("italy", "eu"),
        freshness_max_age_days=1,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=100,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=_DOMAIN_SEARCH_COST_EUR,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("publisher", "award_id", "authority", "winner_role", "source_url"),
        evidence_guarantees=("contract_award", "award_date", "winner_name", "excerpt"),
        exhaustion_semantics="partition",
        coverage_status="supported",
    )

    def __init__(
        self,
        providers: Sequence[ProcurementProvider] = (_anac_provider, _ted_provider),
        domain_resolver: DomainResolver = _default_domain_resolver,
    ) -> None:
        if not providers:
            raise ValueError("at least one procurement provider is required")
        self._providers = tuple(providers)
        self._domain_resolver = domain_resolver

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        # Empty sectors are valid for country-wide recent-award discovery; ANAC
        # then uses date-first indexing instead of inventing sector keywords.
        offset = _cursor_offset(request.cursor)
        per_provider = min(100, max(request.requested_count * 2, 20))
        started = datetime.now(timezone.utc).isoformat()
        provider_results: List[ProcurementProviderResult] = []
        provider_warnings: List[str] = []
        spent = 0.0
        for provider in self._providers:
            remaining = max(0.0, request.budget_eur - spent)
            bounded_request = AdapterDiscoveryRequest(
                intent=request.intent, signal_ids=request.signal_ids, signal_match_mode=request.signal_match_mode,
                geographies=request.geographies, freshness_max_age_days=request.freshness_max_age_days,
                requested_count=request.requested_count, budget_eur=remaining, query=request.query,
                sectors=request.sectors, technical_filters=request.technical_filters, cursor=request.cursor,
            )
            try:
                result = await provider(bounded_request, offset, per_provider)
            except Exception as exc:
                provider_name = str(getattr(provider, "__name__", provider.__class__.__name__)).upper()
                provider_warnings.append(f"PROVIDER_FAILED:{provider_name}:{exc.__class__.__name__.upper()}")
                continue
            if result.cost_eur > remaining + 1e-9:
                raise RuntimeError("PROCUREMENT_PROVIDER_EXCEEDED_HARD_COST_CAP")
            provider_results.append(result)
            spent += result.cost_eur
        observed = datetime.now(timezone.utc).isoformat()
        candidates: List[OpportunityCandidate] = []
        seen_entities: set[str] = set()
        seen_awards: set[str] = set()
        rejection_codes: List[str] = list(provider_warnings)
        for provider_result in provider_results:
            for record in provider_result.records:
                valid, rejection = _record_is_valid(record, request, date.today())
                if not valid:
                    rejection_codes.append(rejection)
                    continue
                name = _text(record.get("winner_name") or record.get("company_name")) or ""
                identifier = _text(record.get("winner_identifier") or record.get("cf"))
                award_id = _text(record.get("award_id") or record.get("cig")) or ""
                entity_key = identifier or re.sub(r"\W+", "", name.casefold())
                if not award_id or award_id in seen_awards or entity_key in seen_entities:
                    rejection_codes.append("DUPLICATE_AWARD_OR_ENTITY")
                    continue
                seen_awards.add(award_id)
                seen_entities.add(entity_key)
                source_url = _text(record.get("source_url")) or ""
                publisher = _text(record.get("publisher")) or ""
                awarded_at = _iso_date(record.get("award_date") or record.get("date")) or ""
                amount = _amount(record.get("amount"))
                title = _text(record.get("title") or record.get("object")) or "Contract award"
                signal_id = "contract_awarded" if "contract_awarded" in request.signal_ids else "tender_won"
                excerpt = _text(record.get("evidence_excerpt")) or f"{name} awarded {award_id}: {title}"
                evidence = EvidenceRecord(
                    signal_id=signal_id,
                    source_url=source_url,
                    source_publisher=publisher,
                    source_class="public_procurement_portal",
                    excerpt=excerpt,
                    observed_at=observed,
                    published_at=awarded_at,
                    extraction_method="structured_procurement_record",
                    confidence=0.98,
                    provenance={
                        "award_id": award_id,
                        "authority": record.get("authority"),
                        "winner_role": record.get("role"),
                        "cpv": record.get("cpv"),
                        "amount_eur": amount,
                        "source_id": record.get("source_id"),
                    },
                )
                presented_domain = _text(record.get("official_domain")) or ""
                remaining_budget = max(0.0, request.budget_eur - spent)
                if not presented_domain and remaining_budget + 1e-9 < _DOMAIN_SEARCH_COST_EUR:
                    rejection_codes.append("DOMAIN_RESOLUTION_BUDGET_EXHAUSTED")
                    continue
                resolution = await self._domain_resolver(
                    name,
                    presented_domain,
                    _text(record.get("geography")) or "",
                    remaining_budget,
                )
                if resolution is None:
                    rejection_codes.append("OFFICIAL_DOMAIN_UNRESOLVED")
                    continue
                if resolution.cost_eur > remaining_budget + 1e-9:
                    raise RuntimeError("PROCUREMENT_DOMAIN_RESOLVER_EXCEEDED_HARD_COST_CAP")
                spent += resolution.cost_eur
                official_domain = _domain(resolution.url)
                if not official_domain:
                    rejection_codes.append("OFFICIAL_DOMAIN_UNRESOLVED")
                    continue
                from backend_mirror.agents.portal_blacklist import is_blacklisted_domain
                if is_blacklisted_domain(official_domain):
                    rejection_codes.append("DIRECTORY_OR_PORTAL_DOMAIN")
                    continue
                if not _OWNERSHIP_EVIDENCE.intersection(resolution.evidence):
                    rejection_codes.append("OFFICIAL_DOMAIN_OWNERSHIP_UNPROVEN")
                    continue
                publisher_host = _domain(source_url)
                if publisher_host and official_domain == publisher_host:
                    rejection_codes.append("PUBLISHER_DOMAIN_AS_COMPANY")
                    continue
                amount_clause = f" for EUR {amount:,.0f}" if amount else ""
                why_now = (
                    f"{name} won public contract {award_id}{amount_clause} "
                    f"({title[:120]}). Recent award creates immediate delivery, "
                    f"subcontracting and compliance demand."
                )
                resolved_at = resolution.resolved_at or datetime.now(timezone.utc).isoformat()
                candidates.append(OpportunityCandidate(
                    canonical_company_name=name,
                    company_identifiers={"fiscal_id": identifier} if identifier else {},
                    official_domain=official_domain,
                    entity_class="operating_company",
                    geographies=tuple(filter(None, (_text(record.get("geography")),))),
                    buyer_fit=1.0,
                    signal_id=signal_id,
                    signal_date=awarded_at,
                    evidence=(evidence,),
                    why_now=why_now,
                    contacts=(),
                    confidence=0.98,
                    contradiction_flags=(),
                    provenance={
                        "adapter_id": self.capability.adapter_id,
                        "award_id": award_id,
                        "authority": record.get("authority"),
                        "domain_verification": {
                            "status": "verified",
                            "confidence": resolution.confidence,
                            "score": resolution.score,
                            "evidence": list(resolution.evidence),
                            "resolution_source": resolution.resolution_source,
                            "resolution_method": resolution.resolution_method,
                            "url": resolution.url,
                            "resolved_at": resolved_at,
                        },
                    },
                    adapter_id=self.capability.adapter_id,
                    adapter_version=self.capability.adapter_version,
                    official_domain_verified=True,
                    official_domain_confidence=resolution.confidence,
                ))
                if len(candidates) >= request.requested_count:
                    break
            if len(candidates) >= request.requested_count:
                break
        target_reached = len(candidates) >= request.requested_count
        # Provider failures are warnings; they must not keep paging forever when
        # every successful provider already reported exhaustion.
        if not provider_results:
            all_exhausted = True
        else:
            all_exhausted = all(result.exhausted for result in provider_results)
        next_cursor = None if all_exhausted else DiscoveryCursor(f"procurement:v1:{offset + per_provider}", partition="anac_ted")
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=all_exhausted and not target_reached,
                scope="source" if all_exhausted else "partition",
                reason="requested_count_reached" if target_reached else "all_procurement_sources_exhausted" if all_exhausted else "next_partition_available",
                authoritative=all_exhausted,
                next_cursor=next_cursor,
            ),
            operations=sum(len(result.records) for result in provider_results),
            cost_eur=spent,
            started_at=started,
            completed_at=observed,
            warnings=tuple(sorted(set(rejection_codes))),
        )
