"""Stopping the nudges without signing in.

A nudge is the only message we send that a person may reasonably not want.
The preference (`notification_preferences.nudges_enabled`) is reachable by
signing in, which is precisely what somebody ignoring three reminders is not
going to do. The alternative available to them is the spam button,
which costs the sending domain's reputation and takes every other message
down with it.

---

## What this is, and what it is deliberately not

**A signed token naming one account and one purpose**, and an endpoint that
turns nudges off for it. Nothing else: it cannot read anything, cannot change
any other preference, and cannot turn nudges back *on*. The worst a leaked
token does is stop reminders the holder was already receiving.

**It is not a session.** It carries no role, no tenant, and is not accepted
by anything but its own endpoint (`purpose`, below).

## Why a header and not a link in the body

The email body is a translated template (`templates.py` + the locale
bundles), so adding a visible link would mean a new variable in nine bundles
and a `TEMPLATES_VERSION` bump. Instead the address goes in the
`List-Unsubscribe` and `List-Unsubscribe-Post` headers -- RFC 8058, which is
what Gmail and Outlook actually read to draw their own Unsubscribe button,
and what mailbox providers look for when deciding whether bulk mail is
well-behaved.

A visible in-body link is a content decision on top of this, and belongs with
the rest of the template copy the client still owes (blockers C5).

## Why POST and not GET

Mail clients and security scanners **prefetch links in email**. A GET that
unsubscribed would unsubscribe people who never clicked anything, and we
would never know. RFC 8058 one-click is a POST for exactly this reason, and
`List-Unsubscribe-Post` is what tells the client to use it.
"""

from __future__ import annotations

import uuid
from typing import Any, Final

import jwt

from app.core.logging import get_logger
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: Pins the token to this one action. A token minted here is not a credential
#: anywhere else, and a token minted elsewhere is not accepted here.
PURPOSE: Final = "notifications.unsubscribe"

ALGORITHM: Final = "HS256"

#: Long, because the whole point is a link in an email somebody reads weeks
#: later. The risk it carries is "someone stops their own reminders", so the
#: usual argument for a short life does not apply -- and a token that has
#: expired by the time it is clicked sends the reader to the spam button
#: instead, which is the outcome this exists to avoid.
TTL_DAYS: Final = 90


def configured(settings: Settings | None = None) -> bool:
    """Whether a link can be offered at all.

    **Both the secret and the public URL, or neither.** A `List-Unsubscribe`
    header pointing at a host we do not serve, or carrying a token we cannot
    verify, shows the reader an Unsubscribe button that silently fails --
    worse than no button, because the next step is the spam button.
    """
    settings = settings or get_settings()
    return bool(settings.notifications_unsubscribe_secret and settings.public_api_base_url)


def _secret(settings: Settings) -> str:
    value = settings.notifications_unsubscribe_secret
    if value is None:  # pragma: no cover - guarded by `configured`
        raise RuntimeError("unsubscribe secret is not configured")
    return value.get_secret_value()


def mint(user_id: uuid.UUID, *, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return jwt.encode(
        {"sub": str(user_id), "purpose": PURPOSE},
        _secret(settings),
        algorithm=ALGORITHM,
        headers={"typ": "JWT"},
    )


def verify(token: str, *, settings: Settings | None = None) -> uuid.UUID | None:
    """The account this token unsubscribes, or None if it does not.

    Returns None rather than raising for every failure -- expired, forged,
    wrong purpose, malformed. The endpoint answers the same way whichever it
    was, because telling an unauthenticated caller *why* their token was
    refused is a way to probe for valid ones.
    """
    settings = settings or get_settings()
    if not configured(settings):
        return None
    try:
        claims: dict[str, Any] = jwt.decode(token, _secret(settings), algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    # Checked explicitly: a token minted for anything else must not work here,
    # however it was signed.
    if claims.get("purpose") != PURPOSE:
        return None
    try:
        return uuid.UUID(str(claims.get("sub")))
    except (TypeError, ValueError):
        return None


def headers_for(user_id: uuid.UUID, *, settings: Settings | None = None) -> dict[str, str]:
    """RFC 8058 unsubscribe headers, or nothing when unconfigured."""
    settings = settings or get_settings()
    if not configured(settings):
        return {}
    url = (
        f"{settings.public_api_base_url.rstrip('/')}"
        f"{settings.api_v1_prefix}/notifications/unsubscribe"
        f"?token={mint(user_id, settings=settings)}"
    )
    return {
        "List-Unsubscribe": f"<{url}>",
        # Without this a client may still GET the URL. With it, one-click
        # means a POST, which is the only method the endpoint offers.
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
