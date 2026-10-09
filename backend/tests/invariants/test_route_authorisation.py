"""No route reaches business data without a verified identity.

The "no-anonymous-access" half of tenant isolation.

A hand-kept list of endpoints would be out of date the day a route is added.
So this drives every documented route with no `Authorization` header and
asserts it refuses, and a new route is covered the moment it exists.

It asks the running application rather than reading its dependency tree. A
structural check has to reach into FastAPI internals that move between versions,
and it can only prove a guard is *declared*; this proves the request is actually
refused, which is the thing anyone cares about.

**Known limit:** routes with `include_in_schema=False` are invisible here
because they are absent from the OpenAPI document. Today that is only `/`,
asserted separately below.

The client reversed the anonymous flow on 2026-08-27: *"Without login the user
cannot parse the resume / cannot get a score."* So public means health checks and
the doors into authentication, and nothing else. (Phone OTP's
`/auth/otp/start` left this list on 2026-09-18, when the client deferred
phone OTP and the route stopped being registered.)
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

#: Every route allowed to answer an unauthenticated caller, and why.
#: Adding to this set is a deliberate act that shows up in review -- which is
#: the point of keeping it here rather than inferring it from a path prefix.
PUBLIC: dict[tuple[str, str], str] = {
    (
        "POST",
        "/api/v1/auth/resume-preview",
    ): (
        "Rate-limited transient resume reading before signup; "
        "no storage, identity creation, or scoring."
    ),
    ("GET", "/api/v1/health"): "Liveness probe. Touches no data.",
    ("GET", "/api/v1/health/ready"): "Readiness probe. Touches no data.",
    ("POST", "/api/v1/billing/callbacks/{provider}"): (
        "Called server-to-server by the payment gateway, which holds no user "
        "token. Authenticated instead by an HMAC signature over the raw body, "
        "checked before anything is read or stored: an unsigned call is a 401 "
        "and writes nothing. It grants nothing itself either -- it stores the "
        "callback for processing."
    ),
    ("POST", "/api/v1/notifications/unsubscribe"): (
        "The RFC 8058 one-click unsubscribe named by the List-Unsubscribe "
        "header on a nudge email. The caller is somebody who "
        "read an email and wants no more of them; requiring a sign-in to stop "
        "reminders is what makes people press the spam button instead, which "
        "costs the sending domain's reputation and takes every other message "
        "with it. "
        "Authenticated instead by a signed token that names one account and "
        "one purpose, checked before anything is read or written. It can only "
        "turn nudges OFF -- never on, never another preference, and it reads "
        "nothing back, so the worst a stolen token does is stop reminders its "
        "holder was already getting. The response is identical for a good "
        "token, an expired one and one naming a deleted account, so it cannot "
        "be used to probe for either."
    ),
    ("POST", "/api/v1/auth/dev/token"): (
        "Local development only. The route is not registered at all unless "
        "AUTH_ALLOW_LOCAL_TOKENS is set, and Settings refuses that flag outside "
        "local and CI."
    ),
}

#: What an unauthenticated caller may be told. Anything else -- a 200, a 404
#: that reveals existence, a 500 -- means the guard did not run.
REFUSALS = {401, 403}


def _documented(app: Any) -> list[tuple[str, str]]:
    return [
        (method.upper(), path) for path, ops in app.openapi()["paths"].items() for method in ops
    ]


def _concrete(path: str) -> str:
    """`/jobs/{job_id}` -> `/jobs/<a uuid>`.

    The value never matters: authentication is refused before anything looks
    the identifier up. That is the point -- a 404 here would mean the lookup
    ran first and just told an anonymous caller whether a row exists.
    """
    out = path
    while "{" in out:
        head, _, rest = out.partition("{")
        _, _, tail = rest.partition("}")
        out = f"{head}{uuid.uuid4()}{tail}"
    return out


async def test_no_undocumented_route_escapes_this_check(client: Any, app: Any) -> None:
    """`/` is the only route hidden from the schema, and it carries no data."""
    hidden = await client.get("/")
    assert hidden.status_code == 200
    assert "/" not in app.openapi()["paths"]


async def test_every_route_refuses_an_unauthenticated_caller(client: Any, app: Any) -> None:
    leaked: list[str] = []

    for method, path in _documented(app):
        if (method, path) in PUBLIC:
            continue
        response = await client.request(method, _concrete(path), json={})
        if response.status_code not in REFUSALS:
            leaked.append(f"{method} {path} -> {response.status_code}")

    assert not leaked, (
        "These routes answered a caller with no Authorization header:\n  "
        + "\n  ".join(sorted(leaked))
        + "\n\nAdd `CurrentUser` (or a guard that depends on it), or add the route "
        "to PUBLIC in this file with the reason it is safe."
    )


def test_the_public_allowlist_has_no_stale_entries(app: Any) -> None:
    """A renamed or deleted route must not leave a standing exemption behind
    for whatever route next takes its path."""
    stale = set(PUBLIC) - set(_documented(app))
    assert not stale, f"PUBLIC lists routes that no longer exist: {sorted(stale)}"


@pytest.mark.parametrize(("method", "path"), sorted(PUBLIC))
def test_no_candidate_or_resume_route_is_public(method: str, path: str) -> None:
    """The anonymous flow was deleted, not merely discouraged (plan.md 5.7).

    Resume upload included: PRD 4.1 and SRS 2.25.1 wanted a score before
    sign-up and the client reversed it. Asserted structurally so it cannot
    drift back one convenient endpoint at a time.
    """
    # The October onboarding revision permits transient reading before signup,
    # never original-file storage, account lookup, or scoring before identity.
    if (method, path) == ("POST", "/api/v1/auth/resume-preview"):
        return
    assert "/candidate" not in path, f"{method} {path} cannot be public"
    assert "/resume" not in path, f"{method} {path} cannot be public"
