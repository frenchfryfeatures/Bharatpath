"""The search filter panel, its typeahead, and staff curating it (2026-09-24).

Through HTTP. Staff add skills and cities with their other spellings; an
employer picks from them, or types anything else; choosing an option
searches every spelling of it. What must hold:

* **no count anywhere** -- a number beside a narrow filter says whether one
  particular person is in the pool;
* **custom text still searches as it always did**, so the catalogue adds
  reach and never takes any away;
* **one spelling, one option**, and every change by staff is on the record.

The catalogue is shared by every test, so each option here is named with a
token nobody else uses, and the rows are removed afterwards as the migrator
(the app role holds no DELETE on the table, by design).
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _audit_rows, _staff
from tests.integration.test_candidate_marketplace import API, _employer
from tests.integration.test_masked_search import PROFILE, _candidate, _found
from tests.integration.test_pipeline import _member

pytestmark = pytest.mark.integration

FILTERS = f"{API}/employer/discovery/filters"
OPTIONS = f"{API}/admin/search-filters"
_LETTERS = str.maketrans("0123456789", "ghijklmnop")


def _word() -> str:
    """Letters only: a skill with a run of digits reads as a phone number."""
    return "zq" + uuid.uuid4().hex[:10].translate(_LETTERS)


@pytest.fixture
async def made() -> AsyncIterator[list[str]]:
    """Ids of options a test created, deleted afterwards as the migrator."""
    ids: list[str] = []
    yield ids
    if ids:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("DELETE FROM search_filter_options WHERE id = ANY(CAST(:ids AS uuid[]))"),
                {"ids": ids},
            )


async def _add(client: Any, staff: dict[str, Any], made: list[str], **body: Any) -> dict[str, Any]:
    response = await client.post(OPTIONS, json=body, headers=staff["headers"])
    assert response.status_code == 201, response.text
    made.append(response.json()["id"])
    return dict(response.json())


async def _switch_off(client: Any, staff: dict[str, Any], option: dict[str, Any]) -> None:
    response = await client.patch(
        f"{OPTIONS}/{option['id']}", json={"active": False}, headers=staff["headers"]
    )
    assert response.status_code == 200, response.text


def _keys_anywhere(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys_anywhere(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys_anywhere(v)}
    return set()


# --- the panel ----------------------------------------------------------------------
async def test_the_panel_offers_every_filter_and_counts_nothing(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    staff = await _staff(mint_token)
    word = _word()
    skill = await _add(
        client, staff, made, kind="SKILL", label=f"{word} ops", featured=True, sort_order=0
    )
    hidden = await _add(client, staff, made, kind="SKILL", label=f"{word} rigging")
    employer = await _employer(client, mint_token)

    response = await client.get(FILTERS, headers=employer["headers"])
    assert response.status_code == 200, response.text
    panel = response.json()

    assert [b["value"] for b in panel["bands"]] == ["ENTRY", "DEVELOPING", "SOLID", "STRONG"]
    assert {b["value"] for b in panel["badges"]} == {"COURSE_COMPLETED", "MOCK_INTERVIEW_COMPLETED"}
    assert [e["min_years"] for e in panel["experience"]] == [1, 3, 5, 10]
    assert len(panel["states"]) == 36
    assert panel["limits"]["max_skills"] == 5
    assert panel["limits"]["max_cities"] == 5
    assert panel["catalogue_version"].startswith("placeholder-")
    # Featured only; the rest are found by typing.
    featured = {s["key"] for s in panel["skills"]}
    assert skill["key"] in featured
    assert hidden["key"] not in featured

    counting = {k for k in _keys_anywhere(panel) if "count" in k or "total" in k}
    assert not counting, f"a filter panel must never count the pool: {counting}"


async def test_only_owners_and_recruiters_open_the_panel(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    recruiter = await _member(client, mint_token, employer, "EMPLOYER_RECRUITER")
    viewer = await _member(client, mint_token, employer, "EMPLOYER_VIEWER")
    candidate = await _candidate(mint_token, _word())

    assert (await client.get(FILTERS, headers=recruiter["headers"])).status_code == 200
    for outsider in (viewer, candidate):
        for path in ("", "/skills?q=we", "/locations?q=pu"):
            response = await client.get(f"{FILTERS}{path}", headers=outsider["headers"])
            assert response.status_code == 403, path


# --- typeahead ----------------------------------------------------------------------------
async def test_typing_finds_options_by_label_or_alias_best_match_first(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    staff = await _staff(mint_token)
    word = _word()
    contains = await _add(client, staff, made, kind="SKILL", label=f"Advanced {word}")
    starts = await _add(client, staff, made, kind="SKILL", label=f"{word} Welding")
    exact = await _add(client, staff, made, kind="SKILL", label=word, aliases=[f"{word}ing"])
    employer = await _employer(client, mint_token)

    async def typed(q: str, path: str = "skills", **params: Any) -> list[str]:
        response = await client.get(
            f"{FILTERS}/{path}", params={"q": q, **params}, headers=employer["headers"]
        )
        assert response.status_code == 200, response.text
        return [item["key"] for item in response.json()["items"]]

    assert await typed(word.upper()) == [exact["key"], starts["key"], contains["key"]]
    assert await typed(f"{word}ing") == [exact["key"]]  # an alias finds its option
    assert await typed(word, limit=1) == [exact["key"]]
    assert await typed("   ") == []

    switched_off = await client.patch(
        f"{OPTIONS}/{starts['id']}", json={"active": False}, headers=staff["headers"]
    )
    assert switched_off.status_code == 200, switched_off.text
    assert starts["key"] not in await typed(word)

    city = await _add(
        client, staff, made, kind="CITY", label=f"{word}pur", aliases=[f"{word}abad"],
        state_code="MH",
    )  # fmt: skip
    found = await client.get(
        f"{FILTERS}/locations", params={"q": f"{word}abad"}, headers=employer["headers"]
    )
    assert found.json()["items"] == [
        {"key": city["key"], "label": city["label"], "state_code": "MH"}
    ]
    assert await typed(word, "locations", state="MH") == [city["key"]]
    assert await typed(word, "locations", state="KA") == []
    bad_state = await client.get(
        f"{FILTERS}/locations", params={"q": word, "state": "XX"}, headers=employer["headers"]
    )
    assert bad_state.status_code == 422


# --- search ------------------------------------------------------------------------------
async def test_choosing_a_skill_searches_every_spelling_and_custom_text_itself(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    word = _word()
    as_written = await _candidate(mint_token, f"{word} operation")
    as_alias = await _candidate(mint_token, f"{word} certified")
    unrelated = await _candidate(mint_token, f"{word} repair")
    employer = await _employer(client, mint_token)

    # Before the catalogue knows the skill, text matches itself only.
    assert await _found(client, employer, skill=f"{word} operation") == {str(as_written["id"])}

    staff = await _staff(mint_token)
    option = await _add(
        client, staff, made, kind="SKILL", label=f"{word} Operation",
        aliases=[f"{word} certified"],
    )  # fmt: skip
    both = {str(as_written["id"]), str(as_alias["id"])}
    assert await _found(client, employer, skill=option["label"]) == both
    assert await _found(client, employer, skill=f"{word} CERTIFIED") == both
    # Custom text is untouched by the catalogue.
    assert await _found(client, employer, skill=f"{word} repair") == {str(unrelated["id"])}
    # Every chosen skill must still match.
    assert await _found(client, employer, skill=[option["label"], f"{word} repair"]) == set()

    # Switched off, an option's label searches as plain text again.
    await _switch_off(client, staff, option)
    assert await _found(client, employer, skill=option["label"]) == {str(as_written["id"])}


async def test_several_cities_match_any_of_them_with_their_spellings(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    word = _word()
    old_name, new_name, elsewhere = f"{word}bay", f"{word}bai", f"{word}nik"
    in_old = await _candidate(mint_token, word)
    in_new = await _candidate(mint_token, word)
    in_elsewhere = await _candidate(mint_token, word)
    for who, city in ((in_old, old_name), (in_new, new_name), (in_elsewhere, elsewhere)):
        moved = await client.put(
            f"{PROFILE}/location", json={"city": city, "state_code": "MH"}, headers=who["headers"]
        )
        assert moved.status_code == 200, moved.text

    staff = await _staff(mint_token)
    await _add(
        client, staff, made, kind="CITY", label=new_name, aliases=[old_name], state_code="MH"
    )
    employer = await _employer(client, mint_token)
    ids = {k: str(c["id"]) for k, c in (("o", in_old), ("n", in_new), ("e", in_elsewhere))}

    assert await _found(client, employer, skill=word, city=new_name) == {ids["o"], ids["n"]}
    assert await _found(client, employer, skill=word, city=[new_name, elsewhere]) == set(
        ids.values()
    )
    # Custom text keeps its contains-match.
    assert await _found(client, employer, skill=word, city=elsewhere[:-1]) == {ids["e"]}

    refused = await client.get(
        f"{API}/employer/discovery/candidates",
        params={"city": "Pune 411001"},
        headers=employer["headers"],
    )
    assert refused.status_code == 422
    assert refused.json()["code"] == "discovery_city_invalid"
    too_many = await client.get(
        f"{API}/employer/discovery/candidates",
        params={"city": [_word() for _ in range(6)]},
        headers=employer["headers"],
    )
    assert too_many.status_code == 422


# --- staff curate the catalogue ------------------------------------------------------------
async def test_staff_add_change_and_switch_off_options_on_the_record(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    admin = await _staff(mint_token)
    support = await _staff(mint_token, "SUPPORT_AGENT")
    word = _word()

    created = await _add(
        client, support, made, kind="CITY", label=f"  {word}garh ", aliases=[f"{word}GARH"],
        state_code="PB",
    )  # fmt: skip
    assert created["label"] == f"{word}garh"
    assert created["aliases"] == []  # the label again is dropped, not refused
    assert created["created_by"] == str(support["user_id"])
    assert await _audit_rows("search_filter_option_created", support["user_id"], created["id"]) == 1

    changed = await client.patch(
        f"{OPTIONS}/{created['id']}",
        json={"aliases": [f"{word}gadh"], "featured": True},
        headers=admin["headers"],
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["aliases"] == [f"{word}gadh"]
    assert changed.json()["updated_by"] == str(admin["user_id"])
    assert await _audit_rows("search_filter_option_updated", admin["user_id"], created["id"]) == 1

    # A change that moves nothing is not a change.
    same = await client.patch(
        f"{OPTIONS}/{created['id']}", json={"featured": True}, headers=admin["headers"]
    )
    assert same.status_code == 200
    assert await _audit_rows("search_filter_option_updated", admin["user_id"], created["id"]) == 1

    await _switch_off(client, admin, created)
    listed = await client.get(OPTIONS, params={"q": word}, headers=support["headers"])
    assert listed.json()["items"] == []
    listed = await client.get(
        OPTIONS, params={"q": f"{word}gadh", "include_inactive": True}, headers=support["headers"]
    )
    assert [o["id"] for o in listed.json()["items"]] == [created["id"]]
    assert listed.json()["catalogue_version"].startswith("placeholder-")

    one = await client.get(f"{OPTIONS}/{created['id']}", headers=support["headers"])
    assert one.json()["active"] is False
    missing = await client.get(f"{OPTIONS}/{uuid.uuid4()}", headers=support["headers"])
    assert missing.status_code == 404
    assert missing.json()["code"] == "search_filter_option_not_found"

    reviewer = await _staff(mint_token, "KYB_REVIEWER")
    refused = await client.post(
        OPTIONS, json={"kind": "SKILL", "label": _word()}, headers=reviewer["headers"]
    )
    assert refused.status_code == 403


async def test_one_spelling_belongs_to_one_option_even_switched_off(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    staff = await _staff(mint_token)
    word = _word()
    first = await _add(client, staff, made, kind="SKILL", label=word, aliases=[f"{word} two"])
    await _switch_off(client, staff, first)

    for body in (
        {"kind": "SKILL", "label": word.upper()},
        {"kind": "SKILL", "label": _word(), "aliases": [f"{word} TWO"]},
        {"kind": "SKILL", "label": f"{word} two"},
    ):
        response = await client.post(OPTIONS, json=body, headers=staff["headers"])
        assert response.status_code == 409, body
        assert response.json()["code"] == "search_filter_option_conflict"

    # The same text as a city is a different kind, and allowed.
    await _add(client, staff, made, kind="CITY", label=word, state_code="MH")

    other = await _add(client, staff, made, kind="SKILL", label=_word())
    taken = await client.patch(
        f"{OPTIONS}/{other['id']}", json={"aliases": [word]}, headers=staff["headers"]
    )
    assert taken.status_code == 409
    assert taken.json()["params"]["keys"] == [word]


async def test_an_import_is_all_or_none(client: Any, mint_token: Any, made: list[str]) -> None:
    staff = await _staff(mint_token)
    words = [_word() for _ in range(3)]

    invalid = await client.post(
        f"{OPTIONS}/import",
        json={
            "items": [
                {"kind": "CITY", "label": words[0], "state_code": "MH"},
                {"kind": "SKILL", "label": words[1], "state_code": "MH"},
            ]
        },
        headers=staff["headers"],
    )
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["code"] == "search_filter_option_invalid"
    assert invalid.json()["params"]["index"] == 1

    clashing = await client.post(
        f"{OPTIONS}/import",
        json={
            "items": [
                {"kind": "SKILL", "label": words[0]},
                {"kind": "SKILL", "label": words[1], "aliases": [words[0]]},
            ]
        },
        headers=staff["headers"],
    )
    assert clashing.status_code == 409
    assert clashing.json()["params"]["keys"] == [words[0]]

    nothing = await client.get(
        OPTIONS, params={"q": words[0], "include_inactive": True}, headers=staff["headers"]
    )
    assert nothing.json()["items"] == []

    done = await client.post(
        f"{OPTIONS}/import",
        json={"items": [{"kind": "SKILL", "label": w} for w in words]},
        headers=staff["headers"],
    )
    assert done.status_code == 201, done.text
    made.extend(item["id"] for item in done.json()["items"])
    assert sorted(item["key"] for item in done.json()["items"]) == sorted(words)
    for item in done.json()["items"]:
        assert await _audit_rows("search_filter_option_created", staff["user_id"], item["id"]) == 1


async def test_seeding_twice_writes_nothing_the_second_time() -> None:
    from app.modules.discovery import service

    async with sessions(_seed_url())() as session, session.begin():
        await service.seed_filter_catalogue(session)
    async with sessions(_seed_url())() as session, session.begin():
        written, skipped = await service.seed_filter_catalogue(session)
    assert written == 0
    assert skipped > 0
