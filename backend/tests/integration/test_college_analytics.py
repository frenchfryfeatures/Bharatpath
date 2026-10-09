"""Through HTTP: cohort analytics and platform-sourced placements.

A college sees counts over the students linked to it **right now**, behind a
cohort floor; above it, exact numbers (client, 2026-09-30; a config row can
still switch small-cell suppression back on). Hires are counted
only when both sides confirmed them on the platform, and are labelled so.
Whether a revoked consent leaves the figures at once is invariant 9's, in
`tests/invariants/test_invariant_09_consent.py`.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions
from tests.integration.test_college import COLLEGE, _code, _college
from tests.integration.test_college_consent import _application, _employer, _seed_student
from tests.integration.test_payments import _candidate

pytestmark = pytest.mark.integration

OVERVIEW = f"{COLLEGE}/analytics/overview"
PLACEMENTS = f"{COLLEGE}/analytics/placements"


@asynccontextmanager
async def _floors(value: Any) -> AsyncIterator[None]:
    """An `analytics.privacy` row for the duration. Config rows are global,
    so it is deleted in `finally`."""
    row_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO config_values (id, key, value, version, effective_from) "
                "SELECT :id, 'analytics.privacy', CAST(:v AS jsonb), "
                "coalesce(max(version), 0) + 1, now() - interval '1 hour' "
                "FROM config_values WHERE key = 'analytics.privacy'"
            ),
            {"id": str(row_id), "v": json.dumps(value)},
        )
    try:
        yield
    finally:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("DELETE FROM config_values WHERE id = :id"), {"id": str(row_id)}
            )


async def _cohort(client: Any, mint_token: Any) -> dict[str, Any]:
    """Twelve linked students: six ENTRY, four SOLID, two STRONG; one lets
    the college see them. Four applications between them, one confirmed hire,
    one disputed. Plus two hires that must not count."""
    college = await _college(client, mint_token)
    code = await _code(client, college)
    scores = [720] * 6 + [830] * 4 + [900] * 2
    students = [
        await _seed_student(college, code["id"], score=score, individual=(i == 0))
        for i, score in enumerate(scores)
    ]
    employer = await _employer("  pune ")
    await _application(employer, students[0], outcome="SUBMITTED")
    await _application(employer, students[1], outcome="INTERVIEW")
    await _application(employer, students[2], outcome="HIRED")
    await _application(employer, students[3], outcome="DISPUTED")

    # Hired, but not this college's to count: linked elsewhere, or nowhere.
    elsewhere = await _college(client, mint_token)
    elsewhere_code = await _code(client, elsewhere)
    theirs = await _seed_student(elsewhere, elsewhere_code["id"], score=800)
    await _application(employer, theirs, outcome="HIRED")
    nobody = await _candidate(mint_token)
    await _application(employer, nobody["id"], outcome="HIRED")
    return {**college, "students": students}


async def test_below_the_floor_a_college_sees_counts_only(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    for score in (720, 900, 830):
        await _seed_student(college, code["id"], score=score)

    overview = await client.get(OVERVIEW, headers=college["headers"])
    assert overview.status_code == 200, overview.text
    assert overview.json() == {
        "connected_students": 3,
        "individually_visible": 0,
        "min_cohort_size": 10,
        "below_floor": True,
        "scored_students": None,
        "score_distribution": None,
        "median_score": None,
        "applicants": None,
        "applications": None,
        "interviews": None,
        "platform_hires": None,
    }
    placements = (await client.get(PLACEMENTS, headers=college["headers"])).json()
    assert placements["source"] == "PLATFORM" and placements["below_floor"] is True
    assert placements["total_hires"] is None and placements["by_location"] == []
    assert len(placements["by_month"]) == 12
    assert all(month["hires"] is None for month in placements["by_month"])


async def test_over_the_floor_the_cohort_is_described_without_describing_anyone(
    client: Any, mint_token: Any
) -> None:
    college = await _cohort(client, mint_token)

    overview = (await client.get(OVERVIEW, headers=college["headers"])).json()
    assert (overview["connected_students"], overview["individually_visible"]) == (12, 1)
    assert overview["below_floor"] is False and overview["scored_students"] == 12
    # Exact above the cohort floor (client, 2026-09-30): no band is withheld.
    assert overview["score_distribution"] == {
        "ENTRY": 6,
        "DEVELOPING": 0,
        "SOLID": 4,
        "STRONG": 2,
    }
    assert overview["median_score"] == 780
    assert (overview["applicants"], overview["applications"]) == (4, 4)
    assert overview["interviews"] == 3, "reached an interview, whatever happened next"
    assert overview["platform_hires"] == 1, "disputed and other colleges' hires are not counted"

    placements = (await client.get(PLACEMENTS, headers=college["headers"])).json()
    assert placements["source"] == "PLATFORM" and placements["total_hires"] == 1
    # One hire this month is shown as one, and every other month as zero.
    months = [m["hires"] for m in placements["by_month"]]
    assert months[-1] == 1 and months[:-1] == [0] * 11
    assert placements["by_location"] == [{"location": "Pune", "hires": 1}]


async def test_a_raised_cell_floor_withholds_small_cells_again(
    client: Any, mint_token: Any
) -> None:
    """Exact cells are the default, not the only setting: a config row that
    raises `min_cell_size` brings suppression and its complement back."""
    college = await _cohort(client, mint_token)
    async with _floors({"min_cell_size": 5}):
        overview = (await client.get(OVERVIEW, headers=college["headers"])).json()
        # Four SOLID and two STRONG are each fewer than five: both withheld.
        assert overview["score_distribution"] == {
            "ENTRY": 6,
            "DEVELOPING": 0,
            "SOLID": None,
            "STRONG": None,
        }
        placements = (await client.get(PLACEMENTS, headers=college["headers"])).json()
        # One hire this month is too few to show, and hides beside a zero month.
        assert [m["hires"] for m in placements["by_month"]].count(None) == 2
        assert placements["by_location"] == [{"location": "OTHER", "hires": 1}]


async def test_both_college_roles_read_analytics_and_nobody_else_does(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    staff_email = f"{uuid.uuid4().hex[:12]}@example.test"
    added = await client.post(
        f"{COLLEGE}/team",
        json={"email": staff_email, "role": "COLLEGE_STAFF"},
        headers=college["headers"],
    )
    assert added.status_code == 201
    staff_headers, _ = mint_token(pool="BUSINESS", email=staff_email)
    for path in (OVERVIEW, PLACEMENTS):
        assert (await client.get(path, headers=staff_headers)).status_code == 200

    unpaid = await _college(client, mint_token, seats_paid=None)
    student = await _candidate(mint_token)
    from tests.integration.test_payments import _owner

    employer = await _owner(client, mint_token)
    for path in (OVERVIEW, PLACEMENTS):
        assert (await client.get(path, headers=unpaid["headers"])).status_code == 402
        assert (await client.get(path, headers=student["headers"])).status_code == 403
        assert (await client.get(path, headers=employer["headers"])).status_code == 403


async def test_a_raised_floor_applies_and_a_broken_one_refuses(
    client: Any, mint_token: Any
) -> None:
    college = await _cohort(client, mint_token)
    async with _floors({"min_cohort_size": 20}):
        raised = (await client.get(OVERVIEW, headers=college["headers"])).json()
        assert raised["below_floor"] is True and raised["min_cohort_size"] == 20
    async with _floors({"min_cohort_size": 2}):
        refused = await client.get(OVERVIEW, headers=college["headers"])
        assert refused.status_code == 500
        assert refused.json()["code"] == "analytics_floors_invalid"
    restored = (await client.get(OVERVIEW, headers=college["headers"])).json()
    assert restored["below_floor"] is False
