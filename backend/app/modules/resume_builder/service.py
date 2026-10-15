"""resume_builder - business rules and transaction boundaries

The "generate a resume" path of onboarding (2026-10-13). After the onboarding
questions and before payment, a candidate either uploads a CV or builds one
here: picks one of four templates, edits a draft filled in from their
answers, and downloads it or makes it their resume ("push").

**No model is called here.** The first draft is the candidate's own CV as
the review screen shows it -- the structured view written when it was read
-- with the onboarding answers in its gaps, or the answers alone for someone
with no CV read (`domain.prefill`). The templates print what is in the draft.

**Nothing here scores.** A push creates an unconfirmed `BUILDER` resume
version, exactly as an upload creates an unconfirmed `UPLOAD` one, and the
confirm gate (`POST /candidate/resume/versions/{id}/confirm`, paid) is what
starts scoring. The version carries the rendered PDF as its file, so an
employer who opens the candidate receives the document the candidate saw.

Nothing here is paywalled: it happens before payment, by design.
"""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError, PermissionDeniedError, ValidationError
from app.core.ratelimit import enforce
from app.core.tenant import TenantContext
from app.modules.candidate import career_service
from app.modules.candidate import service as candidate_service
from app.modules.identity import service as identity_service
from app.modules.resume import service as resume_service
from app.modules.resume.structuring import StructuredResume, structured_view
from app.modules.resume_builder import domain, rendering, repository
from app.modules.resume_builder.models import ResumeBuilderDraft
from app.modules.resume_builder.schemas import (
    DraftRequest,
    DraftResponse,
    PreviewRequest,
    PreviewResponse,
    PushResponse,
    TemplateInfo,
    TemplatesResponse,
)


class DraftMissingError(NotFoundError):
    code = "resume_builder_draft_missing"
    title = "Save the resume before downloading or using it"


class DraftTooLongError(ValidationError):
    code = "resume_builder_too_long"
    title = "This resume is longer than a resume can be"


class PersonalDetailError(ValidationError):
    code = "resume_builder_personal_detail"
    title = "Date of birth, age, gender, marital status and family details are not shown"


class InvalidDateError(ValidationError):
    code = "resume_builder_invalid_date"
    title = "Dates are a year (2024) or a year and month (2024-03)"


class DraftIncompleteError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "resume_builder_incomplete"
    title = "Add your name and at least one job, qualification or skill"


def _candidate(ctx: TenantContext) -> None:
    if ctx.tenant_id is not None or ctx.role != "CANDIDATE":
        raise PermissionDeniedError()


def templates() -> TemplatesResponse:
    return TemplatesResponse(
        templates=[
            TemplateInfo.model_validate(
                {"key": t.key, "name": t.name, "description": t.description, "columns": t.columns}
            )
            for t in domain.TEMPLATES
        ],
        default=domain.DEFAULT_TEMPLATE,
        version=domain.TEMPLATES_VERSION,
    )


# ---------------------------------------------------------------------------
# The draft
# ---------------------------------------------------------------------------
async def get_draft(session: AsyncSession, *, ctx: TenantContext) -> DraftResponse:
    """The stored draft, or a first one filled in from the onboarding answers
    and not yet stored. Reading never writes."""
    _candidate(ctx)
    row = await repository.get_draft(session, user_id=ctx.user_id)
    if row is None:
        return DraftResponse(
            template_key=domain.DEFAULT_TEMPLATE,
            content=await _prefilled(session, ctx),
            saved=False,
        )
    return _response(row)


async def save_draft(
    session: AsyncSession, *, ctx: TenantContext, payload: DraftRequest
) -> DraftResponse:
    _candidate(ctx)
    content = _checked(payload.content)
    row = await repository.save_draft(
        session, user_id=ctx.user_id, template_key=payload.template_key, content=content
    )
    return _response(row)


async def reset_draft(session: AsyncSession, *, ctx: TenantContext) -> DraftResponse:
    """Start again from the onboarding answers, keeping the template. The
    editor's "fill in from my profile" button: edits to the draft never write
    back to the profile, so this is how a changed profile reaches it."""
    _candidate(ctx)
    current = await repository.get_draft(session, user_id=ctx.user_id)
    template_key = current.template_key if current is not None else domain.DEFAULT_TEMPLATE
    content = _checked(await _prefilled(session, ctx))
    row = await repository.save_draft(
        session, user_id=ctx.user_id, template_key=template_key, content=content
    )
    return _response(row)


# ---------------------------------------------------------------------------
# Drawing it
# ---------------------------------------------------------------------------
async def preview(*, ctx: TenantContext, payload: PreviewRequest) -> PreviewResponse:
    """The editor's right-hand pane: the content as sent, saved or not.
    Touches no row."""
    _candidate(ctx)
    await enforce("resume_builder.preview", subject=str(ctx.user_id))
    content = _checked(payload.content)
    pages, count = await rendering.preview(
        payload.template_key, domain.template_view(content), fmt=payload.format
    )
    mime = "image/png" if payload.format == "png" else "image/svg+xml"
    return PreviewResponse(pages=pages, mime=mime, page_count=count)


async def download(session: AsyncSession, *, ctx: TenantContext) -> tuple[bytes, str]:
    """The saved draft as a PDF, and a filename for it. **Every download is
    counted**: the console's follow-up list is built on who downloaded and
    did not pay. The saved draft rather than the editor's state, so what is
    counted is what was stored."""
    _candidate(ctx)
    await enforce("resume_builder.export", subject=str(ctx.user_id))
    row = await repository.get_draft(session, user_id=ctx.user_id)
    if row is None:
        raise DraftMissingError()
    content = _checked(StructuredResume.model_validate(row.content))
    document = await rendering.pdf(row.template_key, domain.template_view(content))
    await repository.record_download(session, user_id=ctx.user_id)
    return document, _filename(content)


async def push(session: AsyncSession, *, ctx: TenantContext) -> PushResponse:
    """Make the saved draft the candidate's resume.

    A new `BUILDER` version, with the PDF as its file, linked from the career
    profile. Unconfirmed: no score until the candidate confirms it, which
    needs a subscription. An unchanged draft returns the version it already
    became rather than writing an identical one.
    """
    _candidate(ctx)
    await enforce("resume_builder.export", subject=str(ctx.user_id))
    # Locked: two taps on "use this resume" must not write two versions.
    row = await repository.get_draft(session, user_id=ctx.user_id, lock=True)
    if row is None:
        raise DraftMissingError()
    content = _checked(StructuredResume.model_validate(row.content))
    missing = domain.missing_for_push(content)
    if missing:
        raise DraftIncompleteError(params={"fields": missing})

    if row.pushed_version_id is not None and _pushed_is_current(row):
        existing = await resume_service.get_version_for_profile(
            session, user_id=ctx.user_id, resume_version_id=row.pushed_version_id
        )
        return PushResponse(
            resume_version_id=existing.id,
            resume_file_id=existing.resume_file_id,
            created=False,
            confirmed=existing.confirmed_at is not None,
        )

    document = await rendering.pdf(row.template_key, domain.template_view(content))
    version = await resume_service.create_builder_version(
        session,
        user_id=ctx.user_id,
        fields=domain.scoring_fields(content),
        structured=content,
        pdf=document,
        extractor={
            "parser": domain.PARSER,
            "parser_version": domain.PARSER_VERSION,
            "template_key": row.template_key,
            "templates_version": domain.TEMPLATES_VERSION,
        },
    )
    await career_service.attach_resume(
        session,
        ctx=ctx,
        resume_version_id=version.id,
        resume_file_id=version.resume_file_id,
        resume_filename=_filename(content),
    )
    await repository.record_push(session, user_id=ctx.user_id, resume_version_id=version.id)
    return PushResponse(
        resume_version_id=version.id, resume_file_id=version.resume_file_id, created=True
    )


# ---------------------------------------------------------------------------
async def _prefilled(session: AsyncSession, ctx: TenantContext) -> dict[str, Any]:
    profile = await candidate_service.get_profile(session, ctx=ctx)
    career = await career_service.get_details(session, ctx=ctx)
    email = await identity_service.email_of(session, user_id=ctx.user_id)
    return domain.prefill(
        full_name=profile.full_name or "",
        email=email or "",
        details=career.details.model_dump(mode="json"),
        resume=await _read_cv(session, ctx),
    )


async def _read_cv(session: AsyncSession, ctx: TenantContext) -> dict[str, Any] | None:
    """Their newest CV as the review screen shows it, or None.

    Only a CV read from text: a form-built version holds no more than the
    answers, and a built one is this builder's own output. Within that CV's
    chain the newest view wins (a correction is structured afresh); an older,
    different CV is never used in its place. A version read before
    structuring existed (2026-10-06) has no view -- nothing is read again
    here, so the builder calls no model.
    """
    versions = [
        v for v, _superseded in await resume_service.list_versions(session, user_id=ctx.user_id)
    ]
    by_id = {v.id: v for v in versions}
    version = next((v for v in versions if _read_from_text(v)), None)
    while version is not None and _read_from_text(version):
        structured, structured_status = structured_view(version.parsed)
        if structured is not None and structured_status == "READY":
            return structured.model_dump(mode="json")
        version = by_id.get(version.supersedes_id)
    return None


def _read_from_text(version: Any) -> bool:
    parsed = version.parsed
    return (
        version.source != "BUILDER"
        and isinstance(parsed, dict)
        and isinstance(parsed.get("raw_text"), str)
    )


def _checked(content: StructuredResume | dict[str, Any]) -> dict[str, Any]:
    """The content as stored, after the rules the schema cannot express."""
    doc = (
        content
        if isinstance(content, StructuredResume)
        else StructuredResume.model_validate(content)
    ).model_dump(mode="json")
    if len(json.dumps(doc, ensure_ascii=False)) > domain.MAX_CONTENT_CHARS:
        raise DraftTooLongError(params={"max_chars": domain.MAX_CONTENT_CHARS})
    personal = domain.personal_detail_fields(doc)
    if personal:
        raise PersonalDetailError(params={"fields": personal})
    dates = domain.malformed_date_fields(doc)
    if dates:
        raise InvalidDateError(params={"fields": dates})
    return doc


def _pushed_is_current(row: ResumeBuilderDraft) -> bool:
    return row.pushed_at is not None and row.pushed_at >= row.updated_at


def _response(row: ResumeBuilderDraft) -> DraftResponse:
    return DraftResponse(
        template_key=row.template_key,
        content=StructuredResume.model_validate(row.content),
        saved=True,
        updated_at=row.updated_at,
        first_downloaded_at=row.first_downloaded_at,
        last_downloaded_at=row.last_downloaded_at,
        download_count=row.download_count,
        pushed_version_id=row.pushed_version_id,
        pushed_at=row.pushed_at,
        pushed_is_current=row.pushed_version_id is not None and _pushed_is_current(row),
    )


def _filename(content: dict[str, Any]) -> str:
    """`Priya-Sharma-Resume.pdf`. ASCII only: the name goes in a header."""
    name = re.sub(r"[^A-Za-z0-9]+", "-", str(content.get("full_name") or "")).strip("-")
    return f"{name}-Resume.pdf" if name else "Resume.pdf"
