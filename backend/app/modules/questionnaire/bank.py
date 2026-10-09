"""The optional attribute questionnaire.

**This questionnaire is worth zero points, and that is load-bearing.** The
arithmetic is 700 + 200 resume + 30 course + 60 interviews = 990 exactly; there
is no room in it for a questionnaire, and import-linter forbids this module from
importing `scoring` at all (invariant 4-prime). What it collects are *facts an
employer filters on* -- the ones a CV does not reliably state, like when the
candidate can actually start.

That is also why it can be optional without being pointless: skipping it costs
a candidate nothing except appearing in fewer filtered searches.

---

**What is deliberately not asked, and why.**

Indian CV and application-form convention includes several fields that are
ordinary here and are straightforward discrimination vectors: date of birth,
marital status, gender, religion, caste or category, and a photograph. None of
them appear below.

- *Age and date of birth* are forbidden outright -- invariant 5, PRD §3 rule 4,
  and `scripts/check_no_age_fields.py` fails the build over them.
- *Marital status and dependants* are asked of women and used against them.
- *Religion, caste and category* would turn a filter into a mechanism.
- *A photograph* is how appearance, gender and ethnicity re-enter a process
  that just removed them.

If the client wants any of these, it is a decision for them and their counsel
to take explicitly and in writing -- not a field someone adds because every
other form has one.

**Every question is skippable.** `required` is False on all of them, including
the useful ones. A mandatory optional questionnaire is not optional, and a
candidate who cannot answer "notice period" because they are not employed must
not be stuck on it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final, Literal

BANK_VERSION: Final = "placeholder-1-2026-09-11"

#: `SINGLE` and `MULTI` are closed lists, for the reason `employer/reference.py`
#: gives at length: free text and filtering do not coexist. `TEXT` exists for
#: exactly one question, and nothing filters on it.
QuestionType = Literal["SINGLE", "MULTI", "NUMBER", "BOOLEAN", "TEXT"]


@dataclass(frozen=True, slots=True)
class Option:
    code: str
    label: str


@dataclass(frozen=True, slots=True)
class Question:
    code: str
    #: Translation key. The English `prompt` below is the source string and the
    #: fallback; what a candidate sees comes from the locale bundle
    #: (`app/core/i18n`). See blocker C5.
    key: str
    prompt: str
    type: QuestionType
    options: tuple[Option, ...] = ()
    required: bool = False
    #: Whether employers may filter on the answer. A question nobody filters on
    #: and nobody scores is a question that should not be asked.
    filterable: bool = True
    help_text: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)


def _opts(*pairs: tuple[str, str]) -> tuple[Option, ...]:
    return tuple(Option(code, label) for code, label in pairs)


# ---------------------------------------------------------------------------
# Availability -- the section employers actually use
# ---------------------------------------------------------------------------

AVAILABILITY: Final[tuple[Question, ...]] = (
    Question(
        "NOTICE_PERIOD",
        "questionnaire.notice_period",
        "If you are working now, how soon could you start a new job?",
        "SINGLE",
        _opts(
            ("IMMEDIATE", "Immediately"),
            ("WITHIN_15_DAYS", "Within 15 days"),
            ("WITHIN_30_DAYS", "Within 30 days"),
            ("WITHIN_60_DAYS", "Within 60 days"),
            ("WITHIN_90_DAYS", "Within 90 days"),
            ("NOT_WORKING", "I am not working at the moment"),
        ),
        help_text="Employers use this to plan. A longer notice period is not a disadvantage.",
        tags=("availability",),
    ),
    Question(
        "EMPLOYMENT_TYPE",
        "questionnaire.employment_type",
        "What kind of work are you looking for?",
        "MULTI",
        _opts(
            ("FULL_TIME", "Full time"),
            ("PART_TIME", "Part time"),
            ("CONTRACT", "Contract"),
            ("INTERNSHIP", "Internship"),
            ("APPRENTICESHIP", "Apprenticeship"),
            ("FREELANCE", "Freelance or project work"),
        ),
        tags=("availability",),
    ),
    Question(
        "WORK_ARRANGEMENT",
        "questionnaire.work_arrangement",
        "Where would you be able to work?",
        "MULTI",
        _opts(
            ("ONSITE", "At the workplace"),
            ("HYBRID", "Partly at the workplace, partly from home"),
            ("REMOTE", "Fully from home"),
        ),
        tags=("availability",),
    ),
    Question(
        "SHIFT_WILLINGNESS",
        "questionnaire.shift_willingness",
        "Which shifts could you work?",
        "MULTI",
        _opts(
            ("DAY", "Day shift"),
            ("EVENING", "Evening shift"),
            ("NIGHT", "Night shift"),
            ("ROTATIONAL", "Rotational shifts"),
        ),
        help_text="Leave blank if you are not sure. Many jobs are day shift only.",
        tags=("availability",),
    ),
)

# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------
# **No city list here.** A closed list of Indian cities is either 30 entries
# long and excludes most of the country, or 4,000 entries long and belongs in a
# reference table with a search endpoint, not in a questionnaire definition.
# `PREFERRED_LOCATIONS` is answered against that table.

LOCATION: Final[tuple[Question, ...]] = (
    Question(
        "RELOCATION",
        "questionnaire.relocation",
        "Would you move to another city for the right job?",
        "SINGLE",
        _opts(
            ("YES", "Yes"),
            ("WITHIN_STATE", "Yes, within my state"),
            ("NO", "No"),
            ("DEPENDS", "It depends on the job"),
        ),
        tags=("location",),
    ),
    Question(
        "PREFERRED_LOCATIONS",
        "questionnaire.preferred_locations",
        "Which places would you like to work in?",
        "MULTI",
        help_text="Search and pick up to five.",
        tags=("location",),
    ),
)

# ---------------------------------------------------------------------------
# Languages
# ---------------------------------------------------------------------------
# Genuinely a job requirement in Indian hiring -- a support role in Hyderabad
# really does need Telugu -- and one of the few attributes a CV states
# unreliably. The list matches the launch locales plus the largest languages
# by speaker count.

LANGUAGE_OPTIONS: Final[tuple[Option, ...]] = _opts(
    ("HINDI", "Hindi"),
    ("ENGLISH", "English"),
    ("BENGALI", "Bengali"),
    ("MARATHI", "Marathi"),
    ("TELUGU", "Telugu"),
    ("TAMIL", "Tamil"),
    ("GUJARATI", "Gujarati"),
    ("KANNADA", "Kannada"),
    ("MALAYALAM", "Malayalam"),
    ("ODIA", "Odia"),
    ("PUNJABI", "Punjabi"),
    ("ASSAMESE", "Assamese"),
    ("URDU", "Urdu"),
)

LANGUAGES: Final[tuple[Question, ...]] = (
    Question(
        "LANGUAGES_SPOKEN",
        "questionnaire.languages_spoken",
        "Which languages can you hold a work conversation in?",
        "MULTI",
        LANGUAGE_OPTIONS,
        tags=("language",),
    ),
    Question(
        "LANGUAGES_WRITTEN",
        "questionnaire.languages_written",
        "Which languages can you write in at work?",
        "MULTI",
        LANGUAGE_OPTIONS,
        tags=("language",),
    ),
)

# ---------------------------------------------------------------------------
# Work context
# ---------------------------------------------------------------------------

WORK_CONTEXT: Final[tuple[Question, ...]] = (
    Question(
        "TEAM_SIZE_MANAGED",
        "questionnaire.team_size_managed",
        "What is the largest number of people you have been responsible for?",
        "NUMBER",
        help_text="Enter 0 if you have not managed anyone. Most jobs do not require it.",
        tags=("scope",),
    ),
    Question(
        "HAS_DRIVING_LICENCE",
        "questionnaire.has_driving_licence",
        "Do you hold a valid driving licence?",
        "BOOLEAN",
        help_text="Asked because some jobs require it, not because it counts otherwise.",
        tags=("credential",),
    ),
    Question(
        "WILLING_TO_TRAVEL",
        "questionnaire.willing_to_travel",
        "How much work travel would suit you?",
        "SINGLE",
        _opts(
            ("NONE", "None"),
            ("OCCASIONAL", "Occasionally"),
            ("FREQUENT", "Frequently"),
            ("FIELD_ROLE", "A job that is mostly travel"),
        ),
        tags=("availability",),
    ),
    Question(
        "ACCESSIBILITY_ADJUSTMENTS",
        "questionnaire.accessibility_adjustments",
        "Is there anything an employer should arrange so you can do your best work?",
        "TEXT",
        # Not filterable, and deliberately so. This exists to help a candidate
        # who needs an adjustment ask for one. Making it searchable would turn
        # a support field into a screening field, which is the opposite.
        filterable=False,
        help_text="Optional, and only shared with an employer you apply to.",
        tags=("accessibility",),
    ),
)

SECTIONS: Final[dict[str, tuple[Question, ...]]] = {
    "availability": AVAILABILITY,
    "location": LOCATION,
    "languages": LANGUAGES,
    "work_context": WORK_CONTEXT,
}

QUESTIONS: Final[tuple[Question, ...]] = tuple(q for section in SECTIONS.values() for q in section)

QUESTION_CODES: Final[frozenset[str]] = frozenset(q.code for q in QUESTIONS)


def question_by_code(code: str) -> Question | None:
    return next((q for q in QUESTIONS if q.code == code), None)


def filterable_questions() -> tuple[Question, ...]:
    return tuple(q for q in QUESTIONS if q.filterable)
