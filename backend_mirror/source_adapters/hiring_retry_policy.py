"""Deterministic retry/terminal policy for hiring URL acquisition.

The policy is deliberately independent from role semantics: it only decides
whether another *different and executable* technical strategy exists.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence


TRANSIENT_CODES = frozenset({
    "FETCH_TIMEOUT",
    "DNS_ERROR",
    "CONNECTION_RESET",
    "HTTP_429",
    "PROVIDER_TEMPORARILY_UNAVAILABLE",
})

TERMINAL_CODES = frozenset({
    "WORKDAY_CXS_HTTP_404",
    "WORKDAY_CXS_HTTP_422",
    "WORKDAY_CXS_NOT_JSON",
    "WORKDAY_CXS_EMPTY",
    "JSONLD_JOBPOSTING_MISSING",
    "LISTING_PAGE",
    "NOT_INDIVIDUAL_VACANCY",
    "STALE_VACANCY",
    "ROLE_MISMATCH",
    "GEOGRAPHY_MISMATCH",
    "GEO_OUT_OF_SCOPE",
    "RECRUITER_FINAL_EMPLOYER_UNRESOLVED",
    "AGGREGATOR_WITHOUT_EMPLOYER",
})

_NETWORK_ERROR_NAMES = ("timeout", "dns", "connection", "reset", "temporar")


@dataclass(frozen=True)
class HiringRetryDecision:
    url_state: str
    retryable: bool
    retry_attempt_count: int
    retry_strategy: str
    last_attempt_at: str | None
    next_retry_at: str | None
    max_retry_attempts: int
    terminal_after_reason: str | None

    def as_fields(self) -> dict[str, Any]:
        return {
            "url_state": self.url_state,
            "retryable": self.retryable,
            "retry_attempt_count": self.retry_attempt_count,
            "retry_strategy": self.retry_strategy,
            "last_attempt_at": self.last_attempt_at,
            "next_retry_at": self.next_retry_at,
            "max_retry_attempts": self.max_retry_attempts,
            "terminal_after_reason": self.terminal_after_reason,
        }


def _strings(value: Any) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value,) if value else ()
    if isinstance(value, Sequence):
        return tuple(str(item) for item in value if str(item or "").strip())
    return ()


def attempted_strategies(outcome: Mapping[str, Any]) -> tuple[str, ...]:
    attempted = list(_strings(outcome.get("fallback_strategies_attempted")))
    if outcome.get("cxs_attempt_count") or outcome.get("cxs_attempts"):
        attempted.append("workday_cxs")
    if str(outcome.get("fetch_path") or "") == "html" and outcome.get("fetch_success") is not False:
        attempted.append("official_html_structured")
    return tuple(dict.fromkeys(attempted))


def available_fallbacks(outcome: Mapping[str, Any]) -> tuple[str, ...]:
    available = list(_strings(outcome.get("available_fallback_strategies")))
    explicit = str(outcome.get("fallback_strategy") or "").strip()
    if explicit:
        available.append(explicit)
    attempted = set(attempted_strategies(outcome))
    return tuple(item for item in dict.fromkeys(available) if item not in attempted)


def _http_status(outcome: Mapping[str, Any]) -> int:
    try:
        return int(outcome.get("cxs_http_status") or outcome.get("http_status") or 0)
    except (TypeError, ValueError):
        return 0


def _is_transient(outcome: Mapping[str, Any], code: str) -> bool:
    status = _http_status(outcome)
    if code in TRANSIENT_CODES or status == 429 or 500 <= status <= 599:
        return True
    if code in {"WORKDAY_CXS_FETCH_ERROR", "FETCH_HTTP_ERROR"}:
        attempts = outcome.get("cxs_attempts") or ()
        error_text = " ".join(str(item.get("error") or "") for item in attempts if isinstance(item, Mapping))
        error_text += " " + str(outcome.get("fetch_error") or "")
        return any(token in error_text.casefold() for token in _NETWORK_ERROR_NAMES)
    return False


def _next_retry(now: datetime, attempts: int) -> str:
    delay = min(60, 5 * (2 ** max(0, attempts)))
    return (now + timedelta(minutes=delay)).isoformat()


def classify_retry_outcome(
    outcome: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> HiringRetryDecision:
    """Return one authoritative queue disposition for a persisted outcome."""
    now = now or datetime.now(timezone.utc)
    code = str(outcome.get("rejection_code") or outcome.get("validation_result") or "").upper()
    attempts = max(0, int(outcome.get("retry_attempt_count") or 0))
    last_attempt = str(outcome.get("last_attempt_at") or "").strip() or None

    if code in {"", "ACCEPTED"}:
        return HiringRetryDecision("accepted", False, attempts, "none", last_attempt, None, 0, None)
    if code == "DOMAIN_BATCH_DEFERRED":
        return HiringRetryDecision("pending_deferred", False, attempts, "domain_batch_queue", last_attempt, None, 0, None)

    fallbacks = available_fallbacks(outcome)
    if code == "WORKDAY_CXS_HTTP_403":
        if fallbacks:
            strategy = fallbacks[0]
            maximum = 1
            if attempts < maximum:
                return HiringRetryDecision(
                    "retryable_alternate_strategy", True, attempts, strategy, last_attempt,
                    _next_retry(now, attempts), maximum, None,
                )
        return HiringRetryDecision(
            "rejected_final_technical_exhausted", False, attempts, "workday_cxs",
            last_attempt, None, 1, "WORKDAY_CXS_HTTP_403_NO_UNTRIED_FALLBACK",
        )

    if code in TERMINAL_CODES or (code == "WORKDAY_CXS_URL_UNRESOLVED" and not fallbacks):
        return HiringRetryDecision(
            "rejected_final", False, attempts, str(outcome.get("retry_strategy") or "none"),
            last_attempt, None, attempts, code,
        )

    if fallbacks:
        maximum = 1
        if attempts < maximum:
            return HiringRetryDecision(
                "retryable_alternate_strategy", True, attempts, fallbacks[0], last_attempt,
                _next_retry(now, attempts), maximum, None,
            )

    if _is_transient(outcome, code):
        maximum = max(1, int(outcome.get("max_retry_attempts") or 2))
        if attempts < maximum:
            return HiringRetryDecision(
                "retryable_transient", True, attempts, "same_provider_transient", last_attempt,
                _next_retry(now, attempts), maximum, None,
            )
        return HiringRetryDecision(
            "rejected_final_technical_exhausted", False, attempts, "same_provider_transient",
            last_attempt, None, maximum, f"MAX_RETRY_ATTEMPTS_REACHED:{code}",
        )

    return HiringRetryDecision(
        "rejected_final_technical_exhausted", False, attempts,
        str(outcome.get("retry_strategy") or "none"), last_attempt, None, attempts,
        f"NON_TRANSIENT_NO_UNTRIED_FALLBACK:{code}",
    )


def apply_retry_policy(outcome: Mapping[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    row = dict(outcome)
    row.update(classify_retry_outcome(row, now=now).as_fields())
    row["fallback_strategies_attempted"] = list(attempted_strategies(row))
    return row
