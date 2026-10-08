"""FastAPI application factory.

One deployable service consumed by all four surfaces. PRD section 1.1 forbids
per-surface backends; it says nothing about internal decomposition, so this is
a modular monolith with hard internal boundaries enforced by import-linter.

`uvicorn app.main:app` and `celery -A app.worker worker` run from the same
container image, so the API and the workers can never drift on model
definitions.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, Final

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core import ratelimit
from app.core.auth import dispose_identity_provider
from app.core.cache import dispose_redis
from app.core.db import dispose_engines
from app.core.deps import client_ip
from app.core.errors import AppError, app_error_handler, unhandled_error_handler
from app.core.logging import configure_logging, get_logger
from app.core.metadata import load_all_models
from app.settings import Settings, get_settings

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(debug=settings.debug)
    logger.info("startup", environment=settings.environment, region=settings.aws_region)
    yield
    await dispose_engines()
    await dispose_redis()
    await dispose_identity_provider()
    logger.info("shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    # Populate `Base.metadata` explicitly rather than relying on the routers
    # below to drag every models module in behind them. They do, today -- each
    # router reaches its models through service -> repository -- but that is a
    # side effect of unrelated imports, not a guarantee, and the first module
    # whose router does not touch its own models would break foreign-key
    # resolution somewhere else entirely. `app/worker.py` does the same for
    # the same reason; see the note there for how this failed under Celery.
    load_all_models()

    app = FastAPI(
        title=settings.project_name,
        version="0.1.0",
        description=(
            "One shared backend for the candidate, employer, college and admin "
            "surfaces. See docs/plan.md for the invariants this service enforces."
        ),
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # CORS. The three web consoles are served from different hosts than this
    # API, so a browser treats every call as cross-origin and blocks it unless
    # the server says otherwise. The mobile app is unaffected -- CORS is a
    # browser mechanism and native clients ignore it.
    #
    # `allow_credentials=True` with `allow_origins=["*"]` is refused by every
    # browser and is a real vulnerability besides, so origins are always an
    # explicit list, set per environment.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
        # Without this the browser hides these from JavaScript, so clients
        # cannot read the correlation id to quote in a bug report.
        expose_headers=["X-Request-ID"],
        max_age=600,  # cache the preflight, so OPTIONS is not sent every call
    )

    @app.middleware("http")
    async def global_ip_limit(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """The per-IP tier of the global limit, before authentication.

        Before, so an unauthenticated flood is turned away without costing a
        JWKS verification or a database lookup each. Fails open -- see
        `app/core/ratelimit.py` for why the global tier does and the specific
        limits do not. Answered here rather than raised, because an exception
        from middleware does not reach the application's error handlers.
        """
        if get_settings().rate_limit_global_enabled and request.url.path != "/":
            ip = client_ip(request)
            if ip:
                try:
                    await ratelimit.enforce("global.ip", subject=ip)
                except AppError as exc:
                    return await app_error_handler(request, exc)
        return await call_next(request)

    @app.middleware("http")
    async def correlation_id(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/", include_in_schema=False)
    async def root() -> JSONResponse:
        return JSONResponse({"service": settings.project_name, "version": "0.1.0"})

    _document_error_responses(app)
    return app


#: Statuses this API returns that FastAPI never documents, and what each one
#: means here. `422` is left out because FastAPI already adds it.
#:
#: **Found by the fuzzer** (`tests/integration/test_api_fuzz.py`, 2026-09-22).
#: Every one of the 157 operations documented its success code and 422 and
#: nothing else -- so `openapi.json` told the four client teams, who generate
#: their code from it, that this API never returns 401, 403, 404, 409 or 429.
#: It returns all of them constantly; the test suite asserts them by the
#: hundred. A generated client that treats an undocumented status as a
#: transport error retries a 409 or shows a crash for a 403.
COMMON_ERROR_RESPONSES: Final[dict[str, str]] = {
    "401": "No credential, or one this API will not accept.",
    "402": (
        "Payment is required. **A first-class answer from this API, not an "
        "edge case**: the platform is pay-first for all three audiences (R13), "
        "so `subscription_required` guards most of what a candidate or "
        "employer can do, and `access_window_expired` guards the employer's "
        "reveal when their paid period has lapsed (R14). Distinguish them by "
        "`code` -- they need different screens."
    ),
    "403": "Authenticated, and not allowed to do this.",
    "404": (
        "Not found -- **including a row that exists in another tenant**. "
        "A tenant-scoped miss is deliberately a 404 and never a 403, because "
        "a 403 would confirm the row exists."
    ),
    "409": (
        "The request conflicts with the current state, such as a stage "
        "transition that is not allowed."
    ),
    "429": "Rate limited.",
}


def _document_error_responses(app: FastAPI) -> None:
    """Add the error statuses every operation can return to the schema.

    FastAPI documents the success response and 422 and stops, because it only
    knows what a route's signature declares. Everything else here comes from
    exception handlers and dependencies -- `AppError` subclasses raised deep
    in a service -- which the framework cannot see.

    Applied over the whole schema rather than as `responses=` on each route:
    there are 157 of them, a new one would be added without it, and the point
    of this is that the document cannot drift from what the API does.

    **Wrapping `app.openapi` rather than mutating `app.openapi_schema` once**,
    which is the version that did not work. FastAPI 0.141 regenerates the
    schema whenever the route set has changed since it last built one
    (`_openapi_routes_version`), so a schema post-processed before the final
    route was added is silently discarded and the served document is the
    unmodified one. Wrapping the method means the additions survive any route
    registered later, in any order.
    """
    generate = app.openapi

    def with_error_responses() -> dict[str, Any]:
        schema = generate()
        if schema.get("x-bharatpath-errors-documented"):
            return schema
        _add_error_responses(schema)
        schema["x-bharatpath-errors-documented"] = True
        return schema

    app.openapi = with_error_responses  # type: ignore[method-assign]


def _add_error_responses(schema: dict[str, Any]) -> None:
    """The mutation itself, so it can be read and tested on its own."""
    error_schema = {
        "application/problem+json": {"schema": {"$ref": "#/components/schemas/ProblemDetail"}}
    }
    schema.setdefault("components", {}).setdefault("schemas", {})["ProblemDetail"] = {
        "type": "object",
        "title": "ProblemDetail",
        "description": (
            "RFC 9457 problem details, as `app.core.errors.app_error_handler` writes them. "
            "`code` is the stable machine-readable identifier -- match on it, never on `title`, "
            "which is English prose and will be translated."
        ),
        "properties": {
            "type": {"type": "string"},
            "title": {"type": "string"},
            "status": {"type": "integer"},
            "code": {"type": "string"},
            "instance": {"type": "string"},
            "params": {"type": "object"},
            "request_id": {"type": "string"},
        },
        "required": ["type", "title", "status", "code"],
    }
    schema["components"]["schemas"]["FrameworkError"] = {
        "type": "object",
        "title": "FrameworkError",
        "description": (
            "What Starlette answers when a request never reaches a handler -- an "
            "unparseable body. Deliberately distinct from `ProblemDetail`, which every "
            "error the application itself raises uses."
        ),
        "properties": {"detail": {"type": "string"}},
        "required": ["detail"],
    }

    # **400 is a different shape, and that is the API's doing, not a mistake
    # here.** An `AppError` is answered by `app_error_handler` as RFC 9457
    # problem+json. An unparseable body never reaches a handler at all, so
    # Starlette answers it with its own `{"detail": ...}` as plain JSON -- the
    # same shape FastAPI already documents for 422. Writing 400 down as
    # problem+json would be tidier and would be false, and the four client
    # teams parse this document.
    #
    # That the API has two error shapes at all is a real wart, found by the
    # fuzzer. Normalising them is a breaking change for anyone already parsing
    # `detail`, so it is the client's decision (`docs/blockers.md` E42), not
    # something to do quietly here.
    framework_schema = {
        "application/json": {"schema": {"$ref": "#/components/schemas/FrameworkError"}}
    }
    for operations in schema.get("paths", {}).values():
        for operation in operations.values():
            if not isinstance(operation, dict):
                continue
            responses = operation.setdefault("responses", {})
            responses.setdefault(
                "400",
                {
                    "description": (
                        "The request body could not be parsed. Answered by the framework "
                        "before any handler runs, so it carries `detail` rather than the "
                        "problem+json body every other error uses."
                    ),
                    "content": framework_schema,
                },
            )
            for status, description in COMMON_ERROR_RESPONSES.items():
                responses.setdefault(status, {"description": description, "content": error_schema})

            # **422 has both shapes, and FastAPI only documents one.** It adds
            # `HTTPValidationError` for the validation it performs itself, and
            # that is correct as far as it goes -- but an `AppError` may also
            # carry 422 (`invalid_cursor`, `dispute_application_required`),
            # and those come back as problem+json like every other
            # application error. A client told to expect `{"detail": [...]}`
            # and handed a `code` cannot read it.
            validation = responses.get("422")
            if isinstance(validation, dict) and isinstance(validation.get("content"), dict):
                validation["content"].setdefault(
                    "application/problem+json",
                    {"schema": {"$ref": "#/components/schemas/ProblemDetail"}},
                )


app = create_app()
