"""Resume intake domain rules: type sniffing and the upload gate.

Pure functions, so every branch is reachable without S3 or a database.
The cases that matter are the adversarial ones -- a file is what its bytes
say it is, never what its name or its Content-Type claims (SRS 1.4.2).
"""

from __future__ import annotations

import uuid
import zipfile
from io import BytesIO

import pytest

from app.modules.resume.domain import (
    DOCX,
    normalise_pasted_text,
    sniff_mime,
    upload_key,
    validate_upload,
)

ALLOWED = ["application/pdf", DOCX]
MAX = 10 * 1024 * 1024

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"
DOC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32


def _docx() -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<document/>")
    return buf.getvalue()


def _plain_zip() -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("payload.exe", "MZ...")
    return buf.getvalue()


# --- sniffing -------------------------------------------------------------
@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (PDF, "application/pdf"),
        (DOC, "application/msword"),
        (_docx(), DOCX),
        (_plain_zip(), "application/zip"),
        (b"", None),
        (b"just some text", None),
        (b"\x89PNG\r\n\x1a\n", None),
    ],
)
def test_sniff_identifies_content(data: bytes, expected: str | None) -> None:
    assert sniff_mime(data) == expected


def test_a_renamed_zip_is_not_a_docx() -> None:
    """Both are ZIPs. Only one contains `word/`, and only that one is a
    document -- otherwise any archive walks in through the DOCX door."""
    assert sniff_mime(_plain_zip()) == "application/zip"
    assert (
        validate_upload(head=_plain_zip(), size_bytes=400, max_bytes=MAX, allowed=ALLOWED)
        is not None
    )


def test_a_declared_content_type_cannot_override_the_bytes() -> None:
    """There is deliberately no parameter to pass one in. This test exists so
    that adding one is a visible change to the signature, not a quiet one."""
    with pytest.raises(TypeError):
        validate_upload(  # type: ignore[call-arg]
            head=b"\x89PNG\r\n\x1a\n",
            size_bytes=10,
            max_bytes=MAX,
            allowed=ALLOWED,
            content_type="application/pdf",
        )


# --- the upload gate ------------------------------------------------------
def test_a_real_pdf_is_accepted() -> None:
    assert validate_upload(head=PDF, size_bytes=2048, max_bytes=MAX, allowed=ALLOWED) is None


@pytest.mark.parametrize(
    ("size", "code"),
    [(0, "upload_empty"), (-1, "upload_empty"), (MAX + 1, "upload_too_large")],
)
def test_size_is_refused_before_content_is_examined(size: int, code: str) -> None:
    """Note the head is a PNG: if content were checked first this would fail
    with the wrong code, and an oversized file would have been read."""
    r = validate_upload(head=b"\x89PNG", size_bytes=size, max_bytes=MAX, allowed=ALLOWED)
    assert r is not None and r.code == code


def test_exactly_the_limit_is_allowed() -> None:
    assert validate_upload(head=PDF, size_bytes=MAX, max_bytes=MAX, allowed=ALLOWED) is None


def test_a_recognised_but_unlisted_type_is_refused() -> None:
    r = validate_upload(head=PDF, size_bytes=100, max_bytes=MAX, allowed=[DOCX])
    assert r is not None and r.code == "upload_unsupported_type"


def test_an_unrecognised_type_is_refused() -> None:
    r = validate_upload(head=b"\x89PNG", size_bytes=100, max_bytes=MAX, allowed=ALLOWED)
    assert r is not None and r.code == "upload_unrecognised_type"


# --- keys -----------------------------------------------------------------
def test_the_key_is_derived_from_the_authenticated_user() -> None:
    """A client-supplied key would let one candidate write to another's
    prefix, because a presigned PUT authorises exactly the key it signed."""
    user, upload = uuid.uuid4(), uuid.uuid4()
    assert upload_key(user_id=user, upload_id=upload) == f"resumes/{user}/{upload}"


def test_two_uploads_by_one_user_never_collide() -> None:
    user = uuid.uuid4()
    keys = {upload_key(user_id=user, upload_id=uuid.uuid4()) for _ in range(100)}
    assert len(keys) == 100


# --- pasted text ----------------------------------------------------------
def test_pasted_text_is_normalised_once() -> None:
    messy = "  Priya Sharma \r\n\r\n\r\n\r\n  Engineer  \r\n \r\n"
    assert normalise_pasted_text(messy) == "Priya Sharma\n\nEngineer"


def test_normalisation_is_idempotent() -> None:
    """Scoring must be reproducible from the stored text (invariant 1), so
    normalising twice cannot differ from normalising once."""
    once = normalise_pasted_text("a\r\n\r\n\r\n  b  \n\n\n")
    assert normalise_pasted_text(once) == once


def test_a_nul_byte_never_reaches_the_database() -> None:
    """**Regression, found by the fuzzer on 2026-09-22.**

    Postgres cannot store `\x00` in a text or JSONB value at all. A pasted CV
    containing one passed validation, passed the service, and died in the
    asyncpg driver as `A string literal cannot contain NUL (0x00)
    characters` -- a 500, on input any candidate can send. It is trivially
    reachable by pasting out of a corrupted PDF, which is exactly the
    population this endpoint exists to serve.
    """
    assert "\x00" not in normalise_pasted_text("Priya Sharma\x00\nMicrobiology, Pune")


def test_control_characters_are_stripped_and_real_whitespace_is_not() -> None:
    """The sweep has to be narrow. Tab, newline and carriage return carry
    layout a CV depends on; the rest cannot be typed deliberately, do not
    survive rendering, and each is a way to make two CVs that look identical
    store differently."""
    assert normalise_pasted_text("a\x01b\x0bc\x7fd") == "abcd"
    assert normalise_pasted_text("a\tb\nc\n\n\n\nd") == "a\tb\nc\n\nd"


def test_stripping_controls_leaves_normalisation_idempotent() -> None:
    """Invariant 1 again: the stored text is what is scored, so a second pass
    over an already-stored value must not change it."""
    once = normalise_pasted_text("a\x00\r\n\r\n  b\x0c  \n\n")
    assert normalise_pasted_text(once) == once


# --- legacy .doc -----------------------------------------------------------------
def test_a_legacy_doc_is_refused_at_upload_with_its_own_code() -> None:
    rejection = validate_upload(head=DOC, size_bytes=4096, max_bytes=MAX, allowed=ALLOWED)
    assert rejection is not None and rejection.code == "upload_legacy_doc_unsupported"


def test_the_shipped_settings_do_not_accept_legacy_doc() -> None:
    from app.settings import Settings

    assert "application/msword" not in Settings.model_fields["resume_allowed_mime_types"].default
