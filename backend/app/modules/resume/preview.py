"""Render private resume previews locally, without a third-party viewer."""

from __future__ import annotations

import base64
import io


def render_pdf(content: bytes) -> tuple[list[str], bool]:
    import pypdfium2 as pdfium

    pages: list[str] = []
    with pdfium.PdfDocument(content) as document:
        count = len(document)
        for index in range(min(count, 20)):
            page = document[index]
            bitmap = None
            try:
                bitmap = page.render(scale=min(1.5, 900 / max(page.get_width(), 1)))
                image = bitmap.to_pil()
                buffer = io.BytesIO()
                image.save(buffer, format="PNG", optimize=True)
                pages.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
            finally:
                if bitmap is not None:
                    bitmap.close()
                page.close()
    return pages, count > 20
