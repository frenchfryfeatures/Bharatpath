"""resume - pure domain logic

Upload, parse jobs, versions, review and confirm.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Final

#: Magic numbers, longest first so a prefix never shadows a longer match.
#:
#: **The declared Content-Type and the filename are both attacker-controlled**
#: (SRS 1.4.2), so neither is consulted. A file is what its bytes say it is.
#: DOCX is a ZIP container, which is why it and any other OOXML share a
#: signature -- `sniff_mime` resolves that ambiguity below.
_SIGNATURES: Final[tuple[tuple[bytes, str], ...]] = (
    (b"%PDF-", "application/pdf"),
    # Legacy .doc: the OLE2 compound-document header.
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "application/msword"),
    # Any ZIP. DOCX is a ZIP; so is a JAR and so is a zip bomb.
    (b"PK\x03\x04", "application/zip"),
    (b"PK\x05\x06", "application/zip"),  # empty archive
    (b"PK\x07\x08", "application/zip"),  # spanned archive
)

DOCX: Final = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
#: Still recognised, so it can be refused by name rather than as "unknown".
LEGACY_DOC: Final = "application/msword"

#: A DOCX always carries this, and a plain ZIP does not. Checking for it is
#: what stops any renamed `.zip` walking in through the DOCX door.
_DOCX_MARKER: Final = b"word/"


@dataclass(frozen=True, slots=True)
class UploadRejection:
    """Why an upload cannot become a resume. `code` is the API error code."""

    code: str
    detail: str


def sniff_mime(head: bytes) -> str | None:
    """Identify a document from its leading bytes. `None` means unrecognised.

    Only the `head` is needed -- every signature here lives in the first few
    bytes. The DOCX marker is normally in the first KiB too, in the local file
    header for `word/document.xml`; a DOCX whose marker falls outside the
    sniffed window reads as a plain ZIP and is rejected. That is the safe
    direction to be wrong in.
    """
    for signature, mime in _SIGNATURES:
        if head.startswith(signature):
            if mime == "application/zip":
                return DOCX if _DOCX_MARKER in head else "application/zip"
            return mime
    return None


def validate_upload(
    *,
    head: bytes,
    size_bytes: int,
    max_bytes: int,
    allowed: list[str],
) -> UploadRejection | None:
    """The complete gate between an uploaded object and a `resume_files` row.

    Returns the reason to refuse, or `None` to accept. Pure, so every branch
    is testable without S3 -- and callable again later against the same bytes
    if the caps ever change.

    Order matters: size is checked before content, so an oversized upload is
    refused without reading it.
    """
    if size_bytes <= 0:
        return UploadRejection("upload_empty", "The uploaded file is empty.")

    if size_bytes > max_bytes:
        return UploadRejection(
            "upload_too_large",
            f"File is {size_bytes} bytes; the limit is {max_bytes}.",
        )

    mime = sniff_mime(head)
    if mime is None:
        return UploadRejection(
            "upload_unrecognised_type",
            "The file is not a PDF or Word document.",
        )
    if mime not in allowed:
        if mime == LEGACY_DOC:
            # Its own code: the remedy is one the candidate can act on.
            return UploadRejection(
                "upload_legacy_doc_unsupported",
                "Legacy .doc files are not accepted; save as PDF or .docx.",
            )
        return UploadRejection(
            "upload_unsupported_type",
            f"{mime} is not an accepted resume format.",
        )
    return None


def upload_key(*, user_id: uuid.UUID, upload_id: uuid.UUID) -> str:
    """Where the object lives, derived server-side from ids we issued.

    **The client never supplies a key.** If it did, one candidate could name
    another candidate's prefix and overwrite their CV -- a presigned PUT
    authorises exactly the key it was signed for, so the key *is* the
    authorisation. Deriving it from the authenticated user closes that.
    """
    return f"resumes/{user_id}/{upload_id}"


#: Characters removed before anything else. C0 controls and DEL, minus the
#: three that carry meaning in pasted text (`\t`, `\n`, `\r`).
#:
#: **NUL is the one that mattered.** Postgres cannot store `\x00` in a text
#: or JSONB value at all, so a pasted CV containing one travelled through
#: validation, through the service, and died in the asyncpg driver as
#: `A string literal cannot contain NUL (0x00) characters` -- a 500, on
#: input a candidate can send. Found by the fuzzer
#: (`tests/integration/test_api_fuzz.py`, 2026-09-22); it is trivially
#: reachable by pasting from a corrupted PDF, which is exactly the population
#: this endpoint exists for.
#:
#: The rest go with it because none of them can be typed deliberately, none
#: survives rendering, and every one of them is a way to make two CVs that
#: look identical store differently.
_CONTROL_CHARACTERS = dict.fromkeys([*range(0, 9), 11, 12, *range(14, 32), 127])


def normalise_pasted_text(raw: str) -> str:
    """Collapse the whitespace a paste from a PDF viewer brings with it.

    Kept here rather than in the service because the parser must see exactly
    what was stored: scoring has to be reproducible from the stored text
    (invariant 1), so normalisation happens once, before persistence, never
    again afterwards.

    Control characters are stripped first, for the same reason and one more:
    a value the database cannot hold is not a validation nicety, it is a 500.
    """
    raw = raw.translate(_CONTROL_CHARACTERS)
    lines = [line.strip() for line in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    out: list[str] = []
    blank = False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif not blank:
            out.append("")
            blank = True
    return "\n".join(out).strip()


# ---------------------------------------------------------------------------
# The version chain: review, edit, confirm
# ---------------------------------------------------------------------------
#: What an upload's parse can be, and the whole of it.
#:
#: **There is deliberately no RUNNING.** A worker that claims a file and then
#: dies leaves RUNNING behind forever, and nothing sweeps it -- so the state
#: that exists to reassure the candidate becomes the one that strands them.
#: QUEUED means "not finished", the parse task writes its terminal state in
#: the same transaction as the version it produced, and a worker that dies
#: leaves QUEUED, which is true and which redelivery fixes by itself.
#:
#: Known limit, stated rather than hidden: a parse that exhausts its Celery
#: retries is dead-lettered and its row stays QUEUED. The DLQ is where that
#: is noticed; polling cannot see it.
PARSE_QUEUED: Final = "QUEUED"
PARSE_DONE: Final = "DONE"
PARSE_FAILED: Final = "FAILED"
PARSE_BLOCKED: Final = "BLOCKED"
PARSE_STATES: Final[frozenset[str]] = frozenset(
    {PARSE_QUEUED, PARSE_DONE, PARSE_FAILED, PARSE_BLOCKED}
)

#: The parse states that will never change again. The client stops polling on
#: these; anything else means keep asking.
PARSE_TERMINAL: Final[frozenset[str]] = frozenset({PARSE_DONE, PARSE_FAILED, PARSE_BLOCKED})


#: The parser name recorded on a version whose content a human corrected.
#: It is deliberately not a real parser: a replay that sees this knows the
#: text it is scoring was asserted by the candidate, not extracted from the
#: document, and those are different kinds of evidence.
EDIT_PARSER: Final = "candidate-edit"
EDIT_PARSER_VERSION: Final = "1"


@dataclass(frozen=True, slots=True)
class VersionRefusal:
    """Why an operation on a version cannot proceed. `code` is the API code."""

    code: str
    detail: str


def refuse_version_change(*, is_superseded: bool) -> VersionRefusal | None:
    """The single rule that closes a version to further edits and confirmation.

    **A superseded version is finished.** Two things follow from allowing
    otherwise, and both are bugs someone would have to debug from a score:

      - *Editing* one would fork the chain. Two versions would each claim to
        supersede the same parent, and "the candidate's current resume" would
        stop having one answer.
      - *Confirming* one would make content the candidate has already replaced
        eligible for scoring, because the confirm gate asks whether a version
        is confirmed, not whether it is current.

    Pure, so both callers share one rule rather than two that drift.
    """
    if is_superseded:
        return VersionRefusal(
            "resume_version_superseded",
            "This version has been replaced by a newer one. Edit the newest version instead.",
        )
    return None


def edit_provenance(previous_extractor: dict[str, Any] | None) -> dict[str, Any]:
    """The `extractor` block for a version a human has corrected.

    **The origin is kept flat, never nested.** The obvious implementation
    embeds the previous extractor whole, which means a candidate who corrects
    their CV thirty times stores thirty levels of nested JSON and a replay has
    to recurse to find out which engine read the document. Instead `origin`
    always holds the *machine* extraction the chain started from, copied
    forward unchanged, and `edit_generation` counts the corrections.

    So the two questions a replay actually asks -- "what read this document?"
    and "how much of this did a human type?" -- are both one lookup deep no
    matter how long the chain is.
    """
    previous = previous_extractor or {}
    origin = previous.get("origin")
    if not isinstance(origin, dict):
        # First edit in this chain: the previous extractor IS the origin.
        origin = {k: v for k, v in previous.items() if k != "edit_generation"}

    generation = previous.get("edit_generation", 0)
    if not isinstance(generation, int) or generation < 0:
        generation = 0

    return {
        "parser": EDIT_PARSER,
        "parser_version": EDIT_PARSER_VERSION,
        "edit_generation": generation + 1,
        "origin": origin,
    }


def build_edited_parsed(
    *, previous_parsed: dict[str, Any], replacement: dict[str, Any]
) -> dict[str, Any]:
    """The `parsed` payload for an edited version.

    A **whole replacement**, not a patch. A partial update would have to merge
    a correction into extracted content, and the merge rule -- what happens to
    an employment row the candidate deleted, or one the parser invented -- is
    exactly the thing nobody would agree on later. The client sends the
    corrected resume entire, so what is stored is what the candidate saw and
    approved, which is also what the confirm gate is for.

    The one thing carried forward is provenance: `extractor` is rebuilt rather
    than copied, so the document that started the chain stays attributable.
    """
    parsed = {k: v for k, v in replacement.items() if k != "extractor"}
    parsed["extractor"] = edit_provenance(previous_parsed.get("extractor"))
    return parsed
