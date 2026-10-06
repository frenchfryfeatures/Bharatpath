"""admin - data access

Queues, drill-downs, disputes, suspensions.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**Two kinds of session, and the parameter name says which.**

* `session` -- the ordinary app role, under row-level security. Disputes are
  read and written here, by a transaction bound to the PLATFORM tenant (staff)
  or to the raiser (a candidate's `app.user_id`, an organisation's tenant).
* `reader` -- the read-only bypass role (`get_admin_session_factory`). Every
  cross-tenant read in the console runs here and nowhere else, and the service
  writes the audit row for it on `session` *before* opening the reader. It
  cannot write: the role holds SELECT only, and the service opens it READ ONLY
  as well.

The SQL names other modules' tables. That is the console's job -- one screen
across every module -- and it imports none of their repositories or models,
so the `module-privacy` and confirm-gate contracts still hold: nothing here
reads a resume version's content, only whether one exists.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.models import Dispute


# ---------------------------------------------------------------------------
# Disputes (app role, under RLS)
# ---------------------------------------------------------------------------
async def application_visible(session: AsyncSession, *, application_id: uuid.UUID) -> bool:
    """Whether the bound caller can see this application. Under their policy:
    a candidate sees their own, an employer its tenant's, anyone else none."""
    return bool(
        await session.scalar(
            text("SELECT EXISTS (SELECT 1 FROM applications WHERE id = :a)"),
            {"a": str(application_id)},
        )
    )


async def insert_dispute(session: AsyncSession, **values: Any) -> Dispute | None:
    """None only for a HIRE_DISPUTE already opened for that application."""
    row_id = await session.scalar(
        pg_insert(Dispute)
        .values(id=uuid.uuid4(), **values)
        .on_conflict_do_nothing(
            index_elements=["application_id"], index_where=text("source = 'HIRE_DISPUTE'")
        )
        .returning(Dispute.id)
    )
    if row_id is None:
        return None
    return await get_dispute(session, dispute_id=row_id)


async def get_dispute(
    session: AsyncSession, *, dispute_id: uuid.UUID, lock: bool = False
) -> Dispute | None:
    stmt = select(Dispute).where(Dispute.id == dispute_id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def visible_disputes(session: AsyncSession, *, limit: int) -> list[Dispute]:
    """The caller's own, newest first. The policy decides whose they are."""
    result = await session.execute(
        select(Dispute).order_by(Dispute.created_at.desc(), Dispute.id.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def dispute_queue(
    session: AsyncSession,
    *,
    states: tuple[str, ...],
    kind: str | None,
    party: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Dispute]:
    """Oldest first: a queue is worked from the front."""
    stmt = select(Dispute).where(Dispute.state.in_(states))
    if kind is not None:
        stmt = stmt.where(Dispute.kind == kind)
    if party is not None:
        stmt = stmt.where(Dispute.party == party)
    if after is not None:
        stmt = stmt.where(
            (Dispute.created_at > after[0])
            | ((Dispute.created_at == after[0]) & (Dispute.id > after[1]))
        )
    stmt = stmt.order_by(Dispute.created_at, Dispute.id).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def update_dispute(session: AsyncSession, *, dispute_id: uuid.UUID, **values: Any) -> Dispute:
    await session.execute(update(Dispute).where(Dispute.id == dispute_id).values(**values))
    row = await get_dispute(session, dispute_id=dispute_id)
    assert row is not None  # just updated on this transaction
    return row


# ---------------------------------------------------------------------------
# Cross-tenant reads (bypass role, read only)
# ---------------------------------------------------------------------------
async def _rows(reader: AsyncSession, sql: str, **params: Any) -> list[RowMapping]:
    result = await reader.execute(text(sql), {k: _param(v) for k, v in params.items()})
    return list(result.mappings().all())


async def _one(reader: AsyncSession, sql: str, **params: Any) -> RowMapping | None:
    rows = await _rows(reader, sql, **params)
    return rows[0] if rows else None


def _param(value: Any) -> Any:
    return str(value) if isinstance(value, uuid.UUID) else value


async def _counts(reader: AsyncSession, sql: str, **params: Any) -> dict[str, int]:
    return {str(r["key"]): int(r["n"]) for r in await _rows(reader, sql, **params)}


async def kyb_submissions(
    reader: AsyncSession,
    *,
    state: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[RowMapping]:
    """The submissions record, newest first. **No answers and no documents**:
    the list says who submitted and what happened, and a reviewer opens the
    organisation for the rest."""
    return await _rows(
        reader,
        """
        SELECT k.id, k.tenant_id, t.name AS organisation, k.state, k.form_version,
               k.submitted_at, k.reviewed_at, k.auto_approved, k.created_at
          FROM kyb_submissions k
          JOIN tenants t ON t.id = k.tenant_id
         WHERE (CAST(:state AS text) IS NULL OR k.state = CAST(:state AS text))
           AND (CAST(:after_at AS timestamptz) IS NULL
                OR (k.created_at, k.id) < (CAST(:after_at AS timestamptz), CAST(:after_id AS uuid)))
         ORDER BY k.created_at DESC, k.id DESC
         LIMIT :limit
        """,
        state=state,
        after_at=after[0] if after else None,
        after_id=after[1] if after else None,
        limit=limit,
    )


async def kyb_submission_tenant(
    reader: AsyncSession, *, submission_id: uuid.UUID
) -> uuid.UUID | None:
    row = await _one(reader, "SELECT tenant_id FROM kyb_submissions WHERE id = :s", s=submission_id)
    return row["tenant_id"] if row else None


#: Who a signal is about and who resolved it, beside the signal. The queue and
#: the detail read the same columns, so a row and its detail cannot disagree.
_SIGNAL_COLUMNS = """
        s.id, s.candidate_id, s.resume_version_id, s.rule_id, s.rule_version,
        s.thresholds_version, s.severity, s.state, s.created_at, s.resolved_at,
        s.resolved_by, s.resolution_note,
        u.status AS candidate_status, u.phone AS candidate_phone,
        u.email AS candidate_email, p.full_name AS candidate_full_name,
        r.email AS resolved_by_email,
        (SELECT count(*) FROM integrity_signals o
          WHERE o.candidate_id = s.candidate_id AND o.state = 'OPEN' AND o.id <> s.id)
          AS other_open_signals
"""
_SIGNAL_JOINS = """
          JOIN users u ON u.id = s.candidate_id
          LEFT JOIN candidate_profiles p ON p.user_id = s.candidate_id
          LEFT JOIN users r ON r.id = s.resolved_by
"""


async def integrity_signals(
    reader: AsyncSession,
    *,
    state: str,
    severity: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[RowMapping]:
    """Oldest first, whatever the severity: first in, first out is the order
    nobody has to justify. `severity` filters for a reviewer who wants the
    HIGH signals -- the ones already hiding someone from employers -- first.

    Never the evidence: it can quote the CV, and only opening one signal
    (audited by its id) shows it."""
    return await _rows(
        reader,
        f"""
        SELECT {_SIGNAL_COLUMNS}
          FROM integrity_signals s
          {_SIGNAL_JOINS}
         WHERE s.state = CAST(:state AS text)
           AND (CAST(:severity AS text) IS NULL OR s.severity = CAST(:severity AS text))
           AND (CAST(:after_at AS timestamptz) IS NULL
                OR (s.created_at, s.id) > (CAST(:after_at AS timestamptz), CAST(:after_id AS uuid)))
         ORDER BY s.created_at, s.id
         LIMIT :limit
        """,  # noqa: S608 - module constants, not values
        state=state,
        severity=severity,
        after_at=after[0] if after else None,
        after_id=after[1] if after else None,
        limit=limit,
    )


async def integrity_signal(reader: AsyncSession, *, signal_id: uuid.UUID) -> RowMapping | None:
    return await _one(
        reader,
        f"""
        SELECT {_SIGNAL_COLUMNS}, s.evidence
          FROM integrity_signals s
          {_SIGNAL_JOINS}
         WHERE s.id = :s
        """,  # noqa: S608 - module constants, not values
        s=signal_id,
    )


async def signal_context(
    reader: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    signal_id: uuid.UUID,
    resume_version_id: uuid.UUID | None,
) -> dict[str, Any]:
    """What a reviewer weighs a signal against: the version it was raised on
    (dates only -- the text is the CV endpoint's), the candidate's current
    score, and every other signal they carry."""
    version = None
    if resume_version_id is not None:
        version = await _one(
            reader,
            """
            SELECT v.id, v.source, v.created_at, v.confirmed_at,
                   NOT EXISTS (SELECT 1 FROM resume_versions n
                                WHERE n.user_id = v.user_id AND n.created_at > v.created_at)
                     AS is_latest
              FROM resume_versions v WHERE v.id = :v
            """,
            v=resume_version_id,
        )
    score = await _one(
        reader,
        """
        SELECT raw_value AS stored_value, computed_at FROM scores WHERE user_id = :u
         ORDER BY computed_at DESC, id DESC LIMIT 1
        """,
        u=candidate_id,
    )
    others = await _rows(
        reader,
        """
        SELECT id, rule_id, severity, state, created_at FROM integrity_signals
         WHERE candidate_id = :u AND id <> :s
         ORDER BY created_at DESC, id DESC
        """,
        u=candidate_id,
        s=signal_id,
    )
    return {"resume_version": version, "score": score, "others": others}


async def candidates(
    reader: AsyncSession,
    *,
    status: str | None,
    name_contains: str | None,
    email: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[RowMapping]:
    """Candidate accounts, newest first, keyset by `(created_at, id)` and
    served by `ix_users_pool_created`. Business accounts are never listed:
    `pool` is the filter, not a role, because a candidate holds no membership.
    `email` is an exact match on the normalised address -- a lookup for
    someone who wrote to support, not a way to enumerate a domain."""
    name = None
    if name_contains:
        name = name_contains.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return await _rows(
        reader,
        """
        SELECT u.id, u.status, u.phone, u.email, u.created_at,
               p.full_name, p.city, p.state_code
          FROM users u
          LEFT JOIN candidate_profiles p ON p.user_id = u.id
         WHERE u.pool = 'CANDIDATE'
           AND (CAST(:status AS text) IS NULL OR u.status = CAST(:status AS text))
           AND (CAST(:email AS text) IS NULL OR u.email = CAST(:email AS text))
           AND (CAST(:name AS text) IS NULL
                OR p.full_name ILIKE '%' || CAST(:name AS text) || '%' ESCAPE '\\')
           AND (CAST(:after_at AS timestamptz) IS NULL
                OR (u.created_at, u.id) < (CAST(:after_at AS timestamptz), CAST(:after_id AS uuid)))
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT :limit
        """,
        status=status,
        email=email,
        name=name,
        after_at=after[0] if after else None,
        after_id=after[1] if after else None,
        limit=limit,
    )


async def candidate_account(reader: AsyncSession, *, user_id: uuid.UUID) -> RowMapping | None:
    return await _one(
        reader,
        """
        SELECT u.id, u.status, u.locale, u.phone, u.email, u.created_at,
               p.full_name, p.city, p.state_code
          FROM users u
          LEFT JOIN candidate_profiles p ON p.user_id = u.id
         WHERE u.id = :u AND u.pool = 'CANDIDATE'
        """,
        u=user_id,
    )


async def candidate_facts(reader: AsyncSession, *, user_id: uuid.UUID) -> dict[str, Any]:
    """Everything the candidate drill-down counts, in one read-only pass."""
    latest = await _one(
        reader,
        """
        SELECT raw_value AS stored_value, computed_at,
               count(*) OVER () AS history
          FROM scores WHERE user_id = :u
         ORDER BY computed_at DESC, id DESC LIMIT 1
        """,
        u=user_id,
    )
    resume = await _one(
        reader,
        """
        SELECT (SELECT count(*) FROM resume_files WHERE user_id = :u) AS files,
               count(*) AS versions,
               max(confirmed_at) AS last_confirmed_at
          FROM resume_versions WHERE user_id = :u
        """,
        u=user_id,
    )
    subscription = await _one(
        reader,
        """
        SELECT s.state, s.current_period_end, p.code AS plan_code
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.subscriber_type = 'USER' AND s.subscriber_id = :u
         ORDER BY s.current_period_end DESC NULLS LAST, s.created_at DESC LIMIT 1
        """,
        u=user_id,
    )
    return {
        "latest_score": latest,
        "resume": resume,
        "subscription": subscription,
        "signals": await _rows(
            reader,
            """
            SELECT severity, state, count(*) AS n FROM integrity_signals
             WHERE candidate_id = :u GROUP BY severity, state ORDER BY severity, state
            """,
            u=user_id,
        ),
        "applications": await _counts(
            reader,
            "SELECT stage AS key, count(*) AS n FROM applications "
            "WHERE candidate_id = :u GROUP BY stage",
            u=user_id,
        ),
        "hire_disputes": int(
            await reader.scalar(
                text(
                    "SELECT count(*) FROM applications "
                    "WHERE candidate_id = :u AND hire_disputed_at IS NOT NULL"
                ),
                {"u": str(user_id)},
            )
            or 0
        ),
        "colleges": await _rows(
            reader,
            """
            SELECT sc.tenant_id, c.name AS college, sc.scope, sc.granted_at
              FROM student_consents sc
              JOIN colleges c ON c.tenant_id = sc.tenant_id
             WHERE sc.candidate_id = :u AND sc.revoked_at IS NULL
             ORDER BY sc.granted_at, sc.scope
            """,
            u=user_id,
        ),
        "seat_held": bool(
            await reader.scalar(
                text(
                    "SELECT EXISTS (SELECT 1 FROM college_seat_assignments "
                    "WHERE candidate_id = :u AND released_at IS NULL)"
                ),
                {"u": str(user_id)},
            )
        ),
        "disputes": await _counts(
            reader,
            "SELECT state AS key, count(*) AS n FROM disputes WHERE raised_by = :u GROUP BY state",
            u=user_id,
        ),
    }


async def organisation(
    reader: AsyncSession, *, tenant_id: uuid.UUID, tenant_type: str
) -> RowMapping | None:
    if tenant_type == "EMPLOYER":
        sql = """
            SELECT t.id, t.name, t.status, t.created_at, e.legal_name, e.employer_type,
                   e.industry, e.kyb_status, e.verified_at
              FROM tenants t LEFT JOIN employers e ON e.tenant_id = t.id
             WHERE t.id = :t AND t.type = 'EMPLOYER'
        """
    else:
        sql = """
            SELECT t.id, t.name, t.status, t.created_at, c.name AS college_name,
                   c.institution_type, c.onboarding_submitted_at, c.verified_at
              FROM tenants t LEFT JOIN colleges c ON c.tenant_id = t.id
             WHERE t.id = :t AND t.type = 'COLLEGE'
        """
    return await _one(reader, sql, t=tenant_id)


async def organisation_facts(reader: AsyncSession, *, tenant_id: uuid.UUID) -> dict[str, Any]:
    """What an employer and a college drill-down share."""
    return {
        "members": await _counts(
            reader,
            "SELECT role AS key, count(*) AS n FROM memberships "
            "WHERE tenant_id = :t AND status = 'ACTIVE' GROUP BY role",
            t=tenant_id,
        ),
        "subscription": await _one(
            reader,
            """
            SELECT s.state, s.current_period_end, p.code AS plan_code, p.seat_allowance
              FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.subscriber_type = 'TENANT' AND s.subscriber_id = :t
             ORDER BY s.current_period_end DESC NULLS LAST, s.created_at DESC LIMIT 1
            """,
            t=tenant_id,
        ),
        "suspension": await _one(
            reader,
            """
            SELECT id, suspended_at, suspended_by FROM tenant_suspensions
             WHERE tenant_id = :t AND lifted_at IS NULL
            """,
            t=tenant_id,
        ),
        "disputes": await _counts(
            reader,
            "SELECT state AS key, count(*) AS n FROM disputes WHERE tenant_id = :t GROUP BY state",
            t=tenant_id,
        ),
    }


async def employer_facts(
    reader: AsyncSession, *, tenant_id: uuid.UUID, now: datetime
) -> dict[str, Any]:
    return {
        "jobs": await _counts(
            reader,
            "SELECT status AS key, count(*) AS n FROM jobs WHERE tenant_id = :t GROUP BY status",
            t=tenant_id,
        ),
        "applications": await _counts(
            reader,
            "SELECT stage AS key, count(*) AS n FROM applications "
            "WHERE tenant_id = :t GROUP BY stage",
            t=tenant_id,
        ),
        "latest_kyb": await _one(
            reader,
            """
            SELECT id, state, submitted_at, reviewed_at, auto_approved FROM kyb_submissions
             WHERE tenant_id = :t ORDER BY created_at DESC, id DESC LIMIT 1
            """,
            t=tenant_id,
        ),
        # Distinct people, not opens: a re-open costs nothing under the caps
        # either (Day 14), and "how many candidates has this employer seen?"
        # is the question a bulk-extraction review asks.
        "views": await _one(
            reader,
            """
            SELECT count(DISTINCT candidate_id)
                     FILTER (WHERE viewed_at > CAST(:now AS timestamptz) - interval '1 day')
                     AS last_day,
                   count(DISTINCT candidate_id) AS last_30_days
              FROM candidate_view_events
             WHERE tenant_id = :t
               AND viewed_at > CAST(:now AS timestamptz) - interval '30 days'
            """,
            t=tenant_id,
            now=now,
        ),
        "anomaly_flags_30_days": int(
            await reader.scalar(
                text(
                    "SELECT count(*) FROM audit_events "
                    "WHERE tenant_id = :t AND action = 'candidate_view_anomaly_flagged' "
                    "AND occurred_at > CAST(:now AS timestamptz) - interval '30 days'"
                ),
                {"t": str(tenant_id), "now": now},
            )
            or 0
        ),
    }


async def college_facts(
    reader: AsyncSession, *, tenant_id: uuid.UUID, now: datetime
) -> dict[str, Any]:
    return {
        "seats": await _one(
            reader,
            "SELECT seats_allocated, seats_used FROM college_seats WHERE tenant_id = :t",
            t=tenant_id,
        ),
        "live_codes": int(
            await reader.scalar(
                text(
                    "SELECT count(*) FROM referral_codes WHERE tenant_id = :t "
                    "AND revoked_at IS NULL AND expires_at > CAST(:now AS timestamptz)"
                ),
                {"t": str(tenant_id), "now": now},
            )
            or 0
        ),
        "consents": await _counts(
            reader,
            "SELECT scope AS key, count(*) AS n FROM student_consents "
            "WHERE tenant_id = :t AND revoked_at IS NULL GROUP BY scope",
            t=tenant_id,
        ),
        "roster_imports": await _counts(
            reader,
            "SELECT state AS key, count(*) AS n FROM roster_imports "
            "WHERE tenant_id = :t GROUP BY state",
            t=tenant_id,
        ),
        "invitations": await _counts(
            reader,
            "SELECT invite_state AS key, count(*) AS n FROM roster_entries "
            "WHERE tenant_id = :t AND invite_state IS NOT NULL GROUP BY invite_state",
            t=tenant_id,
        ),
    }


async def dispute_links(
    reader: AsyncSession, *, application_id: uuid.UUID | None, candidate_id: uuid.UUID | None
) -> dict[str, Any]:
    """What a dispute is cross-linked to: the application's two sides, and the
    candidate's integrity record, so the reviewer sees a flagged CV before
    deciding whose word to take."""
    application = (
        await _one(
            reader,
            """
            SELECT a.id, a.candidate_id, a.tenant_id, a.job_id, a.stage,
                   a.employer_confirmed_at, a.candidate_confirmed_at, a.hire_disputed_at
              FROM applications a WHERE a.id = :a
            """,
            a=application_id,
        )
        if application_id is not None
        else None
    )
    person = application["candidate_id"] if application else candidate_id
    open_signals = (
        await _counts(
            reader,
            "SELECT severity AS key, count(*) AS n FROM integrity_signals "
            "WHERE candidate_id = :u AND state IN ('OPEN', 'CONFIRMED') GROUP BY severity",
            u=person,
        )
        if person is not None
        else {}
    )
    return {"application": application, "candidate_id": person, "signals": open_signals}


async def audit_events(
    reader: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    action: str | None,
    target_type: str | None,
    target_id: str | None,
    tenant_id: uuid.UUID | None,
    occurred_from: datetime | None,
    occurred_to: datetime | None,
    after: tuple[datetime, int] | None,
    limit: int,
) -> list[RowMapping]:
    """Newest first, keyset on (occurred_at, id). Each filter lands on one of
    the three `ix_audit_*_time` indexes or on `target_id`'s own."""
    return await _rows(
        reader,
        """
        SELECT id, actor_id, actor_role, action, target_type, target_id, tenant_id,
               request_id, metadata, occurred_at
          FROM audit_events
         WHERE (CAST(:actor_id AS uuid) IS NULL OR actor_id = CAST(:actor_id AS uuid))
           AND (CAST(:action AS text) IS NULL OR action = CAST(:action AS text))
           AND (CAST(:target_type AS text) IS NULL OR target_type = CAST(:target_type AS text))
           AND (CAST(:target_id AS text) IS NULL OR target_id = CAST(:target_id AS text))
           AND (CAST(:tenant_id AS uuid) IS NULL OR tenant_id = CAST(:tenant_id AS uuid))
           AND (CAST(:occurred_from AS timestamptz) IS NULL
                OR occurred_at >= CAST(:occurred_from AS timestamptz))
           AND (CAST(:occurred_to AS timestamptz) IS NULL
                OR occurred_at < CAST(:occurred_to AS timestamptz))
           AND (CAST(:after_at AS timestamptz) IS NULL
                OR (occurred_at, id) < (CAST(:after_at AS timestamptz), CAST(:after_id AS bigint)))
         ORDER BY occurred_at DESC, id DESC
         LIMIT :limit
        """,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        tenant_id=tenant_id,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
        after_at=after[0] if after else None,
        after_id=after[1] if after else None,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# The dashboard (bypass reader)
# ---------------------------------------------------------------------------
# Counts across every organisation, and the few oldest items in each queue.
# "Waiting on us" means: a KYB submission SUBMITTED or UNDER_REVIEW, an
# integrity signal OPEN, a dispute OPEN or IN_REVIEW. MORE_INFO_REQUIRED is
# waiting on the employer and is counted apart.
async def _aggregate(reader: AsyncSession, sql: str, **params: Any) -> RowMapping:
    """The one row an aggregate without GROUP BY always returns."""
    return (await _rows(reader, sql, **params))[0]


async def platform_totals(reader: AsyncSession) -> RowMapping:
    row = await _aggregate(
        reader,
        """
        SELECT
          (SELECT count(*) FROM users WHERE pool = 'CANDIDATE' AND status = 'ACTIVE')
            AS candidates,
          (SELECT count(*) FROM tenants WHERE type = 'EMPLOYER' AND status = 'ACTIVE')
            AS employers,
          (SELECT count(*) FROM tenants WHERE type = 'COLLEGE' AND status = 'ACTIVE')
            AS colleges,
          (SELECT count(*) FROM jobs WHERE status = 'PUBLISHED') AS jobs_published,
          (SELECT count(*) FROM applications) AS applications,
          (SELECT count(*) FROM applications WHERE stage = 'HIRED') AS hires
        """,
    )
    return row


async def kyb_backlog(reader: AsyncSession) -> RowMapping:
    row = await _aggregate(
        reader,
        """
        SELECT
          count(*) FILTER (WHERE state IN ('SUBMITTED', 'UNDER_REVIEW')) AS awaiting_review,
          count(*) FILTER (WHERE state = 'MORE_INFO_REQUIRED') AS awaiting_employer,
          min(coalesce(submitted_at, created_at))
            FILTER (WHERE state IN ('SUBMITTED', 'UNDER_REVIEW')) AS oldest_waiting_since
          FROM kyb_submissions
         WHERE state IN ('SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED')
        """,
    )
    return row


async def integrity_backlog(reader: AsyncSession) -> RowMapping:
    """`candidates_held_back` is people with an OPEN HIGH signal: already out of
    employer search, and waiting on nobody but a reviewer."""
    row = await _aggregate(
        reader,
        """
        SELECT
          count(*) AS open,
          count(*) FILTER (WHERE severity = 'HIGH') AS high,
          count(*) FILTER (WHERE severity = 'MEDIUM') AS medium,
          count(*) FILTER (WHERE severity = 'LOW') AS low,
          count(DISTINCT candidate_id) FILTER (WHERE severity = 'HIGH') AS candidates_held_back,
          min(created_at) AS oldest_waiting_since
          FROM integrity_signals
         WHERE state = 'OPEN'
        """,
    )
    return row


async def dispute_backlog(reader: AsyncSession) -> tuple[RowMapping, dict[str, int]]:
    row = await _aggregate(
        reader,
        """
        SELECT
          count(*) FILTER (WHERE state = 'OPEN') AS open,
          count(*) FILTER (WHERE state = 'IN_REVIEW') AS in_review,
          count(*) FILTER (WHERE assigned_to IS NULL) AS unassigned,
          min(created_at) AS oldest_waiting_since
          FROM disputes
         WHERE state IN ('OPEN', 'IN_REVIEW')
        """,
    )
    by_kind = await _counts(
        reader,
        """
        SELECT kind AS key, count(*) AS n FROM disputes
         WHERE state IN ('OPEN', 'IN_REVIEW') GROUP BY kind
        """,
    )
    return row, by_kind


async def organisation_counts(reader: AsyncSession) -> list[RowMapping]:
    return await _rows(
        reader,
        """
        SELECT type, status, count(*) AS n FROM tenants
         WHERE type IN ('EMPLOYER', 'COLLEGE') GROUP BY type, status
        """,
    )


async def oldest_kyb(reader: AsyncSession, *, limit: int) -> list[RowMapping]:
    return await _rows(
        reader,
        """
        SELECT k.id, k.tenant_id, t.name AS organisation, k.state,
               coalesce(k.submitted_at, k.created_at) AS waiting_since
          FROM kyb_submissions k
          JOIN tenants t ON t.id = k.tenant_id
         WHERE k.state IN ('SUBMITTED', 'UNDER_REVIEW')
         ORDER BY waiting_since, k.id
         LIMIT :limit
        """,
        limit=limit,
    )


async def oldest_signals(reader: AsyncSession, *, limit: int) -> list[RowMapping]:
    """Identifiers and the rule, as the queue shows them. Never the evidence."""
    return await _rows(
        reader,
        """
        SELECT id, candidate_id, rule_id, severity, created_at AS waiting_since
          FROM integrity_signals
         WHERE state = 'OPEN'
         ORDER BY created_at, id
         LIMIT :limit
        """,
        limit=limit,
    )


async def oldest_disputes(reader: AsyncSession, *, limit: int) -> list[RowMapping]:
    """Kind and party, never the description: it is read by opening the dispute."""
    return await _rows(
        reader,
        """
        SELECT d.id, d.kind, d.party, d.tenant_id, t.name AS organisation,
               d.created_at AS waiting_since
          FROM disputes d
          LEFT JOIN tenants t ON t.id = d.tenant_id
         WHERE d.state IN ('OPEN', 'IN_REVIEW')
         ORDER BY d.created_at, d.id
         LIMIT :limit
        """,
        limit=limit,
    )


async def throughput(
    reader: AsyncSession,
    *,
    since: datetime,
    zone: str,
    kyb: bool,
    integrity: bool,
    disputes: bool,
) -> list[RowMapping]:
    """Items that entered, and items that left, the queues named, per day in `zone`.

    An auto-approved KYB submission never waited on anyone (R15), so it is
    neither intake nor cleared. A KYB review that asks for more information
    clears the item from our queue; resubmitting brings it back.
    """
    return await _rows(
        reader,
        """
        WITH moves AS (
          SELECT coalesce(submitted_at, created_at) AS at, 1 AS intake, 0 AS cleared
            FROM kyb_submissions
           WHERE CAST(:kyb AS boolean) AND NOT auto_approved
             AND coalesce(submitted_at, created_at) >= :since
          UNION ALL
          SELECT reviewed_at, 0, 1 FROM kyb_submissions
           WHERE CAST(:kyb AS boolean) AND NOT auto_approved AND reviewed_at >= :since
          UNION ALL
          SELECT created_at, 1, 0 FROM integrity_signals
           WHERE CAST(:integrity AS boolean) AND created_at >= :since
          UNION ALL
          SELECT resolved_at, 0, 1 FROM integrity_signals
           WHERE CAST(:integrity AS boolean) AND resolved_at >= :since
          UNION ALL
          SELECT created_at, 1, 0 FROM disputes
           WHERE CAST(:disputes AS boolean) AND created_at >= :since
          UNION ALL
          SELECT resolved_at, 0, 1 FROM disputes
           WHERE CAST(:disputes AS boolean) AND resolved_at >= :since
        )
        SELECT CAST(timezone(:zone, at) AS date) AS day,
               sum(intake) AS intake, sum(cleared) AS cleared
          FROM moves
         GROUP BY 1
        """,
        since=since,
        zone=zone,
        kyb=kyb,
        integrity=integrity,
        disputes=disputes,
    )


# ---------------------------------------------------------------------------
# The full candidate page (2026-09-29). Read on the bypass session, after the
# service has written the audit row naming the candidate.
# ---------------------------------------------------------------------------
async def candidate_onboarding(reader: AsyncSession, *, user_id: uuid.UUID) -> RowMapping | None:
    """What the candidate told us at sign-up and on their profile."""
    return await _one(
        reader,
        """
        SELECT u.id, u.status, u.locale, u.email, u.phone, u.created_at,
               p.full_name, p.city, p.state_code,
               q.answers AS questionnaire_answers, q.submitted_at AS questionnaire_submitted_at
          FROM users u
          LEFT JOIN candidate_profiles p ON p.user_id = u.id
          LEFT JOIN questionnaire_responses q ON q.user_id = u.id
         WHERE u.id = :u AND u.pool = 'CANDIDATE'
        """,
        u=user_id,
    )


async def candidate_resume(
    reader: AsyncSession, *, user_id: uuid.UUID
) -> dict[str, RowMapping | None]:
    """The newest resume version, and the newest confirmed one when that is
    older: what the candidate is working on, and what their score was built
    from."""
    return {
        "latest": await _one(
            reader,
            """
            SELECT v.id, v.source, v.parsed, v.confirmed_at, v.created_at,
                   f.s3_key, f.mime, f.size_bytes, f.uploaded_at
              FROM resume_versions v
              LEFT JOIN resume_files f ON f.id = v.resume_file_id
             WHERE v.user_id = :u
             ORDER BY v.created_at DESC, v.id DESC LIMIT 1
            """,
            u=user_id,
        ),
        "confirmed": await _one(
            reader,
            """
            SELECT v.id, v.source, v.parsed, v.confirmed_at, v.created_at,
                   f.s3_key, f.mime, f.size_bytes, f.uploaded_at
              FROM resume_versions v
              LEFT JOIN resume_files f ON f.id = v.resume_file_id
             WHERE v.user_id = :u AND v.confirmed_at IS NOT NULL
             ORDER BY v.confirmed_at DESC, v.id DESC LIMIT 1
            """,
            u=user_id,
        ),
    }


async def score_history(reader: AsyncSession, *, user_id: uuid.UUID) -> list[RowMapping]:
    """Every score row, oldest first. The service turns each into the display
    value; the stored number never leaves it."""
    return await _rows(
        reader,
        """
        SELECT id, raw_value, addon_value, resume_version_id, algorithm_version, computed_at
          FROM scores WHERE user_id = :u
         ORDER BY computed_at, id
        """,
        u=user_id,
    )


async def candidate_applications(
    reader: AsyncSession, *, user_id: uuid.UUID
) -> tuple[list[RowMapping], dict[str, int]]:
    """Every application, newest first, with the job and employer, and how
    many ever reached each stage."""
    rows = await _rows(
        reader,
        """
        SELECT a.id, a.stage, a.created_at AS applied_at, a.updated_at,
               a.interview_at, j.id AS job_id, j.title AS job_title,
               j.location AS job_location, a.tenant_id AS employer_tenant_id,
               e.legal_name AS employer_name
          FROM applications a
          JOIN jobs j ON j.id = a.job_id
          LEFT JOIN employers e ON e.tenant_id = a.tenant_id
         WHERE a.candidate_id = :u
         ORDER BY a.created_at DESC, a.id DESC
        """,
        u=user_id,
    )
    reached = await _counts(
        reader,
        """
        SELECT e.to_stage AS key, count(DISTINCT e.application_id) AS n
          FROM application_events e
          JOIN applications a ON a.id = e.application_id
         WHERE a.candidate_id = :u AND e.to_stage IS NOT NULL
         GROUP BY e.to_stage
        """,
        u=user_id,
    )
    return rows, reached
