"""Discovery-first ANAC/TED procurement adapter."""

from __future__ import annotations

import re
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


def _record_is_valid(record: Mapping[str, Any], request: AdapterDiscoveryRequest, today: date) -> Tuple[bool, str]:
    name = _text(record.get("winner_name") or record.get("company_name"))
    role = (_text(record.get("role")) or "").lower()
    status = (_text(record.get("status")) or "").lower()
    if not name:
        return False, "WINNER_MISSING"
    if name.casefold() in {(_text(record.get("authority")) or "").casefold(), (_text(record.get("publisher")) or "").casefold()}:
        return False, "PUBLISHER_OR_AUTHORITY_AS_WINNER"
    if role and not any(term in role for term in ("winner", "aggiudicat", "contractor")):
        return False, "ENTITY_NOT_WINNER"
    if not any(term in status for term in ("award", "aggiudic", "affidat", "contract")):
        return False, "NOT_AWARDED"
    awarded_at = _iso_date(record.get("award_date") or record.get("date"))
    if not awarded_at:
        return False, "AWARD_DATE_MISSING"
    if request.freshness_max_age_days is not None and (today - date.fromisoformat(awarded_at)).days > request.freshness_max_age_days:
        return False, "AWARD_STALE"
    requested_geo = {item.casefold() for item in request.geographies if item.casefold() not in {"italy", "italia"}}
    record_geo = (_text(record.get("geography") or record.get("province") or record.get("region")) or "").casefold()
    if requested_geo and not any(item in record_geo for item in requested_geo):
        return False, "GEOGRAPHY_MISMATCH"
    tokens = _target_tokens(request)
    title = (_text(record.get("title") or record.get("object")) or "").lower()
    if tokens and not any(token in title for token in tokens):
        return False, "TARGET_FIT_MISMATCH"
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
        normalized.append({
            "source_id": "anac_opendata",
            "winner_name": record.get("company_name"),
            "winner_identifier": record.get("cf"),
            "official_domain": "",
            "award_id": record.get("cig"),
            "title": record.get("object"),
            "award_date": record.get("date"),
            "amount": record.get("amount"),
            "cpv": record.get("cpv"),
            "geography": " ".join(filter(None, (record.get("province"), record.get("region")))),
            "authority": record.get("authority"),
            "publisher": "ANAC",
            "source_url": "https://dati.anticorruzione.it/opendata",
            "status": record.get("status") or "aggiudicata",
            "role": record.get("role") or "aggiudicatario",
            "evidence_excerpt": f"CIG {record.get('cig')}: {record.get('company_name')} aggiudicataria - {record.get('object')}",
        })
    return ProcurementProviderResult(tuple(normalized), len(records) < offset + limit, 0.0)


async def _ted_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> ProcurementProviderResult:
    from backend_mirror.ted_client import discover_ted_awards

    page = offset // max(1, limit) + 1
    result = await discover_ted_awards(
        list(request.sectors) or [request.query],
        location=next((geo for geo in request.geographies if geo.lower() not in {"italy", "italia"}), ""),
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
        estimated_cost_eur_per_operation=0.0,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("publisher", "award_id", "authority", "winner_role", "source_url"),
        evidence_guarantees=("contract_award", "award_date", "winner_name", "excerpt"),
        exhaustion_semantics="partition",
        coverage_status="supported",
    )

    def __init__(self, providers: Sequence[ProcurementProvider] = (_anac_provider, _ted_provider)) -> None:
        if not providers:
            raise ValueError("at least one procurement provider is required")
        self._providers = tuple(providers)

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        if not request.sectors:
            raise ValueError("Procurement discovery requires sector/contract keywords")
        offset = _cursor_offset(request.cursor)
        per_provider = min(100, max(request.requested_count * 2, 20))
        started = datetime.now(timezone.utc).isoformat()
        provider_results = [await provider(request, offset, per_provider) for provider in self._providers]
        observed = datetime.now(timezone.utc).isoformat()
        candidates: List[OpportunityCandidate] = []
        seen_entities: set[str] = set()
        seen_awards: set[str] = set()
        rejection_codes: List[str] = []
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
                official_domain = _domain(record.get("official_domain"))
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
                    why_now=f"Recent contract award {award_id}" + (f" worth EUR {amount:,.0f}" if amount else ""),
                    contacts=(),
                    confidence=0.98,
                    contradiction_flags=(),
                    provenance={"adapter_id": self.capability.adapter_id, "award_id": award_id, "authority": record.get("authority")},
                    adapter_id=self.capability.adapter_id,
                    adapter_version=self.capability.adapter_version,
                ))
                if len(candidates) >= request.requested_count:
                    break
            if len(candidates) >= request.requested_count:
                break
        target_reached = len(candidates) >= request.requested_count
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
            cost_eur=sum(result.cost_eur for result in provider_results),
            started_at=started,
            completed_at=observed,
            warnings=tuple(sorted(set(rejection_codes))),
        )
