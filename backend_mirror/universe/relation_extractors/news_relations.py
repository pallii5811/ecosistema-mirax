"""Extract B2B relationships from unstructured news text.

Uses deterministic regex and Italian legal-form heuristics only — no LLM.
The logic is conservative: it splits text into sentences, detects a small set
of business triggers inside each sentence, and links any plausible company
names found in the same sentence to the source company.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Iterable, List, Optional, Tuple

from ..canonical import normalize_domain, slugify_name
from ..models import UniverseEntity, UniverseObservation, UniverseRelationship
from ..repository import UniverseRepository

logger = logging.getLogger(__name__)

# Triggers: if any of these match a sentence, we look for target companies there.
TRIGGER_PATTERNS = {
    "partnership": re.compile(
        r"\b(?:partnership|accordo|alleanza|collaborazione|joint\s+venture)\b",
        re.IGNORECASE,
    ),
    "investment": re.compile(
        r"\b(?:investimento|finanziamento|round|ha\s+(?:ricevuto|ottenuto)\s+(?:un\s+)?(?:investimento|finanziamento))\b",
        re.IGNORECASE,
    ),
    "acquisition": re.compile(
        r"\b(?:ha\s+acquisito|acquisizione|acquirente|ha\s+comprato)\b",
        re.IGNORECASE,
    ),
    "supplies": re.compile(
        r"\b(?:fornisce\s+a|vende\s+a|ha\s+vinto\s+(?:gare\s+)?da|appalti\s+di)\b",
        re.IGNORECASE,
    ),
    "customer_of": re.compile(
        r"\b(?:è\s+cliente\s+di|cliente\s+di|si\s+affida\s+a|utilizza\s+.*\s+di)\b",
        re.IGNORECASE,
    ),
}

# Target company pattern: a proper-noun-ish token sequence ending with an
# Italian legal form (with or without dots).
TARGET_COMPANY = re.compile(
    r"[A-Z][A-Za-z0-9\s\.\-&\-'èéàòùì]+?"
    r"(?:s\.?r\.?l\.?(?:\s+s\.?u\.?)?|s\.?p\.?a\.?|s\.?r\.?l\.?s\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|"
    r"s\.?c\.?p\.?a\.?|s\.?c\.?a\.?r\.?l\.?|coop\.?(?:erativa)?|a\.?p\.?s\.?|e\.?t\.?s\.?|"
    r"onlus|srl|spa|srls|sas|snc|scpa|scarl|fondazione|consorzio)",
    re.IGNORECASE,
)


def _sentences(text: str) -> List[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def _extract_company_names(text: str) -> List[str]:
    names: List[str] = []
    seen: set = set()
    for match in TARGET_COMPANY.finditer(text):
        name = re.sub(r"[\.,;:\)\(\[\]\"\']+$", "", match.group(0).strip())
        if 3 <= len(name) <= 120:
            key = name.lower()
            if key not in seen:
                seen.add(key)
                names.append(name)
    return names


def _ensure_company_entity(
    repo: UniverseRepository,
    name: str,
    domain: Optional[str] = None,
    country: str = "IT",
    confidence: float = 0.65,
) -> Optional[UniverseEntity]:
    canonical = normalize_domain(domain) if domain else slugify_name(name)
    if not canonical:
        return None
    entity = UniverseEntity(
        canonical_id=canonical,
        entity_type="company",
        name=name,
        slug=slugify_name(name) or canonical,
        country=country,
        metadata={"inferred_from": "news_relations"},
        confidence=confidence,
    )
    return repo.upsert_entity(entity)[0]


def _ensure_investor_entity(
    repo: UniverseRepository,
    name: str,
) -> Optional[UniverseEntity]:
    canonical = f"investor:{slugify_name(name)}"
    if not canonical or canonical == "investor:":
        return None
    entity = UniverseEntity(
        canonical_id=canonical,
        entity_type="investor",
        name=name,
        slug=slugify_name(name) or canonical,
        metadata={"inferred_from": "news_relations"},
        confidence=0.65,
    )
    return repo.upsert_entity(entity)[0]


def extract_news_relations(
    repo: UniverseRepository,
    company_id: str,
    texts: Iterable[Any],
    source: str,
    observed_at: str,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    """Extract B2B relationships from news text.

    Parameters
    ----------
    texts
        Iterable of strings or dicts.  Dicts are joined from
        title/summary/text/content.
    source
        Source label for edges/observations.
    observed_at
        ISO timestamp.

    Returns
    -------
    (observations, relationships)
    """
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    for item in texts:
        if isinstance(item, dict):
            text = " ".join(
                str(v)
                for v in [
                    item.get("title"),
                    item.get("summary"),
                    item.get("text"),
                    item.get("content"),
                ]
                if v
            )
        else:
            text = str(item)
        text = text.strip()
        if not text:
            continue

        for sentence in _sentences(text):
            active_triggers = [
                name for name, pat in TRIGGER_PATTERNS.items() if pat.search(sentence)
            ]
            if not active_triggers:
                continue

            targets = _extract_company_names(sentence)
            for target_name in targets:
                # Skip self-references.
                target = _ensure_company_entity(repo, target_name, confidence=0.65)
                if not target or target.id == company_id:
                    continue

                meta = {"triggers": active_triggers, "sentence": sentence[:250]}

                for trigger in active_triggers:
                    if trigger == "partnership":
                        relationships.extend(
                            [
                                UniverseRelationship(
                                    source_entity_id=company_id,
                                    target_entity_id=target.id,
                                    relationship_type="partner_of",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.65,
                                    metadata=meta,
                                ),
                                UniverseRelationship(
                                    source_entity_id=target.id,
                                    target_entity_id=company_id,
                                    relationship_type="partner_of",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.65,
                                    metadata=meta,
                                ),
                            ]
                        )
                    elif trigger == "investment":
                        investor = _ensure_investor_entity(repo, target_name)
                        if not investor:
                            continue
                        relationships.extend(
                            [
                                UniverseRelationship(
                                    source_entity_id=company_id,
                                    target_entity_id=investor.id,
                                    relationship_type="received_investment_from",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.65,
                                    metadata=meta,
                                ),
                                UniverseRelationship(
                                    source_entity_id=investor.id,
                                    target_entity_id=company_id,
                                    relationship_type="invested_in",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.65,
                                    metadata=meta,
                                ),
                            ]
                        )
                    elif trigger == "acquisition":
                        relationships.append(
                            UniverseRelationship(
                                source_entity_id=company_id,
                                target_entity_id=target.id,
                                relationship_type="owns",
                                source=source,
                                observed_at=observed_at,
                                confidence=0.6,
                                metadata=meta,
                            )
                        )
                    elif trigger == "supplies":
                        relationships.extend(
                            [
                                UniverseRelationship(
                                    source_entity_id=company_id,
                                    target_entity_id=target.id,
                                    relationship_type="has_customer",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.6,
                                    metadata=meta,
                                ),
                                UniverseRelationship(
                                    source_entity_id=target.id,
                                    target_entity_id=company_id,
                                    relationship_type="customer_of",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.6,
                                    metadata=meta,
                                ),
                            ]
                        )
                    elif trigger == "customer_of":
                        relationships.extend(
                            [
                                UniverseRelationship(
                                    source_entity_id=company_id,
                                    target_entity_id=target.id,
                                    relationship_type="customer_of",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.6,
                                    metadata=meta,
                                ),
                                UniverseRelationship(
                                    source_entity_id=target.id,
                                    target_entity_id=company_id,
                                    relationship_type="has_customer",
                                    source=source,
                                    observed_at=observed_at,
                                    confidence=0.6,
                                    metadata=meta,
                                ),
                            ]
                        )

    return observations, relationships
