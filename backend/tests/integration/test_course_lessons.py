"""The course, built in the console and watched by candidates (2026-09-29).

Staff build it from YouTube links or uploaded videos and put it on sale; a
candidate sees the syllabus locked until they buy it; watching every lesson
completes it, recorded by the system and never by a route. Each test works on
its own `TEST_COURSE_...` code, so the real course stays off sale for the rest
of the suite.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.courses.domain import COMPLETION_RULE_VERSION
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _staff
from tests.integration.test_candidate_marketplace import _subscribe
from tests.integration.test_payments import _candidate, _scalar, _settle
from tests.integration.test_resume_intake import FakeS3

pytestmark = pytest.mark.integration

API = "/api/v1"
ADMIN = f"{API}/admin"
COURSES = f"{API}/candidate/courses"
VIDEO = "dQw4w9WgXcQ"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 20_000


async def _course(*, active: bool) -> tuple[uuid.UUID, str]:
    course_id, code = uuid.uuid4(), f"TEST_COURSE_{uuid.uuid4().hex[:12].upper()}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO courses (id, code, title, price_minor, contribution_points, active, "
                "version) VALUES (:i, :c, 'Test course', 49900, 30, :a, 1)"
            ),
            {"i": str(course_id), "c": code, "a": active},
        )
    return course_id, code


async def _youtube_lesson(
    client: Any, staff: dict[str, Any], code: str, *, duration: int = 600
) -> dict[str, Any]:
    module = await client.post(
        f"{ADMIN}/courses/{code}/modules", json={"title": "Basics"}, headers=staff["headers"]
    )
    assert module.status_code == 201, module.text
    module_id = module.json()["modules"][-1]["id"]
    lesson = await client.post(
        f"{ADMIN}/course-modules/{module_id}/lessons",
        json={
            "title": "Writing an email",
            "duration_seconds": duration,
            "youtube_url": f"https://youtu.be/{VIDEO}",
        },
        headers=staff["headers"],
    )
    assert lesson.status_code == 201, lesson.text
    return dict(lesson.json())


async def _buyer(client: Any, mint_token: Any, course_id: uuid.UUID) -> dict[str, Any]:
    me = await _candidate(mint_token)
    await _subscribe(me["id"])
    checkout = await client.post(f"{COURSES}/{course_id}/checkout", headers=me["headers"])
    assert checkout.status_code == 201, checkout.text
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"
    return me


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    from app.core import storage

    fake = FakeS3()
    for name in ("head_object", "read_head_bytes", "delete_object", "presign_put"):
        monkeypatch.setattr(storage, name, getattr(fake, name))

    async def presign_get(*, bucket: str, key: str, expires_in: int) -> str:
        return f"https://s3.example/{bucket}/{key}?ttl={expires_in}"

    monkeypatch.setattr(storage, "presign_get", presign_get)
    return fake


# ===========================================================================
# Building it
# ===========================================================================
async def test_a_course_goes_on_sale_only_with_a_playable_lesson(
    client: Any, mint_token: Any
) -> None:
    staff = await _staff(mint_token)
    _, code = await _course(active=False)

    empty = await client.put(
        f"{ADMIN}/courses/{code}/published", json={"published": True}, headers=staff["headers"]
    )
    assert empty.status_code == 409 and empty.json()["code"] == "course_not_publishable"

    lesson = await _youtube_lesson(client, staff, code)
    assert lesson["media_kind"] == "YOUTUBE" and lesson["media_ready"]
    assert lesson["youtube_video_id"] == VIDEO

    published = await client.put(
        f"{ADMIN}/courses/{code}/published", json={"published": True}, headers=staff["headers"]
    )
    assert published.status_code == 200, published.text
    assert published.json()["published"] is True
    changes = await _scalar(
        "SELECT count(*) FROM audit_events WHERE action = 'course_content_changed' "
        "AND actor_id = :u",
        u=staff["user_id"],
    )
    assert changes == 3, "module, lesson, publish"


async def test_a_link_that_is_not_youtube_is_refused(client: Any, mint_token: Any) -> None:
    staff = await _staff(mint_token)
    _, code = await _course(active=False)
    module = await client.post(
        f"{ADMIN}/courses/{code}/modules", json={"title": "M"}, headers=staff["headers"]
    )
    module_id = module.json()["modules"][-1]["id"]
    refused = await client.post(
        f"{ADMIN}/course-modules/{module_id}/lessons",
        json={"title": "L", "duration_seconds": 60, "youtube_url": "https://vimeo.com/1"},
        headers=staff["headers"],
    )
    assert refused.status_code == 422
    assert refused.json()["params"]["reason"] == "youtube_url_invalid"


async def test_an_uploaded_lesson_plays_only_once_its_video_is_checked(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    staff = await _staff(mint_token)
    _, code = await _course(active=False)
    module = await client.post(
        f"{ADMIN}/courses/{code}/modules", json={"title": "M"}, headers=staff["headers"]
    )
    module_id = module.json()["modules"][-1]["id"]
    lesson = (
        await client.post(
            f"{ADMIN}/course-modules/{module_id}/lessons",
            json={"title": "Uploaded", "duration_seconds": 300},
            headers=staff["headers"],
        )
    ).json()
    assert lesson["media_kind"] == "UPLOAD" and not lesson["media_ready"]

    ticket = await client.post(
        f"{ADMIN}/course-lessons/{lesson['id']}/upload", headers=staff["headers"]
    )
    assert ticket.status_code == 200, ticket.text
    key = f"course-media/{code}/{lesson['id']}"
    assert key in ticket.json()["url"]

    fake_s3.objects[key] = b"%PDF-1.7 " + b"x" * 20_000
    not_video = await client.post(
        f"{ADMIN}/course-lessons/{lesson['id']}/upload/confirm", headers=staff["headers"]
    )
    assert not_video.status_code == 422
    assert not_video.json()["params"]["reason"] == "upload_not_video"
    assert key not in fake_s3.objects, "refused bytes are deleted"

    fake_s3.objects[key] = MP4
    confirmed = await client.post(
        f"{ADMIN}/course-lessons/{lesson['id']}/upload/confirm", headers=staff["headers"]
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["media_ready"] and confirmed.json()["mime"] == "video/mp4"


# ===========================================================================
# Buying and watching it
# ===========================================================================
async def test_the_syllabus_is_visible_and_locked_until_bought(
    client: Any, mint_token: Any
) -> None:
    staff = await _staff(mint_token)
    course_id, code = await _course(active=True)
    lesson = await _youtube_lesson(client, staff, code)

    me = await _candidate(mint_token)
    await _subscribe(me["id"])
    [listed] = [
        c for c in (await client.get(COURSES, headers=me["headers"])).json() if c["code"] == code
    ]
    assert listed["locked"] is True and listed["lessons_total"] == 1
    locked = (await client.get(f"{COURSES}/{course_id}", headers=me["headers"])).json()
    [only] = locked["modules"][0]["lessons"]
    assert only["id"] == lesson["id"] and only["media_url"] is None

    progress = await client.post(
        f"{COURSES}/{course_id}/lessons/{lesson['id']}/progress",
        json={"position_seconds": 10},
        headers=me["headers"],
    )
    assert progress.status_code == 409 and progress.json()["code"] == "course_not_purchased"

    buyer = await _buyer(client, mint_token, course_id)
    opened = (await client.get(f"{COURSES}/{course_id}", headers=buyer["headers"])).json()
    assert opened["locked"] is False
    assert opened["modules"][0]["lessons"][0]["media_url"] == (
        f"https://www.youtube-nocookie.com/embed/{VIDEO}"
    )


async def test_watching_every_lesson_completes_the_course_as_the_system(
    client: Any, mint_token: Any
) -> None:
    staff = await _staff(mint_token)
    course_id, code = await _course(active=True)
    lesson = await _youtube_lesson(client, staff, code, duration=600)
    me = await _buyer(client, mint_token, course_id)
    url = f"{COURSES}/{course_id}/lessons/{lesson['id']}/progress"

    rushed = await client.post(url, json={"position_seconds": 600}, headers=me["headers"])
    assert rushed.status_code == 200, rushed.text
    assert rushed.json()["completed"] is False, "dragging to the end is not watching"
    assert rushed.json()["percent_complete"] == 0

    # Time passes: the lesson was opened six minutes ago.
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE course_lesson_progress SET first_opened_at = now() - interval '6 minutes' "
                "WHERE user_id = :u"
            ),
            {"u": str(me["id"])},
        )
    watched = await client.post(url, json={"position_seconds": 560}, headers=me["headers"])
    body = watched.json()
    assert body["completed"] and body["course_completed"] and body["percent_complete"] == 100

    completion = await _scalar(
        "SELECT contribution_version FROM course_completions WHERE user_id = :u AND course_id = :c",
        u=me["id"],
        c=course_id,
    )
    assert completion == COMPLETION_RULE_VERSION
    assert (
        await _scalar(
            "SELECT actor_role FROM audit_events "
            "WHERE action = 'course_completion_recorded' AND metadata->>'candidate_id' = :u",
            u=me["id"],
        )
        == "SYSTEM"
    )
    listed = [
        c for c in (await client.get(COURSES, headers=me["headers"])).json() if c["code"] == code
    ]
    assert listed[0]["completed"] and listed[0]["percent_complete"] == 100

    again = await client.post(url, json={"position_seconds": 10}, headers=me["headers"])
    assert again.json()["completed"], "watched is a latch"
    assert (
        await _scalar("SELECT count(*) FROM course_completions WHERE user_id = :u", u=me["id"]) == 1
    )
