"""The deletion policy is complete, and the cascade does what the policy says.

`privacy.domain.ERASURE_PLAN` is the policy in words; `erase_candidate` in the
baseline migration is the policy in SQL. Two documents describing one thing
drift, and here drift has a specific, expensive shape: a table added next month
that holds a person's data and that nobody classified, so it quietly survives
every erasure until a regulator asks.

So this file reads the **live database**, not the plan:

  * every table in the schema is classified, and every classified table exists;
  * a table claiming a link column has it;
  * the SQL deletes from exactly the tables the plan says ERASE, and never from
    a table the plan RETAINs -- the carve-out the client confirmed;
  * the policy version is still a placeholder until counsel sets retention
    periods (blockers B3), so turning it into the client's policy is a
    decision, not a tidy-up;
  * a data-subject request is never read unscoped.
"""

from __future__ import annotations

import inspect
import re

import pytest
from sqlalchemy import text

from app.modules.privacy import repository
from app.modules.privacy.domain import (
    ERASURE_PLAN,
    EXPORT_FORBIDDEN_FIELDS,
    RETENTION_POLICY_VERSION,
    Disposition,
    tables_with_disposition,
)
from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration


async def _rows(sql: str) -> list[tuple[object, ...]]:
    async with sessions(_seed_url())() as session:
        return [tuple(r) for r in (await session.execute(text(sql))).all()]


async def _live_tables() -> set[str]:
    rows = await _rows(
        """
        SELECT c.relname FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
           AND NOT c.relispartition AND c.relname <> 'alembic_version'
        """
    )
    return {str(r[0]) for r in rows}


async def _erasure_sql() -> str:
    ((body,),) = await _rows(
        "SELECT pg_get_functiondef('erase_candidate(uuid, text)'::regprocedure)"
    )
    return str(body)


async def test_every_table_in_the_schema_has_a_decided_disposition() -> None:
    live = await _live_tables()
    unclassified = sorted(live - set(ERASURE_PLAN))
    stale = sorted(set(ERASURE_PLAN) - live)
    assert not unclassified, (
        f"{unclassified} exist but are not in privacy.domain.ERASURE_PLAN. Decide what an "
        "erasure does to each -- ERASE, RETAIN under the carve-out, or NOT_PERSONAL -- and "
        "if ERASE, add it to erase_candidate in the baseline migration."
    )
    assert not stale, f"{stale} are classified but no longer exist"


async def test_every_link_column_the_plan_names_exists() -> None:
    columns = {
        (str(t), str(c))
        for t, c in await _rows(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public'"
        )
    }
    missing = [
        f"{table}.{plan.link}"
        for table, plan in ERASURE_PLAN.items()
        if plan.link is not None and (table, plan.link) not in columns
    ]
    assert not missing, f"the plan names columns that do not exist: {missing}"


async def test_a_table_keyed_on_a_person_is_never_called_not_personal() -> None:
    """`user_id` or `candidate_id` means the rows belong to somebody. Staff
    columns (`created_by`, `reviewed_by`) do not, and are not checked."""
    keyed = {
        str(t)
        for (t,) in await _rows(
            "SELECT DISTINCT table_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND column_name IN ('user_id', 'candidate_id')"
        )
    }
    wrong = sorted(
        t
        for t in keyed
        if t in ERASURE_PLAN and ERASURE_PLAN[t].disposition is Disposition.NOT_PERSONAL
    )
    assert not wrong, f"{wrong} are keyed on a person but classified NOT_PERSONAL"


async def test_the_cascade_deletes_exactly_what_the_plan_erases() -> None:
    body = await _erasure_sql()
    deleted = set(re.findall(r"DELETE FROM (\w+)", body))
    erase = set(tables_with_disposition(Disposition.ERASE))
    assert deleted == erase, (
        f"in the plan but not the SQL: {sorted(erase - deleted)}; "
        f"in the SQL but not the plan: {sorted(deleted - erase)}"
    )


async def test_the_carve_out_is_never_deleted() -> None:
    body = await _erasure_sql()
    for table in tables_with_disposition(Disposition.RETAIN):
        assert not re.search(rf"DELETE FROM {table}\b", body), (
            f"{table} is retained under the financial/audit carve-out the client "
            "confirmed, and must never be deleted by an erasure"
        )
        assert not re.search(rf"UPDATE {table}\b", body), f"{table} is retained whole"
    # The anchor is emptied, never dropped.
    assert "DELETE FROM users" not in body
    assert re.search(r"UPDATE users\s+SET phone = NULL, email = NULL,", body)
    assert "cognito_sub = encode(sha256(" in body, "the subject is hashed, never kept or nulled"


def test_the_erased_subject_hash_matches_the_migration() -> None:
    """Sign-in recognises an erased identity only if both sides hash alike."""
    import hashlib

    from app.core.auth.users import erased_subject

    assert erased_subject("abc") == hashlib.sha256(b"abc").hexdigest()


def test_only_users_is_anonymised() -> None:
    assert tables_with_disposition(Disposition.ANONYMISE) == ("users",)


def test_the_retention_policy_is_still_ours_until_counsel_says_otherwise() -> None:
    assert RETENTION_POLICY_VERSION.startswith("placeholder-"), (
        "Retention periods are counsel's (blockers B3). Dropping the placeholder prefix "
        "is a client decision; record it in docs/answers-log.md when it is taken."
    )


def test_every_disposition_says_why() -> None:
    thin = [t for t, plan in ERASURE_PLAN.items() if len(plan.why.strip()) < 10]
    assert not thin, f"{thin} have no reason recorded"


def test_a_request_is_only_ever_read_by_its_owner() -> None:
    """`dsr_requests` is not under RLS (see `_create_privacy_access`), so the
    scoping is in the predicate, and every reader must take the owner."""
    readers = ("get_request", "list_requests", "open_request_of_type", "claim")
    for name in readers:
        params = inspect.signature(getattr(repository, name)).parameters
        assert "user_id" in params, f"repository.{name} must be scoped by user_id"


def test_no_export_query_selects_a_forbidden_field() -> None:
    for section, sql in repository._EXPORT_QUERIES.items():
        selected = sql.split("FROM", 1)[0]
        for field in EXPORT_FORBIDDEN_FIELDS:
            assert not re.search(rf"\b{field}\b", selected), f"{section} selects {field}"
        assert "*" not in selected, f"{section} selects *; an export is a list, not a reflection"
