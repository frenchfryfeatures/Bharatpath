"""identity - data access

Users, sessions, Cognito linkage, memberships.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import literal, select, text, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import Membership, Tenant, TenantSuspension, User


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()


async def upsert_membership(
    session: AsyncSession, *, user_id: uuid.UUID, tenant_id: uuid.UUID, role: str
) -> None:
    """Grant a role, or restore and re-role a revoked membership.

    An upsert rather than an insert because `uq_membership_user_tenant` allows
    exactly one row per user per tenant -- deliberately, so that "what role is
    this caller?" has one answer and does not depend on row order. Re-inviting
    someone who was previously removed therefore has to update the existing
    row, and an INSERT would simply fail.
    """
    await session.execute(
        pg_insert(Membership)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            tenant_id=tenant_id,
            role=role,
            status="ACTIVE",
        )
        .on_conflict_do_update(
            constraint="uq_membership_user_tenant",
            set_={"role": role, "status": "ACTIVE"},
        )
    )


async def revoke_membership(
    session: AsyncSession, *, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> None:
    """Mark a membership revoked. Never delete it.

    The row is the evidence that this person had this access during this
    period, which is exactly what an audit asks for after the fact. Deleting
    it would answer "who could see this in March?" with silence.
    """
    await session.execute(
        update(Membership)
        .where(Membership.user_id == user_id, Membership.tenant_id == tenant_id)
        .values(status="REVOKED")
    )


async def lock_user(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """Serialise membership changes for one person, for this transaction.

    **Without it one account can end up in two organisations.** Two concurrent
    requests -- a double-clicked "create organisation", or two owners adding
    the same colleague at once -- would both read "no membership yet" and both
    write one. `membership.resolve` then has two rows to choose between, and
    which tenant the person acts for would depend on row order.

    An advisory lock rather than a row lock because the row being guarded
    against does not exist yet. Released automatically at commit or rollback.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"membership:{user_id}"},
    )


async def active_membership(session: AsyncSession, *, user_id: uuid.UUID) -> Membership | None:
    """Any ACTIVE membership, **whatever the state of its tenant**.

    Deliberately not `app.core.auth.membership.resolve`, which hides a
    membership whose tenant is suspended -- correctly, for authorisation. Used
    for "does this person already belong somewhere?" that would be a
    suspension bypass: the owner of a suspended employer would look
    unaffiliated, create a fresh organisation, and carry on.
    """
    result = await session.execute(
        select(Membership)
        .where(Membership.user_id == user_id, Membership.status == "ACTIVE")
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_membership(
    session: AsyncSession, *, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> Membership | None:
    """Scoped to the tenant, always. A user id from a path parameter is looked
    up *within the caller's tenant*, so another organisation's member reads as
    absent -- a 404, never a 403."""
    result = await session.execute(
        select(Membership).where(Membership.user_id == user_id, Membership.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def list_active_members(
    session: AsyncSession, *, tenant_id: uuid.UUID
) -> list[tuple[Membership, User]]:
    result = await session.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.tenant_id == tenant_id, Membership.status == "ACTIVE")
        .order_by(Membership.created_at, Membership.id)
    )
    return [(membership, user) for membership, user in result.all()]


async def lock_active_holders_of_role(
    session: AsyncSession, *, tenant_id: uuid.UUID, role: str
) -> list[uuid.UUID]:
    """The users holding `role` in a tenant, with their rows locked.

    `FOR UPDATE` is what makes the last-owner rule hold under concurrency. Two
    owners of a two-owner organisation each demoting the other at the same
    moment would otherwise each see one other owner, both succeed, and leave
    an organisation nobody can administer.
    """
    result = await session.execute(
        select(Membership.user_id)
        .where(
            Membership.tenant_id == tenant_id,
            Membership.role == role,
            Membership.status == "ACTIVE",
        )
        .with_for_update()
    )
    return list(result.scalars().all())


async def create_tenant(session: AsyncSession, *, tenant_type: str, name: str) -> uuid.UUID:
    tenant = Tenant(id=uuid.uuid4(), type=tenant_type, name=name, status="ACTIVE")
    session.add(tenant)
    await session.flush()
    return tenant.id


async def tenant_ids_of_type(session: AsyncSession, *, tenant_type: str) -> list[uuid.UUID]:
    result = await session.execute(
        select(Tenant.id).where(Tenant.type == tenant_type).order_by(Tenant.id)
    )
    return list(result.scalars().all())


async def rename_tenant(session: AsyncSession, *, tenant_id: uuid.UUID, name: str) -> None:
    await session.execute(update(Tenant).where(Tenant.id == tenant_id).values(name=name))


async def user_by_email(session: AsyncSession, *, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_business_user(session: AsyncSession, *, email: str) -> User:
    """A business account row with no provider subject yet.

    **This is the invitation.** The row carries the email and no `cognito_sub`;
    when that person first signs in, `app.core.auth.users._adopt_unlinked`
    links their verified identity to this row by email, and the membership
    granted here is already waiting for them.

    `ON CONFLICT DO NOTHING` then a read, because two owners inviting the same
    new address at once is ordinary and must not surface as a 500.
    """
    await session.execute(
        pg_insert(User)
        .values(id=uuid.uuid4(), pool="BUSINESS", email=email, status="ACTIVE", locale="en")
        .on_conflict_do_nothing(index_elements=["email"])
    )
    user = await user_by_email(session, email=email)
    if user is None:  # pragma: no cover - only on a genuine constraint failure
        raise RuntimeError("could not create or read the invited business user")
    return user


async def create_candidate_user(session: AsyncSession, *, email: str) -> User:
    """A candidate row with no provider subject yet (2026-09-18): made by
    staff, claimed on the person's first sign-in in the candidate pool.
    Returns whatever row holds the address afterwards; the caller checks it
    is the one it asked for."""
    await session.execute(
        pg_insert(User)
        .values(id=uuid.uuid4(), pool="CANDIDATE", email=email, status="ACTIVE", locale="en")
        .on_conflict_do_nothing(index_elements=["email"])
    )
    user = await user_by_email(session, email=email)
    if user is None:  # pragma: no cover - only on a genuine constraint failure
        raise RuntimeError("could not create or read the provisioned candidate")
    return user


# ---------------------------------------------------------------------------
# Platform staff, suspension, contacts
# ---------------------------------------------------------------------------
async def get_tenant(session: AsyncSession, *, tenant_id: uuid.UUID) -> Tenant | None:
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one_or_none()


async def platform_tenant(session: AsyncSession) -> Tenant | None:
    result = await session.execute(select(Tenant).where(Tenant.type == "PLATFORM"))
    return result.scalar_one_or_none()


async def create_platform_tenant(session: AsyncSession) -> uuid.UUID:
    """Insert-if-absent against `uq_tenants_one_platform`, then a read: two
    provisioning runs at once must still end with one tenant."""
    await session.execute(
        pg_insert(Tenant)
        .values(id=uuid.uuid4(), type="PLATFORM", name="BharatPath", status="ACTIVE")
        .on_conflict_do_nothing()
    )
    tenant = await platform_tenant(session)
    if tenant is None:  # pragma: no cover - only on a genuine constraint failure
        raise RuntimeError("could not create or read the platform tenant")
    return tenant.id


async def list_tenants(
    session: AsyncSession,
    *,
    tenant_type: str | None,
    status: str | None,
    name_contains: str | None,
    after: tuple[str, uuid.UUID] | None,
    limit: int,
) -> list[Tenant]:
    """Keyset by (name, id). The PLATFORM tenant is never listed: it is not a
    customer, and it cannot be suspended."""
    stmt = select(Tenant).where(Tenant.type != "PLATFORM")
    if tenant_type is not None:
        stmt = stmt.where(Tenant.type == tenant_type)
    if status is not None:
        stmt = stmt.where(Tenant.status == status)
    if name_contains:
        escaped = name_contains.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(Tenant.name.ilike(f"%{escaped}%", escape="\\"))
    if after is not None:
        stmt = stmt.where(
            tuple_(Tenant.name, Tenant.id) > tuple_(literal(after[0]), literal(after[1]))
        )
    stmt = stmt.order_by(Tenant.name, Tenant.id).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def active_member_ids(
    session: AsyncSession, *, tenant_id: uuid.UUID, roles: frozenset[str] | None = None
) -> list[uuid.UUID]:
    stmt = select(Membership.user_id).where(
        Membership.tenant_id == tenant_id, Membership.status == "ACTIVE"
    )
    if roles is not None:
        stmt = stmt.where(Membership.role.in_(sorted(roles)))
    return list((await session.execute(stmt.order_by(Membership.user_id))).scalars().all())


async def member_role_counts(session: AsyncSession, *, tenant_id: uuid.UUID) -> dict[str, int]:
    result = await session.execute(
        text(
            "SELECT role, count(*) FROM memberships "
            "WHERE tenant_id = :t AND status = 'ACTIVE' GROUP BY role"
        ),
        {"t": str(tenant_id)},
    )
    return {role: int(n) for role, n in result.all()}


async def insert_suspension(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    reason: str,
    suspended_by: uuid.UUID,
    now: datetime,
) -> TenantSuspension | None:
    """None when an open suspension already exists (`uq_tenant_suspension_open`):
    two admins pressing the button at once is one suspension, not a 500."""
    row_id = await session.scalar(
        pg_insert(TenantSuspension)
        .values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            reason=reason,
            suspended_by=suspended_by,
            suspended_at=now,
        )
        .on_conflict_do_nothing(index_elements=["tenant_id"], index_where=text("lifted_at IS NULL"))
        .returning(TenantSuspension.id)
    )
    if row_id is None:
        return None
    result = await session.execute(select(TenantSuspension).where(TenantSuspension.id == row_id))
    return result.scalar_one()


async def lift_suspension(
    session: AsyncSession, *, tenant_id: uuid.UUID, lifted_by: uuid.UUID, now: datetime
) -> TenantSuspension | None:
    """The latch: only an open row is lifted, so a second lift finds nothing."""
    row_id = await session.scalar(
        update(TenantSuspension)
        .where(TenantSuspension.tenant_id == tenant_id, TenantSuspension.lifted_at.is_(None))
        .values(lifted_at=now, lifted_by=lifted_by)
        .returning(TenantSuspension.id)
    )
    if row_id is None:
        return None
    result = await session.execute(
        select(TenantSuspension)
        .where(TenantSuspension.id == row_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def suspensions_for(session: AsyncSession, *, tenant_id: uuid.UUID) -> list[TenantSuspension]:
    result = await session.execute(
        select(TenantSuspension)
        .where(TenantSuspension.tenant_id == tenant_id)
        .order_by(TenantSuspension.suspended_at.desc(), TenantSuspension.id)
    )
    return list(result.scalars().all())


async def users_by_ids(session: AsyncSession, *, user_ids: list[uuid.UUID]) -> list[User]:
    if not user_ids:
        return []
    result = await session.execute(select(User).where(User.id.in_(user_ids)))
    return list(result.scalars().all())


async def set_locale(session: AsyncSession, *, user_id: uuid.UUID, locale: str) -> None:
    await session.execute(update(User).where(User.id == user_id).values(locale=locale))


async def candidates_signed_up_before(
    session: AsyncSession, *, before: datetime, after_id: uuid.UUID | None, limit: int
) -> list[uuid.UUID]:
    """ACTIVE candidate accounts created no later than `before`, keyset by id."""
    stmt = select(User.id).where(
        User.pool == "CANDIDATE", User.status == "ACTIVE", User.created_at <= before
    )
    if after_id is not None:
        stmt = stmt.where(User.id > after_id)
    return list((await session.execute(stmt.order_by(User.id).limit(limit))).scalars().all())
