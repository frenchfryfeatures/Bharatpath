"""college - SQLAlchemy ORM models.

Institution tenant, roster, invites, consent, referral codes.

**Invariant 9 lives here.** Two things that are not negotiable:

* **Two distinct consent scopes.** `ROSTER` means the college may count you in
  aggregates; `INDIVIDUAL` means it may see you as a person. Roster consent
  never implies individual visibility (PRD rule 8), and analytics INNER JOINs
  this table rather than filtering in Python - so revoking consent makes rows
  disappear from the query itself.
* **Revocation is a timestamp, never a deletion.** You must be able to prove
  what was visible to whom on a given date.

**Referral codes are new since 2026-08-27** and run *alongside* the invite
flow, not instead of it - invites still cover students with no account yet.
Three decisions we took, all in the schema, and approved by the client:

  1. Entering a code **is** the consent act (`granted_via = REFERRAL_CODE`).
     It is arguably better consent than invite-accept, because the student
     takes a deliberate action rather than clicking a link in a message.
  2. It grants **ROSTER scope only.** A code must not silently confer
     individual visibility.
  3. **Codes are credentials** - non-guessable, rate-limited on entry,
     revocable, expiring. A guessable code lets anyone attach themselves to a
     roster, or lets a college harvest students who never agreed to anything.

**Seats are held per student.** `college_seats` is the allowance and
the count; `college_seat_assignments` says which student each counted seat is
paying for. `guard_college_seat_assignment` (baseline migration) keeps the two
equal and refuses a seat past the allowance, for every writer.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import TenantScoped, Timestamps, UUIDPrimaryKey
from app.modules.college.domain import CODE_LENGTH
from app.modules.college.forms import INSTITUTION_TYPES


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class College(Base, Timestamps):
    """College-specific columns, keyed on the shared tenant row.

    The onboarding answers are kept whole, as a KYB submission's are, because
    the form is data (`college/forms.py`) and will change; the row must keep
    saying what was asked and answered. **No review follows submission**: a
    college is a B2B deal somebody has already spoken to, and `verified_at` is
    set by our staff, not by filling in a form.
    """

    __tablename__ = "colleges"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    institution_type: Mapped[str] = mapped_column(String(32), nullable=False)
    onboarding_answers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    form_version: Mapped[str | None] = mapped_column(String(64))
    onboarding_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            _in("institution_type", tuple(code for code, _ in INSTITUTION_TYPES)),
            name="ck_colleges_institution_type",
        ),
    )


class CollegeSeat(Base, Timestamps):
    """Admin-assigned seat allowance (client: "No of Seats ... from the admin").

    One payment per period covering up to N students - mirroring the employer
    model rather than the tiers the employer side rejected (client-approved).

    **A seat replaces the student's own subscription entirely** (client,
    2026-09-12, closing C12): *"Student does not pay if the college has paid
    for it."* So this row is an entitlement, and withdrawing a seat is an
    access change rather than an administrative one.

    `seats_used` is **not written by the application**. The app role holds no
    UPDATE on it; `guard_college_seat_assignment` moves it as seats are taken
    and released, so it cannot drift from the assignments it counts.

    **The 501st student on a 500-seat allowance is refused a seat** -- we
    recommended blocking because it is the only option that cannot produce a
    surprise invoice. They are still linked to the college; they are simply not
    paid for, and are seated when the allowance grows.
    """

    __tablename__ = "college_seats"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    seats_allocated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    seats_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    allocated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint("seats_allocated >= 0", name="ck_college_seats_non_negative"),
        CheckConstraint("seats_used >= 0", name="ck_college_seats_used_non_negative"),
        # The cap, as a constraint: no allocation below what is in use, and no
        # seat taken past the allocation, whichever write attempts it.
        CheckConstraint("seats_used <= seats_allocated", name="ck_college_seats_within_allocation"),
    )


class CollegeSeatAssignment(Base, UUIDPrimaryKey, TenantScoped):
    """One student's seat. **Access, paid for by the college** (C12).

    A seat follows a live ROSTER consent and ends with it: revoking consent
    releases the seat in the same statement (`release_seat_on_consent_revoke`).
    Released, never deleted -- who the college was paying for, and when, is a
    billing record.

    **One live seat per student, platform-wide.** Two colleges paying for the
    same student is money taken twice for one access.
    """

    __tablename__ = "college_seat_assignments"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    consent_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("student_consents.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    release_reason: Mapped[str | None] = mapped_column(String(32))

    __table_args__ = (
        CheckConstraint(
            "(released_at IS NULL) = (release_reason IS NULL)",
            name="ck_college_seat_assignments_release",
        ),
        Index(
            "uq_college_seat_one_live_per_candidate",
            "candidate_id",
            unique=True,
            postgresql_where=text("released_at IS NULL"),
        ),
        # Every seat a candidate ever held, released ones included -- the
        # erasure's predicate (`test_index_review.py`). The unique index above
        # covers only the live one.
        Index("ix_college_seat_assignments_candidate", "candidate_id"),
        Index(
            "ix_college_seat_assignments_live",
            "tenant_id",
            postgresql_where=text("released_at IS NULL"),
        ),
    )


class RosterImport(Base, UUIDPrimaryKey, TenantScoped, Timestamps):
    """One uploaded roster file: previewed, then committed or discarded.

    The preview identifies malformed and duplicate rows *before* anything is
    invited (SRS 2.25.3). **Idempotent by content while retained**: uploading
    the same file again returns its PREVIEW or COMMITTED import, so a double
    tap or retried request cannot stage every student twice. A DISCARDED
    import has no rows and does not prevent uploading that content again.

    Discarding deletes the staged rows. Contact details the college decided
    not to use are not ours to keep.
    """

    __tablename__ = "roster_imports"

    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    invalid_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duplicate_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: Header names that were not read, so the college knows what was dropped.
    ignored_columns: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    state: Mapped[str] = mapped_column(String(16), default="PREVIEW", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    committed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint(
            "state IN ('PREVIEW', 'COMMITTED', 'DISCARDED')",
            name="ck_roster_imports_state",
        ),
        CheckConstraint(
            "(state = 'COMMITTED') = (committed_at IS NOT NULL)",
            name="ck_roster_imports_committed",
        ),
        Index(
            "uq_roster_import_source_retained",
            "tenant_id",
            "source_sha256",
            unique=True,
            postgresql_where=text("state <> 'DISCARDED'"),
        ),
        Index("ix_roster_imports_tenant_created", "tenant_id", "created_at", "id"),
    )


class RosterEntry(Base, UUIDPrimaryKey, TenantScoped):
    """One row of an uploaded roster, and then one invitation.

    `invite_state` is NULL while the row is only previewed; committing moves
    every VALID row to PENDING, sending moves it to SENT, and the student's
    answer to ACCEPTED or DECLINED. EXPIRED is measured at read
    (`domain.invitation_state`).

    **There is no column saying whether this contact has an account.** A
    college that could see which of its students are registered would have an
    enumeration oracle, and a way to single out the ones who have not linked.
    The student finds the invitation from their own verified contact instead.
    """

    __tablename__ = "roster_entries"

    import_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("roster_imports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(320))
    student_ref: Mapped[str | None] = mapped_column(String(64))
    row_state: Mapped[str] = mapped_column(String(16), nullable=False)
    issues: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    invite_state: Mapped[str | None] = mapped_column(String(16))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "row_state IN ('VALID', 'INVALID', 'DUPLICATE')", name="ck_roster_entries_row_state"
        ),
        CheckConstraint(
            "invite_state IS NULL OR invite_state IN "
            "('PENDING', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED')",
            name="ck_roster_entries_invite_state",
        ),
        # Only a valid row is ever invited.
        CheckConstraint(
            "invite_state IS NULL OR row_state = 'VALID'",
            name="ck_roster_entries_only_valid_invited",
        ),
        CheckConstraint(
            "invite_state IS NULL OR invite_state = 'PENDING' OR sent_at IS NOT NULL",
            name="ck_roster_entries_sent_at",
        ),
        UniqueConstraint("import_id", "row_number", name="uq_roster_entry_row"),
        # **A committed roster holds each contact once**, whichever file it
        # came from. The preview marks these as `already_on_roster`; this is
        # what makes a race between two commits unable to invite anyone twice.
        Index(
            "uq_roster_committed_phone",
            "tenant_id",
            "phone",
            unique=True,
            postgresql_where=text("invite_state IS NOT NULL AND phone IS NOT NULL"),
        ),
        Index(
            "uq_roster_committed_email",
            "tenant_id",
            "email",
            unique=True,
            postgresql_where=text("invite_state IS NOT NULL AND email IS NOT NULL"),
        ),
        # A student looks their invitations up by their own contact.
        Index(
            "ix_roster_entries_sent_phone",
            "phone",
            postgresql_where=text("invite_state = 'SENT'"),
        ),
        Index(
            "ix_roster_entries_sent_email",
            "email",
            postgresql_where=text("invite_state = 'SENT'"),
        ),
        Index(
            "ix_roster_entries_tenant_sent_stage",
            "tenant_id",
            "sent_at",
            "id",
            postgresql_where=text("invite_state = 'SENT'"),
        ),
        Index(
            "ix_roster_entries_tenant_accepted_stage",
            "tenant_id",
            "responded_at",
            "id",
            postgresql_where=text("invite_state = 'ACCEPTED'"),
        ),
    )


class StudentConsent(Base, UUIDPrimaryKey, TenantScoped):
    """The gate on everything a college can see about a named student.

    Analytics INNER JOINs this table. Revoking sets `revoked_at`; the row is
    never deleted, because proving what was visible on a past date is a
    requirement, not a nicety.

    **Every grant names what the student acted on**: the referral code they
    typed or the invitation they accepted. `student_consents_candidate_grant`
    (baseline migration) checks it is live and this college's, so a candidate
    cannot attach themselves to a roster by writing a row.
    """

    __tablename__ = "student_consents"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    granted_via: Mapped[str] = mapped_column(String(16), nullable=False)
    referral_code_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("referral_codes.id", ondelete="RESTRICT"), index=True
    )
    roster_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("roster_entries.id", ondelete="RESTRICT"), index=True
    )
    # Consent must be stored with scope, timestamp, version and status
    # (SRS 1.15.3). The client's counsel owns the text of each version.
    consent_version: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        CheckConstraint("scope IN ('ROSTER', 'INDIVIDUAL')", name="ck_student_consents_scope"),
        CheckConstraint(
            "granted_via IN ('INVITE', 'REFERRAL_CODE', 'DIRECT')",
            name="ck_student_consents_granted_via",
        ),
        # **A code or an invitation confers ROSTER; only the student's own,
        # separate act confers INDIVIDUAL** (PRD 3.8). Held here for every
        # writer, not only in the policy the student writes through.
        CheckConstraint(
            "(scope = 'INDIVIDUAL') = (granted_via = 'DIRECT')",
            name="ck_student_consents_scope_via",
        ),
        CheckConstraint(
            "((granted_via = 'REFERRAL_CODE') = (referral_code_id IS NOT NULL)) "
            "AND ((granted_via = 'INVITE') = (roster_entry_id IS NOT NULL))",
            name="ck_student_consents_provenance",
        ),
        # One live grant per (tenant, candidate, scope). A second active row
        # would make "does consent exist?" depend on row order.
        Index(
            "uq_consent_active",
            "tenant_id",
            "candidate_id",
            "scope",
            unique=True,
            postgresql_where="revoked_at IS NULL",
        ),
        Index("ix_consent_candidate", "candidate_id"),
    )


class ReferralCode(Base, UUIDPrimaryKey, TenantScoped, Timestamps):
    """A credential, not an identifier.

    Non-guessable (60 bits from a CSPRNG, `domain.code_from_bytes`), rate-
    limited on entry, revocable and **always expiring**. The uniqueness
    constraint is global rather than per-tenant so a code can be resolved to
    its college without the student having to say which college they mean.

    `uses` counts students linked by it, moved only by `consume_referral_code`
    under the conditions that make the code live, so `max_uses` holds against
    two students entering the last use at once.
    """

    __tablename__ = "referral_codes"

    code: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    max_uses: Mapped[int | None] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        UniqueConstraint("code", name="uq_referral_code"),
        CheckConstraint(f"length(code) = {CODE_LENGTH}", name="ck_referral_code_length"),
        CheckConstraint("uses >= 0", name="ck_referral_uses_non_negative"),
        CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_referral_max_uses_positive"),
        CheckConstraint("max_uses IS NULL OR uses <= max_uses", name="ck_referral_uses_within_max"),
        Index(
            "ix_referral_codes_live",
            "code",
            postgresql_where="revoked_at IS NULL",
        ),
        Index("ix_referral_codes_tenant_created", "tenant_id", "created_at", "id"),
    )
