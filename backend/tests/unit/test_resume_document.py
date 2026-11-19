"""The full editor contract and lossless, privacy-safe document projection."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError as SchemaError

from app.core.errors import ValidationError
from app.modules.resume.document import document_payload
from app.modules.resume.schemas import ResumeEditRequest
from app.modules.resume.structuring import StructuredResume
from tests.unit.test_resume_builder import _doc


def test_both_client_contracts_match_the_backend():
    root = Path(__file__).resolve().parents[3]
    web = json.loads((root / "frontend/lib/resume/editor-contract.json").read_text(encoding="utf8"))
    mobile = json.loads(
        (root / "mobile-app/services/profile/resume-editor-contract.json").read_text(
            encoding="utf8"
        )
    )
    assert web == mobile
    assert web["schema"] == StructuredResume.model_json_schema()
    assert web["document"] == StructuredResume().model_dump(mode="json")


def test_full_document_is_preserved_while_scoring_excludes_contacts():
    data = _doc()
    data["contacts"]["instagram"] = "https://instagram.com/example"
    data["certifications"][0].update(
        credential_id="ABC123", url="https://credential.test", issue_date="2024-02"
    )
    data["education"][0]["description"] = "Research and coursework"
    data["experience"][0]["employment_type"] = "Full time"
    result = document_payload(StructuredResume.model_validate(data))
    assert result["structured_resume"]["data"] == data
    assert result["structured_resume"]["status"] == "READY"
    assert "instagram.com" not in result["raw_text"]
    assert data["contacts"]["email"] not in result["raw_text"]
    assert data["full_name"] not in result["raw_text"]
    assert "SQL" in result["raw_text"]


def test_document_edits_are_exclusive_and_old_clients_still_work():
    assert ResumeEditRequest(structured_resume=_doc()).structured_resume is not None
    assert ResumeEditRequest(
        text="A detailed resume describing software engineering work. " * 2
    ).text
    with pytest.raises(SchemaError):
        ResumeEditRequest(
            structured_resume=_doc(),
            text="A detailed resume describing software engineering work. " * 2,
        )
    with pytest.raises(SchemaError):
        ResumeEditRequest()
    with pytest.raises(SchemaError):
        ResumeEditRequest(structured_resume={**_doc(), "unexpected": "discarding would lose data"})


def test_invalid_dates_do_not_reach_persistence():
    data = _doc()
    data["experience"][0]["start_date"] = "2024-99"
    with pytest.raises(ValidationError):
        document_payload(StructuredResume.model_validate(data))
