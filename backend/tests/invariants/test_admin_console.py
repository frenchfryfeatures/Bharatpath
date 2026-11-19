"""The admin console is for our staff, and every look is on the record.

Two guarantees, both enumerated from the running application so a console
route added tomorrow is covered without anyone remembering to add it:

1. **No external caller reaches any `/admin` route**, whatever the id. This
   replaces the cross-tenant 404 check for the console
   (`test_cross_tenant_routes.py`): a console route crosses tenants by
   design, so the property that matters is who can call it at all.
2. **Every cross-tenant read writes its audit row first**, and a read whose
   audit row cannot be written returns nothing (SRS 2.24.5, invariant 7').

Plus the permission table itself (2026-11-19, replacing `CONSOLE_ROLES`):
every console route -- Access Management included -- requires exactly the
permissions `ROUTE_PERMISSION` names, which is written out here rather than
read from the router; every system role is driven at every route; every
permission in the catalogue is enforced by some route; and a permission is
`scopable` exactly when a route addressed by an organisation uses it.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.core.staff_permissions import BY_KEY, PERMISSION_KEYS, SYSTEM_ROLES
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
    # Access management (2026-11-19). Each names a made-up id, so an admitted
    # caller gets 404 and nothing is written.
    "impact": {"name": "Invariant", "permissions": ["dashboard.view"]},
    "duplicate": {"name": "Invariant copy"},
    "staff": {
        "email": "nobody-invariant@example.test",
        "roles": [{"role_id": "00000000-0000-0000-0000-000000000000"}],
    },
    "roles": {"role_id": "00000000-0000-0000-0000-000000000000"},
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
    app: Any, client: Any, mint_token: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Driven, not read from the dependency tree: every system role is sent to
    every route, and a role that does not hold all of the route's permissions
    must get 403. A role that does may get anything but 403 -- 404 for the
    made-up id is the ordinary answer."""
    # Lists carry presigned logo links, and the shared database holds logos
    # other tests left behind; CI has no AWS credentials to sign them with.
    # Who may call a route is the question here, not S3.
    from app.core import storage

    async def presign_get(*, bucket: str, key: str, expires_in: int) -> str:
        return f"https://signed.example/{bucket}/{key}"

    monkeypatch.setattr(storage, "presign_get", presign_get)
    staff = {key: await _staff(mint_token, key) for key in sorted(SYSTEM_ROLES)}
    mismatches = []
    for method, path in _console_operations(app):
        if path == f"{ADMIN}/access/roles" and method == "POST":
            continue  # would create a role per admitted caller; driven below
        url, body = _concrete(path), _body(path)
        needed = ROUTE_PERMISSION[_endpoint(app, method, path)]
        for key, member in staff.items():
            allowed = needed <= SYSTEM_ROLES[key].permissions
            response = await client.request(method, url, json=body, headers=member["headers"])
            refused = response.status_code == 403
            if refused == allowed:
                mismatches.append(f"{key}: {method} {path} -> {response.status_code}")
    assert not mismatches, mismatches


async def test_creating_a_role_is_super_admins_alone(client: Any, mint_token: Any) -> None:
    for key in sorted(SYSTEM_ROLES):
        member = await _staff(mint_token, key)
        body = {"name": f"Invariant {uuid.uuid4().hex[:8]}", "permissions": ["dashboard.view"]}
        response = await client.post(f"{ADMIN}/access/roles", json=body, headers=member["headers"])
        assert (response.status_code == 403) == (key != "SUPER_ADMIN"), (key, response.text)


def _endpoint(app: Any, method: str, path: str) -> str:
    """The endpoint function's name, from FastAPI's generated operation id
    (`<name>_<path>_<method>`)."""
    operation_id = app.openapi()["paths"][path][method.lower()]["operationId"]
    return str(operation_id.split("_api_v1_admin")[0])


def _all_routes(routes: Any) -> list[Any]:
    """Every endpoint route. FastAPI 0.141 keeps an included router nested
    (`original_router`) rather than copying its routes onto the app. Only a
    console route declares `require_permission`, so the walk needs no path."""
    out: list[Any] = []
    for route in routes:
        nested = getattr(route, "original_router", None)
        out.extend(_all_routes(nested.routes) if nested is not None else [route])
    return out


def _declared(app: Any) -> dict[str, tuple[tuple[str, ...], str | None]]:
    """What each console route's guard actually declares: its permissions and
    the path parameter naming the organisation it acts on."""
    out: dict[str, tuple[tuple[str, ...], str | None]] = {}
    for route in _all_routes(app.routes):
        for dep in getattr(route, "dependencies", []):
            needed = getattr(dep.dependency, "permissions", None)
            if needed is not None:
                out[route.name] = (needed, dep.dependency.tenant_param)
    return out


#: endpoint -> the permissions it requires, all of them. The empty set is
#: "any member of staff" (the caller's own access).
ROUTE_PERMISSION: dict[str, frozenset[str]] = {
    endpoint: frozenset(needed)
    for endpoint, needed in {
        "dashboard": {"dashboard.view"},
        "list_kyb_submissions": {"kyb.view"},
        "open_kyb_submission": {"kyb.view"},
        "decide_kyb": {"employers.approve_kyb"},
        # Reviewers can see the switch; only a super admin flips it.
        "kyb_approval_mode": {"kyb.view"},
        "set_kyb_approval_mode": {"kyb.configure"},
        "integrity_queue": {"integrity.view"},
        "open_signal": {"integrity.view"},
        "resolve_signal": {"integrity.resolve"},
        "list_tenants": {"organisations.view"},
        "suspension_history": {"organisations.view"},
        "suspend_tenant": {"organisations.suspend"},
        "reinstate_tenant": {"organisations.suspend"},
        "allocate_seats": {"institutes.manage_seats"},
        "list_candidates": {"candidates.view"},
        "candidate_drilldown": {"candidates.view"},
        "candidate_score_timeline": {"candidates.view"},
        "candidate_interviews": {"candidates.view"},
        "candidate_courses": {"candidates.view"},
        "candidate_applications": {"candidates.view"},
        # The sales follow-up list carries whole contacts: both, always.
        "list_leads": {"candidates.leads", "candidate_contact.view"},
        "lead_summary": {"candidates.leads", "candidate_contact.view"},
        "candidate_onboarding": {"candidate_contact.view"},
        "candidate_resume": {"resume.download"},
        "candidate_interview_recordings": {"recordings.listen"},
        "employer_drilldown": {"employers.view"},
        "college_drilldown": {"institutes.view"},
        "suppress_notifications": {"notifications.suppress"},
        "dispute_queue": {"disputes.view"},
        "open_dispute": {"disputes.view"},
        "assign_dispute": {"disputes.resolve"},
        "resolve_dispute": {"disputes.resolve"},
        "search_audit": {"audit.view"},
        "account_forms": {"accounts.create"},
        "provision_candidate": {"accounts.create"},
        "provision_employer": {"accounts.create"},
        "provision_college": {"accounts.create"},
        "add_organisation_member": {"accounts.create"},
        "resend_invitation": {"accounts.resend_invitation"},
        "create_discount_code": {"discounts.manage"},
        "disable_discount_code": {"discounts.manage"},
        "list_discount_codes": {"discounts.view"},
        "get_discount_code": {"discounts.view"},
        "discount_redemptions": {"discounts.view"},
        "list_search_filter_options": {"taxonomy.view"},
        "get_search_filter_option": {"taxonomy.view"},
        "create_search_filter_option": {"taxonomy.create"},
        "import_search_filter_options": {"taxonomy.import"},
        "update_search_filter_option": {"taxonomy.edit"},
        "list_courses": {"courses.view"},
        "create_course_module": {"courses.manage"},
        "update_course_module": {"courses.manage"},
        "create_course_lesson": {"courses.manage"},
        "update_course_lesson": {"courses.manage"},
        "issue_lesson_upload": {"courses.manage"},
        "confirm_lesson_upload": {"courses.manage"},
        "publish_course": {"courses.publish"},
        # Access management (2026-11-19).
        "my_access": set(),
        "list_permissions": {"admins.view"},
        "list_roles": {"admins.view"},
        "get_role": {"admins.view"},
        "role_impact": {"admins.view"},
        "create_role": {"roles.manage"},
        "update_role": {"roles.manage"},
        "duplicate_role": {"roles.manage"},
        "archive_role": {"roles.manage"},
        "list_staff": {"admins.view"},
        "get_staff": {"admins.view"},
        "invite_staff": {"admins.invite"},
        "assign_role": {"admins.manage"},
        "revoke_role": {"admins.manage"},
        "suspend_staff": {"admins.manage"},
        "reinstate_staff": {"admins.manage"},
        "access_history": {"audit.view"},
    }.items()
}


def test_every_console_endpoint_names_its_permission(app: Any) -> None:
    endpoints = [_endpoint(app, method, path) for method, path in _console_operations(app)]
    assert len(endpoints) == len(set(endpoints)), "two console endpoints share a name"
    assert set(endpoints) == set(ROUTE_PERMISSION)


def test_the_router_declares_what_the_table_says(app: Any) -> None:
    declared = _declared(app)
    for endpoint, needed in ROUTE_PERMISSION.items():
        if not needed:
            assert endpoint not in declared, endpoint
        else:
            assert frozenset(declared[endpoint][0]) == needed, endpoint


def test_every_permission_is_enforced_somewhere() -> None:
    """A permission no route checks would be a checkbox in the role editor
    that does nothing."""
    used: set[str] = set().union(*ROUTE_PERMISSION.values())
    assert used == PERMISSION_KEYS, sorted(PERMISSION_KEYS ^ used)


def test_scopable_means_a_route_names_the_organisation(app: Any) -> None:
    scoped = {
        permission
        for needed, param in _declared(app).values()
        if param is not None
        for permission in needed
    }
    assert scoped == {key for key, spec in BY_KEY.items() if spec.scopable}


async def test_no_audit_row_means_no_reveal(client: Any, mint_token: Any, monkeypatch: Any) -> None:
    """Every cross-tenant read goes through `_reveal`, which audits before it
    opens the bypass session. If the audit write fails, nothing is read."""
    from datetime import UTC, datetime

    from app.core.db import get_session_factory
    from app.core.staff_permissions import Grant, StaffAccess
    from app.core.tenant import TenantContext
    from app.modules.admin import service as admin_service

    admin = await _staff(mint_token)
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    employer = await _employer(client, mint_token)
    ctx = TenantContext(
        user_id=admin["user_id"],
        tenant_id=admin["tenant_id"],
        role="PLATFORM_STAFF",
        pool="BUSINESS",
        staff=StaffAccess.from_grants(
            [Grant("SUPER_ADMIN", "Super Admin", SYSTEM_ROLES["SUPER_ADMIN"].permissions)],
            now=datetime.now(UTC),
        ),
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
            s, ctx=ctx, status=None, query=None, cursor=None, limit=None
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
