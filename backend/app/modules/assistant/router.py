"""assistant - HTTP layer

The candidate's job-search chat (2026-10-13).

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import (
    CANDIDATE,
    CurrentUser,
    DbSession,
    require_active_subscription,
    require_role,
)
from app.modules.assistant import service
from app.modules.assistant.schemas import AssistantMessageRequest, AssistantReply

router = APIRouter()

#: Paywalled like the board it searches (R13); the role guard first, so an
#: employer hears 403 rather than "pay us".
PayingCandidate = [Depends(require_role(CANDIDATE)), Depends(require_active_subscription)]


@router.post(
    "/messages",
    response_model=AssistantReply,
    dependencies=PayingCandidate,
    summary="Send the job-search assistant a message",
)
async def send_message(
    payload: AssistantMessageRequest, user: CurrentUser, session: DbSession
) -> AssistantReply:
    """One message in, one reply out: words, and the cards that go with them
    -- jobs found, one job opened, an application to confirm, or the
    candidate's applications.

    **Nothing is stored.** Send the recent turns as `history` and the last
    reply's `state` with each message; leave both out to start over.

    **The assistant never applies.** An `apply` proposal is confirmed with
    `POST /candidate/applications`, as on the job screen.

    Refusals: 422 `assistant_state_invalid` (a `state` this server did not
    write; start over), 429 `rate_limited` (`assistant.message`, per person),
    503 `assistant_unavailable` (the model could not answer; send again).
    """
    return await service.respond(session, ctx=user, payload=payload)
