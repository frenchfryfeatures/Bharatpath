"""notifications - HTTP layer

Event to channel fan-out, templates.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Every signed-in account has an inbox** -- candidate, employer, college and
staff alike -- and every route here reads only the caller's own messages and
settings. Nothing is paywalled: a lapsed subscriber must still be able to
read that their access ended, and to stop the reminders.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response, status

from app.core.deps import CurrentUser, DbSession
from app.modules.notifications import service
from app.modules.notifications.schemas import (
    InboxItem,
    InboxPage,
    PreferencesResponse,
    PushDeviceDeleteRequest,
    PushDeviceRequest,
    UnsubscribeRequest,
    UnsubscribeResponse,
    UpdatePreferencesRequest,
)

router = APIRouter()


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
async def register_device(
    payload: PushDeviceRequest, user: CurrentUser, session: DbSession
) -> Response:
    await service.register_push_device(
        session, ctx=user, token=payload.token, platform=payload.platform
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/devices", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_device(
    payload: PushDeviceDeleteRequest, user: CurrentUser, session: DbSession
) -> Response:
    await service.unregister_push_device(session, ctx=user, token=payload.token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=InboxPage, summary="My in-app messages, newest first")
async def inbox(
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: int | None = Query(default=None, ge=1, le=100),
) -> InboxPage:
    return await service.inbox(session, ctx=user, cursor=cursor, limit=limit)


@router.get(
    "/preferences",
    response_model=PreferencesResponse,
    summary="My language and which channels may reach me",
)
async def get_preferences(user: CurrentUser, session: DbSession) -> PreferencesResponse:
    return await service.preferences(session, ctx=user)


@router.patch(
    "/preferences",
    response_model=PreferencesResponse,
    summary="Change my language or turn a channel off",
)
async def update_preferences(
    payload: UpdatePreferencesRequest, user: CurrentUser, session: DbSession
) -> PreferencesResponse:
    """A UPI pre-debit notice is still sent by SMS with SMS turned off: the
    law requires it before every automatic debit. Nothing else is."""
    return await service.update_preferences(
        session, ctx=user, changes=payload.model_dump(exclude_unset=True)
    )


@router.post(
    "/{notification_id}/read",
    response_model=InboxItem,
    summary="Mark one of my messages read",
)
async def mark_read(notification_id: uuid.UUID, user: CurrentUser, session: DbSession) -> InboxItem:
    return await service.mark_read(session, ctx=user, notification_id=notification_id)


@router.post(
    "/unsubscribe",
    response_model=UnsubscribeResponse,
    summary="Stop incomplete-profile reminders, from the link in an email",
    description=(
        "**Unauthenticated, by design.** The caller is somebody who read an "
        "email and does not want more of them; requiring a sign-in to stop "
        "reminders is what makes people press the spam button instead. The "
        "token names one account and this one action, and can only turn "
        "nudges *off*.\n\n"
        "POST rather than GET because mail clients and security scanners "
        "prefetch links in email, and a GET would unsubscribe people who "
        "never clicked. This is the RFC 8058 one-click endpoint named by the "
        "`List-Unsubscribe-Post` header."
    ),
)
async def unsubscribe_from_nudges(
    payload: UnsubscribeRequest, session: DbSession
) -> UnsubscribeResponse:
    # The same answer whether the token was good, expired, forged or for an
    # account that no longer exists. Distinguishing them would let an
    # unauthenticated caller probe for valid tokens and for who has an
    # account -- and the reader cannot act on the difference anyway.
    await service.unsubscribe_by_token(session, token=payload.token)
    return UnsubscribeResponse()
