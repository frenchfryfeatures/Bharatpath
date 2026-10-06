from __future__ import annotations

import io
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from docx import Document

from app.modules.candidate.extraction import ExtractedCareer
from app.modules.resume import onboarding_service
from app.modules.resume.service import UploadRejectedError


def document_bytes():
    doc = Document()
    doc.add_paragraph("Priya Sharma, priya@example.invalid, +919876543210. Fresher. Python, SQL.")
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_preview_returns_facts_without_database_or_storage(monkeypatch):
    monkeypatch.setattr(
        onboarding_service,
        "extract_career",
        AsyncMock(
            return_value=ExtractedCareer(
                full_name="Priya Sharma",
                email="priya@example.invalid",
                phone="+919876543210",
                work_status="FRESHER",
                key_skills=["Python"],
            )
        ),
    )
    store = Mock()
    monkeypatch.setattr(onboarding_service.storage, "get_s3_client", store)
    event = AsyncMock()
    monkeypatch.setattr(onboarding_service, "emit", event)
    result = await onboarding_service.preview(document_bytes())
    assert result["full_name"] == "Priya Sharma"
    assert result["details"]["phone"] == "+919876543210"
    assert "full_name" not in result["details"]
    store.assert_not_called()
    event.assert_not_awaited()


@pytest.mark.asyncio
async def test_non_resume_bytes_are_refused():
    with pytest.raises(UploadRejectedError):
        await onboarding_service.preview(b"not a PDF or DOCX")


@pytest.mark.asyncio
async def test_verified_intake_stores_owner_file_and_never_scores(monkeypatch):
    uid = uuid.uuid4()
    version = SimpleNamespace(id=uuid.uuid4())
    client = Mock()
    monkeypatch.setattr(onboarding_service.storage, "get_s3_client", lambda: client)
    create_file = AsyncMock()
    monkeypatch.setattr(onboarding_service.repository, "create_resume_file", create_file)
    monkeypatch.setattr(
        onboarding_service.repository, "create_version", AsyncMock(return_value=version)
    )
    monkeypatch.setattr(onboarding_service.repository, "set_parse_status", AsyncMock())
    events = AsyncMock()
    monkeypatch.setattr(onboarding_service, "emit", events)
    result = await onboarding_service.intake(AsyncMock(), user_id=uid, content=document_bytes())
    assert result.id == version.id
    assert create_file.call_args.kwargs["user_id"] == uid
    assert str(uid) in client.put_object.call_args.kwargs["Key"]
    assert events.call_args.kwargs["event_type"] == "resume.version_created"
