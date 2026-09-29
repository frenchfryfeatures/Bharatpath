"""The audit trail. `audit_event()` is the ONLY way to write an audit row.

PRD rule 9 and SRS 2.24.5. Three properties, each enforced somewhere other than
developer memory:

  * **Append-only.** The application DB role is granted INSERT and SELECT on
    `audit_events` and has UPDATE and DELETE revoked. See the Alembic baseline.
  * **In-transaction.** The audit write happens inside the same transaction as
    the reveal it records. If the audit write fails, the reveal rolls back.
    That is the entire point - do not make this async, do not move it to the
    outbox, do not "optimise" it later.
  * **Archived.** Nightly to S3 with Object Lock in compliance mode. (Do not
    reach for QLDB - AWS deprecated it.)

**Invariant 7-prime, new in v6.** Blanket employer access (R14) destroyed the
natural one-row-per-unlock trail, but PRD rule 9 did not stop applying. So the
audit moved to the read: every candidate profile an employer opens writes a row
here. `candidate_view_events` is partitioned by month because it will be the
fastest-growing table in the schema.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)


class AuditAction(StrEnum):
    """Every action that reveals private data or exercises privilege.

    Add to this enum rather than passing a free string, so the admin audit
    search (SRS 2.25.4: searchable by actor, action, target, time) has a
    closed set to filter on.
    """

    # Candidate PII reveals - invariant 7'
    CANDIDATE_PROFILE_VIEWED = "candidate_profile_viewed"
    CANDIDATE_CONTACT_REVEALED = "candidate_contact_revealed"
    CANDIDATE_SEARCH_PERFORMED = "candidate_search_performed"
    #: An organisation's views crossed a velocity or cap threshold (Day 14).
    #: The admin console reads these by action; nobody can hold a platform
    #: role to read them yet (blockers E10).
    CANDIDATE_VIEW_ANOMALY_FLAGGED = "candidate_view_anomaly_flagged"

    # Admin privilege - SRS 2.24.5, every drill-down
    ADMIN_CANDIDATE_DRILLDOWN = "admin_candidate_drilldown"
    ADMIN_EMPLOYER_DRILLDOWN = "admin_employer_drilldown"
    ADMIN_COLLEGE_DRILLDOWN = "admin_college_drilldown"
    ADMIN_BYPASS_SESSION_OPENED = "admin_bypass_session_opened"
    #: A KYB submission's answers opened by a reviewer (Day 19).
    ADMIN_KYB_SUBMISSION_OPENED = "admin_kyb_submission_opened"
    #: A signal's evidence opened (Day 19). Evidence can quote the CV.
    ADMIN_INTEGRITY_SIGNAL_OPENED = "admin_integrity_signal_opened"
    #: A dispute opened in the console: its description is the raiser's words.
    ADMIN_DISPUTE_OPENED = "admin_dispute_opened"
    #: Who read the audit trail is part of the audit trail.
    ADMIN_AUDIT_LOG_SEARCHED = "admin_audit_log_searched"
    DISPUTE_ASSIGNED = "dispute_assigned"
    DISPUTE_RESOLVED = "dispute_resolved"

    # Score-moving writes - invariant 3's blast radius.
    # Now that add-ons move the score (R1), writing a completion row moves a
    # score, so these are audited like a reveal.
    COURSE_COMPLETION_RECORDED = "course_completion_recorded"
    INTERVIEW_COMPLETION_RECORDED = "interview_completion_recorded"
    SCORE_RECOMPUTED = "score_recomputed"

    # Trust and verification
    KYB_DECISION_RECORDED = "kyb_decision_recorded"
    INTEGRITY_FLAG_RESOLVED = "integrity_flag_resolved"
    TENANT_SUSPENDED = "tenant_suspended"
    TENANT_REINSTATED = "tenant_reinstated"

    # Tenancy and team. Who can see candidate data is itself privileged
    # information, and "who gave this recruiter access, and when?" is the
    # first question after a leak.
    ORGANISATION_CREATED = "organisation_created"
    TEAM_MEMBER_ADDED = "team_member_added"
    TEAM_MEMBER_ROLE_CHANGED = "team_member_role_changed"
    TEAM_MEMBER_REMOVED = "team_member_removed"
    #: Staff created an account on someone's behalf (2026-09-18): a
    #: candidate, or an organisation with its first owner. Metadata holds the
    #: kind and ids, never the address the invitation went to.
    ACCOUNT_PROVISIONED = "account_provisioned"
    #: Staff sent a provisioned account's invitation again.
    ACCOUNT_INVITATION_RESENT = "account_invitation_resent"

    # Discount codes (2026-09-18). A code is money off; making one and
    # switching one off are privileged acts on the price of the product.
    DISCOUNT_CODE_CREATED = "discount_code_created"
    DISCOUNT_CODE_DISABLED = "discount_code_disabled"

    # Search filter options (2026-09-24). What employers are offered to
    # filter by; not private, but a change to it changes every search, so
    # staff's edits are on the record. Metadata holds the kind and the
    # fields that moved.
    SEARCH_FILTER_OPTION_CREATED = "search_filter_option_created"
    SEARCH_FILTER_OPTION_UPDATED = "search_filter_option_updated"

    # Course content (2026-09-29). A lesson counts toward a score once
    # watched, so what is in the course, and when it went on sale, is on the
    # record. Metadata names the object and the fields that moved.
    COURSE_CONTENT_CHANGED = "course_content_changed"

    # The console's full candidate page (2026-09-29): the CV itself and the
    # candidate's own voice, both asked for by the client. Each is its own
    # row, apart from the drill-down, because each is a larger reveal.
    ADMIN_CANDIDATE_RESUME_OPENED = "admin_candidate_resume_opened"
    ADMIN_INTERVIEW_RECORDINGS_OPENED = "admin_interview_recordings_opened"

    # A college opening a student's CV under INDIVIDUAL consent (2026-09-29).
    COLLEGE_STUDENT_RESUME_OPENED = "college_student_resume_opened"

    # An employer writing to an applicant through the platform (2026-09-29).
    # Metadata holds the kind and ids, never the words.
    APPLICATION_MESSAGE_SENT = "application_message_sent"

    # Colleges (Day 17). A seat is a student's paid access, and a referral
    # code is a credential that attaches students to a roster: issuing,
    # revoking and allocating are all privileged.
    COLLEGE_SEATS_ALLOCATED = "college_seats_allocated"
    REFERRAL_CODE_ISSUED = "referral_code_issued"
    REFERRAL_CODE_REVOKED = "referral_code_revoked"
    ROSTER_IMPORT_COMMITTED = "roster_import_committed"
    ROSTER_INVITATIONS_SENT = "roster_invitations_sent"

    # Consent - PRD rule 8
    CONSENT_GRANTED = "consent_granted"
    CONSENT_REVOKED = "consent_revoked"
    #: One consenting student's details opened by college staff (Day 18).
    COLLEGE_STUDENT_VIEWED = "college_student_viewed"
    #: The list of students who let their college see them was read. It
    #: names people, so it is a reveal too; metadata holds the ids shown.
    COLLEGE_STUDENTS_LISTED = "college_students_listed"

    # Notifications (Day 19). Stopping messages to a person is our decision
    # about them, so it is recorded like one.
    NOTIFICATIONS_SUPPRESSED = "notifications_suppressed"

    # Privacy
    DSR_EXPORT_REQUESTED = "dsr_export_requested"
    DSR_DELETION_REQUESTED = "dsr_deletion_requested"
    #: A download link to an export was minted (Day 20). The link is a bearer
    #: token for a whole person's record, so handing one out is a reveal.
    DSR_EXPORT_DOWNLOADED = "dsr_export_downloaded"
    DSR_COMPLETED = "dsr_completed"


async def audit_event(
    session: AsyncSession,
    *,
    action: AuditAction,
    actor_id: UUID | None,
    actor_role: str,
    target_type: str,
    target_id: UUID | str | None = None,
    tenant_id: UUID | None = None,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Write one audit row on the caller's session and transaction.

    Takes the *caller's* session on purpose. Opening a new session here would
    put the audit write in its own transaction, which would let a reveal commit
    while its audit row rolled back - exactly the failure this table exists to
    make impossible.

    `metadata` must not carry PII. Store identifiers and let the drill-down
    resolve them; a `metadata` blob full of phone numbers is an audit table
    that is itself a privacy problem.
    """
    from app.core.models import AuditEvent  # local import: avoids a cycle

    await session.execute(
        insert(AuditEvent).values(
            action=action.value,
            actor_id=actor_id,
            actor_role=actor_role,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            tenant_id=tenant_id,
            request_id=request_id,
            event_metadata=metadata or {},
        )
    )
    logger.info(
        "audit_event",
        action=action.value,
        actor_role=actor_role,
        target_type=target_type,
        tenant_id=str(tenant_id) if tenant_id else None,
    )
