"""Staff roles and permissions: configurable access to the admin console (2026-11-19).

Replaces the four hardcoded staff roles (`memberships.role` PLATFORM_ADMIN,
KYB_REVIEWER, INTEGRITY_REVIEWER, SUPPORT_AGENT, read through the
`CONSOLE_ROLES` map) with roles held in the database:

* `staff_roles` -- system roles (code-defined permissions,
  `app.core.staff_permissions.SYSTEM_ROLES`) and custom roles.
* `staff_role_permissions` -- a custom role's permissions. Its CHECK is
  generated from `GRANTABLE`: a SUPER_ADMIN-only key, or one no route enforces,
  cannot be stored.
* `staff_role_assignments` -- who holds which role, optionally limited to
  organisations or until a time; revoked, never deleted.

**Nobody's access changes.** Every staff membership becomes `PLATFORM_STAFF`
and gains an assignment of the system role of the same name -- PLATFORM_ADMIN
becoming SUPER_ADMIN -- whose permissions are exactly what `CONSOLE_ROLES`
gave that role. Revoked memberships keep their assignment, so a reinstated
person comes back with what they had.

**Guards, for every writer** (the migrator included):

* `guard_staff_role_write` -- a key and `is_system` never change; a system
  role is never archived; a custom key starts `CUSTOM_`; archiving is a latch.
* `guard_staff_role_permission_write` -- no rows for a system role or an
  archived one.
* `guard_staff_assignment_write` -- inserted live, to someone holding a
  PLATFORM membership, of an ACTIVE role; SUPER_ADMIN never scoped or
  expiring; afterwards only the revocation may be written, once; and **the
  last live SUPER_ADMIN of a person with an ACTIVE membership is never
  revoked**.
* `guard_last_super_admin_membership` -- nor is that person's membership
  revoked or deleted.

Both last-super-admin checks take the `staff_access` advisory lock the
service takes, so two super admins removing each other at once cannot both
succeed.

The baseline builds the tables from the current models, so on a database built
from it they exist already and are created here only when missing.

Revision ID: 0022_staff_access
Revises: 0021_resume_sync
Create Date: 2026-11-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022_staff_access"
down_revision = "0021_resume_sync"
branch_labels = None
depends_on = None

APP_ROLE = "bharatpath_app"
LEGACY_ROLES = ("PLATFORM_ADMIN", "KYB_REVIEWER", "INTEGRITY_REVIEWER", "SUPPORT_AGENT")
_LOCK = "PERFORM pg_advisory_xact_lock(hashtext('staff_access'));"


def _quoted(values: object) -> str:
    return ", ".join(f"'{v}'" for v in sorted(values))  # type: ignore[call-overload]


def upgrade() -> None:
    _create_tables()
    _seed_system_roles()
    _move_staff_memberships()
    _create_guards()
    op.execute(f"REVOKE DELETE ON staff_roles FROM {APP_ROLE}")
    op.execute(f"REVOKE DELETE ON staff_role_assignments FROM {APP_ROLE}")


def downgrade() -> None:
    """Back to one role per membership: each person's first system role in
    the old four (SUPER_ADMIN as PLATFORM_ADMIN), else the membership is
    revoked -- a custom role has no old equivalent, and access nobody granted
    is worse than none."""
    for name, table in (
        ("trg_guard_last_super_admin_membership", "memberships"),
        ("trg_guard_staff_assignment_write", "staff_role_assignments"),
        ("trg_guard_staff_role_permission_write", "staff_role_permissions"),
        ("trg_guard_staff_role_write", "staff_roles"),
    ):
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
    for fn in (
        "guard_last_super_admin_membership",
        "guard_staff_assignment_write",
        "guard_staff_role_permission_write",
        "guard_staff_role_write",
    ):
        op.execute(f"DROP FUNCTION IF EXISTS {fn}()")
    op.execute("ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_role")
    _membership_guard(("PLATFORM_STAFF", *LEGACY_ROLES))
    op.execute(
        """
        UPDATE memberships m
           SET role = coalesce((
                 SELECT CASE r.key WHEN 'SUPER_ADMIN' THEN 'PLATFORM_ADMIN' ELSE r.key END
                   FROM staff_role_assignments a JOIN staff_roles r ON r.id = a.role_id
                  WHERE a.user_id = m.user_id AND a.revoked_at IS NULL
                    AND r.key IN ('SUPER_ADMIN', 'KYB_REVIEWER', 'INTEGRITY_REVIEWER',
                                  'SUPPORT_AGENT')
                  ORDER BY (r.key = 'SUPER_ADMIN') DESC, r.key
                  LIMIT 1), 'SUPPORT_AGENT'),
               status = CASE WHEN EXISTS (
                   SELECT 1 FROM staff_role_assignments a JOIN staff_roles r ON r.id = a.role_id
                    WHERE a.user_id = m.user_id AND a.revoked_at IS NULL
                      AND r.key IN ('SUPER_ADMIN', 'KYB_REVIEWER', 'INTEGRITY_REVIEWER',
                                    'SUPPORT_AGENT'))
                 THEN m.status ELSE 'REVOKED' END
         WHERE m.role = 'PLATFORM_STAFF'
        """
    )
    _membership_guard(LEGACY_ROLES)
    from app.modules.identity.models import ROLES

    old_roles = tuple(r for r in ROLES if r != "PLATFORM_STAFF") + LEGACY_ROLES
    op.execute(
        f"ALTER TABLE memberships ADD CONSTRAINT ck_memberships_role "
        f"CHECK (role IN ({_quoted(old_roles)}))"
    )
    op.drop_table("staff_role_assignments", if_exists=True)
    op.drop_table("staff_role_permissions", if_exists=True)
    op.drop_table("staff_roles", if_exists=True)


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------
def _create_tables() -> None:
    from app.core.staff_permissions import GRANTABLE

    inspector = sa.inspect(op.get_bind())
    uuid = postgresql.UUID(as_uuid=True)
    stamp = {"nullable": False, "server_default": sa.func.now()}
    if not inspector.has_table("staff_roles"):
        op.create_table(
            "staff_roles",
            sa.Column("id", uuid, primary_key=True),
            sa.Column("key", sa.String(64), nullable=False, unique=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("description", sa.Text),
            sa.Column("is_system", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
            sa.Column("archived_at", sa.DateTime(timezone=True)),
            sa.Column("created_by", uuid, sa.ForeignKey("users.id", ondelete="RESTRICT")),
            sa.Column("updated_by", uuid, sa.ForeignKey("users.id", ondelete="RESTRICT")),
            sa.Column("created_at", sa.DateTime(timezone=True), **stamp),
            sa.Column("updated_at", sa.DateTime(timezone=True), **stamp),
            sa.CheckConstraint("status IN ('ACTIVE', 'ARCHIVED')", name="ck_staff_roles_status"),
            sa.CheckConstraint("key ~ '^[A-Z][A-Z0-9_]{1,63}$'", name="ck_staff_roles_key"),
            sa.CheckConstraint(
                "(status = 'ARCHIVED') = (archived_at IS NOT NULL)",
                name="ck_staff_roles_archived",
            ),
        )
    if not inspector.has_table("staff_role_permissions"):
        op.create_table(
            "staff_role_permissions",
            sa.Column(
                "role_id",
                uuid,
                sa.ForeignKey("staff_roles.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column("permission", sa.String(64), primary_key=True),
            sa.CheckConstraint(
                f"permission IN ({_quoted(GRANTABLE)})",
                name="ck_staff_role_permissions_grantable",
            ),
        )
    if not inspector.has_table("staff_role_assignments"):
        op.create_table(
            "staff_role_assignments",
            sa.Column("id", uuid, primary_key=True),
            sa.Column(
                "user_id", uuid, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
            ),
            sa.Column(
                "role_id",
                uuid,
                sa.ForeignKey("staff_roles.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("scope_tenant_ids", postgresql.ARRAY(uuid)),
            sa.Column("expires_at", sa.DateTime(timezone=True)),
            sa.Column("reason", sa.Text),
            sa.Column("granted_by", uuid, sa.ForeignKey("users.id", ondelete="RESTRICT")),
            sa.Column("granted_at", sa.DateTime(timezone=True), **stamp),
            sa.Column("revoked_at", sa.DateTime(timezone=True)),
            sa.Column("revoked_by", uuid, sa.ForeignKey("users.id", ondelete="RESTRICT")),
            sa.Column("revoke_reason", sa.Text),
            sa.CheckConstraint(
                "scope_tenant_ids IS NULL OR cardinality(scope_tenant_ids) BETWEEN 1 AND 200",
                name="ck_staff_role_assignments_scope",
            ),
            sa.CheckConstraint(
                "revoked_at IS NOT NULL OR (revoked_by IS NULL AND revoke_reason IS NULL)",
                name="ck_staff_role_assignments_revoked",
            ),
        )
        for column in ("user_id", "role_id", "granted_by", "revoked_by"):
            op.create_index(
                f"ix_staff_role_assignments_{column}", "staff_role_assignments", [column]
            )
        op.create_index(
            "uq_staff_role_assignments_live",
            "staff_role_assignments",
            ["user_id", "role_id"],
            unique=True,
            postgresql_where=sa.text("revoked_at IS NULL"),
        )


def _seed_system_roles() -> None:
    """Rows only, so a system role can be assigned. Its permissions are code."""
    from app.core.staff_permissions import SYSTEM_ROLES

    bind = op.get_bind()
    for role in SYSTEM_ROLES.values():
        bind.execute(
            sa.text(
                """
                INSERT INTO staff_roles (id, key, name, description, is_system, status)
                VALUES (gen_random_uuid(), :key, :name, :description, true, 'ACTIVE')
                ON CONFLICT (key) DO UPDATE
                  SET name = EXCLUDED.name, description = EXCLUDED.description
                """
            ),
            {"key": role.key, "name": role.name, "description": role.description},
        )


# ---------------------------------------------------------------------------
# Memberships: four roles become one, each with its assignment
# ---------------------------------------------------------------------------
def _membership_guard(platform_roles: tuple[str, ...]) -> None:
    """`guard_membership_tenant_type`, as the baseline writes it, with the
    staff roles `platform_roles` paired to the PLATFORM tenant."""
    from app.modules.identity.domain import ROLE_TENANT_TYPE

    pairs = {r: t for r, t in ROLE_TENANT_TYPE.items() if t != "PLATFORM"}
    pairs.update(dict.fromkeys(platform_roles, "PLATFORM"))
    role_pairs = ", ".join(f"('{r}', '{t}')" for r, t in sorted(pairs.items()))
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_membership_tenant_type()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          t_type text;
        BEGIN
          SELECT type INTO t_type FROM tenants WHERE id = NEW.tenant_id;
          IF (NEW.role, t_type) NOT IN ({role_pairs}) THEN
            RAISE EXCEPTION 'MEMBERSHIP_GUARD: % cannot be held in a % tenant',
              NEW.role, t_type USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def _move_staff_memberships() -> None:
    from app.core.staff_permissions import PLATFORM_STAFF
    from app.modules.identity.models import ROLES

    op.execute("ALTER TABLE memberships DROP CONSTRAINT IF EXISTS ck_memberships_role")
    # Both spellings accepted while rows move; only PLATFORM_STAFF after.
    _membership_guard((PLATFORM_STAFF, *LEGACY_ROLES))
    op.execute(
        f"""
        INSERT INTO staff_role_assignments (id, user_id, role_id, reason)
        SELECT gen_random_uuid(), m.user_id, r.id,
               'migrated from memberships.role ' || m.role || ' (0022)'
          FROM memberships m
          JOIN tenants t ON t.id = m.tenant_id AND t.type = 'PLATFORM'
          JOIN staff_roles r
            ON r.key = CASE m.role WHEN 'PLATFORM_ADMIN' THEN 'SUPER_ADMIN' ELSE m.role END
         WHERE m.role IN ({_quoted(LEGACY_ROLES)})
           AND NOT EXISTS (SELECT 1 FROM staff_role_assignments a
                            WHERE a.user_id = m.user_id AND a.role_id = r.id
                              AND a.revoked_at IS NULL)
        """
    )
    op.execute(
        f"UPDATE memberships SET role = '{PLATFORM_STAFF}' WHERE role IN ({_quoted(LEGACY_ROLES)})"
    )
    _membership_guard((PLATFORM_STAFF,))
    op.execute(
        f"ALTER TABLE memberships ADD CONSTRAINT ck_memberships_role "
        f"CHECK (role IN ({_quoted(ROLES)}))"
    )


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
def _create_guards() -> None:
    from app.core.staff_permissions import SUPER_ADMIN, SYSTEM_ROLES

    system_keys = _quoted(SYSTEM_ROLES)
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_staff_role_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.is_system AND NEW.key NOT IN ({system_keys}) THEN
              RAISE EXCEPTION 'STAFF_ROLE_GUARD: % is not a system role', NEW.key
                USING ERRCODE = 'check_violation';
            END IF;
            IF NOT NEW.is_system AND NEW.key NOT LIKE 'CUSTOM\\_%' THEN
              RAISE EXCEPTION 'STAFF_ROLE_GUARD: a custom role key starts CUSTOM_'
                USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.status <> 'ACTIVE' THEN
              RAISE EXCEPTION 'STAFF_ROLE_GUARD: a role starts ACTIVE'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;
          IF NEW.key IS DISTINCT FROM OLD.key OR NEW.is_system IS DISTINCT FROM OLD.is_system THEN
            RAISE EXCEPTION 'STAFF_ROLE_GUARD: a role''s key and kind never change'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.is_system AND NEW.status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'STAFF_ROLE_GUARD: a system role is never archived'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
            RAISE EXCEPTION 'STAFF_ROLE_GUARD: an archived role stays archived'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_guard_staff_role_write ON staff_roles")
    op.execute(
        """
        CREATE TRIGGER trg_guard_staff_role_write
          BEFORE INSERT OR UPDATE ON staff_roles
          FOR EACH ROW EXECUTE FUNCTION guard_staff_role_write()
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_staff_role_permission_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          r staff_roles%ROWTYPE;
        BEGIN
          SELECT * INTO r FROM staff_roles
           WHERE id = CASE TG_OP WHEN 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
          IF r.is_system THEN
            RAISE EXCEPTION 'STAFF_ROLE_GUARD: a system role''s permissions are code'
              USING ERRCODE = 'check_violation';
          END IF;
          IF r.status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'STAFF_ROLE_GUARD: an archived role does not change'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_guard_staff_role_permission_write ON staff_role_permissions"
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_staff_role_permission_write
          BEFORE INSERT OR UPDATE OR DELETE ON staff_role_permissions
          FOR EACH ROW EXECUTE FUNCTION guard_staff_role_permission_write()
        """
    )
    # VOLATILE, not STABLE: a trigger revoking several rows in one statement
    # must see the rows it already revoked, or two could pass as "not last".
    # The count both last-super-admin checks keep above zero: people other
    # than `p_user` with a live SUPER_ADMIN assignment and an ACTIVE staff
    # membership.
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION staff_other_super_admins(p_user uuid)
        RETURNS bigint
        SET search_path = public, pg_temp
        AS $$
          SELECT count(DISTINCT a.user_id)
            FROM staff_role_assignments a
            JOIN staff_roles r ON r.id = a.role_id AND r.key = '{SUPER_ADMIN}'
            JOIN memberships m ON m.user_id = a.user_id AND m.status = 'ACTIVE'
            JOIN tenants t ON t.id = m.tenant_id AND t.type = 'PLATFORM'
           WHERE a.revoked_at IS NULL AND a.user_id <> p_user
        $$ LANGUAGE sql VOLATILE
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION staff_is_active_super_admin(p_user uuid)
        RETURNS boolean
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1
              FROM staff_role_assignments a
              JOIN staff_roles r ON r.id = a.role_id AND r.key = '{SUPER_ADMIN}'
              JOIN memberships m ON m.user_id = a.user_id AND m.status = 'ACTIVE'
              JOIN tenants t ON t.id = m.tenant_id AND t.type = 'PLATFORM'
             WHERE a.revoked_at IS NULL AND a.user_id = p_user)
        $$ LANGUAGE sql VOLATILE;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_staff_assignment_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          r staff_roles%ROWTYPE;
        BEGIN
          IF TG_OP = 'INSERT' THEN
            SELECT * INTO r FROM staff_roles WHERE id = NEW.role_id;
            IF NEW.revoked_at IS NOT NULL THEN
              RAISE EXCEPTION 'STAFF_ASSIGNMENT_GUARD: an assignment starts live'
                USING ERRCODE = 'check_violation';
            END IF;
            IF r.status <> 'ACTIVE' THEN
              RAISE EXCEPTION 'STAFF_ASSIGNMENT_GUARD: % is archived', r.key
                USING ERRCODE = 'check_violation';
            END IF;
            IF r.key = '{SUPER_ADMIN}'
               AND (NEW.scope_tenant_ids IS NOT NULL OR NEW.expires_at IS NOT NULL) THEN
              RAISE EXCEPTION 'STAFF_ASSIGNMENT_GUARD: SUPER_ADMIN is never scoped or expiring'
                USING ERRCODE = 'check_violation';
            END IF;
            IF NOT EXISTS (
                 SELECT 1 FROM memberships m JOIN tenants t ON t.id = m.tenant_id
                  WHERE m.user_id = NEW.user_id AND t.type = 'PLATFORM'
                    AND m.status = 'ACTIVE') THEN
              RAISE EXCEPTION 'STAFF_ASSIGNMENT_GUARD: only active staff hold a role'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF OLD.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'STAFF_ASSIGNMENT_GUARD: a revoked assignment never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.revoked_at IS NULL
             OR NEW.user_id IS DISTINCT FROM OLD.user_id
             OR NEW.role_id IS DISTINCT FROM OLD.role_id
             OR NEW.scope_tenant_ids IS DISTINCT FROM OLD.scope_tenant_ids
             OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
             OR NEW.reason IS DISTINCT FROM OLD.reason
             OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
             OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
            RAISE EXCEPTION 'STAFF_ASSIGNMENT_GUARD: only a revocation is written'
              USING ERRCODE = 'check_violation';
          END IF;
          SELECT * INTO r FROM staff_roles WHERE id = OLD.role_id;
          IF r.key = '{SUPER_ADMIN}' THEN
            {_LOCK}
            IF staff_is_active_super_admin(OLD.user_id)
               AND staff_other_super_admins(OLD.user_id) = 0 THEN
              RAISE EXCEPTION 'LAST_SUPER_ADMIN: the last active super admin keeps the role'
                USING ERRCODE = 'check_violation';
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_guard_staff_assignment_write ON staff_role_assignments")
    op.execute(
        """
        CREATE TRIGGER trg_guard_staff_assignment_write
          BEFORE INSERT OR UPDATE ON staff_role_assignments
          FOR EACH ROW EXECUTE FUNCTION guard_staff_assignment_write()
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_last_super_admin_membership()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF OLD.status = 'ACTIVE'
             AND (TG_OP = 'DELETE' OR NEW.status <> 'ACTIVE'
                  OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
            {_LOCK}
            IF staff_is_active_super_admin(OLD.user_id)
               AND staff_other_super_admins(OLD.user_id) = 0 THEN
              RAISE EXCEPTION 'LAST_SUPER_ADMIN: the last active super admin stays active'
                USING ERRCODE = 'check_violation';
            END IF;
          END IF;
          RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_guard_last_super_admin_membership ON memberships")
    op.execute(
        """
        CREATE TRIGGER trg_guard_last_super_admin_membership
          BEFORE UPDATE OF status, tenant_id OR DELETE ON memberships
          FOR EACH ROW EXECUTE FUNCTION guard_last_super_admin_membership()
        """
    )
