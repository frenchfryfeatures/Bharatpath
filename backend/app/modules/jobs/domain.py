"""jobs - pure domain logic

Composer, validation, publish gate, lifecycle.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.
"""

from __future__ import annotations

from typing import Final, Literal

#: SRS 1.20.6: `DRAFT -> PUBLISHED -> PAUSED -> PUBLISHED -> CLOSED`.
#:
#: CLOSED is terminal. A job that reopens is a new job: candidates who applied
#: to the closed one were told it closed, and silently reviving it would put
#: them back in a pipeline they had been released from.
TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "DRAFT": frozenset({"PUBLISHED", "CLOSED"}),
    "PUBLISHED": frozenset({"PAUSED", "CLOSED"}),
    "PAUSED": frozenset({"PUBLISHED", "CLOSED"}),
    "CLOSED": frozenset(),
}

#: A live job is not edited in place. Changing the salary or the requirements
#: of a job people have already applied to is a bait-and-switch, so an employer
#: pauses it first -- which takes it off the board while it changes.
EDITABLE_STATES: Final[frozenset[str]] = frozenset({"DRAFT", "PAUSED"})


def refuse_transition(current: str, target: str) -> str | None:
    """The error code for a transition the lifecycle forbids, or None."""
    if target not in TRANSITIONS.get(current, frozenset()):
        return "job_invalid_transition"
    return None


def is_editable(status: str) -> bool:
    return status in EDITABLE_STATES


# ---------------------------------------------------------------------------
# Threshold preview: a count, and only a coarse one
# ---------------------------------------------------------------------------
#: Thresholds are previewed in steps of ten, and counts are reported to the
#: nearest ten below with anything under ten reported as "fewer than ten".
#:
#: **This endpoint is a leak vector.** An employer who could
#: preview any threshold and see an exact count could binary-search for the
#: score of the one candidate whose presence changes the count by one. Steps of
#: ten on the input and rounding on the output mean one person moving in or out
#: rarely changes the answer at all, and the rate limit bounds how many
#: questions can be asked. Coarse enough to be useless for fingerprinting,
#: precise enough to tell "almost nobody" from "hundreds".
THRESHOLD_STEP: Final = 10
MIN_REPORTED_COUNT: Final = 10


def coarse_count(count: int) -> tuple[int, bool]:
    """`(approximate count, fewer than ten)`. Never an exact small number."""
    if count < MIN_REPORTED_COUNT:
        return 0, True
    return (count // MIN_REPORTED_COUNT) * MIN_REPORTED_COUNT, False


# ---------------------------------------------------------------------------
# Eligibility: does a candidate's score meet a job's threshold?
# ---------------------------------------------------------------------------
Eligibility = Literal["ELIGIBLE", "BELOW_THRESHOLD", "SCORE_PENDING"]


def eligibility(*, min_score: int | None, score: int | None) -> Eligibility:
    """Three answers and no reasons.

    `score` is the server's stored score, never a value from the request.
    `SCORE_PENDING` wins over everything, a job with no threshold included:
    nobody can apply until they have a score, so calling them eligible would
    promise an application the service then refuses.

    **Never how far below.** The client confirmed the score is never explained
    (R11), and "you need 40 more" is an explanation. That is also why the
    candidate board never shows the threshold itself: next to their own score,
    it tells them the gap.
    """
    if score is None:
        return "SCORE_PENDING"
    if min_score is None or score >= min_score:
        return "ELIGIBLE"
    return "BELOW_THRESHOLD"
