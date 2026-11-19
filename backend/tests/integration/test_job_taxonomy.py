"""Real HTTP, PostgreSQL, RLS and cache for the moderated catalogue."""

import uuid
from pathlib import Path

import pytest

from app.modules.taxonomy.seed import load_source, seed
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _staff
from tests.integration.test_candidate_marketplace import _candidate

pytestmark = pytest.mark.integration
PUBLIC = "/api/v1/taxonomy"
ADMIN = "/api/v1/admin/taxonomy"
CAREER = "/api/v1/candidate/profile/details"


async def add(client, staff, level, name=None, **extra):
    response = await client.post(
        f"{ADMIN}/{level}",
        headers=staff["headers"],
        json={"name": name or f"Taxonomy {uuid.uuid4().hex}", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_others_approve_visible_relinks_users_and_preserves_newer_answers(client, mint_token):
    staff = await _staff(mint_token)
    industry = await add(client, staff, "industry")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    other_candidate = await _candidate(mint_token, scored=False, subscribed=False)
    custom = f"Emerging department {uuid.uuid4().hex}"
    details = {
        "work_status": "EXPERIENCED",
        "industry_id": industry["id"],
        "industry": industry["name"],
        "department": custom,
        "role_category": "Specialty",
        "taxonomy_others": {"department": custom, "role_category": "Specialty"},
    }
    for person in (candidate, other_candidate):
        saved = await client.put(
            CAREER, headers=person["headers"], json={"details": details, "complete": False}
        )
        assert saved.status_code == 200, saved.text
    suggestions = await client.get(
        f"{ADMIN}/others", params={"q": custom}, headers=staff["headers"]
    )
    assert suggestions.status_code == 200, suggestions.text
    row = suggestions.json()["items"][0]
    assert row["count"] == 2
    assert row["parent_labels"] == [industry["name"]]
    # One user changes their mind while review is pending.
    replacement = await add(client, staff, "department")
    newer = {"industry_id": industry["id"], "department_id": replacement["id"]}
    changed = await client.put(
        CAREER, headers=other_candidate["headers"], json={"details": newer, "complete": False}
    )
    assert changed.status_code == 200, changed.text
    approved = await client.post(
        f"{ADMIN}/others/{row['id']}/resolve",
        headers=staff["headers"],
        json={"action": "approve", "version": row["version"], "name": custom, "type": "Tech"},
    )
    assert approved.status_code == 200, approved.text
    option_id = approved.json()["option_id"]
    public = await client.get(
        f"{PUBLIC}/departments", params={"industry_id": industry["id"], "q": custom}
    )
    assert public.status_code == 200, public.text
    assert [r["id"] for r in public.json()["items"]] == [option_id]
    saved = (await client.get(CAREER, headers=candidate["headers"])).json()["details"]
    assert saved["department_id"] == option_id
    assert saved["department"] == custom
    assert "department" not in saved["taxonomy_others"]
    assert (await client.get(CAREER, headers=other_candidate["headers"])).json()["details"][
        "department_id"
    ] == replacement["id"]
    # A child suggestion follows the newly approved parent.
    children = (
        await client.get(f"{ADMIN}/others", params={"q": "Specialty"}, headers=staff["headers"])
    ).json()["items"]
    child = next(row for row in children if row["user_id"] == str(candidate["id"]))
    assert child["parent_id"] == option_id
    category = await client.post(
        f"{ADMIN}/others/{child['id']}/resolve",
        headers=staff["headers"],
        json={"action": "approve", "version": child["version"]},
    )
    assert category.status_code == 200, category.text
    assert (await client.get(CAREER, headers=candidate["headers"])).json()["details"][
        "role_category_id"
    ] == category.json()["option_id"]
    repeat = await client.post(
        f"{ADMIN}/others/{row['id']}/resolve",
        headers=staff["headers"],
        json={"action": "approve", "version": row["version"]},
    )
    assert repeat.status_code == 409


async def test_duplicate_parent_scope_version_hidden_values_and_delete_protection(
    client, mint_token
):
    staff = await _staff(mint_token)
    industry = await add(client, staff, "industry")
    department = await add(client, staff, "department")
    another = await add(client, staff, "department")
    name = f"Category {uuid.uuid4().hex}"
    category = await add(client, staff, "category", name=name, parent_id=department["id"])
    duplicate = await client.post(
        f"{ADMIN}/category",
        headers=staff["headers"],
        json={"name": f" {name.upper()} ", "parent_id": department["id"]},
    )
    assert duplicate.status_code == 409
    await add(client, staff, "category", name=name, parent_id=another["id"])
    missing_parent = await client.post(
        f"{ADMIN}/role", headers=staff["headers"], json={"name": "Developer"}
    )
    assert missing_parent.status_code == 422
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    details = {
        "industry_id": industry["id"],
        "department_id": department["id"],
        "role_category_id": category["id"],
    }
    saved = await client.put(
        CAREER, headers=candidate["headers"], json={"details": details, "complete": False}
    )
    assert saved.status_code == 200, saved.text
    bad_cascade = await client.put(
        CAREER,
        headers=candidate["headers"],
        json={"details": {**details, "department_id": another["id"]}, "complete": False},
    )
    assert bad_cascade.status_code == 422
    hard_delete = await client.delete(
        f"{ADMIN}/category/{category['id']}?version=1&hard=true", headers=staff["headers"]
    )
    assert hard_delete.status_code == 409
    hidden = await client.put(
        f"{ADMIN}/category/{category['id']}",
        headers=staff["headers"],
        json={"name": name, "parent_id": department["id"], "version": 1, "is_visible": False},
    )
    assert hidden.status_code == 200, hidden.text
    stale = await client.put(
        f"{ADMIN}/category/{category['id']}",
        headers=staff["headers"],
        json={"name": name, "parent_id": department["id"], "version": 1},
    )
    assert stale.status_code == 409
    public = await client.get(f"{PUBLIC}/categories", params={"department_id": department["id"]})
    assert category["id"] not in [row["id"] for row in public.json()["items"]]
    retained = await client.put(
        CAREER,
        headers=candidate["headers"],
        json={"details": saved.json()["details"], "complete": False},
    )
    assert retained.status_code == 200, retained.text
    assert retained.json()["details"]["role_category"] == name
    newcomer = await _candidate(mint_token, scored=False, subscribed=False)
    refused = await client.put(
        CAREER, headers=newcomer["headers"], json={"details": details, "complete": False}
    )
    assert refused.status_code == 422


async def test_every_industry_shows_all_departments_priorities_and_rbac(client, mint_token):
    staff = await _staff(mint_token)
    industry = await add(client, staff, "industry")
    first = await add(client, staff, "department")
    second = await add(client, staff, "department")
    revision = (
        await client.get(f"{ADMIN}/priorities/{industry['id']}", headers=staff["headers"])
    ).json()["revision"]
    priority = await client.put(
        f"{ADMIN}/priorities/{industry['id']}",
        headers=staff["headers"],
        json={"department_ids": [second["id"], first["id"]], "revision": revision},
    )
    assert priority.status_code == 200, priority.text
    public = (
        await client.get(f"{PUBLIC}/departments", params={"industry_id": industry["id"]})
    ).json()["items"]
    assert [row["id"] for row in public[:2]] == [second["id"], first["id"]]
    assert len(public) > 2
    assert (await client.get(f"{ADMIN}/industry")).status_code == 401
    support = await _staff(mint_token, "SUPPORT_AGENT")
    assert (await client.get(f"{ADMIN}/industry", headers=support["headers"])).status_code == 403
    assert (
        await client.post(f"{ADMIN}/industry", headers=support["headers"], json={"name": "No"})
    ).status_code == 403


async def test_seed_is_idempotent(client):
    data = load_source(Path(__file__).parents[2] / "data/job_taxonomy.json")
    async with sessions(_seed_url())() as session, session.begin():
        await seed(session, data)
        again = await seed(session, data)
        assert again["inserted"] == 0


async def test_others_duplicate_prompt_and_empty_custom_validation(client, mint_token):
    staff = await _staff(mint_token)
    industry = await add(client, staff, "industry")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    for details in (
        {"industry": "", "taxonomy_others": {"industry": ""}},
        {"industry": industry["name"], "taxonomy_others": {"industry": industry["name"]}},
    ):
        response = await client.put(
            CAREER, headers=candidate["headers"], json={"details": details, "complete": False}
        )
        assert response.status_code in (409, 422), response.text


async def test_merge_reject_import_export_and_child_visibility(client, mint_token):
    from app.modules.taxonomy.tabular import read_sheets, write_table
    from app.modules.taxonomy.transfer import HEADERS

    staff = await _staff(mint_token)
    industry = await add(client, staff, "industry")
    department = await add(client, staff, "department")
    category = await add(client, staff, "category", parent_id=department["id"])
    role = await add(client, staff, "role", parent_id=category["id"])
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    custom = f"Custom {uuid.uuid4().hex}"
    saved = await client.put(
        CAREER,
        headers=candidate["headers"],
        json={
            "details": {
                "industry_id": industry["id"],
                "department": custom,
                "taxonomy_others": {"department": custom},
            },
            "complete": False,
        },
    )
    assert saved.status_code == 200, saved.text
    row = (
        await client.get(f"{ADMIN}/others", headers=staff["headers"], params={"q": custom})
    ).json()["items"][0]
    merged = await client.post(
        f"{ADMIN}/others/{row['id']}/resolve",
        headers=staff["headers"],
        json={"action": "merge", "option_id": department["id"], "version": row["version"]},
    )
    assert merged.status_code == 200, merged.text
    assert (await client.get(CAREER, headers=candidate["headers"])).json()["details"][
        "department_id"
    ] == department["id"]
    # Parent visibility governs the role read as well as categories.
    before = await client.get(f"{PUBLIC}/roles", params={"category_id": category["id"]})
    assert before.status_code == 200 and role["id"] in [r["id"] for r in before.json()["items"]]
    hide = await client.put(
        f"{ADMIN}/department/{department['id']}",
        headers=staff["headers"],
        json={"name": department["name"], "version": 1, "is_visible": False},
    )
    assert hide.status_code == 200, hide.text
    after = await client.get(f"{PUBLIC}/roles", params={"category_id": category["id"]})
    assert after.status_code == 200 and after.json()["items"] == []
    custom2 = f"Reject {uuid.uuid4().hex}"
    await client.put(
        CAREER,
        headers=candidate["headers"],
        json={
            "details": {"industry": custom2, "taxonomy_others": {"industry": custom2}},
            "complete": False,
        },
    )
    suggestion = (
        await client.get(f"{ADMIN}/others", headers=staff["headers"], params={"q": custom2})
    ).json()["items"][0]
    rejected = await client.post(
        f"{ADMIN}/others/{suggestion['id']}/resolve",
        headers=staff["headers"],
        json={"action": "reject", "version": 1},
    )
    assert rejected.status_code == 200, rejected.text
    assert (await client.get(CAREER, headers=candidate["headers"])).json()["details"][
        "industry"
    ] == custom2
    import_name = f"Imported {uuid.uuid4().hex}"
    sheet = write_table([HEADERS, ["", import_name, "", "Tech", "0", "true", "1"]], "xlsx")
    imported = await client.post(
        f"{ADMIN}/department/import",
        headers=staff["headers"],
        files={"file": ("options.xlsx", sheet)},
    )
    assert imported.status_code == 200, imported.text
    exported = await client.get(f"{ADMIN}/department/export?format=csv", headers=staff["headers"])
    assert exported.status_code == 200
    assert any(
        row[1] == import_name for row in read_sheets(exported.content, "options.csv")["Options"][1:]
    )
    malformed = await client.post(
        f"{ADMIN}/department/import",
        headers=staff["headers"],
        files={"file": ("options.csv", b"bad,headers\na,b")},
    )
    assert malformed.status_code == 422


async def test_submission_limit_and_repeated_save_idempotence(client, mint_token):
    from sqlalchemy import text

    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    value = f"New sector {uuid.uuid4().hex}"
    body = {
        "details": {"industry": value, "taxonomy_others": {"industry": value}},
        "complete": False,
    }
    for _ in range(2):
        response = await client.put(CAREER, headers=candidate["headers"], json=body)
        assert response.status_code == 200, response.text
    async with sessions(_seed_url())() as session, session.begin():
        count = await session.scalar(
            text("SELECT count(*) FROM other_submissions WHERE user_id=:user"),
            {"user": candidate["id"]},
        )
        assert count == 1
        for index in range(39):
            await session.execute(
                text(
                    "INSERT INTO other_submissions(id,level,parent_chain,context_key,"
                    "raw_text,normalized_text,user_id) VALUES(gen_random_uuid(),'industry',"
                    "'{}'::jsonb,:key,CAST(:name AS text),CAST(:name AS varchar),:user)"
                ),
                {"key": str(index), "name": f"Suggestion {index}", "user": candidate["id"]},
            )
    response = await client.put(
        CAREER,
        headers=candidate["headers"],
        json={
            "details": {
                "industry": value + " limit",
                "taxonomy_others": {"industry": value + " limit"},
            },
            "complete": False,
        },
    )
    assert response.status_code == 429, response.text
    assert (await client.get(CAREER, headers=candidate["headers"])).json()["details"][
        "industry"
    ] == value
