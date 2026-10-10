"""notifications - Pydantic request/response DTOs

Event to channel fan-out, templates.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

The inbox returns the rendered text in the reader's language at the time it
was written. The template code is included so a client can choose an icon or
a destination; it is not a translation key for the client to re-render.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.i18n import LOCALE_CODES
from app.core.schemas import ApiSchema

#: Spelled out rather than generated, because a `Literal` built from a runtime
#: set is not a type mypy or the OpenAPI schema can read -- the four client
#: teams generate their language picker from this enum. The assertion below is
#: what keeps the two honest; `pa` was added on 2026-09-22 and this line is
#: where the build said so.
LocaleCode = Literal["en", "hi", "bn", "mr", "pa", "te", "ta", "gu", "kn"]
assert set(LocaleCode.__args__) == LOCALE_CODES  # type: ignore[attr-defined]


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class InboxItem(_Base):
    id: uuid.UUID
    template_code: str
    body: str
    created_at: datetime
    read_at: datetime | None


class InboxPage(_Base):
    items: list[InboxItem]
    next_cursor: str | None
    unread: int


class PreferencesResponse(_Base):
    locale: str
    sms_enabled: bool
    email_enabled: bool
    push_enabled: bool
    #: Reminders to finish a profile. Turning these off stops them for good.
    nudges_enabled: bool


class UpdatePreferencesRequest(_Base):
    """Send only what changes. The in-app inbox cannot be turned off: it is
    where a message the law requires still reaches you."""

    locale: LocaleCode | None = None
    sms_enabled: bool | None = None
    email_enabled: bool | None = None
    push_enabled: bool | None = None
    nudges_enabled: bool | None = None


class PushDeviceRequest(_Base):
    token: str = Field(
        min_length=20,
        max_length=256,
        pattern=r"^ExponentPushToken\[[A-Za-z0-9_-]+\]$|^ExpoPushToken\[[A-Za-z0-9_-]+\]$",
    )
    platform: Literal["android", "ios"]


class PushDeviceDeleteRequest(_Base):
    token: str = Field(min_length=20, max_length=256)


class SuppressRequest(_Base):
    channel: Literal["SMS", "EMAIL", "PUSH", "ALL"]
    reason: Literal["BOUNCED", "COMPLAINED", "SUPPORT_REQUEST"]


class SuppressResponse(_Base):
    user_id: uuid.UUID
    channel: str
    #: False when that channel was already suppressed.
    created: bool


class UnsubscribeRequest(_Base):
    """The token from an email's `List-Unsubscribe` header."""

    token: str = Field(min_length=1, max_length=2048)


class UnsubscribeResponse(_Base):
    """Deliberately says nothing about whether the token was valid.

    An unauthenticated endpoint that answered differently for a good token,
    an expired one and one naming a deleted account would be a way to probe
    for valid tokens and for who has an account. The reader cannot act on the
    difference in any case: there is nothing for them to do but read this.
    """

    detail: str = "If that link was still valid, you will not receive profile reminders again."
