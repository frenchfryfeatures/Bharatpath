"""privacy - pure domain logic

Export and deletion requests, DSR tracking.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**This file is the deletion policy, written down.** The client's answer was
*"do full delete for them"*, with one carve-out we raised and they confirmed:
financial and audit records survive,
because statutory retention and PRD rule 9 both outrank a deletion request.
Every table in the schema is named in `ERASURE_PLAN` below with what happens to
it and why, and `tests/invariants/test_erasure_plan.py` fails the build when a
new table is added without that decision being taken. A table nobody classified
is a table that quietly survives an erasure, and nobody finds out until a
regulator asks.

**What is still owed** is the *period*: how long a retained financial or audit
row lives before it too is destroyed. That is counsel's, it has never landed
(blockers B3), and `RETENTION_POLICY_VERSION` says so in a string a test
asserts on. Nothing here guesses it - retained rows are retained indefinitely
until somebody with the authority to say otherwise says otherwise.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Final

# ---------------------------------------------------------------------------
# The request itself
# ---------------------------------------------------------------------------

DSR_TYPES: Final = ("EXPORT", "DELETE")
DSR_STATES: Final = ("RECEIVED", "PROCESSING", "COMPLETED", "REJECTED")

#: The state machine, generated into the database guard by the baseline
#: migration so this table and `guard_dsr_request_write` cannot disagree --
#: the same arrangement the application, payment, interview and roster
#: machines use. RECEIVED may be rejected outright (a business user asking for
#: deletion, today); PROCESSING may fail back to RECEIVED so a retried task is
#: not a dead end. COMPLETED and REJECTED are terminal, and `completed_at` is
#: a latch, so "we deleted your data" can never be un-said.
STATE_TRANSITIONS: Final[Mapping[str, tuple[str, ...]]] = {
    "RECEIVED": ("PROCESSING", "REJECTED"),
    "PROCESSING": ("COMPLETED", "REJECTED", "RECEIVED"),
    "COMPLETED": (),
    "REJECTED": (),
}

#: How long we give ourselves to answer. **Ours, not a statute**: the DPDP Act
#: leaves the period to the rules, which are not notified, so this is a
#: commitment we can keep rather than a number we read somewhere. It is
#: surfaced to the requester (SRS 2.13.2) precisely so it is a promise.
RESPONSE_DAYS: Final = 30

#: A deletion is not instant, and that is deliberate. The window is a
#: cooling-off period in which the candidate can withdraw the request --
#: erasure has no undo, and a person who taps the wrong button at midnight
#: should not lose their CV, their score and their applications by morning.
#: The account stays usable for the duration -- locking it would also lock
#: them out of withdrawing -- and nothing escapes by being written late: the
#: cascade runs in one transaction, over whatever exists when it runs.
DELETION_GRACE_HOURS: Final = 24

#: A presigned URL over an export lives minutes, not days. It is a bearer
#: token for the whole of somebody's personal data: anyone holding the link
#: has it, so the link is worth less the shorter it lives.
EXPORT_URL_TTL_SECONDS: Final = 600

#: And the archive itself is not kept. Long after the requester has downloaded
#: it, a full copy of their data would sit in a bucket earning nothing but
#: risk. The lifecycle rule that enforces this in S3 is owed with the rest of
#: the retention work (blockers B3/E22); until it exists the sweep deletes the
#: object and clears the key.
EXPORT_RETENTION_HOURS: Final = 48

#: Bumped when the dispositions below change. Stored on every completed
#: request, so "what policy was this person erased under?" has an answer years
#: later -- the same reason a score stores `algorithm_version`.
#:
#: **It starts `placeholder-` on purpose.** The dispositions are ours, read off
#: the client's answer and our own reading of the carve-out; the retention
#: *periods* are counsel's and have never arrived. A test asserts the prefix,
#: so the day this becomes the client's policy is a decision somebody takes
#: deliberately, exactly like the placeholder pricing and the consent wording.
RETENTION_POLICY_VERSION: Final = "placeholder-2026-09-17"


class DsrError(StrEnum):
    """Refusal codes. Strings the four client teams render in-language."""

    ALREADY_OPEN = "dsr_request_already_open"
    DELETION_REQUIRES_SUPPORT = "dsr_deletion_requires_support"
    NOT_WITHDRAWABLE = "dsr_request_not_withdrawable"
    NOT_READY = "dsr_export_not_ready"
    EXPIRED = "dsr_export_expired"


def due_at(*, requested_at: datetime, response_days: int = RESPONSE_DAYS) -> datetime:
    """When this request must be answered by.

    Computed from a passed-in clock, never `now()`, so the task that ages a
    request in a test and the route that creates one in production run the
    same arithmetic.
    """
    return requested_at.astimezone(UTC) + timedelta(days=response_days)


def erasable_at(*, requested_at: datetime, grace_hours: int = DELETION_GRACE_HOURS) -> datetime:
    """The first moment a deletion request may actually destroy anything."""
    return requested_at.astimezone(UTC) + timedelta(hours=grace_hours)


def may_transition(*, current: str, target: str) -> bool:
    return target in STATE_TRANSITIONS.get(current, ())


# ---------------------------------------------------------------------------
# The erasure plan
# ---------------------------------------------------------------------------


class Disposition(StrEnum):
    """What an erasure does to one table."""

    #: Rows belonging to the person are deleted outright.
    ERASE = "ERASE"
    #: The row survives with every identifying column cleared. Exactly one
    #: table is in this category -- `users` -- and that is the design: it is
    #: the anchor every retained financial and audit row points at, so
    #: emptying it once pseudonymises all of them at a stroke.
    ANONYMISE = "ANONYMISE"
    #: Kept whole, under the carve-out. Financial records, or the audit trail.
    RETAIN = "RETAIN"
    #: Holds no personal data of a candidate: reference data, an employer's or
    #: a college's own record, or a row whose payload carries ids only.
    NOT_PERSONAL = "NOT_PERSONAL"
    #: Personal, but it removes itself: a TTL column and a sweep already
    #: destroy it without anybody asking.
    SELF_EXPIRING = "SELF_EXPIRING"


@dataclass(frozen=True, slots=True)
class TablePlan:
    """One table's disposition, and the sentence justifying it.

    `link` is the column that ties a row to the person, or None when the
    disposition needs no link (nothing is deleted). It is not used to build
    SQL -- the erasure statements are written out longhand in the migration,
    because a cascade assembled from a table of column names is a cascade
    nobody can read before running it. It is here so the completeness test can
    check that a table claiming to be reachable actually has the column.
    """

    disposition: Disposition
    link: str | None
    why: str


def _erase(link: str, why: str) -> TablePlan:
    return TablePlan(Disposition.ERASE, link, why)


def _retain(why: str, link: str | None = None) -> TablePlan:
    return TablePlan(Disposition.RETAIN, link, why)


def _not_personal(why: str) -> TablePlan:
    return TablePlan(Disposition.NOT_PERSONAL, None, why)


#: **Every table in the schema, classified.** Adding a table without adding it
#: here fails `tests/invariants/test_erasure_plan.py`, which reads the live
#: database rather than this file.
ERASURE_PLAN: Final[Mapping[str, TablePlan]] = {
    # -- the anchor ------------------------------------------------------
    "users": TablePlan(
        Disposition.ANONYMISE,
        "id",
        "Phone and email are cleared, the Cognito subject is replaced by its "
        "SHA-256 so a still-valid token is refused rather than signed up again, "
        "and the row is marked DELETED. The row itself stays because every retained payment and "
        "audit row points at it; emptied, that id identifies nobody, which is "
        "the non-reversible pseudonymisation promised to the client, done "
        "once instead of rewritten across an append-only trail.",
    ),
    # -- the person's own content: erased --------------------------------
    "candidate_profiles": _erase("user_id", "Their name, location and career profile details."),
    "resume_files": _erase("user_id", "The uploaded CV. The S3 object goes with the row."),
    "resume_versions": _erase("user_id", "Parsed CV content, every version in the chain."),
    "scores": _erase(
        "user_id",
        "A score is derived entirely from a CV, and carries the model's "
        "reading of that CV on the row. The app role has no DELETE here "
        "(invariant 3), which is why erasure runs as `erase_candidate`.",
    ),
    "resume_extractions": _erase(
        "cache_key",
        "Content-addressed and shared, so it is deleted only when no other "
        "candidate's score still references the key. It holds no text, but "
        "`extracted_features` is the model's account of a person's career.",
    ),
    "integrity_signals": _erase("candidate_id", "Findings about their CV, quoting it as evidence."),
    "integrity_checks": _erase("candidate_id", "The record that their CV was checked."),
    "device_checks": _erase("user_id", "Their device and network, measured before an interview."),
    "questionnaire_responses": _erase("user_id", "Their answers. Worth no points; still theirs."),
    "user_streaks": _erase("user_id", "When they opened the app."),
    "streak_point_events": _erase("user_id", "The same, itemised."),
    "streak_activity_days": _erase(
        "user_id", "Which days they opened the app, the last year of them."
    ),
    "user_photos": _erase(
        "user_id",
        "Their face (2026-10-09). The object goes first, with the CV and the "
        "recordings, because the key is on this row.",
    ),
    "organisation_logos": _not_personal(
        "An employer's or a college's logo: the organisation's, shown to "
        "candidates on purpose. `updated_by` names a member, as `created_by` "
        "does elsewhere, and is not the row's subject.",
    ),
    "candidate_search_documents": _erase(
        "user_id",
        "The employer-facing projection of them. Written only by a trigger on "
        "`scores`, so deleting the scores is not enough on its own.",
    ),
    "applications": _erase(
        "candidate_id",
        "Their applications, and with them the employer's view of them. Not a "
        "financial record and not the audit trail, so the carve-out does not "
        "reach it -- but it is the one erasure that removes something from a "
        "third party's workspace, and counsel should look at it (blockers B3).",
    ),
    "employer_shortlists": _erase(
        "candidate_id",
        "That an organisation kept them from search, or invited them to a job, and "
        "their answer (2026-10-05). About the person, in a third party's workspace, "
        "like their applications; deleted before the applications an accepted "
        "invitation points at.",
    ),
    "application_events": _erase(
        "application_id",
        "The stage history of an erased application, including an employer's "
        "private notes about the person.",
    ),
    "interview_sessions": _erase("user_id", "A mock interview they sat."),
    "interview_answers": _erase(
        "session_id", "Recordings of their voice. The S3 objects go with the rows."
    ),
    "interview_transcripts": _erase("answer_id", "Their words, transcribed."),
    "interview_session_questions": _erase(
        "session_id",
        "The questions a session put to them, written from their CV and onboarding "
        "answers (2026-09-29), so they describe the person.",
    ),
    "interview_evaluations": _erase("session_id", "Feedback written about them."),
    "interview_checkout_notices": _erase("user_id", "What they were told before paying."),
    "notifications": _erase("user_id", "Messages addressed to them, with what was rendered."),
    "application_messages": _erase(
        "application_id",
        "An employer's messages to them about an application (2026-09-29): invitations "
        "addressed to a person, erased with the application they rode on.",
    ),
    "course_lesson_progress": _erase(
        "user_id", "How far they got through each lesson, and when they watched it."
    ),
    "notification_preferences": _erase("user_id", "Their choices about being contacted."),
    "notification_suppressions": _erase("user_id", "Our decision to stop contacting them."),
    "profile_nudges": _erase("user_id", "Nudges we sent them."),
    "student_consents": _erase(
        "candidate_id",
        "What they agreed to let a college see. Revoking is the student's act "
        "and erasure is the strongest form of it; the seat releases by trigger.",
    ),
    "college_seat_assignments": _erase("candidate_id", "Their seat on a college's plan."),
    "memberships": _erase("user_id", "Their CANDIDATE membership; the account is gone."),
    "entitlements": _erase(
        "user_id",
        "What they could currently use. The payment that granted it is kept; "
        "the access it granted is not a financial record.",
    ),
    "course_completions": _erase(
        "user_id",
        "That they finished the course. An achievement record about a person, "
        "not a receipt -- the purchase beside it is the receipt, and stays. "
        "Score-moving, so the app role holds no DELETE here either.",
    ),
    "disputes": _erase(
        "raised_by",
        "Their complaint, in their words. Flagged with `applications` for "
        "counsel: it is also our record of how we handled a case.",
    ),
    "dsr_requests": _retain(
        "The record that an erasure was requested and carried out, which is "
        "the evidence we complied. It holds no personal data: a user id, two "
        "dates and a policy version.",
        link="user_id",
    ),
    # -- the carve-out: financial ----------------------------------------
    "payments": _retain("Statutory retention on financial records.", link="user_id"),
    "payment_callbacks": _retain("The gateway's own words about a payment. Dispute evidence."),
    "course_purchases": _retain("A receipt.", link="user_id"),
    "interview_purchases": _retain("A receipt.", link="user_id"),
    "subscriptions": _retain(
        "A tenure of paid access, and what was charged for it.", "subscriber_id"
    ),
    "subscription_events": _retain("How that tenure moved. Append-only."),
    "upi_mandates": _retain("A standing authority to debit, and its life.", "registered_by"),
    "mandate_debit_notices": _retain("Proof the payer was told before being debited."),
    "discount_redemptions": _retain(
        "That a code was used on a payment, and what it took off. Part of the "
        "record of what was charged, beside the payment it priced.",
        link="user_id",
    ),
    # -- the carve-out: audit --------------------------------------------
    "audit_events": _retain(
        "PRD rule 9 and invariant 7'. Deleting these destroys the evidence "
        "that every reveal of this person's data was lawful, which harms "
        "their position as much as ours.",
        link="actor_id",
    ),
    "candidate_view_events": _retain(
        "Which employer opened this candidate, and when. Same reason, and it "
        "is the one place that record exists.",
        link="candidate_id",
    ),
    # -- not the candidate's ---------------------------------------------
    "tenants": _not_personal("An organisation."),
    "discount_codes": _not_personal(
        "A code staff created. Names the member of staff who made it, never a payer."
    ),
    "search_filter_options": _not_personal(
        "A skill or a city name staff curate for the search filters. Names the member of "
        "staff who changed it, never a candidate."
    ),
    "tenant_suspensions": _not_personal("Our decision about an organisation, taken by staff."),
    "employers": _not_personal("An organisation's profile."),
    "colleges": _not_personal("An organisation's profile."),
    "college_seats": _not_personal("A block of seats on a college's plan; no student on the row."),
    "jobs": _not_personal("An employer's advertisement."),
    "kyb_submissions": _not_personal("An organisation's verification, submitted by its staff."),
    "kyb_documents": _not_personal("An organisation's documents."),
    "roster_imports": _not_personal("A college's upload, by its staff."),
    "roster_entries": TablePlan(
        Disposition.RETAIN,
        None,
        "A contact a college supplied about its own student. **It carries no "
        "link to an account** -- deliberately, because a college must never "
        "learn who has one (SRS 1.15) -- so finding it would require "
        "exactly the match the design forbids. It is the college's record to "
        "erase, and a request against us cannot reach it. Named for counsel.",
    ),
    "referral_codes": _not_personal("A college's credential; who used it is a consent row."),
    "plans": _not_personal("The catalogue."),
    "courses": _not_personal("The catalogue."),
    "course_modules": _not_personal(
        "The course's sections, built by staff. Names the member of staff who made one."
    ),
    "course_lessons": _not_personal(
        "The course's videos, built by staff. The uploaded file is course material, not a person's."
    ),
    "interview_products": _not_personal("The catalogue."),
    "config_values": _not_personal("Configuration."),
    "outbox": _not_personal("Event payloads carry identifiers only, never names or contacts."),
    "idempotency_keys": TablePlan(
        Disposition.SELF_EXPIRING,
        None,
        "Unused: nothing writes this table (see `app.core.models.IdempotencyKey`). "
        "Classified for the day it is either dropped or used: a stored "
        "response body could quote a name, so rows would have to expire.",
    ),
}

#: Buckets whose objects belong to a candidate, and the table that names each
#: key. Erasing the rows without erasing the objects leaves a CV in S3 with
#: nothing in the database pointing at it -- worse than before, because now
#: nobody knows it is there.
ERASABLE_OBJECT_SOURCES: Final = (
    ("resumes", "resume_files", "s3_key"),
    ("interview_audio", "interview_answers", "s3_key"),
)


def tables_with_disposition(disposition: Disposition) -> tuple[str, ...]:
    return tuple(
        sorted(name for name, plan in ERASURE_PLAN.items() if plan.disposition is disposition)
    )


# ---------------------------------------------------------------------------
# The export
# ---------------------------------------------------------------------------

#: What a subject-access export contains, in the order the archive lists it.
#: Narrower than "everything we hold about you" in one respect, and the
#: difference is deliberate: **the score's breakdown is not in it.** The client
#: settled that the score is never explained to the candidate (R11/Q12), and a
#: breakdown handed over in an export is the explanation, delivered by another
#: door. The value is included; the reasoning is not.
EXPORT_SECTIONS: Final = (
    "account",
    "profile",
    "resumes",
    "scores",
    "applications",
    "subscriptions",
    "purchases",
    "interviews",
    "interview_questions",
    "courses",
    "messages",
    "shortlists",
    "questionnaire",
    "streaks",
    "streak_days",
    "colleges",
    "notifications",
    "requests",
)

#: Fields never written into an export, whatever section they appear in. The
#: first is ours and would tell the holder of a leaked archive how to find the
#: account in Cognito; the rest are other people's.
EXPORT_FORBIDDEN_FIELDS: Final = (
    "cognito_sub",
    "breakdown",
    "raw_model_response",
    "actor_id",
    "notes",
    "employer_notes",
    # Which recruiter wrote a message is the employer's (2026-09-29).
    "sender_id",
)
