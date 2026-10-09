"""The admin console is for our staff, and every look is on the record.

Two guarantees, both enumerated from the running application so a console
route added tomorrow is covered without anyone remembering to add it:

1. **No external caller reaches any `/admin` route**, whatever the id. This
   replaces the cross-tenant 404 check for the console
   (`test_cross_tenant_routes.py`): a console route crosses tenants by
   design, so the property that matters is who can call it at all.
2. **Every cross-tenant read writes its audit row first**, and a read whose
   audit row cannot be written returns nothing (SRS 2.24.5, invariant 7').

Plus the permission table itself: every console route is guarded by exactly
the staff roles `admin.domain.CONSOLE_ROLES` names, and nothing wider.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.modules.admin.domain import CONSOLE_ROLES
from app.modules.identity.domain import PLATFORM_ROLES
from tests.integration.test_admin_console import _staff
from tests.integration.test_candidate_marketplace import _candidate, _employer
from tests.integration.test_college import _college

pytestmark = [pytest.mark.invariant, pytest.mark.integration]

API = "/api/v1"
ADMIN = f"{API}/admin"
#: A body that parses for every console write, so a refusal can only be the guard.
BODIES: dict[str, dict[str, Any]] = {
    "decision": {"decision": "APPROVED"},
    "resolve": {"outcome": "RESOLVED", "resolution": "x", "note": None},
    "suspend": {"reason": "Invariant check"},
    "seats": {"seats": 1},
    "notification-suppressions": {"channel": "SMS", "reason": "SUPPORT_REQUEST"},
}


def _console_operations(app: Any) -> list[tuple[str, str]]:
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith(ADMIN)
        for method in operations
    )


def _concrete(path: str) -> str:
    parts = [str(uuid.uuid4()) if p.startswith("{") else p for p in path.split("/")]
    return "/".join(parts)


def _body(path: str) -> dict[str, Any] | None:
    last = path.rstrip("/").rsplit("/", 1)[-1]
    return BODIES.get(last)


def test_the_console_has_routes_to_guard(app: Any) -> None:
    assert len(_console_operations(app)) >= 20


async def test_no_candidate_employer_or_college_reaches_any_console_route(
    app: Any, client: Any, mint_token: Any
) -> None:
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    employer = await _employer(client, mint_token)
    college = await _college(client, mint_token)
    outsiders = {
        "candidate": candidate["headers"],
        "employer owner": employer["headers"],
        "college admin": college["headers"],
    }
    leaks = []
    for method, path in _console_operations(app):
        url = _concrete(path)
        body = _body(path)
        for who, headers in outsiders.items():
            response = await client.request(method, url, json=body, headers=headers)
            if response.status_code != 403:
                leaks.append(f"{who}: {method} {path} -> {response.status_code}")
    assert not leaks, leaks


async def test_each_console_route_admits_exactly_its_staff_roles(
    app: Any, client: Any, mint_token: Any
) -> None:
    """Driven, not read from the dependency tree: every staff role is sent to
    every route, and a role outside the route's capability must get 403. A
    role inside it may get anything but 403 -- 404 for the made-up id is the
    ordinary answer."""
    staff = {role: await _staff(mint_token, role) for role in sorted(PLATFORM_ROLES)}
    mismatches = []
    for method, path in _console_operations(app):
        url, body = _concrete(path), _body(path)
        allowed = _capability_roles(app, method, path)
        for role, member in staff.items():
            response = await client.request(method, url, json=body, headers=member["headers"])
            refused = response.status_code == 403
            if refused == (role in allowed):
                mismatches.append(f"{role}: {method} {path} -> {response.status_code}")
    assert not mismatches, mismatches


def _endpoint(app: Any, method: str, path: str) -> str:
    """The endpoint function's name, from FastAPI's generated operation id
    (`<name>_<path>_<method>`). Read from the schema because included routers
    are nested in `app.routes` and do not list their endpoints there."""
    operation_id = app.openapi()["paths"][path][method.lower()]["operationId"]
    return str(operation_id.split("_api_v1_admin")[0])


def _capability_roles(app: Any, method: str, path: str) -> frozenset[str]:
    """The roles a route should admit, looked up by its endpoint name in
    `ROUTE_CAPABILITY` -- written out here rather than read from the router,
    so a guard edited in the router without the table disagrees with it."""
    return CONSOLE_ROLES[ROUTE_CAPABILITY[_endpoint(app, method, path)]]


ROUTE_CAPABILITY: dict[str, Any] = {
    "list_kyb_submissions": "kyb",
    "open_kyb_submission": "kyb",
    "decide_kyb": "kyb",
    "integrity_queue": "integrity",
    "open_signal": "integrity",
    "resolve_signal": "integrity",
    "list_tenants": "tenants",
    "suspend_tenant": "suspend",
    "reinstate_tenant": "suspend",
    "suspension_history": "tenants",
    "allocate_seats": "seats",
    "candidate_drilldown": "candidate_drilldown",
    # 2026-09-23: whoever may open a candidate may find one.
    "list_candidates": "candidate_drilldown",
    "employer_drilldown": "employer_drilldown",
    "college_drilldown": "college_drilldown",
    "suppress_notifications": "suppress_notifications",
    "dispute_queue": "disputes",
    "open_dispute": "disputes",
    "assign_dispute": "disputes",
    "resolve_dispute": "disputes",
    "search_audit": "audit_search",
    # 2026-09-18: accounts made on someone's behalf, and discount codes.
    "account_forms": "accounts",
    "provision_candidate": "accounts",
    "provision_employer": "accounts",
    "provision_college": "accounts",
    "add_organisation_member": "accounts",
    "resend_invitation": "resend_invitation",
    "create_discount_code": "discounts",
    "disable_discount_code": "discounts",
    "list_discount_codes": "discounts_read",
    "get_discount_code": "discounts_read",
    "discount_redemptions": "discounts_read",
    # 2026-09-23: the landing page, for all staff; its sections are gated inside.
    "dashboard": "dashboard",
    # 2026-09-24: the skills and cities employers filter by; support edits too.
    "list_search_filter_options": "search_filters",
    "create_search_filter_option": "search_filters",
    "import_search_filter_options": "search_filters",
    "get_search_filter_option": "search_filters",
    "update_search_filter_option": "search_filters",
    # 2026-09-29: the full candidate page. The CV and the recordings are
    # larger reveals than the drill-down, each with its own capability; the
    # onboarding page is the one with a whole contact.
    "candidate_onboarding": "candidate_contact",
    "candidate_resume": "candidate_resume",
    "candidate_score_timeline": "candidate_drilldown",
    "candidate_interviews": "candidate_drilldown",
    "candidate_interview_recordings": "candidate_recordings",
    "candidate_courses": "candidate_drilldown",
    "candidate_applications": "candidate_drilldown",
    # 2026-09-29: building the course, the admin's alone.
    "list_courses": "courses",
    "create_course_module": "courses",
    "update_course_module": "courses",
    "create_course_lesson": "courses",
    "update_course_lesson": "courses",
    "issue_lesson_upload": "courses",
    "confirm_lesson_upload": "courses",
    "publish_course": "courses",
}


def test_every_console_endpoint_names_its_capability(app: Any) -> None:
    endpoints = {_endpoint(app, method, path) for method, path in _console_operations(app)}
    assert endpoints == set(ROUTE_CAPABILITY)


async def test_no_audit_row_means_no_reveal(client: Any, mint_token: Any, monkeypatch: Any) -> None:
    """Every cross-tenant read goes through `_reveal`, which audits before it
    opens the bypass session. If the audit write fails, nothing is read."""
    from app.core.db import get_session_factory
    from app.core.tenant import TenantContext
    from app.modules.admin import service as admin_service

    admin = await _staff(mint_token)
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    employer = await _employer(client, mint_token)
    ctx = TenantContext(
        user_id=admin["user_id"],
        tenant_id=admin["tenant_id"],
        role="PLATFORM_ADMIN",
        pool="BUSINESS",
    )
    opened: list[str] = []

    async def failing_audit(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("audit store unavailable")

    real_factory = admin_service.get_admin_session_factory

    def watched_factory() -> Any:
        opened.append("bypass")
        return real_factory()

    monkeypatch.setattr(admin_service, "audit_event", failing_audit)
    monkeypatch.setattr(admin_service, "get_admin_session_factory", watched_factory)
    tenant_id = uuid.UUID(employer["tenant_id"])
    for call in (
        lambda s: admin_service.candidate_drilldown(s, ctx=ctx, user_id=candidate["id"]),
        lambda s: admin_service.list_candidates(
            s, ctx=ctx, status=None, name_contains=None, email=None, cursor=None, limit=None
        ),
        lambda s: admin_service.employer_drilldown(s, ctx=ctx, tenant_id=tenant_id),
        lambda s: admin_service.college_drilldown(s, ctx=ctx, tenant_id=tenant_id),
        lambda s: admin_service.integrity_queue(
            s, ctx=ctx, state="OPEN", severity=None, cursor=None, limit=None
        ),
        lambda s: admin_service.dashboard(s, ctx=ctx),
        lambda s: admin_service.search_audit(
            s,
            ctx=ctx,
            actor_id=None,
            action=None,
            target_type=None,
            target_id=None,
            tenant_id=None,
            occurred_from=None,
            occurred_to=None,
            cursor=None,
            limit=None,
        ),
    ):
        with pytest.raises(RuntimeError, match="audit store unavailable"):
            async with get_session_factory()() as session, session.begin():
                await call(session)
    assert opened == [], "a bypass session was opened before its audit row existed"
