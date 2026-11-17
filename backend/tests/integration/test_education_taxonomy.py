"""Real HTTP/RLS/cache coverage for shared education choices and moderation."""

import uuid
from pathlib import Path
import pytest
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _staff
from tests.integration.test_candidate_marketplace import _candidate
from app.modules.education_taxonomy.seed import seed, load_csv

pytestmark = pytest.mark.integration
ADMIN = "/api/v1/admin/education-taxonomy"
PUBLIC = "/api/v1/education-taxonomy"
CAREER = "/api/v1/candidate/profile/details"


async def add(client, staff, level, **extra):
    response = await client.post(
        f"{ADMIN}/{level}",
        headers=staff["headers"],
        json={"name": f"Education {uuid.uuid4().hex}", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def revision(client, staff):
    return (await client.get(f"{ADMIN}/revision", headers=staff["headers"])).json()["revision"]


async def links(client, staff, courses, specializations, action):
    response = await client.put(
        f"{ADMIN}/links",
        headers=staff["headers"],
        json={
            "course_ids": courses,
            "specialization_ids": specializations,
            "action": action,
            "revision": await revision(client, staff),
        },
    )
    assert response.status_code == 200, response.text


async def save(client, candidate, details):
    response = await client.put(
        CAREER, headers=candidate["headers"], json={"details": details, "complete": False}
    )
    assert response.status_code == 200, response.text
    return response.json()["details"]


async def test_shared_rename_visibility_and_detach_preserve_saved_values(client, mint_token):
    staff = await _staff(mint_token)
    q = await add(client, staff, "qualification", level_rank=7)
    c1 = await add(client, staff, "course", parent_id=q["id"])
    c2 = await add(client, staff, "course", parent_id=q["id"])
    spec = await add(client, staff, "specialization", parent_id=c1["id"])
    await links(client, staff, [c2["id"]], [spec["id"]], "attach")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    details = await save(
        client,
        candidate,
        {
            "highest_qualification_id": q["id"],
            "course_id": c1["id"],
            "specialization_id": spec["id"],
        },
    )
    renamed = spec["name"] + " renamed"
    update = await client.put(
        f"{ADMIN}/specialization/{spec['id']}",
        headers=staff["headers"],
        json={"name": renamed, "version": 1},
    )
    assert update.status_code == 200, update.text
    for course in [c1, c2]:
        response = await client.get(f"{PUBLIC}/specializations", params={"course_id": course["id"]})
        assert response.status_code == 200, response.text
        assert response.json()["items"][0]["name"] == renamed
    retained = await save(client, candidate, details)
    assert retained["specialization"] == spec["name"]
    deleted = await client.delete(
        f"{ADMIN}/specialization/{spec['id']}?version=2&hard=true", headers=staff["headers"]
    )
    assert deleted.status_code == 409
    await links(client, staff, [c1["id"]], [spec["id"]], "detach")
    assert not (
        await client.get(f"{PUBLIC}/specializations", params={"course_id": c1["id"]})
    ).json()["items"]
    assert (await save(client, candidate, details))["specialization_id"] == spec["id"]
    hidden = await client.put(
        f"{ADMIN}/specialization/{spec['id']}",
        headers=staff["headers"],
        json={"name": renamed, "version": 2, "is_visible": False},
    )
    assert hidden.status_code == 200, hidden.text
    assert not (
        await client.get(f"{PUBLIC}/specializations", params={"course_id": c2["id"]})
    ).json()["items"]
    newcomer = await _candidate(mint_token, scored=False, subscribed=False)
    forbidden = await client.put(
        CAREER,
        headers=newcomer["headers"],
        json={
            "details": {
                "highest_qualification_id": q["id"],
                "course_id": c2["id"],
                "specialization_id": spec["id"],
            },
            "complete": False,
        },
    )
    assert forbidden.status_code == 422


async def test_others_approval_relinks_users_and_is_visible(client, mint_token):
    staff = await _staff(mint_token)
    q = await add(client, staff, "qualification", level_rank=8)
    course = await add(client, staff, "course", parent_id=q["id"])
    name = f"Unlisted specialty {uuid.uuid4().hex}"
    candidates = [await _candidate(mint_token, scored=False, subscribed=False) for _ in range(2)]
    for candidate in candidates:
        await save(
            client,
            candidate,
            {
                "highest_qualification_id": q["id"],
                "course_id": course["id"],
                "specialization": name,
                "education_others": {"specialization": name},
            },
        )
    pending = await client.get(f"{ADMIN}/others", params={"q": name}, headers=staff["headers"])
    assert pending.status_code == 200, pending.text
    row = pending.json()["items"][0]
    assert row["count"] == 2
    assert row["parent_labels"] == [q["name"], course["name"]]
    approved = await client.post(
        f"{ADMIN}/others/{row['id']}/resolve",
        headers=staff["headers"],
        json={"action": "approve", "version": row["version"]},
    )
    assert approved.status_code == 200, approved.text
    spec_id = approved.json()["option_id"]
    public = await client.get(
        f"{PUBLIC}/specializations", params={"course_id": course["id"], "q": name}
    )
    assert public.status_code == 200 and public.json()["items"][0]["id"] == spec_id
    for candidate in candidates:
        details = (await client.get(CAREER, headers=candidate["headers"])).json()["details"]
        assert details["specialization_id"] == spec_id
        assert "specialization" not in details["education_others"]
    stale = await client.post(
        f"{ADMIN}/others/{row['id']}/resolve",
        headers=staff["headers"],
        json={"action": "reject", "version": row["version"]},
    )
    assert stale.status_code == 409


async def test_duplicates_cascade_rank_na_and_permissions(client, mint_token):
    staff = await _staff(mint_token)
    q = await add(client, staff, "qualification", level_rank=7)
    other_q = await add(client, staff, "qualification", level_rank=6)
    course = await add(client, staff, "course", parent_id=q["id"])
    duplicate = await client.post(
        f"{ADMIN}/course",
        headers=staff["headers"],
        json={"name": " " + course["name"].upper() + " ", "parent_id": q["id"]},
    )
    assert duplicate.status_code == 409
    await add(client, staff, "course", name=course["name"], parent_id=other_q["id"])
    missing = await client.post(
        f"{ADMIN}/course", headers=staff["headers"], json={"name": "No parent"}
    )
    assert missing.status_code == 422
    # Reuse the single global N/A option if the seed has already run.
    found = await client.get(
        f"{ADMIN}/specialization",
        headers=staff["headers"],
        params={"q": "General / Not applicable"},
    )
    if found.json()["items"]:
        na = found.json()["items"][0]
        await links(client, staff, [course["id"]], [na["id"]], "attach")
    else:
        na = await add(
            client,
            staff,
            "specialization",
            name="General / Not applicable",
            is_not_applicable=True,
            parent_id=course["id"],
        )
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    details = await save(
        client, candidate, {"highest_qualification_id": q["id"], "course_id": course["id"]}
    )
    assert details["specialization_id"] == na["id"]
    assert (
        await client.get(f"{PUBLIC}/specializations", params={"course_id": course["id"]})
    ).json()["items"][0]["is_not_applicable"]
    invalid = await client.put(
        CAREER,
        headers=candidate["headers"],
        json={"details": {**details, "highest_qualification_id": other_q["id"]}, "complete": False},
    )
    assert invalid.status_code == 422
    assert (await client.get(f"{ADMIN}/qualification")).status_code == 401
    support = await _staff(mint_token, "SUPPORT_AGENT")
    assert (
        await client.get(f"{ADMIN}/qualification", headers=support["headers"])
    ).status_code == 403
    public = await client.get(f"{PUBLIC}/qualifications", params={"q": q["name"]})
    assert public.json()["items"][0]["level_rank"] == 7


async def test_csv_seed_idempotence_and_shared_na(client):
    from sqlalchemy import select, func
    from app.modules.education_taxonomy.models import Specialization

    rows = load_csv(Path(__file__).parents[2] / "data/education_taxonomy.csv")
    async with sessions(_seed_url())() as session, session.begin():
        await seed(session, rows)
        assert (await seed(session, rows + rows))["inserted"] == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Specialization)
                .where(Specialization.is_not_applicable)
            )
            == 1
        )


async def test_transfer_round_trip_and_stale_edits(client, mint_token):
    import csv
    import io
    from app.modules.education_taxonomy.transfer import HEADERS

    staff = await _staff(mint_token)
    q = await add(client, staff, "qualification", level_rank=5)
    course = await add(client, staff, "course", parent_id=q["id"])
    spec = await add(client, staff, "specialization", parent_id=course["id"])
    for format in ("csv", "xlsx"):
        exported = await client.get(
            f"{ADMIN}/specialization/export?format={format}", headers=staff["headers"]
        )
        assert exported.status_code == 200, exported.text
        imported = await client.post(
            f"{ADMIN}/specialization/import",
            headers=staff["headers"],
            files={"file": (f"options.{format}", exported.content)},
        )
        assert imported.status_code == 200, imported.text
        assert imported.json()["imported"] > 0
    updated = await client.put(
        f"{ADMIN}/qualification/{q['id']}",
        headers=staff["headers"],
        json={"name": q["name"], "level_rank": 4, "version": 1},
    )
    assert updated.status_code == 200, updated.text
    stale = await client.put(
        f"{ADMIN}/qualification/{q['id']}",
        headers=staff["headers"],
        json={"name": q["name"], "version": 1},
    )
    assert stale.status_code == 409
    outdated = await revision(client, staff)
    await add(client, staff, "qualification")
    stale_link = await client.put(
        f"{ADMIN}/links",
        headers=staff["headers"],
        json={
            "course_ids": [course["id"]],
            "specialization_ids": [spec["id"]],
            "action": "detach",
            "revision": outdated,
        },
    )
    assert stale_link.status_code == 409
    # Invalid later rows roll the entire import back.
    unique = f"Rollback {uuid.uuid4().hex}"
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(HEADERS)
    writer.writerow(["", unique, "", "1", "0", "true", "1", "", "false"])
    writer.writerow(["", unique, "", "1", "0", "true", "1", "", "false"])
    failed = await client.post(
        f"{ADMIN}/qualification/import",
        headers=staff["headers"],
        files={"file": ("invalid.csv", stream.getvalue().encode())},
    )
    assert failed.status_code == 409, failed.text
    assert not (await client.get(f"{PUBLIC}/qualifications", params={"q": unique})).json()["items"]


async def test_others_merge_reject_and_submission_limit(client, mint_token):
    from sqlalchemy import insert
    from app.modules.education_taxonomy.models import OtherSubmission

    staff = await _staff(mint_token)
    q = await add(client, staff, "qualification", level_rank=6)
    course = await add(client, staff, "course", parent_id=q["id"])
    target = await add(client, staff, "specialization")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    for action in ("merge", "reject"):
        name = f"Suggestion {uuid.uuid4().hex}"
        await save(
            client,
            candidate,
            {
                "highest_qualification_id": q["id"],
                "course_id": course["id"],
                "specialization": name,
                "education_others": {"specialization": name},
            },
        )
        pending = (
            await client.get(f"{ADMIN}/others", headers=staff["headers"], params={"q": name})
        ).json()["items"][0]
        resolved = await client.post(
            f"{ADMIN}/others/{pending['id']}/resolve",
            headers=staff["headers"],
            json={
                "action": action,
                "version": pending["version"],
                "option_id": target["id"] if action == "merge" else None,
            },
        )
        assert resolved.status_code == 200, resolved.text
        details = (await client.get(CAREER, headers=candidate["headers"])).json()["details"]
        if action == "merge":
            assert details["specialization_id"] == target["id"]
            assert (
                await client.get(f"{PUBLIC}/specializations", params={"course_id": course["id"]})
            ).json()["items"][0]["id"] == target["id"]
        else:
            assert details["specialization"] == name
            assert details["specialization_id"] is None
    # Seed the quota using the owner connection; the next real HTTP save must be rejected.
    async with sessions(_seed_url())() as session, session.begin():
        from sqlalchemy import text

        user_id = await session.scalar(
            text("SELECT user_id FROM education_other_submissions WHERE id=:id"),
            {"id": uuid.UUID(pending["id"])},
        )
        await session.execute(
            insert(OtherSubmission),
            [
                {
                    "id": uuid.uuid4(),
                    "level": "qualification",
                    "raw_text": f"Quota {i}",
                    "normalized_text": f"quota {i}",
                    "user_id": user_id,
                    "context_key": str(i),
                }
                for i in range(40)
            ],
        )
    response = await client.put(
        CAREER,
        headers=candidate["headers"],
        json={
            "details": {
                "highest_qualification": "New quota suggestion",
                "education_others": {"highest_qualification": "New quota suggestion"},
            },
            "complete": False,
        },
    )
    assert response.status_code == 429, response.text
