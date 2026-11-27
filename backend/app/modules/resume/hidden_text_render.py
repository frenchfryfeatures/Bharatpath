"""Hidden text, judged by rendering the page the way a reader sees it.

Detector revision 3 (2026-11-27). `hidden_text.find_hidden_text` calls this
first and falls back to its operator pass only when this raises.

## The one question, asked of the pixels

Revisions 1 and 2 read the content stream and reasoned about what a viewer
*would* draw -- fill colours, then the rectangles behind the text. Every case
they did not model (clipping, transparency, gradients, form XObjects, text
under an image, any colour on the *same* colour) was either missed or
guessed. So this pass stops modelling and asks pdfium, Chrome's PDF engine,
to draw the page:

1. render the page as it is;
2. make every text object invisible, in memory, and render it again;
3. for each character, compare the two renders inside its glyph box.

If taking a character away changes no pixel by more than
`MIN_VISIBLE_DIFFERENCE`, nobody looking at the page can see it -- whatever
the trick was. White on white, blue on blue, a 0% opacity fill, text under a
picture or a box: all of them come out as "no difference", with no rule
written for any of them. White text on a navy sidebar changes the pixels a
lot and is visible, which is the UAT false positive closed by construction.

## Still built to miss rather than guess

A HIGH signal hides a candidate before anyone has looked (CLAUDE.md,
_Integrity signals never move the score_), so every doubt goes to "visible":

* **Any visible difference wins.** The threshold is a few percent of one
  colour channel, below which text cannot be read; faint but legible text is
  visible. Light grey body text clears it comfortably.
* **A character we cannot judge is visible**: no text object behind it, a
  glyph with no area, or a box that falls off the rendered page but within
  `OFF_PAGE_MARGIN` of it.
* **A scanned CV is not an attack.** An OCR layer is invisible-mode text over
  a picture, or ordinary text under one; when nearly all of a document's
  characters are hidden that way, it is a searchable scan and those findings
  are dropped (`MAX_INVISIBLE_RATIO`). Colour findings are never dropped:
  no scanner prints white on white.
* The render *wins over* the structural rules where they disagree in the
  candidate's favour: clip-mode text with an image painted through it is
  render mode 7 and plainly visible, and is no longer reported.

Two structural rules stay, because they are about readability rather than
pixels: type under a point (`TINY_FONT`) and text parked beyond the page
(`OFF_PAGE`).

## Why it never changes what gets scored

`raw_text` still comes from pypdf's `extract_text()` alone. The evidence text
here is pdfium's reading of the same characters, used only as evidence for a
reviewer. Nothing is subtracted (invariant 1).
"""

from __future__ import annotations

import ctypes
from dataclasses import dataclass, field
from typing import Any, Final

from app.modules.resume.hidden_text import (
    COVERED,
    INVISIBLE_RENDER_MODE,
    INVISIBLE_RENDER_MODES,
    MATCHES_BACKGROUND,
    MAX_HIDDEN_CHARS,
    MAX_INVISIBLE_RATIO,
    NEAR_WHITE_FILL,
    NEAR_WHITE_LUMINANCE,
    OFF_PAGE,
    OFF_PAGE_MARGIN,
    TINY_FONT,
    TINY_FONT_POINTS,
    TRANSPARENT_FILL,
    HiddenTextReport,
)
from app.modules.resume.pdfium_lock import PDFIUM_LOCK

#: Pixels per point. 3 is 216 dpi: enough that a 6pt stem covers whole
#: pixels, so anti-aliasing cannot make legible text look faint. About 60 ms
#: a page, at most ten pages, in a task nobody is waiting on.
RENDER_SCALE: Final = 3.0

#: The largest change, in any one 0-255 colour channel, that removing a
#: character may make and still count as invisible. 24 is about 9%: white
#: text on a 0.92 grey -- revision 1's own near-white line -- differs by 20
#: and is hidden; 0.85 grey on white differs by 38 and is visible.
MIN_VISIBLE_DIFFERENCE: Final = 24

#: When an invisible character's fill is this close (per channel) to what is
#: under it, the reason is MATCHES_BACKGROUND; further away, something was
#: painted over it (COVERED). For the reviewer only -- both are hidden.
MATCH_TOLERANCE: Final = 48

#: Fill alpha (0-255) at or below which the reason is TRANSPARENT_FILL.
TRANSPARENT_ALPHA: Final = 13

#: Characters before the OCR ratio means anything.
MIN_CHARS_FOR_RATIO: Final = 20

#: Reasons that a scanner's text layer produces, and so the only ones the
#: OCR discriminator may drop.
_SCAN_REASONS: Final = frozenset({INVISIBLE_RENDER_MODE, COVERED})

_LINE_BREAKS: Final = frozenset({"\r", "\n"})

#: Render modes 4-7 add the glyphs to the clipping path. pdfium attaches that
#: clip to the objects painted *after* the text when it parses the page, so
#: silencing the text does not undo it: a heading painted through its own
#: glyphs (an image- or gradient-filled title) looks identical in both
#: renders. For these, anything that varies inside the glyph box of the
#: original render counts as visible.
_CLIP_MODES: Final = frozenset({4, 5, 6, 7})


@dataclass
class _Segment:
    reason: str | None  # None = visible
    text: list[str] = field(default_factory=list)


@dataclass
class _Tally:
    """Characters, segments and findings for the whole document."""

    chars: int = 0
    by_reason: dict[str, int] = field(default_factory=dict)
    chunks: int = 0
    hidden: list[_Segment] = field(default_factory=list)


def _luminance(rgb: tuple[float, float, float]) -> float:
    r, g, b = rgb
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def _fill_colour(textpage: Any, index: int) -> tuple[tuple[int, int, int], int] | None:
    import pypdfium2.raw as pdfium_c

    r, g, b, a = (ctypes.c_uint() for _ in range(4))
    if not pdfium_c.FPDFText_GetFillColor(textpage, index, r, g, b, a):
        return None
    return (r.value, g.value, b.value), a.value


def _render(page: Any) -> Any:
    return page.render(scale=RENDER_SCALE, draw_annots=True).to_pil().convert("RGB")


def render_hidden_text(content: bytes) -> HiddenTextReport:
    """Analyse a PDF by rendering it. **Raises** on anything pdfium cannot do;
    the caller falls back to the operator pass."""
    import pypdfium2 as pdfium

    tally = _Tally()
    with PDFIUM_LOCK, pdfium.PdfDocument(content) as document:
        for index in range(len(document)):
            page = document[index]
            try:
                _page(page, tally)
            finally:
                page.close()
    return _report(tally)


def _page(page: Any, tally: _Tally) -> None:
    import pypdfium2.raw as pdfium_c
    from PIL import ImageChops, ImageStat

    # Rotation moves pixels, not visibility; judging the page unrotated keeps
    # glyph boxes and bitmap in the same frame.
    page.set_rotation(0)
    textpage = page.get_textpage()
    try:
        count = textpage.count_chars()
        if count <= 0:
            return
        crop_left, crop_bottom, crop_right, crop_top = page.get_cropbox()
        media_left, media_bottom, media_right, media_top = page.get_mediabox()

        # Read every character's object and mode BEFORE changing anything.
        objects: list[int | None] = []
        modes: list[int] = []
        for i in range(count):
            handle = pdfium_c.FPDFText_GetTextObject(textpage, i)
            address = ctypes.cast(handle, ctypes.c_void_p).value if handle else None
            objects.append(address)
            modes.append(pdfium_c.FPDFTextObj_GetTextRenderMode(handle) if handle else -1)

        before = _render(page)
        silenced: set[int] = set()
        invisible = pdfium_c.FPDF_TEXTRENDERMODE_INVISIBLE
        for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_TEXT,), max_depth=16):
            if pdfium_c.FPDFTextObj_SetTextRenderMode(obj.raw, invisible):
                address = ctypes.cast(obj.raw, ctypes.c_void_p).value
                if address is not None:
                    silenced.add(address)
        after = _render(page)
        difference = ImageChops.difference(before, after)
        width, height = before.size

        segment: _Segment | None = None
        separator = False

        def close() -> None:
            nonlocal segment, separator
            if segment is not None:
                tally.chunks += 1
                if segment.reason is not None:
                    tally.hidden.append(segment)
            segment, separator = None, False

        for i in range(count):
            code = pdfium_c.FPDFText_GetUnicode(textpage, i)
            char = chr(code) if 0 < code < 0x110000 else ""
            if char in _LINE_BREAKS:
                close()
                continue
            if not char or char.isspace() or pdfium_c.FPDFText_IsGenerated(textpage, i) == 1:
                separator = segment is not None
                continue

            reason = _judge(
                textpage,
                i,
                mode=modes[i],
                judged=objects[i] is not None and objects[i] in silenced,
                pixels=(width, height),
                crop=(crop_left, crop_bottom, crop_right, crop_top),
                media=(media_left, media_bottom, media_right, media_top),
                difference=difference,
                before=before,
                after=after,
                stat=ImageStat.Stat,
            )
            tally.chars += 1
            if reason is not None:
                tally.by_reason[reason] = tally.by_reason.get(reason, 0) + 1

            if segment is None or segment.reason != reason:
                close()
                segment = _Segment(reason)
            elif separator:
                segment.text.append(" ")
            separator = False
            segment.text.append(char)
        close()
    finally:
        textpage.close()


def _judge(
    textpage: Any,
    index: int,
    *,
    mode: int,
    judged: bool,
    pixels: tuple[int, int],
    crop: tuple[float, float, float, float],
    media: tuple[float, float, float, float],
    difference: Any,
    before: Any,
    after: Any,
    stat: Any,
) -> str | None:
    """Why this character cannot be seen, or None if it can."""
    left, bottom, right, top = textpage.get_charbox(index, loose=True)

    media_left, media_bottom, media_right, media_top = media
    if (
        right < media_left - OFF_PAGE_MARGIN
        or left > media_right + OFF_PAGE_MARGIN
        or top < media_bottom - OFF_PAGE_MARGIN
        or bottom > media_top + OFF_PAGE_MARGIN
    ):
        return OFF_PAGE
    if 0 < top - bottom < TINY_FONT_POINTS:
        return TINY_FONT
    if not judged:
        # No text object we could silence: the second render still shows it,
        # so the comparison would call it invisible. It is not ours to judge.
        return None

    tight = textpage.get_charbox(index, loose=False)
    box = _pixel_box(tight, crop, pixels)
    if box is None:
        # No area, or wholly off the rendered page but within the margin.
        return None
    _, highest = _channel_range(difference.crop(box))
    if highest > MIN_VISIBLE_DIFFERENCE:
        return None
    if mode in _CLIP_MODES and _spread(before.crop(box)) > MIN_VISIBLE_DIFFERENCE:
        return None

    if mode in INVISIBLE_RENDER_MODES:
        return INVISIBLE_RENDER_MODE
    fill = _fill_colour(textpage, index)
    if fill is None:
        return COVERED
    rgb, alpha = fill
    if alpha <= TRANSPARENT_ALPHA:
        return TRANSPARENT_FILL
    under = tuple(stat(after.crop(box)).mean[:3])
    under_rgb = (float(under[0]), float(under[1]), float(under[2]))
    fill_rgb = (float(rgb[0]), float(rgb[1]), float(rgb[2]))
    if (
        _luminance(fill_rgb) >= NEAR_WHITE_LUMINANCE
        and _luminance(under_rgb) >= NEAR_WHITE_LUMINANCE
    ):
        return NEAR_WHITE_FILL
    if max(abs(a - b) for a, b in zip(fill_rgb, under_rgb, strict=True)) <= MATCH_TOLERANCE:
        return MATCHES_BACKGROUND
    return COVERED


def _channel_range(image: Any) -> tuple[int, int]:
    extrema = image.getextrema()
    return (min(low for low, _ in extrema), max(high for _, high in extrema))


def _spread(image: Any) -> int:
    """The largest range of any one channel: how much the area varies."""
    return int(max(high - low for low, high in image.getextrema()))


def _pixel_box(
    box: tuple[float, float, float, float],
    crop: tuple[float, float, float, float],
    pixels: tuple[int, int],
) -> tuple[int, int, int, int] | None:
    """A glyph box in page points, as a pixel box clipped to the bitmap."""
    left, bottom, right, top = box
    crop_left, _, _, crop_top = crop
    width, height = pixels
    x0 = max(0, int((left - crop_left) * RENDER_SCALE))
    x1 = min(width, int((right - crop_left) * RENDER_SCALE + 0.999))
    y0 = max(0, int((crop_top - top) * RENDER_SCALE))
    y1 = min(height, int((crop_top - bottom) * RENDER_SCALE + 0.999))
    if x1 <= x0 or y1 <= y0:
        return None
    return (x0, y0, x1, y1)


def _report(tally: _Tally) -> HiddenTextReport:
    found = tally.hidden
    scan_chars = sum(tally.by_reason.get(r, 0) for r in _SCAN_REASONS)
    if tally.chars >= MIN_CHARS_FOR_RATIO and scan_chars / tally.chars > MAX_INVISIBLE_RATIO:
        found = [s for s in found if s.reason not in _SCAN_REASONS]

    if not found:
        return HiddenTextReport(analysed=True, chunks=tally.chunks, method="render")
    text = "\n".join("".join(s.text).strip() for s in found)[:MAX_HIDDEN_CHARS]
    return HiddenTextReport(
        text=text,
        reasons=tuple(sorted({s.reason for s in found if s.reason is not None})),
        analysed=True,
        chunks=tally.chunks,
        hidden_chunks=len(found),
        method="render",
    )
