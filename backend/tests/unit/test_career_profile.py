from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock

import pytest
from pydantic import ValidationError
from pypdf import PdfWriter

from app.core.errors import PermissionDeniedError
from app.core.tenant import TenantContext
from app.modules.candidate import career_service
from app.modules.candidate.career import (
    CareerDetails,
    CareerSaveRequest,
    form_fields,
    missing_required,
)
from app.modules.resume.preview import render_pdf


def fresher(**updates) -> CareerDetails:
    return CareerDetails(
        phone="+919876543210",
        work_status="FRESHER",
        current_city="Pune",
        key_skills=["Python"],
        highest_qualification="Graduate",
        course="BSc",
        course_type="FULL_TIME",
        institution="University",
        starting_year=2020,
        passing_year=2023,
        **updates,
    )


def context(role="CANDIDATE", tenant_id=None):
    return TenantContext(user_id=uuid.uuid4(), tenant_id=tenant_id, role=role, pool="CANDIDATE")


def test_fresher_does_not_need_employment_salary_preferences_or_gender():
    assert missing_required(fresher()) == []


def test_experienced_candidate_needs_dates_and_nonzero_experience():
    details = fresher().model_copy(
        update={"work_status": "EXPERIENCED", "currently_employed": "NO"}
    )
    assert {
        "company_name",
        "job_title",
        "employment_start",
        "employment_end",
        "experience_years",
    } <= set(missing_required(details))


@pytest.mark.parametrize(
    "values",
    [
        {"phone": "9876543210"},
        {"experience_months": 12},
        {"annual_salary": -1},
        {"employment_start": "2025-13"},
        {"employment_start": "2025-01", "employment_end": "2024-12"},
        {"starting_year": 2024, "passing_year": 2020},
        {"work_status": "FRESHER", "experience_years": 2},
        {"preferred_locations": ["A", "B", "C", "D", "E", "F"]},
        {"gender": "invented"},
    ],
)
def test_invalid_details_are_refused(values):
    with pytest.raises(ValidationError):
        CareerDetails(**values)


def test_authentication_secrets_are_never_profile_fields():
    with pytest.raises(ValidationError):
        CareerDetails(password="not stored")
    assert not {"password", "confirm_password", "email"} & CareerDetails.model_fields.keys()


def test_both_clients_receive_all_fields_once():
    fields = form_fields()
    assert {field["key"] for field in fields} == CareerDetails.model_fields.keys()
    assert len(fields) == len(CareerDetails.model_fields)
    assert not next(field for field in fields if field["key"] == "gender")["required"]


def test_existing_location_is_used_before_resume_prefill():
    row = SimpleNamespace(career={}, city="Pune", updated_at=datetime.now(UTC))
    assert career_service._response(row).details.current_city == "Pune"


@pytest.mark.asyncio
async def test_only_candidate_can_save_details():
    with pytest.raises(PermissionDeniedError):
        await career_service.save_details(
            AsyncMock(),
            ctx=context("EMPLOYER_OWNER", uuid.uuid4()),
            payload=CareerSaveRequest(details=fresher()),
        )


@pytest.mark.asyncio
async def test_incomplete_completion_is_rejected_before_writing(monkeypatch):
    monkeypatch.setattr(career_service.repository, "get_profile", AsyncMock(return_value=None))
    write = AsyncMock()
    monkeypatch.setattr(career_service.repository, "set_career", write)
    with pytest.raises(career_service.CareerIncompleteError) as failure:
        await career_service.save_details(
            AsyncMock(),
            ctx=context(),
            payload=CareerSaveRequest(details=CareerDetails(), complete=True),
        )
    assert "phone" in failure.value.params["fields"]
    assert "full_name" in failure.value.params["fields"]
    write.assert_not_awaited()


@pytest.mark.asyncio
async def test_owner_scoped_resume_and_revision_without_scoring(monkeypatch):
    ctx = context()
    version_id = uuid.uuid4()
    revised_id = uuid.uuid4()
    file_id = uuid.uuid4()
    row = SimpleNamespace(
        career={}, full_name="Kavya Iyer", city=None, updated_at=datetime.now(UTC)
    )
    monkeypatch.setattr(career_service.repository, "get_profile", AsyncMock(return_value=row))
    version_read = AsyncMock(
        return_value=SimpleNamespace(
            parsed={"raw_text": "Original employment and education resume text"},
            resume_file_id=file_id,
        )
    )
    monkeypatch.setattr(career_service.resume_service, "get_version_for_profile", version_read)
    revise = AsyncMock(return_value=SimpleNamespace(id=revised_id))
    monkeypatch.setattr(career_service.resume_service, "edit_version", revise)

    async def write(session, *, user_id, career, city):
        assert user_id == ctx.user_id
        row.career = career
        return row

    monkeypatch.setattr(career_service.repository, "set_career", write)
    result = await career_service.save_details(
        AsyncMock(),
        ctx=ctx,
        payload=CareerSaveRequest(
            details=fresher(gender="PREFER_NOT_TO_SAY", annual_salary=100),
            resume_version_id=version_id,
            complete=True,
        ),
    )
    version_read.assert_awaited_once_with(
        ANY, user_id=ctx.user_id, resume_version_id=version_id, current_only=True
    )
    assert result.resume_version_id == revised_id
    assert result.resume_file_id == file_id
    assert result.completed
    text = revise.call_args.kwargs["payload"].text
    assert "PREFER_NOT_TO_SAY" not in text
    assert "salary" not in text.lower()
    assert "Python" in text


def test_pdf_preview_is_local_and_bounded():
    writer = PdfWriter()
    for _ in range(21):
        writer.add_blank_page(width=120, height=160)
    content = io.BytesIO()
    writer.write(content)
    pages, truncated = render_pdf(content.getvalue())
    assert len(pages) == 20
    assert truncated
    assert all(page.startswith("iVBOR") for page in pages)


@pytest.mark.asyncio
async def test_confirmation_requires_payment_before_service_runs(monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core import deps
    from app.core.errors import AppError, app_error_handler
    from app.modules.resume.router import router

    app = FastAPI()
    app.include_router(router, prefix="/resume")
    app.add_exception_handler(AppError, app_error_handler)
    app.dependency_overrides[deps.current_user] = lambda: context()
    app.dependency_overrides[deps.get_db] = lambda: AsyncMock()
    monkeypatch.setattr(deps, "has_active_subscription", AsyncMock(return_value=False))
    monkeypatch.setattr(deps, "has_active_college_seat", AsyncMock(return_value=False))
    confirm = AsyncMock()
    monkeypatch.setattr(career_service.resume_service, "confirm_version", confirm)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        result = await client.post(f"/resume/versions/{uuid.uuid4()}/confirm")
    assert result.status_code == 402
    confirm.assert_not_awaited()


@pytest.mark.asyncio
async def test_new_profile_routes_refuse_unauthenticated_requests():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core import deps
    from app.core.errors import AppError, UnauthenticatedError, app_error_handler
    from app.modules.candidate.router import router

    app = FastAPI()
    app.include_router(router, prefix="/candidate")
    app.add_exception_handler(AppError, app_error_handler)

    async def unauthenticated():
        raise UnauthenticatedError()

    app.dependency_overrides[deps.current_user] = unauthenticated
    app.dependency_overrides[deps.get_db] = lambda: AsyncMock()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for method, path in [
            ("GET", "/profile/form"),
            ("GET", "/profile/details"),
            ("PUT", "/profile/details"),
            ("POST", f"/profile/prefill/{uuid.uuid4()}"),
        ]:
            result = await client.request(method, f"/candidate{path}")
            assert result.status_code == 401
