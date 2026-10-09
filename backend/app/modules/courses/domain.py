"""courses - pure domain logic

Catalogue, lessons, progress, completion, +30 contribution.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Completing a course means every published lesson watched** (client,
2026-09-29). There is no assessment.

That matters more than it sounds: a completion moves a real consumer's score by
up to 30 points, so the rule below is a *scoring* rule wearing the clothes of a
progress tracker. It is **versioned**. Every `course_completions` row stores
the `contribution_version` in force when it was written, so replacing this rule
re-scores from a known point instead of silently changing numbers under
existing candidates (invariant 1).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from urllib.parse import parse_qs, urlparse

#: The completion rule in force. **Bump this whenever the rule changes.**
#:
#: Stored on every completion row. Two candidates who completed the same course
#: under different rules are not comparable, and this is what makes that
#: visible rather than invisible.
COMPLETION_RULE_VERSION: Final = "lessons-watched-1-2026-09-29"

#: Invariant 4-prime. Also enforced by a CHECK constraint on `courses`, because
#: a cap that exists only in Python is a cap until someone writes SQL.
MAX_COURSE_CONTRIBUTION: Final = 30


@dataclass(frozen=True, slots=True)
class CourseProgress:
    """What we know about one candidate's progress through one course: of the
    lessons published now, how many they have watched."""

    lessons_total: int
    lessons_completed: int


@dataclass(frozen=True, slots=True)
class CompletionDecision:
    complete: bool
    rule_version: str
    reason: str


def evaluate_completion(progress: CourseProgress) -> CompletionDecision:
    """Every published lesson watched. Nothing else, and nothing less.

    A course with no lessons can never be completed: +30 for watching nothing
    is the refund and the review the catalogue exists to prevent.

    `reason` is a code, not a sentence -- it is read by an admin drill-down
    and rendered in the candidate's language.
    """
    if progress.lessons_total <= 0:
        return CompletionDecision(False, COMPLETION_RULE_VERSION, "course_has_no_lessons")
    if progress.lessons_completed < progress.lessons_total:
        return CompletionDecision(False, COMPLETION_RULE_VERSION, "lessons_incomplete")
    return CompletionDecision(True, COMPLETION_RULE_VERSION, "complete")


def percent_complete(progress: CourseProgress) -> int:
    """Whole percent, rounded down, so 99.9% never reads as done."""
    if progress.lessons_total <= 0:
        return 0
    done = min(progress.lessons_completed, progress.lessons_total)
    return (100 * done) // progress.lessons_total


def clamp_contribution(points: int) -> int:
    """Bound a course's contribution. Invariant 4-prime.

    A pure function so the property tests can throw any ordering or quantity of
    completions at it: no sequence of them may exceed the cap.
    """
    return max(0, min(points, MAX_COURSE_CONTRIBUTION))


# ---------------------------------------------------------------------------
# Watching a lesson
# ---------------------------------------------------------------------------
#: Watched means reaching this far into it. The last seconds of a lesson are
#: usually a sign-off, and a player rarely reports the very end.
WATCHED_FRACTION: Final = 0.9

#: ...and at least this share of the lesson's length having passed since it
#: was first opened. A lesson counts toward a score, so dragging the slider to
#: the end is not watching it. Generous on purpose: people watch at 1.5x.
MIN_ELAPSED_FRACTION: Final = 0.5


def clamp_position(position_seconds: int, *, duration_seconds: int) -> int:
    return max(0, min(position_seconds, duration_seconds))


def lesson_watched(
    *,
    duration_seconds: int,
    furthest_seconds: int,
    first_opened_at: datetime,
    now: datetime,
) -> bool:
    """Whether a lesson counts as watched: far enough in, for long enough.

    The client reports where the player is; it cannot report that time has
    passed, so the elapsed half is measured from our own first record of the
    lesson being opened.
    """
    if duration_seconds <= 0:
        return False
    reached = furthest_seconds >= math.ceil(WATCHED_FRACTION * duration_seconds)
    elapsed = now - first_opened_at >= timedelta(seconds=MIN_ELAPSED_FRACTION * duration_seconds)
    return reached and elapsed


# ---------------------------------------------------------------------------
# Lesson media (2026-09-29)
# ---------------------------------------------------------------------------
# A lesson is either a YouTube video, embedded, or a file uploaded to our own
# bucket and served by presigned GET. The client asked for both.
#
# **An unlisted YouTube video is not behind the paywall.** Anyone holding the
# link can watch it. It is convenient, and it is the client's choice; an
# upload is the option that actually keeps a lesson for paying candidates.

MEDIA_YOUTUBE: Final = "YOUTUBE"
MEDIA_UPLOAD: Final = "UPLOAD"
MEDIA_KINDS: Final = (MEDIA_YOUTUBE, MEDIA_UPLOAD)

#: An embed that sets no tracking cookie until the video plays.
YOUTUBE_EMBED_BASE: Final = "https://www.youtube-nocookie.com/embed/"
_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_HOSTS: Final = frozenset(
    {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"}
)

#: MP4 and WebM: what every browser and both phone platforms play natively.
ACCEPTED_VIDEO_TYPES: Final = ("video/mp4", "video/webm")
#: A lesson of an hour at a good bitrate. Checked on the stored object: a
#: presigned PUT cannot enforce a size.
MAX_VIDEO_BYTES: Final = 2 * 1024 * 1024 * 1024
MIN_VIDEO_BYTES: Final = 10 * 1024

MAX_LESSON_SECONDS: Final = 4 * 60 * 60


def youtube_video_id(url: str) -> str | None:
    """The 11-character video id from a YouTube link, or None.

    Accepts watch, share (`youtu.be`), embed, shorts and live links. **Only
    YouTube's own hosts**: anything else is refused rather than embedded,
    because an embed is a page we put in front of a candidate.
    """
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("https", "http") or (parsed.hostname or "") not in _YOUTUBE_HOSTS:
        return None
    host = parsed.hostname or ""
    parts = [p for p in parsed.path.split("/") if p]
    candidate: str | None = None
    if host == "youtu.be":
        candidate = parts[0] if parts else None
    elif parts[:1] == ["watch"]:
        values = parse_qs(parsed.query).get("v") or []
        candidate = values[0] if values else None
    elif len(parts) >= 2 and parts[0] in ("embed", "shorts", "live", "v"):
        candidate = parts[1]
    return candidate if candidate is not None and _YOUTUBE_ID.match(candidate) else None


def youtube_embed_url(video_id: str) -> str:
    return f"{YOUTUBE_EMBED_BASE}{video_id}"


def sniff_video(head: bytes) -> str | None:
    """The container, from its magic bytes. Never from a Content-Type."""
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "video/mp4"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    return None


def lesson_media_key(*, course_code: str, lesson_id: str) -> str:
    """Derived from ids the server issued; staff never name a key."""
    return f"course-media/{course_code}/{lesson_id}"
