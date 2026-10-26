"""One resume to scoring per `resume.scoring_interval` (2026-10-26).

A candidate may upload, paste, correct and push as often as they like. A
*confirmation* is what sends a resume to scoring, so that is where the limit
lives: a second one inside the interval is 409 `resume_scoring_cooldown`,
emits nothing, and leaves the last confirmed version as the one scored.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, age_resume_confirmations, sessions
from tests.integration.test_candidate_marketplace import _candidate
from tests.integration.test_resume_review_confirm import (
    CORRECTED,
    PASTED,
    _confirm,
    _edit,
    _paste,
    candidate,  # noqa: F401 - the fixture, used by name
)

pytestmark = pytest.mark.integration

API = "/api/v1/candidate/resume"


async def _confirmed_events(user_id: uuid.UUID) -> int:
    async with sessions(_seed_url())() as session:
        return int(
            await session.scalar(
                text(
                    "SELECT count(*) FROM outbox WHERE event_type = 'resume.version_confirmed' "
                    "AND payload->>'user_id' = :u"
                ),
                {"u": str(user_id)},
            )
            or 0
        )


async def test_a_second_confirmation_inside_the_interval_is_refused(
    candidate: uuid.UUID,  # noqa: F811
) -> None:
    from app.modules.resume import service

    first = await _paste(candidate)
    await _confirm(candidate, first.id)
    second = await _paste(candidate, CORRECTED)

    with pytest.raises(service.ScoringCooldownError) as refused:
        await _confirm(candidate, second.id)

    assert refused.value.params["interval_days"] >= 1
    assert datetime.fromisoformat(refused.value.params["next_scoring_at"]) > datetime.now(UTC)
    assert await _confirmed_events(candidate) == 1, "a refused confirm reached scoring"
    async with sessions(_seed_url())() as session:
        scorable = await service.get_scorable_version(session, user_id=candidate)
        unconfirmed = await session.scalar(
            text("SELECT confirmed_at FROM resume_versions WHERE id = :v"), {"v": str(second.id)}
        )
    assert scorable.id == first.id
    assert unconfirmed is None


async def test_uploads_and_corrections_are_never_limited(
    candidate: uuid.UUID,  # noqa: F811
) -> None:
    """The limit is on scoring, not on sending a CV."""
    first = await _paste(candidate)
    await _confirm(candidate, first.id)

    for n in range(5):
        await _paste(candidate, f"{PASTED}\nProject {n}")
    edited = await _edit(candidate, first.id, text=CORRECTED)
    assert edited.confirmed_at is None


async def test_a_retry_of_the_confirmation_is_not_a_refusal(
    candidate: uuid.UUID,  # noqa: F811
) -> None:
    """A phone that lost its response and asks again gets the original
    answer, not a cooldown for the confirmation it already made."""
    row = await _paste(candidate)
    await _confirm(candidate, row.id)
    again, already = await _confirm(candidate, row.id)
    assert already is True and again.id == row.id


async def test_once_the_interval_has_passed_the_next_confirmation_goes_through(
    candidate: uuid.UUID,  # noqa: F811
) -> None:
    from app.modules.resume import service

    first = await _paste(candidate)
    await _confirm(candidate, first.id)
    second = await _paste(candidate, CORRECTED)
    await age_resume_confirmations(candidate)

    _, already = await _confirm(candidate, second.id)
    assert already is False
    assert await _confirmed_events(candidate) == 2
    async with sessions(_seed_url())() as session:
        assert (await service.get_scorable_version(session, user_id=candidate)).id == second.id


async def _set_interval(days: int) -> str:
    """A `resume.scoring_interval` row above any existing one. Config rows
    are global: the caller deletes it in a `finally`."""
    row = str(uuid.uuid4())
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO config_values (id, key, value, version, effective_from) "
                "SELECT :i, 'resume.scoring_interval', CAST(:v AS jsonb), "
                "coalesce(max(version), 0) + 1, :f "
                "FROM config_values WHERE key = 'resume.scoring_interval'"
            ),
            {"i": row, "v": json.dumps({"days": days}), "f": datetime(2026, 1, 1, tzinfo=UTC)},
        )
    return row


async def _drop_config(row: str) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(text("DELETE FROM config_values WHERE id = :i"), {"i": row})


async def test_the_interval_is_config_and_zero_switches_it_off(
    candidate: uuid.UUID,  # noqa: F811
) -> None:
    row = await _set_interval(0)
    try:
        first = await _paste(candidate)
        await _confirm(candidate, first.id)
        second = await _paste(candidate, CORRECTED)
        _, already = await _confirm(candidate, second.id)
        assert already is False
    finally:
        await _drop_config(row)


async def test_a_malformed_interval_row_refuses_rather_than_defaulting(
    candidate: uuid.UUID,  # noqa: F811
) -> None:
    from app.modules.resume import service

    row = str(uuid.uuid4())
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO config_values (id, key, value, version, effective_from) "
                "SELECT :i, 'resume.scoring_interval', CAST(:v AS jsonb), "
                "coalesce(max(version), 0) + 1, :f "
                "FROM config_values WHERE key = 'resume.scoring_interval'"
            ),
            {"i": row, "v": json.dumps({"days": "15"}), "f": datetime(2026, 1, 1, tzinfo=UTC)},
        )
    try:
        version = await _paste(candidate)
        with pytest.raises(service.ScoringIntervalInvalidError):
            await _confirm(candidate, version.id)
    finally:
        await _drop_config(row)


# --- through HTTP ------------------------------------------------------------
async def test_the_window_says_when_and_the_confirm_route_answers_409(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=True)

    before = await client.get(f"{API}/scoring-window", headers=me["headers"])
    assert before.status_code == 200, before.text
    assert before.json()["can_confirm_now"] is True
    assert before.json()["next_scoring_at"] is None
    assert before.json()["last_confirmed_at"] is None

    first = await _paste(me["id"])
    confirmed = await client.post(f"{API}/versions/{first.id}/confirm", headers=me["headers"])
    assert confirmed.status_code == 200, confirmed.text

    after = (await client.get(f"{API}/scoring-window", headers=me["headers"])).json()
    assert after["can_confirm_now"] is False
    assert after["next_scoring_at"] is not None

    second = await _paste(me["id"], CORRECTED)
    refused = await client.post(f"{API}/versions/{second.id}/confirm", headers=me["headers"])
    assert refused.status_code == 409, refused.text
    body = refused.json()
    assert body["code"] == "resume_scoring_cooldown"
    assert refused.headers["content-type"].startswith("application/problem+json")
    assert datetime.fromisoformat(body["params"]["next_scoring_at"]) == datetime.fromisoformat(
        after["next_scoring_at"].replace("Z", "+00:00")
    )


async def test_the_window_is_not_paywalled(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    response = await client.get(f"{API}/scoring-window", headers=me["headers"])
    assert response.status_code == 200, response.text
