"""resume_builder - Pydantic request/response DTOs

The draft's content is `resume.structuring.StructuredResume`: the same
document both apps already show on the resume review screen, so the editor,
the four templates and an employer's view of the resume share one shape.
**It has no field for date of birth, age, gender, a photo or the score, and
must never get one** (invariant 5; a photo and the score never reach an
employer through a resume).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import ApiSchema
from app.modules.resume.structuring import StructuredResume

#: Held equal to `domain.TEMPLATE_KEYS` by a test. A Literal so the OpenAPI
#: document lists the choices.
TemplateKey = Literal["classic", "modern", "sidebar", "minimal"]


class TemplateInfo(ApiSchema):
    key: TemplateKey
    name: str
    description: str
    columns: int


class TemplatesResponse(ApiSchema):
    templates: list[TemplateInfo]
    default: TemplateKey
    #: Changes whenever any layout does.
    version: str


class DraftRequest(ApiSchema):
    template_key: TemplateKey
    content: StructuredResume


class DraftResponse(ApiSchema):
    template_key: TemplateKey
    content: StructuredResume
    #: False when nothing is stored yet and `content` is the first draft,
    #: filled in from the onboarding answers. Saving stores it.
    saved: bool
    updated_at: datetime | None = None
    first_downloaded_at: datetime | None = None
    last_downloaded_at: datetime | None = None
    download_count: int = 0
    #: The resume version this draft last became, if any.
    pushed_version_id: uuid.UUID | None = None
    pushed_at: datetime | None = None
    #: True when the draft is unchanged since it became that version: pushing
    #: again would write nothing new.
    pushed_is_current: bool = False
    #: True when a CV was uploaded, pasted or corrected after the draft last
    #: caught up with the candidate's resume (2026-10-22). The draft is left
    #: as it is -- it holds the candidate's own edits -- and the editor offers
    #: `POST /draft/reset` to refill from the newer CV, or `POST /draft/keep`
    #: to keep the draft and stop asking. Pushing clears it too.
    out_of_date: bool = False
    #: That newer CV, when `out_of_date`.
    newer_resume_version_id: uuid.UUID | None = None
    newer_resume_at: datetime | None = None


class PreviewRequest(DraftRequest):
    """Unsaved content is fine: this is the editor's right-hand pane."""

    format: Literal["png", "svg"] = "png"


class PreviewResponse(ApiSchema):
    #: Base64, one per page, at most ten.
    pages: list[str]
    mime: Literal["image/png", "image/svg+xml"]
    page_count: int = Field(ge=1)


class PushResponse(ApiSchema):
    """The draft became a resume version: unconfirmed, and not scored until
    the candidate confirms it after paying."""

    resume_version_id: uuid.UUID
    resume_file_id: uuid.UUID | None
    #: False when the draft was unchanged and its existing version came back.
    created: bool
    confirmed: bool = False
