"""kyb - business rules and transaction boundaries

Submissions, documents, review state machine.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**The whole of R15 is one switch.** `config_values` key `kyb.require_approval`
(`{"enabled": true|false}`, off when absent). Off: a complete submission is
approved on arrival and marked `auto_approved`. On: it waits at SUBMITTED for a
reviewer. Either way the decision is mirrored onto `employers.kyb_status`, the
column the publish trigger reads, so invariant 8 follows from KYB rather than
being maintained beside it.

**Send back, correct, submit again** (2026-10-10). A reviewer either sends
a submission back (MORE_INFO_REQUIRED: the same submission reopens) or
rejects it (final; the next one is filled in from it, documents included).
Both carry a reason and may point at fields and documents
(`review_flags`). Every decision is a `kyb_reviews` row holding what it was
made on, so the next review shows what changed. A submission waiting for a
reviewer tells our staff (`kyb.submitted`); every decision tells the
organisation's owners (`kyb.reviewed`), the reason included.

**What auto-approval does not do** (`kyb/forms.py`, blocker N4/B7): nobody
reads the answers. The form still earns its place -- the identifiers are
captured in valid formats and the documents are stored -- so switching review
on later is a policy change rather than re-onboarding every employer.
"""

from __future__ import annotations

import dataclasses
import uuid
from datetime import UTC, datetime
from typing import Any, Final

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.audit import AuditAction, audit_event
from app.core.db import clear_transaction_tenant, set_transaction_tenant
from app.core.errors import (
    AppError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.forms import staff_fillable_sections, validate_answers, validate_staff_answers
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.reference import INDIAN_STATES
from app.core.tenant import TenantContext
from app.modules.employer import service as employer_service
from app.modules.employer.reference import active_employer_types, active_industries
from app.modules.kyb import repository
from app.modules.kyb.domain import (
    ACCEPTED_DOCUMENT_TYPES,
    DECISIONS_WITH_FLAGS,
    EDITABLE_STATES,
    MAX_DOCUMENT_BYTES,
    REVIEW_DECISIONS,
    changes_since,
    document_key,
    flag_refusal,
    reason_required,
    refuse_transition,
    sniff_document,
    state_on_submit,
)
from app.modules.kyb.events import APPROVED, REVIEWED, SUBMITTED
from app.modules.kyb.forms import EMPLOYEE_COUNT_BANDS, FORM_VERSION, KYB_FORM
from app.modules.kyb.schemas import (
    DocumentTicketResponse,
    KybChanges,
    KybDocumentResponse,
    KybFormResponse,
    KybOption,
    KybReviewEntry,
    KybReviewFlag,
    KybSubmissionResponse,
)
from app.settings import get_settings

logger = get_logger(__name__)

REQUIRE_APPROVAL_CONFIG_KEY: Final = "kyb.require_approval"

#: Allowed codes for every `options_source` the KYB form names. A test fails
#: the build if the form names a source that is not here, because validating a
#: select against a missing source would accept anything.
KYB_OPTIONS: Final[dict[str, frozenset[str]]] = {
    "employer.EMPLOYER_TYPES": frozenset(t.code for t in active_employer_types()),
    "employer.INDUSTRIES": frozenset(t.code for t in active_industries()),
    "kyb.EMPLOYEE_COUNT_BANDS": frozenset(code for code, _ in EMPLOYEE_COUNT_BANDS),
    "reference.INDIAN_STATES": frozenset(r.code for r in INDIAN_STATES),
}

DOCUMENT_TYPES: Final[frozenset[str]] = frozenset(
    f.code for f in KYB_FORM.fields if f.type == "FILE"
)
#: What a reviewer may flag: any field of the form, documents included.
FLAGGABLE_FIELDS: Final[frozenset[str]] = frozenset(f.code for f in KYB_FORM.fields)


# ---------------------------------------------------------------------------
# Errors. Codes, never sentences: every client renders its own language.
# ---------------------------------------------------------------------------
class KybAnswersInvalidError(ValidationError):
    """Every problem at once, by field and code, so a form can mark them all
    rather than failing one field per round trip."""

    code = "kyb_answers_invalid"
    title = "Some answers need attention"


class KybNotEditableError(ConflictError):
    code = "kyb_not_editable"
    title = "This submission can no longer be changed"


class KybTransitionError(ConflictError):
    code = "kyb_invalid_transition"
    title = "That change is not allowed for this submission"


class KybAlreadyVerifiedError(ConflictError):
    """An approved organisation does not start a new submission. Doing so with
    review switched on would un-verify it and take its jobs off the board."""

    code = "kyb_already_verified"
    title = "This organisation is already verified"


class KybSubmissionNotFoundError(NotFoundError):
    code = "kyb_submission_not_found"
    title = "KYB submission not found"


class KybUploadNotFoundError(NotFoundError):
    code = "kyb_upload_not_found"
    title = "Upload not found"


class KybDocumentRejectedError(ValidationError):
    code = "kyb_document_rejected"
    title = "This document could not be accepted"


class KybUnknownDocumentTypeError(ValidationError):
    code = "kyb_unknown_document_type"
    title = "Unknown document type"


class KybReasonRequiredError(ValidationError):
    code = "kyb_reason_required"
    title = "A reason is required for this decision"


class KybFlagsInvalidError(ValidationError):
    """`code` says which: `kyb_flags_not_allowed` (an approval has nothing to
    correct), `kyb_flag_unknown_field`, `kyb_flag_duplicate`;
    `params.fields` names them."""

    code = "kyb_flags_invalid"
    title = "These flags cannot be recorded"


class KybConfigError(AppError):
    """The approval switch is misconfigured. Refused rather than guessed:
    guessing "off" approves employers nobody meant to approve."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "kyb_config_invalid"
    title = "KYB approval setting is misconfigured"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _bind(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)
    return ctx.tenant_id


async def require_approval(session: AsyncSession, *, now: datetime) -> bool:
    """R15's switch. Off unless a row says otherwise."""
    row = await repository.current_config(session, key=REQUIRE_APPROVAL_CONFIG_KEY, now=now)
    if row is None:
        return False
    value = row.value
    if (
        not isinstance(value, dict)
        or set(value) != {"enabled"}
        or not isinstance(value["enabled"], bool)
    ):
        raise KybConfigError(params={"expected": '{"enabled": true|false}'})
    return value["enabled"]


async def set_require_approval(
    session: AsyncSession,
    *,
    enabled: bool,
    actor_id: uuid.UUID,
    actor_role: str,
    request_id: str | None = None,
    now: datetime | None = None,
) -> bool:
    """Flip R15's switch: a new version of the row, never an update, and an
    audit row. Routed only by the admin console (2026-10-09, client).

    **It decides the next submission and nothing before it.** Switching to
    automatic does not approve what is already waiting at SUBMITTED or
    UNDER_REVIEW -- a reviewer still decides those -- and switching to manual
    does not reopen anyone already approved. Either would be a verification
    decision nobody made about that employer.

    Asking for the mode already in force writes nothing. A malformed current
    row is replaced rather than refused: this is how it gets fixed.
    """
    now = now or datetime.now(UTC)
    row = await repository.current_config(session, key=REQUIRE_APPROVAL_CONFIG_KEY, now=now)
    if row is not None and row.value == {"enabled": enabled}:
        return enabled
    version = await repository.append_config(
        session,
        key=REQUIRE_APPROVAL_CONFIG_KEY,
        value={"enabled": enabled},
        effective_from=now,
        note=f"Set from the admin console by {actor_role}.",
    )
    await audit_event(
        session,
        action=AuditAction.KYB_APPROVAL_MODE_CHANGED,
        actor_id=actor_id,
        actor_role=actor_role,
        target_type="config_value",
        request_id=request_id,
        metadata={"key": REQUIRE_APPROVAL_CONFIG_KEY, "enabled": enabled, "version": version},
    )
    logger.info("kyb_approval_mode_changed", enabled=enabled, version=version)
    return enabled


async def _latest_documents(session: AsyncSession, submission_id: uuid.UUID) -> dict[str, Any]:
    """`doc_type -> the latest upload of it`."""
    latest: dict[str, Any] = {}
    for doc in await repository.documents(session, submission_id=submission_id):
        latest[doc.doc_type] = doc  # ordered by upload time, so the last one wins
    return latest


async def _document_url(key: str) -> str:
    settings = get_settings()
    return await storage.presign_get(
        bucket=settings.s3_bucket_kyb_documents,
        key=key,
        expires_in=settings.presigned_url_ttl_seconds,
    )


def _flags(raw: Any) -> list[KybReviewFlag]:
    return [KybReviewFlag.model_validate(flag) for flag in (raw or [])]


async def _response(session: AsyncSession, submission: Any | None) -> KybSubmissionResponse:
    if submission is None:
        return KybSubmissionResponse(state="DRAFT")
    latest = await _latest_documents(session, submission.id)
    history = await repository.reviews(session, submission_id=submission.id)
    changed = None
    if history:
        fields, documents = changes_since(
            reviewed_answers=dict(history[-1].answers or {}),
            answers=dict(submission.answers or {}),
            reviewed_documents=dict(history[-1].documents or {}),
            documents={doc_type: str(doc.id) for doc_type, doc in latest.items()},
        )
        changed = KybChanges(fields=fields, documents=documents)
    return KybSubmissionResponse(
        submission_id=submission.id,
        state=submission.state,
        form_version=submission.form_version,
        answers=dict(submission.answers or {}),
        documents=[
            KybDocumentResponse(
                doc_type=d.doc_type,
                mime=d.mime,
                uploaded_at=d.uploaded_at,
                url=await _document_url(d.s3_key),
            )
            for d in latest.values()
        ],
        submitted_at=submission.submitted_at,
        reviewed_at=submission.reviewed_at,
        decision_reason=submission.decision_reason,
        auto_approved=submission.auto_approved,
        review_flags=_flags(submission.review_flags),
        reviews=[
            KybReviewEntry(
                decision=r.decision,
                reason=r.reason,
                flags=_flags(r.flags),
                reviewed_at=r.reviewed_at,
            )
            for r in history
        ],
        changed_since_last_review=changed,
        previous_submission_id=submission.previous_submission_id,
    )


async def _open_or_new_draft(session: AsyncSession, tenant_id: uuid.UUID) -> Any:
    existing = await repository.open_submission(session, tenant_id=tenant_id)
    if existing is not None:
        return existing
    latest = await repository.latest_submission(session, tenant_id=tenant_id)
    if latest is not None and latest.state == "APPROVED":
        raise KybAlreadyVerifiedError()
    if latest is None or latest.state != "REJECTED":
        return await repository.create_draft(
            session, tenant_id=tenant_id, form_version=FORM_VERSION
        )
    # Starting again after a rejection: the new submission is filled in from
    # the rejected one, answers and documents both, so correcting it is an
    # edit rather than a retyping. Its documents are copied only once -- a
    # draft that won a race already has them.
    draft = await repository.create_draft(
        session,
        tenant_id=tenant_id,
        form_version=FORM_VERSION,
        answers=dict(latest.answers or {}),
        previous_submission_id=latest.id,
    )
    if draft.previous_submission_id == latest.id and not await repository.documents(
        session, submission_id=draft.id
    ):
        previous = await _latest_documents(session, latest.id)
        await repository.copy_documents(session, documents=list(previous.values()), to=draft)
    return draft


def _issues(issues: tuple[Any, ...]) -> KybAnswersInvalidError:
    return KybAnswersInvalidError(
        params={"issues": [{"field": i.field, "code": i.code} for i in issues]}
    )


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------
def form_definition(*, staff: bool = False) -> KybFormResponse:
    """The whole form, or with `staff` the part our staff may fill in for an
    employer (`app.core.forms.staff_fillable_sections`)."""
    sections = staff_fillable_sections(KYB_FORM) if staff else KYB_FORM.sections
    return KybFormResponse(
        code=KYB_FORM.code,
        version=KYB_FORM.version,
        sections=[dataclasses.asdict(section) for section in sections],
        options={
            "employer.EMPLOYER_TYPES": [
                KybOption(code=t.code, label=t.label) for t in active_employer_types()
            ],
            "employer.INDUSTRIES": [
                KybOption(code=t.code, label=t.label) for t in active_industries()
            ],
            "kyb.EMPLOYEE_COUNT_BANDS": [
                KybOption(code=c, label=label) for c, label in EMPLOYEE_COUNT_BANDS
            ],
            "reference.INDIAN_STATES": [
                KybOption(code=r.code, label=r.name) for r in INDIAN_STATES
            ],
        },
    )


# ---------------------------------------------------------------------------
# The submission
# ---------------------------------------------------------------------------
async def current_submission(session: AsyncSession, *, ctx: TenantContext) -> KybSubmissionResponse:
    tenant_id = await _bind(session, ctx)
    submission = await repository.open_submission(session, tenant_id=tenant_id)
    if submission is None:
        submission = await repository.latest_submission(session, tenant_id=tenant_id)
    return await _response(session, submission)


async def save_answers(
    session: AsyncSession, *, ctx: TenantContext, answers: dict[str, Any]
) -> KybSubmissionResponse:
    """A partial save. Format is checked now; completeness at submission."""
    tenant_id = await _bind(session, ctx)
    issues = validate_answers(KYB_FORM, answers, options=KYB_OPTIONS, complete=False)
    if issues:
        raise _issues(issues)

    submission = await _open_or_new_draft(session, tenant_id)
    if submission.state not in EDITABLE_STATES:
        raise KybNotEditableError(params={"state": submission.state})

    merged = {**(submission.answers or {}), **answers}
    merged = {code: value for code, value in merged.items() if value is not None}
    await repository.set_answers(
        session, submission=submission, answers=merged, form_version=FORM_VERSION
    )
    return await _response(session, submission)


async def prefill_draft(
    session: AsyncSession, *, tenant_id: uuid.UUID, answers: dict[str, Any]
) -> None:
    """Staff fill an organisation's KYB in for it, in the transaction that
    created the organisation (2026-10-03). The owner finds the draft already
    filled at first sign-in, ticks the undertakings, uploads the documents and
    submits -- none of which staff can do (`validate_staff_answers`).

    `tenant_id` is the organisation this transaction just created, never one
    from a request, which is why binding it here is safe. A brand-new
    organisation has no submission, so this is always a new DRAFT.
    """
    issues = validate_staff_answers(KYB_FORM, answers, options=KYB_OPTIONS)
    if issues:
        raise _issues(issues)
    answers = {code: value for code, value in answers.items() if value is not None}
    if not answers:
        return
    await set_transaction_tenant(session, tenant_id)
    submission = await _open_or_new_draft(session, tenant_id)
    if submission.state != "DRAFT":  # pragma: no cover - a new organisation
        raise KybNotEditableError(params={"state": submission.state})
    await repository.set_answers(
        session, submission=submission, answers=answers, form_version=FORM_VERSION
    )


async def issue_document_ticket(
    session: AsyncSession, *, ctx: TenantContext, doc_type: str
) -> DocumentTicketResponse:
    if doc_type not in DOCUMENT_TYPES:
        raise KybUnknownDocumentTypeError(params={"doc_type": doc_type})
    tenant_id = await _bind(session, ctx)
    submission = await _open_or_new_draft(session, tenant_id)
    if submission.state not in EDITABLE_STATES:
        raise KybNotEditableError(params={"state": submission.state})

    settings = get_settings()
    upload_id = uuid.uuid4()
    key = document_key(
        tenant_id=tenant_id, submission_id=submission.id, doc_type=doc_type, upload_id=upload_id
    )
    url = await storage.presign_put(
        bucket=settings.s3_bucket_kyb_documents,
        key=key,
        expires_in=settings.presigned_url_ttl_seconds,
    )
    return DocumentTicketResponse(
        upload_id=upload_id,
        doc_type=doc_type,
        url=url,
        expires_in_seconds=settings.presigned_url_ttl_seconds,
        max_bytes=MAX_DOCUMENT_BYTES,
        accepted_types=list(ACCEPTED_DOCUMENT_TYPES),
    )


async def complete_document(
    session: AsyncSession, *, ctx: TenantContext, upload_id: uuid.UUID, doc_type: str
) -> KybSubmissionResponse:
    """Check what was actually stored, then attach it.

    The key is rebuilt from the caller's organisation and open submission, the
    size read from S3, and the type sniffed from the bytes -- the same rules as
    CV intake, for the same reasons. A rejected object is deleted: a file we
    refused is storage we pay for and personal data we have no reason to hold.
    """
    if doc_type not in DOCUMENT_TYPES:
        raise KybUnknownDocumentTypeError(params={"doc_type": doc_type})
    tenant_id = await _bind(session, ctx)
    submission = await repository.open_submission(session, tenant_id=tenant_id)
    if submission is None:
        raise KybUploadNotFoundError()
    if submission.state not in EDITABLE_STATES:
        raise KybNotEditableError(params={"state": submission.state})

    settings = get_settings()
    bucket = settings.s3_bucket_kyb_documents
    key = document_key(
        tenant_id=tenant_id, submission_id=submission.id, doc_type=doc_type, upload_id=upload_id
    )

    if await repository.document_by_key(session, s3_key=key) is not None:
        return await _response(session, submission)  # completing twice is a retry

    meta = await storage.head_object(bucket=bucket, key=key)
    if meta is None:
        raise KybUploadNotFoundError()

    size = int(meta["size_bytes"])
    mime = sniff_document(await storage.read_head_bytes(bucket=bucket, key=key, count=16))
    reason = (
        "empty"
        if size <= 0
        else "too_large"
        if size > MAX_DOCUMENT_BYTES
        else "unsupported_type"
        if mime is None
        else None
    )
    if reason is not None or mime is None:
        await storage.delete_object(bucket=bucket, key=key)
        raise KybDocumentRejectedError(params={"reason": reason or "unsupported_type"})

    await repository.add_document(
        session,
        tenant_id=tenant_id,
        submission_id=submission.id,
        doc_type=doc_type,
        s3_key=key,
        mime=mime,
        uploaded_at=datetime.now(UTC),
    )
    return await _response(session, submission)


async def submit(session: AsyncSession, *, ctx: TenantContext) -> KybSubmissionResponse:
    """Validate everything, then approve or queue -- by the switch."""
    tenant_id = await _bind(session, ctx)
    submission = await repository.open_submission(session, tenant_id=tenant_id)
    answers = dict(submission.answers or {}) if submission is not None else {}
    uploaded = (
        frozenset(
            d.doc_type for d in await repository.documents(session, submission_id=submission.id)
        )
        if submission is not None
        else frozenset()
    )
    issues = validate_answers(
        KYB_FORM, answers, options=KYB_OPTIONS, uploaded=uploaded, complete=True
    )
    if issues:
        raise _issues(issues)
    assert submission is not None  # validation cannot pass with no documents

    now = datetime.now(UTC)
    target = state_on_submit(require_approval=await require_approval(session, now=now))
    if refuse_transition(submission.state, target) is not None:
        raise KybTransitionError(params={"from": submission.state, "to": target})

    approved = target == "APPROVED"
    resubmitted = submission.state == "MORE_INFO_REQUIRED" or (
        submission.previous_submission_id is not None
    )
    await repository.set_state(
        session,
        submission=submission,
        state=target,
        submitted_at=now,
        reviewed_at=now if approved else None,
        auto_approved=approved,
        decision_reason=None,
        review_flags=[],
    )
    await employer_service.set_kyb_status(
        session, tenant_id=tenant_id, status=target, verified_at=now if approved else None
    )

    if approved:
        await audit_event(
            session,
            action=AuditAction.KYB_DECISION_RECORDED,
            actor_id=ctx.user_id,
            actor_role=ctx.role,
            target_type="kyb_submission",
            target_id=submission.id,
            tenant_id=tenant_id,
            metadata={"decision": "APPROVED", "auto_approved": True},
        )
    await emit(
        session,
        event_type=APPROVED if approved else SUBMITTED,
        aggregate_type="kyb_submission",
        aggregate_id=submission.id,
        payload={
            "tenant_id": str(tenant_id),
            "auto_approved": approved,
            "resubmission": resubmitted,
        },
    )
    logger.info("kyb_submitted", tenant_id=str(tenant_id), state=target)
    return await _response(session, submission)


async def submission_for_review(
    session: AsyncSession, *, tenant_id: uuid.UUID, submission_id: uuid.UUID
) -> KybSubmissionResponse:
    """One submission, answers and documents included, for a reviewer.

    Like `review`, takes the tenant explicitly: the console found it from the
    submission, and a reviewer belongs to no employer. The caller audits the
    read -- the answers carry the PAN and the signatory's details.
    """
    await set_transaction_tenant(session, tenant_id)
    submission = await repository.get_submission(
        session, tenant_id=tenant_id, submission_id=submission_id
    )
    if submission is None:
        raise KybSubmissionNotFoundError()
    return await _response(session, submission)


async def review(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    submission_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    reviewer_role: str,
    decision: str,
    reason: str | None = None,
    flags: list[KybReviewFlag] | None = None,
) -> KybSubmissionResponse:
    """A human decision, used when the switch is on. Routed by the admin
    console: `POST /admin/kyb/submissions/{id}/decision`.

    Takes the tenant id explicitly because a reviewer belongs to no employer:
    the console reads it from the submission, never from a request body.
    """
    if decision not in REVIEW_DECISIONS | {"UNDER_REVIEW"}:
        raise KybTransitionError(params={"to": decision})
    if reason_required(decision) and (reason is None or not reason.strip()):
        raise KybReasonRequiredError(params={"decision": decision})
    flags = flags or []
    refused = flag_refusal(
        decision=decision, flagged=[f.field for f in flags], known_fields=FLAGGABLE_FIELDS
    )
    if refused is not None:
        code, fields = refused
        raise KybFlagsInvalidError(code=code, params={"fields": fields})
    stored_flags = [f.model_dump() for f in flags]

    await set_transaction_tenant(session, tenant_id)
    submission = await repository.get_submission(
        session, tenant_id=tenant_id, submission_id=submission_id
    )
    if submission is None:
        raise KybSubmissionNotFoundError()
    if refuse_transition(submission.state, decision) is not None:
        raise KybTransitionError(params={"from": submission.state, "to": decision})

    now = datetime.now(UTC)
    reason = reason.strip() if reason else None
    latest = await _latest_documents(session, submission.id)
    await repository.add_review(
        session,
        tenant_id=tenant_id,
        submission_id=submission.id,
        decision=decision,
        reason=reason,
        flags=stored_flags,
        reviewed_by=reviewer_id,
        reviewed_at=now,
        answers=dict(submission.answers or {}),
        documents={doc_type: str(doc.id) for doc_type, doc in latest.items()},
    )
    await repository.set_state(
        session,
        submission=submission,
        state=decision,
        reviewed_by=reviewer_id,
        reviewed_at=now,
        decision_reason=reason,
        auto_approved=False,
        review_flags=stored_flags if decision in DECISIONS_WITH_FLAGS else [],
    )
    await employer_service.set_kyb_status(
        session,
        tenant_id=tenant_id,
        status=decision,
        verified_at=now if decision == "APPROVED" else None,
    )
    await audit_event(
        session,
        action=AuditAction.KYB_DECISION_RECORDED,
        actor_id=reviewer_id,
        actor_role=reviewer_role,
        target_type="kyb_submission",
        target_id=submission.id,
        tenant_id=tenant_id,
        metadata={"decision": decision, "auto_approved": False, "flags": len(stored_flags)},
    )
    await emit(
        session,
        event_type=REVIEWED,
        aggregate_type="kyb_submission",
        aggregate_id=submission.id,
        payload={
            "tenant_id": str(tenant_id),
            "submission_id": str(submission.id),
            "decision": decision,
        },
    )
    return await _response(session, submission)


async def decision_reason_for_delivery(
    session: AsyncSession, *, tenant_id: uuid.UUID, submission_id: uuid.UUID
) -> str | None:
    """The reviewer's words, for the notification that tells the
    organisation. Read at dispatch, so the outbox payload carries ids only.

    Binds the event's tenant to read under RLS, and unbinds it before
    returning: the notification task goes on to read other rows in the same
    transaction, and a tenant left bound would hide them.
    """
    await set_transaction_tenant(session, tenant_id)
    try:
        submission = await repository.get_submission(
            session, tenant_id=tenant_id, submission_id=submission_id
        )
        return submission.decision_reason if submission is not None else None
    finally:
        await clear_transaction_tenant(session)
