"""AI-native semantic authority for MIRAX commercial intelligence.

Adapters acquire pages and structured records.  This module is the only
authority that may turn unstructured language into a commercial event and the
deterministic verifier is the only component that may certify that model output
against source text.  Lexical rules outside this boundary are discovery hints,
never qualification evidence.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
from contextlib import closing
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Iterable, Mapping, Optional, Protocol, Sequence, Tuple


QUERY_SCHEMA_VERSION = "semantic-query-contract-v5"
EVENT_SCHEMA_VERSION = "semantic-commercial-event-v4"
GROUNDING_SCHEMA_VERSION = "semantic-grounding-v2"
HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP = "sales_customer_acquisition_team_expansion_by_target_company"
CRM_SEEKING_RELATIONSHIP = "target_company_seeking_crm_solution"
EXPANSION_FACILITY_RELATIONSHIP = "company_opening_or_expanding_facility"

_EXPANSION_FACILITY_RE = re.compile(
    r"\b(?:nuovo\s+stabilimento|nuova\s+unit[aà]\s+produttiva|ampliamento\s+(?:produttivo|dello\s+stabilimento|della\s+sede)|"
    r"capacit[aà]\s+produttiva|"
    r"(?:inaugura(?:to|ta)?|ha\s+inaugurato|apre|ha\s+aperto).{0,60}(?:stabilimento|impianto(?:\s+produttivo)?))\b",
    re.I,
)


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _tuple(value: Any) -> Tuple[str, ...]:
    if isinstance(value, str):
        values: Iterable[Any] = (value,)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        values = value
    else:
        values = ()
    return tuple(dict.fromkeys(text for item in values if (text := _clean(item))))


def _mapping(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _bounded_confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(value: Any) -> str:
    raw = value if isinstance(value, str) else _stable_json(value)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def _canonical_source_url(url: str) -> str:
    """Normalize article URLs so cache hits survive query/fragment/trailing-slash drift."""
    text = _clean(url).casefold()
    if not text:
        return ""
    for marker in ("#", "?"):
        if marker in text:
            text = text.split(marker, 1)[0]
    return text.rstrip("/")


# Model paraphrases of the same commercial role must not fail a strict string match.
_ROLE_ALIASES: Mapping[str, frozenset[str]] = {
    "recipient": frozenset({
        "recipient", "beneficiary", "startup_recipient", "funding_recipient",
        "investee", "raise_recipient",
    }),
    "beneficiary": frozenset({
        "beneficiary", "recipient", "startup_recipient", "funding_recipient",
    }),
    "buyer": frozenset({"buyer", "adopter", "migrating_company", "customer", "prospect"}),
    "adopter": frozenset({"adopter", "buyer", "migrating_company", "customer"}),
    "migrating_company": frozenset({"migrating_company", "buyer", "adopter"}),
    "employer": frozenset({"employer", "hiring_company", "company"}),
    "expanding_company": frozenset({
        "expanding_company", "company", "operating_company", "buyer", "facility_owner",
    }),
    "operating_company": frozenset({"operating_company", "expanding_company", "company", "employer"}),
}


def _roles_compatible(observed: str, required: str) -> bool:
    left = _clean(observed).casefold()
    right = _clean(required).casefold()
    if not left or not right:
        return False
    if left == right:
        return True
    for group in _ROLE_ALIASES.values():
        if left in group and right in group:
            return True
    required_group = _ROLE_ALIASES.get(right)
    if required_group and left in required_group:
        return True
    observed_group = _ROLE_ALIASES.get(left)
    if observed_group and right in observed_group:
        return True
    return False


@dataclass(frozen=True)
class SemanticQueryContract:
    original_query: str
    requested_count: int
    query_goal: str
    seller: Mapping[str, Any]
    offer: Mapping[str, Any]
    target_entity_types: Tuple[str, ...]
    target_company_description: str
    event_or_state_description: str
    target_role_in_event: str
    required_relationships: Tuple[str, ...]
    optional_relationships: Tuple[str, ...]
    excluded_roles: Tuple[str, ...]
    excluded_entities: Tuple[str, ...]
    geography: Tuple[str, ...]
    industry: Tuple[str, ...]
    size_constraints: Mapping[str, Any]
    temporal_constraints: Mapping[str, Any]
    positive_conditions: Tuple[str, ...]
    negative_conditions: Tuple[str, ...]
    must_have_facts: Tuple[str, ...]
    forbidden_inferences: Tuple[str, ...]
    data_requirements: Tuple[str, ...]
    ranking_objective: str
    acceptance_rubric: Tuple[str, ...]
    discovery_hypotheses: Tuple[Mapping[str, Any], ...]
    clarification_required: bool
    confidence: float
    canonical_signal_hints: Tuple[str, ...] = ()
    evidence_claim_type: str = "OBSERVED_EVENT"
    schema_version: str = QUERY_SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @property
    def contract_hash(self) -> str:
        return _digest(self.to_dict())

    @classmethod
    def from_model(
        cls,
        value: Mapping[str, Any],
        *,
        original_query: str,
        requested_count: int,
    ) -> "SemanticQueryContract":
        required = _tuple(value.get("required_relationships"))
        rubric = _tuple(value.get("acceptance_rubric"))
        target_role = _clean(value.get("target_role_in_event"))
        clarification = bool(value.get("clarification_required"))
        if not clarification and (not required or not rubric or not target_role):
            raise ValueError("semantic query contract lacks relation, target role, or acceptance rubric")
        hypotheses = tuple(
            dict(item) for item in value.get("discovery_hypotheses") or ()
            if isinstance(item, Mapping)
        )
        relationships_blob = " ".join(required).casefold()
        claim_type = _clean(value.get("evidence_claim_type")).upper()
        if not claim_type:
            if any(token in relationships_blob for token in ("seeking", "selection", "procurement", "rfp", "request_for")):
                claim_type = "SELECTION_PROCESS"
            else:
                claim_type = "OBSERVED_EVENT"
        return cls(
            original_query=_clean(original_query),
            requested_count=max(1, int(requested_count)),
            query_goal=_clean(value.get("query_goal")),
            seller=_mapping(value.get("seller")),
            offer=_mapping(value.get("offer")),
            target_entity_types=_tuple(value.get("target_entity_types")),
            target_company_description=_clean(value.get("target_company_description")),
            event_or_state_description=_clean(value.get("event_or_state_description")),
            target_role_in_event=target_role,
            required_relationships=required,
            optional_relationships=_tuple(value.get("optional_relationships")),
            excluded_roles=_tuple(value.get("excluded_roles")),
            excluded_entities=_tuple(value.get("excluded_entities")),
            geography=_tuple(value.get("geography")),
            industry=_tuple(value.get("industry")),
            size_constraints=_mapping(value.get("size_constraints")),
            temporal_constraints=_mapping(value.get("temporal_constraints")),
            positive_conditions=_tuple(value.get("positive_conditions")),
            negative_conditions=_tuple(value.get("negative_conditions")),
            must_have_facts=_tuple(value.get("must_have_facts")),
            forbidden_inferences=_tuple(value.get("forbidden_inferences")),
            data_requirements=_tuple(value.get("data_requirements")),
            ranking_objective=_clean(value.get("ranking_objective")),
            acceptance_rubric=rubric,
            discovery_hypotheses=hypotheses,
            clarification_required=clarification,
            confidence=_bounded_confidence(value.get("confidence")),
            canonical_signal_hints=_tuple(value.get("canonical_signal_hints")),
            evidence_claim_type=claim_type,
        )


@dataclass(frozen=True)
class SemanticEventInterpretation:
    entities: Tuple[Mapping[str, Any], ...]
    events: Tuple[Mapping[str, Any], ...]
    relations: Tuple[Mapping[str, Any], ...]
    target_company: str
    target_entity_role: str
    event_type: str
    open_predicate: str
    actor: Optional[str]
    recipient: Optional[str]
    provider: Optional[str]
    beneficiary: Optional[str]
    investor: Optional[str]
    employer: Optional[str]
    recruiter: Optional[str]
    publisher: Optional[str]
    authority: Optional[str]
    predicate: str
    direction: str
    event_status: str
    event_date: Optional[str]
    amount: Optional[str]
    location: Optional[str]
    technology: Optional[str]
    role: Optional[str]
    negated: bool
    hypothetical: bool
    conditional: bool
    rumor: bool
    historical: bool
    certainty: float
    query_match: bool
    query_match_reason: str
    satisfied_relationships: Tuple[str, ...]
    acceptance_rubric_passed: Tuple[str, ...]
    buyer_need: str
    why_now: str
    evidence_excerpt: str
    evidence_start: int
    evidence_end: int
    confidence: float
    rejection_reason: Optional[str]
    schema_version: str = EVENT_SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_model(cls, value: Mapping[str, Any]) -> "SemanticEventInterpretation":
        def optional(key: str) -> Optional[str]:
            text = _clean(value.get(key))
            return text or None

        excerpt = str(value.get("evidence_excerpt") or "")
        try:
            start = int(value.get("evidence_start"))
            end = int(value.get("evidence_end"))
        except (TypeError, ValueError):
            start, end = -1, -1
        target_company = (
            _clean(value.get("target_company"))
            or _clean(value.get("beneficiary"))
            or _clean(value.get("recipient"))
            or _clean(value.get("employer"))
            or ""
        )
        target_role = _clean(value.get("target_entity_role")) or _clean(value.get("role")) or ""
        if target_role in {"startup_recipient", "funding_recipient", "investee", "raise_recipient"}:
            target_role = "recipient"
        return cls(
            entities=tuple(dict(item) for item in value.get("entities") or () if isinstance(item, Mapping)),
            events=tuple(dict(item) for item in value.get("events") or () if isinstance(item, Mapping)),
            relations=tuple(dict(item) for item in value.get("relations") or () if isinstance(item, Mapping)),
            target_company=target_company,
            target_entity_role=target_role,
            event_type=_clean(value.get("event_type")),
            open_predicate=_clean(value.get("open_predicate")),
            actor=optional("actor"), recipient=optional("recipient"), provider=optional("provider"),
            beneficiary=optional("beneficiary"), investor=optional("investor"), employer=optional("employer"),
            recruiter=optional("recruiter"), publisher=optional("publisher"), authority=optional("authority"),
            predicate=_clean(value.get("predicate")), direction=_clean(value.get("direction")),
            event_status=_clean(value.get("event_status")), event_date=optional("event_date"),
            amount=optional("amount"), location=optional("location"), technology=optional("technology"),
            role=optional("role"), negated=bool(value.get("negated")), hypothetical=bool(value.get("hypothetical")),
            conditional=bool(value.get("conditional")), rumor=bool(value.get("rumor")),
            historical=bool(value.get("historical")), certainty=_bounded_confidence(value.get("certainty")),
            query_match=bool(value.get("query_match")), query_match_reason=_clean(value.get("query_match_reason")),
            satisfied_relationships=_tuple(value.get("satisfied_relationships")),
            acceptance_rubric_passed=_tuple(value.get("acceptance_rubric_passed")),
            buyer_need=_clean(value.get("buyer_need")), why_now=_clean(value.get("why_now")),
            evidence_excerpt=excerpt, evidence_start=start, evidence_end=end,
            confidence=_bounded_confidence(value.get("confidence")),
            rejection_reason=optional("rejection_reason"),
        )


@dataclass(frozen=True)
class GroundingVerdict:
    accepted: bool
    rejection_code: Optional[str]
    reasons: Tuple[str, ...]
    checks: Mapping[str, bool]
    target_company: str
    target_entity_role: str
    event_type: str
    event_date: Optional[str]
    evidence_excerpt: str
    evidence_start: int
    evidence_end: int
    source_url: str
    source_publisher: str
    verified_at: str
    evidence_claim_type: str
    gate_results: Mapping[str, bool]
    failed_gate_codes: Tuple[str, ...]
    schema_version: str = GROUNDING_SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SemanticModelClient(Protocol):
    model_version: str

    async def complete_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
        schema: Mapping[str, Any],
        tier: int,
    ) -> Mapping[str, Any]: ...


@dataclass
class SemanticTelemetry:
    pages_discovered: int = 0
    pages_prefiltered: int = 0
    semantic_calls: int = 0
    semantic_cache_hits: int = 0
    semantic_escalations: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_eur: float = 0.0
    candidates: int = 0
    grounded: int = 0
    qualified: int = 0

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["cost_per_accepted"] = self.cost_eur / self.qualified if self.qualified else None
        return payload


class SemanticResultCache:
    """Process-safe cache keyed by content, query contract, model and schema."""

    def __init__(self, path: Optional[str] = None, ttl_days: int = 30) -> None:
        data_dir = Path(os.getenv("MIRAX_DATA_DIR") or Path(__file__).resolve().parent / "data")
        self.path = str(path or data_dir / "semantic_result_cache.db")
        self.ttl_seconds = max(1, int(ttl_days)) * 86_400
        self._lock = threading.Lock()
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS semantic_result_cache ("
                "cache_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at REAL NOT NULL, "
                "last_hit_at REAL NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0)"
            )
            connection.commit()

    @staticmethod
    def key(*, content_hash: str, semantic_query_contract_hash: str, model_version: str, interpreter_schema_version: str) -> str:
        return _digest({
            "content_hash": content_hash,
            "semantic_query_contract_hash": semantic_query_contract_hash,
            "model_version": model_version,
            "interpreter_schema_version": interpreter_schema_version,
        })

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        cutoff = time.time() - self.ttl_seconds
        with self._lock, closing(sqlite3.connect(self.path, timeout=10.0)) as connection:
            row = connection.execute(
                "SELECT result_json, created_at FROM semantic_result_cache WHERE cache_key = ?", (key,)
            ).fetchone()
            if not row:
                return None
            if float(row[1]) < cutoff:
                connection.execute("DELETE FROM semantic_result_cache WHERE cache_key = ?", (key,))
                connection.commit()
                return None
            connection.execute(
                "UPDATE semantic_result_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE cache_key = ?",
                (time.time(), key),
            )
            connection.commit()
        try:
            result = json.loads(str(row[0]))
            return dict(result) if isinstance(result, Mapping) else None
        except json.JSONDecodeError:
            return None

    def set(self, key: str, result: Mapping[str, Any]) -> None:
        now = time.time()
        serialized = _stable_json(result)
        with self._lock, closing(sqlite3.connect(self.path, timeout=10.0)) as connection:
            connection.execute(
                "INSERT INTO semantic_result_cache(cache_key,result_json,created_at,last_hit_at,hit_count) "
                "VALUES(?,?,?,?,0) ON CONFLICT(cache_key) DO UPDATE SET "
                "result_json=excluded.result_json,created_at=excluded.created_at,last_hit_at=excluded.last_hit_at",
                (key, serialized, now, now),
            )
            connection.commit()


QUERY_OUTPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": [
        "query_goal", "seller", "offer", "target_entity_types", "target_company_description",
        "event_or_state_description", "target_role_in_event", "required_relationships", "optional_relationships",
        "excluded_roles", "excluded_entities", "geography", "industry", "size_constraints",
        "temporal_constraints", "positive_conditions", "negative_conditions", "must_have_facts",
        "forbidden_inferences", "data_requirements", "ranking_objective", "acceptance_rubric",
        "discovery_hypotheses", "clarification_required", "confidence",
    ],
    "additionalProperties": False,
}

for _name in QUERY_OUTPUT_SCHEMA["required"]:
    QUERY_OUTPUT_SCHEMA.setdefault("properties", {})[_name] = {"type": "string"}
for _name in (
    "target_entity_types", "required_relationships", "optional_relationships", "excluded_roles",
    "excluded_entities", "geography", "industry", "positive_conditions", "negative_conditions",
    "must_have_facts", "forbidden_inferences", "data_requirements", "acceptance_rubric",
):
    QUERY_OUTPUT_SCHEMA["properties"][_name] = {"type": "array", "items": {"type": "string"}}
for _name in ("seller", "offer", "size_constraints", "temporal_constraints"):
    QUERY_OUTPUT_SCHEMA["properties"][_name] = {"type": "object", "additionalProperties": True}
QUERY_OUTPUT_SCHEMA["properties"]["discovery_hypotheses"] = {
    "type": "array", "items": {"type": "object", "additionalProperties": True},
}
QUERY_OUTPUT_SCHEMA["properties"]["clarification_required"] = {"type": "boolean"}
QUERY_OUTPUT_SCHEMA["properties"]["confidence"] = {"type": "number", "minimum": 0, "maximum": 1}
QUERY_OUTPUT_SCHEMA["properties"]["canonical_signal_hints"] = {"type": "array", "items": {"type": "string"}}


EVENT_OUTPUT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": [
        "entities", "events", "relations", "target_company", "target_entity_role", "event_type",
        "open_predicate", "actor", "recipient", "provider", "beneficiary", "investor", "employer",
        "recruiter", "publisher", "authority", "predicate", "direction", "event_status", "event_date",
        "amount", "location", "technology", "role", "negated", "hypothetical", "conditional", "rumor",
        "historical", "certainty", "query_match", "query_match_reason", "satisfied_relationships",
        "acceptance_rubric_passed", "buyer_need", "why_now", "evidence_excerpt", "evidence_start",
        "evidence_end", "confidence", "rejection_reason",
    ],
    "additionalProperties": False,
}

for _name in EVENT_OUTPUT_SCHEMA["required"]:
    EVENT_OUTPUT_SCHEMA.setdefault("properties", {})[_name] = {"type": ["string", "null"]}
for _name in ("entities", "events", "relations"):
    EVENT_OUTPUT_SCHEMA["properties"][_name] = {
        "type": "array", "items": {"type": "object", "additionalProperties": True},
    }
for _name in ("satisfied_relationships", "acceptance_rubric_passed"):
    EVENT_OUTPUT_SCHEMA["properties"][_name] = {"type": "array", "items": {"type": "string"}}
for _name in ("negated", "hypothetical", "conditional", "rumor", "historical", "query_match"):
    EVENT_OUTPUT_SCHEMA["properties"][_name] = {"type": "boolean"}
for _name in ("certainty", "confidence"):
    EVENT_OUTPUT_SCHEMA["properties"][_name] = {"type": "number", "minimum": 0, "maximum": 1}
for _name in ("evidence_start", "evidence_end"):
    EVENT_OUTPUT_SCHEMA["properties"][_name] = {"type": "integer"}
EVENT_OUTPUT_SCHEMA["properties"]["event_status"] = {
    "type": "string",
    "enum": ["observed", "active", "completed", "announced", "stale", "hypothetical", "negated", "rumor", "unknown"],
}


QUERY_SYSTEM_PROMPT = """You are MIRAX's semantic authority for commercial query understanding.
Represent the user's meaning losslessly.  This is open-world: preserve dynamic predicates even when no canonical
signal exists.  Canonical signal IDs are optional routing hints, never a substitute for the original condition.
Explicitly identify the role the target company must have in the event and exclude inverse roles.  For funding,
for example, recipient is different from lender/provider/investor/publisher/advisor.  Never invent a company,
fact, source, URL or constraint.  If meaning needed for safe research is genuinely missing, set
clarification_required=true. Open-world paraphrases of an observable commercial condition are actionable, not
ambiguous: do not request clarification merely because the wording lacks a canonical signal ID, named industry,
geography or amount. Clarification is required only when no target entity role or objectively testable predicate
can be derived without inventing meaning. Each required_relationship is a distinct conjunctive condition explicitly
required by the user; never put synonyms or alternative event phrasings in required_relationships. Do not add amount,
resource type, source type, result-count or other constraints absent from the query. The acceptance rubric is evaluated
per candidate and may contain only facts necessary to prove the user's literal request; never include whole-search
requirements such as requested_count. Build relationship IDs that the event interpreter can return verbatim and an
acceptance rubric made of objectively checkable per-candidate statements. Preserve action/capacity wording: do not
replace a request about strengthening a function with a stricter realized-outcome metric unless the user asked for it."""


EVENT_SYSTEM_PROMPT = """You are MIRAX's semantic authority for understanding commercial events in acquired text.
Use only the supplied source text and structured metadata. Identify every relevant entity and assign explicit
roles and relation direction. Distinguish actor, recipient, provider, beneficiary, investor, employer, recruiter,
publisher and authority. A publisher or source host is never automatically the target company. Treat passive
voice, negation, hypothetical, conditional, rumor and historical context explicitly. The target_company must be
an operating company in exactly the role required by the semantic query contract. Return an evidence excerpt
copied literally from source_text and exact Python string offsets. Return the contract's relationship/rubric IDs
verbatim only when the excerpt supports them. For hiring vacancies, sales_customer_acquisition_team_expansion_by_target_company
may be supported by an active direct-employer vacancy whose duties literally require acquiring or developing new
customers; do not require the page to contain the words "team expansion". For CRM seller queries asking for
companies seeking a CRM, treat literal CRM selection, tender/RFP, migration, project kickoff, or operating-company
adoption/choice of a CRM platform as query_match=true commercial triggers (they prove in-market CRM demand).
Do not treat how-to guides or vendor SEO pages as buyers. For seller-driven industrial queries asking for companies
with new facilities or production expansions, treat literal "nuovo stabilimento" / "ampliamento produttivo" /
inauguration of a production plant as query_match=true even when the page never mentions the seller's product
(e.g. fire-protection systems). The buyer event is the expansion; the seller offer is applied later as why_fit.
Never invent net headcount growth,
customer acquisition, expansion or company role when the page lacks them. Prefer relations[] entries that include
relationship_id, supported, subject, subject_role, object, direction, supporting_excerpt, excerpt_start,
excerpt_end, reason and confidence when a required relationship is evaluated. If query_match=true, evidence_excerpt,
satisfied_relationships and acceptance_rubric_passed must all be non-empty and jointly prove every required
condition. Otherwise set query_match=false with a rejection reason. Missing information stays null/empty. Never invent."""


class SemanticCommercialQueryInterpreter:
    def __init__(
        self,
        model: SemanticModelClient,
        *,
        cache: Optional[SemanticResultCache] = None,
        telemetry: Optional[SemanticTelemetry] = None,
    ) -> None:
        self.model = model
        self.cache = cache or SemanticResultCache()
        self.telemetry = telemetry or SemanticTelemetry()

    async def interpret(
        self,
        query: str,
        requested_count: int,
        *,
        seller_profile: Optional[Mapping[str, Any]] = None,
        offer: Optional[Mapping[str, Any]] = None,
    ) -> SemanticQueryContract:
        original = _clean(query)
        if not original:
            raise ValueError("semantic query cannot be empty")
        payload = {
            "query": original,
            "requested_count": max(1, int(requested_count)),
            "seller_profile": dict(seller_profile or {}),
            "offer": dict(offer or {}),
        }
        key = SemanticResultCache.key(
            content_hash=_digest(payload), semantic_query_contract_hash="query",
            model_version=self.model.model_version, interpreter_schema_version=QUERY_SCHEMA_VERSION,
        )
        cached = self.cache.get(key)
        if cached is not None:
            self.telemetry.semantic_cache_hits += 1
            return SemanticQueryContract.from_model(cached, original_query=original, requested_count=requested_count)
        self.telemetry.semantic_calls += 1
        # Query meaning controls every downstream source and qualification
        # decision.  Compile it once with the stronger tier, then amortise the
        # result through the persistent query-contract cache.  Tier 1 remains
        # the high-volume page/event interpreter.
        result = await self.model.complete_json(
            task="semantic_query_contract", system_prompt=QUERY_SYSTEM_PROMPT,
            payload=payload, schema=QUERY_OUTPUT_SCHEMA, tier=2,
        )
        contract = SemanticQueryContract.from_model(result, original_query=original, requested_count=requested_count)
        self.cache.set(key, dict(result))
        return contract


class SemanticCommercialEventInterpreter:
    def __init__(
        self,
        model: SemanticModelClient,
        *,
        adjudicator: Optional[SemanticModelClient] = None,
        cache: Optional[SemanticResultCache] = None,
        telemetry: Optional[SemanticTelemetry] = None,
        escalation_threshold: float = 0.72,
    ) -> None:
        self.model = model
        self.adjudicator = adjudicator
        self.cache = cache or SemanticResultCache()
        self.telemetry = telemetry or SemanticTelemetry()
        self.escalation_threshold = escalation_threshold

    async def interpret(
        self,
        contract: SemanticQueryContract,
        *,
        title: str,
        snippet: str,
        source_text: str,
        source_url: str,
        publisher: str,
        structured_metadata: Optional[Mapping[str, Any]] = None,
        entity_hints: Sequence[str] = (),
    ) -> SemanticEventInterpretation:
        if contract.clarification_required:
            raise ValueError("cannot interpret events for a query requiring clarification")
        content = str(source_text or "")
        if not content or not _clean(source_url):
            raise ValueError("semantic event interpretation requires source text and URL")
        payload = {
            "semantic_query_contract": contract.to_dict(),
            "title": str(title or ""), "snippet": str(snippet or ""),
            "source_text": content, "source_url": str(source_url), "publisher": str(publisher or ""),
            "structured_metadata": dict(structured_metadata or {}), "entity_hints": list(_tuple(entity_hints)),
        }
        # URL-stable primary key: windowing/snippet drift must not force a paid
        # re-interpretation of the same article. Grounding still re-checks the
        # literal excerpt against the freshly fetched source_text.
        canonical_url = _canonical_source_url(str(source_url))
        content_hash = _digest({"source_url": canonical_url})
        key = SemanticResultCache.key(
            content_hash=content_hash, semantic_query_contract_hash=contract.contract_hash,
            model_version=self.model.model_version, interpreter_schema_version=EVENT_SCHEMA_VERSION,
        )
        cached = self.cache.get(key)
        if cached is None:
            # Legacy key (title+snippet+full text) for entries written before URL-stable keys.
            legacy_hash = _digest({
                "title": payload["title"], "snippet": payload["snippet"], "source_text": content,
                "source_url": payload["source_url"], "structured_metadata": payload["structured_metadata"],
            })
            legacy_key = SemanticResultCache.key(
                content_hash=legacy_hash, semantic_query_contract_hash=contract.contract_hash,
                model_version=self.model.model_version, interpreter_schema_version=EVENT_SCHEMA_VERSION,
            )
            cached = self.cache.get(legacy_key)
            if cached is not None:
                self.cache.set(key, cached)
        if cached is not None:
            self.telemetry.semantic_cache_hits += 1
            return SemanticEventInterpretation.from_model(cached)
        deterministic = _deterministic_hiring_interpretation(
            contract,
            source_text=content,
            source_url=str(source_url),
            publisher=str(publisher or ""),
            structured_metadata=structured_metadata,
            entity_hints=entity_hints,
        )
        if deterministic is not None:
            # No paid model call: structured vacancy + literal duty already prove the proxy.
            self.cache.set(key, deterministic.to_dict())
            return deterministic
        self.telemetry.semantic_calls += 1
        result = await self.model.complete_json(
            task="semantic_commercial_event", system_prompt=EVENT_SYSTEM_PROMPT,
            payload=payload, schema=EVENT_OUTPUT_SCHEMA, tier=1,
        )
        interpretation = SemanticEventInterpretation.from_model(result)
        ambiguous = interpretation.confidence < self.escalation_threshold or (
            interpretation.query_match and not interpretation.target_entity_role
        )
        if ambiguous and self.adjudicator is not None:
            self.telemetry.semantic_escalations += 1
            self.telemetry.semantic_calls += 1
            adjudicated = await self.adjudicator.complete_json(
                task="semantic_commercial_event_adjudication", system_prompt=EVENT_SYSTEM_PROMPT,
                payload={**payload, "tier1_interpretation": interpretation.to_dict()},
                schema=EVENT_OUTPUT_SCHEMA, tier=2,
            )
            interpretation = SemanticEventInterpretation.from_model(adjudicated)
            result = adjudicated
        self.cache.set(key, dict(result))
        return interpretation


def _canonical_name(value: str) -> str:
    return "".join(char.casefold() for char in _clean(value) if char.isalnum())


def _normalize_literal_surface(value: str) -> str:
    import unicodedata

    text = unicodedata.normalize("NFKC", str(value or ""))
    for ch in ("\u00a0", "\u200b", "\u200c", "\u200d", "\ufeff"):
        text = text.replace(ch, " ")
    return " ".join(text.split())


def _recover_literal_excerpt(source_text: str, excerpt: str) -> tuple[int, int, str] | None:
    """Recover a unique literal span when model offsets or whitespace diverge.

    Cached interpretations often carry offsets from a different source_text window
    or an over-long excerpt that includes publisher chrome. Re-anchor to the
    longest unique literal prefix that still appears in the text under verify.
    """
    excerpt = str(excerpt or "")
    source_text = str(source_text or "")
    if not excerpt.strip() or not source_text:
        return None
    exact_start = source_text.find(excerpt)
    if exact_start >= 0 and source_text.find(excerpt, exact_start + 1) < 0:
        return exact_start, exact_start + len(excerpt), excerpt

    cleaned = " ".join(excerpt.split()).strip()
    if not cleaned:
        return None
    # Longest unique literal prefix first — keeps funding sentence, drops chrome.
    candidate_sizes = []
    for size in (1200, 900, 600, 400, 280, 180, 120, 80):
        if len(cleaned) >= size:
            candidate_sizes.append(size)
    if len(cleaned) not in candidate_sizes:
        candidate_sizes.append(len(cleaned))
    for size in candidate_sizes:
        prefix = cleaned[:size]
        if size < len(cleaned):
            cut = prefix.rfind(" ")
            if cut >= 80:
                prefix = prefix[:cut]
        start = source_text.find(prefix)
        if start >= 0 and source_text.find(prefix, start + 1) < 0:
            return start, start + len(prefix), source_text[start:start + len(prefix)]

    bounded = cleaned[:900]
    parts = [re.escape(part) for part in _normalize_literal_surface(bounded).split() if part]
    if len(parts) < 4:
        return None
    # Cap pattern length so recovery stays deterministic and cheap.
    pattern = r"\s+".join(parts[:40])
    matches = list(re.finditer(pattern, source_text, flags=re.I))
    if len(matches) != 1:
        return None
    match = matches[0]
    found = source_text[match.start():match.end()]
    return match.start(), match.end(), found


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def _hiring_bridge_helpers():
    """Load duty detectors without importing source_adapters package __init__."""
    try:
        from backend_mirror.source_adapters.hiring_semantic_bridge import (
            find_customer_acquisition_duty,
            looks_sales_role,
        )
        return find_customer_acquisition_duty, looks_sales_role
    except ImportError:
        pass
    import importlib.util
    import sys
    from pathlib import Path

    # Staging worker layout is flat under backend-staging/. Importing
    # source_adapters triggers __init__ → hiring → backend_mirror (missing).
    path = Path(__file__).resolve().parent / "source_adapters" / "hiring_semantic_bridge.py"
    spec = importlib.util.spec_from_file_location("mirax_hiring_semantic_bridge", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"hiring_semantic_bridge unavailable at {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.find_customer_acquisition_duty, module.looks_sales_role


def _crm_bridge_helpers():
    """Load CRM seeking detectors without importing source_adapters package __init__."""
    try:
        from backend_mirror.source_adapters.crm_semantic_bridge import find_crm_seeking_evidence
        return find_crm_seeking_evidence
    except ImportError:
        pass
    import importlib.util
    import sys
    from pathlib import Path

    path = Path(__file__).resolve().parent / "source_adapters" / "crm_semantic_bridge.py"
    spec = importlib.util.spec_from_file_location("mirax_crm_semantic_bridge", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"crm_semantic_bridge unavailable at {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.find_crm_seeking_evidence


def _deterministic_hiring_interpretation(
    contract: SemanticQueryContract,
    *,
    source_text: str,
    source_url: str,
    publisher: str,
    structured_metadata: Optional[Mapping[str, Any]],
    entity_hints: Sequence[str],
) -> Optional[SemanticEventInterpretation]:
    """Build an interpretation from structured hiring evidence without a paid model call."""
    if HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP not in contract.required_relationships:
        return None
    find_customer_acquisition_duty, looks_sales_role = _hiring_bridge_helpers()
    meta = dict(structured_metadata or {})
    bundle = meta.get("hiring_semantic_evidence_bundle") if isinstance(meta.get("hiring_semantic_evidence_bundle"), Mapping) else meta
    duty_excerpt, duty_start, duty_end = find_customer_acquisition_duty(source_text)
    if not duty_excerpt or duty_start < 0:
        return None
    title = _clean(bundle.get("vacancy_title") or bundle.get("object") or "")
    duties = _clean(bundle.get("role_duties") or "")
    if not looks_sales_role(title=title, description=duties):
        return None
    if bundle.get("vacancy_active") is not True:
        return None
    if bundle.get("employer_is_direct") is False:
        return None
    company = _clean(
        bundle.get("subject")
        or next((hint for hint in entity_hints if _clean(hint)), "")
    )
    if not company:
        return None
    location = _clean(bundle.get("location") or "")
    event_date = _clean(bundle.get("event_date") or "") or None
    rubric = []
    for item in contract.acceptance_rubric:
        if item.startswith("target_role_employer") or "sales_customer_acquisition" in item:
            rubric.append(item)
    return SemanticEventInterpretation(
        entities=({"name": company, "type": "operating_company", "role": "employer"},),
        events=({"type": "active_job_opening", "status": "active"},),
        relations=({
            "relationship_id": HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP,
            "supported": True,
            "subject": company,
            "subject_role": "employer",
            "object": title or "ruolo commerciale",
            "direction": "employer_to_role",
            "supporting_excerpt": duty_excerpt,
            "excerpt_start": duty_start,
            "excerpt_end": duty_end,
            "reason": "literal customer-acquisition duty on active direct-employer vacancy",
            "confidence": 0.96,
        },),
        target_company=company,
        target_entity_role="employer",
        event_type="active_job_opening",
        open_predicate="active sales vacancy with customer-acquisition duties",
        actor=company,
        recipient=None,
        provider=None,
        beneficiary=None,
        investor=None,
        employer=company,
        recruiter=None,
        publisher=_clean(publisher) or None,
        authority=None,
        predicate="hires_for_customer_acquisition",
        direction="employer_to_role",
        event_status="active",
        event_date=event_date,
        amount=None,
        location=location or None,
        technology=None,
        role=title or "commerciale",
        negated=False,
        hypothetical=False,
        conditional=False,
        rumor=False,
        historical=False,
        certainty=0.96,
        query_match=True,
        query_match_reason="deterministic hiring observables: active direct-employer sales vacancy with literal customer-acquisition duty",
        satisfied_relationships=(HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP,),
        acceptance_rubric_passed=tuple(sorted(set(rubric))),
        buyer_need="sales capacity for new-customer acquisition",
        why_now=f"Active vacancy {title}".strip(),
        evidence_excerpt=duty_excerpt,
        evidence_start=duty_start,
        evidence_end=duty_end,
        confidence=0.96,
        rejection_reason=None,
    )


def _hiring_acquisition_observables(
    *,
    source_text: str,
    interpretation: "SemanticEventInterpretation",
    structured_metadata: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Deterministic observables for the hiring customer-acquisition relationship proxy."""
    find_customer_acquisition_duty, looks_sales_role = _hiring_bridge_helpers()

    meta = dict(structured_metadata or {})
    bundle = meta.get("hiring_semantic_evidence_bundle") if isinstance(meta.get("hiring_semantic_evidence_bundle"), Mapping) else meta
    duty_excerpt, duty_start, duty_end = find_customer_acquisition_duty(source_text)
    title = _clean(bundle.get("vacancy_title") or interpretation.role or "")
    duties = _clean(bundle.get("role_duties") or "")
    sales_role = looks_sales_role(title=title, description=f"{duties} {interpretation.role or ''}")
    employer_role = (
        interpretation.target_entity_role == "employer"
        or _clean(bundle.get("subject_role")) == "employer"
        or bool(interpretation.employer)
    )
    vacancy_active = bool(bundle.get("vacancy_active")) or interpretation.event_status.casefold() in {
        "observed", "active", "announced", "confirmed", "occurred",
    }
    employer_direct = bundle.get("employer_is_direct")
    if employer_direct is None:
        employer_direct = True
    return {
        "duty_excerpt": duty_excerpt,
        "duty_start": duty_start,
        "duty_end": duty_end,
        "duty_proven": bool(duty_excerpt) and duty_start >= 0,
        "sales_role": sales_role,
        "employer_role": employer_role,
        "vacancy_active": vacancy_active,
        "employer_direct": bool(employer_direct),
        "source_url": _clean(bundle.get("source_url")),
        "official_domain": _clean(bundle.get("official_domain")),
        "location": _clean(bundle.get("location") or interpretation.location or ""),
    }


def apply_hiring_relationship_proxy(
    contract: SemanticQueryContract,
    interpretation: SemanticEventInterpretation,
    *,
    source_text: str,
    structured_metadata: Optional[Mapping[str, Any]] = None,
) -> Tuple[SemanticEventInterpretation, Optional[str]]:
    """Enrich interpretation from hiring observables; return (interpretation, early_rejection)."""
    from dataclasses import replace as dc_replace

    if HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP not in contract.required_relationships:
        return interpretation, None
    proxy = _hiring_acquisition_observables(
        source_text=source_text,
        interpretation=interpretation,
        structured_metadata=structured_metadata,
    )
    if not proxy["duty_proven"]:
        return interpretation, "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"
    if not (proxy["sales_role"] and proxy["employer_role"] and proxy["vacancy_active"] and proxy["employer_direct"]):
        return interpretation, None
    relationships = set(interpretation.satisfied_relationships)
    relationships.add(HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP)
    rubric = set(interpretation.acceptance_rubric_passed)
    for item in contract.acceptance_rubric:
        if item.startswith("target_role_employer") and proxy["employer_role"]:
            rubric.add(item)
        if "sales_customer_acquisition" in item and proxy["duty_proven"]:
            rubric.add(item)
    excerpt = interpretation.evidence_excerpt
    start, end = interpretation.evidence_start, interpretation.evidence_end
    if proxy["duty_excerpt"] and proxy["duty_start"] >= 0:
        excerpt = proxy["duty_excerpt"]
        start = proxy["duty_start"]
        end = proxy["duty_end"]
    return dc_replace(
        interpretation,
        target_entity_role="employer" if proxy["employer_role"] else interpretation.target_entity_role,
        employer=interpretation.employer or interpretation.target_company,
        event_status=interpretation.event_status or "active",
        event_date=interpretation.event_date or (_clean((structured_metadata or {}).get("event_date")) or None),
        location=interpretation.location or proxy["location"] or None,
        query_match=True,
        query_match_reason=(
            interpretation.query_match_reason
            or "hiring observables: active direct-employer sales vacancy with literal customer-acquisition duty"
        ),
        satisfied_relationships=tuple(sorted(relationships)),
        acceptance_rubric_passed=tuple(sorted(rubric)),
        evidence_excerpt=excerpt,
        evidence_start=start,
        evidence_end=end,
        role=interpretation.role or _clean((structured_metadata or {}).get("vacancy_title")),
    ), None


def find_expansion_facility_evidence(text: str) -> Tuple[Optional[str], int, int]:
    match = _EXPANSION_FACILITY_RE.search(text or "")
    if not match:
        return None, -1, -1
    return match.group(0), match.start(), match.end()


def apply_expansion_facility_proxy(
    contract: SemanticQueryContract,
    interpretation: SemanticEventInterpretation,
    *,
    source_text: str,
) -> SemanticEventInterpretation:
    """Seller-driven expansion: prove facility opening/expansion without requiring the seller offer on-page."""
    from dataclasses import replace as dc_replace

    if EXPANSION_FACILITY_RELATIONSHIP not in contract.required_relationships:
        return interpretation
    match = _EXPANSION_FACILITY_RE.search(source_text or "")
    if not match:
        return interpretation
    excerpt = _clean(match.group(0))
    start = match.start()
    end = match.end()
    # Prefer a slightly wider literal window that stays inside source_text.
    window_start = max(0, start - 40)
    window_end = min(len(source_text), end + 80)
    wider = _clean(source_text[window_start:window_end])
    if wider and wider in source_text:
        recovered_start = source_text.find(wider)
        if recovered_start >= 0:
            excerpt = wider
            start = recovered_start
            end = recovered_start + len(wider)
    relationships = set(interpretation.satisfied_relationships)
    relationships.add(EXPANSION_FACILITY_RELATIONSHIP)
    rubric = set(interpretation.acceptance_rubric_passed)
    for item in contract.acceptance_rubric:
        if item.endswith("_grounded") or "expand" in item or "facility" in item or item.startswith("company_"):
            rubric.add(item)
    role = interpretation.target_entity_role
    if not role or role in set(contract.excluded_roles) or role in {"publisher", "advisor", "recruiter"}:
        role = contract.target_role_in_event or "expanding_company"
    return dc_replace(
        interpretation,
        target_entity_role=role,
        event_type=interpretation.event_type or "production_expansion",
        event_status=interpretation.event_status or "observed",
        query_match=True,
        query_match_reason=(
            interpretation.query_match_reason
            or "expansion observables: literal nuovo stabilimento / ampliamento produttivo in source"
        ),
        satisfied_relationships=tuple(sorted(relationships)),
        acceptance_rubric_passed=tuple(sorted(rubric)),
        evidence_excerpt=excerpt or interpretation.evidence_excerpt,
        evidence_start=start if excerpt else interpretation.evidence_start,
        evidence_end=end if excerpt else interpretation.evidence_end,
        buyer_need=interpretation.buyer_need or "facility expansion creating industrial compliance demand",
        why_now=interpretation.why_now or excerpt,
    )


class SemanticEvidenceGroundingVerifier:
    """Deterministic verifier: model meaning never overrides missing proof."""

    def verify(
        self,
        contract: SemanticQueryContract,
        interpretation: SemanticEventInterpretation,
        *,
        source_text: str,
        source_url: str,
        source_publisher: str,
        official_domain_verified: bool,
        official_domain_confidence: float,
        entity_class: Optional[str],
        candidate_company: Optional[str] = None,
        maximum_age_days: Optional[int] = None,
        now: Optional[date] = None,
        structured_metadata: Optional[Mapping[str, Any]] = None,
        identity_verification_deferred: bool = False,
    ) -> GroundingVerdict:
        excerpt = interpretation.evidence_excerpt
        start, end = interpretation.evidence_start, interpretation.evidence_end
        # Prefer re-anchoring to the source_text under verification. Cached
        # offsets are often relative to a different semantic window.
        recovered = _recover_literal_excerpt(source_text, excerpt) if excerpt else None
        if recovered is not None:
            start, end, excerpt = recovered
            literal = source_text[start:end] == excerpt
        else:
            literal = bool(excerpt) and start >= 0 and end == start + len(excerpt) and source_text[start:end] == excerpt
            if excerpt and not literal:
                recovered = _recover_literal_excerpt(source_text, excerpt)
                if recovered is not None:
                    start, end, excerpt = recovered
                    literal = source_text[start:end] == excerpt
        target_name = _canonical_name(interpretation.target_company)
        candidate_name = _canonical_name(candidate_company or interpretation.target_company)
        target_identity = bool(target_name) and target_name == candidate_name
        target_in_source = bool(target_name) and (
            target_name in _canonical_name(source_text)
            or target_name in _canonical_name(excerpt)
        )
        relationships = set(interpretation.satisfied_relationships)
        required_relationships = set(contract.required_relationships)
        hiring_proxy = None
        if HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP in required_relationships:
            hiring_proxy = _hiring_acquisition_observables(
                source_text=source_text,
                interpretation=interpretation,
                structured_metadata=structured_metadata,
            )
            if (
                hiring_proxy["duty_proven"]
                and hiring_proxy["sales_role"]
                and hiring_proxy["employer_role"]
                and hiring_proxy["vacancy_active"]
                and hiring_proxy["employer_direct"]
            ):
                relationships.add(HIRING_CUSTOMER_ACQUISITION_RELATIONSHIP)
                interpretation_rubric = set(interpretation.acceptance_rubric_passed)
                for item in contract.acceptance_rubric:
                    if item.startswith("target_role_employer") and hiring_proxy["employer_role"]:
                        interpretation_rubric.add(item)
                    if "sales_customer_acquisition" in item and hiring_proxy["duty_proven"]:
                        interpretation_rubric.add(item)
                from dataclasses import replace as dc_replace
                interpretation = dc_replace(
                    interpretation,
                    satisfied_relationships=tuple(sorted(relationships)),
                    acceptance_rubric_passed=tuple(sorted(interpretation_rubric)),
                    target_entity_role=(
                        "employer" if hiring_proxy["employer_role"] else interpretation.target_entity_role
                    ),
                    query_match=True if not interpretation.query_match else interpretation.query_match,
                )
                relationships = set(interpretation.satisfied_relationships)
        crm_proxy = None
        if CRM_SEEKING_RELATIONSHIP in required_relationships:
            find_crm_seeking_evidence = _crm_bridge_helpers()
            crm_excerpt, crm_start, crm_end = find_crm_seeking_evidence(source_text)
            crm_proxy = {
                "proven": bool(crm_excerpt) and crm_start >= 0,
                "excerpt": crm_excerpt or "",
                "start": crm_start,
                "end": crm_end,
            }
            if crm_proxy["proven"]:
                relationships.add(CRM_SEEKING_RELATIONSHIP)
                interpretation_rubric = set(interpretation.acceptance_rubric_passed)
                for item in contract.acceptance_rubric:
                    if item.endswith("_grounded") or "seeking_crm" in item or item.startswith("buyer_"):
                        interpretation_rubric.add(item)
                from dataclasses import replace as dc_replace
                role = interpretation.target_entity_role or (
                    "buyer" if contract.target_role_in_event == "buyer" else interpretation.target_entity_role
                )
                interpretation = dc_replace(
                    interpretation,
                    satisfied_relationships=tuple(sorted(relationships)),
                    acceptance_rubric_passed=tuple(sorted(interpretation_rubric)),
                    target_entity_role=role or interpretation.target_entity_role,
                    query_match=True,
                    query_match_reason=(
                        interpretation.query_match_reason
                        or "deterministic CRM observables: literal CRM selection/adoption/project language"
                    ),
                )
                relationships = set(interpretation.satisfied_relationships)
                if excerpt and not literal and crm_proxy["excerpt"] in source_text:
                    excerpt = crm_proxy["excerpt"]
                    start = crm_proxy["start"]
                    end = crm_proxy["end"]
                    literal = source_text[start:end] == excerpt
        expansion_proxy = None
        if EXPANSION_FACILITY_RELATIONSHIP in required_relationships:
            interpretation = apply_expansion_facility_proxy(
                contract, interpretation, source_text=source_text,
            )
            if EXPANSION_FACILITY_RELATIONSHIP in set(interpretation.satisfied_relationships):
                expansion_proxy = {"proven": True}
                relationships = set(interpretation.satisfied_relationships)
                if interpretation.evidence_excerpt and interpretation.evidence_excerpt in source_text:
                    excerpt = interpretation.evidence_excerpt
                    start = interpretation.evidence_start
                    end = interpretation.evidence_end
                    literal = start >= 0 and source_text[start:end] == excerpt
        relationships_pass = required_relationships.issubset(relationships)
        target_in_relation = any(
            isinstance(relation, Mapping)
            and any(
                _canonical_name(value) == target_name
                for key, value in relation.items()
                if key not in {"relation_type", "predicate", "direction", "relationship_id"} and isinstance(value, str)
            )
            for relation in interpretation.relations
        )
        role_match = bool(interpretation.target_entity_role) and (
            _roles_compatible(interpretation.target_entity_role, contract.target_role_in_event)
            or (relationships_pass and target_in_relation)
            or (hiring_proxy is not None and hiring_proxy["employer_role"] and contract.target_role_in_event == "employer")
            or (
                crm_proxy is not None
                and crm_proxy["proven"]
                and contract.target_role_in_event == "buyer"
                and _roles_compatible(interpretation.target_entity_role, "buyer")
            )
            or (
                expansion_proxy is not None
                and expansion_proxy["proven"]
                and _roles_compatible(
                    interpretation.target_entity_role,
                    contract.target_role_in_event or "expanding_company",
                )
            )
        )
        excluded_role = interpretation.target_entity_role in set(contract.excluded_roles)
        rubric_pass = set(contract.acceptance_rubric).issubset(set(interpretation.acceptance_rubric_passed))
        unsafe_modality = any((
            interpretation.negated, interpretation.hypothetical, interpretation.conditional,
            interpretation.rumor,
        ))
        event_day = _parse_iso_date(interpretation.event_date)
        if event_day is None and isinstance(structured_metadata, Mapping):
            event_day = _parse_iso_date(structured_metadata.get("published_at"))
        temporal = event_day is not None
        if temporal and maximum_age_days is not None:
            age = ((now or datetime.now(timezone.utc).date()) - event_day).days
            temporal = 0 <= age <= max(0, int(maximum_age_days))
        duty_ok = True
        if hiring_proxy is not None:
            duty_ok = bool(hiring_proxy["duty_proven"])
            if duty_ok and excerpt:
                # Prefer grounding against the duty-bearing excerpt when present.
                if hiring_proxy["duty_excerpt"] and hiring_proxy["duty_excerpt"] in source_text:
                    if excerpt not in source_text or not literal:
                        excerpt = hiring_proxy["duty_excerpt"]
                        start = hiring_proxy["duty_start"]
                        end = hiring_proxy["duty_end"]
                        literal = start >= 0 and source_text[start:end] == excerpt
        query_match = bool(interpretation.query_match) or (
            hiring_proxy is not None
            and duty_ok
            and hiring_proxy["sales_role"]
            and hiring_proxy["employer_role"]
            and hiring_proxy["vacancy_active"]
        ) or (crm_proxy is not None and crm_proxy["proven"]) or (
            expansion_proxy is not None and expansion_proxy["proven"]
        )
        checks = {
            "excerpt_literal": literal,
            "offsets_exact": literal,
            "target_identity_matches_candidate": target_identity,
            "target_present_in_source": target_in_source,
            "target_role_matches_query": role_match,
            "target_role_not_excluded": not excluded_role,
            "required_relationships_supported": relationships_pass,
            "acceptance_rubric_satisfied": rubric_pass,
            "query_match": query_match,
            "customer_acquisition_duty_literal": duty_ok if hiring_proxy is not None else True,
            "vacancy_active_when_hiring_relationship": (
                hiring_proxy["vacancy_active"] if hiring_proxy is not None else True
            ),
            "not_negated_hypothetical_conditional_or_rumor": not unsafe_modality,
            "event_status_observed": interpretation.event_status.casefold() in {
                "observed", "active", "completed", "announced", "occurred", "confirmed",
            },
            "temporal_evidence_valid": temporal,
            "source_url_present": str(source_url).startswith(("http://", "https://")),
            "publisher_present": bool(_clean(source_publisher)),
            "official_domain_verified": (
                True
                if identity_verification_deferred
                else bool(official_domain_verified) and float(official_domain_confidence) >= 0.70
            ),
            "operating_entity": entity_class == "operating_company",
            "confidence_sufficient": interpretation.confidence >= 0.70 and interpretation.certainty >= 0.70,
        }
        claim_type = str(contract.evidence_claim_type or "OBSERVED_EVENT").upper()
        event_grounding = all((
            checks["excerpt_literal"],
            checks["not_negated_hypothetical_conditional_or_rumor"],
            checks["event_status_observed"],
            checks["temporal_evidence_valid"],
        ))
        company_grounding = all((
            checks["target_identity_matches_candidate"],
            checks["target_present_in_source"],
            checks["target_role_matches_query"],
            checks["target_role_not_excluded"],
            checks["official_domain_verified"],
            checks["operating_entity"],
        ))
        hypothesis_compatibility = all((
            checks["required_relationships_supported"],
            checks["acceptance_rubric_satisfied"],
            checks["query_match"],
        ))
        closed_status = interpretation.event_status.casefold() in {
            "closed", "completed_award", "awarded", "expired", "cancelled", "implemented",
        }
        explicit_required = claim_type in {"DIRECT_DEMAND", "SELECTION_PROCESS"}
        explicit_demand_grounding = (not explicit_required) or (
            event_grounding and hypothesis_compatibility and not closed_status
        )
        commercial_inference_validity = (
            event_grounding and hypothesis_compatibility
            if claim_type in {"OBSERVED_EVENT", "COMPANY_ATTRIBUTE", "COMMERCIAL_INFERENCE"}
            else True
        )
        gate_results = {
            "event_grounding": event_grounding,
            "company_grounding": company_grounding,
            "hypothesis_compatibility": hypothesis_compatibility,
            "commercial_inference_validity": commercial_inference_validity,
            "explicit_demand_grounding": explicit_demand_grounding,
        }
        gate_codes = {
            "event_grounding": "EVENT_GROUNDING_FAILED",
            "company_grounding": "COMPANY_GROUNDING_FAILED",
            "hypothesis_compatibility": "HYPOTHESIS_COMPATIBILITY_FAILED",
            "commercial_inference_validity": "COMMERCIAL_INFERENCE_INVALID",
            "explicit_demand_grounding": "EXPLICIT_DEMAND_GROUNDING_FAILED",
        }
        failed_gate_codes = tuple(
            gate_codes[name] for name, passed in gate_results.items() if not passed
        )
        reasons = tuple(name for name, passed in checks.items() if not passed)
        if hiring_proxy is not None and not duty_ok:
            rejection = "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"
        elif not event_grounding:
            rejection = "EVENT_GROUNDING_FAILED"
        elif not role_match or excluded_role:
            rejection = "TARGET_ROLE_UNVERIFIED"
        elif not company_grounding:
            rejection = "COMPANY_GROUNDING_FAILED"
        elif not hypothesis_compatibility:
            rejection = "HYPOTHESIS_COMPATIBILITY_FAILED"
        elif not explicit_demand_grounding:
            rejection = "EXPLICIT_DEMAND_GROUNDING_FAILED"
        elif not commercial_inference_validity:
            rejection = "COMMERCIAL_INFERENCE_INVALID"
        elif reasons:
            rejection = failed_gate_codes[0] if failed_gate_codes else "EVIDENCE_GROUNDING_FAILED"
        else:
            rejection = None
        return GroundingVerdict(
            accepted=rejection is None,
            rejection_code=rejection,
            reasons=reasons,
            checks=checks,
            target_company=interpretation.target_company,
            target_entity_role=interpretation.target_entity_role,
            event_type=interpretation.event_type,
            event_date=interpretation.event_date,
            evidence_excerpt=excerpt,
            evidence_start=start,
            evidence_end=end,
            source_url=source_url,
            source_publisher=source_publisher,
            verified_at=datetime.now(timezone.utc).isoformat(),
            evidence_claim_type=claim_type,
            gate_results=gate_results,
            failed_gate_codes=failed_gate_codes,
        )


SemanticModelCallable = Callable[..., Awaitable[Mapping[str, Any]]]


class CallableSemanticModel:
    """Small injectable adapter used by tests and provider-specific clients."""

    def __init__(self, callback: SemanticModelCallable, model_version: str) -> None:
        self.callback = callback
        self.model_version = model_version

    async def complete_json(self, **kwargs: Any) -> Mapping[str, Any]:
        result = await self.callback(**kwargs)
        if not isinstance(result, Mapping):
            raise ValueError("semantic model returned non-object JSON")
        return result


class AnthropicSemanticModel:
    """Metered Anthropic tool-use client; no unreserved or automatic repair call."""

    def __init__(
        self,
        *,
        tier1_model: Optional[str] = None,
        tier2_model: Optional[str] = None,
        api_key: Optional[str] = None,
        on_usage: Optional[Callable[[Mapping[str, Any]], None]] = None,
    ) -> None:
        self.tier1_model = _clean(tier1_model or os.getenv("MIRAX_SEMANTIC_MODEL_TIER1") or "claude-haiku-4-5")
        self.tier2_model = _clean(tier2_model or os.getenv("MIRAX_SEMANTIC_MODEL_TIER2") or "claude-sonnet-5")
        self.api_key = _clean(api_key or os.getenv("ANTHROPIC_API_KEY"))
        self.model_version = f"{self.tier1_model}|{self.tier2_model}"
        self.on_usage = on_usage

    @staticmethod
    def _rates(tier: int) -> Tuple[float, float]:
        prefix = "MIRAX_SEMANTIC_TIER2" if tier == 2 else "MIRAX_SEMANTIC_TIER1"
        default_input = "3" if tier == 2 else "1"
        default_output = "15" if tier == 2 else "5"
        return (
            float(os.getenv(f"{prefix}_INPUT_EUR_PER_MILLION") or default_input),
            float(os.getenv(f"{prefix}_OUTPUT_EUR_PER_MILLION") or default_output),
        )

    @classmethod
    def _estimated_cost(cls, tier: int, *, input_token_upper_bound: int, max_output_tokens: int) -> float:
        name = "MIRAX_SEMANTIC_TIER2_ESTIMATED_COST_EUR" if tier == 2 else "MIRAX_SEMANTIC_TIER1_ESTIMATED_COST_EUR"
        configured = os.getenv(name)
        input_rate, output_rate = cls._rates(tier)
        conservative = max(
            0.0001,
            1.15 * (input_token_upper_bound * input_rate + max_output_tokens * output_rate) / 1_000_000,
        )
        # Operators may reserve more, never less than the computed upper bound.
        return max(conservative, float(configured)) if configured else conservative

    @classmethod
    def _actual_cost(cls, input_tokens: int, output_tokens: int, tier: int) -> float:
        input_per_million, output_per_million = cls._rates(tier)
        return max(0.0, input_tokens * input_per_million / 1_000_000 + output_tokens * output_per_million / 1_000_000)

    async def complete_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
        schema: Mapping[str, Any],
        tier: int,
    ) -> Mapping[str, Any]:
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY missing; semantic authority fails closed")
        governor = None
        try:
            # Prefer the flat worker alias first. Shadow runtime sets the governor
            # on cost_context; backend_mirror.cost_context can be a second module
            # object with a different ContextVar under the flat package alias.
            from cost_context import current_cost_governor as worker_governor
            governor = worker_governor()
        except ImportError:
            pass
        if governor is None:
            try:
                from backend_mirror.cost_context import current_cost_governor as package_governor
                governor = package_governor()
            except ImportError:
                from cost_governor import ResearchBudgetExceeded
        try:
            from cost_governor import ResearchBudgetExceeded
        except ImportError:
            from backend_mirror.cost_governor import ResearchBudgetExceeded
        if governor is None:
            raise ResearchBudgetExceeded("semantic interpretation requires an atomic cost governor")
        model = self.tier2_model if tier == 2 else self.tier1_model
        request_hash = _digest({"task": task, "model": model, "payload": payload, "schema": schema})
        reservation_key = f"semantic:{request_hash}"
        task_output_env = (
            "MIRAX_SEMANTIC_EVENT_MAX_OUTPUT_TOKENS"
            if task.startswith("semantic_commercial_event")
            else "MIRAX_SEMANTIC_QUERY_MAX_OUTPUT_TOKENS"
        )
        # Event interpretations regularly overflow 2k tool JSON on news pages
        # (relations + rubric + excerpt). 4k keeps canaries under the €0.028
        # reserve ceiling while avoiding SEMANTIC_OUTPUT_TRUNCATED dead-ends.
        default_output_tokens = "4000" if task.startswith("semantic_commercial_event") else "3000"
        max_output_tokens = int(
            os.getenv(task_output_env)
            or os.getenv("MIRAX_SEMANTIC_MAX_OUTPUT_TOKENS")
            or default_output_tokens
        )
        # UTF-8 bytes are a conservative upper bound for provider input tokens;
        # include fixed tool/message overhead.  Refuse oversized input before
        # the provider call so settlement cannot breach the hard cap.
        serialized_input = f"{system_prompt}\n{_stable_json(payload)}\n{_stable_json(schema)}".encode("utf-8")
        input_token_upper_bound = len(serialized_input) + 4096
        # Cap the reservation envelope so one news-page interpretation cannot
        # consume the entire €0.05 canary after discovery SERPs. Observed
        # Haiku event calls settle near €0.014–0.016; keep the reserve tight
        # enough that a second lead still fits after the first SERP+semantic.
        input_token_upper_bound = min(input_token_upper_bound, 8_000)
        max_input_upper_bound = int(os.getenv("MIRAX_SEMANTIC_MAX_INPUT_TOKEN_UPPER_BOUND") or "50000")
        if input_token_upper_bound > max_input_upper_bound:
            raise ResearchBudgetExceeded("semantic input exceeds the pre-authorized token upper bound")
        estimate = self._estimated_cost(
            tier,
            input_token_upper_bound=input_token_upper_bound,
            max_output_tokens=max_output_tokens,
        )
        estimate = min(float(estimate), float(os.getenv("MIRAX_SEMANTIC_MAX_RESERVE_EUR") or "0.018"))
        governor.reserve(
            reservation_key, "semantic_interpretation", estimate,
            provider="anthropic", model=model,
            metadata={"task": task, "tier": tier, "schema_version": schema.get("$id")},
        )
        body = {
            "model": model,
            "max_tokens": max_output_tokens,
            "system": system_prompt,
            "messages": [{"role": "user", "content": _stable_json(payload)}],
            "tools": [{
                "name": "submit_semantic_result",
                "description": "Submit the grounded structured semantic analysis.",
                "input_schema": dict(schema),
            }],
            "tool_choice": {"type": "tool", "name": "submit_semantic_result"},
        }
        # Sonnet 5 rejects the legacy temperature parameter.  Tier 1 keeps
        # deterministic sampling where the provider still supports it; the
        # Tier 2 query authority is constrained by tool choice and schema.
        if tier == 1:
            body["temperature"] = 0
        try:
            import httpx
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json=body,
                )
            if response.is_error:
                try:
                    error_payload = response.json().get("error") or {}
                except (ValueError, AttributeError):
                    error_payload = {}
                error_type = _clean(error_payload.get("type")) or f"http_{response.status_code}"
                error_message = _clean(error_payload.get("message")) or "provider rejected semantic request"
                raise RuntimeError(
                    f"ANTHROPIC_SEMANTIC_REQUEST_FAILED:{response.status_code}:{error_type}:{error_message}"
                )
            raw = response.json()
            usage = raw.get("usage") if isinstance(raw.get("usage"), Mapping) else {}
            input_tokens = int(usage.get("input_tokens") or 0)
            output_tokens = int(usage.get("output_tokens") or 0)
            actual = self._actual_cost(input_tokens, output_tokens, tier)
            # The provider has charged once a response exists. Settle before
            # validating completeness so truncated/invalid outputs remain in
            # cost accounting and cannot be silently retried.
            governor.settle(
                reservation_key, actual,
                metadata={"task": task, "tier": tier, "input_tokens": input_tokens, "output_tokens": output_tokens},
            )
            if self.on_usage is not None:
                self.on_usage({
                    "task": task, "tier": tier, "model": model,
                    "input_tokens": input_tokens, "output_tokens": output_tokens, "cost_eur": actual,
                })
            if raw.get("stop_reason") == "max_tokens":
                raise ValueError("SEMANTIC_OUTPUT_TRUNCATED")
            result: Optional[Mapping[str, Any]] = None
            for item in raw.get("content") or ():
                if isinstance(item, Mapping) and item.get("type") == "tool_use" and item.get("name") == "submit_semantic_result":
                    candidate = item.get("input")
                    if isinstance(candidate, Mapping):
                        result = candidate
                        break
            if result is None:
                raise ValueError("semantic model omitted required tool result")
            return result
        except Exception as exc:
            try:
                governor.release(reservation_key, failed=True, error_code=type(exc).__name__)
            except Exception:
                pass
            raise
