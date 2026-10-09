"""At the database layer: the pipeline with the service out of the way.

The HTTP tests prove the service behaves. These prove what is left if it does
not: `guard_application_write` and the CHECKs on `applications`, against the
migrator (which bypasses every policy) and against app-role sessions bound as
a tenant or as a candidate.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.core.db import set_transaction_tenant, set_transaction_user
from tests.conftest import _seed_url, sessions
from tests.integration.test_marketplace_rls import _published_job, _user

pytestmark = pytest.mark.integration

APP_URL = os.getenv("DATABASE_URL", "")
REFUSED = (DBAPIError, ProgrammingError)


async def _application(tenant_id: uuid.UUID, *stages: str) -> tuple[uuid.UUID, uuid.UUID]:
    """A SUBMITTED application walked through `stages`, one UPDATE each.
    Returns `(application id, candidate id)`."""
    job = await _published_job(tenant_id)
    candidate = await _user("CANDIDATE")
    application = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage) "
                "VALUES (:a, :t, :j, :c, 'SUBMITTED')"
            ),
            {"a": str(application), "t": str(tenant_id), "j": str(job), "c": str(candidate)},
        )
        for stage in stages:
            await session.execute(
                text("UPDATE applications SET stage = :s WHERE id = :a"),
                {"s": stage, "a": str(application)},
            )
    return application, candidate


TO_DECISION = ("VIEWED", "SHORTLISTED", "INTERVIEW", "DECISION")


async def _as_migrator(sql: str, **params: object) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(text(sql), {k: str(v) for k, v in params.items()})


async def _refused_as_migrator(sql: str, marker: str, **params: object) -> None:
    with pytest.raises(REFUSED) as refused:
        await _as_migrator(sql, **params)
    assert marker in str(refused.value), str(refused.value)


async def _stage(application: uuid.UUID) -> str:
    async with sessions(_seed_url())() as session:
        return str(
            await session.scalar(
                text("SELECT stage FROM applications WHERE id = :a"), {"a": str(application)}
            )
        )


# --- rules for every writer -------------------------------------------------------
async def test_an_application_is_filed_at_submitted(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    job = await _published_job(tenant_a)
    candidate = await _user("CANDIDATE")
    for column, value in (("stage", "'SHORTLISTED'"), ("meeting_url", "'https://m.example.com'")):
        await _refused_as_migrator(
            f"INSERT INTO applications (id, tenant_id, job_id, candidate_id, {column}) "
            f"VALUES (gen_random_uuid(), :t, :j, :c, {value})",
            "APPLICATION_GUARD",
            t=tenant_a,
            j=job,
            c=candidate,
        )


@pytest.mark.parametrize(
    ("walk", "target"),
    [
        ((), "SHORTLISTED"),
        ((), "HIRED"),
        (("VIEWED",), "DECISION"),
        (("VIEWED", "SHORTLISTED"), "VIEWED"),
        (("REJECTED",), "VIEWED"),
        (("WITHDRAWN",), "SUBMITTED"),
        (("EXPIRED",), "SHORTLISTED"),
    ],
)
async def test_only_pipeline_transitions_are_accepted(
    seeded_tenants, walk: tuple[str, ...], target: str
) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a, *walk)
    await _refused_as_migrator(
        "UPDATE applications SET stage = :s WHERE id = :a",
        "not a pipeline transition",
        s=target,
        a=application,
    )


async def test_hired_needs_both_confirmations(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a, *TO_DECISION)
    await _refused_as_migrator(
        "UPDATE applications SET stage = 'HIRED' WHERE id = :a", "ck_applications", a=application
    )
    await _as_migrator(
        "UPDATE applications SET employer_confirmed_at = now() WHERE id = :a", a=application
    )
    await _refused_as_migrator(
        "UPDATE applications SET stage = 'HIRED' WHERE id = :a",
        "ck_applications_hired_by_both",
        a=application,
    )
    await _as_migrator(
        "UPDATE applications SET stage = 'HIRED', candidate_confirmed_at = now() WHERE id = :a",
        a=application,
    )
    assert await _stage(application) == "HIRED"


async def test_the_candidate_cannot_confirm_first(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a, *TO_DECISION)
    await _refused_as_migrator(
        "UPDATE applications SET candidate_confirmed_at = now() WHERE id = :a",
        "ck_applications_candidate_confirms_second",
        a=application,
    )


@pytest.mark.parametrize(
    "change",
    [
        "employer_confirmed_at = NULL",
        "employer_confirmed_at = now() + interval '1 day'",
        "hire_disputed_at = NULL",
    ],
)
async def test_hire_confirmations_are_latches(seeded_tenants, change: str) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a, *TO_DECISION)
    await _as_migrator(
        "UPDATE applications SET employer_confirmed_at = now(), hire_disputed_at = now() "
        "WHERE id = :a",
        a=application,
    )
    await _refused_as_migrator(
        f"UPDATE applications SET {change} WHERE id = :a", "latches", a=application
    )


async def test_an_application_is_never_refiled(seeded_tenants) -> None:
    tenant_a, tenant_b = seeded_tenants
    application, _ = await _application(tenant_a)
    someone = await _user("CANDIDATE")
    await _refused_as_migrator(
        "UPDATE applications SET candidate_id = :c WHERE id = :a",
        "never refiled",
        c=someone,
        a=application,
    )
    other_job = await _published_job(tenant_b)
    await _refused_as_migrator(
        "UPDATE applications SET tenant_id = :t, job_id = :j WHERE id = :a",
        "never refiled",
        t=tenant_b,
        j=other_job,
        a=application,
    )


async def test_a_meeting_link_that_is_not_https_is_refused(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a, "VIEWED", "SHORTLISTED", "INTERVIEW")
    await _refused_as_migrator(
        "UPDATE applications SET meeting_url = 'javascript:alert(1)', "
        "interview_at = now() + interval '1 day' WHERE id = :a",
        "ck_applications_meeting_https",
        a=application,
    )
    await _refused_as_migrator(
        "UPDATE applications SET meeting_url = 'https://meet.example.com/x' WHERE id = :a",
        "ck_applications_interview_complete",
        a=application,
    )


# --- each party writes only its own side -----------------------------------------
async def _as_tenant(tenant_id: uuid.UUID, sql: str, **params: object) -> int:
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_tenant(session, tenant_id)
        result = await session.execute(text(sql), {k: str(v) for k, v in params.items()})
        return int(result.rowcount)  # type: ignore[attr-defined]


async def _as_candidate(candidate_id: uuid.UUID, sql: str, **params: object) -> int:
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, candidate_id)
        result = await session.execute(text(sql), {k: str(v) for k, v in params.items()})
        return int(result.rowcount)  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "change",
    [
        "stage = 'WITHDRAWN'",
        "candidate_confirmed_at = now()",
        "hire_disputed_at = now()",
    ],
)
async def test_an_employer_cannot_act_for_the_candidate(seeded_tenants, change: str) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a, *TO_DECISION)
    await _as_migrator(
        "UPDATE applications SET employer_confirmed_at = now() WHERE id = :a", a=application
    )
    with pytest.raises(REFUSED) as refused:
        await _as_tenant(tenant_a, f"UPDATE applications SET {change} WHERE id = :a", a=application)
    assert "not the employer's to change" in str(refused.value) or "ck_applications" in str(
        refused.value
    )
    assert await _stage(application) == "DECISION"


async def test_an_employer_moves_its_own_pipeline(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a)
    touched = await _as_tenant(
        tenant_a,
        "UPDATE applications SET stage = 'VIEWED', employer_active_at = now() WHERE id = :a",
        a=application,
    )
    assert touched == 1
    assert await _stage(application) == "VIEWED"


@pytest.mark.parametrize(
    "change",
    [
        "stage = 'SHORTLISTED'",
        "stage = 'REJECTED'",
        "employer_confirmed_at = now()",
        "meeting_url = 'https://meet.example.com/x', interview_at = now() + interval '1 day'",
        "employer_active_at = now() + interval '1 year'",
    ],
)
async def test_a_candidate_cannot_act_for_the_employer(seeded_tenants, change: str) -> None:
    tenant_a, _ = seeded_tenants
    application, candidate = await _application(tenant_a, "VIEWED", "SHORTLISTED", "INTERVIEW")
    before = await _stage(application)
    with pytest.raises(REFUSED) as refused:
        await _as_candidate(
            candidate, f"UPDATE applications SET {change} WHERE id = :a", a=application
        )
    assert "not the candidate's to change" in str(refused.value) or "pipeline" in str(refused.value)
    assert await _stage(application) == before


async def test_a_candidate_withdraws_and_confirms_their_own(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    withdrawn, candidate = await _application(tenant_a, "VIEWED")
    assert (
        await _as_candidate(
            candidate, "UPDATE applications SET stage = 'WITHDRAWN' WHERE id = :a", a=withdrawn
        )
        == 1
    )

    hired, candidate = await _application(tenant_a, *TO_DECISION)
    await _as_migrator(
        "UPDATE applications SET employer_confirmed_at = now() WHERE id = :a", a=hired
    )
    assert (
        await _as_candidate(
            candidate,
            "UPDATE applications SET stage = 'HIRED', candidate_confirmed_at = now() WHERE id = :a",
            a=hired,
        )
        == 1
    )
    assert await _stage(hired) == "HIRED"


# --- the history ----------------------------------------------------------------------
async def test_application_events_are_append_only(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a)
    await _as_migrator(
        "INSERT INTO application_events (id, application_id, to_stage, actor_type) "
        "VALUES (gen_random_uuid(), :a, 'SUBMITTED', 'SYSTEM')",
        a=application,
    )
    for statement in ("UPDATE application_events SET note = 'x'", "DELETE FROM application_events"):
        async with sessions(APP_URL)() as session, session.begin():
            with pytest.raises(REFUSED) as refused:
                await session.execute(text(statement))
        assert "permission denied" in str(refused.value).lower(), statement


async def test_events_recorded_together_keep_their_order(seeded_tenants) -> None:
    """`clock_timestamp()`: two events in one transaction still sort as written."""
    tenant_a, _ = seeded_tenants
    application, _ = await _application(tenant_a)
    async with sessions(_seed_url())() as session, session.begin():
        for stage in ("SUBMITTED", "VIEWED", "SHORTLISTED"):
            await session.execute(
                text(
                    "INSERT INTO application_events (id, application_id, to_stage, actor_type) "
                    "VALUES (gen_random_uuid(), :a, :s, 'SYSTEM')"
                ),
                {"a": str(application), "s": stage},
            )
    async with sessions(_seed_url())() as session:
        stages = (
            await session.execute(
                text(
                    "SELECT to_stage FROM application_events WHERE application_id = :a "
                    "ORDER BY occurred_at"
                ),
                {"a": str(application)},
            )
        ).scalars()
        assert list(stages) == ["SUBMITTED", "VIEWED", "SHORTLISTED"]


async def test_a_system_event_names_no_person(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    application, candidate = await _application(tenant_a)
    await _refused_as_migrator(
        "INSERT INTO application_events (id, application_id, to_stage, actor_type, actor_id) "
        "VALUES (gen_random_uuid(), :a, 'EXPIRED', 'SYSTEM', :c)",
        "ck_app_events_system_has_no_actor",
        a=application,
        c=candidate,
    )
