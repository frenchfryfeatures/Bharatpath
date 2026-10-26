"""A candidate's resume history (2026-10-22), through HTTP.

`GET /candidate/resume/files` lists documents -- an upload and its
corrections are one resume to the person who sent it, and an upload that
failed is listed rather than silently missing. `GET /candidate/resume/versions`
says which version is current: the scoring rule's answer, which a client
cannot reliably infer from `confirmed` and `superseded` once a builder push
has started a second chain.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.resume.domain import upload_key
from tests.conftest import _seed_url, age_resume_confirmations, sessions
from tests.integration.test_candidate_marketplace import _candidate
from tests.integration.test_resume_intake import PDF, FakeS3

pytestmark = pytest.mark.integration

API = "/api/v1/candidate/resume"


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    """S3 faked at the storage boundary, as `test_resume_intake` does."""
    from app.core import storage

    fake = FakeS3()
    for name in ("head_object", "read_head_bytes", "delete_object", "presign_put", "presign_get"):
        monkeypatch.setattr(storage, name, getattr(fake, name))
    return fake


async def _file(
    user_id: Any,
    *,
    name: str | None,
    minutes_ago: int,
    parse_status: str = "DONE",
    error_code: str | None = None,
) -> str:
    file_id = str(uuid.uuid4())
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO resume_files (id, user_id, s3_key, mime, size_bytes, scan_status, "
                "parse_status, parse_error_code, original_filename, uploaded_at) "
                "VALUES (:f, :u, :k, 'application/pdf', 2048, 'CLEAN', :p, :e, :n, "
                "now() - make_interval(mins => :m))"
            ),
            {
                "f": file_id,
                "u": str(user_id),
                "k": f"resumes/{user_id}/{file_id}",
                "p": parse_status,
                "e": error_code,
                "n": name,
                "m": minutes_ago,
            },
        )
    return file_id


async def _version(
    user_id: Any, *, file_id: str | None, source: str = "UPLOAD", supersedes: str | None = None
) -> str:
    version_id = str(uuid.uuid4())
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO resume_versions (id, user_id, resume_file_id, source, parsed, "
                "supersedes_id) VALUES (:v, :u, :f, :s, CAST(:p AS jsonb), :sup)"
            ),
            {
                "v": version_id,
                "u": str(user_id),
                "f": file_id,
                "s": source,
                "sup": supersedes,
                "p": json.dumps({"raw_text": f"A CV {version_id}.", "extractor": {}}),
            },
        )
    return version_id


async def _confirm(user_id: Any, version_id: str) -> None:
    from app.modules.resume import service

    async with sessions(_seed_url())() as session, session.begin():
        await service.confirm_version(
            session, user_id=user_id, resume_version_id=uuid.UUID(version_id)
        )


async def _get(client: Any, me: dict[str, Any], path: str) -> list[dict[str, Any]]:
    response = await client.get(f"{API}{path}", headers=me["headers"])
    assert response.status_code == 200, response.text
    body: list[dict[str, Any]] = response.json()
    return body


async def test_the_file_list_is_one_row_per_document_and_lists_failures(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    uploaded = await _file(me["id"], name="Priya CV.pdf", minutes_ago=30)
    read = await _version(me["id"], file_id=uploaded)
    corrected = await _version(me["id"], file_id=uploaded, source="EDIT", supersedes=read)
    await _confirm(me["id"], corrected)
    failed = await _file(
        me["id"],
        name="scan.pdf",
        minutes_ago=10,
        parse_status="FAILED",
        error_code="resume_unreadable",
    )

    files = await _get(client, me, "/files")
    assert [f["resume_file_id"] for f in files] == [failed, uploaded]
    failure, document = files
    assert failure["filename"] == "scan.pdf"
    assert failure["parse_status"] == "FAILED"
    assert failure["parse_error_code"] == "resume_unreadable"
    assert failure["terminal"] is True
    assert failure["latest_version_id"] is None
    assert failure["confirmed"] is False and failure["current"] is False

    assert document["filename"] == "Priya CV.pdf"
    assert document["origin"] == "UPLOAD"
    assert document["latest_version_id"] == corrected  # its correction, not its upload
    assert document["confirmed"] is True and document["current"] is True
    assert "s3_key" not in document

    versions = await _get(client, me, "/versions")
    assert [(v["resume_version_id"], v["current"]) for v in versions] == [
        (corrected, True),
        (read, False),
    ]
    assert {v["filename"] for v in versions} == {"Priya CV.pdf"}
    assert {v["resume_file_id"] for v in versions} == {uploaded}


async def test_current_follows_the_newest_confirmation_across_chains(
    client: Any, mint_token: Any
) -> None:
    """Two chains, both confirmed and neither superseded: exactly one is
    current, and it is the one scoring reads."""
    me = await _candidate(mint_token, scored=False, subscribed=False)
    first_file = await _file(me["id"], name="old.pdf", minutes_ago=60)
    first = await _version(me["id"], file_id=first_file)
    await _confirm(me["id"], first)
    second_file = await _file(me["id"], name="new.pdf", minutes_ago=5)
    second = await _version(me["id"], file_id=second_file)

    # The newer chain is unconfirmed: the older one is still what is scored.
    versions = await _get(client, me, "/versions")
    assert [v["resume_version_id"] for v in versions if v["current"]] == [first]

    await age_resume_confirmations(me["id"])  # past `resume.scoring_interval`
    await _confirm(me["id"], second)
    versions = await _get(client, me, "/versions")
    assert [v["resume_version_id"] for v in versions if v["current"]] == [second]
    assert all(v["confirmed"] and not v["superseded"] for v in versions)
    files = await _get(client, me, "/files")
    assert [(f["resume_file_id"], f["current"]) for f in files] == [
        (second_file, True),
        (first_file, False),
    ]


async def test_nothing_is_current_before_a_confirmation(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)
    await _version(me["id"], file_id=await _file(me["id"], name=None, minutes_ago=1))
    [listed] = await _get(client, me, "/files")
    assert listed["current"] is False and listed["filename"] is None
    assert not any(v["current"] for v in await _get(client, me, "/versions"))


async def test_the_lists_hold_only_this_candidates_files(client: Any, mint_token: Any) -> None:
    owner = await _candidate(mint_token, scored=False, subscribed=False)
    await _version(owner["id"], file_id=await _file(owner["id"], name="a.pdf", minutes_ago=1))
    stranger = await _candidate(mint_token, scored=False, subscribed=False)
    assert await _get(client, stranger, "/files") == []
    assert await _get(client, stranger, "/versions") == []


async def test_an_upload_keeps_the_name_it_was_sent_with(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _candidate(mint_token, scored=False, subscribed=False)

    async def upload(body: dict[str, Any] | None) -> str:
        ticket = await client.post(f"{API}/uploads", headers=me["headers"])
        assert ticket.status_code == 201, ticket.text
        upload_id = ticket.json()["upload_id"]
        fake_s3.objects[upload_key(user_id=me["id"], upload_id=uuid.UUID(upload_id))] = PDF
        kwargs: dict[str, Any] = {"json": body} if body is not None else {}
        done = await client.post(
            f"{API}/uploads/{upload_id}/complete", headers=me["headers"], **kwargs
        )
        assert done.status_code == 202, done.text
        return upload_id

    named = await upload({"filename": "C:\\fakepath\\Priya\u202e CV.pdf"})
    status = await client.get(f"{API}/files/{named}", headers=me["headers"])
    assert status.json()["filename"] == "Priya CV.pdf"

    # A retried completion is the same row, and does not rename it.
    again = await client.post(
        f"{API}/uploads/{named}/complete", json={"filename": "other.pdf"}, headers=me["headers"]
    )
    assert again.status_code == 202, again.text
    assert (await client.get(f"{API}/files/{named}", headers=me["headers"])).json()[
        "filename"
    ] == "Priya CV.pdf"

    # No body at all, as every client sent before 2026-10-22.
    unnamed = await upload(None)
    files = {f["resume_file_id"]: f for f in await _get(client, me, "/files")}
    assert files[unnamed]["filename"] is None
    assert files[unnamed]["parse_status"] == "QUEUED" and files[unnamed]["terminal"] is False
    assert files[named]["filename"] == "Priya CV.pdf"
