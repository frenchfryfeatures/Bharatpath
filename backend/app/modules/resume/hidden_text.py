"""Text a CV renders but a human reading it cannot see.

Populates `ResumeClaims.hidden_text`, which `_rule_hidden_text` -- one of
only two integrity rules that may reach HIGH severity -- reads. Without this
module that rule could never fire.

---

## What this is for, and what it is not

The attack is putting text in a CV for *us* to read and the employer not to:
a block of keywords in white-on-white, a line of instructions aimed at the
model, a paragraph at 0.1pt. It is the most widely documented way of gaming a
CV-screening system and it cannot be done by accident, which is why
`integrity/domain.py` rates it HIGH.

**This module finds hidden text. It does not decide what that means.** The
rules, the severity and the evidence shown to a reviewer all live in
`integrity`, which never imports this. Here we answer one question per text
chunk: *would a human looking at the page see this?*

## Why it never changes what gets scored

`raw_text` is produced by pypdf's ordinary `extract_text()`, which returns
hidden and visible text alike — it has no notion of the difference. This
module runs a **second, separate pass** and adds a new field. The scored text
is byte-identical to what it was before, so **no score moves and nothing needs
re-scoring** (invariant 1, and CLAUDE.md's "changing parser is a re-score").

That the model still reads the hidden keywords is deliberate, not an
oversight. Integrity signals never move a score (SRS 1.4.5) — the remedy for
a gamed CV is a HIGH signal removing the candidate from employer search until
a human looks, not a quietly different number.

**Do not fold the two passes into one to save the traversal.** Measured at
1.15x the plain extraction — about 125 ms on a ten-page CV, in a task nobody
is waiting on. Reconstructing `raw_text` from visitor callbacks instead would
have to reproduce pypdf's spacing and ordering exactly, and being one
character out would move every score computed afterwards.

## Conservative on purpose

A HIGH signal removes someone from search *before* anyone has looked at them,
so a false positive here costs a real candidate real work. Every threshold
below is set to refuse rather than guess, and two cases are deliberately
**not** reported:

* **OCR text layers.** A scanned CV run through Acrobat or ABBYY carries an
  invisible text layer over the page image — every character is render mode
  3. That is the normal output of a scanner, not an attack. So invisible-mode
  text is reported only when it is a *minority* of the document
  (`MAX_INVISIBLE_RATIO`); when nearly all of it is invisible, this is a
  searchable scan and we say nothing.
* **White text on a dark banner or sidebar.** Common in CV templates: a
  coloured header with the name reversed out of it, or a two-column layout
  whose whole left column -- summary, job titles, section headings -- is
  white on navy. Revision 1 looked only at the text's fill colour, so it
  called all of that hidden; on UAT, 2026-11-26, it raised HIGH on a real
  candidate for 38 chunks of their own summary. Since revision 2 the pass
  also records **what is painted under the text** (`_Backdrop`): every
  filled path (`re`, and `m`/`l`/`c` shapes by bounding box), image and
  shading, in paint order with its fill colour and the CTM. Near-white text
  is reported only when the topmost paint under it is near-white too, or
  nothing is painted there at all -- white on an unpainted page is still
  white on white.

  **Undecidable backgrounds count as dark**, because that is the direction
  that misses rather than guesses: a pattern or ICC fill, an image (a photo
  header could be any colour), a `sh` shading (it fills the clip, which we
  do not track, so it covers the page) and a curved shape's bounding box all
  make the white text over them visible. A *white* paint is trusted to
  restore a white background only when it is an exact axis-aligned
  rectangle; a white shape's bounding box over-states it, and over-stating
  white is the false-positive direction. A chunk is judged at its start
  (two points: the baseline origin and a third of an em above it), so a run
  that starts on a band and runs off it is not reported. That is a miss, by
  design.

  Form XObjects are a known gap, as before: pypdf walks their operators
  with the CTM reset, so their paints land in the wrong place. Whatever a
  form paints is still recorded, and a misplaced dark paint can only hide a
  finding, never make one.

## How it reads the page

pypdf gives two callbacks on one pass. `visitor_operand_before` sees every
operator, so we keep a small graphics state (fill colour, text render mode,
and a `q`/`Q` stack). `visitor_text` then delivers each text chunk, and we
read the state as it stands at that moment.

**That ordering is correct, and it was worth checking.** pypdf flushes an
accumulated chunk when the text position jumps, *before* applying whatever
comes next — so in `rg white / Tj / Tm / rg black / Tj / ET` the first chunk
is delivered while the state is still white. The one case it merges is two
`Tj` with a colour change and no reposition between them, which is attributed
to the later colour: a miss, never a false positive. That is the right way
round for a rule that hides people.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from app.core.logging import get_logger

logger = get_logger(__name__)

#: Bump when the detection logic changes in a way that alters what is found.
#: Recorded alongside the text so a stored analysis says which version of
#: these rules produced it.
#:
#: * "1" (2026-09-22): fill colour alone decided near-white.
#: * "2" (2026-11-26): near-white text over a darker paint is visible (PDF:
#:   filled paths, images, shadings; .docx: cell, paragraph and run shading,
#:   highlight, page background). Versions analysed under "1" are not
#:   re-checked -- see `docs/progress.md`.
DETECTOR_REVISION: Final = "2"

# ---------------------------------------------------------------------------
# Thresholds. Every one of these is set to under-report.
# ---------------------------------------------------------------------------
#: Relative luminance at or above which fill counts as "white". 1.0 is pure
#: white; 0.92 is a very light grey. Deliberately high: light-grey body text
#: is a real design choice on a real CV, and only something indistinguishable
#: from the page should be called hidden.
NEAR_WHITE_LUMINANCE: Final = 0.92

#: Effective points (font size after the text and current transformation
#: matrices) below which text cannot be read. Nothing legitimate renders
#: under a point; 6pt is small print, 1pt is not print.
TINY_FONT_POINTS: Final = 1.0

#: How far outside the page box text must start before it counts as off-page,
#: in points. One inch of slack, because a text origin can sit slightly
#: outside the box for ordinary reasons (a descender, a rotated run) without
#: anything being hidden.
OFF_PAGE_MARGIN: Final = 72.0

#: Above this share of invisible-mode chunks the document is an OCR text
#: layer over a scan, not a CV with something buried in it. See the module
#: docstring. Applies ONLY to render-mode invisibility -- a document that is
#: entirely white-on-white is still reported, because no scanner produces
#: that.
MAX_INVISIBLE_RATIO: Final = 0.9

#: Minimum chunks before the ratio above means anything. On a two-chunk page
#: a ratio is noise.
MIN_CHUNKS_FOR_RATIO: Final = 5

#: Hidden text is evidence, not content. A cap keeps a hostile document from
#: putting a megabyte of white text into a JSONB column.
MAX_HIDDEN_CHARS: Final = 20_000

#: PDF text rendering modes that paint nothing. 3 is "invisible"; 7 is "add
#: to clipping path" and paints no glyph either.
INVISIBLE_RENDER_MODES: Final = frozenset({3, 7})

#: Reasons, as stored. Strings rather than an enum because they are written
#: to JSONB and read by a reviewer.
INVISIBLE_RENDER_MODE: Final = "INVISIBLE_RENDER_MODE"
NEAR_WHITE_FILL: Final = "NEAR_WHITE_FILL"
TINY_FONT: Final = "TINY_FONT"
OFF_PAGE: Final = "OFF_PAGE"


@dataclass(frozen=True, slots=True)
class HiddenTextReport:
    """What the analysis found, and whether it ran at all.

    **`analysed=False` is not the same as finding nothing**, and keeping them
    apart is the point. A stored `""` from a successful pass means "we looked
    and the CV is clean"; a failed pass means "nobody knows". Collapsing the
    two would be the same lie `scanner.py` refuses to tell when it records
    PENDING rather than CLEAN.
    """

    text: str = ""
    reasons: tuple[str, ...] = ()
    analysed: bool = True
    #: Chunks examined, for a reviewer judging how much of the CV this is.
    chunks: int = 0
    hidden_chunks: int = 0
    detector_version: str = DETECTOR_REVISION

    def as_stored(self) -> dict[str, Any]:
        """The shape written into `resume_versions.parsed`."""
        return {
            "analysed": self.analysed,
            "text": self.text,
            "reasons": list(self.reasons),
            "chunks": self.chunks,
            "hidden_chunks": self.hidden_chunks,
            "detector_version": self.detector_version,
        }


NOT_ANALYSED: Final = HiddenTextReport(analysed=False)


# ---------------------------------------------------------------------------
# Colour
# ---------------------------------------------------------------------------
def _luminance(operands: list[Any]) -> float | None:
    """Relative luminance from a colour operator's operands, or None when we
    cannot tell.

    The operand *count* identifies the space: 1 is grey, 3 is RGB, 4 is CMYK.
    That is how `sc`/`scn` are read too rather than tracking `cs`, because a
    pattern or ICC space arrives as a name and we want "unknown" there —
    unknown must mean visible, never hidden.
    """
    try:
        numbers = [float(o) for o in operands]
    except (TypeError, ValueError):
        return None

    if len(numbers) == 1:
        grey = numbers[0]
        return grey if 0.0 <= grey <= 1.0 else None
    if len(numbers) == 3:
        r, g, b = numbers
        if not all(0.0 <= c <= 1.0 for c in (r, g, b)):
            return None
        # Rec. 601 luma. Any reasonable weighting gives the same answer at
        # the extremes, which is all this is used for.
        return 0.299 * r + 0.587 * g + 0.114 * b
    if len(numbers) == 4:
        c, m, y, k = numbers
        if not all(0.0 <= v <= 1.0 for v in (c, m, y, k)):
            return None
        r, g, b = (1.0 - c) * (1.0 - k), (1.0 - m) * (1.0 - k), (1.0 - y) * (1.0 - k)
        return 0.299 * r + 0.587 * g + 0.114 * b
    return None


def _scale(matrix: Any) -> float:
    """The uniform scale factor of a 2x3 matrix, as sqrt of |determinant|.

    Used to turn a nominal font size into rendered points: a PDF may say
    `/F1 1 Tf` and scale by 12 in the text matrix, and reading the nominal 1
    would call every such document tiny.
    """
    try:
        a, b, c, d = float(matrix[0]), float(matrix[1]), float(matrix[2]), float(matrix[3])
    except (TypeError, ValueError, IndexError):
        return 1.0
    determinant = abs(a * d - b * c)
    return math.sqrt(determinant) if determinant > 0 else 0.0


def _device_origin(cm: Any, tm: Any) -> tuple[float, float] | None:
    """Where a chunk starts on the page, with the CTM applied."""
    try:
        x, y = float(tm[4]), float(tm[5])
        a, b, c, d = float(cm[0]), float(cm[1]), float(cm[2]), float(cm[3])
        e, f = float(cm[4]), float(cm[5])
    except (TypeError, ValueError, IndexError):
        return None
    return (a * x + c * y + e, b * x + d * y + f)


# ---------------------------------------------------------------------------
# What is painted under the text
# ---------------------------------------------------------------------------
_Matrix = tuple[float, float, float, float, float, float]
_Box = tuple[float, float, float, float]  # left, bottom, right, top

#: Operators that fill the current path (and, for the B family, stroke it).
_FILL_OPERATORS: Final = frozenset({"f", "F", "f*", "B", "B*", "b", "b*"})
#: Operators that build a path.
_PATH_OPERATORS: Final = frozenset({"m", "l", "c", "v", "y", "h", "re"})
#: Operators that end a path without filling it.
_NO_FILL_OPERATORS: Final = frozenset({"n", "S", "s"})

#: Slack around a painted box when asking whether a point is inside it, in
#: points. A baseline sitting exactly on a band's edge is on the band.
_BOX_SLACK: Final = 0.5

#: How far above the baseline, in ems, the second sample point of a chunk
#: sits. The baseline alone can fall just below a band that the glyphs are
#: plainly on.
_SAMPLE_HEIGHT_EM: Final = 0.33

#: A hostile page could paint a million rectangles to make the lookup slow.
#: Past this many the page's backdrop is undecidable, which counts as dark.
MAX_PAINTS_PER_PAGE: Final = 5_000


def _matrix(value: Any) -> _Matrix | None:
    try:
        a, b, c, d, e, f = (float(value[i]) for i in range(6))
    except (TypeError, ValueError, IndexError):
        return None
    return (a, b, c, d, e, f)


def _apply(m: _Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


def _is_axis_aligned(m: _Matrix) -> bool:
    """Whether a rectangle stays a rectangle under this matrix: no rotation
    other than quarter turns, and no shear."""
    a, b, c, d, _, _ = m
    return (b == 0.0 and c == 0.0) or (a == 0.0 and d == 0.0)


def _bounds(points: Sequence[tuple[float, float]]) -> _Box:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


@dataclass(frozen=True, slots=True)
class _Paint:
    box: _Box
    #: None when the colour cannot be read (pattern, ICC, image, shading).
    luminance: float | None
    #: True only when `box` is exactly the painted area -- an axis-aligned
    #: `re` that was the whole path. A white paint must be exact to count,
    #: because a bounding box over-states it.
    exact: bool

    def contains(self, x: float, y: float) -> bool:
        left, bottom, right, top = self.box
        return (
            left - _BOX_SLACK <= x <= right + _BOX_SLACK
            and bottom - _BOX_SLACK <= y <= top + _BOX_SLACK
        )


@dataclass
class _Backdrop:
    """Everything painted on one page so far, in paint order.

    Answers one question: is the topmost paint under a point something a
    near-white glyph would stand out against? See the module docstring for
    why every undecidable answer is "yes".
    """

    paints: list[_Paint] = field(default_factory=list)
    #: Set when the page can no longer be judged (a `sh`, or too many paints).
    #: From then on every point counts as painted dark.
    undecidable: bool = False

    def add(self, paint: _Paint) -> None:
        if self.undecidable:
            return
        if len(self.paints) >= MAX_PAINTS_PER_PAGE:
            self.undecidable = True
            self.paints.clear()
            return
        self.paints.append(paint)

    def is_dark_under(self, x: float, y: float) -> bool:
        if self.undecidable:
            return True
        for paint in reversed(self.paints):
            if not paint.contains(x, y):
                continue
            if paint.luminance is None or paint.luminance < NEAR_WHITE_LUMINANCE:
                return True
            if paint.exact:
                # A white rectangle painted over whatever was below: the
                # background here really is white again.
                return False
            # A white shape known only by its bounding box. It may not
            # cover this point, so look at what is underneath.
        return False


@dataclass
class _Path:
    """The path under construction, in device space."""

    rects: list[tuple[_Box, bool]] = field(default_factory=list)
    points: list[tuple[float, float]] = field(default_factory=list)
    #: True once anything other than `re` has been used.
    freeform: bool = False

    def clear(self) -> None:
        self.rects.clear()
        self.points.clear()
        self.freeform = False

    def paints(self, luminance: float | None) -> list[_Paint]:
        if self.freeform:
            every = self.points + [
                corner for box, _ in self.rects for corner in ((box[0], box[1]), (box[2], box[3]))
            ]
            return [_Paint(_bounds(every), luminance, exact=False)] if every else []
        # Several rectangles in one path can cut holes in each other (even-odd
        # fill, or opposite windings), so only a lone one is exact.
        lone = len(self.rects) == 1
        return [_Paint(box, luminance, exact=lone and aligned) for box, aligned in self.rects]


@dataclass
class _GraphicsState:
    """The slice of PDF graphics state that decides visibility."""

    fill_luminance: float | None = None  # None = unknown, treated as visible
    render_mode: int = 0

    def copy(self) -> _GraphicsState:
        return _GraphicsState(self.fill_luminance, self.render_mode)


@dataclass
class _Chunk:
    text: str
    reason: str


@dataclass
class _Collector:
    """Walks one page's operators and text."""

    media_box: tuple[float, float, float, float]
    #: The page's `/XObject` resources, to tell an image from a form.
    xobjects: Any = None
    state: _GraphicsState = field(default_factory=_GraphicsState)
    stack: list[_GraphicsState] = field(default_factory=list)
    backdrop: _Backdrop = field(default_factory=_Backdrop)
    path: _Path = field(default_factory=_Path)
    chunks: int = 0
    invisible_mode_chunks: int = 0
    found: list[_Chunk] = field(default_factory=list)

    # -- operators ---------------------------------------------------------
    def on_operand(self, operator: bytes, operands: list[Any], cm: Any, _tm: Any) -> None:
        op = (
            operator.decode("ascii", errors="replace")
            if isinstance(operator, bytes)
            else str(operator)
        )

        if op in _PATH_OPERATORS or op in _FILL_OPERATORS or op in _NO_FILL_OPERATORS:
            self._on_path(op, operands, cm)
        elif op == "Do":
            self._on_xobject(operands, cm)
        elif op == "INLINE IMAGE":
            self._paint_unit_square(cm)
        elif op == "sh":
            # A shading fills the current clip, which this pass does not
            # track: it may cover the whole page, in colours we cannot read.
            self.backdrop.undecidable = True
        elif op == "q":
            self.stack.append(self.state.copy())
        elif op == "Q":
            # An unbalanced Q is malformed; ignoring it beats raising inside
            # a callback pypdf will not expect to fail.
            if self.stack:
                self.state = self.stack.pop()
        elif op == "gs":
            # An ExtGState can set fill alpha (`/ca 0` is invisible text, a
            # real trick). Reading it means resolving the named resource,
            # which this pass does not do -- recorded as a known gap rather
            # than guessed at. See the module docstring.
            pass
        elif op in ("rg", "g", "k", "sc", "scn"):
            self.state.fill_luminance = _luminance(operands)
        elif op == "cs":
            # Choosing a colour space resets the colour to that space's
            # initial value, which we do not resolve: unknown, so visible.
            self.state.fill_luminance = None
        elif op == "Tr":
            try:
                self.state.render_mode = int(operands[0])
            except (TypeError, ValueError, IndexError):
                self.state.render_mode = 0

    # -- painting ----------------------------------------------------------
    def _on_path(self, op: str, operands: list[Any], cm: Any) -> None:
        m = _matrix(cm)
        if op in _FILL_OPERATORS:
            for paint in self.path.paints(self.state.fill_luminance):
                self.backdrop.add(paint)
            self.path.clear()
            return
        if op in _NO_FILL_OPERATORS:
            self.path.clear()
            return
        if m is None:
            # A path we cannot place. Whatever it paints is undecidable.
            self.backdrop.undecidable = True
            return
        if op == "re":
            try:
                x, y, w, h = (float(o) for o in operands[:4])
            except (TypeError, ValueError):
                return
            corners = [_apply(m, x, y), _apply(m, x + w, y), _apply(m, x, y + h)]
            corners.append(_apply(m, x + w, y + h))
            self.path.rects.append((_bounds(corners), _is_axis_aligned(m)))
            return
        if op == "h":
            return
        # m, l, c, v, y: a freeform shape, kept as the bounding box of every
        # point named -- control points included, which only makes it larger.
        self.path.freeform = True
        try:
            numbers = [float(o) for o in operands]
        except (TypeError, ValueError):
            return
        for i in range(0, len(numbers) - 1, 2):
            self.path.points.append(_apply(m, numbers[i], numbers[i + 1]))

    def _on_xobject(self, operands: list[Any], cm: Any) -> None:
        """An image paints the unit square under the CTM, in colours we do not
        read. A form's own operators reach `on_operand` through pypdf, so it
        paints nothing here."""
        try:
            subtype = self.xobjects[operands[0]]["/Subtype"]
        except Exception:
            subtype = None
        if subtype == "/Form":
            return
        self._paint_unit_square(cm)

    def _paint_unit_square(self, cm: Any) -> None:
        m = _matrix(cm)
        if m is None:
            self.backdrop.undecidable = True
            return
        corners = [_apply(m, 0, 0), _apply(m, 1, 0), _apply(m, 0, 1), _apply(m, 1, 1)]
        self.backdrop.add(_Paint(_bounds(corners), None, exact=False))

    def _covered(self, cm: Any, tm: Any, font_size: Any) -> bool:
        """Whether something darker than the page is painted under this
        chunk's start. Undecidable counts as covered."""
        m_cm, m_tm = _matrix(cm), _matrix(tm)
        if m_cm is None or m_tm is None:
            return True
        try:
            size = float(font_size)
        except (TypeError, ValueError):
            size = 0.0
        for tx, ty in ((0.0, 0.0), (0.0, size * _SAMPLE_HEIGHT_EM)):
            x, y = _apply(m_cm, *_apply(m_tm, tx, ty))
            if self.backdrop.is_dark_under(x, y):
                return True
        return False

    # -- text --------------------------------------------------------------
    def on_text(self, text: str, cm: Any, tm: Any, _font: Any, font_size: Any) -> None:
        if not text or not text.strip():
            return
        self.chunks += 1

        reason = self._reason(cm, tm, font_size)
        if reason is None:
            return
        if reason == INVISIBLE_RENDER_MODE:
            self.invisible_mode_chunks += 1
        self.found.append(_Chunk(text.strip(), reason))

    def _reason(self, cm: Any, tm: Any, font_size: Any) -> str | None:
        """Why this chunk would not be seen, or None if it would."""
        if self.state.render_mode in INVISIBLE_RENDER_MODES:
            return INVISIBLE_RENDER_MODE

        luminance = self.state.fill_luminance
        if (
            luminance is not None
            and luminance >= NEAR_WHITE_LUMINANCE
            and not self._covered(cm, tm, font_size)
        ):
            return NEAR_WHITE_FILL

        try:
            nominal = float(font_size)
        except (TypeError, ValueError):
            nominal = 0.0
        effective = abs(nominal) * _scale(tm) * _scale(cm)
        if effective < TINY_FONT_POINTS:
            return TINY_FONT

        origin = _device_origin(cm, tm)
        if origin is not None:
            x, y = origin
            left, bottom, right, top = self.media_box
            if (
                x < left - OFF_PAGE_MARGIN
                or x > right + OFF_PAGE_MARGIN
                or y < bottom - OFF_PAGE_MARGIN
                or y > top + OFF_PAGE_MARGIN
            ):
                return OFF_PAGE
        return None


def _media_box(page: Any) -> tuple[float, float, float, float]:
    """US Letter if the page does not say. Only used for the off-page test,
    where a wrong box makes us *less* likely to report, not more."""
    try:
        box = page.mediabox
        left, bottom, right, top = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
        if right > left and top > bottom:
            return (left, bottom, right, top)
    except Exception as exc:  # a malformed box is not an error
        logger.debug("hidden_text_media_box_unreadable", error=str(exc))
    return (0.0, 0.0, 612.0, 792.0)


def _xobjects(page: Any) -> Any:
    """The page's `/XObject` dictionary, or None. Only used to tell an image
    from a form; an unreadable one makes every `Do` an image, which can only
    make text over it visible."""
    try:
        resources = page["/Resources"].get_object()
        return resources["/XObject"].get_object()
    except Exception:
        return None


def find_hidden_text(pages: Sequence[Any]) -> HiddenTextReport:
    """Analyse already-loaded pypdf pages for text a reader cannot see.

    **Never raises.** A CV that cannot be analysed must still parse, score and
    reach an employer; a detector that could fail an upload would be a worse
    bug than the one it closes. Any failure returns `NOT_ANALYSED`, which
    stores as "nobody looked" rather than "nothing found".
    """
    try:
        return _find(pages)
    except Exception as exc:
        logger.warning("hidden_text_analysis_failed", error=str(exc))
        return NOT_ANALYSED


def _find(pages: Sequence[Any]) -> HiddenTextReport:
    total_chunks = 0
    total_invisible = 0
    found: list[_Chunk] = []

    for page in pages:
        collector = _Collector(media_box=_media_box(page), xobjects=_xobjects(page))
        # A second pass, separate from the one that produced `raw_text`, so
        # the scored text cannot be affected by anything here.
        page.extract_text(
            visitor_operand_before=collector.on_operand,
            visitor_text=collector.on_text,
        )
        total_chunks += collector.chunks
        total_invisible += collector.invisible_mode_chunks
        found.extend(collector.found)

    # The OCR-layer discriminator. Drops invisible-mode findings only; a
    # white-on-white document is still reported however much of it there is.
    if (
        total_chunks >= MIN_CHUNKS_FOR_RATIO
        and total_invisible / total_chunks > MAX_INVISIBLE_RATIO
    ):
        logger.info(
            "hidden_text_invisible_layer_ignored",
            chunks=total_chunks,
            invisible=total_invisible,
            detail="whole-document invisible text reads as an OCR layer over a scan",
        )
        found = [c for c in found if c.reason != INVISIBLE_RENDER_MODE]

    if not found:
        return HiddenTextReport(analysed=True, chunks=total_chunks)

    text = "\n".join(c.text for c in found)[:MAX_HIDDEN_CHARS]
    return HiddenTextReport(
        text=text,
        reasons=tuple(sorted({c.reason for c in found})),
        analysed=True,
        chunks=total_chunks,
        hidden_chunks=len(found),
    )


# ---------------------------------------------------------------------------
# .docx
# ---------------------------------------------------------------------------
#: Word's own "hidden text" attribute (`w:vanish`). Word will not print or
#: display it by default, and text extraction reads it regardless -- the same
#: asymmetry the PDF tricks exploit, with a dedicated feature for it.
def find_hidden_runs(document: Any) -> HiddenTextReport:
    """The .docx equivalent: runs marked hidden, or coloured like the page.

    Narrower than the PDF pass by design. Word has no text render mode and no
    absolute positioning to abuse in the same way, so the two vectors that
    remain are the `hidden` font attribute and white-on-white.
    """
    try:
        return _find_runs(document)
    except Exception as exc:
        logger.warning("hidden_runs_analysis_failed", error=str(exc))
        return NOT_ANALYSED


def _hex_luminance(value: Any) -> float | None:
    """Luminance of a Word `RRGGBB` colour, or None when it is not one."""
    rgb = str(value)
    if len(rgb) != 6:
        return None
    try:
        r, g, b = (int(rgb[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return None
    return 0.299 * r + 0.587 * g + 0.114 * b


def _run_luminance(run: Any) -> float | None:
    try:
        colour = run.font.color
        if colour is None or colour.rgb is None:
            return None
        return _hex_luminance(colour.rgb)
    except Exception:
        return None


_W_NS: Final = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _w(name: str) -> str:
    return f"{{{_W_NS}}}{name}"


#: `w:highlight` values that leave the background as the page.
_PAGE_HIGHLIGHTS: Final = frozenset({"none", "white"})

#: How far up a style's `basedOn` chain to look. A damaged file can loop; a
#: cap is cheaper than detecting the cycle.
_MAX_STYLE_DEPTH: Final = 10


def _shading_is_dark(shd: Any) -> bool:
    """Whether one `w:shd` paints something a near-white run stands out
    against. Undecidable (a pattern, a theme colour with no cached value)
    counts as dark -- the direction that misses rather than guesses.

    `clear` means "no pattern", so the background is `w:fill`; `solid` is a
    100% pattern, so it is `w:color`; anything else mixes the two.
    """
    pattern = shd.get(_w("val"))
    if pattern == "nil":
        return False
    if pattern == "clear":
        colour = shd.get(_w("fill"))
    elif pattern == "solid":
        colour = shd.get(_w("color"))
    else:
        return True
    if colour is None or colour == "auto":
        # Nothing painted -- unless a theme colour is named without a cached
        # value, which we cannot resolve.
        return shd.get(_w("themeFill")) is not None
    luminance = _hex_luminance(colour)
    return luminance is None or luminance < NEAR_WHITE_LUMINANCE


def _shades_dark(element: Any, properties: str) -> bool:
    """Whether `element` (a `w:p`, `w:r`, `w:tc` or `w:tbl`) has a dark
    `w:shd` or highlight in its `properties` child (`pPr`, `rPr`, ...)."""
    if element is None:
        return False
    pr = element.find(_w(properties))
    if pr is None:
        return False
    shd = pr.find(_w("shd"))
    if shd is not None and _shading_is_dark(shd):
        return True
    highlight = pr.find(_w("highlight"))
    return highlight is not None and highlight.get(_w("val")) not in _PAGE_HIGHLIGHTS


def _style_shades_dark(style: Any) -> bool:
    """Whether a paragraph or table style, or one it is based on, shades
    anything dark. A table style's shading may apply only to its header row
    or banded rows; we do not resolve which, so any dark shading anywhere in
    the style makes the whole table count. Over-stating dark is a miss."""
    for _ in range(_MAX_STYLE_DEPTH):
        if style is None:
            return False
        element = getattr(style, "element", None)
        if element is not None:
            if any(_shading_is_dark(shd) for shd in element.iter(_w("shd"))):
                return True
            if any(h.get(_w("val")) not in _PAGE_HIGHLIGHTS for h in element.iter(_w("highlight"))):
                return True
        style = getattr(style, "base_style", None)
    return False


def _page_is_dark(document: Any) -> bool:
    """`w:background`, the page colour. Word shows it on screen, so white
    text on a dark page is visible."""
    background = document.element.find(_w("background"))
    if background is None:
        return False
    colour = background.get(_w("color"))
    if colour is None or colour == "auto":
        return background.get(_w("themeColor")) is not None
    luminance = _hex_luminance(colour)
    return luminance is None or luminance < NEAR_WHITE_LUMINANCE


def _safely(check: Callable[..., bool], *args: Any) -> bool:
    """A background check that cannot fail the analysis. An unreadable
    background is undecidable, so it counts as dark."""
    try:
        return check(*args)
    except Exception:
        return True


def _find_runs(document: Any) -> HiddenTextReport:
    found: list[_Chunk] = []
    chunks = 0
    page_dark = _safely(_page_is_dark, document)

    def walk(paragraphs: Any, *, behind_is_dark: bool) -> None:
        nonlocal chunks
        for paragraph in paragraphs:
            paragraph_dark = (
                behind_is_dark
                or _safely(_shades_dark, paragraph._p, "pPr")
                or _safely(_style_shades_dark, getattr(paragraph, "style", None))
            )
            for run in paragraph.runs:
                if not run.text or not run.text.strip():
                    continue
                chunks += 1
                if getattr(run.font, "hidden", None) is True:
                    found.append(_Chunk(run.text.strip(), INVISIBLE_RENDER_MODE))
                    continue
                luminance = _run_luminance(run)
                if luminance is None or luminance < NEAR_WHITE_LUMINANCE:
                    continue
                if paragraph_dark or _safely(_shades_dark, run._r, "rPr"):
                    # White on a shaded cell, paragraph or run: a sidebar or
                    # a header band, and plainly visible.
                    continue
                found.append(_Chunk(run.text.strip(), NEAR_WHITE_FILL))

    walk(document.paragraphs, behind_is_dark=page_dark)
    for table in document.tables:
        table_dark = (
            page_dark
            or _safely(_shades_dark, table._tbl, "tblPr")
            or _safely(_style_shades_dark, getattr(table, "style", None))
        )
        for row in table.rows:
            for cell in row.cells:
                cell_dark = table_dark or _safely(_shades_dark, cell._tc, "tcPr")
                walk(cell.paragraphs, behind_is_dark=cell_dark)

    if not found:
        return HiddenTextReport(analysed=True, chunks=chunks)
    return HiddenTextReport(
        text="\n".join(c.text for c in found)[:MAX_HIDDEN_CHARS],
        reasons=tuple(sorted({c.reason for c in found})),
        analysed=True,
        chunks=chunks,
        hidden_chunks=len(found),
    )


# ---------------------------------------------------------------------------
# Reading it back
# ---------------------------------------------------------------------------
def hidden_text_of(parsed: Any) -> str:
    """The hidden text stored on a `resume_versions.parsed` document.

    Paired with `HiddenTextReport.as_stored`, so the shape has one writer and
    one reader. Returns `""` for all three of:

    * a version created before 2026-09-22, where the key is absent;
    * an analysis that failed (`analysed: false`);
    * a CV that was analysed and is clean.

    **Collapsing those three here is deliberate** -- the integrity rules take
    text, and "no hidden text to judge" is the honest answer in all three
    cases. What must not be collapsed is the *record*, and it is not: the
    stored document keeps `analysed` and `detector_version`, so a reviewer
    asking "was this CV ever checked?" gets a real answer. A rule that fired
    on "unknown" would suppress candidates for our own missing data.
    """
    if not isinstance(parsed, dict):
        return ""
    stored = parsed.get("hidden_text")
    if not isinstance(stored, dict) or stored.get("analysed") is not True:
        return ""
    text = stored.get("text")
    return text if isinstance(text, str) else ""


def was_analysed(parsed: Any) -> bool:
    """Whether anyone has looked. For the admin console and for tests; no rule
    reads this, because a rule acting on our own missing data would hide
    candidates for a reason that is nothing to do with them."""
    if not isinstance(parsed, dict):
        return False
    stored = parsed.get("hidden_text")
    return isinstance(stored, dict) and stored.get("analysed") is True
