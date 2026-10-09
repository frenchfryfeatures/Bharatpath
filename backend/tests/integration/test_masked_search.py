"""Through HTTP: masked candidate search, its filters and its document.

Candidates are real: a confirmed resume, a score through the one write path,
an integrity check -- so who is searchable is decided by the discovery CTE and
the search document by the trigger, not by rows written for the test.

**Search reads every visible candidate in the database**, other tests'
included, so each test gives its candidates a skill nobody else has and filters
on it.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.scoring.domain import (
    BANDS,
    AddOnContributions,
    band_for,
    features_from_extraction,
)
from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import API, _employer
from tests.integration.test_integrity_pipeline import (
    CLEAN_CV,
    EXTRACTED,
    INJECTED_CV,
    _evaluate,
    _scored_version,
)
from tests.integration.test_jobs import _set_kyb
from tests.integration.test_pipeline import _member

pytestmark = pytest.mark.integration

SEARCH = f"{API}/employer/discovery/candidates"
PROFILE = f"{API}/candidate/profile"
APP_URL = os.getenv("DATABASE_URL", "")
CARD_FIELDS = {
    "candidate_id",
    "full_name",
    "band",
    "experience_years",
    "skills",
    "badges",
    "city",
    "state_code",
}
ROLE = EXTRACTED["roles"][0]
PHONE_IN_CV = "+91 98765 43210"


#: Hex digits mapped to letters. A hex token sometimes carries eight digits in a
#: row, which `CONTACT_LIKE_PATTERN` rightly reads as a phone number and drops
#: -- so a test skill made of hex vanished from the index about one run in ten.
_LETTERS = str.maketrans("0123456789", "ghijklmnop")


def _token() -> str:
    return f"skill{uuid.uuid4().hex[:12].translate(_LETTERS)}"


def _extraction(*skills: str, months: int = 77, roles: Any = None) -> dict[str, Any]:
    return {
        **EXTRACTED,
        "roles": [{**ROLE, "months": months}] if roles is None else roles,
        "skills": [{"canonical_name": n, "evidence_strength": 3} for n in ("SAP", *skills)],
    }


def _course() -> AddOnContributions:
    return AddOnContributions(
        course_points=30, events=[{"kind": "course", "id": str(uuid.uuid4()), "points": 30}]
    )


# --- fixtures, as functions -------------------------------------------------
async def _new_user() -> tuple[uuid.UUID, str, str]:
    user_id, subject = uuid.uuid4(), f"local-test-{uuid.uuid4()}"
    phone = f"+9196{uuid.uuid4().int % 10**8:08d}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, phone, status, locale) "
                "VALUES (:u, :s, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "s": subject, "p": phone},
        )
    return user_id, subject, phone


async def _rescore(
    user_id: uuid.UUID,
    version_id: uuid.UUID,
    extracted: dict[str, Any],
    addons: AddOnContributions | None = None,
) -> None:
    from app.modules.scoring import service as scoring_service

    async with sessions(_seed_url())() as session, session.begin():
        await scoring_service.persist(
            session,
            user_id=user_id,
            resume_version_id=version_id,
            extracted_features=extracted,
            raw_model_response={"stub": True},
            model_id="stub-model-1",
            addons=addons,
        )


async def _latest_raw(user_id: uuid.UUID) -> int:
    async with sessions(_seed_url())() as session:
        return int(
            await session.scalar(
                text(
                    "SELECT raw_value FROM scores WHERE user_id = :u "
                    "ORDER BY computed_at DESC, id DESC LIMIT 1"
                ),
                {"u": str(user_id)},
            )
        )


async def _candidate(
    mint_token: Any,
    *skills: str,
    months: int = 77,
    cv: str = CLEAN_CV,
    checked: bool = True,
    addons: AddOnContributions | None = None,
) -> dict[str, Any]:
    """A signed-in candidate with a score and, by default, an integrity check."""
    user_id, subject, phone = await _new_user()
    extracted = _extraction(*skills, months=months)
    version_id, _ = await _scored_version(user_id, cv, extracted)
    if addons is not None:
        await _rescore(user_id, version_id, extracted, addons)
    if checked:
        await _evaluate(user_id, version_id, cv, extracted)
    headers, _ = mint_token(pool="CANDIDATE", subject=subject, phone=phone)
    return {
        "id": user_id,
        "version_id": version_id,
        "headers": headers,
        "phone": phone,
        "raw": await _latest_raw(user_id),
    }


async def _document(user_id: uuid.UUID) -> Any:
    async with sessions(_seed_url())() as session:
        return (
            await session.execute(
                text(
                    "SELECT band, band_rank, experience_months, skills, skill_keys, badges "
                    "FROM candidate_search_documents WHERE user_id = :u"
                ),
                {"u": str(user_id)},
            )
        ).one()


async def _search(client: Any, who: dict[str, Any], **params: Any) -> Any:
    return await client.get(SEARCH, params=params, headers=who["headers"])


async def _found(client: Any, who: dict[str, Any], **params: Any) -> set[str]:
    response = await _search(client, who, **params)
    assert response.status_code == 200, response.text
    return {item["candidate_id"] for item in response.json()["items"]}


# --- the card -----------------------------------------------------------------
async def test_a_visible_candidate_comes_back_as_a_masked_card(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    candidate = await _candidate(mint_token, token)
    employer = await _employer(client, mint_token)

    response = await _search(client, employer, skill=token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] is None
    assert body["next_cursor"] is None

    [card] = body["items"]
    assert set(card) == CARD_FIELDS
    assert card["candidate_id"] == str(candidate["id"])
    assert card["band"] == band_for(candidate["raw"])
    assert card["experience_years"] == 6
    assert {"SAP", token} <= set(card["skills"])
    assert card["badges"] == []

    # No contact and not the number. No name either: this candidate gave
    # none, and the one in their CV is never used.
    assert card["full_name"] is None
    assert candidate["phone"] not in response.text
    assert "Kavya" not in response.text
    assert candidate["raw"] not in card.values()


async def test_the_card_names_the_candidate_by_the_name_they_gave(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    candidate = await _candidate(mint_token, token)
    employer = await _employer(client, mint_token)
    named = await client.put(
        f"{PROFILE}/name", headers=candidate["headers"], json={"full_name": " Meera  Nair "}
    )
    assert named.status_code == 200, named.text

    response = await _search(client, employer, skill=token)
    assert response.status_code == 200, response.text
    [card] = response.json()["items"]
    assert card["full_name"] == "Meera Nair"
    assert candidate["phone"] not in response.text


async def test_suppressed_and_unchecked_candidates_are_never_searched(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    clean = await _candidate(mint_token, token)
    injected = await _candidate(mint_token, token, cv=INJECTED_CV)
    unchecked = await _candidate(mint_token, token, checked=False)
    employer = await _employer(client, mint_token)

    assert await _found(client, employer, skill=token) == {str(clean["id"])}
    # Both still have a document. Visibility is the CTE's decision, never the
    # document's, so there is no second rule to keep in step.
    for hidden in (injected, unchecked):
        assert (await _document(hidden["id"])).skill_keys


# --- filters ------------------------------------------------------------------
async def test_each_filter_narrows_the_pool(client: Any, mint_token: Any) -> None:
    token = _token()
    welding = f"Welding {token}"
    junior = await _candidate(mint_token, token, months=24)
    senior = await _candidate(mint_token, token, welding, months=120)
    certified = await _candidate(mint_token, token, addons=_course())

    moved = await client.put(
        f"{PROFILE}/location", json={"city": "Pune", "state_code": "MH"}, headers=senior["headers"]
    )
    assert moved.status_code == 200, moved.text

    employer = await _employer(client, mint_token)
    ids = {name: str(c["id"]) for name, c in (("j", junior), ("s", senior), ("c", certified))}

    assert await _found(client, employer, skill=token) == set(ids.values())
    assert await _found(client, employer, skill=token.upper()) == set(ids.values())
    assert await _found(client, employer, skill=[token, welding.lower()]) == {ids["s"]}
    # 24 and 77 months are 2 and 6 whole years; 120 is 10.
    assert await _found(client, employer, skill=token, min_experience_years=7) == {ids["s"]}
    assert await _found(client, employer, skill=token, min_experience_years=6) == {
        ids["s"],
        ids["c"],
    }
    assert await _found(client, employer, skill=token, q="welding") == {ids["s"]}
    assert await _found(client, employer, skill=token, city="pun") == {ids["s"]}
    assert await _found(client, employer, skill=token, state="MH") == {ids["s"]}
    assert await _found(client, employer, skill=token, state="KA") == set()
    assert await _found(client, employer, skill=token, badge="COURSE_COMPLETED") == {ids["c"]}

    band = band_for(junior["raw"])
    other = next(label for label, _, _ in BANDS if label != band)
    assert ids["j"] in await _found(client, employer, skill=token, band=band)
    assert ids["j"] not in await _found(client, employer, skill=token, band=other)


async def test_a_location_change_reaches_search_on_the_next_query(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    candidate = await _candidate(mint_token, token)
    employer = await _employer(client, mint_token)
    assert await _found(client, employer, skill=token, state="KA") == set()

    await client.put(f"{PROFILE}/location", json={"state_code": "KA"}, headers=candidate["headers"])
    response = await _search(client, employer, skill=token, state="KA")
    [card] = response.json()["items"]
    assert (card["city"], card["state_code"]) == (None, "KA")


async def test_a_malformed_filter_or_cursor_is_refused(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)

    state = await _search(client, employer, state="XX")
    assert state.status_code == 422
    assert state.json()["code"] == "discovery_state_invalid"
    assert (await _search(client, employer, cursor="not-a-cursor")).status_code == 422
    assert (await _search(client, employer, band="EXCELLENT")).status_code == 422
    assert (await _search(client, employer, badge="ANSWERS")).status_code == 422
    assert (await _search(client, employer, skill=[_token() for _ in range(6)])).status_code == 422
    assert (await _search(client, employer, skill="   ")).status_code == 422


# --- paging -------------------------------------------------------------------
async def test_pages_walk_the_results_without_repeating(client: Any, mint_token: Any) -> None:
    token = _token()
    expected = {str((await _candidate(mint_token, token))["id"]) for _ in range(3)}
    employer = await _employer(client, mint_token)

    first = (await _search(client, employer, skill=token, limit=2)).json()
    assert len(first["items"]) == 2
    assert first["next_cursor"]

    second = (
        await _search(client, employer, skill=token, limit=2, cursor=first["next_cursor"])
    ).json()
    assert len(second["items"]) == 1
    assert second["next_cursor"] is None

    seen = [item["candidate_id"] for item in first["items"] + second["items"]]
    assert len(seen) == len(set(seen))
    assert set(seen) == expected


# --- the search document --------------------------------------------------------
async def test_a_newer_score_replaces_what_search_knows(client: Any, mint_token: Any) -> None:
    old, new = _token(), _token()
    candidate = await _candidate(mint_token, old)
    await _rescore(candidate["id"], candidate["version_id"], _extraction(new))
    employer = await _employer(client, mint_token)

    assert await _found(client, employer, skill=old) == set()
    assert await _found(client, employer, skill=new) == {str(candidate["id"])}


async def test_contact_details_in_a_skill_reach_neither_the_index_nor_the_card(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    candidate = await _candidate(mint_token, token, email, PHONE_IN_CV)

    document = await _document(candidate["id"])
    assert email not in document.skills
    assert PHONE_IN_CV not in document.skills

    employer = await _employer(client, mint_token)
    response = await _search(client, employer, skill=token)
    assert email not in response.text
    assert PHONE_IN_CV not in response.text
    assert await _found(client, employer, skill=email) == set()


EXPERIENCE_CASES = {
    "summed": [{**ROLE, "months": 30}, {**ROLE, "months": 47}],
    "junk entries": [{**ROLE, "months": 30}, "junk", 5, None, {**ROLE, "months": 47}],
    "non-positive and non-integers": [
        {**ROLE, "months": "77"},
        {**ROLE, "months": 12.5},
        {**ROLE, "months": True},
        {**ROLE, "months": -3},
        {**ROLE, "months": None},
        {**ROLE, "months": 0},
        {**ROLE, "months": 10},
    ],
    "roles not a list": "not a list",
    "no roles": [],
}


@pytest.mark.parametrize("roles", EXPERIENCE_CASES.values(), ids=EXPERIENCE_CASES.keys())
async def test_the_document_counts_experience_exactly_as_scoring_does(roles: Any) -> None:
    """The trigger sums months in SQL; scoring sums them in Python. The filter
    is only honest while the two agree, including on malformed extractions."""
    user_id, _, _ = await _new_user()
    extracted = _extraction(_token(), roles=roles)
    await _scored_version(user_id, CLEAN_CV, extracted)

    document = await _document(user_id)
    assert document.experience_months == features_from_extraction(extracted).total_experience_months


@pytest.mark.parametrize(
    "addons",
    [
        None,
        _course(),
        AddOnContributions(
            course_points=30,
            interview_points=60,
            events=[
                {"kind": "course", "id": str(uuid.uuid4()), "points": 30},
                {"kind": "interview", "id": str(uuid.uuid4()), "points": 20},
                {"kind": "interview", "id": str(uuid.uuid4()), "points": 20},
                {"points": 5},
            ],
        ),
    ],
    ids=["resume only", "course", "course and interviews"],
)
async def test_the_band_and_badges_follow_the_score_they_came_from(
    addons: AddOnContributions | None,
) -> None:
    user_id, _, _ = await _new_user()
    extracted = _extraction(_token())
    version_id, _ = await _scored_version(user_id, CLEAN_CV, extracted)
    if addons is not None:
        await _rescore(user_id, version_id, extracted, addons)

    document = await _document(user_id)
    assert document.band == band_for(await _latest_raw(user_id))
    assert document.band_rank == [label for label, _, _ in BANDS].index(document.band)
    expected = sorted(
        {"course": "COURSE_COMPLETED", "interview": "MOCK_INTERVIEW_COMPLETED"}[str(e["kind"])]
        for e in (addons.events if addons else [])
        if "kind" in e
    )
    assert sorted(document.badges) == sorted(set(expected))


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE candidate_search_documents SET band = 'STRONG' WHERE user_id = :u",
        "DELETE FROM candidate_search_documents WHERE user_id = :u",
        "INSERT INTO candidate_search_documents (user_id, score_id, resume_version_id, "
        "computed_at, band, band_rank, experience_months, search_vector) "
        "SELECT :u, id, resume_version_id, now(), 'STRONG', 3, 999, ''::tsvector "
        "FROM scores WHERE user_id = :u LIMIT 1",
    ],
    ids=["update", "delete", "insert"],
)
async def test_only_the_trigger_writes_search_documents(statement: str) -> None:
    user_id, _, _ = await _new_user()
    await _scored_version(user_id, CLEAN_CV, _extraction(_token()))

    async with sessions(APP_URL)() as session:
        with pytest.raises(DBAPIError, match="permission denied"):
            async with session.begin():
                await session.execute(text(statement), {"u": str(user_id)})


# --- who may search -------------------------------------------------------------
async def test_only_owners_and_recruiters_of_a_verified_employer_search(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    candidate = await _candidate(mint_token, token)
    employer = await _employer(client, mint_token)
    recruiter = await _member(client, mint_token, employer, "EMPLOYER_RECRUITER")
    viewer = await _member(client, mint_token, employer, "EMPLOYER_VIEWER")

    assert await _found(client, recruiter, skill=token) == {str(candidate["id"])}
    assert (await _search(client, viewer, skill=token)).status_code == 403
    assert (await _search(client, candidate, skill=token)).status_code == 403

    await _set_kyb(employer["tenant_id"], "SUBMITTED")
    refused = await _search(client, employer, skill=token)
    assert refused.status_code == 403
    assert refused.json()["code"] == "kyb_required"


# --- the candidate's location ------------------------------------------------------
async def test_a_candidate_sets_and_clears_their_own_location(client: Any, mint_token: Any) -> None:
    _, subject, phone = await _new_user()
    headers, _ = mint_token(pool="CANDIDATE", subject=subject, phone=phone)
    location = f"{PROFILE}/location"

    empty = await client.get(PROFILE, headers=headers)
    assert empty.status_code == 200, empty.text
    assert empty.json()["city"] is None

    saved = await client.put(
        location, json={"city": "  Navi   Mumbai ", "state_code": "MH"}, headers=headers
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["city"] == "Navi Mumbai"
    assert (await client.get(PROFILE, headers=headers)).json()["state_code"] == "MH"

    cleared = await client.put(location, json={"city": None, "state_code": "MH"}, headers=headers)
    assert cleared.json()["city"] is None

    for refused in (
        {"city": "Pune 411001"},
        {"city": "me@example.com"},
        {"state_code": "XX"},
        {"city": "Pune", "address": "12 MG Road"},
    ):
        response = await client.put(location, json=refused, headers=headers)
        assert response.status_code == 422, refused

    employer = await _employer(client, mint_token)
    assert (
        await client.put(location, json={"city": "Pune"}, headers=employer["headers"])
    ).status_code == 403
