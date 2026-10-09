"""The course: its identity, and the syllabus we propose for it.

Two different things live here:

- **`COURSE_CODE` and `COURSE_TITLE` are live.** `service.sync_catalogue`
  writes the versioned `courses` row from them, and every purchase,
  completion and lesson is keyed on the code.
- **`MODULES` is a proposal, not the course.** The course a candidate buys is
  whatever staff build in the admin console (`course_modules`,
  `course_lessons`), and it goes on sale only when they publish it with a
  playable lesson. Nothing in the application reads `MODULES`; it is the
  outline handed to whoever records the lessons. Every lesson here has
  `asset_key = None` and `HAS_MEDIA` is False, and a test holds both, so this
  draft cannot be mistaken for recorded content.

**The syllabus is ours, the content is not.** The client may well want a
different course.

---

**Why the syllabus is about evidence rather than about the score.**

Completing this course adds up to +30 to a number, so there is an obvious
temptation to build it as "how to score well on BharatPath". That would be
wrong twice over. The client confirmed twice that the score is never explained,
so a course that explained it would contradict the product. And a
course that taught rubric-gaming would inflate every score without improving a
single candidate, which destroys the thing employers are paying for.

So it teaches people to *document work they actually did*, accurately and
specifically. That genuinely moves the rubric -- `achievement_specificity` and
`skill_evidence` are half the resume band -- while the mechanism stays honest:
the CV improves because the description improved, not because the candidate
learned a trick. Nothing below names a weight, a category or a band.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

#: Matches `COURSE_PRODUCT` in `subscriptions/catalogue.py`, and written by
#: `scripts/seed_catalogue.py`. One course exists on the platform (client,
#: 2026-08-27).
COURSE_CODE: Final = "COURSE_RESUME_FOUNDATION"
COURSE_TITLE: Final = "Presenting Your Work"

#: Bump when the syllabus changes. A candidate who completed version 1 did a
#: different course from one who completed version 2, and `course_completions`
#: stores a rule version for the same reason.
SYLLABUS_VERSION: Final = "placeholder-1-2026-09-11"

#: False: none of the proposed lessons below has been recorded. What is sold
#: is decided by the console's publish step, which refuses a course with no
#: playable lesson -- a candidate who pays for empty lessons is a refund and a
#: review, and the +30 would be awarded for watching nothing.
HAS_MEDIA: Final = False


@dataclass(frozen=True, slots=True)
class Lesson:
    code: str
    title: str
    minutes: int
    #: What the learner should be able to *do* afterwards. Written as an
    #: outcome because "understands X" cannot be checked and "can rewrite X
    #: as Y" can.
    outcome: str
    #: S3 key of the recorded lesson. `None` everywhere today.
    asset_key: str | None = None


@dataclass(frozen=True, slots=True)
class Module:
    code: str
    title: str
    lessons: tuple[Lesson, ...]

    @property
    def minutes(self) -> int:
        return sum(lesson.minutes for lesson in self.lessons)


MODULES: Final[tuple[Module, ...]] = (
    Module(
        "M1",
        "What a hiring team actually reads",
        (
            Lesson(
                "M1L1",
                "The first fifteen seconds",
                6,
                "Name the three things a reader looks for before deciding to keep reading.",
            ),
            Lesson(
                "M1L2",
                "Why most CVs say nothing",
                8,
                "Tell a duty apart from an accomplishment in someone else's CV.",
            ),
            Lesson(
                "M1L3",
                "One CV, many readers",
                6,
                "Explain why the same CV is read by software, a recruiter and a manager.",
            ),
        ),
    ),
    Module(
        "M2",
        "Describing work as evidence",
        (
            Lesson(
                "M2L1",
                "Duty, action, result",
                10,
                "Rewrite a duty sentence as an action with a result.",
            ),
            Lesson(
                "M2L2",
                "Finding the result when nobody measured it",
                10,
                "Recover a defensible outcome from work that was never formally measured.",
            ),
            Lesson(
                "M2L3",
                "Your part of a team's work",
                8,
                "State a personal contribution to a group result without overclaiming it.",
            ),
        ),
    ),
    Module(
        "M3",
        "Numbers you can stand behind",
        (
            Lesson(
                "M3L1",
                "Counting what you did",
                8,
                "Turn volume, frequency and duration into a number that is true.",
            ),
            Lesson(
                "M3L2",
                "Percentages, and when not to use one",
                7,
                "Choose between a count and a percentage for a given result.",
            ),
            Lesson(
                "M3L3",
                "The honesty line",
                9,
                "Identify claims you could not defend if an interviewer asked one more question.",
            ),
        ),
    ),
    Module(
        "M4",
        "Skills you can demonstrate",
        (
            Lesson(
                "M4L1",
                "Why a long skills list works against you",
                7,
                "Cut a padded skills list to the ones that appear in your own work history.",
            ),
            Lesson(
                "M4L2",
                "Attaching a skill to a piece of work",
                9,
                "Point to where in your history each listed skill was used.",
            ),
            Lesson(
                "M4L3",
                "Certificates, courses and what they are worth",
                6,
                "Decide which certificates belong on a CV and which do not.",
            ),
        ),
    ),
    Module(
        "M5",
        "Structure, format and the things that get CVs discarded",
        (
            Lesson(
                "M5L1",
                "Order, length and what goes on page one",
                8,
                "Lay out a CV so the strongest evidence is read first.",
            ),
            Lesson(
                "M5L2",
                "Files, fonts and scanned photographs",
                6,
                "Produce a file that software and a human can both read.",
            ),
            Lesson(
                "M5L3",
                "Dates, gaps and career changes",
                8,
                "Present a non-linear history plainly instead of hiding it.",
            ),
        ),
    ),
    Module(
        "M6",
        "Talking about your work out loud",
        (
            Lesson(
                "M6L1",
                "Answering with a structure",
                9,
                "Answer a 'tell me about a time' question in situation-action-result form.",
            ),
            Lesson(
                "M6L2",
                "Questions about gaps, moves and mistakes",
                9,
                "Answer an uncomfortable question without apologising or inventing.",
            ),
            Lesson(
                "M6L3",
                "Asking your own questions",
                6,
                "Prepare questions that tell you whether you want the job.",
            ),
        ),
    ),
)


def total_minutes() -> int:
    return sum(module.minutes for module in MODULES)


def module_count() -> int:
    return len(MODULES)


def lesson_count() -> int:
    return sum(len(module.lessons) for module in MODULES)


def missing_media() -> tuple[str, ...]:
    """Lesson codes in the proposed syllabus with no recorded asset."""
    return tuple(
        lesson.code for module in MODULES for lesson in module.lessons if lesson.asset_key is None
    )
