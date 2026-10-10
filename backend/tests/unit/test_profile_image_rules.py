"""Profile photos and logos (2026-10-09): what is accepted, and what is kept.

Every stored image is one the server encoded. These hold that the client's
metadata -- above all a phone's GPS position -- never survives, that a file
which only looks like an image is refused, and that keys are built from ids
the server issued.
"""

from __future__ import annotations

import io
import uuid

import pytest
from PIL import Image

from app.modules.profile_images import imaging
from app.modules.profile_images.domain import (
    MAX_EDGE_PX,
    MAX_UPLOAD_BYTES,
    is_from_upload,
    sniff_image,
    stored_key,
    upload_key,
    upload_rejection,
)
from app.modules.profile_images.imaging import ImageRejectedError, normalise

GPS_IFD = 0x8825


def _jpeg(size: tuple[int, int] = (1200, 800), *, gps: bool = False, orientation: int = 1) -> bytes:
    image = Image.new("RGB", size, (200, 30, 30))
    exif = Image.Exif()
    exif[0x0112] = orientation
    if gps:
        exif[GPS_IFD] = {1: "N", 2: (12.0, 58.0, 0.0), 3: "E", 4: (77.0, 35.0, 0.0)}
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def _png(*, alpha: bool) -> bytes:
    image = Image.new("RGBA" if alpha else "RGB", (300, 300), (0, 0, 0, 0) if alpha else (9, 9, 9))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


# --- the format, from the bytes -------------------------------------------------
def test_the_format_is_read_from_the_bytes() -> None:
    assert sniff_image(_jpeg()) == "image/jpeg"
    assert sniff_image(_png(alpha=False)) == "image/png"
    assert sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff_image(b"GIF89a") is None
    assert sniff_image(b"<html><script>") is None


def test_an_upload_is_judged_on_size_and_type_before_it_is_decoded() -> None:
    assert upload_rejection(size=10, mime="image/jpeg") == "empty"
    assert upload_rejection(size=MAX_UPLOAD_BYTES + 1, mime="image/jpeg") == "too_large"
    assert upload_rejection(size=5_000, mime=None) == "unsupported_type"
    assert upload_rejection(size=5_000, mime="image/png") is None


# --- what is kept -----------------------------------------------------------------
def test_a_phones_gps_position_never_survives() -> None:
    raw = _jpeg(gps=True)
    assert Image.open(io.BytesIO(raw)).getexif().get(GPS_IFD) is not None
    kept = normalise(raw)
    stored = Image.open(io.BytesIO(kept.body))
    assert not stored.getexif(), "no EXIF at all is written back"
    assert b"Exif" not in kept.body


def test_a_photo_is_turned_upright_before_its_metadata_is_dropped() -> None:
    """Orientation 6 means "rotate 90 degrees": a portrait stored on its side."""
    kept = normalise(_jpeg((1200, 800), orientation=6))
    assert (kept.width, kept.height) == (341, MAX_EDGE_PX)


def test_the_long_side_is_scaled_to_the_limit_and_never_up() -> None:
    big = normalise(_jpeg((4000, 3000)))
    assert (big.width, big.height) == (MAX_EDGE_PX, 384)
    small = normalise(_jpeg((100, 80)))
    assert (small.width, small.height) == (100, 80)


def test_a_transparent_logo_stays_a_png_and_a_photo_becomes_a_jpeg() -> None:
    assert normalise(_png(alpha=True)).mime == "image/png"
    assert normalise(_png(alpha=False)).mime == "image/jpeg"


@pytest.mark.parametrize(
    "raw",
    [
        b"\xff\xd8\xff" + b"not really a jpeg" * 20,
        b"\x89PNG\r\n\x1a\n" + b"<script>alert(1)</script>" * 10,
        b"plain text, no image here at all" * 4,
    ],
)
def test_a_file_that_only_looks_like_an_image_is_refused(raw: bytes) -> None:
    with pytest.raises(ImageRejectedError) as refused:
        normalise(raw)
    assert refused.value.reason == "not_an_image"


def test_a_gif_is_refused_even_though_it_decodes() -> None:
    out = io.BytesIO()
    Image.new("RGB", (10, 10)).save(out, format="GIF")
    with pytest.raises(ImageRejectedError) as refused:
        normalise(out.getvalue())
    assert refused.value.reason == "unsupported_type"


def test_an_image_that_would_decode_to_too_many_pixels_is_refused_before_it_does(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(imaging, "MAX_SOURCE_PIXELS", 100 * 100)
    with pytest.raises(ImageRejectedError) as refused:
        normalise(_jpeg((101, 100)))
    assert refused.value.reason == "too_many_pixels"


# --- keys -------------------------------------------------------------------------
def test_keys_are_built_from_ids_the_server_issued() -> None:
    owner, upload = uuid.uuid4(), uuid.uuid4()
    assert upload_key(kind="USER", owner_id=owner, upload_id=upload) == (
        f"uploads/users/{owner}/{upload}"
    )
    key = stored_key(kind="TENANT", owner_id=owner, upload_id=upload, mime="image/png")
    assert key == f"organisations/{owner}/{upload}.png"
    assert is_from_upload(key, upload_id=upload)
    assert not is_from_upload(key, upload_id=uuid.uuid4())
