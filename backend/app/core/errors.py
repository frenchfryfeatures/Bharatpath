"""Error hierarchy, rendered as RFC 7807 `application/problem+json`.

Two rules that are easy to get wrong and expensive to retrofit:

1. **The backend never returns a user-facing English sentence as the display
   string.** All four clients localise into 6-8 languages (PRD section 8: no
   hardcoded user-facing strings), so the API returns a stable machine-readable
   `code` plus parameters, and the clients own the copy.

2. **A resource belonging to another tenant returns 404, never 403.** A 403
   confirms the resource exists, which is itself a cross-tenant leak.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.responses import JSONResponse

PROBLEM_JSON = "application/problem+json"


class AppError(Exception):
    """Base for every error the application raises deliberately."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "internal_error"
    title: str = "Internal error"

    def __init__(
        self,
        *,
        code: str | None = None,
        title: str | None = None,
        params: dict[str, Any] | None = None,
    ) -> None:
        self.code = code or self.code
        self.title = title or self.title
        # `params` are substitution values for the client's localised string,
        # never a pre-rendered sentence.
        self.params = params or {}
        super().__init__(self.code)


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    title = "Resource not found"


class PermissionDeniedError(AppError):
    """Use only where the caller may know the resource exists.

    For anything tenant-scoped, raise NotFoundError instead.
    """

    status_code = status.HTTP_403_FORBIDDEN
    code = "permission_denied"
    title = "Permission denied"


class UnauthenticatedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthenticated"
    title = "Authentication required"


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "validation_error"
    title = "Request failed validation"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"
    title = "Resource state conflict"


class SubscriptionRequiredError(AppError):
    """Pay-first, all three audiences (client, 2026-08-27 - R13).

    Deliberately distinct from KybRequiredError: they fail for different
    reasons and the client renders different screens. Do not merge them.
    """

    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = "subscription_required"
    title = "An active subscription is required"


class AccessWindowExpiredError(AppError):
    """The employer's paid period has lapsed (R14).

    The subscription IS the entitlement - there is no per-candidate unlock to
    check any more. A window lapsing mid-session must mask the very next read.
    """

    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = "access_window_expired"
    title = "Access period has expired"


class KybRequiredError(AppError):
    """PRD rule 7 / SRS 1.11.4. Server-side, not hidden in the UI."""

    status_code = status.HTTP_403_FORBIDDEN
    code = "kyb_required"
    title = "Business verification required"


class ConsentRequiredError(AppError):
    """PRD rule 8. Institution-side bypass is prohibited."""

    status_code = status.HTTP_403_FORBIDDEN
    code = "consent_required"
    title = "Student consent required"


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"
    title = "Too many requests"


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    body: dict[str, Any] = {
        "type": f"https://bharatpath.example/problems/{exc.code}",
        "title": exc.title,
        "status": exc.status_code,
        "code": exc.code,
        "instance": str(request.url.path),
    }
    if exc.params:
        body["params"] = exc.params
    if request_id := getattr(request.state, "request_id", None):
        body["request_id"] = request_id
    headers: dict[str, str] = {}
    # RFC 9110. A client that honours this backs off by exactly the window
    # rather than retrying in a loop and extending its own lockout.
    if isinstance(exc, RateLimitedError) and "retry_after_seconds" in exc.params:
        headers["Retry-After"] = str(exc.params["retry_after_seconds"])
    return JSONResponse(
        status_code=exc.status_code, content=body, media_type=PROBLEM_JSON, headers=headers
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never leak an internal identifier, a stack trace, or SQL to a client."""
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "type": "https://bharatpath.example/problems/internal_error",
            "title": "Internal error",
            "status": 500,
            "code": "internal_error",
            "request_id": getattr(request.state, "request_id", None),
        },
        media_type=PROBLEM_JSON,
    )
