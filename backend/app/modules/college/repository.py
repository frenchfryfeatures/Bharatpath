"""college - data access

Institution tenant, roster, invites, consent, referral codes.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**Every table here is under Row-Level Security**, and two identities read it:

* **College staff** -- the service binds `app.tenant_id` from the membership
  first. Without it a read returns nothing, the correct failure direction.
* **A student** -- the service binds `app.user_id` (`set_transaction_user`).
  The candidate policies show them their own consents and seats, and the names
  of colleges they are linked to; everything else they need goes through the
  SECURITY DEFINER functions in the baseline migration, called by name below,
  each of which answers one question.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from sqlalchemy import case, delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.college.domain import (
    GRANTED_VIA_DIRECT,
    INDIVIDUAL,
    INVITE_EXPIRED,
    INVITE_PENDING,
    INVITE_SENT,
    ROSTER,
    RosterRow,
)
from app.modules.college.models import (
    College,
    CollegeSeat,
    CollegeSeatAssignment,
    ReferralCode,
    RosterEntry,
    RosterImport,
    StudentConsent,
)

#: The columns an admin may change on the organisation.
_EDITABLE: Final[frozenset[str]] = frozenset({"name", "institution_type"})


# --- the organisation ------------------------------------------------------------
async def create_college(
    session: AsyncSession, *, tenant_id: uuid.UUID, name: str, institution_type: str
) -> College:
    row = College(tenant_id=tenant_id, name=name, institution_type=institution_type)
    session.add(row)
    # Every college has its seat row from the start, at zero. A seat is then
    # always an UPDATE of a row that exists, locked, never a racing INSERT.
    session.add(CollegeSeat(tenant_id=tenant_id, seats_allocated=0, seats_used=0))
    await session.flush()
    return row


async def get_college(
    session: AsyncSession, *, tenant_id: uuid.UUID, lock: bool = False
) -> College | None:
    query = select(College).where(College.tenant_id == tenant_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def update_college(
    session: AsyncSession, *, tenant_id: uuid.UUID, changes: dict[str, Any]
) -> College | None:
    row = await get_college(session, tenant_id=tenant_id, lock=True)
    if row is None:
        return None
    for name, value in changes.items():
        if name in _EDITABLE and value is not None:
            setattr(row, name, value)
    await session.flush()
    return row


# --- seats -----------------------------------------------------------------------
async def get_seats(
    session: AsyncSession, *, tenant_id: uuid.UUID, lock: bool = False
) -> CollegeSeat | None:
    query = select(CollegeSeat).where(CollegeSeat.tenant_id == tenant_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def set_allocation(
    session: AsyncSession, row: CollegeSeat, *, seats: int, allocated_by: uuid.UUID | None
) -> CollegeSeat:
    """The allowance only. `seats_used` belongs to the seat guard."""
    await session.execute(
        update(CollegeSeat)
        .where(CollegeSeat.tenant_id == row.tenant_id)
        .values(seats_allocated=seats, allocated_by=allocated_by, updated_at=func.now())
    )
    await session.refresh(row)
    return row


async def fill_seats(session: AsyncSession, *, tenant_id: uuid.UUID) -> int:
    result = await session.execute(text("SELECT fill_college_seats(:t)"), {"t": str(tenant_id)})
    return int(result.scalar_one())


# --- referral codes --------------------------------------------------------------
async def insert_code(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    code: str,
    created_by: uuid.UUID,
    max_uses: int | None,
    expires_at: datetime,
) -> ReferralCode | None:
    """None when the code collides with an existing one -- at 60 bits that is
    a CSPRNG failure, and the service draws again rather than guessing."""
    result = await session.execute(
        pg_insert(ReferralCode)
        .values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            code=code,
            created_by=created_by,
            max_uses=max_uses,
            uses=0,
            expires_at=expires_at,
        )
        .on_conflict_do_nothing(constraint="uq_referral_code")
        .returning(ReferralCode.id)
    )
    code_id = result.scalar_one_or_none()
    if code_id is None:
        return None
    return await get_code(session, tenant_id=tenant_id, code_id=code_id)


async def get_code(
    session: AsyncSession, *, tenant_id: uuid.UUID, code_id: uuid.UUID, lock: bool = False
) -> ReferralCode | None:
    query = select(ReferralCode).where(
        ReferralCode.id == code_id, ReferralCode.tenant_id == tenant_id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def list_codes(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
    active_only: bool,
    now: datetime,
) -> list[ReferralCode]:
    query = select(ReferralCode).where(ReferralCode.tenant_id == tenant_id)
    if active_only:
        query = query.where(
            ReferralCode.revoked_at.is_(None),
            ReferralCode.expires_at > now,
            (ReferralCode.max_uses.is_(None)) | (ReferralCode.uses < ReferralCode.max_uses),
        )
    if after is not None:
        created_at, code_id = after
        query = query.where(
            (ReferralCode.created_at < created_at)
            | ((ReferralCode.created_at == created_at) & (ReferralCode.id < code_id))
        )
    result = await session.execute(
        query.order_by(ReferralCode.created_at.desc(), ReferralCode.id.desc()).limit(limit)
    )
    return list(result.scalars())


async def revoke_code(
    session: AsyncSession, row: ReferralCode, *, revoked_by: uuid.UUID, now: datetime
) -> ReferralCode:
    await session.execute(
        update(ReferralCode)
        .where(ReferralCode.id == row.id, ReferralCode.revoked_at.is_(None))
        .values(revoked_at=now, revoked_by=revoked_by, updated_at=func.now())
    )
    await session.refresh(row)
    return row


# --- a student's side (candidate transaction) ------------------------------------
@dataclass(frozen=True, slots=True)
class LiveCode:
    code_id: uuid.UUID
    tenant_id: uuid.UUID


async def resolve_code(session: AsyncSession, *, code: str) -> LiveCode | None:
    row = (
        await session.execute(
            text("SELECT code_id, tenant_id FROM referral_code_tenant(:c)"), {"c": code}
        )
    ).first()
    return LiveCode(row.code_id, row.tenant_id) if row is not None else None


async def consume_code(session: AsyncSession, *, code_id: uuid.UUID) -> bool:
    result = await session.execute(text("SELECT consume_referral_code(:i)"), {"i": str(code_id)})
    return bool(result.scalar_one())


async def live_roster_consent(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID
) -> StudentConsent | None:
    result = await session.execute(
        select(StudentConsent).where(
            StudentConsent.tenant_id == tenant_id,
            StudentConsent.candidate_id == candidate_id,
            StudentConsent.scope == ROSTER,
            StudentConsent.revoked_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def insert_roster_consent(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    candidate_id: uuid.UUID,
    granted_via: str,
    consent_version: str,
    referral_code_id: uuid.UUID | None = None,
    roster_entry_id: uuid.UUID | None = None,
) -> StudentConsent:
    row = StudentConsent(
        tenant_id=tenant_id,
        candidate_id=candidate_id,
        scope=ROSTER,
        granted_via=granted_via,
        consent_version=consent_version,
        referral_code_id=referral_code_id,
        roster_entry_id=roster_entry_id,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def claim_seat(session: AsyncSession, *, tenant_id: uuid.UUID) -> uuid.UUID | None:
    result = await session.execute(text("SELECT claim_college_seat(:t)"), {"t": str(tenant_id)})
    value: Any = result.scalar_one()
    return uuid.UUID(str(value)) if value is not None else None


async def candidate_consents(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> list[StudentConsent]:
    result = await session.execute(
        select(StudentConsent)
        .where(StudentConsent.candidate_id == candidate_id)
        .order_by(StudentConsent.granted_at.desc(), StudentConsent.id)
    )
    return list(result.scalars())


async def candidate_live_seat(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> CollegeSeatAssignment | None:
    result = await session.execute(
        select(CollegeSeatAssignment).where(
            CollegeSeatAssignment.candidate_id == candidate_id,
            CollegeSeatAssignment.released_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def college_names(
    session: AsyncSession, *, tenant_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """For a candidate: names of colleges they are linked to, and no others
    (`colleges_candidate_linked`)."""
    if not tenant_ids:
        return {}
    result = await session.execute(
        select(College.tenant_id, College.name).where(College.tenant_id.in_(tenant_ids))
    )
    return {row.tenant_id: row.name for row in result}


@dataclass(frozen=True, slots=True)
class CandidateInvitation:
    entry_id: uuid.UUID
    tenant_id: uuid.UUID
    college_name: str
    sent_at: datetime


async def invitations_for_candidate(session: AsyncSession) -> list[CandidateInvitation]:
    result = await session.execute(
        text("SELECT entry_id, tenant_id, college_name, sent_at FROM invitations_for_candidate()")
    )
    return [CandidateInvitation(r.entry_id, r.tenant_id, r.college_name, r.sent_at) for r in result]


async def answer_invitation(
    session: AsyncSession, *, entry_id: uuid.UUID, accept: bool
) -> uuid.UUID | None:
    result = await session.execute(
        text("SELECT answer_invitation(:e, :a)"), {"e": str(entry_id), "a": accept}
    )
    value: Any = result.scalar_one()
    return uuid.UUID(str(value)) if value is not None else None


# --- roster imports (college transaction) ----------------------------------------
async def lock_roster(session: AsyncSession, *, tenant_id: uuid.UUID) -> None:
    """Serialise previews and commits for one college, so "already on the
    roster" is decided against a roster no other commit is changing."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"roster:{tenant_id}"},
    )


async def import_by_source(
    session: AsyncSession, *, tenant_id: uuid.UUID, source_sha256: str
) -> RosterImport | None:
    result = await session.execute(
        select(RosterImport).where(
            RosterImport.tenant_id == tenant_id,
            RosterImport.source_sha256 == source_sha256,
            RosterImport.state != "DISCARDED",
        )
    )
    return result.scalar_one_or_none()


async def committed_contacts(
    session: AsyncSession, *, tenant_id: uuid.UUID
) -> tuple[frozenset[str], frozenset[str]]:
    result = await session.execute(
        select(RosterEntry.phone, RosterEntry.email).where(
            RosterEntry.tenant_id == tenant_id, RosterEntry.invite_state.is_not(None)
        )
    )
    phones: set[str] = set()
    emails: set[str] = set()
    for phone, email in result:
        if phone:
            phones.add(phone)
        if email:
            emails.add(email)
    return frozenset(phones), frozenset(emails)


async def insert_import(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    file_name: str,
    source_sha256: str,
    rows: tuple[RosterRow, ...],
    ignored_columns: tuple[str, ...],
    created_by: uuid.UUID,
) -> RosterImport:
    counts = {"VALID": 0, "INVALID": 0, "DUPLICATE": 0}
    for row in rows:
        counts[row.state] += 1
    record = RosterImport(
        tenant_id=tenant_id,
        file_name=file_name,
        source_sha256=source_sha256,
        total_rows=len(rows),
        valid_rows=counts["VALID"],
        invalid_rows=counts["INVALID"],
        duplicate_rows=counts["DUPLICATE"],
        ignored_columns=list(ignored_columns),
        state="PREVIEW",
        created_by=created_by,
    )
    session.add(record)
    await session.flush()
    await session.execute(
        pg_insert(RosterEntry),
        [
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_id,
                "import_id": record.id,
                "row_number": row.row_number,
                "full_name": row.full_name,
                "phone": row.phone,
                "email": row.email,
                "student_ref": row.student_ref,
                "row_state": row.state,
                "issues": list(row.issues),
            }
            for row in rows
        ],
    )
    return record


async def get_import(
    session: AsyncSession, *, tenant_id: uuid.UUID, import_id: uuid.UUID, lock: bool = False
) -> RosterImport | None:
    query = select(RosterImport).where(
        RosterImport.id == import_id, RosterImport.tenant_id == tenant_id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def list_imports(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[RosterImport]:
    query = select(RosterImport).where(RosterImport.tenant_id == tenant_id)
    if after is not None:
        created_at, import_id = after
        query = query.where(
            (RosterImport.created_at < created_at)
            | ((RosterImport.created_at == created_at) & (RosterImport.id < import_id))
        )
    result = await session.execute(
        query.order_by(RosterImport.created_at.desc(), RosterImport.id.desc()).limit(limit)
    )
    return list(result.scalars())


async def invitation_counts_for_tenant(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    expired_before: datetime,
) -> dict[str, int]:
    displayed_state = case(
        (
            (RosterEntry.invite_state == INVITE_SENT) & (RosterEntry.sent_at <= expired_before),
            INVITE_EXPIRED,
        ),
        else_=RosterEntry.invite_state,
    ).label("displayed_state")
    result = await session.execute(
        select(displayed_state, func.count(RosterEntry.id))
        .where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.invite_state.is_not(None),
        )
        .group_by(displayed_state)
    )
    return {str(state): int(count) for state, count in result}


async def list_rows(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    import_id: uuid.UUID,
    row_state: str | None,
    after_row: int,
    limit: int,
) -> list[RosterEntry]:
    query = select(RosterEntry).where(
        RosterEntry.tenant_id == tenant_id,
        RosterEntry.import_id == import_id,
        RosterEntry.row_number > after_row,
    )
    if row_state is not None:
        query = query.where(RosterEntry.row_state == row_state)
    result = await session.execute(query.order_by(RosterEntry.row_number).limit(limit))
    return list(result.scalars())


async def valid_uncommitted_rows(
    session: AsyncSession, *, tenant_id: uuid.UUID, import_id: uuid.UUID
) -> list[RosterEntry]:
    result = await session.execute(
        select(RosterEntry)
        .where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.import_id == import_id,
            RosterEntry.row_state == "VALID",
            RosterEntry.invite_state.is_(None),
        )
        .order_by(RosterEntry.row_number)
    )
    return list(result.scalars())


async def mark_rows_already_on_roster(
    session: AsyncSession, *, row_ids: list[uuid.UUID], issue: str
) -> None:
    if not row_ids:
        return
    await session.execute(
        update(RosterEntry)
        .where(RosterEntry.id.in_(row_ids), RosterEntry.invite_state.is_(None))
        .values(row_state="DUPLICATE", issues=func.jsonb_build_array(issue))
    )


async def commit_rows(session: AsyncSession, *, tenant_id: uuid.UUID, import_id: uuid.UUID) -> int:
    result = await session.execute(
        update(RosterEntry)
        .where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.import_id == import_id,
            RosterEntry.row_state == "VALID",
            RosterEntry.invite_state.is_(None),
        )
        .values(invite_state=INVITE_PENDING)
        .returning(RosterEntry.id)
    )
    return len(result.all())


async def delete_uncommitted_rows(
    session: AsyncSession, *, tenant_id: uuid.UUID, import_id: uuid.UUID
) -> int:
    result = await session.execute(
        delete(RosterEntry)
        .where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.import_id == import_id,
            RosterEntry.invite_state.is_(None),
        )
        .returning(RosterEntry.id)
    )
    return len(result.all())


async def recount(session: AsyncSession, record: RosterImport) -> None:
    """Row counts after the commit re-checked duplicates."""
    result = await session.execute(
        select(RosterEntry.row_state, func.count())
        .where(RosterEntry.import_id == record.id)
        .group_by(RosterEntry.row_state)
    )
    counts = dict(result.tuples().all())
    record.valid_rows = int(counts.get("VALID", 0))
    record.invalid_rows = int(counts.get("INVALID", 0))
    record.duplicate_rows = int(counts.get("DUPLICATE", 0))
    await session.flush()


async def send_pending(
    session: AsyncSession, *, tenant_id: uuid.UUID, import_id: uuid.UUID, now: datetime
) -> list[uuid.UUID]:
    result = await session.execute(
        update(RosterEntry)
        .where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.import_id == import_id,
            RosterEntry.invite_state == INVITE_PENDING,
        )
        .values(invite_state=INVITE_SENT, sent_at=now)
        .returning(RosterEntry.id)
    )
    return [row[0] for row in result.all()]


async def unreachable_valid_rows(
    session: AsyncSession, *, import_id: uuid.UUID, contact_fields: frozenset[str]
) -> int:
    """Valid rows an invitation could not be delivered to.

    A roster row needs a phone *or* an email. With SMS deferred a phone-only
    row is perfectly valid, is committed, raises its event, and is then
    recorded SKIPPED `NO_CONTACT`, which the college would never see. This is
    what the preview reports so they can go and get email addresses before
    committing rather than after.

    `contact_fields` comes from `notifications.domain`, so when SMS returns
    this counts zero on its own.
    """
    if not contact_fields:
        # Nothing can be delivered at all. Every valid row is unreachable,
        # and saying so is more use than a zero.
        columns = "TRUE"
    else:
        columns = " AND ".join(f"{field} IS NULL" for field in sorted(contact_fields))
    total = await session.scalar(
        text(
            f"SELECT count(*) FROM roster_entries "  # noqa: S608 - names, not values
            f"WHERE import_id = :import_id AND row_state = 'VALID' AND ({columns})"
        ),
        {"import_id": str(import_id)},
    )
    return int(total or 0)


async def invitation_rows(
    session: AsyncSession, *, tenant_id: uuid.UUID, import_id: uuid.UUID
) -> list[tuple[str | None, datetime | None]]:
    """`(invite_state, sent_at)` of every committed row, for tracking counts
    that measure expiry at read."""
    result = await session.execute(
        select(RosterEntry.invite_state, RosterEntry.sent_at).where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.import_id == import_id,
            RosterEntry.invite_state.is_not(None),
        )
    )
    return [(state, sent_at) for state, sent_at in result.tuples()]


# --- consent: granting INDIVIDUAL and revoking (candidate transaction) --------
async def live_consents(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID
) -> list[StudentConsent]:
    result = await session.execute(
        select(StudentConsent)
        .where(
            StudentConsent.tenant_id == tenant_id,
            StudentConsent.candidate_id == candidate_id,
            StudentConsent.revoked_at.is_(None),
        )
        .order_by(StudentConsent.granted_at)
    )
    return list(result.scalars())


async def insert_individual_consent(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID, consent_version: str
) -> StudentConsent:
    row = StudentConsent(
        tenant_id=tenant_id,
        candidate_id=candidate_id,
        scope=INDIVIDUAL,
        granted_via=GRANTED_VIA_DIRECT,
        consent_version=consent_version,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def revoke_consent(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID, scope: str
) -> datetime | None:
    """Revoke the student's live consent of `scope` at that college, and
    return when; None if there was none. `clock_timestamp()`, so a revocation
    is stamped when it happened rather than when its transaction began. The
    triggers release the seat and end INDIVIDUAL with ROSTER."""
    result = await session.execute(
        update(StudentConsent)
        .where(
            StudentConsent.tenant_id == tenant_id,
            StudentConsent.candidate_id == candidate_id,
            StudentConsent.scope == scope,
            StudentConsent.revoked_at.is_(None),
        )
        .values(revoked_at=func.clock_timestamp())
        .returning(StudentConsent.revoked_at)
    )
    return result.scalar_one_or_none()


async def has_any_consent(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID
) -> bool:
    result = await session.execute(
        select(func.count())
        .select_from(StudentConsent)
        .where(
            StudentConsent.tenant_id == tenant_id,
            StudentConsent.candidate_id == candidate_id,
        )
    )
    return bool(result.scalar_one())


# --- students who let their college see them (college transaction) -----------
@dataclass(frozen=True, slots=True)
class VisibleStudentRow:
    candidate_id: uuid.UUID
    consent_id: uuid.UUID
    visible_since: datetime
    full_name: str | None
    score_resume_version_id: uuid.UUID | None


async def visible_students(
    session: AsyncSession,
    *,
    limit: int,
    after: tuple[datetime, uuid.UUID] | None,
    query: str | None,
) -> list[VisibleStudentRow]:
    """Through `college_visible_students`, which INNER JOINs live INDIVIDUAL
    and ROSTER consent for the bound college. Never a table read."""
    result = await session.execute(
        text(
            "SELECT candidate_id, consent_id, visible_since, full_name, score_resume_version_id "
            "FROM college_visible_students(:limit, :since, :after_id, :query)"
        ),
        {
            "limit": limit,
            "since": after[0] if after else None,
            "after_id": str(after[1]) if after else None,
            "query": query,
        },
    )
    return [
        VisibleStudentRow(
            r.candidate_id, r.consent_id, r.visible_since, r.full_name, r.score_resume_version_id
        )
        for r in result
    ]


@dataclass(frozen=True, slots=True)
class RosterStageStudentRow:
    roster_entry_id: uuid.UUID
    full_name: str | None
    stage_since: datetime


async def roster_stage_students(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    stage: Literal["INVITED", "CONSENT_PENDING"],
    limit: int,
    after: tuple[datetime, uuid.UUID] | None,
    query: str | None,
    invited_after: datetime,
) -> list[RosterStageStudentRow]:
    """College-supplied roster names before individual visibility.

    INVITED is a live SENT invitation. CONSENT_PENDING is an accepted roster
    link with no live INDIVIDUAL grant. Candidate ids never leave this query.
    """
    if stage == "INVITED":
        statement = text(
            """
            SELECT e.id AS roster_entry_id, e.full_name, e.sent_at AS stage_since
              FROM roster_entries e
             WHERE e.tenant_id = :tenant_id
               AND e.invite_state = 'SENT'
               AND e.sent_at IS NOT NULL
               AND e.sent_at > :invited_after
               AND (
                    CAST(:query AS text) IS NULL
                    OR strpos(lower(coalesce(e.full_name, '')), lower(CAST(:query AS text))) > 0
                   )
               AND (
                    CAST(:since AS timestamptz) IS NULL
                    OR (e.sent_at, e.id) >
                       (CAST(:since AS timestamptz), CAST(:after_id AS uuid))
                   )
             ORDER BY e.sent_at, e.id
             LIMIT :limit
            """
        )
    elif stage == "CONSENT_PENDING":
        statement = text(
            """
            SELECT e.id AS roster_entry_id, e.full_name, e.responded_at AS stage_since
              FROM roster_entries e
              JOIN student_consents roster
                ON roster.roster_entry_id = e.id
               AND roster.scope = 'ROSTER'
               AND roster.revoked_at IS NULL
              LEFT JOIN student_consents individual
                ON individual.tenant_id = roster.tenant_id
               AND individual.candidate_id = roster.candidate_id
               AND individual.scope = 'INDIVIDUAL'
               AND individual.revoked_at IS NULL
             WHERE e.tenant_id = :tenant_id
               AND e.invite_state = 'ACCEPTED'
               AND e.responded_at IS NOT NULL
               AND individual.id IS NULL
               AND (
                    CAST(:query AS text) IS NULL
                    OR strpos(lower(coalesce(e.full_name, '')), lower(CAST(:query AS text))) > 0
                   )
               AND (
                    CAST(:since AS timestamptz) IS NULL
                    OR (e.responded_at, e.id) >
                       (CAST(:since AS timestamptz), CAST(:after_id AS uuid))
                   )
             ORDER BY e.responded_at, e.id
             LIMIT :limit
            """
        )
    else:  # pragma: no cover - the service supplies the closed literal set
        raise ValueError(f"unsupported student stage: {stage}")

    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "query": query,
        "since": after[0] if after else None,
        "after_id": str(after[1]) if after else None,
        "limit": limit,
    }
    if stage == "INVITED":
        params["invited_after"] = invited_after

    result = await session.execute(statement, params)
    return [
        RosterStageStudentRow(
            roster_entry_id=row.roster_entry_id,
            full_name=row.full_name,
            stage_since=row.stage_since,
        )
        for row in result
    ]


@dataclass(frozen=True, slots=True)
class StudentProfileRow:
    candidate_id: uuid.UUID
    consent_id: uuid.UUID
    visible_since: datetime
    full_name: str | None
    stored_score: int | None
    scored_at: datetime | None
    score_resume_version_id: uuid.UUID | None
    applications: int
    interviews: int
    hires: int


async def student_profile(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> StudentProfileRow | None:
    row = (
        await session.execute(
            text(
                "SELECT candidate_id, consent_id, visible_since, full_name, stored_score, "
                "scored_at, score_resume_version_id, applications, interviews, hires "
                "FROM college_student_profile(:c)"
            ),
            {"c": str(candidate_id)},
        )
    ).first()
    if row is None:
        return None
    return StudentProfileRow(
        row.candidate_id,
        row.consent_id,
        row.visible_since,
        row.full_name,
        row.stored_score,
        row.scored_at,
        row.score_resume_version_id,
        int(row.applications),
        int(row.interviews),
        int(row.hires),
    )


@dataclass(frozen=True, slots=True)
class StudentHireRow:
    job_title: str
    employer_name: str
    #: For the employer's logo only; never sent to the college.
    employer_tenant_id: uuid.UUID
    hired_at: datetime


async def student_hires(session: AsyncSession, *, candidate_id: uuid.UUID) -> list[StudentHireRow]:
    result = await session.execute(
        text(
            "SELECT job_title, employer_name, employer_tenant_id, hired_at "
            "FROM college_student_hires(:c)"
        ),
        {"c": str(candidate_id)},
    )
    return [
        StudentHireRow(r.job_title, r.employer_name, r.employer_tenant_id, r.hired_at)
        for r in result
    ]


async def sent_invitation(
    session: AsyncSession, *, tenant_id: uuid.UUID, entry_id: uuid.UUID
) -> RosterEntry | None:
    result = await session.execute(
        select(RosterEntry).where(
            RosterEntry.tenant_id == tenant_id,
            RosterEntry.id == entry_id,
            RosterEntry.invite_state == INVITE_SENT,
        )
    )
    return result.scalar_one_or_none()


# --- a student's details (2026-09-29), through the consent-joined reads ----------
@dataclass(frozen=True, slots=True)
class StudentDetailsRow:
    consent_id: uuid.UUID
    consent_version: str
    email: str | None
    phone: str | None
    city: str | None
    state_code: str | None
    locale: str
    questionnaire: dict[str, Any]
    questionnaire_submitted_at: datetime | None
    resume_source: str | None
    resume_parsed: dict[str, Any] | None
    resume_confirmed_at: datetime | None
    resume_s3_key: str | None
    resume_mime: str | None
    interviews_completed: int


async def student_details(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> StudentDetailsRow | None:
    """None unless the student's INDIVIDUAL consent to this college is live
    **and** under words that name these details."""
    row = (
        await session.execute(
            text(
                "SELECT consent_id, consent_version, email, phone, city, state_code, locale, "
                "questionnaire, questionnaire_submitted_at, resume_source, resume_parsed, "
                "resume_confirmed_at, resume_s3_key, resume_mime, interviews_completed "
                "FROM college_student_details(:c)"
            ),
            {"c": str(candidate_id)},
        )
    ).first()
    if row is None:
        return None
    return StudentDetailsRow(
        row.consent_id,
        row.consent_version,
        row.email,
        row.phone,
        row.city,
        row.state_code,
        row.locale,
        dict(row.questionnaire or {}),
        row.questionnaire_submitted_at,
        row.resume_source,
        dict(row.resume_parsed) if row.resume_parsed is not None else None,
        row.resume_confirmed_at,
        row.resume_s3_key,
        row.resume_mime,
        int(row.interviews_completed),
    )


@dataclass(frozen=True, slots=True)
class StudentCourseRow:
    course_code: str
    title: str
    purchased_at: datetime
    lessons_total: int
    lessons_completed: int
    completed_at: datetime | None


async def student_courses(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> list[StudentCourseRow]:
    result = await session.execute(
        text(
            "SELECT course_code, title, purchased_at, lessons_total, lessons_completed, "
            "completed_at FROM college_student_courses(:c)"
        ),
        {"c": str(candidate_id)},
    )
    return [
        StudentCourseRow(
            r.course_code,
            r.title,
            r.purchased_at,
            int(r.lessons_total),
            int(r.lessons_completed),
            r.completed_at,
        )
        for r in result
    ]


@dataclass(frozen=True, slots=True)
class StudentApplicationRow:
    job_title: str
    employer_name: str
    #: For the employer's logo only; never sent to the college.
    employer_tenant_id: uuid.UUID
    job_location: str | None
    stage: str
    applied_at: datetime
    updated_at: datetime


async def student_applications(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> tuple[list[StudentApplicationRow], dict[str, int]]:
    """Each application and the stages it ever reached. No application id:
    the college has no use for one, and nothing to open with it."""
    result = await session.execute(
        text(
            "SELECT job_title, employer_name, employer_tenant_id, job_location, stage, "
            "applied_at, updated_at, reached FROM college_student_applications(:c)"
        ),
        {"c": str(candidate_id)},
    )
    rows: list[StudentApplicationRow] = []
    reached: dict[str, int] = {}
    for r in result:
        rows.append(
            StudentApplicationRow(
                r.job_title,
                r.employer_name,
                r.employer_tenant_id,
                r.job_location,
                r.stage,
                r.applied_at,
                r.updated_at,
            )
        )
        for stage in r.reached or []:
            reached[str(stage)] = reached.get(str(stage), 0) + 1
    return rows, reached
