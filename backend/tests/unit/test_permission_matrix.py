"""Role x guard permission matrix, across every role in SRS 1.2.

These call the dependency callables directly with a constructed
`TenantContext`, so the matrix is exhaustive and needs no database: N roles
against N guards is N^2 assertions, and at ten roles that is a hundred round
trips nobody would wait for.

What this cannot see is whether a *route* actually declares the guard --
`test_route_authorisation.py` covers that half.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.deps import (
    ALL_ROLES,
    CANDIDATE,
    EMPLOYER_OWNER,
    require_role,
    require_tenant,
)
from app.core.errors import PermissionDeniedError
from app.core.tenant import TenantContext

ROLES = sorted(ALL_ROLES)


def _ctx(role: str, *, tenant: bool | None = None) -> TenantContext:
    """A caller holding `role`.

    Tenancy defaults to the shape the role really has: candidates belong to no
    tenant, everyone else does. `current_user` enforces that pairing, so a
    matrix built on any other pairing would be testing a caller that cannot
    exist.
    """
    scoped = (role != CANDIDATE) if tenant is None else tenant
    return TenantContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4() if scoped else None,
        role=role,
        pool="CANDIDATE" if role == CANDIDATE else "BUSINESS",
    )


def test_the_matrix_covers_every_role() -> None:
    """Guards the matrix itself.

    A role added to `ALL_ROLES` without a thought for authorisation would
    otherwise slip in silently -- every test below iterates ALL_ROLES, so it
    would be *covered* but never *considered*. Ten is the count in SRS 1.2.
    """
    assert len(ROLES) == 10, f"role list changed: {ROLES}"


@pytest.mark.parametrize("granted", ROLES)
async def test_require_role_admits_only_the_granted_role(granted: str) -> None:
    dep = require_role(granted)

    assert (await dep(_ctx(granted))).role == granted

    for other in ROLES:
        if other == granted:
            continue
        with pytest.raises(PermissionDeniedError):
            await dep(_ctx(other))


@pytest.mark.parametrize("role", ROLES)
async def test_a_multi_role_guard_admits_each_member(role: str) -> None:
    """`require_role(A, B)` is a union, not an intersection."""
    dep = require_role(CANDIDATE, EMPLOYER_OWNER)
    if role in (CANDIDATE, EMPLOYER_OWNER):
        assert (await dep(_ctx(role))).role == role
    else:
        with pytest.raises(PermissionDeniedError):
            await dep(_ctx(role))


@pytest.mark.parametrize("role", ROLES)
async def test_require_tenant_rejects_a_caller_without_one(role: str) -> None:
    """Tenancy, not role, is what this guard is about.

    A candidate has no tenant and must be refused; so must any business role
    whose tenant is somehow unset, which is why this forces `tenant=False`
    rather than trusting the role to imply it.
    """
    dep = require_tenant()

    with pytest.raises(PermissionDeniedError):
        await dep(_ctx(role, tenant=False))

    assert (await dep(_ctx(role, tenant=True))).tenant_id is not None


def test_an_unknown_role_is_refused_at_import_time() -> None:
    """A typo in `require_role("EMPLOYER_ADMIN")` must not become an endpoint
    that silently admits nobody. `require_role` is called at module import, so
    this fails the build rather than a request."""
    with pytest.raises(ValueError, match="unknown role"):
        require_role("EMPLOYER_ADMIN")  # plausible, and not a real role

    with pytest.raises(ValueError, match="unknown role"):
        require_role(CANDIDATE, "TYPO")
