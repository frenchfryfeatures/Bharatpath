"""privacy - HTTP layer

Export and deletion requests, DSR tracking.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Never paywalled.** A lapsed subscriber loses access, not their data -- the
same rule as reading and withdrawing applications, and one
the law takes for us here: a right of access that costs a subscription is not
a right of access.

**Rate-limited per user**, tighter than the global limit, because an export is
the most expensive read on the platform and a deletion request is the most
consequential write.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, status

from app.core.deps import CurrentUser, DbSession, get_request_id, rate_limit
from app.modules.privacy import service
from app.modules.privacy.schemas import (
    DsrRequestList,
    DsrRequestResponse,
    ExportDownloadResponse,
)

router = APIRouter()

DsrWriteLimit = Depends(rate_limit("privacy.request"))


def _response(view: service.RequestView) -> DsrRequestResponse:
    row = view.row
    return DsrRequestResponse(
        id=row.id,
        type=row.type,
        state=row.state,
        created_at=row.created_at,
        due_at=row.due_at,
        completed_at=row.completed_at,
        erasable_at=view.erasable_at,
        download_available=view.download_available,
    )


@router.post(
    "/requests/export",
    response_model=DsrRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[DsrWriteLimit],
    summary="Ask for a copy of your personal data",
    description=(
        "Accepted and built in the background. Poll `GET /privacy/requests/{id}` "
        "until `download_available` is true, then fetch a short-lived link from "
        "`/download`. One open export at a time (409 `dsr_request_already_open`)."
    ),
)
async def request_export(
    user: CurrentUser, session: DbSession, request: Request
) -> DsrRequestResponse:
    view = await service.request_export(
        session, ctx=user, now=datetime.now(UTC), request_id=get_request_id(request)
    )
    return _response(view)


@router.post(
    "/requests/deletion",
    response_model=DsrRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[DsrWriteLimit],
    summary="Ask for your account and personal data to be erased",
    description=(
        "Candidates only; a business account answers 403 "
        "`dsr_deletion_requires_support`. Nothing is destroyed before "
        "`erasable_at`, and until then the request can be withdrawn. Payment "
        "and audit records are kept under the legal carve-out, pointing at an "
        "account that no longer identifies anyone."
    ),
)
async def request_deletion(
    user: CurrentUser, session: DbSession, request: Request
) -> DsrRequestResponse:
    view = await service.request_deletion(
        session, ctx=user, now=datetime.now(UTC), request_id=get_request_id(request)
    )
    return _response(view)


@router.get(
    "/requests",
    response_model=DsrRequestList,
    summary="Your export and deletion requests, newest first",
)
async def list_requests(user: CurrentUser, session: DbSession) -> DsrRequestList:
    return DsrRequestList(
        items=[_response(v) for v in await service.list_requests(session, ctx=user)]
    )


@router.get(
    "/requests/{dsr_id}",
    response_model=DsrRequestResponse,
    summary="One of your requests, with its due date",
)
async def get_request(
    dsr_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> DsrRequestResponse:
    return _response(await service.get_request(session, ctx=user, dsr_id=dsr_id))


@router.post(
    "/requests/{dsr_id}/withdraw",
    response_model=DsrRequestResponse,
    dependencies=[DsrWriteLimit],
    summary="Withdraw a deletion request before it runs",
)
async def withdraw(
    dsr_id: uuid.UUID, user: CurrentUser, session: DbSession, request: Request
) -> DsrRequestResponse:
    view = await service.withdraw(
        session,
        ctx=user,
        dsr_id=dsr_id,
        now=datetime.now(UTC),
        request_id=get_request_id(request),
    )
    return _response(view)


@router.get(
    "/requests/{dsr_id}/download",
    response_model=ExportDownloadResponse,
    dependencies=[DsrWriteLimit],
    summary="A short-lived link to a finished export",
    description="Each call mints a new link and is audited. 409 while not ready or once expired.",
)
async def download(
    dsr_id: uuid.UUID, user: CurrentUser, session: DbSession, request: Request
) -> ExportDownloadResponse:
    url, ttl = await service.export_download(
        session, ctx=user, dsr_id=dsr_id, request_id=get_request_id(request)
    )
    return ExportDownloadResponse(url=url, expires_in_seconds=ttl)
