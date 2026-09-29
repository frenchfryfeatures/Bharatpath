"""questionnaire - pure domain logic

Optional attribute questionnaire. Imports nothing from scoring.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Worth zero points** (`bank.py`). Nothing below produces a number, and the
report says what was answered, never how "good" an answer is -- there is no
good answer to "how soon could you start".

**Every answer is validated against the bank on the server.** The bank's
option lists are what makes a question filterable; an answer outside them is
free text wearing a code's clothes, and one day an employer filters on it.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from app.modules.questionnaire.bank import QUESTIONS, SECTIONS, Question, question_by_code

#: `TEAM_SIZE_MANAGED`. Bounded so a typo cannot become a filter outlier.
MAX_NUMBER: Final = 100_000
MAX_TEXT_LENGTH: Final = 1_000

#: `PREFERRED_LOCATIONS` has no option list (`bank.py`): places are named. The
#: help text promises "up to five".
MAX_PLACES: Final = 5
MAX_PLACE_LENGTH: Final = 80
#: A place name holds no digits and no `@`. Employers will filter on it, so it
#: must not be a way to put a phone number or an address in front of one --
#: the rule `candidate_profiles` applies to a declared city.
_PLACE: Final = re.compile(r"^[^\d@]{2,80}$")


@dataclass(frozen=True, slots=True)
class AnswerIssue:
    question: str
    code: str


def _clean(question: Question, value: object) -> object | None:
    """The stored form of one answer, or None if it is not a valid answer."""
    if question.type == "BOOLEAN":
        return value if isinstance(value, bool) else None
    if question.type == "NUMBER":
        if isinstance(value, bool) or not isinstance(value, int):
            return None
        return value if 0 <= value <= MAX_NUMBER else None
    if question.type == "TEXT":
        if not isinstance(value, str):
            return None
        text = value.strip()
        return text if 0 < len(text) <= MAX_TEXT_LENGTH else None
    if question.type == "SINGLE":
        codes = {o.code for o in question.options}
        return value if isinstance(value, str) and value in codes else None

    # MULTI
    if not isinstance(value, list) or not value:
        return None
    if not all(isinstance(v, str) for v in value):
        return None
    items = [str(v).strip() for v in value]
    if len(set(items)) != len(items):
        return None
    if question.options:
        codes = {o.code for o in question.options}
        return items if set(items) <= codes else None
    if len(items) > MAX_PLACES or not all(_PLACE.match(i) for i in items):
        return None
    return items


def validate_answers(
    answers: Mapping[str, object],
) -> tuple[dict[str, object], dict[str, None], list[AnswerIssue]]:
    """Split a save into answers to store, answers to clear, and issues.

    `None` clears an answer: every question is skippable, including after it
    was answered. An unknown question code is an issue, not something ignored
    -- a client sending codes we do not have is a client built against another
    bank.
    """
    stored: dict[str, object] = {}
    cleared: dict[str, None] = {}
    issues: list[AnswerIssue] = []
    for code, value in answers.items():
        question = question_by_code(code)
        if question is None:
            issues.append(AnswerIssue(code, "unknown_question"))
            continue
        if value is None:
            cleared[code] = None
            continue
        cleaned = _clean(question, value)
        if cleaned is None:
            issues.append(AnswerIssue(code, f"invalid_{question.type.lower()}_answer"))
            continue
        stored[code] = cleaned
    return stored, cleared, issues


def current_answers(stored: Mapping[str, object]) -> dict[str, object]:
    """Stored answers that are still valid against today's bank.

    A bank change can retire a question or an option. The stored row is left
    alone -- it is what the candidate said -- and what no longer fits the bank
    is simply not shown or reported.
    """
    kept: dict[str, object] = {}
    for question in QUESTIONS:
        if question.code in stored:
            cleaned = _clean(question, stored[question.code])
            if cleaned is not None:
                kept[question.code] = cleaned
    return kept


# ---------------------------------------------------------------------------
# The supplementary report
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class ReportItem:
    code: str
    prompt: str
    answered: bool
    #: Option labels, or the value as text. Empty when unanswered.
    display: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReportSection:
    code: str
    answered: int
    total: int
    items: tuple[ReportItem, ...]


def _display(question: Question, value: object) -> tuple[str, ...]:
    labels = {o.code: o.label for o in question.options}
    if isinstance(value, bool):
        return ("Yes" if value else "No",)
    if isinstance(value, list):
        return tuple(labels.get(str(v), str(v)) for v in value)
    return (labels.get(str(value), str(value)),)


def build_report(answers: Mapping[str, object]) -> tuple[ReportSection, ...]:
    """What the candidate told employers, section by section.

    A summary to read back, not an assessment: no section is "complete" or
    "strong", and a skipped question is reported as skipped and nothing more.
    """
    valid = current_answers(answers)
    sections: list[ReportSection] = []
    for section_code, questions in SECTIONS.items():
        items = tuple(
            ReportItem(
                code=q.code,
                prompt=q.prompt,
                answered=q.code in valid,
                display=_display(q, valid[q.code]) if q.code in valid else (),
            )
            for q in questions
        )
        sections.append(
            ReportSection(
                code=section_code,
                answered=sum(1 for i in items if i.answered),
                total=len(items),
                items=items,
            )
        )
    return tuple(sections)


@dataclass(frozen=True, slots=True)
class AnswerInWords:
    code: str
    question: str
    answer: str


def answers_in_words(
    answers: Mapping[str, object], *, include_free_text: bool
) -> tuple[AnswerInWords, ...]:
    """Saved answers as a person would read them, in the bank's order: option
    labels rather than codes, "Yes"/"No" rather than booleans. For the
    console, a college's consented view and the interview question writer
    (2026-09-29).

    `include_free_text=False` leaves out the one free-text question, about
    adjustments a candidate needs at work, which its help text promises is
    shared only with an employer they apply to.
    """
    out: list[AnswerInWords] = []
    for question in QUESTIONS:
        value = answers.get(question.code)
        if value in (None, "", []) or (question.type == "TEXT" and not include_free_text):
            continue
        labels = {o.code: o.label for o in question.options}
        if isinstance(value, list):
            words = ", ".join(labels.get(str(v), str(v)) for v in value)
        elif isinstance(value, bool):
            words = "Yes" if value else "No"
        else:
            words = labels.get(str(value), str(value))
        out.append(AnswerInWords(question.code, question.prompt, words))
    return tuple(out)
