"""The mock-interview evaluation rubric, and the question sets older sessions used.

**Candidates are not asked these question sets.** Every question is drafted by
the model for the session (`questions.py`) and stored in
`interview_session_questions`; `domain.bank_questions_for` reads a set below
only for a session created before questions were stored. The rubric and the
timings are live.

**Completing a session is what awards points, not performing well in it.** A
finished session contributes +20, capped at +60 across all sessions
(`interview/models.py`), and that cap lives in `scoring/domain.py` -- this
module imports nothing from `scoring`, which import-linter enforces as invariant
4-prime. Everything below produces *feedback for the candidate*. A badly
answered session and a well answered one move the score identically.

That is a deliberate product position and not an oversight. A quality-graded
interview would be a second unexplained three-digit judgment sitting behind the
first one, decided by a model on a recording, with no way for the candidate to
see or contest it. The client has already confirmed the score is never
explained; adding a second hidden grade would compound that rather than balance
it.

**No question is repeated across a candidate's sessions** -- for the sets
below, by giving each session number its own set; for drafted questions, by
`questions.parse_drafted_question` refusing a repeat.

---

**What the rubric must never assess.**

This is an audio product used across 6-8 languages by people whose first
language is usually not English. Several things a naive interview grader
measures are, in this market, straightforwardly a proxy for region, class or
schooling:

- **Accent, pronunciation and fluency.** Not assessed. Not a dimension, not a
  tiebreaker, not a note.
- **Vocabulary sophistication.** A precise answer in plain words is a good
  answer.
- **Speaking speed, pauses, filler words.** These track nervousness and
  familiarity with being interviewed, which is the thing a mock interview
  exists to fix, not to punish.
- **Voice pitch or timbre.** A gender proxy, and nothing else.

`CLARITY` below is scoped narrowly to compensate: it asks whether the answer
could be *followed*, judged in whichever language the candidate chose to speak.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

BANK_VERSION: Final = "placeholder-1-2026-09-11"
RUBRIC_VERSION: Final = "placeholder-1-2026-09-11"

#: Per question. Long enough for a structured answer, short enough that a
#: dropped connection loses one answer and not a session -- answers upload
#: progressively for that reason.
ANSWER_SECONDS: Final = 120

#: Before recording starts. A candidate who has never done this needs a moment
#: more than the question takes to read.
PREPARATION_SECONDS: Final = 30


@dataclass(frozen=True, slots=True)
class InterviewQuestion:
    code: str
    #: Translation key; the English below is the source string and fallback.
    key: str
    prompt: str
    #: What a good answer would contain. Shown to the candidate *after* they
    #: answer, never before -- it is the feedback, and showing it first turns
    #: the exercise into reading aloud.
    looking_for: str


@dataclass(frozen=True, slots=True)
class QuestionSet:
    code: str
    title: str
    questions: tuple[InterviewQuestion, ...]

    @property
    def minutes(self) -> int:
        seconds = len(self.questions) * (ANSWER_SECONDS + PREPARATION_SECONDS)
        return round(seconds / 60)


# ---------------------------------------------------------------------------
# Session 1 -- the questions almost every interview opens with
# ---------------------------------------------------------------------------

SET_ONE: Final = QuestionSet(
    "SET_1_FOUNDATIONS",
    "The questions you will be asked first",
    (
        InterviewQuestion(
            "Q1_ABOUT_YOU",
            "interview.q.about_you",
            "Tell me about yourself and the work you have done.",
            "A short arc: what you do, one or two things you have actually done, "
            "and what you are looking for now. Not a reading of the CV.",
        ),
        InterviewQuestion(
            "Q1_WHY_THIS_WORK",
            "interview.q.why_this_work",
            "Why do you want to work in this field?",
            "A real reason connected to something you have done or seen, "
            "rather than what the field is generally said to offer.",
        ),
        InterviewQuestion(
            "Q1_PROUD_OF",
            "interview.q.proud_of",
            "Describe a piece of work you are proud of. What did you do, and what happened?",
            "One specific piece of work, your own part in it stated plainly, "
            "and an outcome -- even an unmeasured one.",
        ),
        InterviewQuestion(
            "Q1_DIFFICULT_PROBLEM",
            "interview.q.difficult_problem",
            "Tell me about a problem at work that was difficult to solve.",
            "What made it difficult, what you tried, and what you settled on. "
            "The reasoning matters more than whether it worked.",
        ),
        InterviewQuestion(
            "Q1_LEARNED_RECENTLY",
            "interview.q.learned_recently",
            "What have you learned in the last year, and how did you learn it?",
            "Something concrete, and how they went about learning it. Self-taught counts fully.",
        ),
        InterviewQuestion(
            "Q1_QUESTIONS_FOR_US",
            "interview.q.questions_for_us",
            "What would you want to ask before accepting a job?",
            "Questions about the work itself. Having none prepared is the "
            "single most common missed opportunity in a real interview.",
        ),
    ),
)

# ---------------------------------------------------------------------------
# Session 2 -- working with other people
# ---------------------------------------------------------------------------

SET_TWO: Final = QuestionSet(
    "SET_2_WORKING_WITH_OTHERS",
    "Working with other people",
    (
        InterviewQuestion(
            "Q2_DISAGREEMENT",
            "interview.q.disagreement",
            "Tell me about a time you disagreed with a colleague or a manager.",
            "The disagreement described fairly from both sides, what they did "
            "about it, and what came of it. Not a story where they were "
            "simply right.",
        ),
        InterviewQuestion(
            "Q2_MISTAKE",
            "interview.q.mistake",
            "Describe a mistake you made at work. What did you do next?",
            "A real mistake owned without excessive apology, and the actions "
            "taken afterwards. Claiming never to have made one is the weak answer.",
        ),
        InterviewQuestion(
            "Q2_HELPED_SOMEONE",
            "interview.q.helped_someone",
            "Tell me about a time you helped someone else do their work better.",
            "A specific person and a specific change. Works equally for a "
            "manager and for someone with no reports at all.",
        ),
        InterviewQuestion(
            "Q2_UNCLEAR_INSTRUCTIONS",
            "interview.q.unclear_instructions",
            "What do you do when you have been given work you do not fully understand?",
            "Asking, and who they ask. The bad answer is guessing quietly.",
        ),
        InterviewQuestion(
            "Q2_PRESSURE",
            "interview.q.pressure",
            "Tell me about a time there was more work than time.",
            "How they decided what came first, and who they told. "
            "'I worked late' on its own is not a method.",
        ),
        InterviewQuestion(
            "Q2_FEEDBACK",
            "interview.q.feedback",
            "Tell me about feedback you received that was hard to hear.",
            "What the feedback was, and what actually changed afterwards.",
        ),
    ),
)

# ---------------------------------------------------------------------------
# Session 3 -- the uncomfortable ones
# ---------------------------------------------------------------------------
# Practising these is most of the value of a mock interview, because they are
# the questions people freeze on. Note what is absent: nothing here asks about
# age, marital status, family plans, caste or religion. Those get asked in real
# Indian interviews, and rehearsing them here would legitimise them.

SET_THREE: Final = QuestionSet(
    "SET_3_HARDER_GROUND",
    "The questions people find hardest",
    (
        InterviewQuestion(
            "Q3_WEAKNESS",
            "interview.q.weakness",
            "What part of your work do you find most difficult?",
            "An honest limitation and what they do to manage it. "
            "A disguised strength is the answer every interviewer has heard.",
        ),
        InterviewQuestion(
            "Q3_CAREER_CHANGE",
            "interview.q.career_change",
            "Why are you looking to change what you do, or where you do it?",
            "A forward-looking reason. Criticism of a previous employer lands "
            "badly even when it is deserved.",
        ),
        InterviewQuestion(
            "Q3_GAP",
            "interview.q.gap",
            "Is there a period in your history you would like to explain?",
            "A plain, unapologetic account. Candidates over-explain this far "
            "more often than interviewers care.",
            # Phrased as an invitation and answerable with 'no'. A mock
            # interview that demands an explanation for a gap teaches the
            # candidate that a gap requires one -- which is the belief that
            # makes them stumble on it.
        ),
        InterviewQuestion(
            "Q3_NO_EXPERIENCE",
            "interview.q.no_experience",
            "What would you do if you were asked to do something you have never done?",
            "A method: who they would ask, what they would read, how they would check the result.",
        ),
        InterviewQuestion(
            "Q3_WHY_YOU",
            "interview.q.why_you",
            "Why should this job go to you rather than someone else?",
            "Evidence rather than adjectives. 'Hardworking' is what everyone "
            "says; a thing they did is not.",
        ),
        InterviewQuestion(
            "Q3_FIVE_YEARS",
            "interview.q.five_years",
            "What kind of work would you like to be doing in a few years?",
            "A direction, not a title, and some connection to the work in front of them.",
        ),
    ),
)

QUESTION_SETS: Final[tuple[QuestionSet, ...]] = (SET_ONE, SET_TWO, SET_THREE)

QUESTIONS_PER_SESSION: Final = 6

#: Sessions beyond this earn no points (the +60 cap). A fourth purchase must be
#: confirmed explicitly before payment -- `interview/models.py` -- or it becomes
#: a refund request, and disputes cost more than the sale.
SESSIONS_THAT_EARN_POINTS: Final = 3


# ---------------------------------------------------------------------------
# The feedback rubric
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Dimension:
    code: str
    key: str
    label: str
    #: What a 0 and a 4 look like. Anchors, because "rate clarity out of four"
    #: without them is four different rubrics in four different reviewers.
    anchor_low: str
    anchor_high: str


DIMENSIONS: Final[tuple[Dimension, ...]] = (
    Dimension(
        "STRUCTURE",
        "interview.rubric.structure",
        "Structure",
        "The answer wanders, or stops before reaching a point.",
        "Situation, what they did, and what resulted -- in that order, without prompting.",
    ),
    Dimension(
        "SPECIFICITY",
        "interview.rubric.specificity",
        "Specifics",
        "General statements that could describe anyone's job.",
        "Named tasks, quantities, timescales, and real consequences.",
    ),
    Dimension(
        "OWNERSHIP",
        "interview.rubric.ownership",
        "Your own part",
        "Entirely 'we', so their own contribution cannot be identified.",
        "Their own part stated plainly, without taking the team's credit.",
    ),
    Dimension(
        "RELEVANCE",
        "interview.rubric.relevance",
        "Answering the question",
        "A prepared answer to a different question.",
        "Addresses what was actually asked, including the awkward part of it.",
    ),
    Dimension(
        "CLARITY",
        "interview.rubric.clarity",
        "Being followed",
        "A listener would have to ask what was meant.",
        "A listener follows it the first time.",
        # Scoped to comprehension only. Not accent, not fluency, not
        # vocabulary, not pace -- see this module's docstring. Judged in the
        # language the candidate chose to speak.
    ),
)

DIMENSION_CODES: Final[frozenset[str]] = frozenset(d.code for d in DIMENSIONS)

#: 0-4 per dimension, five dimensions, six questions.
RATING_MIN: Final = 0
RATING_MAX: Final = 4


def max_feedback_points() -> int:
    """The feedback total a candidate could receive across a session.

    **Not a score contribution.** It is reported back as feedback and has no
    path into `scoring` -- import-linter would fail the build if it did.
    """
    return len(DIMENSIONS) * RATING_MAX * QUESTIONS_PER_SESSION


def set_for_session(session_number: int) -> QuestionSet:
    """Session 1 gets set 1, and so on. A fourth session repeats the first.

    Deliberately not random: a candidate who buys three sessions is buying
    three different rehearsals, and a random draw would sometimes give them the
    same one twice.
    """
    if session_number < 1:
        raise ValueError("session numbers start at 1")
    return QUESTION_SETS[(session_number - 1) % len(QUESTION_SETS)]
