"""jobs - pure domain logic

Composer, validation, publish gate, lifecycle.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
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
#: **This endpoint is a leak vector** (plan.md Day 10). An employer who could
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


# ---------------------------------------------------------------------------
# Recommendations: which board jobs resemble what a candidate wants
# ---------------------------------------------------------------------------
# Two home-screen sections draw on this (2026-10-09): jobs like the ones the
# candidate applied to, and jobs that fit their career profile. Both ask the
# same question -- how much does a job overlap a set of terms -- and differ
# only in where the terms come from, so there is one rule and two callers.
#
# **What the terms may hold is fixed by `MatchTerms`, and it is short on
# purpose:** skills, words of a job title, places and months of experience.
# Nothing about who someone is -- no gender, no age, no college -- because a
# ranking that used one would steer who sees which jobs by it (invariant 5,
# C3). `test_recommendations.py` holds the field list.
#
# **Never the threshold.** Eligibility is shown beside each job exactly as on
# the board; it plays no part in the order, which would otherwise sort the
# jobs a candidate's score clears above the ones it does not -- the gap R11
# rules out, drawn as a list.

#: A job must share a skill or a title word with the terms to be recommended
#: at all. A city or an experience fit alone is not a reason: it would fill the
#: section with every job in Pune.
SKILL_WEIGHT: Final = 3
TITLE_WORD_WEIGHT: Final = 4
LOCATION_WEIGHT: Final = 2
EXPERIENCE_FIT_WEIGHT: Final = 1

#: Words too common in job titles to say anything about the job.
TITLE_STOPWORDS: Final[frozenset[str]] = frozenset(
    {
        "and", "for", "the", "with", "of", "in", "at", "to", "a", "an", "or",
        "job", "jobs", "role", "opening", "vacancy", "urgent", "hiring",
        "senior", "junior", "sr", "jr", "lead", "head", "trainee", "intern",
        "fresher", "freshers", "executive", "associate", "assistant",
        "full", "part", "time", "remote", "onsite", "hybrid",
    }
)  # fmt: skip
#: Shorter tokens are mostly noise ("ii", "vp"); real two-letter skills such
#: as "ui" or "qa" still match through `skills`.
MIN_TITLE_WORD_LENGTH: Final = 3
#: Bounds on what one request can ask the database to compare.
MAX_TERMS: Final = 60
#: A home-screen section's default and largest length.
RECOMMENDATIONS_DEFAULT: Final = 10
RECOMMENDATIONS_MAX: Final = 50


def skill_key(skill: str) -> str:
    """A skill as compared: trimmed and lower-cased, as the board's filter does."""
    return skill.strip().lower()


def title_words(text: str) -> frozenset[str]:
    r"""The words of a job title that say what the job is.

    Letters and digits only, so every word is safe inside the database's word
    boundary match (`\m...\M`) without escaping.
    """
    words = re.findall(r"[a-z0-9]+", text.lower())
    return frozenset(
        w for w in words if len(w) >= MIN_TITLE_WORD_LENGTH and w not in TITLE_STOPWORDS
    )


@dataclass(frozen=True)
class MatchTerms:
    """What a recommendation is matched on. See the section comment for why
    nothing else may be added here."""

    skills: frozenset[str] = frozenset()
    title_words: frozenset[str] = frozenset()
    locations: frozenset[str] = frozenset()
    experience_months: int | None = None

    @classmethod
    def build(
        cls,
        *,
        skills: Iterable[str] = (),
        titles: Iterable[str] = (),
        locations: Iterable[str] = (),
        experience_months: int | None = None,
    ) -> MatchTerms:
        """Normalised and capped. The first `MAX_TERMS` of each kind win, so a
        caller lists the strongest signals first."""
        keys = _first_distinct((skill_key(s) for s in skills), MAX_TERMS)
        words = _first_distinct((w for t in titles for w in sorted(title_words(t))), MAX_TERMS)
        places = _first_distinct((p.strip().lower() for p in locations), MAX_TERMS)
        return cls(
            skills=frozenset(keys),
            title_words=frozenset(words),
            locations=frozenset(places),
            experience_months=experience_months,
        )

    @property
    def is_empty(self) -> bool:
        """Nothing a job could match. A section with no basis says so rather
        than showing the newest jobs under a heading that claims otherwise."""
        return not self.skills and not self.title_words


def _first_distinct(values: Iterable[str], limit: int) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
            if len(seen) == limit:
                break
    return seen


@dataclass(frozen=True)
class Match:
    relevance: int
    #: The job's own spellings of the skills it shares with the terms.
    matched_skills: tuple[str, ...]


def match(
    terms: MatchTerms,
    *,
    title: str,
    skills: Sequence[str],
    location: str | None,
    experience_min_months: int | None,
) -> Match | None:
    """How well one job fits `terms`, or None when it shares no skill and no
    title word with them."""
    matched = tuple(dict.fromkeys(s for s in skills if skill_key(s) in terms.skills))
    shared_words = title_words(title) & terms.title_words
    if not matched and not shared_words:
        return None
    relevance = SKILL_WEIGHT * len({skill_key(s) for s in matched})
    relevance += TITLE_WORD_WEIGHT * len(shared_words)
    if location and any(place in location.lower() for place in terms.locations):
        relevance += LOCATION_WEIGHT
    if terms.experience_months is not None and (
        experience_min_months is None or experience_min_months <= terms.experience_months
    ):
        relevance += EXPERIENCE_FIT_WEIGHT
    return Match(relevance=relevance, matched_skills=matched)
