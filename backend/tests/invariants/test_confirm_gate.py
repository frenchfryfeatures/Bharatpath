"""SRS 1.4.4 — an unconfirmed resume version can never reach scoring.

The gate is mandatory because parsing is not accurate. A borderless-table CV,
a phone photo, a two-column layout: each produces text that is plausible and
wrong in ways only the candidate can see. Attaching a number to that without
showing it to them first is the failure this rule exists to prevent.

**Much of this file is a tripwire on scoring's wiring.** The mistake that
would bypass the gate -- scoring on the creation event instead of the
confirmation -- leaves the gate function intact and the rest of the suite
green, so it has to fail the build here instead of shipping.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.invariant

ROOT = Path(__file__).resolve().parents[2]
RESUME = ROOT / "app" / "modules" / "resume"

#: The event a score may be recalculated from. Emitted only when a candidate
#: confirms, so a consumer of it cannot see unconfirmed content.
CONFIRMED_EVENT = "resume.version_confirmed"

#: Emitted on every parse and every correction, **including unconfirmed
#: ones**. A scoring trigger wired to this would score content the candidate
#: has never approved.
CREATED_EVENT = "resume.version_created"


# ---------------------------------------------------------------------------
# The gate itself
# ---------------------------------------------------------------------------
@pytest.fixture
async def candidate() -> uuid.UUID:
    user_id = uuid.uuid4()
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "p": f"+9199{uuid.uuid4().int % 10**8:08d}"},
        )
    return user_id


CV = (
    "Arjun Mehta - Data Engineer, Pune\n"
    "Tata Consultancy Services, Data Engineer, 2020 to 2025\n"
    "B.E. Information Technology, Pune University, 2019\n"
    "Skills: Spark, Airflow, Python"
)


@pytest.mark.integration
async def test_an_unconfirmed_version_is_never_returned_as_scorable(
    candidate: uuid.UUID,
) -> None:
    """The whole invariant in one assertion. A version exists, it holds a real
    CV, and scoring still cannot have it."""
    from app.modules.resume import service
    from app.modules.resume.service import ResumeNotConfirmedError

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await service.create_pasted_version(session, user_id=candidate, text=CV)

    async with factory() as session:
        with pytest.raises(ResumeNotConfirmedError):
            await service.get_scorable_version(session, user_id=candidate)


@pytest.mark.integration
async def test_the_gate_is_a_sql_predicate_and_not_a_python_check(
    candidate: uuid.UUID,
) -> None:
    """**Where the filter lives matters.**

    A Python check after the fetch can be forgotten by the next caller, and
    the row it should have refused is already in memory. This asserts the
    unconfirmed row is never loaded at all: with one confirmed and one
    unconfirmed version, the newer *unconfirmed* one must not be what comes
    back, even though it is the most recent row for this user.
    """
    from app.modules.resume import service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        confirmed = await service.create_pasted_version(session, user_id=candidate, text=CV)
    async with factory() as session, session.begin():
        await service.confirm_version(session, user_id=candidate, resume_version_id=confirmed.id)
    async with factory() as session, session.begin():
        newer = await service.create_pasted_version(
            session, user_id=candidate, text=CV + "\nAlso: dbt"
        )

    async with factory() as session:
        scorable = await service.get_scorable_version(session, user_id=candidate)

    assert scorable.id == confirmed.id
    assert scorable.id != newer.id, "an unconfirmed version was offered for scoring"


@pytest.mark.integration
async def test_confirming_is_the_only_thing_that_opens_the_gate(
    candidate: uuid.UUID,
) -> None:
    """Neither creating nor editing may open it -- only the explicit act."""
    from app.modules.resume import service
    from app.modules.resume.schemas import ResumeEditRequest
    from app.modules.resume.service import ResumeNotConfirmedError

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        original = await service.create_pasted_version(session, user_id=candidate, text=CV)
    async with factory() as session, session.begin():
        await service.edit_version(
            session,
            user_id=candidate,
            resume_version_id=original.id,
            payload=ResumeEditRequest(text=CV + "\nAlso: dbt"),
        )

    async with factory() as session:
        with pytest.raises(ResumeNotConfirmedError):
            await service.get_scorable_version(session, user_id=candidate)


# ---------------------------------------------------------------------------
# The tripwire: scoring must consume the right event
# ---------------------------------------------------------------------------
def _module_source(name: str) -> str:
    return (RESUME / name).read_text(encoding="utf-8")


@pytest.mark.integration
async def test_creating_a_version_does_not_emit_the_confirmed_event(
    candidate: uuid.UUID,
) -> None:
    """`version_created` fires for unconfirmed content, `version_confirmed`
    must not. If both fired on creation, a correct consumer of the correct
    event would still score an unreviewed CV."""
    from app.modules.resume import service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        row = await service.create_pasted_version(session, user_id=candidate, text=CV)

    async with factory() as session:
        created = await session.scalar(
            text("SELECT count(*) FROM outbox WHERE event_type = :t AND aggregate_id = :a"),
            {"t": CREATED_EVENT, "a": str(row.id)},
        )
        confirmed = await session.scalar(
            text("SELECT count(*) FROM outbox WHERE event_type = :t AND aggregate_id = :a"),
            {"t": CONFIRMED_EVENT, "a": str(row.id)},
        )

    assert created == 1
    assert confirmed == 0


def test_scoring_is_not_wired_to_the_version_created_event() -> None:
    """**The mistake this file exists to catch, and it is a plausible one.**

    `resume.version_created` is the obvious event to recalculate a score from:
    it fires whenever a resume changes, which sounds exactly right. It fires
    on every *unconfirmed* parse and every *unconfirmed* correction too, so
    subscribing to it bypasses the confirm gate completely -- while every
    other test in the suite still passes, because the gate function is intact
    and simply never called.

    Scoring must consume `resume.version_confirmed`. If a deliberate reason to
    reference the creation event in scoring ever appears, this test is where
    it has to be argued for.
    """
    scoring = ROOT / "app" / "modules" / "scoring"
    offenders = [
        path.relative_to(ROOT).as_posix()
        for path in scoring.rglob("*.py")
        if CREATED_EVENT in path.read_text(encoding="utf-8")
    ]
    assert not offenders, (
        f"{offenders} reference {CREATED_EVENT!r}. Scoring must trigger on "
        f"{CONFIRMED_EVENT!r} -- the creation event fires for versions the "
        "candidate has never reviewed, so consuming it bypasses SRS 1.4.4."
    )


def test_the_subscription_table_routes_scoring_to_the_confirmed_event() -> None:
    """**The gate expressed as a subscription, and the stronger half of this
    file.**

    The source scan above proves scoring does not *name* the creation event.
    This proves the trigger names the right one — which is the thing that
    actually decides what gets scored, and the thing anyone adding a re-score
    trigger will edit.
    """
    from app.tasks.routing import SCORE_RESUME_TASK, tasks_for

    assert SCORE_RESUME_TASK in tasks_for(CONFIRMED_EVENT), (
        f"{CONFIRMED_EVENT!r} does not trigger scoring, so confirming a resume computes nothing."
    )


def test_the_creation_event_triggers_no_scoring() -> None:
    """The mistake, caught at the one place it would actually be made.

    `resume.version_created` fires on every parse and every correction,
    including unconfirmed ones. Routing it to the scoring task would score
    content the candidate has never reviewed.
    """
    from app.tasks.routing import SCORE_RESUME_TASK, tasks_for

    assert SCORE_RESUME_TASK not in tasks_for(CREATED_EVENT), (
        f"{CREATED_EVENT!r} triggers scoring. It fires for versions nobody has "
        f"reviewed — scoring must trigger on {CONFIRMED_EVENT!r}."
    )


def test_the_routed_task_name_is_one_a_worker_actually_registers() -> None:
    """A routing table pointing at a task name nobody registers is wiring that
    reads as working and does nothing.

    The two strings live in different files — `routing.py` names the task,
    `app/tasks/score_resume.py` registers it — so a rename in either direction
    silently breaks the trigger, and the symptom is scores that never appear
    rather than an error anyone sees.
    """
    import app.tasks.score_resume  # noqa: F401  - registers the task
    from app.tasks.routing import SCORE_RESUME_TASK
    from app.worker import celery_app

    assert SCORE_RESUME_TASK in celery_app.tasks, (
        f"{SCORE_RESUME_TASK!r} is routed to but no task registers under that "
        f"name. Registered: {sorted(n for n in celery_app.tasks if not n.startswith('celery.'))}"
    )


def test_confirmation_still_emits_an_event_for_scoring_to_consume() -> None:
    """The other half. A gate nothing announces would leave scoring with no
    trigger, and the obvious fix would be to reach for the creation event."""
    assert CONFIRMED_EVENT.split(".", 1)[1] in _module_source("service.py")


# ---------------------------------------------------------------------------
# Structural: the gate cannot be moved somewhere it can be skipped
# ---------------------------------------------------------------------------
def test_the_repository_has_no_update_path_for_version_content() -> None:
    """Versions are append-only, which is half of invariant 1: a score points
    at the exact version it was computed from, so that content can never
    change underneath it.

    `confirm_version` is the single permitted mutation and it touches
    `confirmed_at` only -- the latch, never the content.
    """
    tree = ast.parse(_module_source("repository.py"))
    mutators = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef)
        and "update(ResumeVersion)" in ast.get_source_segment(_module_source("repository.py"), node)
    ]
    assert mutators == ["confirm_version"], (
        f"{mutators} update resume_versions. Only `confirm_version` may, and "
        "only to latch confirmed_at."
    )


def test_the_confirm_latch_cannot_overwrite_an_existing_confirmation() -> None:
    """`confirmed_at IS NULL` in the WHERE clause is what makes this a latch.

    Without it, confirming twice would move the timestamp -- and the moment a
    candidate took responsibility for scored content is a fact about them, not
    about how many times their connection dropped.
    """
    source = _module_source("repository.py")
    tree = ast.parse(source)
    confirm = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "confirm_version"
    )
    body = ast.get_source_segment(source, confirm) or ""
    assert "confirmed_at.is_(None)" in body, "the confirm latch lost its NULL guard"


def test_only_one_query_returns_a_version_for_scoring() -> None:
    """The gate is one function, so there is one place to get it right.

    `get_version` and `list_versions` also return unconfirmed rows, quite
    correctly -- they serve the review screen, which exists precisely to show
    a candidate content that has not been confirmed yet. What must stay true
    is that exactly one query filters on confirmation, so that "which one does
    scoring call?" has an answer rather than a convention.
    """
    source = _module_source("repository.py")
    tree = ast.parse(source)
    gated = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef)
        and "confirmed_at.is_not(None)" in (ast.get_source_segment(source, node) or "")
    ]
    assert gated == ["latest_confirmed_version"]
