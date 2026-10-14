"""Typst, run on a worker thread: the four templates to PDF, PNG or SVG.

Typst is one compiled library (`typst` on PyPI, Apache-2.0) with no system
dependencies, so the Docker image needs nothing new and a resume renders the
same on Windows, in CI and on the server. A render is tens of milliseconds.

**System fonts are ignored** (`ignore_system_fonts=True`). The templates name
the bundled Noto families (`fonts/`, SIL OFL) and the fonts Typst embeds --
New Computer Modern, Libertinus Serif -- so no machine's font folder can
change what an employer receives. The Typst version is pinned in
`pyproject.toml` for the same reason: a new Typst may set text differently,
which is a template change and a `TEMPLATES_VERSION` bump.

**Nothing a candidate typed is compiled.** Each template is a fixed file; the
draft reaches it as one JSON string in `sys.inputs`, already formatted by
`domain.template_view`, and Typst prints a string as it is. File access is
confined to `templates/` (`root`), which holds only the templates.
"""

from __future__ import annotations

import asyncio
import base64
import json
import threading
from pathlib import Path
from typing import Any, Final, Literal

import typst
from fastapi import status

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.resume_builder.domain import TEMPLATE_KEYS

logger = get_logger(__name__)

_HERE: Final = Path(__file__).resolve().parent
TEMPLATE_DIR: Final = _HERE / "templates"
FONT_DIR: Final = _HERE / "fonts"

#: Pixels per inch for a PNG preview page: an A4 page is 909 x 1286.
PREVIEW_PPI: Final = 110
#: Pages a preview returns. The draft limit keeps a resume well under this.
MAX_PREVIEW_PAGES: Final = 10

#: Renders at once in this process. A compile is short but CPU-bound, and the
#: API shares one small host with the worker: a burst of previews must queue
#: rather than starve every other request.
_SLOTS: Final = threading.BoundedSemaphore(2)

ImageFormat = Literal["png", "svg"]


class ResumeRenderError(AppError):
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "resume_render_failed"
    title = "The resume could not be drawn"


def _compile(
    template_key: str, view: dict[str, Any], fmt: Literal["pdf", "png", "svg"], ppi: float | None
) -> Any:
    if template_key not in TEMPLATE_KEYS:  # the schema refuses it first
        raise ResumeRenderError()
    with _SLOTS:
        try:
            return typst.compile(
                str(TEMPLATE_DIR / f"{template_key}.typ"),
                root=str(TEMPLATE_DIR),
                font_paths=[str(FONT_DIR)],
                ignore_system_fonts=True,
                format=fmt,
                ppi=ppi,
                sys_inputs={"data": json.dumps(view, ensure_ascii=False)},
            )
        except Exception as exc:
            # The templates are ours and the data is validated, so this is a
            # bug in a template, never something the candidate did. The
            # message can quote the draft; it is not logged.
            logger.error("resume_render_failed", template=template_key, error=type(exc).__name__)
            raise ResumeRenderError() from exc


async def pdf(template_key: str, view: dict[str, Any]) -> bytes:
    """The resume as a PDF. Byte-identical for the same draft and template:
    the templates set no creation date."""
    result = await asyncio.to_thread(_compile, template_key, view, "pdf", None)
    assert isinstance(result, bytes)
    return result


async def preview(
    template_key: str, view: dict[str, Any], *, fmt: ImageFormat = "png"
) -> tuple[list[str], int]:
    """Each page as base64 (PNG, like `GET /candidate/profile/resume/preview`,
    or SVG), and how many pages there are."""
    result = await asyncio.to_thread(
        _compile, template_key, view, fmt, PREVIEW_PPI if fmt == "png" else None
    )
    pages: list[bytes] = result if isinstance(result, list) else [result]
    shown = pages[:MAX_PREVIEW_PAGES]
    return [base64.b64encode(page).decode("ascii") for page in shown], len(pages)
