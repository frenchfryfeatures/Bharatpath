"""interview - pure domain logic

Audio sessions, chunk upload, evaluation, +20/session.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Four rules live here**, and the session machine has a twin below the service
(`guard_interview_session_write`, generated from `SESSION_TRANSITIONS`):

  1. **The device check runs before payment** (SRS 1.10.1) and is judged here,
     never by the client. The client reports what it measured; whether that
     passes is ours to decide, versioned, so a threshold change is visible.
     Audio only: no camera row, no lighting row.
  2. **A completed session records +20, and the +60 cap is not here.** It lives
     in `scoring/domain.py`. This module records that a session finished and
     what one is worth; clamping the total is scoring's job, so a fourth
     completion still records +20 and scoring folds in none of it.
  3. **Whether a purchase can still earn points is decided before payment**
     (`purchase_earns_points`), so the app can say "this session will not
     increase your score" and require it to be acknowledged. Without that a
     fourth session is a refund request.
  4. **An answer is judged by what was stored**, not by what the client says
     it uploaded: size from S3, format sniffed from the bytes.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from app.modules.interview.bank import (
    ANSWER_SECONDS,
    DIMENSIONS,
    QUESTION_SETS,
    QUESTIONS_PER_SESSION,
    RATING_MAX,
    RATING_MIN,
    SESSIONS_THAT_EARN_POINTS,
    InterviewQuestion,
    set_for_session,
)

# ---------------------------------------------------------------------------
# The contribution
# ---------------------------------------------------------------------------
#: What one completed session records. Also a CHECK on `interview_sessions`.
POINTS_PER_SESSION: Final = 20

#: Stored on every completed session. **Bump when what a completion is worth,
#: or what counts as one, changes** -- a replay reads the version it was
#: computed under, not today's.
CONTRIBUTION_VERSION: Final = "interview-1"

# ---------------------------------------------------------------------------
# The device check
# ---------------------------------------------------------------------------
DEVICE_CHECK_RULE_VERSION: Final = "device-1"

#: Opus mono at 16 kHz is 16-24 kbps. Answers upload after each one is
#: recorded, so the link only has to carry one ~20 KB-per-30s file at a time;
#: this refuses a dead connection, not a slow one. 2G EDGE clears it.
MIN_NETWORK_KBPS: Final = 16

#: Six answers of two minutes at a generous bitrate is ~6 MB. The client keeps
#: answers locally until each upload is confirmed (SRS 1.10.5), so it needs
#: room for all of them at once, plus headroom.
MIN_STORAGE_MB: Final = 20

#: A passed check is good for this long. Long enough to pay by UPI and start;
#: short enough that "passed yesterday on home Wi-Fi" does not start a session
#: on a bus. Re-running it costs the candidate seconds.
DEVICE_CHECK_VALID_FOR: Final = timedelta(minutes=60)


@dataclass(frozen=True, slots=True)
class DeviceReadings:
    """What the app measured. Audio only -- there is nothing about a camera."""

    mic_ok: bool
    audio_out_ok: bool
    network_kbps: int | None
    storage_mb: int | None
    quiet_env_ok: bool


@dataclass(frozen=True, slots=True)
class DeviceCheckDecision:
    passed: bool
    #: Codes, in a fixed order, for the app to render in the candidate's
    #: language. Empty when passed.
    failures: tuple[str, ...]
    rule_version: str = DEVICE_CHECK_RULE_VERSION


def evaluate_device_check(readings: DeviceReadings) -> DeviceCheckDecision:
    """Every failing check is reported, not just the first, so a candidate
    fixes everything in one go rather than discovering problems one retry at
    a time.

    A reading the app could not take (`None`) fails: a check that passes on
    missing data is not a check, and the point of running it before payment
    is that nobody pays and then cannot start.
    """
    failures: list[str] = []
    if not readings.mic_ok:
        failures.append("microphone_unavailable")
    if not readings.audio_out_ok:
        failures.append("audio_output_unavailable")
    if readings.network_kbps is None or readings.network_kbps < MIN_NETWORK_KBPS:
        failures.append("network_too_slow")
    if readings.storage_mb is None or readings.storage_mb < MIN_STORAGE_MB:
        failures.append("storage_insufficient")
    if not readings.quiet_env_ok:
        failures.append("environment_too_noisy")
    return DeviceCheckDecision(passed=not failures, failures=tuple(failures))


def device_check_is_fresh(*, checked_at: datetime, now: datetime) -> bool:
    return checked_at <= now < checked_at + DEVICE_CHECK_VALID_FOR


# ---------------------------------------------------------------------------
# Buying a session
# ---------------------------------------------------------------------------
def purchase_earns_points(*, sessions_held: int) -> bool:
    """Whether one more session can still move the score.

    `sessions_held` is every session the candidate has already paid for that
    has not been thrown away: completed ones, the one in progress, and
    purchases not yet started. An abandoned session earned nothing and is not
    counted, so abandoning one does not use up a place under the cap.

    Mirrors the cap in `scoring/domain.py` for the purpose of *telling the
    candidate before they pay*. It decides nothing about the score: scoring
    applies its own cap to what was actually completed.
    """
    return max(0, sessions_held) < SESSIONS_THAT_EARN_POINTS


# ---------------------------------------------------------------------------
# The session
# ---------------------------------------------------------------------------
#: Sessions a candidate is still recording.
OPEN_STATES: Final = frozenset({"CREATED", "IN_PROGRESS"})
#: Sessions that were completed, and so carry a contribution. FAILED is an
#: evaluation that could not produce feedback: the session was still
#: completed, and points are for completing (`bank.py`), so it keeps them.
COMPLETED_STATES: Final = frozenset({"COMPLETED", "EVALUATED", "FAILED"})
SESSION_STATES: Final = OPEN_STATES | COMPLETED_STATES | {"ABANDONED"}

#: `from -> to`. Compiled into `guard_interview_session_write`.
SESSION_TRANSITIONS: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("CREATED", "IN_PROGRESS"),
        ("CREATED", "ABANDONED"),
        ("IN_PROGRESS", "ABANDONED"),
        ("IN_PROGRESS", "COMPLETED"),
        ("COMPLETED", "EVALUATED"),
        ("COMPLETED", "FAILED"),
    }
)


def can_complete(*, stored_indexes: set[int]) -> bool:
    """Every question answered and stored. Not how well: completing is what
    awards points (`bank.py`)."""
    return stored_indexes >= set(range(QUESTIONS_PER_SESSION))


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------
#: Two minutes of AAC at 64 kbps is under 1 MB. Double that, and no more: a
#: presigned PUT cannot enforce a size, so this is checked on the stored object.
MAX_ANSWER_BYTES: Final = 2 * 1024 * 1024
#: A second of Opus is a few KB. Anything smaller is not a spoken answer.
MIN_ANSWER_BYTES: Final = 1024
MIN_ANSWER_MS: Final = 1_000
#: The recording stops at `ANSWER_SECONDS`; a few seconds of slack for the
#: container and a clock that started late.
MAX_ANSWER_MS: Final = (ANSWER_SECONDS + 5) * 1000

#: Opus in Ogg or WebM, AAC as ADTS or in MP4. What Android and iOS record to.
ACCEPTED_AUDIO_TYPES: Final = ("audio/ogg", "audio/webm", "audio/aac", "audio/mp4")


def answer_key(*, user_id: uuid.UUID, session_id: uuid.UUID, question_index: int) -> str:
    """Derived from ids the server issued. **The client never names a key**:
    a presigned PUT authorises exactly the key it signs, so a client-chosen key
    is a candidate writing over someone else's answer."""
    return f"interview-audio/{user_id}/{session_id}/{question_index}"


def valid_question_index(index: int) -> bool:
    return 0 <= index < QUESTIONS_PER_SESSION


def sniff_audio(head: bytes) -> str | None:
    """The container, from its magic bytes. Never from a client's Content-Type."""
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "audio/mp4"
    # ADTS: a 12-bit sync word, then layer bits that are always 00.
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xF6) == 0xF0:
        return "audio/aac"
    return None


@dataclass(frozen=True, slots=True)
class AnswerRejection:
    code: str
    detail: str


def validate_answer(*, head: bytes, size_bytes: int, duration_ms: int) -> AnswerRejection | None:
    if size_bytes > MAX_ANSWER_BYTES:
        return AnswerRejection("answer_too_large", f"at most {MAX_ANSWER_BYTES} bytes")
    if size_bytes < MIN_ANSWER_BYTES:
        return AnswerRejection("answer_too_small", "the recording holds no answer")
    if sniff_audio(head) is None:
        return AnswerRejection("answer_not_audio", "Opus or AAC audio only")
    if not MIN_ANSWER_MS <= duration_ms <= MAX_ANSWER_MS:
        return AnswerRejection(
            "answer_duration_out_of_range", f"between {MIN_ANSWER_MS} and {MAX_ANSWER_MS} ms"
        )
    return None


# ---------------------------------------------------------------------------
# Evaluation -- feedback, never a number
# ---------------------------------------------------------------------------
#: Stored on every evaluation. **Bump when the report's shape or the level
#: thresholds change**, so an old report can still be read as it was written.
REPORT_VERSION: Final = "report-1"

#: The two outcomes an evaluation records. A session moves to the same state.
EVALUATION_OUTCOMES: Final = frozenset({"EVALUATED", "FAILED"})

#: Why an evaluation produced no feedback. Codes, for the app to render.
FAILURE_NO_SPEECH: Final = "no_speech"
FAILURE_EVALUATION_INVALID: Final = "evaluation_invalid"

#: A transcript shorter than this, stripped, is treated as no answer. A few
#: characters is what a speech model returns for a cough or a click.
MIN_SPOKEN_CHARS: Final = 3

MAX_COMMENT_CHARS: Final = 600

#: What a candidate is shown per dimension. **Words, not numbers**: a 0-4
#: rating averaged across six answers and shown beside a three-digit score is
#: a second score, and a second unexplained one (R11). The ratings are stored
#: for disputes and never leave the service.
LEVEL_STRONG: Final = "STRONG"
LEVEL_DEVELOPING: Final = "DEVELOPING"
LEVEL_FOCUS_AREA: Final = "FOCUS_AREA"


class EvaluationInvalid(ValueError):
    """The evaluator's output does not fit the rubric. Never repaired: a
    report built from guessed ratings is feedback nobody gave."""


@dataclass(frozen=True, slots=True)
class QuestionEvaluation:
    question_code: str
    #: Dimension code -> 0..4. Every rubric dimension, no others.
    ratings: dict[str, int]
    comment: str


def is_spoken(transcript: str | None) -> bool:
    return transcript is not None and len(transcript.strip()) >= MIN_SPOKEN_CHARS


def parse_evaluation(
    raw: object, *, question_codes: tuple[str, ...], dimension_codes: frozenset[str]
) -> tuple[QuestionEvaluation, ...]:
    """Read an evaluator's response, exactly, or refuse it.

    Expected: `{"questions": [{"question_code", "ratings": {DIM: 0-4}, "comment"}]}`
    with one entry per question in `question_codes` -- the spoken ones; a silent
    answer is not sent, so it cannot be rated. A missing question, an extra
    one, a missing or unknown dimension, a non-integer or out-of-range rating
    all refuse the whole response. `bool` is not an integer here, although
    Python says it is.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("questions"), list):
        raise EvaluationInvalid("expected an object with a `questions` list")
    by_code: dict[str, QuestionEvaluation] = {}
    for item in raw["questions"]:
        if not isinstance(item, dict):
            raise EvaluationInvalid("each question must be an object")
        code = item.get("question_code")
        if not isinstance(code, str) or code not in question_codes:
            raise EvaluationInvalid(f"unexpected question {code!r}")
        if code in by_code:
            raise EvaluationInvalid(f"question {code} rated twice")
        ratings = item.get("ratings")
        if not isinstance(ratings, dict) or set(ratings) != dimension_codes:
            raise EvaluationInvalid(f"question {code} must rate exactly the rubric dimensions")
        for dimension, value in ratings.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise EvaluationInvalid(f"{code}.{dimension} is not an integer")
            if not RATING_MIN <= value <= RATING_MAX:
                raise EvaluationInvalid(f"{code}.{dimension} is out of range")
        comment = item.get("comment", "")
        if not isinstance(comment, str) or len(comment) > MAX_COMMENT_CHARS:
            raise EvaluationInvalid(f"question {code} has an unusable comment")
        by_code[code] = QuestionEvaluation(code, dict(ratings), comment.strip())
    missing = [code for code in question_codes if code not in by_code]
    if missing:
        raise EvaluationInvalid(f"questions not rated: {missing}")
    return tuple(by_code[code] for code in question_codes)


def level_for(ratings: list[int]) -> str:
    """A dimension's level across the answers that were rated.

    Mean of at least 3 is STRONG, at least 2 DEVELOPING, else FOCUS_AREA.
    Integer arithmetic on purpose (`total >= 3 * n`), so no float boundary
    decides which word a candidate reads.
    """
    if not ratings:
        return LEVEL_FOCUS_AREA
    total, n = sum(ratings), len(ratings)
    if total >= 3 * n:
        return LEVEL_STRONG
    if total >= 2 * n:
        return LEVEL_DEVELOPING
    return LEVEL_FOCUS_AREA


@dataclass(frozen=True, slots=True)
class DimensionFeedback:
    code: str
    key: str
    label: str
    level: str
    #: What the top of this dimension sounds like -- the thing to aim at.
    what_good_looks_like: str


@dataclass(frozen=True, slots=True)
class QuestionFeedback:
    index: int
    code: str
    prompt: str
    looking_for: str
    transcript: str
    spoken: bool
    comment: str | None


@dataclass(frozen=True, slots=True)
class InterviewReport:
    report_version: str
    dimensions: tuple[DimensionFeedback, ...]
    strengths: tuple[str, ...]
    focus_areas: tuple[str, ...]
    questions: tuple[QuestionFeedback, ...]


def assemble_report(
    *,
    questions: tuple[InterviewQuestion, ...],
    transcripts: dict[int, str],
    evaluations: tuple[QuestionEvaluation, ...],
) -> InterviewReport:
    """The candidate's feedback, from stored transcripts and stored ratings.

    Deterministic and pure: the same rows always produce the same report, so a
    report is re-assembled on every read rather than stored twice. **No total,
    no average, no rating** leaves this function -- only levels, in words.

    `questions` are the ones this session actually asked, in order: written
    for the candidate since 2026-09-29, a bank set before that.
    """
    rated = {e.question_code: e for e in evaluations}
    dimensions = tuple(
        DimensionFeedback(
            code=d.code,
            key=d.key,
            label=d.label,
            level=level_for([e.ratings[d.code] for e in evaluations]),
            what_good_looks_like=d.anchor_high,
        )
        for d in DIMENSIONS
    )
    feedback = tuple(
        QuestionFeedback(
            index=index,
            code=q.code,
            prompt=q.prompt,
            looking_for=q.looking_for,
            transcript=(transcripts.get(index) or "").strip(),
            spoken=is_spoken(transcripts.get(index)),
            comment=(rated[q.code].comment or None) if q.code in rated else None,
        )
        for index, q in enumerate(questions)
    )
    return InterviewReport(
        report_version=REPORT_VERSION,
        dimensions=dimensions,
        strengths=tuple(d.code for d in dimensions if d.level == LEVEL_STRONG),
        focus_areas=tuple(d.code for d in dimensions if d.level == LEVEL_FOCUS_AREA),
        questions=feedback,
    )


# ---------------------------------------------------------------------------
# Questions written for the candidate (2026-09-29)
# ---------------------------------------------------------------------------
# The client asked for questions drawn from the candidate's CV and onboarding
# answers, each one either following up what they just said or opening new
# ground -- and **never a question they were asked in an earlier session**,
# because a second paid rehearsal that repeats the first is money wasted.
#
# A model writes every question -- there are no fixed ones (client,
# 2026-09-29) -- and these rules decide whether what it wrote may be asked.
# The model is told every earlier question and asked not to repeat one, and
# `parse_drafted_question` refuses an exact repeat anyway, because a
# rule that lives only in a prompt is a request. "Exact" is after
# `normalise_prompt`: case, punctuation and spacing do not make a new question.

#: The session-level code of a session whose questions were written for it.
ADAPTIVE_SET_CODE: Final = "ADAPTIVE"
ADAPTIVE_SET_TITLE: Final = "Questions written for you"

#: Where a question came from. Every question since 2026-09-29 is MODEL; BANK
#: is kept for the schema's sake and never written now.
KIND_OPENING: Final = "OPENING"
KIND_FOLLOW_UP: Final = "FOLLOW_UP"
KIND_NEW_TOPIC: Final = "NEW_TOPIC"
KIND_BANK: Final = "BANK"
QUESTION_KINDS: Final = (KIND_OPENING, KIND_FOLLOW_UP, KIND_NEW_TOPIC, KIND_BANK)
SOURCE_MODEL: Final = "MODEL"
SOURCE_BANK: Final = "BANK"
QUESTION_SOURCES: Final = (SOURCE_MODEL, SOURCE_BANK)

MIN_PROMPT_CHARS: Final = 12
MAX_PROMPT_CHARS: Final = 400
MIN_LOOKING_FOR_CHARS: Final = 12
MAX_LOOKING_FOR_CHARS: Final = 600

#: Drafts the model gets per question before the request is a 503 the app
#: retries. Each retry is told what was refused and why.
MAX_DRAFT_ATTEMPTS: Final = 3

#: How much CV the model is shown. A long CV is mostly repetition, and the
#: prompt is paid per token on every question of every session.
MAX_RESUME_CHARS_FOR_QUESTIONS: Final = 12_000

_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")
# The same shapes the log redactor catches, applied to a CV before it leaves
# for a model. The question writer needs someone's work, not how to reach them.
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_PHONE = re.compile(r"\+?\d[\d\s\-()]{8,14}\d")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
REDACTED: Final = "[removed]"


class QuestionInvalid(ValueError):
    """What the model wrote cannot be asked. The service asks the model again,
    saying why; nothing is written until a question may be asked."""


@dataclass(frozen=True, slots=True)
class DraftedQuestion:
    kind: str
    prompt: str
    looking_for: str


def normalise_prompt(prompt: str) -> str:
    """The comparison form of a question: lower case, no punctuation, single
    spaces. Two prompts equal here are the same question."""
    return _SPACES.sub(" ", _NON_WORD.sub(" ", prompt.casefold())).strip()


def redact_contacts(text: str, *, known: Iterable[str | None] = ()) -> str:
    """Remove email addresses, phone numbers, links, and any `known` value
    (the account's own phone, email and name) from CV text."""
    for value in known:
        if value and len(value.strip()) >= 3:
            text = re.sub(re.escape(value.strip()), REDACTED, text, flags=re.IGNORECASE)
    text = _EMAIL.sub(REDACTED, text)
    text = _URL.sub(REDACTED, text)
    return _PHONE.sub(REDACTED, text)


def allowed_kinds(index: int) -> tuple[str, ...]:
    """The first question opens; every later one follows up or moves on."""
    return (KIND_OPENING,) if index == 0 else (KIND_FOLLOW_UP, KIND_NEW_TOPIC)


def parse_drafted_question(
    raw: object, *, index: int, already_asked: Iterable[str]
) -> DraftedQuestion:
    """Read what the model wrote, exactly, or refuse it.

    Expected: `{"kind", "prompt", "looking_for"}`. Refused: a kind this
    position cannot have, text too short or too long, and **any prompt the
    candidate has been asked before** -- in this session or any earlier one.
    """
    if not isinstance(raw, dict):
        raise QuestionInvalid("expected an object")
    kind, prompt, looking_for = raw.get("kind"), raw.get("prompt"), raw.get("looking_for")
    if kind not in allowed_kinds(index):
        raise QuestionInvalid(f"kind {kind!r} is not allowed at question {index}")
    if not isinstance(prompt, str) or not isinstance(looking_for, str):
        raise QuestionInvalid("prompt and looking_for must be text")
    prompt, looking_for = prompt.strip(), looking_for.strip()
    if not MIN_PROMPT_CHARS <= len(prompt) <= MAX_PROMPT_CHARS:
        raise QuestionInvalid("prompt length out of range")
    if not MIN_LOOKING_FOR_CHARS <= len(looking_for) <= MAX_LOOKING_FOR_CHARS:
        raise QuestionInvalid("looking_for length out of range")
    if normalise_prompt(prompt) in {normalise_prompt(p) for p in already_asked}:
        raise QuestionInvalid("the candidate has been asked this before")
    return DraftedQuestion(str(kind), prompt, looking_for)


def generated_question_code(*, session_number: int, index: int) -> str:
    """Unique within a session, and says where it sits: `S2Q4`."""
    return f"S{session_number}Q{index + 1}"


def bank_questions_for(
    *, question_set_code: str, session_number: int
) -> tuple[InterviewQuestion, ...]:
    """The questions a session asked before questions were stored per session:
    the bank set it names. A written (ADAPTIVE) session always stores its
    questions, so without rows it has asked none yet."""
    if question_set_code == ADAPTIVE_SET_CODE:
        return ()
    for question_set in QUESTION_SETS:
        if question_set.code == question_set_code:
            return question_set.questions
    return set_for_session(session_number).questions
