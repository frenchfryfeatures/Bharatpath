"""kyb - pure domain logic

Submissions, documents, review state machine.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Built in full, then short-circuited by one switch** (R15, confirmed
2026-08-27). With `kyb.require_approval` off -- the default -- a submission
goes straight to APPROVED and is marked `auto_approved`. Turn it on and the
same submission waits at SUBMITTED for a human. The state machine is the same
either way; only the target of a submit changes. That is what makes turning
verification back on a config change instead of a new gate retrofitted into a
live marketplace.
"""

from __future__ import annotations

import uuid
from typing import Final

#: SRS 1.20.7.
KYB_STATES: Final = (
    "DRAFT",
    "SUBMITTED",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "MORE_INFO_REQUIRED",
)

TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "DRAFT": frozenset({"SUBMITTED", "APPROVED"}),
    "SUBMITTED": frozenset({"UNDER_REVIEW", "APPROVED", "REJECTED", "MORE_INFO_REQUIRED"}),
    "UNDER_REVIEW": frozenset({"APPROVED", "REJECTED", "MORE_INFO_REQUIRED"}),
    "MORE_INFO_REQUIRED": frozenset({"SUBMITTED", "APPROVED"}),
    # Terminal. A rejected organisation starts a new submission; an approved
    # one is verified, and changing that is a review action, not a transition.
    "APPROVED": frozenset(),
    "REJECTED": frozenset(),
}

#: A submission that is still in progress. At most one per organisation --
#: two open submissions would make "is this employer verified?" depend on
#: which one a query found first. Held by a partial unique index.
OPEN_STATES: Final[frozenset[str]] = frozenset(
    {"DRAFT", "SUBMITTED", "UNDER_REVIEW", "MORE_INFO_REQUIRED"}
)

#: Answers and documents can change only before submission, or when a
#: reviewer has asked for more. Otherwise a reviewer could approve one set of
#: answers and the employer be verified on another.
EDITABLE_STATES: Final[frozenset[str]] = frozenset({"DRAFT", "MORE_INFO_REQUIRED"})

REVIEW_DECISIONS: Final[frozenset[str]] = frozenset({"APPROVED", "REJECTED", "MORE_INFO_REQUIRED"})


def refuse_transition(current: str, target: str) -> str | None:
    if target not in TRANSITIONS.get(current, frozenset()):
        return "kyb_invalid_transition"
    return None


def state_on_submit(*, require_approval: bool) -> str:
    """Where a complete submission goes. The whole of the R15 switch."""
    return "SUBMITTED" if require_approval else "APPROVED"


def reason_required(decision: str) -> bool:
    """A rejection must say why (SRS 1.11.3), and so must a request for more
    information -- "please provide more" with no hint of what is not a
    request anyone can act on."""
    return decision in {"REJECTED", "MORE_INFO_REQUIRED"}


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
#: Photographs of documents are explicitly allowed by the form, so images are
#: accepted alongside PDF. Word documents are not: a registration certificate
#: is issued as a scan or a PDF, never as an editable file.
ACCEPTED_DOCUMENT_TYPES: Final = ("application/pdf", "image/jpeg", "image/png")

MAX_DOCUMENT_BYTES: Final = 10 * 1024 * 1024

_SIGNATURES: Final[tuple[tuple[bytes, str], ...]] = (
    (b"%PDF-", "application/pdf"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
)


def sniff_document(head: bytes) -> str | None:
    """What the stored bytes are. The filename and declared type are never
    consulted -- both are the uploader's to choose."""
    for signature, mime in _SIGNATURES:
        if head.startswith(signature):
            return mime
    return None


def document_key(
    *, tenant_id: uuid.UUID, submission_id: uuid.UUID, doc_type: str, upload_id: uuid.UUID
) -> str:
    """Where a document lives, derived entirely from ids we issued.

    **The client never supplies a key.** A presigned PUT authorises exactly the
    key it was signed for, so a client-chosen key would let one employer write
    into another's documents. Rebuilding it from the authenticated tenant also
    means completing someone else's upload looks in your own prefix and finds
    nothing.
    """
    return f"kyb/{tenant_id}/{submission_id}/{doc_type}/{upload_id}"


# ---------------------------------------------------------------------------
# Sending back, and what changed since (2026-10-10)
# ---------------------------------------------------------------------------
#: The two decisions that hand the submission back with something to fix.
#: MORE_INFO_REQUIRED is the console's **Send back**: the same submission
#: reopens for the employer to correct and submit again. REJECTED is final
#: for this submission; the employer starts a new one, filled in from it.
DECISIONS_WITH_FLAGS: Final[frozenset[str]] = frozenset({"REJECTED", "MORE_INFO_REQUIRED"})
#: How many fields or documents one decision may point at. The form has 27
#: fields; a longer list is not one a person acts on.
MAX_REVIEW_FLAGS: Final = 40
MAX_FLAG_NOTE: Final = 500


def flag_refusal(
    *, decision: str, flagged: list[str], known_fields: frozenset[str]
) -> tuple[str, list[str]] | None:
    """Why a reviewer's field flags cannot be recorded, or None.

    A flag names a form field or a document type (`kyb/forms.py`), so the
    employer's form can point at exactly what to correct. An approval has
    nothing to correct, and a field the form does not have is a typo the
    employer could never find.
    """
    if flagged and decision not in DECISIONS_WITH_FLAGS:
        return "kyb_flags_not_allowed", []
    unknown = sorted({code for code in flagged if code not in known_fields})
    if unknown:
        return "kyb_flag_unknown_field", unknown
    duplicated = sorted({code for code in flagged if flagged.count(code) > 1})
    if duplicated:
        return "kyb_flag_duplicate", duplicated
    return None


def changes_since(
    *,
    reviewed_answers: dict[str, object],
    answers: dict[str, object],
    reviewed_documents: dict[str, str],
    documents: dict[str, str],
) -> tuple[list[str], list[str]]:
    """`(fields, document types)` that differ from what the last reviewer
    saw. Documents are compared by the id of the latest upload of each type,
    so re-uploading a file counts as a change even when its bytes do not."""
    fields = sorted(
        code
        for code in set(reviewed_answers) | set(answers)
        if reviewed_answers.get(code) != answers.get(code)
    )
    changed_documents = sorted(
        doc_type
        for doc_type in set(reviewed_documents) | set(documents)
        if reviewed_documents.get(doc_type) != documents.get(doc_type)
    )
    return fields, changed_documents
