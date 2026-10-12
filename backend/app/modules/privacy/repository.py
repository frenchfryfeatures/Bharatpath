"""privacy - data access

Export and deletion requests, DSR tracking.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**The erasure itself is not in this file, and not in any file.** It is
`erase_candidate(uuid)`, a SECURITY DEFINER function in the baseline
migration, and this module calls it. Three reasons, in order of how much they
matter:

  * The application role deliberately holds no DELETE on `scores`,
    `course_completions`, `device_checks` or `application_events` -- that is
    invariant 3 and the append-only event logs, proved by
    `test_scores_are_insert_only` rather than assumed. Granting DELETE so the
    erasure could run as the app role would trade a legal requirement for a
    different legal requirement.
  * An erasure that reaches thirty tables must be one transaction. Half an
    erasure is not a smaller erasure, it is a corrupt account.
  * A cascade assembled in Python from a table of column names is a cascade
    nobody can read before running it. Written out longhand in SQL, it can be
    reviewed by somebody who does not know this codebase -- which is exactly
    who will review it.

The export reads through ordinary queries here, because an export reads and
the app role may read.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.privacy.models import DsrRequest


async def create_request(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    type_: str,
    due_at: datetime,
) -> DsrRequest:
    row = DsrRequest(user_id=user_id, type=type_, state="RECEIVED", due_at=due_at)
    session.add(row)
    await session.flush()
    return row


async def get_request(
    session: AsyncSession, *, request_id: uuid.UUID, user_id: uuid.UUID
) -> DsrRequest | None:
    """One request, scoped to its owner.

    Scoped in the predicate rather than checked afterwards, so a request
    belonging to someone else is never loaded -- the same shape as the confirm
    gate, and for the same reason.
    """
    return (
        await session.execute(
            select(DsrRequest).where(DsrRequest.id == request_id, DsrRequest.user_id == user_id)
        )
    ).scalar_one_or_none()


async def list_requests(session: AsyncSession, *, user_id: uuid.UUID) -> list[DsrRequest]:
    return list(
        (
            await session.execute(
                select(DsrRequest)
                .where(DsrRequest.user_id == user_id)
                .order_by(DsrRequest.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def open_request_of_type(
    session: AsyncSession, *, user_id: uuid.UUID, type_: str
) -> DsrRequest | None:
    """An unfinished request of this kind, if there is one.

    One open request per kind per person. This is the friendly answer; the
    partial unique index `uq_dsr_one_open_per_type` is the real one, for the
    two requests that race past this read together.
    """
    return (
        (
            await session.execute(
                select(DsrRequest).where(
                    DsrRequest.user_id == user_id,
                    DsrRequest.type == type_,
                    DsrRequest.state.in_(("RECEIVED", "PROCESSING")),
                )
            )
        )
        .scalars()
        .first()
    )


async def set_state(
    session: AsyncSession,
    *,
    request_id: uuid.UUID,
    state: str,
    completed_at: datetime | None = None,
    export_s3_key: str | None = None,
    note: str | None = None,
    policy_version: str | None = None,
    manifest: dict[str, int] | None = None,
) -> None:
    """Move a request. The guard trigger refuses an illegal transition.

    `note` and `export_s3_key` are only ever set, never cleared to None by
    omission -- passing None leaves the stored value alone, because a state
    change that silently dropped the key to a finished export would make the
    archive unreachable and un-deletable.
    """
    values: dict[str, Any] = {"state": state}
    if completed_at is not None:
        values["completed_at"] = completed_at
    if export_s3_key is not None:
        values["export_s3_key"] = export_s3_key
    if note is not None:
        values["note"] = note
    if policy_version is not None:
        values["policy_version"] = policy_version
    if manifest is not None:
        values["manifest"] = manifest
    await session.execute(update(DsrRequest).where(DsrRequest.id == request_id).values(**values))


async def claim(
    session: AsyncSession,
    *,
    request_id: uuid.UUID,
    user_id: uuid.UUID,
    type_: str,
    from_state: str,
    to_state: str,
    completed_at: datetime | None = None,
    note: str | None = None,
) -> bool:
    """Move a request only if it is still where the caller last saw it.

    A conditional UPDATE, not a read followed by a write: two sweeps, or a
    sweep and a withdrawal, reading RECEIVED at the same moment would both
    proceed on a read. Here exactly one UPDATE matches, and the other learns
    it lost by getting no row back.
    """
    result = await session.execute(
        update(DsrRequest)
        .where(
            DsrRequest.id == request_id,
            DsrRequest.user_id == user_id,
            DsrRequest.type == type_,
            DsrRequest.state == from_state,
        )
        .values(
            state=to_state,
            completed_at=completed_at if completed_at is not None else DsrRequest.completed_at,
            note=note if note is not None else DsrRequest.note,
        )
        .returning(DsrRequest.id)
    )
    return result.scalar_one_or_none() is not None


async def clear_export_key(session: AsyncSession, *, request_id: uuid.UUID) -> None:
    """Forget where an expired archive was. Called after the object is gone."""
    await session.execute(
        update(DsrRequest).where(DsrRequest.id == request_id).values(export_s3_key=None)
    )


async def clear_export_keys_for_user(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """The same, for every archive this person ever had. Called by the erasure
    once the objects are gone, so the retained request rows keep saying that an
    export happened without saying where a copy of it used to be."""
    await session.execute(
        update(DsrRequest).where(DsrRequest.user_id == user_id).values(export_s3_key=None)
    )


async def due_deletions(
    session: AsyncSession, *, now: datetime, limit: int
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """`(request_id, user_id)` for deletions past their grace period.

    Ordered oldest first so a backlog drains in the order people asked, and
    limited so one sweep cannot hold a transaction open across every request
    ever made.
    """
    rows = await session.execute(
        text(
            """
            SELECT id, user_id
              FROM dsr_requests
             WHERE type = 'DELETE'
               AND state = 'RECEIVED'
               AND created_at <= :cutoff
             ORDER BY created_at
             LIMIT :limit
            """
        ),
        {"cutoff": now, "limit": limit},
    )
    return [(r[0], r[1]) for r in rows.all()]


async def expired_exports(
    session: AsyncSession, *, now: datetime, limit: int
) -> list[tuple[uuid.UUID, str]]:
    """`(request_id, s3_key)` for archives that have outlived their retention."""
    rows = await session.execute(
        text(
            """
            SELECT id, export_s3_key
              FROM dsr_requests
             WHERE type = 'EXPORT'
               AND export_s3_key IS NOT NULL
               AND completed_at IS NOT NULL
               AND completed_at <= :cutoff
             ORDER BY completed_at
             LIMIT :limit
            """
        ),
        {"cutoff": now, "limit": limit},
    )
    return [(r[0], r[1]) for r in rows.all()]


# ---------------------------------------------------------------------------
# Erasure
# ---------------------------------------------------------------------------


async def sign_in_to_destroy(
    session: AsyncSession, *, user_id: uuid.UUID
) -> tuple[str, str] | None:
    """`(pool, cognito_sub)` for the account being erased, or None.

    **Read before the cascade, for the same reason as the S3 keys.**
    `erase_candidate` replaces `cognito_sub` with its SHA-256, so afterwards
    there is no identifier left to delete the Cognito user by -- only a hash
    that addresses nothing. Collecting it after the fact collects nothing.

    None when the row carries no subject at all: an account created by staff
    that nobody ever signed in to has a `users` row and no Cognito user, and
    there is nothing to destroy.
    """
    row = (
        await session.execute(
            text("SELECT pool, cognito_sub FROM users WHERE id = :user_id"),
            {"user_id": str(user_id)},
        )
    ).first()
    if row is None or not row.cognito_sub:
        return None
    return (str(row.pool), str(row.cognito_sub))


async def erasable_object_keys(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[tuple[str, str]]:
    """`(bucket_kind, key)` for every S3 object this person owns.

    **Read before the rows are deleted, not after.** The keys live on the rows
    the erasure destroys, so collecting them afterwards collects nothing and
    the objects stay in S3 with nothing pointing at them -- worse than before,
    because now nobody knows they are there.
    """
    rows = await session.execute(
        text(
            """
            SELECT 'resumes' AS bucket, s3_key
              FROM resume_files
             WHERE user_id = :user_id
            UNION ALL
            -- An export archive is the whole of this person's record in one
            -- object. Leaving it behind for the expiry sweep to find would
            -- leave a complete copy of somebody we have just erased sitting
            -- in a bucket -- and that sweep has no schedule yet (E4).
            SELECT 'exports', d.export_s3_key
              FROM dsr_requests d
             WHERE d.user_id = :user_id
               AND d.export_s3_key IS NOT NULL
            UNION ALL
            SELECT 'interview_audio', a.s3_key
              FROM interview_answers a
              JOIN interview_sessions s ON s.id = a.session_id
             WHERE s.user_id = :user_id
               AND a.s3_key IS NOT NULL
            UNION ALL
            SELECT 'profile_images', p.s3_key
              FROM user_photos p
             WHERE p.user_id = :user_id
            """
        ),
        {"user_id": user_id},
    )
    return [(r[0], r[1]) for r in rows.all()]


async def erase_candidate(
    session: AsyncSession, *, user_id: uuid.UUID, policy_version: str
) -> dict[str, int]:
    """Run the cascade. Returns rows destroyed, per table.

    One call to one SECURITY DEFINER function, so the whole erasure is one
    statement in one transaction: it either happened or it did not. The
    manifest it returns is recorded on the request and in the audit row, which
    is how "what exactly was deleted?" is answerable in three years without
    the data that would answer it.
    """
    row = await session.execute(
        text("SELECT erase_candidate(:user_id, :policy_version)"),
        {"user_id": user_id, "policy_version": policy_version},
    )
    manifest: Any = row.scalar_one()
    return dict(manifest) if isinstance(manifest, dict) else {}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

#: One query per export section. Written out rather than reflected, because an
#: export built by walking foreign keys exports whatever happens to be
#: reachable -- including, the first time somebody adds a column, an
#: employer's private notes. What is in an export is a decision, so it is a
#: list.
#:
#: Every one is scoped by `:user_id`. None of them selects a column named in
#: `domain.EXPORT_FORBIDDEN_FIELDS`, and a test asserts that against the
#: returned keys rather than against this text.
_EXPORT_QUERIES: dict[str, str] = {
    "account": """
        SELECT phone, email, locale, status, created_at
          FROM users WHERE id = :user_id
    """,
    "profile": """
        SELECT full_name, city, state_code, career, updated_at
          FROM candidate_profiles WHERE user_id = :user_id
    """,
    "resumes": """
        SELECT v.id, v.source, v.parsed, v.confirmed_at, v.created_at
          FROM resume_versions v WHERE v.user_id = :user_id
         ORDER BY v.created_at
    """,
    # The value, and nothing that explains it. `breakdown`,
    # `raw_model_response` and `extracted_features` are the reasoning, and the
    # client settled that the score is never explained to the candidate
    # (R11/Q12) -- an export is another door to the same room.
    "scores": """
        SELECT raw_value AS score, computed_at
          FROM scores WHERE user_id = :user_id
         ORDER BY computed_at
    """,
    "applications": """
        SELECT a.id, j.title, a.stage, a.created_at, a.interview_at
          FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.candidate_id = :user_id
         ORDER BY a.created_at
    """,
    "subscriptions": """
        SELECT s.id, p.code AS plan, s.state, s.current_period_start, s.current_period_end
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.subscriber_type = 'USER' AND s.subscriber_id = :user_id
         ORDER BY s.created_at
    """,
    "purchases": """
        SELECT id, purpose, amount_minor, currency, status, created_at
          FROM payments WHERE user_id = :user_id
         ORDER BY created_at
    """,
    "interviews": """
        SELECT s.id, s.state, s.created_at, s.completed_at
          FROM interview_sessions s WHERE s.user_id = :user_id
         ORDER BY s.created_at
    """,
    # 2026-09-29. The questions written for them, which were written from
    # their CV and answers, so they are about the person.
    "interview_questions": """
        SELECT q.session_id, q.question_index, q.prompt, q.looking_for, q.kind, q.created_at
          FROM interview_session_questions q
          JOIN interview_sessions s ON s.id = q.session_id
         WHERE s.user_id = :user_id
         ORDER BY q.created_at, q.question_index
    """,
    "courses": """
        SELECT m.course_code, l.title AS lesson, p.position_seconds, p.furthest_seconds,
               p.first_opened_at, p.completed_at
          FROM course_lesson_progress p
          JOIN course_lessons l ON l.id = p.lesson_id
          JOIN course_modules m ON m.id = l.module_id
         WHERE p.user_id = :user_id
         ORDER BY p.first_opened_at
    """,
    # What employers sent them. Never which recruiter: that is the employer's.
    "messages": """
        SELECT m.application_id, m.kind, m.body, m.scheduled_at, m.link, m.created_at
          FROM application_messages m
          JOIN applications a ON a.id = m.application_id
         WHERE a.candidate_id = :user_id
         ORDER BY m.created_at
    """,
    # Organisations that kept them or invited them to a job, and their answer
    # (2026-10-05). A private SAVED row is theirs to know about too. Never
    # which recruiter: that is the employer's.
    "shortlists": """
        SELECT coalesce(e.legal_name, t.name) AS employer, j.title AS job, s.status,
               s.created_at, s.answered_at
          FROM employer_shortlists s
          JOIN tenants t ON t.id = s.tenant_id
          LEFT JOIN employers e ON e.tenant_id = s.tenant_id
          LEFT JOIN jobs j ON j.id = s.job_id
         WHERE s.candidate_id = :user_id
         ORDER BY s.created_at
    """,
    "questionnaire": """
        SELECT bank_version, answers, submitted_at
          FROM questionnaire_responses WHERE user_id = :user_id
         ORDER BY submitted_at
    """,
    "streaks": """
        SELECT current_streak, longest_streak, last_active_on, first_active_on
          FROM user_streaks WHERE user_id = :user_id
    """,
    # The calendar: dates only, the last year of them.
    "streak_days": """
        SELECT activity_on FROM streak_activity_days WHERE user_id = :user_id
         ORDER BY activity_on
    """,
    # That they have a photo and when they set it (2026-10-09). The image
    # itself is theirs to download from `GET /profile/photo`; the archive is
    # their records, not a copy of their face.
    "photo": """
        SELECT mime, width, height, updated_at FROM user_photos WHERE user_id = :user_id
    """,
    # The college is named because the student chose it. The consent version
    # is included because it is the wording they agreed to, and a person
    # asking what they consented to deserves the answer.
    "colleges": """
        SELECT c.name AS college, sc.scope, sc.granted_via, sc.consent_version,
               sc.granted_at, sc.revoked_at
          FROM student_consents sc JOIN colleges c ON c.tenant_id = sc.tenant_id
         WHERE sc.candidate_id = :user_id
         ORDER BY sc.granted_at
    """,
    "notifications": """
        SELECT channel, template_code, category, state, skip_reason, created_at
          FROM notifications WHERE user_id = :user_id
         ORDER BY created_at
    """,
    "requests": """
        SELECT id, type, state, due_at, completed_at, created_at
          FROM dsr_requests WHERE user_id = :user_id
         ORDER BY created_at
    """,
}


async def export_section(
    session: AsyncSession, *, section: str, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """One section of an export, as JSON-ready rows."""
    rows = await session.execute(text(_EXPORT_QUERIES[section]), {"user_id": user_id})
    return [dict(m) for m in rows.mappings().all()]
