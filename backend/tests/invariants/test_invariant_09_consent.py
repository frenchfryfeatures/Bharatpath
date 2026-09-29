"""Invariant 9: college consent is required, and every reveal is audited.

PRD rule 8 (plan.md section 1, invariant 9): an institution sees aggregates
over students who consented to be counted, sees a student as a person only
with that student's separate consent, and every such sight is audited. The
proof, in the order the plan asks for it:

  1. **Analytics INNER JOINs consent in the query.** Every function a college
     reads a student through is checked in `pg_proc`: it joins
     `student_consents` on a live row of the right scope. And the application
     code that serves colleges reaches no student table any other way.
  2. **Removing consent makes rows disappear** -- from the aggregates and from
     the individual view, on the very next read.
  3. **Roster consent never implies individual visibility**, and nothing but
     the student confers either scope: not a college, not another student.
  4. **Every reveal is audited**, in the same transaction, or it does not
     happen.
  5. **Nothing a college is shown can hold what it was not given**: the
     aggregate schemas have no field for a person, and the individual view's
     field list is fixed here.
"""

from __future__ import annotations

import importlib.util
import re
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from pydantic import BaseModel
from sqlalchemy import text

from app.modules.analytics import schemas as analytics_schemas
from app.modules.college.schemas import CollegeStudentResponse
from tests.conftest import _seed_url, sessions
from tests.integration.test_college import COLLEGE, _code, _college
from tests.integration.test_college_consent import (
    STUDENTS,
    _audit_count,
    _grant_individual,
    _linked_student,
    _revoke,
    _seed_student,
)

pytestmark = [pytest.mark.invariant, pytest.mark.integration]

ROOT = Path(__file__).resolve().parents[2]
OVERVIEW = f"{COLLEGE}/analytics/overview"

#: Tables that hold something about a student. A college-facing repository
#: naming one has found a way round the consent join.
STUDENT_TABLES = (
    "scores",
    "applications",
    "application_events",
    "candidate_profiles",
    "resume_versions",
    "resume_files",
    "users",
    "interview_sessions",
    "questionnaire_responses",
)


def _migration(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"invariant_9_{path.stem}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _registered_reads() -> dict[str, str]:
    """`COLLEGE_STUDENT_READS` from the baseline and from every later
    migration that adds a college read (0005 onwards), merged. A function a
    migration creates without listing it here fails the test below."""
    reads: dict[str, str] = {}
    for path in sorted((ROOT / "alembic" / "versions").glob("*.py")):
        if "COLLEGE_STUDENT_READS" in path.read_text(encoding="utf-8"):
            reads.update(getattr(_migration(path), "COLLEGE_STUDENT_READS", {}))
    return reads


def test_the_details_reads_serve_exactly_the_words_that_name_them() -> None:
    """2026-09-29: the widened view is served only under consent to words
    that name it. The SQL's list of versions and the domain's are one list."""
    from app.modules.college.domain import INDIVIDUAL_DETAILS_VERSIONS

    migration = _migration(ROOT / "alembic" / "versions" / "0005_portal_dashboards.py")
    assert set(migration.DETAILS_CONSENT_VERSIONS) == set(INDIVIDUAL_DETAILS_VERSIONS)


# ---------------------------------------------------------------------------
# 1. The join is in the query
# ---------------------------------------------------------------------------
async def test_every_college_read_of_a_student_joins_live_consent() -> None:
    reads: dict[str, str] = _registered_reads()
    assert reads, "the list of college reads is empty"
    async with sessions(_seed_url())() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT p.proname, p.prosecdef, pg_get_function_arguments(p.oid) AS args, "
                    "pg_get_functiondef(p.oid) AS body FROM pg_proc p "
                    "JOIN pg_namespace n ON n.oid = p.pronamespace "
                    "WHERE n.nspname = 'public' AND p.proname LIKE 'college\\_%'"
                )
            )
        ).all()
    found = {row.proname: row for row in rows}
    assert set(found) == set(reads), (
        "every public college_* function must be listed in COLLEGE_STUDENT_READS with the "
        f"consent it joins; the database has {sorted(found)}"
    )
    scope = {"roster_cohort": "ROSTER", "individually_visible": "INDIVIDUAL"}
    for name, cte in reads.items():
        body = " ".join(found[name].body.split())
        assert found[name].prosecdef, f"{name} must be SECURITY DEFINER, answering one question"
        assert "tenant" not in found[name].args, f"{name} must not take a tenant: it is bound"
        assert f"{cte} AS (" in body, f"{name} must define {cte}"
        assert f"FROM {cte}" in body or f"JOIN {cte}" in body, f"{name} must read from {cte}"
        assert "FROM student_consents" in body, f"{name} must join consent"
        assert f"scope = '{scope[cte]}'" in body and "revoked_at IS NULL" in body, (
            f"{name} must join live {scope[cte]} consent"
        )
        assert "bound_college_tenant()" in body, f"{name} must read the bound college"
        if cte == "individually_visible":
            assert "r.scope = 'ROSTER' AND r.revoked_at IS NULL" in body, (
                f"{name} must require the link beside individual visibility"
            )


@pytest.mark.parametrize(
    "path",
    ["app/modules/analytics/repository.py", "app/modules/college/repository.py"],
)
def test_college_facing_data_access_names_no_student_table(path: str) -> None:
    """The functions above are the only door. A query in these files that
    named a student table directly would skip the consent join entirely."""
    source = (ROOT / path).read_text(encoding="utf-8")
    sql = " ".join(re.findall(r'"([^"]*)"', source))
    for table in STUDENT_TABLES:
        assert not re.search(rf"\b(FROM|JOIN)\s+{table}\b", sql, re.IGNORECASE), (
            f"{path} reads {table} directly"
        )
    assert (
        "from app.modules.scoring" not in source and "from app.modules.applications" not in source
    )


# ---------------------------------------------------------------------------
# 2. Removing consent makes rows disappear
# ---------------------------------------------------------------------------
async def _as_college(tenant_id: str, sql: str) -> Any:
    from tests.integration.test_college import APP_URL

    async with sessions(APP_URL)() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant_id}
        )
        return (await session.execute(text(sql))).all()


async def test_revoking_consent_removes_a_student_from_analytics_at_once(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    for _ in range(9):
        await _seed_student(college, code["id"], score=720)
    student = await _linked_student(client, mint_token, college)
    async with sessions(_seed_url())() as session, session.begin():
        from tests.integration.test_college_consent import _insert_score

        await _insert_score(session, student["id"], 950)

    before = (await client.get(OVERVIEW, headers=college["headers"])).json()
    assert before["connected_students"] == 10 and before["below_floor"] is False
    assert before["score_distribution"]["STRONG"] is None, "one STRONG student is withheld"
    scores = await _as_college(
        college["tenant_id"], "SELECT stored_score FROM college_cohort_scores()"
    )
    assert sorted(r.stored_score for r in scores)[-1] == 950

    assert (await _revoke(client, student, college["tenant_id"], "ROSTER")).status_code == 200

    after = (await client.get(OVERVIEW, headers=college["headers"])).json()
    assert after["connected_students"] == 9 and after["below_floor"] is True
    scores = await _as_college(
        college["tenant_id"], "SELECT stored_score FROM college_cohort_scores()"
    )
    assert len(scores) == 9 and 950 not in {r.stored_score for r in scores}
    summary = await _as_college(
        college["tenant_id"], "SELECT connected FROM college_cohort_summary()"
    )
    assert summary[0].connected == 9


async def test_revoking_consent_removes_a_student_from_the_individual_view_at_once(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)
    assert (await _grant_individual(client, student, college["tenant_id"])).status_code == 201
    assert (
        await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    ).status_code == 200

    assert (await _revoke(client, student, college["tenant_id"], "INDIVIDUAL")).status_code == 200
    assert (
        await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    ).status_code == 404
    assert (await client.get(STUDENTS, headers=college["headers"])).json()["items"] == []
    visible = await _as_college(
        college["tenant_id"], "SELECT count(*) AS n FROM college_visible_students(100, NULL, NULL)"
    )
    assert visible[0].n == 0


async def test_the_reads_answer_nobody_but_a_bound_college(client: Any, mint_token: Any) -> None:
    """Bound to nothing, to a candidate, or to an employer: no rows at all."""
    college = await _college(client, mint_token)
    code = await _code(client, college)
    student = await _seed_student(college, code["id"], score=800, individual=True)
    from tests.integration.test_college import APP_URL
    from tests.integration.test_college_consent import _employer

    employer_tenant, _ = await _employer()
    for setting, value in (
        (None, None),
        ("app.user_id", str(student)),
        ("app.tenant_id", str(employer_tenant)),
    ):
        async with sessions(APP_URL)() as session, session.begin():
            if setting:
                await session.execute(
                    text("SELECT set_config(:k, :v, true)"), {"k": setting, "v": value}
                )
            for query in (
                "SELECT count(*) FROM college_cohort_summary()",
                "SELECT count(*) FROM college_cohort_scores()",
                "SELECT count(*) FROM college_visible_students(100, NULL, NULL)",
                f"SELECT count(*) FROM college_student_profile('{student}')",
            ):
                assert await session.scalar(text(query)) == 0, (setting, query)


# ---------------------------------------------------------------------------
# 3. Only the student confers either scope
# ---------------------------------------------------------------------------
async def test_roster_consent_never_implies_individual_visibility(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)
    assert (await client.get(STUDENTS, headers=college["headers"])).json()["items"] == []
    refused = await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    assert refused.status_code == 404
    overview = (await client.get(OVERVIEW, headers=college["headers"])).json()
    assert (overview["connected_students"], overview["individually_visible"]) == (1, 0)


# ---------------------------------------------------------------------------
# 4. Every reveal is audited, in the same transaction
# ---------------------------------------------------------------------------
async def test_every_open_and_every_list_is_audited(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    student = await _seed_student(college, code["id"], individual=True)
    for _ in range(3):
        assert (
            await client.get(f"{STUDENTS}/{student}", headers=college["headers"])
        ).status_code == 200
    for _ in range(2):
        assert (await client.get(STUDENTS, headers=college["headers"])).status_code == 200
    assert await _audit_count("college_student_viewed", college["tenant_id"], str(student)) == 3
    assert await _audit_count("college_students_listed", college["tenant_id"]) == 2

    # Aggregates reveal nobody and are not audited as reveals.
    await client.get(OVERVIEW, headers=college["headers"])
    assert await _audit_count("college_student_viewed", college["tenant_id"]) == 3


async def test_no_audit_row_means_no_reveal(client: Any, mint_token: Any, monkeypatch: Any) -> None:
    from app.core.db import get_session_factory
    from app.core.tenant import TenantContext
    from app.modules.college import service as college_service

    college = await _college(client, mint_token)
    code = await _code(client, college)
    student = await _seed_student(college, code["id"], individual=True, name="Not Shown")
    async with sessions(_seed_url())() as session:
        admin = await session.scalar(
            text("SELECT user_id FROM memberships WHERE tenant_id = :t"),
            {"t": college["tenant_id"]},
        )
    ctx = TenantContext(
        user_id=uuid.UUID(str(admin)),
        tenant_id=uuid.UUID(college["tenant_id"]),
        role="COLLEGE_ADMIN",
        pool="BUSINESS",
    )

    async def failing_audit(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr(college_service, "audit_event", failing_audit)
    for call in (
        lambda s: college_service.open_student(s, ctx=ctx, candidate_id=student),
        lambda s: college_service.list_visible_students(s, ctx=ctx, cursor=None, limit=None),
    ):
        with pytest.raises(RuntimeError, match="audit store unavailable"):
            async with get_session_factory()() as session, session.begin():
                await call(session)


# ---------------------------------------------------------------------------
# 5. The shapes
# ---------------------------------------------------------------------------
def test_the_individual_view_holds_exactly_what_the_student_agreed_to() -> None:
    """The INDIVIDUAL terms name these and nothing more. Widening this list
    is a change to what students agreed to, so the words and their version
    change with it."""
    assert set(CollegeStudentResponse.model_fields) == {
        "candidate_id",
        "full_name",
        "visible_since",
        "score",
        "band",
        "scored_at",
        "applications",
        "interviews",
        "hires",
    }


PERSONAL = re.compile(
    r"(^|_)(id|name|full_name|phone|email|contact|candidate|student|user|raw|breakdown)(_|$)"
)


def test_no_aggregate_schema_has_a_field_for_a_person() -> None:
    models = [
        obj
        for obj in vars(analytics_schemas).values()
        if isinstance(obj, type)
        and issubclass(obj, BaseModel)
        and obj.__module__ == analytics_schemas.__name__
    ]
    assert len(models) >= 5
    for model in models:
        for field in model.model_fields:
            assert not PERSONAL.search(field), f"{model.__name__}.{field} could name a person"
