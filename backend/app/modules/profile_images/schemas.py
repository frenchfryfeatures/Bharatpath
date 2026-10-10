"""profile_images - request and response schemas

Everyone's own photo, and employer and college logos. Never the score.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class UploadTicketResponse(_Base):
    upload_id: uuid.UUID
    url: str = Field(description="PUT the file's bytes here, before `expires_in_seconds`.")
    expires_in_seconds: int
    max_bytes: int
    accepted_types: list[str]


class ConfirmUploadRequest(_Base):
    upload_id: uuid.UUID


class ImageResponse(_Base):
    """An image, or every field null when there is none. `url` is a
    presigned GET that expires: fetch this again rather than caching it."""

    url: str | None = None
    #: Of the stored image, which the server re-encoded: JPEG, or PNG when
    #: the upload had transparency.
    mime: str | None = None
    width: int | None = None
    height: int | None = None
    updated_at: datetime | None = None
    expires_in_seconds: int | None = None
