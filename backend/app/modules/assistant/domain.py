"""assistant - pure domain logic

The candidate's job-search chat (2026-10-13).

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**The model reads; code acts.** The model turns a message into a `Plan`: one
action from a closed list, search terms, which job in view it means, and the
words to say. Code checks the plan here, then carries it out through the
same services the app's own screens use, with their rules. Nothing the
model writes reaches the database or decides who sees what.

**What the model is shown is `PlanContext`, and nothing else.** The
conversation, the language, and the jobs on screen as the board shows them
-- with `open_to_you` in place of eligibility. Never the score, never a
threshold, never the person's name, contact, CV or profile.
`tests/unit/test_assistant_domain.py` holds the field lists.

**Applying is never the model's act.** `APPLY` produces a proposal the
candidate confirms with a tap, which calls `POST /candidate/applications`
like the job screen's button. A message, or a job description written to
look like one, can at most put a confirm button on screen.

**The conversation is not stored.** The client sends the recent turns and
an opaque `state` back with each message. What a person types to a chat
about their job search is theirs; keeping it would be a new store of
personal data with no retention rule, which is the client's decision.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, cast, get_args

Action = Literal[
    "SEARCH",
    "MORE_RESULTS",
    "MATCH_MY_PROFILE",
    "SIMILAR_TO_APPLIED",
    "SHOW_JOB",
    "APPLY",
    "MY_APPLICATIONS",
    "REPLY",
]
ACTIONS: Final[tuple[str, ...]] = get_args(Action)

#: Actions that put a list of jobs on screen. Their results replace the jobs
#: in view, and "show me more" continues the last of them.
LISTING_ACTIONS: Final[frozenset[str]] = frozenset(
    {"SEARCH", "MATCH_MY_PROFILE", "SIMILAR_TO_APPLIED"}
)
#: Actions that name one job in view by its number.
JOB_ACTIONS: Final[frozenset[str]] = frozenset({"SHOW_JOB", "APPLY"})

WorkMode = Literal["ONSITE", "HYBRID", "REMOTE"]
WORK_MODES: Final[tuple[str, ...]] = get_args(WorkMode)
ApplicationsFilter = Literal["ACTIVE", "CLOSED"]
APPLICATION_FILTERS: Final[tuple[str, ...]] = get_args(ApplicationsFilter)

#: What the model is told about each job in view, in place of eligibility.
#: The board's three answers renamed, with no number and no reason.
OpenToYou = Literal["yes", "no", "not_yet"]
OPEN_TO_YOU: Final[dict[str, OpenToYou]] = {
    "ELIGIBLE": "yes",
    "BELOW_THRESHOLD": "no",
    "SCORE_PENDING": "not_yet",
}

# -- bounds -------------------------------------------------------------------
#: Jobs per list. A chat shows a few cards, not a page.
RESULTS_PER_TURN: Final = 5
#: The furthest "show me more" goes. Past it, the board is the better tool.
MAX_OFFSET: Final = 50
MAX_MESSAGE_CHARS: Final = 1_000
#: The recent conversation the client sends back, newest last.
MAX_HISTORY_TURNS: Final = 12
MAX_TURN_CHARS: Final = 2_000
#: What of the history reaches the model, newest kept.
MAX_HISTORY_CHARS: Final = 6_000
MAX_REPLY_CHARS: Final = 1_200
MAX_SUGGESTIONS: Final = 3
MAX_SUGGESTION_CHARS: Final = 60
MAX_KEYWORDS: Final = 8
MAX_SKILLS: Final = 10
MAX_LOCATIONS: Final = 5
MAX_TERM_CHARS: Final = 60
MAX_EXPERIENCE_YEARS: Final = 50
#: `jobs` salary columns are 32-bit paise; a figure above this is not a salary.
MAX_SALARY_RUPEES: Final = 20_000_000
#: Of each job's description, what the model reads.
DESCRIPTION_CHARS: Final = 700
#: An encoded state longer than this is not one we wrote.
MAX_STATE_CHARS: Final = 4_000
STATE_VERSION: Final = 1
#: A plan the checks refuse goes back to the model once, with the reason.
MAX_PLAN_ATTEMPTS: Final = 2


# ---------------------------------------------------------------------------
# What the model is shown
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Turn:
    role: Literal["user", "assistant"]
    text: str


@dataclass(frozen=True, slots=True)
class JobInView:
    """A job on screen, as the model reads it. The board's own fields, and
    `open_to_you` instead of eligibility. No threshold, no tenant, no link."""

    number: int
    title: str
    employer_name: str | None
    location: str | None
    work_mode: str | None
    skills: tuple[str, ...]
    experience_min_years: float | None
    #: Words, e.g. "₹25,000-35,000 per month"; None when not disclosed.
    salary: str | None
    description: str
    open_to_you: OpenToYou


@dataclass(frozen=True, slots=True)
class PlanContext:
    """Everything the model is shown. See the module docstring for what may
    never be added."""

    #: The account's language, as a BCP 47 code. A hint: the model answers
    #: in the language the candidate writes in.
    language: str
    history: tuple[Turn, ...]
    message: str
    jobs_in_view: tuple[JobInView, ...]
    #: Whether "show me more" has anything to continue.
    can_show_more: bool
    #: Earlier plans for this message, refused, with the reason.
    refused: tuple[str, ...] = ()


def trim_history(turns: Sequence[Turn]) -> tuple[Turn, ...]:
    """The newest turns that fit `MAX_HISTORY_CHARS`, oldest first."""
    kept: list[Turn] = []
    budget = MAX_HISTORY_CHARS
    for turn in reversed(turns[-MAX_HISTORY_TURNS:]):
        text = turn.text.strip()
        if not text:
            continue
        if len(text) > budget:
            break
        kept.append(Turn(turn.role, text))
        budget -= len(text)
    return tuple(reversed(kept))


def excerpt(description: str) -> str:
    text = " ".join(description.split())
    return text if len(text) <= DESCRIPTION_CHARS else text[: DESCRIPTION_CHARS - 1] + "…"


def salary_words(
    *, minimum_minor: int, maximum_minor: int, period: str, disclosed: bool
) -> str | None:
    if not disclosed:
        return None
    per = {
        "HOURLY": " per hour",
        "DAILY": " per day",
        "MONTHLY": " per month",
        "ANNUAL": " per year",
    }.get(period, "")
    return f"₹{minimum_minor // 100:,}-{maximum_minor // 100:,}{per}"


# ---------------------------------------------------------------------------
# What the model returns
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class SearchRequest:
    """A search as the board can run it. No field for who the candidate is:
    there is nothing here to filter jobs by age, gender or anything like
    them (invariant 5)."""

    keywords: tuple[str, ...] = ()
    skills: tuple[str, ...] = ()
    locations: tuple[str, ...] = ()
    work_mode: WorkMode | None = None
    min_salary_rupees: int | None = None
    experience_years: int | None = None
    eligible_only: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "keywords": list(self.keywords),
            "skills": list(self.skills),
            "locations": list(self.locations),
            "work_mode": self.work_mode,
            "min_salary_rupees": self.min_salary_rupees,
            "experience_years": self.experience_years,
            "eligible_only": self.eligible_only,
        }


@dataclass(frozen=True, slots=True)
class Plan:
    action: Action
    reply: str
    #: Said instead of `reply` when a list action finds nothing.
    reply_if_empty: str
    search: SearchRequest | None = None
    #: 1-based, among the jobs in view. Set for `JOB_ACTIONS` only.
    job_number: int | None = None
    applications: ApplicationsFilter | None = None
    suggestions: tuple[str, ...] = ()


class PlanRefusedError(ValueError):
    """The model's plan did not fit. `reason` goes back to it for one retry."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


_URL = re.compile(r"(?i)\b(?:https?://|www\.)\S+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def scrub(text: str) -> str:
    """Links and email addresses removed from what the model says.

    A job description is written by an employer and read by the model; one
    written to make the chat say "apply at this link" must not get a link on
    screen in our voice. A job's real link is on its card, for a candidate
    allowed to use it.
    """
    text = _URL.sub("", text)
    text = _EMAIL.sub("", text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def _terms(raw: object, *, limit: int) -> tuple[str, ...]:
    """Trimmed, de-duplicated (ignoring case), the first `limit` kept. A
    term too long to be one is dropped."""
    if not isinstance(raw, list):
        return ()
    seen: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, str):
            continue
        term = " ".join(item.split())
        if term and len(term) <= MAX_TERM_CHARS and term.lower() not in seen:
            seen[term.lower()] = term
    return tuple(list(seen.values())[:limit])


def _bounded_int(raw: object, *, low: int, high: int) -> int | None:
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    return raw if low <= raw <= high else None


def _search(raw: object) -> SearchRequest:
    if not isinstance(raw, dict):
        return SearchRequest()
    mode = raw.get("work_mode")
    return SearchRequest(
        keywords=_terms(raw.get("keywords"), limit=MAX_KEYWORDS),
        skills=_terms(raw.get("skills"), limit=MAX_SKILLS),
        locations=_terms(raw.get("locations"), limit=MAX_LOCATIONS),
        work_mode=cast(WorkMode, mode) if mode in WORK_MODES else None,
        min_salary_rupees=_bounded_int(raw.get("min_salary_rupees"), low=1, high=MAX_SALARY_RUPEES),
        experience_years=_bounded_int(
            raw.get("experience_years"), low=0, high=MAX_EXPERIENCE_YEARS
        ),
        eligible_only=raw.get("only_jobs_open_to_me") is True,
    )


def _text(raw: object) -> str:
    return scrub(raw) if isinstance(raw, str) else ""


def parse_plan(raw: object, *, jobs_in_view: int) -> Plan:
    """The model's JSON as a `Plan`, or `PlanRefusedError`.

    Search terms are normalised (trimmed, de-duplicated, capped); anything
    that changes what happens -- an unknown action, a job that is not on
    screen, nothing to say -- is refused, never guessed at.
    """
    if not isinstance(raw, dict):
        raise PlanRefusedError("the answer was not a JSON object")
    action = raw.get("action")
    if action not in ACTIONS:
        raise PlanRefusedError(f"action must be one of {', '.join(ACTIONS)}")
    reply = _text(raw.get("reply"))
    if not reply:
        raise PlanRefusedError("reply was empty")
    if len(reply) > MAX_REPLY_CHARS:
        raise PlanRefusedError(f"reply was longer than {MAX_REPLY_CHARS} characters")
    reply_if_empty = _text(raw.get("reply_if_no_results"))[:MAX_REPLY_CHARS] or reply

    job_number = None
    if action in JOB_ACTIONS:
        job_number = _bounded_int(raw.get("job_number"), low=1, high=max(jobs_in_view, 1))
        if jobs_in_view == 0 or job_number is None:
            raise PlanRefusedError(
                f"{action} needs job_number between 1 and {jobs_in_view}, the jobs in view; "
                "with no such job, use REPLY and ask which job they mean"
            )

    applications = raw.get("applications")
    suggestions = tuple(
        s
        for s in (_text(item) for item in (raw.get("suggestions") or [])[:MAX_SUGGESTIONS])
        if s and len(s) <= MAX_SUGGESTION_CHARS
    )
    return Plan(
        action=cast(Action, action),
        reply=reply,
        reply_if_empty=reply_if_empty,
        search=_search(raw.get("search")) if action == "SEARCH" else None,
        job_number=job_number,
        applications=(
            cast(ApplicationsFilter, applications)
            if action == "MY_APPLICATIONS" and applications in APPLICATION_FILTERS
            else None
        ),
        suggestions=suggestions,
    )


# ---------------------------------------------------------------------------
# The conversation state the client carries
# ---------------------------------------------------------------------------
ListingSource = Literal["SEARCH", "MATCH_MY_PROFILE", "SIMILAR_TO_APPLIED"]


@dataclass(frozen=True, slots=True)
class Listing:
    """The last list shown, so "show me more" can continue it."""

    source: ListingSource
    #: Where the next page starts.
    offset: int
    search: SearchRequest | None = None
    #: Whether the last page said there was another. False stops the model
    #: offering "show more" for a list that has run out.
    more: bool = True

    @property
    def can_continue(self) -> bool:
        return self.more and self.offset < MAX_OFFSET


@dataclass(frozen=True, slots=True)
class ConversationState:
    """What the chat remembers between messages, carried by the client.

    It is the candidate's own to change: every job id in it is re-read
    through the board's policy, and a search in it runs under their own
    binding with the board's rules. A forged state shows them nothing they
    could not search for.
    """

    in_view: tuple[uuid.UUID, ...] = ()
    listing: Listing | None = None


class StateInvalidError(ValueError):
    pass


def encode_state(state: ConversationState) -> str:
    payload: dict[str, Any] = {"v": STATE_VERSION, "j": [str(i) for i in state.in_view]}
    if state.listing is not None:
        payload["l"] = {
            "s": state.listing.source,
            "o": state.listing.offset,
            "q": state.listing.search.as_dict() if state.listing.search else None,
            "m": state.listing.more,
        }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_state(encoded: str | None) -> ConversationState:
    """The state the client sent back, or a fresh one for None.
    `StateInvalidError` for anything we did not write."""
    if not encoded:
        return ConversationState()
    if len(encoded) > MAX_STATE_CHARS:
        raise StateInvalidError("too long")
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise StateInvalidError("not a state") from exc
    if not isinstance(payload, dict) or payload.get("v") != STATE_VERSION:
        raise StateInvalidError("unknown version")
    ids = payload.get("j")
    if not isinstance(ids, list) or len(ids) > RESULTS_PER_TURN:
        raise StateInvalidError("jobs in view")
    try:
        in_view = tuple(uuid.UUID(str(i)) for i in ids)
    except ValueError as exc:
        raise StateInvalidError("job id") from exc
    listing = None
    raw_listing = payload.get("l")
    if raw_listing is not None:
        if not isinstance(raw_listing, dict) or raw_listing.get("s") not in LISTING_ACTIONS:
            raise StateInvalidError("listing")
        offset = _bounded_int(raw_listing.get("o"), low=0, high=MAX_OFFSET)
        if offset is None:
            raise StateInvalidError("offset")
        source = cast(ListingSource, raw_listing["s"])
        search = None
        if source == "SEARCH":
            stored = raw_listing.get("q")
            if not isinstance(stored, dict):
                raise StateInvalidError("search")
            search = _search(
                {**stored, "only_jobs_open_to_me": stored.get("eligible_only") is True}
            )
        more = raw_listing.get("m", True)
        if not isinstance(more, bool):
            raise StateInvalidError("more")
        listing = Listing(source=source, offset=offset, search=search, more=more)
    return ConversationState(in_view=in_view, listing=listing)
