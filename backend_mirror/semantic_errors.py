"""Typed semantic/fetch/identity failure details for progress telemetry."""
from __future__ import annotations

import hashlib
import traceback
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class FailureDetail:
    exception_class: str = ""
    exception_message: str = ""
    failing_function: str = ""
    http_status: Optional[int] = None
    provider_request_id: str = ""
    model: str = ""
    schema_version: str = ""
    contract_hash: str = ""
    payload_size: int = 0
    source_text_size: int = 0
    elapsed_ms: int = 0
    stack_trace_hash: str = ""

    def to_public_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if data.get("exception_message"):
            data["exception_message"] = str(data["exception_message"])[:500]
        return data


def stack_hash(exc: BaseException) -> str:
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return hashlib.sha256(tb.encode("utf-8")).hexdigest()[:16]


def classify_exception(
    exc: BaseException,
    *,
    failing_function: str,
    contract_hash: str = "",
    source_text_size: int = 0,
    model: str = "",
) -> tuple[str, FailureDetail]:
    name = type(exc).__name__
    message = str(exc)
    lowered = message.casefold()
    if name == "ResearchBudgetExceeded" or "cost governor" in lowered or "hard budget" in lowered:
        code = "SEMANTIC_BUDGET_EXCEEDED"
        code = "SEMANTIC_TIMEOUT"
    elif name in {"JSONDecodeError", "ValidationError"} or "schema" in lowered or "json" in lowered:
        code = "SEMANTIC_SCHEMA_INVALID"
    elif "truncat" in lowered:
        code = "SEMANTIC_OUTPUT_TRUNCATED"
    elif name == "ModuleNotFoundError":
        code = "SEMANTIC_MODEL_FAILED"
    elif "api" in lowered or "anthropic" in lowered or "401" in lowered or "403" in lowered:
        code = "SEMANTIC_MODEL_FAILED"
    elif "ground" in lowered:
        code = "GROUNDING_FAILED"
    elif "identity" in lowered or "domain" in lowered:
        code = "IDENTITY_RESOLUTION_FAILED"
    elif "fetch" in lowered or "http" in lowered:
        code = "PAGE_FETCH_FAILED"
    elif "empty" in lowered and "content" in lowered:
        code = "PAGE_CONTENT_EMPTY"
    elif "parse" in lowered:
        code = "PAGE_PARSE_FAILED"
    else:
        code = "SEMANTIC_MODEL_FAILED"
    detail = FailureDetail(
        exception_class=name,
        exception_message=message[:500],
        failing_function=failing_function,
        contract_hash=contract_hash,
        source_text_size=source_text_size,
        model=model,
        stack_trace_hash=stack_hash(exc),
    )
    return code, detail


def detail_from_mapping(value: Mapping[str, Any] | None) -> FailureDetail:
    if not isinstance(value, Mapping):
        return FailureDetail()
    return FailureDetail(
        exception_class=str(value.get("exception_class") or ""),
        exception_message=str(value.get("exception_message") or ""),
        failing_function=str(value.get("failing_function") or ""),
        http_status=value.get("http_status"),
        provider_request_id=str(value.get("provider_request_id") or ""),
        model=str(value.get("model") or ""),
        schema_version=str(value.get("schema_version") or ""),
        contract_hash=str(value.get("contract_hash") or ""),
        payload_size=int(value.get("payload_size") or 0),
        source_text_size=int(value.get("source_text_size") or 0),
        elapsed_ms=int(value.get("elapsed_ms") or 0),
        stack_trace_hash=str(value.get("stack_trace_hash") or ""),
    )
