"""profile_images - business rules

Everyone's own photo, and employer and college logos. Never the score.

Pure functions only: no I/O, no database, no clock.

**Two owners, one shape.** A photo belongs to a person (`USER`): a student,
an employer's or a college's member, or our staff. A logo belongs to an
organisation (`TENANT`): an employer or a college. Each owner has at most one
image; uploading another replaces it.

**Who sees a student's photo** (2026-10-09, the backend lead): the student
and our staff. Never an employer and never a college. A face says gender,
age and more, and masked search exists so an employer judges on band and
skills (invariant 5, C3). `tests/invariants/test_profile_photo_reach.py`
fails the build on a field for it in any employer- or college-facing schema.
An organisation's logo is the opposite: it is shown to every candidate who
sees the organisation's jobs.
"""

from __future__ import annotations

import uuid
from typing import Final, Literal

OwnerKind = Literal["USER", "TENANT"]

#: What a client may upload. Sniffed from the bytes, never taken from a
#: Content-Type; every image is then decoded and re-encoded (`imaging`).
ACCEPTED_IMAGE_TYPES: Final[tuple[str, ...]] = ("image/jpeg", "image/png", "image/webp")
#: A phone photo, uncompressed by the client, fits under this.
MAX_UPLOAD_BYTES: Final = 5 * 1024 * 1024
MIN_UPLOAD_BYTES: Final = 64
#: The stored image's longest side. A profile picture is drawn at a few
#: dozen pixels; 512 covers a retina screen and keeps every read cheap.
MAX_EDGE_PX: Final = 512
#: A decompression bomb is a small file that decodes to gigabytes. Pillow
#: is asked to refuse anything larger than this before it decodes.
MAX_SOURCE_PIXELS: Final = 40_000_000

ImageRejection = Literal[
    "empty",
    "too_large",
    "unsupported_type",
    "not_an_image",
    "too_many_pixels",
]

_PREFIX: Final[dict[OwnerKind, str]] = {"USER": "users", "TENANT": "organisations"}


def sniff_image(head: bytes) -> str | None:
    """The format from its magic bytes, or None. Never from a Content-Type."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def upload_rejection(*, size: int, mime: str | None) -> ImageRejection | None:
    """Why an upload is refused before it is decoded, or None."""
    if size < MIN_UPLOAD_BYTES:
        return "empty"
    if size > MAX_UPLOAD_BYTES:
        return "too_large"
    if mime is None:
        return "unsupported_type"
    return None


def upload_key(*, kind: OwnerKind, owner_id: uuid.UUID, upload_id: uuid.UUID) -> str:
    """Where the client's raw upload lands. Rebuilt from the caller's own
    identity at confirm, so a client can never point us at another key."""
    return f"uploads/{_PREFIX[kind]}/{owner_id}/{upload_id}"


def stored_key(*, kind: OwnerKind, owner_id: uuid.UUID, upload_id: uuid.UUID, mime: str) -> str:
    """Where the re-encoded image the server wrote is kept."""
    extension = {"image/jpeg": "jpg", "image/png": "png"}[mime]
    return f"{_PREFIX[kind]}/{owner_id}/{upload_id}.{extension}"


def is_from_upload(key: str, *, upload_id: uuid.UUID) -> bool:
    """True when `key` is the stored image of this upload: a confirm sent
    twice is a retry, answered with what the first one stored."""
    return key.rsplit("/", 1)[-1].startswith(f"{upload_id}.")
