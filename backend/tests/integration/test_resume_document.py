"""Create, review, edit and reopen the same complete resume without AI parsing."""

from typing import Any

import pytest

from tests.integration.test_candidate_marketplace import _candidate
from tests.unit.test_resume_builder import _doc

pytestmark = pytest.mark.integration
BASE = "/api/v1/candidate/resume"


async def test_complete_document_roundtrip_and_immutable_edits(
    client: Any, mint_token: Any, monkeypatch: pytest.MonkeyPatch
):
    from app.modules.resume import service

    async def never_parse(*args, **kwargs):
        raise AssertionError("Human-entered structured data must never be re-parsed")

    monkeypatch.setattr(service, "structure_resume", never_parse)
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    headers = candidate["headers"]
    document = _doc()
    document["contacts"]["others"] = [{"label": "Portfolio", "url": "https://portfolio.test"}]
    document["certifications"][0].update(
        credential_id="123", url="https://cert.test", issue_date="2023-02"
    )
    document["other_sections"] = [{"heading": "Publications", "items": ["Research paper"]}]
    response = await client.post(f"{BASE}/document", headers=headers, json=document)
    assert response.status_code == 201, response.text
    version_id = response.json()["resume_version_id"]
    original = await client.get(f"{BASE}/versions/{version_id}", headers=headers)
    assert original.json()["structured_resume"] == document
    assert original.json()["confirmed"] is False
    document["experience"][0]["skills_used"] = ["SQL", "Python"]
    document["education"][0]["description"] = "Advanced research"
    edited = await client.post(
        f"{BASE}/versions/{version_id}/edit", headers=headers, json={"structured_resume": document}
    )
    assert edited.status_code == 201, edited.text
    replacement_id = edited.json()["resume_version_id"]
    assert replacement_id != version_id
    replacement = await client.get(f"{BASE}/versions/{replacement_id}", headers=headers)
    assert replacement.json()["structured_resume"] == document
    assert replacement.json()["confirmed"] is False
    old = await client.get(f"{BASE}/versions/{version_id}", headers=headers)
    assert old.json()["structured_resume"] == original.json()["structured_resume"]
    stale = await client.post(
        f"{BASE}/versions/{version_id}/edit", headers=headers, json={"structured_resume": document}
    )
    assert stale.status_code == 409
    stranger = await _candidate(mint_token, scored=False, subscribed=False)
    denied = await client.post(
        f"{BASE}/versions/{replacement_id}/edit",
        headers=stranger["headers"],
        json={"structured_resume": document},
    )
    assert denied.status_code == 404


async def test_only_candidates_can_submit_full_documents(client: Any, mint_token: Any):
    headers, _ = mint_token(pool="BUSINESS", email="resume-editor-business@example.test")
    response = await client.post(f"{BASE}/document", headers=headers, json=_doc())
    assert response.status_code == 403, response.text


async def test_preview_and_download_render_the_selected_version_without_writes(
    client: Any, mint_token: Any
):
    import base64
    import io

    import pypdf

    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    headers = candidate["headers"]
    document = _doc()
    response = await client.post(f"{BASE}/document", headers=headers, json=document)
    version_id = response.json()["resume_version_id"]
    changed = {**document, "headline": "An updated headline"}
    await client.post(
        f"{BASE}/versions/{version_id}/edit", headers=headers, json={"structured_resume": changed}
    )
    before = (await client.get(f"{BASE}/versions", headers=headers)).json()
    pdf = await client.get(f"{BASE}/versions/{version_id}/render", headers=headers)
    assert pdf.status_code == 200, pdf.text if pdf.status_code != 200 else ""
    assert pdf.headers["content-type"] == "application/pdf"
    assert "attachment" in pdf.headers["content-disposition"]
    assert pdf.headers["cache-control"] == "no-store"
    rendered = " ".join(
        page.extract_text() for page in pypdf.PdfReader(io.BytesIO(pdf.content)).pages
    )
    assert document["full_name"] in rendered
    assert "An updated headline" not in rendered
    preview = await client.get(f"{BASE}/versions/{version_id}/render?format=png", headers=headers)
    assert preview.status_code == 200, preview.text
    assert base64.b64decode(preview.json()["pages"][0]).startswith(b"\x89PNG")
    after = (await client.get(f"{BASE}/versions", headers=headers)).json()
    assert before == after
    assert all(not version["confirmed"] for version in after)
    stranger = await _candidate(mint_token, scored=False, subscribed=False)
    denied = await client.get(f"{BASE}/versions/{version_id}/render", headers=stranger["headers"])
    assert denied.status_code == 404
    anonymous = await client.get(f"{BASE}/versions/{version_id}/render")
    assert anonymous.status_code == 401
    invalid = await client.get(
        f"{BASE}/versions/{version_id}/render?format=invalid", headers=headers
    )
    assert invalid.status_code == 422
