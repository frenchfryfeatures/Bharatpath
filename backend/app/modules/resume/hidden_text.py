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
* **White text on a dark banner.** Common in CV templates: a coloured header
  with the candidate's name reversed out of it. We cannot see the banner from
  the text operators alone, so near-white text is reported as found and the
  *rule* applies the length floor — `hidden_text_min_chars` is 80, and a name
  and job title are nowhere near that. Tracking filled rectangles to rule this
  out properly is possible and is not worth the machinery today.

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
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from app.core.logging import get_logger

logger = get_logger(__name__)

#: Bump when the detection logic changes in a way that alters what is found.
#: Recorded alongside the text so a stored analysis says which version of
#: these rules produced it.
DETECTOR_REVISION: Final = "1"

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
    state: _GraphicsState = field(default_factory=_GraphicsState)
    stack: list[_GraphicsState] = field(default_factory=list)
    chunks: int = 0
    invisible_mode_chunks: int = 0
    found: list[_Chunk] = field(default_factory=list)

    # -- operators ---------------------------------------------------------
    def on_operand(self, operator: bytes, operands: list[Any], _cm: Any, _tm: Any) -> None:
        op = (
            operator.decode("ascii", errors="replace")
            if isinstance(operator, bytes)
            else str(operator)
        )

        if op == "q":
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
        elif op == "Tr":
            try:
                self.state.render_mode = int(operands[0])
            except (TypeError, ValueError, IndexError):
                self.state.render_mode = 0

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
        if luminance is not None and luminance >= NEAR_WHITE_LUMINANCE:
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
        collector = _Collector(media_box=_media_box(page))
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


def _run_luminance(run: Any) -> float | None:
    try:
        colour = run.font.color
        if colour is None or colour.rgb is None:
            return None
        rgb = str(colour.rgb)
        if len(rgb) != 6:
            return None
        r, g, b = (int(rgb[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except Exception:
        return None
    return 0.299 * r + 0.587 * g + 0.114 * b


def _find_runs(document: Any) -> HiddenTextReport:
    found: list[_Chunk] = []
    chunks = 0

    def walk(paragraphs: Any) -> None:
        nonlocal chunks
        for paragraph in paragraphs:
            for run in paragraph.runs:
                if not run.text or not run.text.strip():
                    continue
                chunks += 1
                if getattr(run.font, "hidden", None) is True:
                    found.append(_Chunk(run.text.strip(), INVISIBLE_RENDER_MODE))
                    continue
                luminance = _run_luminance(run)
                if luminance is not None and luminance >= NEAR_WHITE_LUMINANCE:
                    found.append(_Chunk(run.text.strip(), NEAR_WHITE_FILL))

    walk(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                walk(cell.paragraphs)

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
