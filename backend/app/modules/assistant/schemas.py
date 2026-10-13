"""assistant - Pydantic request/response DTOs

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it
is also where an invariant is enforced structurally.

**Every job on a reply is a schema the board already returns**
(`RecommendedJob`, `BoardJobDetail`), and every application one the
Application Board returns. The chat is another way to the same cards, never a
wider view of them: no threshold, no score, no tenant.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import Field

from app.core.schemas import ApiSchema
from app.modules.applications.schemas import ApplicationResponse
from app.modules.assistant.domain import (
    MAX_HISTORY_TURNS,
    MAX_MESSAGE_CHARS,
    MAX_STATE_CHARS,
    MAX_TURN_CHARS,
    Action,
)
from app.modules.jobs.schemas import BoardJobDetail, RecommendedJob


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store, and a NUL in a chat message is no
    different -- see `app/core/schemas.py`."""


class ChatTurn(_Base):
    role: Literal["user", "assistant"]
    text: Annotated[str, Field(max_length=MAX_TURN_CHARS)]


class AssistantMessageRequest(_Base):
    message: Annotated[str, Field(min_length=1, max_length=MAX_MESSAGE_CHARS)]
    #: The conversation so far, oldest first, as the app drew it: the
    #: candidate's messages and the assistant's `reply` texts. Not stored by
    #: us; send the recent turns with each message.
    history: Annotated[list[ChatTurn], Field(max_length=MAX_HISTORY_TURNS)] = Field(
        default_factory=list
    )
    #: The `state` from the previous reply, unchanged. Leave out to start over.
    state: Annotated[str | None, Field(max_length=MAX_STATE_CHARS)] = None


class ApplyProposal(_Base):
    """A job the candidate asked to apply to, waiting for their tap.

    **The assistant never applies.** Confirming is
    `POST /candidate/applications` with `job_id`, exactly as on the job
    screen, with its rules and its errors. `in_app` false is a job the
    employer takes applications for elsewhere: open the job
    (`/candidate/jobs/{job_id}`) for its link instead.
    """

    job_id: uuid.UUID
    job_title: str
    employer_name: str | None = None
    in_app: bool


class AssistantReply(_Base):
    """One answer. Draw `reply`, then whichever of `jobs`, `job`, `apply`
    and `applications` are present, then `suggestions` as tappable chips."""

    reply: str
    #: What the assistant did, for a client that draws each differently.
    action: Action
    #: A list of jobs, best match first; the jobs now "in view", numbered
    #: from 1 in this order for "apply to the second one".
    jobs: list[RecommendedJob] = Field(default_factory=list)
    #: Whether "show more" would find more of this list.
    has_more: bool = False
    #: One job opened, with everything the job screen shows.
    job: BoardJobDetail | None = None
    apply: ApplyProposal | None = None
    applications: list[ApplicationResponse] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    #: Send back unchanged as `state` with the next message.
    state: str
