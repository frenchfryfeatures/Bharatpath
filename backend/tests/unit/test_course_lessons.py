"""Lessons (2026-09-29): what counts as a YouTube link, what counts as
watching a lesson, and what counts as a video.

Watching a lesson moves a score once every lesson is watched, so "watched" is
decided on the server, from where the player got to **and** from time that
really passed since the lesson was first opened.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.modules.courses.domain import (
    YOUTUBE_EMBED_BASE,
    clamp_position,
    lesson_media_key,
    lesson_watched,
    sniff_video,
    youtube_embed_url,
    youtube_video_id,
)

VIDEO = "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VIDEO}",
        f"https://youtube.com/watch?v={VIDEO}&t=42s",
        f"https://m.youtube.com/watch?feature=share&v={VIDEO}",
        f"https://youtu.be/{VIDEO}",
        f"https://youtu.be/{VIDEO}?si=abc",
        f"https://www.youtube.com/embed/{VIDEO}",
        f"https://www.youtube.com/shorts/{VIDEO}",
        f"https://www.youtube.com/live/{VIDEO}",
        f"https://www.youtube-nocookie.com/embed/{VIDEO}",
        f"  https://youtu.be/{VIDEO}  ",
    ],
)
def test_every_form_of_youtube_link_gives_the_video(url: str) -> None:
    assert youtube_video_id(url) == VIDEO


@pytest.mark.parametrize(
    "url",
    [
        f"https://vimeo.com/{VIDEO}",
        f"https://youtube.com.evil.example/watch?v={VIDEO}",
        f"https://evil.example/?u=https://youtu.be/{VIDEO}",
        f"javascript:alert('{VIDEO}')",
        f"ftp://youtu.be/{VIDEO}",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/channel/UCabcdefghij",
        "https://youtu.be/",
        "",
    ],
)
def test_anything_that_is_not_a_youtube_video_is_refused(url: str) -> None:
    """An embed is a page put in front of a candidate: only YouTube's own."""
    assert youtube_video_id(url) is None


def test_the_embed_sets_no_cookie_until_played() -> None:
    assert youtube_embed_url(VIDEO) == f"{YOUTUBE_EMBED_BASE}{VIDEO}"
    assert "youtube-nocookie.com" in YOUTUBE_EMBED_BASE


# --- watching -------------------------------------------------------------------------
OPENED = datetime(2026, 9, 29, 10, 0, tzinfo=UTC)


def test_a_lesson_watched_to_ninety_percent_over_enough_time_counts() -> None:
    assert lesson_watched(
        duration_seconds=600,
        furthest_seconds=540,
        first_opened_at=OPENED,
        now=OPENED + timedelta(minutes=5),
    )


def test_dragging_the_slider_to_the_end_is_not_watching() -> None:
    assert not lesson_watched(
        duration_seconds=600,
        furthest_seconds=600,
        first_opened_at=OPENED,
        now=OPENED + timedelta(seconds=30),
    )


def test_leaving_it_open_without_reaching_the_end_is_not_watching() -> None:
    assert not lesson_watched(
        duration_seconds=600,
        furthest_seconds=539,
        first_opened_at=OPENED,
        now=OPENED + timedelta(hours=3),
    )


def test_a_lesson_with_no_length_can_never_be_watched() -> None:
    assert not lesson_watched(
        duration_seconds=0, furthest_seconds=0, first_opened_at=OPENED, now=OPENED
    )


def test_a_reported_position_is_held_inside_the_lesson() -> None:
    assert clamp_position(-5, duration_seconds=100) == 0
    assert clamp_position(5_000, duration_seconds=100) == 100
    assert clamp_position(42, duration_seconds=100) == 42


# --- uploads --------------------------------------------------------------------------
def test_a_video_is_known_by_its_bytes() -> None:
    assert sniff_video(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 8) == "video/mp4"
    assert sniff_video(b"\x1a\x45\xdf\xa3" + b"\x00" * 8) == "video/webm"
    assert sniff_video(b"%PDF-1.7 not a video") is None
    assert sniff_video(b"") is None


def test_staff_never_name_the_key_a_video_is_stored_under() -> None:
    assert lesson_media_key(course_code="C1", lesson_id="abc") == "course-media/C1/abc"
