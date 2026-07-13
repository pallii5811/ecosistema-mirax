"""Extract job/technology relationships from hiring postings.

Creates ``job`` entities, ``hires`` relationships, ``uses`` relationships
for required technologies, and ``new_hiring`` events.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from ..canonical import normalize_domain, slugify_name, slugify_technology
from ..models import UniverseEntity, UniverseEvent, UniverseObservation, UniverseRelationship
from ..repository import UniverseRepository, _event_dedup_key

logger = logging.getLogger(__name__)

# Conservative IT/tech skill vocabulary.  Kept small and deterministic.
TECH_SKILLS = frozenset(
    [
        "python",
        "javascript",
        "typescript",
        "java",
        "c#",
        "csharp",
        "go",
        "golang",
        "rust",
        "php",
        "ruby",
        "swift",
        "kotlin",
        "scala",
        "react",
        "angular",
        "vue",
        "svelte",
        "next.js",
        "node.js",
        "nodejs",
        "django",
        "flask",
        "fastapi",
        "spring",
        "laravel",
        "docker",
        "kubernetes",
        "terraform",
        "ansible",
        "aws",
        "azure",
        "gcp",
        "google cloud",
        "sql",
        "postgresql",
        "mysql",
        "mongodb",
        "redis",
        "elasticsearch",
        "snowflake",
        "databricks",
        "tableau",
        "power bi",
        "looker",
        "salesforce",
        "hubspot",
        "zoho",
        "sap",
        "wordpress",
        "shopify",
        "magento",
        "prestashop",
        "figma",
        "sketch",
        "adobe",
        "photoshop",
        "illustrator",
        "unity",
        "unreal engine",
        "machine learning",
        "deep learning",
        "tensorflow",
        "pytorch",
        "ai",
        "artificial intelligence",
        "nlp",
        "data engineering",
        "data science",
        "blockchain",
        "solidity",
        "ethereum",
    ]
)


def _extract_skills_from_text(text: str) -> List[str]:
    """Find known technology keywords in free text."""
    if not text:
        return []
    lowered = text.lower()
    found: List[str] = []
    for skill in TECH_SKILLS:
        pattern = r"(?:^|[\s,;()])" + re.escape(skill) + r"(?:$|[\s,;()])"
        if re.search(pattern, lowered):
            found.append(skill)
    return found


def _job_canonical_id(job: Dict[str, Any]) -> Optional[str]:
    url = str(job.get("url") or job.get("job_url") or "").strip()
    title = str(job.get("title") or job.get("job_title") or "").strip()
    if not title and not url:
        return None
    if url:
        norm = normalize_domain(url)
        if norm:
            # Include a hash of the title to distinguish multiple jobs on the same domain.
            slug = slugify_name(title) or "job"
            return f"job:{norm}:{slug}"
    return f"job:{slugify_name(title)}"


def _job_payload(job: Dict[str, Any]) -> Dict[str, Any]:
    """Payload used for the new_hiring event dedup key."""
    return {
        "job_title": job.get("title") or job.get("job_title"),
        "job_url": job.get("url") or job.get("job_url"),
        "job_location": job.get("location") or job.get("job_location"),
        "role": job.get("role"),
        "seniority": job.get("seniority"),
        "department": job.get("department"),
        "salary": job.get("salary"),
        "contract_type": job.get("contract_type"),
    }


def extract_job_relations(
    repo: UniverseRepository,
    company_id: str,
    jobs: List[Dict[str, Any]],
    source: str,
    observed_at: str,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship], List[UniverseEvent]]:
    """Extract job/technology relationships from a list of job postings.

    Returns (observations, relationships, events).
    """
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []
    events: List[UniverseEvent] = []

    if not jobs:
        return observations, relationships, events

    for job in jobs:
        if not isinstance(job, dict):
            continue
        title = str(job.get("title") or job.get("job_title") or "").strip()
        if not title:
            continue

        canonical = _job_canonical_id(job)
        if not canonical:
            continue

        job_url = str(job.get("url") or job.get("job_url") or "").strip()
        role = str(job.get("role") or "").strip()
        location = str(job.get("location") or job.get("job_location") or "").strip()
        department = str(job.get("department") or "").strip()
        seniority = str(job.get("seniority") or "").strip()
        salary = job.get("salary")
        contract_type = str(job.get("contract_type") or "").strip()
        job_source = str(job.get("source") or source or "").strip() or source

        job_entity, _ = repo.upsert_entity(
            UniverseEntity(
                canonical_id=canonical,
                entity_type="job",
                name=title,
                slug=slugify_name(title) or canonical,
                city=location or None,
                metadata={
                    "url": job_url or None,
                    "location": location or None,
                    "role": role or None,
                    "seniority": seniority or None,
                    "department": department or None,
                    "salary": salary,
                    "contract_type": contract_type or None,
                },
                confidence=0.85,
            )
        )

        relationships.append(
            UniverseRelationship(
                source_entity_id=company_id,
                target_entity_id=job_entity.id,
                relationship_type="hires",
                source=job_source,
                observed_at=observed_at,
                confidence=0.85,
                metadata={"title": title},
            )
        )

        if role:
            observations.append(
                UniverseObservation(
                    entity_id=job_entity.id,
                    attribute="role",
                    value=role,
                    source=job_source,
                    observed_at=observed_at,
                    confidence=0.85,
                )
            )

        # Required skills: explicit list or inferred from title/role.
        skills: List[str] = []
        raw_skills = job.get("skills") or job.get("required_skills") or []
        if isinstance(raw_skills, list):
            skills.extend(str(s).strip() for s in raw_skills if str(s).strip())
        elif isinstance(raw_skills, str):
            skills.extend(s.strip() for s in raw_skills.split(",") if s.strip())

        inferred = _extract_skills_from_text(" ".join(filter(None, [title, role, department])))
        for skill in inferred:
            if skill not in {s.lower() for s in skills}:
                skills.append(skill)

        for skill in skills:
            tech_slug = slugify_technology(skill)
            if not tech_slug:
                continue
            tech_entity, _ = repo.upsert_entity(
                UniverseEntity(
                    canonical_id=tech_slug,
                    entity_type="technology",
                    name=skill,
                    slug=tech_slug,
                    confidence=1.0,
                )
            )
            relationships.append(
                UniverseRelationship(
                    source_entity_id=company_id,
                    target_entity_id=tech_entity.id,
                    relationship_type="uses",
                    source=job_source,
                    observed_at=observed_at,
                    confidence=0.8,
                    metadata={"inferred_from": "job_posting"},
                )
            )

        payload = _job_payload(job)
        events.append(
            UniverseEvent(
                entity_id=company_id,
                event_type="new_hiring",
                payload=payload,
                source=job_source,
                occurred_at=observed_at,
                dedup_key=_event_dedup_key(company_id, "new_hiring", job_source, observed_at, payload),
            )
        )

    return observations, relationships, events
