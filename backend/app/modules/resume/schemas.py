"""resume - Pydantic request/response DTOs

Upload, parse jobs, versions, review and confirm.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator, model_validator

from app.core.schemas import ApiSchema
from app.modules.resume.domain import normalise_pasted_text
from app.modules.resume.sections import HEADER, SectionKind, assemble_sections, heading_kind
from app.modules.resume.structuring import StructuredResume, StructuredStatus


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


#: Where a version's content came from. EDIT means a human corrected it; see
#: the note on the CHECK constraint in `models.py` for why that is a source
#: rather than a flag.
VersionSource = Literal["UPLOAD", "PASTE", "MANUAL", "EDIT"]


# ---------------------------------------------------------------------------
# Upload: presign, then complete
# ---------------------------------------------------------------------------
class UploadTicketResponse(_Base):
    """Where to PUT the file, and the rules it must satisfy.

    **No `key` field, deliberately.** The object key is derived server-side
    from the authenticated user; returning it would invite a client to send
    one back, and a presigned PUT authorises exactly the key it signed -- so a
    client-chosen key is a candidate writing into another candidate's prefix.
    """

    upload_id: uuid.UUID
    url: str
    method: Literal["PUT"] = "PUT"
    expires_in_seconds: int
    max_bytes: int = Field(
        description="Also enforced server-side from S3 metadata. A presigned "
        "PUT cannot be trusted to have honoured it."
    )
    accepted_types: list[str]


class UploadCompleteResponse(_Base):
    """202: the file is stored and accepted; parsing has not finished.

    `parse_status` is QUEUED on a first completion. It is not fixed at that,
    because completing an upload is idempotent -- a client that retries after
    the worker has already run gets the row's real state rather than being
    told to poll for something that has already finished or failed.
    """

    resume_file_id: uuid.UUID
    scan_status: Literal["PENDING", "CLEAN", "INFECTED", "FAILED"]
    parse_status: Literal["QUEUED", "DONE", "FAILED", "BLOCKED"]


class ResumeFileStatusResponse(_Base):
    """What a client polls after the 202.

    `scan_status` and `parse_status` are separate because they fail
    differently and the candidate can act on only one of them: a document we
    cannot read is something they can fix by uploading a different file, and a
    file held by the scanner is not.
    """

    resume_file_id: uuid.UUID
    scan_status: str
    parse_status: Literal["QUEUED", "DONE", "FAILED", "BLOCKED"]
    parse_error_code: str | None = Field(
        default=None,
        description="Why parsing failed, as a code the client localises. "
        "Present only when parse_status is FAILED.",
    )
    terminal: bool = Field(
        description="True once parse_status can no longer change. **Stop "
        "polling on this, not on the presence of a version** -- a FAILED "
        "parse never produces one, and a client that waits for a version "
        "waits forever."
    )
    uploaded_at: datetime
    resume_version_id: uuid.UUID | None = Field(
        default=None, description="Present once parsing has produced a version."
    )


# ---------------------------------------------------------------------------
# Paste-text and manual paths (PRD 4.2)
# ---------------------------------------------------------------------------
class PasteTextRequest(_Base):
    """A CV pasted as text. No file, no scan, no OCR."""

    text: Annotated[str, Field(min_length=50)]

    @field_validator("text")
    @classmethod
    def _normalise(cls, v: str) -> str:
        """Normalised once, here, before it is stored.

        Invariant 1 requires a score to be reproducible from the stored text,
        so normalisation must happen before persistence and never again after
        -- otherwise the same stored row could score differently later.
        """
        cleaned = normalise_pasted_text(v)
        if len(cleaned) < 50:
            raise ValueError("too short to be a resume once whitespace is removed")
        return cleaned


class ManualExperience(_Base):
    employer: Annotated[str, Field(max_length=200)]
    title: Annotated[str, Field(max_length=200)]
    start_year: Annotated[int, Field(ge=1950, le=2100)]
    end_year: Annotated[int | None, Field(default=None, ge=1950, le=2100)]
    summary: Annotated[str | None, Field(default=None, max_length=2000)]


class ManualEducation(_Base):
    institution: Annotated[str, Field(max_length=200)]
    qualification: Annotated[str, Field(max_length=200)]
    completed_year: Annotated[int | None, Field(default=None, ge=1950, le=2100)]


class ManualResumeRequest(_Base):
    """The structured form (PRD 4.2), for candidates with no file to upload.

    **There is no date of birth or age field here, and there must never be.**
    Invariant 5 forbids age-gating, `scripts/check_no_age_fields.py` fails the
    build on one, and years of experience are derived from the employment
    dates rather than asked for.
    """

    full_name: Annotated[str, Field(min_length=1, max_length=200)]
    headline: Annotated[str | None, Field(default=None, max_length=300)]
    experience: Annotated[list[ManualExperience], Field(default_factory=list, max_length=40)]
    education: Annotated[list[ManualEducation], Field(default_factory=list, max_length=20)]
    skills: Annotated[
        list[Annotated[str, Field(max_length=80)]], Field(default_factory=list, max_length=100)
    ]

    @field_validator("experience")
    @classmethod
    def _end_after_start(cls, v: list[ManualExperience]) -> list[ManualExperience]:
        for role in v:
            if role.end_year is not None and role.end_year < role.start_year:
                raise ValueError(f"{role.employer}: end_year is before start_year")
        return v


class ResumeVersionResponse(_Base):
    """A created version. `parsed` is not echoed back.

    The review endpoint returns the content; this is the acknowledgement that
    a version now exists and whether it has passed the confirm gate.
    """

    resume_version_id: uuid.UUID
    source: VersionSource
    confirmed: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Review, edit, confirm (SRS 1.4.4)
# ---------------------------------------------------------------------------
class ResumeVersionSummary(_Base):
    """One entry in the version history. No content -- the list is a chain
    view, and returning every candidate's full CV text to render a list of
    dates is bandwidth spent on data the screen does not show."""

    resume_version_id: uuid.UUID
    source: VersionSource
    confirmed: bool
    confirmed_at: datetime | None = None
    supersedes_id: uuid.UUID | None = None
    superseded: bool = Field(
        description="True once a newer version has replaced this one. A "
        "superseded version can no longer be edited or confirmed."
    )
    created_at: datetime


class ResumeSectionItem(_Base):
    text: str
    unclear: bool = Field(
        description="Worth asking the candidate about: a likely typo, a "
        "sentence split by mistake, or not a word. An unknown skill is not "
        "unclear."
    )
    suggestion: str | None = Field(
        default=None, description="The spelling we think was meant, if any."
    )


class ResumeSection(_Base):
    """One card on the review screen. A view of `parsed.raw_text`, computed on
    read -- the text is still what is scored."""

    kind: SectionKind = Field(
        description="What the section holds. `header` is everything before the "
        "first heading, usually the name and contact lines."
    )
    heading: str | None = Field(
        description="As written in the document. Null for `header`. Send it "
        "back unchanged when editing, to keep the candidate's wording."
    )
    body: str
    items: list[ResumeSectionItem] | None = Field(
        default=None,
        description="Skills, languages and certifications as separate items; "
        "null for every other kind.",
    )


class ResumeVersionDetailResponse(_Base):
    """**The review screen.** The whole point of the confirm gate is that the
    candidate sees what was extracted before a number is attached to it, so
    this is the one response that returns `parsed` in full.

    Parsing is not accurate enough to skip this. A borderless-table CV, a
    scanned photo, a two-column layout -- each produces text that is plausible
    and wrong in a way only the candidate can spot.
    """

    resume_version_id: uuid.UUID
    source: VersionSource
    parsed: dict[str, Any] = Field(
        description="Exactly what was extracted or entered, including the "
        "`extractor` provenance block. This is what will be scored if it is "
        "confirmed, so it is what the candidate must be shown."
    )
    sections: list[ResumeSection] | None = Field(
        default=None,
        description="`parsed.raw_text` split into sections, for an uploaded, "
        "pasted or text-edited version. Null for a structured one, whose "
        "`parsed` already has its fields. Every line of the text is in exactly "
        "one section.",
    )
    structured_resume: StructuredResume | None = Field(
        default=None,
        description="The CV sorted into fields by a model -- contacts and profile "
        "links, each job, each qualification, projects, certifications and the "
        "rest -- for display and review. **Never scored**: `parsed.raw_text` is "
        "what is scored. Null unless `structured_status` is READY.",
    )
    structured_status: StructuredStatus = Field(
        default="UNAVAILABLE",
        description="READY; FAILED (the model could not read it -- show "
        "`sections`); or UNAVAILABLE (not configured, or a version created "
        "before structuring existed).",
    )
    confirmed: bool
    confirmed_at: datetime | None = None
    supersedes_id: uuid.UUID | None = None
    superseded: bool
    created_at: datetime


class ResumeSectionEdit(_Base):
    kind: SectionKind
    heading: str | None = Field(
        default=None,
        max_length=80,
        description="The heading as the review screen returned it, or null for "
        "the kind's standard heading. Must name this kind.",
    )
    body: Annotated[str, Field(max_length=20_000)] = ""

    @model_validator(mode="after")
    def _heading_names_kind(self) -> ResumeSectionEdit:
        if self.kind == HEADER:
            if self.heading is not None:
                raise ValueError("the header section has no heading")
        elif self.heading is not None and heading_kind(self.heading) != self.kind:
            # Otherwise it would not be read back as this kind -- or as a
            # heading at all -- and the section would merge into its neighbour.
            raise ValueError(f"{self.heading!r} is not a heading for {self.kind}")
        return self


class ResumeEditRequest(_Base):
    """A correction to a reviewed version. Sends the resume **entire**.

    Exactly one of `text`, `structured` or `sections`, and the reason it is
    not two is that they carry the same facts in different shapes: accepting
    both would make "which one is scored?" a question with an answer buried in
    merge code. Sending none is equally a client bug, so both are 422s rather
    than a silent no-op that returns a version nobody changed.

    `sections` is the review screen's shape: every section, in order, edited
    or not -- a section left out is deleted. It is assembled into text and
    stored exactly as a `text` edit is.
    """

    text: Annotated[str | None, Field(default=None, min_length=50)] = None
    structured: ManualResumeRequest | None = None
    sections: Annotated[list[ResumeSectionEdit] | None, Field(default=None, max_length=40)] = None

    @field_validator("text")
    @classmethod
    def _normalise(cls, v: str | None) -> str | None:
        """Normalised on the way in, exactly as a paste is -- so an edited
        version and a pasted one are stored in the same shape and invariant 1
        holds identically for both."""
        if v is None:
            return None
        cleaned = normalise_pasted_text(v)
        if len(cleaned) < 50:
            raise ValueError("too short to be a resume once whitespace is removed")
        return cleaned

    @model_validator(mode="after")
    def _exactly_one(self) -> ResumeEditRequest:
        given = [v for v in (self.text, self.structured, self.sections) if v is not None]
        if len(given) != 1:
            raise ValueError("send exactly one of `text`, `structured` or `sections`")
        if self.sections is not None:
            if any(s.kind == HEADER for s in self.sections[1:]):
                # Assembled anywhere else it would read back as part of the
                # section before it.
                raise ValueError("the header section can only come first")
            if len(self.edited_text() or "") < 50:
                raise ValueError("too short to be a resume once whitespace is removed")
        return self

    def edited_text(self) -> str | None:
        """The text this edit stores, or None for a structured edit."""
        if self.sections is not None:
            return normalise_pasted_text(
                assemble_sections([(s.kind, s.heading, s.body) for s in self.sections])
            )
        return self.text


class ResumeConfirmResponse(_Base):
    """The gate, passed. After this the version is eligible for scoring and
    its content can never change -- a further correction creates a new,
    unconfirmed version that must be reviewed and confirmed in its turn."""

    resume_version_id: uuid.UUID
    confirmed_at: datetime
    already_confirmed: bool = Field(
        description="True when this call found the version already confirmed. "
        "Confirming twice is a retry, not an error, and `confirmed_at` still "
        "reports the original moment rather than this one."
    )


# ---------------------------------------------------------------------------
# A CV shown to someone other than its owner (2026-10-05)
# ---------------------------------------------------------------------------
class SharedResumeSection(_Base):
    kind: SectionKind
    heading: str | None = Field(description="As written in the CV. Null for `header`.")
    body: str


class SharedResumeView(_Base):
    """The CV a score was built from, as an employer who opened the candidate
    sees it: the confirmed version only, never a draft the candidate has not
    checked. Draw `sections` for a readable page, offer `file_url` for the
    original; `text` is the same words in one string."""

    version_id: uuid.UUID
    source: VersionSource
    confirmed_at: datetime
    text: str | None = Field(description="The CV as read, or as the candidate edited it.")
    sections: list[SharedResumeSection] = Field(
        description="`text` split at its headings, in order. Empty for a form-built CV."
    )
    fields: dict[str, Any] = Field(
        description="A form-built CV's fields, when it has no text. Empty otherwise."
    )
    structured_resume: StructuredResume | None = Field(
        default=None,
        description="The same CV sorted into fields by a model -- contacts and "
        "profile links, each job, each qualification and the rest -- for display. "
        "Never scored. Null unless `structured_status` is READY; draw `sections` then.",
    )
    structured_status: StructuredStatus = Field(
        default="UNAVAILABLE",
        description="READY; FAILED (the model could not read it); or UNAVAILABLE "
        "(not configured, or a CV from before 2026-10-06, which is not back-filled).",
    )
    file_url: str | None = Field(
        description="Presigned GET of the uploaded PDF or DOCX. Null for a pasted or "
        "form-built CV. Expires at `file_url_expires_at`; fetch the profile again for a new one."
    )
    file_mime: str | None
    file_url_expires_at: datetime | None
