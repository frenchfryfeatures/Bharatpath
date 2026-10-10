"""profile_images - decode, normalise, re-encode

Bytes in, bytes out: no I/O, but CPU-bound, so the service runs it in a
worker thread.

**Every stored image is one the server encoded.** The client's file is
decoded and written again, never kept. That does three things at once:

* **It strips the metadata.** A photo straight from a phone carries EXIF,
  often with the GPS position it was taken at -- usually the person's home.
  Pillow writes none of it back.
* **It proves the file is an image.** A file that merely starts with JPEG's
  magic bytes, or one that is also a valid HTML page or script, does not
  survive a decode and re-encode.
* **It bounds the size.** The longest side is scaled to `MAX_EDGE_PX`.

Rotation is applied first (`exif_transpose`), so dropping the EXIF does not
leave a portrait photo lying on its side.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.modules.profile_images.domain import MAX_EDGE_PX, MAX_SOURCE_PIXELS, ImageRejection


class ImageRejectedError(ValueError):
    def __init__(self, reason: ImageRejection) -> None:
        super().__init__(reason)
        self.reason: ImageRejection = reason


@dataclass(frozen=True, slots=True)
class NormalisedImage:
    body: bytes
    mime: str
    width: int
    height: int


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)


def normalise(raw: bytes) -> NormalisedImage:
    """The image as we keep it: upright, at most `MAX_EDGE_PX` on its long
    side, no metadata. PNG when it has transparency (a logo), JPEG otherwise.

    Raises `ImageRejectedError` for anything that is not a decodable image.
    """
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            width, height = opened.size
            if width * height > MAX_SOURCE_PIXELS:
                raise ImageRejectedError("too_many_pixels")
            if opened.format not in ("JPEG", "PNG", "WEBP"):
                raise ImageRejectedError("unsupported_type")
            opened.load()
            image = ImageOps.exif_transpose(opened) or opened
            image.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))
            out = io.BytesIO()
            if _has_alpha(image):
                image.convert("RGBA").save(out, format="PNG", optimize=True)
                mime = "image/png"
            else:
                image.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
                mime = "image/jpeg"
            return NormalisedImage(out.getvalue(), mime, image.width, image.height)
    except ImageRejectedError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise ImageRejectedError("not_an_image") from exc
