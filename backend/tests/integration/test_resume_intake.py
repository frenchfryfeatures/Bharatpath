"""Resume intake end to end: presign, complete, paste, manual.

S3 is faked at the `app.core.storage` boundary -- these tests are about the
transaction boundary and the trust rules, and both must hold in CI where there
are no AWS credentials. The storage layer itself is exercised against real S3
by `scripts/verify_ocr_fallback.py`.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.resume.domain import upload_key
from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration


def _real_pdf() -> bytes:
    """A structurally valid PDF carrying real text.

    A blob that merely starts with `%PDF-` sniffs as a PDF and then fails to
    parse, which correctly sends it down the OCR path -- but that makes these
    tests about Textract rather than about intake.
    """
    import io

    import pypdf
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    # Comfortably more than MIN_USEFUL_CHARS. A shorter CV would be treated as
    # an empty extraction and routed to OCR -- correct behaviour, but it would
    # make these tests depend on Textract.
    lines = [
        b"Priya Sharma - Senior Backend Engineer, Bengaluru",
        b"Infosys, Senior Developer, 2019 to 2024",
        b"Built payment services handling high request volumes.",
        b"B.Tech Computer Science, VIT Vellore, 2015",
        b"Skills: Python, PostgreSQL, Kubernetes, AWS",
    ]
    stream = (
        b"BT /F1 12 Tf 72 720 Td "
        + b" ".join(b"(" + line + b") Tj 0 -18 Td" for line in lines)
        + b" ET"
    )

    page = pypdf.PageObject.create_blank_page(width=612, height=792)
    content = DecodedStreamObject()
    content.set_data(stream)
    page[NameObject("/Contents")] = content
    font = DictionaryObject()
    font[NameObject("/Type")] = NameObject("/Font")
    font[NameObject("/Subtype")] = NameObject("/Type1")
    font[NameObject("/BaseFont")] = NameObject("/Helvetica")
    fonts = DictionaryObject()
    fonts[NameObject("/F1")] = font
    resources = DictionaryObject()
    resources[NameObject("/Font")] = fonts
    page[NameObject("/Resources")] = resources

    writer = pypdf.PdfWriter()
    writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


PDF = _real_pdf()


class FakeS3:
    """Just enough S3 to exercise the rules. Records deletions, because
    cleaning up a rejected upload is a requirement and not an optimisation."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def head_object(self, *, bucket: str, key: str) -> dict[str, Any] | None:
        blob = self.objects.get(key)
        return None if blob is None else {"size_bytes": len(blob), "etag": "x"}

    async def read_head_bytes(self, *, bucket: str, key: str, count: int) -> bytes:
        return self.objects.get(key, b"")[:count]

    async def read_whole_object(self, *, bucket: str, key: str) -> bytes:
        return self.objects.get(key, b"")

    async def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)

    async def presign_put(self, *, bucket: str, key: str, expires_in: int) -> str:
        return f"https://s3.test/{bucket}/{key}?sig=x"

    async def presign_get(self, *, bucket: str, key: str, expires_in: int) -> str:
        """Faked like the PUT. Left real, it signs with whatever AWS
        credentials the machine has: a developer's pass, CI's none fails."""
        return f"https://s3.test/{bucket}/{key}?get=x"


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    from app.core import storage
    from app.modules.resume import service

    fake = FakeS3()
    for name in (
        "head_object",
        "read_head_bytes",
        "read_whole_object",
        "delete_object",
        "presign_put",
        "presign_get",
    ):
        monkeypatch.setattr(storage, name, getattr(fake, name))
        if hasattr(service.storage, name):
            monkeypatch.setattr(service.storage, name, getattr(fake, name))
    return fake


@pytest.fixture
async def candidate() -> uuid.UUID:
    """A user row to hang resumes off. Seeded as the migrator, like every
    other fixture -- the app role is genuinely subject to RLS."""
    user_id = uuid.uuid4()
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, phone, status, locale) "
                "VALUES (:id, :sub, 'CANDIDATE', :phone, 'ACTIVE', 'en')"
            ),
            {
                "id": str(user_id),
                "sub": f"local|{user_id}",
                "phone": f"+9199{uuid.uuid4().int % 10**8:08d}",
            },
        )
    return user_id


@pytest.fixture
def local_parser_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin extraction to the in-process parser.

    **Without this a test that feeds in an unreadable PDF calls AWS.** That is
    the parser behaving correctly -- a document pypdf cannot read is exactly
    what the OCR fallback exists for -- but it makes the test depend on
    credentials, on the network, and on Textract's account state, and it bills
    per page if it ever succeeds. Today it "passes" only because this account
    returns SubscriptionRequiredException.

    Pinned at `get_resume_parser` rather than by overriding the setting,
    because the task resolves the parser through that function and the seam is
    the same one production switches on.
    """
    from app.modules.resume import parser as parser_module

    monkeypatch.setattr(
        parser_module,
        "get_resume_parser",
        lambda settings=None: parser_module.LocalResumeParser(),
    )


async def _complete(user_id: uuid.UUID, upload_id: uuid.UUID) -> tuple[uuid.UUID, str]:
    """Returns `(resume_file_id, scan_status)`. The service also returns the
    parse status; the tests that care about it read it back through
    `get_file_status`, which is what a client actually polls."""
    from app.modules.resume import service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        file_id, scan_status, _parse_status = await service.complete_upload(
            session, user_id=user_id, upload_id=upload_id
        )
        return file_id, scan_status


# --- the transaction boundary --------------------------------------------
async def test_presigning_writes_no_row(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    """The plan's requirement, stated as an absence: an abandoned upload must
    leave nothing behind, so there is nothing to clean up."""
    from app.modules.resume import service

    await service.issue_upload_ticket(user_id=candidate)

    factory = sessions(_seed_url())
    async with factory() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM resume_files WHERE user_id = :u"), {"u": candidate}
        )
    assert count == 0


async def test_completing_an_upload_that_never_arrived_is_a_404(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    from app.modules.resume.service import UploadNotFoundError

    with pytest.raises(UploadNotFoundError):
        await _complete(candidate, uuid.uuid4())


async def test_a_rejected_upload_creates_no_row_and_deletes_the_object(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """A partial record is the failure mode the boundary exists to prevent.
    The object goes too: holding a rejected file is storage we pay for and
    personal data we have no reason to keep."""
    from app.modules.resume import service
    from app.modules.resume.service import UploadRejectedError

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    key = upload_key(user_id=candidate, upload_id=upload_id)
    fake_s3.objects[key] = b"\x89PNG\r\n\x1a\n" + b"not a cv" * 20

    with pytest.raises(UploadRejectedError) as exc:
        await _complete(candidate, upload_id)
    assert exc.value.code == "upload_unrecognised_type"

    factory = sessions(_seed_url())
    async with factory() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM resume_files WHERE id = :i"), {"i": upload_id}
        )
    assert count == 0, "a rejected upload left a partial row"
    assert key in fake_s3.deleted, "the rejected object was left in the bucket"


async def test_a_valid_upload_creates_the_row_and_an_event(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    from app.modules.resume import service

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF

    file_id, scan_status = await _complete(candidate, upload_id)
    assert file_id == upload_id, "the row id must be the upload id"
    assert scan_status == "PENDING", "no scanner is wired; CLEAN would be a lie"

    factory = sessions(_seed_url())
    async with factory() as session:
        mime = await session.scalar(
            text("SELECT mime FROM resume_files WHERE id = :i"), {"i": file_id}
        )
        events = await session.scalar(
            text("SELECT count(*) FROM outbox WHERE aggregate_id = :a"), {"a": str(file_id)}
        )
    assert mime == "application/pdf"
    assert events == 1, "the row and its event must be written together"


async def test_completing_twice_does_not_create_a_second_row(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """The client retries; the outbox is at-least-once. One upload, one row."""
    from app.modules.resume import service

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF

    first, _ = await _complete(candidate, upload_id)
    second, _ = await _complete(candidate, upload_id)
    assert first == second


# --- nothing is trusted from the client -----------------------------------
async def test_one_candidate_cannot_complete_another_candidates_upload(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """The key is rebuilt from the caller, so B asking for A's upload id looks
    for an object under B's own prefix and finds nothing."""
    from app.modules.resume import service
    from app.modules.resume.service import UploadNotFoundError

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF

    intruder = uuid.uuid4()
    with pytest.raises(UploadNotFoundError):
        await _complete(intruder, upload_id)


async def test_an_oversized_upload_is_refused(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    """Size comes from S3, not from the client, so a presigned PUT that
    ignored the cap is still caught."""
    from app.modules.resume import service
    from app.modules.resume.service import UploadRejectedError
    from app.settings import get_settings

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    cap = get_settings().resume_max_upload_bytes
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = b"%PDF-" + b"x" * cap

    with pytest.raises(UploadRejectedError) as exc:
        await _complete(candidate, upload_id)
    assert exc.value.code == "upload_too_large"


async def test_a_renamed_zip_is_refused(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    import io
    import zipfile

    from app.modules.resume import service
    from app.modules.resume.service import UploadRejectedError

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("payload.exe", "MZ")

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = buf.getvalue()

    with pytest.raises(UploadRejectedError):
        await _complete(candidate, upload_id)


# --- paste and manual -----------------------------------------------------
async def test_pasted_text_is_stored_normalised(candidate: uuid.UUID) -> None:
    """Invariant 1: what is scored must be exactly what is stored, so
    normalisation happens once on the way in."""
    from app.modules.resume import service
    from app.modules.resume.schemas import PasteTextRequest

    payload = PasteTextRequest(
        text="  Priya Sharma \r\n\r\n\r\n\r\n  " + "Engineer at Infosys. " * 5
    )
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        row = await service.create_pasted_version(session, user_id=candidate, text=payload.text)
        stored = row.parsed["raw_text"]

    assert stored == payload.text
    assert "\r" not in stored
    assert "\n\n\n" not in stored


# Invariant 5 -- the manual form must not collect a candidate's years lived or
# the date they were born -- is NOT asserted here. `scripts/check_no_age_fields.py`
# already scans every file in the repository on every CI run, which is strictly
# stronger than one schema check.
#
# It also cannot be asserted here: a test listing the forbidden field names has
# to write them down, and the scanner then flags the test itself. That is the
# scanner working correctly, not a false positive -- it is why the check lives
# in one place instead of being restated per module.


async def test_manual_entry_stores_the_parser_shape(candidate: uuid.UUID) -> None:
    from app.modules.resume import service
    from app.modules.resume.schemas import ManualExperience, ManualResumeRequest

    payload = ManualResumeRequest(
        full_name="Rahul Verma",
        experience=[
            ManualExperience(
                employer="Infosys", title="Senior Developer", start_year=2019, end_year=2024
            )
        ],
        skills=["Python", "PostgreSQL"],
    )
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        row = await service.create_manual_version(session, user_id=candidate, payload=payload)

    assert row.source == "MANUAL"
    assert row.parsed["full_name"] == "Rahul Verma"
    assert row.parsed["extractor"]["parser"] == "manual"


async def test_an_end_year_before_the_start_year_is_refused() -> None:
    from pydantic import ValidationError as PydanticValidationError

    from app.modules.resume.schemas import ManualExperience, ManualResumeRequest

    with pytest.raises(PydanticValidationError):
        ManualResumeRequest(
            full_name="X",
            experience=[ManualExperience(employer="A", title="B", start_year=2024, end_year=2019)],
        )


# --- the parse task -------------------------------------------------------
async def test_parsing_is_idempotent(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    """At-least-once delivery hands the same upload over twice. Two versions
    would mean two scores for one CV."""
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)

    first = await _parse(str(file_id))
    second = await _parse(str(file_id))

    assert first["status"] == "parsed"
    assert second["status"] == "already_parsed"
    assert first["resume_version_id"] == second["resume_version_id"]


async def test_parsing_records_which_engine_produced_the_text(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """Invariant 1 again: a replay has to be able to say what produced a
    score, and a different parser means a different score."""
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)
    await _parse(str(file_id))

    factory = sessions(_seed_url())
    async with factory() as session:
        parsed = await session.scalar(
            text("SELECT parsed FROM resume_versions WHERE resume_file_id = :f"),
            {"f": file_id},
        )
    assert parsed["extractor"]["parser"]
    assert parsed["extractor"]["parser_version"]


async def test_parsing_a_missing_file_is_not_an_error(fake_s3: FakeS3) -> None:
    """The relay can deliver an event for a row that has since been deleted.
    That is ordinary, and must not poison the queue."""
    from app.tasks.parse_resume import _parse

    assert (await _parse(str(uuid.uuid4())))["status"] == "missing"


async def test_an_infected_file_is_never_parsed(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    """No scanner is wired yet, so this proves the gate itself works by
    setting the status directly -- the line that enforces it does not change
    when a real scanner lands."""
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text("UPDATE resume_files SET scan_status = 'INFECTED' WHERE id = :i"),
            {"i": file_id},
        )

    result = await _parse(str(file_id))
    assert result["status"] == "blocked"

    async with factory() as session:
        versions = await session.scalar(
            text("SELECT count(*) FROM resume_versions WHERE resume_file_id = :f"),
            {"f": file_id},
        )
    assert versions == 0, "an infected file was parsed"


# --- 202 and status polling ---------------------------------------------
async def _status(user_id: uuid.UUID, file_id: uuid.UUID) -> tuple[Any, Any]:
    from app.modules.resume import service

    factory = sessions(_seed_url())
    async with factory() as session:
        return await service.get_file_status(session, user_id=user_id, resume_file_id=file_id)


async def test_a_completed_upload_starts_queued(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    """The 202 means accepted, not finished. Until the worker has run there is
    nothing to report but that."""
    from app.modules.resume import service

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)

    row, version = await _status(candidate, file_id)
    assert row.parse_status == "QUEUED"
    assert row.parse_error_code is None
    assert version is None


async def test_a_successful_parse_polls_done(candidate: uuid.UUID, fake_s3: FakeS3) -> None:
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)
    await _parse(str(file_id))

    row, version = await _status(candidate, file_id)
    assert row.parse_status == "DONE"
    assert row.parse_error_code is None
    assert version is not None


async def test_an_unreadable_document_polls_failed_with_a_reason(
    candidate: uuid.UUID, fake_s3: FakeS3, local_parser_only: None
) -> None:
    """**The gap this column exists to close.** A truncated PDF sniffs as a
    PDF, is accepted, and then cannot be parsed. Without a terminal state the
    candidate polls an endpoint that will never produce a version and never
    say why -- so the app either spins forever or lies about progress.

    The code travels instead of a sentence, because the client renders the
    message in the candidate's own language.
    """
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    # Sniffs as a PDF on its header and then fails in the reader. Long enough
    # to clear the size floor, junk enough that no text layer exists.
    unreadable = b"%PDF-1.4\n" + b"\x00" * 4096
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = unreadable
    file_id, _ = await _complete(candidate, upload_id)

    result = await _parse(str(file_id))
    assert result["status"] == "unparseable"

    row, version = await _status(candidate, file_id)
    assert row.parse_status == "FAILED"
    assert row.parse_error_code == "resume_unreadable_document"
    assert row.parse_error_code == result["code"]
    assert version is None, "a failed parse produced a version"


async def test_a_document_too_long_for_a_cv_polls_failed_and_is_never_scored(
    candidate: uuid.UUID, fake_s3: FakeS3, local_parser_only: None
) -> None:
    """A whole book was parsed, scored 700 and reached employers (2026-10-02).
    Past `MAX_PAGES` it is refused before any text is read, so there is no
    version, no model call and no score."""
    import io

    import pypdf

    from app.modules.resume import service
    from app.modules.resume.parser import MAX_PAGES
    from app.tasks.parse_resume import _parse

    writer = pypdf.PdfWriter()
    for _ in range(MAX_PAGES + 1):
        writer.add_blank_page(width=612, height=792)
    book = io.BytesIO()
    writer.write(book)

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = book.getvalue()
    file_id, _ = await _complete(candidate, upload_id)

    result = await _parse(str(file_id))
    assert result == {"status": "unparseable", "code": "resume_too_long"}

    row, version = await _status(candidate, file_id)
    assert row.parse_status == "FAILED"
    assert row.parse_error_code == "resume_too_long"
    assert version is None, "a document too long for a CV produced a version"


async def test_an_infected_file_polls_blocked_rather_than_failed(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """BLOCKED and FAILED are different advice. A file the scanner holds may
    be perfectly readable, and telling the candidate to re-upload it would
    send them round a loop that ends the same way."""
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text("UPDATE resume_files SET scan_status = 'INFECTED' WHERE id = :i"),
            {"i": file_id},
        )

    await _parse(str(file_id))

    row, _version = await _status(candidate, file_id)
    assert row.parse_status == "BLOCKED"
    assert row.parse_error_code is None


async def test_a_missing_object_is_a_parse_failure_not_a_scan_failure(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """Two different facts, and they used to share one column. Reading
    `scan_status = FAILED` later would say the scanner failed, which is not
    what happened and would send an investigation the wrong way."""
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    key = upload_key(user_id=candidate, upload_id=upload_id)
    fake_s3.objects[key] = PDF
    file_id, scan_before = await _complete(candidate, upload_id)

    # The object disappears between upload and parse -- a lifecycle rule, or a
    # deletion request that landed first.
    fake_s3.objects.pop(key)
    assert (await _parse(str(file_id)))["status"] == "object_missing"

    row, _version = await _status(candidate, file_id)
    assert row.parse_status == "FAILED"
    assert row.parse_error_code == "resume_object_missing"
    assert row.scan_status == scan_before, "a missing object was recorded as a scan failure"


async def test_redelivery_of_a_parsed_file_leaves_it_done(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """At-least-once delivery hands the same file over again. The second run
    creates no version, and must not walk the status back to something the
    client would resume polling."""
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)
    await _parse(str(file_id))
    await _parse(str(file_id))

    row, _version = await _status(candidate, file_id)
    assert row.parse_status == "DONE"


async def test_a_parse_status_and_its_error_code_cannot_disagree(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """Held by a CHECK constraint, not by the code that writes it. A FAILED
    with no code tells the candidate nothing, and a code beside DONE is a
    previous attempt's error surfacing as a current one."""
    from sqlalchemy.exc import IntegrityError

    from app.modules.resume import service

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF
    file_id, _ = await _complete(candidate, upload_id)

    factory = sessions(_seed_url())
    with pytest.raises(IntegrityError):
        async with factory() as session, session.begin():
            await session.execute(
                text("UPDATE resume_files SET parse_status = 'FAILED' WHERE id = :i"),
                {"i": file_id},
            )

    with pytest.raises(IntegrityError):
        async with factory() as session, session.begin():
            await session.execute(
                text(
                    "UPDATE resume_files SET parse_status = 'DONE', "
                    "parse_error_code = 'resume_unreadable_document' WHERE id = :i"
                ),
                {"i": file_id},
            )


async def test_recompleting_a_parsed_upload_reports_its_real_state(
    candidate: uuid.UUID, fake_s3: FakeS3
) -> None:
    """Completing an upload is idempotent, so a client with a flaky connection
    can send it again after the worker has already run.

    It must not be told QUEUED then. A client that believed it would start
    polling for work that is finished -- and on a failed parse it would poll
    for work that is never going to finish.
    """
    from app.modules.resume import service
    from app.tasks.parse_resume import _parse

    upload_id, _, _ = await service.issue_upload_ticket(user_id=candidate)
    fake_s3.objects[upload_key(user_id=candidate, upload_id=upload_id)] = PDF

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        _, _, first_parse_status = await service.complete_upload(
            session, user_id=candidate, upload_id=upload_id
        )
    assert first_parse_status == "QUEUED"

    await _parse(str(upload_id))

    async with factory() as session, session.begin():
        _, _, retried_parse_status = await service.complete_upload(
            session, user_id=candidate, upload_id=upload_id
        )
    assert retried_parse_status == "DONE"
