"""Profile photos and organisation logos through HTTP, with S3 faked (2026-10-09).

Everyone sets their own photo; an employer's owner and a college's admin set
the organisation's logo; candidates see logos beside jobs; staff see a
student's photo on the candidate page. The uploads go through the real
checks and the real re-encode -- only S3 is replaced.
"""

from __future__ import annotations

import io
import uuid
from typing import Any
from urllib.parse import urlparse

import pytest
from PIL import Image
from sqlalchemy import text

from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _staff
from tests.integration.test_candidate_marketplace import BOARD, _candidate, _employer, _job
from tests.integration.test_college import _college
from tests.integration.test_resume_intake import FakeS3

pytestmark = pytest.mark.integration

API = "/api/v1"
PHOTO = f"{API}/profile/photo"
EMPLOYER_LOGO = f"{API}/employer/organisation/logo"
COLLEGE_LOGO = f"{API}/college/organisation/logo"


class FakeImageS3(FakeS3):
    """`FakeS3` plus the server's own write, which only an image needs."""

    async def put_object(self, *, bucket: str, key: str, body: bytes, content_type: str) -> None:
        self.objects[key] = body


@pytest.fixture
def images(monkeypatch: pytest.MonkeyPatch) -> FakeImageS3:
    from app.core import storage

    fake = FakeImageS3()
    for name in (
        "head_object",
        "read_head_bytes",
        "read_whole_object",
        "delete_object",
        "presign_put",
        "put_object",
        "presign_get",
    ):
        monkeypatch.setattr(storage, name, getattr(fake, name))
    return fake


def _jpeg(*, gps: bool = False) -> bytes:
    exif = Image.Exif()
    if gps:
        exif[0x8825] = {1: "N", 2: (12.0, 58.0, 0.0), 3: "E", 4: (77.0, 35.0, 0.0)}
    out = io.BytesIO()
    Image.new("RGB", (900, 600), (10, 120, 200)).save(out, format="JPEG", exif=exif)
    return out.getvalue()


def _png_with_alpha() -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (200, 200), (0, 0, 0, 0)).save(out, format="PNG")
    return out.getvalue()


def _key_of(url: str) -> str:
    return urlparse(url).path.split("/", 2)[2]


async def _upload(
    client: Any, base: str, headers: dict, fake: FakeImageS3, body: bytes
) -> tuple[Any, str, str]:
    """Ticket, PUT, confirm. Returns the confirm response, upload id and raw key."""
    ticket = await client.post(f"{base}/upload", headers=headers)
    assert ticket.status_code == 201, ticket.text
    raw_key = _key_of(ticket.json()["url"])
    fake.objects[raw_key] = body
    upload_id = ticket.json()["upload_id"]
    confirmed = await client.post(f"{base}/confirm", json={"upload_id": upload_id}, headers=headers)
    return confirmed, upload_id, raw_key


# ===========================================================================
# Your own photo
# ===========================================================================
async def test_a_student_sets_replaces_and_removes_their_photo(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    empty = await client.get(PHOTO, headers=me["headers"])
    assert empty.status_code == 200 and empty.json()["url"] is None

    first, _, raw_key = await _upload(client, PHOTO, me["headers"], images, _jpeg(gps=True))
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["mime"] == "image/jpeg" and (body["width"], body["height"]) == (512, 341)
    stored_key = _key_of(body["url"])
    assert stored_key.startswith(f"users/{me['id']}/")
    # The client's file is gone; what is kept is the server's, with no EXIF.
    assert raw_key not in images.objects and raw_key in images.deleted
    assert b"Exif" not in images.objects[stored_key]

    second, _, _ = await _upload(client, PHOTO, me["headers"], images, _jpeg())
    assert second.status_code == 200
    assert stored_key in images.deleted, "the replaced photo is deleted, not orphaned"
    assert (await client.get(PHOTO, headers=me["headers"])).json()["url"] == second.json()["url"]

    removed = await client.delete(PHOTO, headers=me["headers"])
    assert removed.status_code == 200 and removed.json()["url"] is None
    assert _key_of(second.json()["url"]) in images.deleted
    assert (await client.get(PHOTO, headers=me["headers"])).json()["url"] is None


async def test_employer_college_and_staff_accounts_have_photos_too(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    for who in (
        await _employer(client, mint_token),
        await _college(client, mint_token),
        await _staff(mint_token),
    ):
        confirmed, _, _ = await _upload(client, PHOTO, who["headers"], images, _jpeg())
        assert confirmed.status_code == 200, confirmed.text
        assert (await client.get(PHOTO, headers=who["headers"])).json()["url"]


async def test_confirming_twice_is_a_retry(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    first, upload_id, _ = await _upload(client, PHOTO, me["headers"], images, _jpeg())
    again = await client.post(
        f"{PHOTO}/confirm", json={"upload_id": upload_id}, headers=me["headers"]
    )
    assert again.status_code == 200
    assert again.json()["url"] == first.json()["url"]


async def test_nobody_can_confirm_someone_elses_upload(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    """The key is rebuilt from the caller, so another person's upload id
    names a key under the caller's own prefix, where nothing is."""
    owner = await _candidate(mint_token, scored=False, subscribed=False)
    thief = await _candidate(mint_token, scored=False, subscribed=False)
    ticket = await client.post(f"{PHOTO}/upload", headers=owner["headers"])
    images.objects[_key_of(ticket.json()["url"])] = _jpeg()
    stolen = await client.post(
        f"{PHOTO}/confirm", json={"upload_id": ticket.json()["upload_id"]}, headers=thief["headers"]
    )
    assert stolen.status_code == 404
    assert stolen.json()["code"] == "profile_image_upload_not_found"


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (b"just some text, which is not an image at all" * 3, "unsupported_type"),
        (b"\xff\xd8\xff" + b"garbage that only starts like a jpeg" * 5, "not_an_image"),
        (b"\xff\xd8\xff", "empty"),
        (b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024), "too_large"),
    ],
    # The bodies are not readable ids, and a 5 MB one is longer than Windows
    # allows in the PYTEST_CURRENT_TEST environment variable.
    ids=["text", "fake-jpeg", "tiny", "five-megabytes"],
)
async def test_a_refused_upload_says_why_and_is_not_kept(
    client: Any, mint_token: Any, images: FakeImageS3, body: bytes, reason: str
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    refused, _, raw_key = await _upload(client, PHOTO, me["headers"], images, body)
    assert refused.status_code == 422
    assert refused.json()["code"] == "profile_image_rejected"
    assert refused.json()["params"]["reason"] == reason
    assert raw_key not in images.objects and raw_key in images.deleted
    assert (await client.get(PHOTO, headers=me["headers"])).json()["url"] is None


# ===========================================================================
# Organisation logos
# ===========================================================================
async def test_an_employers_logo_is_the_owners_to_set_and_candidates_see_it_by_its_jobs(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    employer = await _employer(client, mint_token)
    token = uuid.uuid4().hex[:10]
    job = await _job(client, employer, title=f"Logo test {token}")
    me = await _candidate(mint_token, scored=False)

    board = await client.get(BOARD, params={"q": token}, headers=me["headers"])
    [listed] = [item for item in board.json()["items"] if item["id"] == job["id"]]
    assert listed["employer_logo_url"] is None

    logo, _, _ = await _upload(
        client, EMPLOYER_LOGO, employer["headers"], images, _png_with_alpha()
    )
    assert logo.status_code == 200, logo.text
    assert logo.json()["mime"] == "image/png", "a transparent logo stays a PNG"
    assert _key_of(logo.json()["url"]).startswith(f"organisations/{employer['tenant_id']}/")

    board = await client.get(BOARD, params={"q": token}, headers=me["headers"])
    [listed] = [item for item in board.json()["items"] if item["id"] == job["id"]]
    assert listed["employer_logo_url"] == logo.json()["url"]
    detail = await client.get(f"{BOARD}/{job['id']}", headers=me["headers"])
    assert detail.json()["employer_logo_url"] == logo.json()["url"]

    # A candidate is not a member: the organisation's own routes refuse them.
    assert (await client.get(EMPLOYER_LOGO, headers=me["headers"])).status_code == 403
    assert (await client.post(f"{EMPLOYER_LOGO}/upload", headers=me["headers"])).status_code == 403

    removed = await client.delete(EMPLOYER_LOGO, headers=employer["headers"])
    assert removed.status_code == 200
    board = await client.get(BOARD, params={"q": token}, headers=me["headers"])
    [listed] = [item for item in board.json()["items"] if item["id"] == job["id"]]
    assert listed["employer_logo_url"] is None


async def test_a_recruiter_sees_the_logo_but_only_the_owner_changes_it(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    employer = await _employer(client, mint_token)
    recruiter_email = f"{uuid.uuid4().hex[:12]}@example.test"
    added = await client.post(
        f"{API}/employer/team",
        json={"email": recruiter_email, "role": "EMPLOYER_RECRUITER"},
        headers=employer["headers"],
    )
    assert added.status_code in (200, 201), added.text
    recruiter, _ = mint_token(pool="BUSINESS", email=recruiter_email)
    assert (await client.get(EMPLOYER_LOGO, headers=recruiter)).status_code == 200
    assert (await client.post(f"{EMPLOYER_LOGO}/upload", headers=recruiter)).status_code == 403
    assert (await client.delete(EMPLOYER_LOGO, headers=recruiter)).status_code == 403


async def test_a_college_admin_sets_the_colleges_logo(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    college = await _college(client, mint_token)
    logo, _, _ = await _upload(client, COLLEGE_LOGO, college["headers"], images, _jpeg())
    assert logo.status_code == 200, logo.text
    assert _key_of(logo.json()["url"]).startswith(f"organisations/{college['tenant_id']}/")
    assert (await client.get(COLLEGE_LOGO, headers=college["headers"])).json()["url"]
    employer = await _employer(client, mint_token)
    assert (await client.get(COLLEGE_LOGO, headers=employer["headers"])).status_code == 403


# ===========================================================================
# Who sees a student's photo: the student and staff
# ===========================================================================
async def test_staff_see_a_students_photo_on_the_candidate_page(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    admin = await _staff(mint_token)
    page = await client.get(
        f"{API}/admin/candidates/{me['id']}/onboarding", headers=admin["headers"]
    )
    assert page.status_code == 200, page.text
    assert page.json()["photo_url"] is None

    confirmed, _, _ = await _upload(client, PHOTO, me["headers"], images, _jpeg())
    page = await client.get(
        f"{API}/admin/candidates/{me['id']}/onboarding", headers=admin["headers"]
    )
    assert page.json()["photo_url"] == confirmed.json()["url"]


async def test_an_erasure_collects_the_photo_before_the_rows_go(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    """The key lives on the row the cascade deletes, so it is read first
    (`erasable_object_keys`), and the cascade then deletes the row."""
    from app.modules.privacy import repository as privacy_repository

    me = await _candidate(mint_token, scored=False, subscribed=False)
    confirmed, _, _ = await _upload(client, PHOTO, me["headers"], images, _jpeg())
    key = _key_of(confirmed.json()["url"])
    async with sessions(_seed_url())() as session:
        keys = await privacy_repository.erasable_object_keys(session, user_id=me["id"])
    assert ("profile_images", key) in keys

    async with sessions(_seed_url())() as session, session.begin():
        manifest = await privacy_repository.erase_candidate(
            session, user_id=me["id"], policy_version="test"
        )
        left = await session.scalar(
            text("SELECT count(*) FROM user_photos WHERE user_id = :u"), {"u": str(me["id"])}
        )
    assert manifest.get("user_photos") == 1
    assert left == 0


# ===========================================================================
# Wherever an organisation is named, its logo; your own photo on your own
# screens (2026-10-10). A student's photo still reaches nobody else -- see
# `tests/invariants/test_profile_photo_reach.py`.
# ===========================================================================
ME = f"{API}/auth/me"


async def _logo(client: Any, who: dict, fake: FakeImageS3, base: str = EMPLOYER_LOGO) -> str:
    confirmed, _, _ = await _upload(client, base, who["headers"], fake, _png_with_alpha())
    assert confirmed.status_code == 200, confirmed.text
    return str(confirmed.json()["url"])


async def _photo(client: Any, who: dict, fake: FakeImageS3) -> str:
    confirmed, _, _ = await _upload(client, PHOTO, who["headers"], fake, _jpeg())
    assert confirmed.status_code == 200, confirmed.text
    return str(confirmed.json()["url"])


async def test_your_own_photo_and_your_organisations_logo_are_on_your_own_screens(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    before = (await client.get(ME, headers=me["headers"])).json()
    assert before["photo_url"] is None and before["organisation_logo_url"] is None
    photo = await _photo(client, me, images)
    assert (await client.get(ME, headers=me["headers"])).json()["photo_url"] == photo
    profile = await client.get(f"{API}/candidate/profile", headers=me["headers"])
    assert profile.status_code == 200 and profile.json()["photo_url"] == photo
    named = await client.put(
        f"{API}/candidate/profile/name", json={"full_name": "Asha Rao"}, headers=me["headers"]
    )
    assert named.status_code == 200 and named.json()["photo_url"] == photo

    employer = await _employer(client, mint_token)
    organisation = f"{API}/employer/organisation"
    assert (await client.get(organisation, headers=employer["headers"])).json()["logo_url"] is None
    logo = await _logo(client, employer, images)
    assert (await client.get(ME, headers=employer["headers"])).json()[
        "organisation_logo_url"
    ] == logo
    assert (await client.get(organisation, headers=employer["headers"])).json()["logo_url"] == logo

    college = await _college(client, mint_token)
    college_logo = await _logo(client, college, images, COLLEGE_LOGO)
    mine = (await client.get(ME, headers=college["headers"])).json()
    assert mine["organisation_logo_url"] == college_logo
    own = await client.get(f"{API}/college/organisation", headers=college["headers"])
    assert own.json()["logo_url"] == college_logo


async def test_a_candidate_sees_the_employers_logo_on_applications_and_messages(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    from tests.integration.test_pipeline import PIPELINE, _applied

    a = await _applied(client, mint_token)
    logo = await _logo(client, a["employer"], images)
    applications = f"{API}/candidate/applications"
    headers = a["candidate"]["headers"]

    listed = (await client.get(applications, headers=headers)).json()["items"]
    [mine] = [item for item in listed if item["id"] == a["id"]]
    assert mine["employer_logo_url"] == logo
    detail = await client.get(f"{applications}/{a['id']}", headers=headers)
    assert detail.json()["employer_logo_url"] == logo

    sent = await client.post(
        f"{PIPELINE}/{a['id']}/messages",
        json={"kind": "GENERAL", "body": "Thanks for applying."},
        headers=a["employer"]["headers"],
    )
    assert sent.status_code == 201, sent.text
    [message] = (await client.get(f"{applications}/{a['id']}/messages", headers=headers)).json()
    assert message["employer_logo_url"] == logo


async def test_a_candidate_sees_the_logo_on_an_invitation_and_on_who_viewed_them(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    from tests.integration.test_shortlist import INVITATIONS, _opened, _shortlist

    employer, candidate = await _opened(client, mint_token)
    logo = await _logo(client, employer, images)
    job = await _job(client, employer)
    invited = await _shortlist(client, employer, candidate, job)
    assert invited.status_code == 201, invited.text

    [invitation] = (await client.get(INVITATIONS, headers=candidate["headers"])).json()["items"]
    assert invitation["employer_logo_url"] == logo
    views = await client.get(f"{API}/candidate/profile/views", headers=candidate["headers"])
    [view] = views.json()["items"]
    assert view["employer_logo_url"] == logo


async def test_a_student_sees_the_colleges_logo_on_links_and_invitations(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    from tests.integration.test_college import STUDENT, _allocate, _code, _link
    from tests.integration.test_roster_import import _committed_and_sent, _phone, _student

    college = await _college(client, mint_token)
    logo = await _logo(client, college, images, COLLEGE_LOGO)
    student = await _candidate(mint_token, scored=False, subscribed=False)
    code = await _code(client, college)
    linked = await _link(client, student, code["code"])
    assert linked.status_code == 201, linked.text
    assert linked.json()["college_logo_url"] == logo
    [link] = (await client.get(STUDENT, headers=student["headers"])).json()
    assert link["college_logo_url"] == logo

    await _allocate(college["tenant_id"], 5)
    phone = _phone()
    await _committed_and_sent(client, college, f"name,phone\nAsha,{phone}\n")
    invited = await _student(mint_token, phone)
    [invitation] = (await client.get(f"{STUDENT}/invitations", headers=invited["headers"])).json()
    assert invitation["college_logo_url"] == logo


async def test_a_college_sees_the_employers_logo_where_its_student_applied_and_was_hired(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    from tests.integration.test_college import COLLEGE
    from tests.integration.test_college_consent import (
        _application,
        _grant_individual,
        _linked_student,
    )

    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)
    granted = await _grant_individual(client, student, college["tenant_id"])
    assert granted.status_code in (200, 201), granted.text
    employer = await _employer(client, mint_token)
    logo = await _logo(client, employer, images)
    job = await _job(client, employer)
    await _application((employer["tenant_id"], job["id"]), student["id"], outcome="HIRED")

    students = f"{COLLEGE}/students/{student['id']}"
    opened = await client.get(students, headers=college["headers"])
    assert opened.status_code == 200, opened.text
    [hire] = opened.json()["hires"]
    assert hire["employer_name"] == employer["name"] and hire["employer_logo_url"] == logo
    assert "employer_tenant_id" not in hire, "the id finds the logo; it is not sent"

    details = await client.get(f"{students}/details", headers=college["headers"])
    assert details.status_code == 200, details.text
    [application] = details.json()["applications"]
    assert application["employer_logo_url"] == logo
    assert "employer_tenant_id" not in application


async def test_staff_see_photos_and_logos_across_the_console(
    client: Any, mint_token: Any, images: FakeImageS3
) -> None:
    from tests.integration.test_admin_console import ADMIN, _find
    from tests.integration.test_college import _code, _link
    from tests.integration.test_pipeline import _applied

    admin = await _staff(mint_token)
    a = await _applied(client, mint_token)
    candidate, employer = a["candidate"], a["employer"]
    photo = await _photo(client, candidate, images)
    logo = await _logo(client, employer, images)
    name = f"Console {uuid.uuid4().hex[:8]}"
    await client.put(
        f"{API}/candidate/profile/name", json={"full_name": name}, headers=candidate["headers"]
    )
    college = await _college(client, mint_token)
    college_logo = await _logo(client, college, images, COLLEGE_LOGO)
    code = await _code(client, college)
    assert (await _link(client, candidate, code["code"])).status_code == 201

    row = await _find(
        client, f"{ADMIN}/candidates", admin["headers"], str(candidate["id"]), name_contains=name
    )
    assert row is not None and row["photo_url"] == photo
    person = f"{ADMIN}/candidates/{candidate['id']}"
    drilldown = (await client.get(person, headers=admin["headers"])).json()
    assert drilldown["photo_url"] == photo
    assert [c["college_logo_url"] for c in drilldown["college_links"]] == [college_logo]
    onboarding = (await client.get(f"{person}/onboarding", headers=admin["headers"])).json()
    assert [c["college_logo_url"] for c in onboarding["college_links"]] == [college_logo]
    applied = (await client.get(f"{person}/applications", headers=admin["headers"])).json()
    assert [i["employer_logo_url"] for i in applied["items"]] == [logo]

    organisation = f"{ADMIN}/employers/{employer['tenant_id']}"
    assert (await client.get(organisation, headers=admin["headers"])).json()["logo_url"] == logo
    campus = f"{ADMIN}/colleges/{college['tenant_id']}"
    assert (await client.get(campus, headers=admin["headers"])).json()["logo_url"] == college_logo
    tenant = await _find(
        client,
        f"{ADMIN}/tenants",
        admin["headers"],
        employer["tenant_id"],
        name_contains=employer["name"],
    )
    assert tenant is not None and tenant["logo_url"] == logo
