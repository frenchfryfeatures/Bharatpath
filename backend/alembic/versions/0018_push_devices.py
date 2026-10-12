"""Push tokens for the mobile app, and one delivery row per message per phone.

* `push_devices` -- each installed app's Expo token, held by the account
  signed in on it now. Switched off on sign-out or when Expo reports the
  token dead. Personal data: erased with the person.
* `push_deliveries` -- one attempt to alert one phone about one inbox
  message. The push carries no message text; the inbox has it.
* `erase_candidate` -- replaced whole: 0015's, plus both tables, deleted
  just before the notifications they hang off.

The baseline builds both tables from the current models, so on a database
built from it they already exist and are created here only when missing.

Revision ID: 0018_push_devices
Revises: 0017_college_reads_employer_logo
Create Date: 2026-10-12
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018_push_devices"
down_revision = "0017_college_reads_employer_logo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    _create_tables()
    op.execute(erase_with_push_devices())


def downgrade() -> None:
    op.execute(_previous_erasure().erase_with_photos())
    op.drop_table("push_deliveries", if_exists=True)
    op.drop_table("push_devices", if_exists=True)


def _create_tables() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("push_devices"):
        op.create_table(
            "push_devices",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("token", sa.String(256), nullable=False, unique=True),
            sa.Column("platform", sa.String(8), nullable=False),
            sa.Column("active", sa.Boolean, nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
        )
        op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])
    if not inspector.has_table("push_deliveries"):
        op.create_table(
            "push_deliveries",
            sa.Column(
                "notification_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("notifications.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "device_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("push_devices.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("state", sa.String(16), nullable=False),
            sa.Column("attempts", sa.Integer, nullable=False),
            sa.Column("ticket_id", sa.String(128)),
            sa.Column("failure_code", sa.String(64)),
            sa.Column("attempted_at", sa.DateTime(timezone=True)),
            sa.Column("receipt_checked_at", sa.DateTime(timezone=True)),
            sa.CheckConstraint(
                "state IN ('PENDING', 'SENT', 'FAILED')", name="ck_push_deliveries_state"
            ),
        )
        op.create_index(
            "ix_push_deliveries_pending",
            "push_deliveries",
            ["attempted_at"],
            postgresql_where=sa.text("state = 'PENDING'"),
        )


# ---------------------------------------------------------------------------
# The erasure cascade, replaced whole: 0015's, plus `push_deliveries` and
# `push_devices`. `test_erasure_plan.py` reads the live definition.
# ---------------------------------------------------------------------------
_ANCHOR = "          DELETE FROM notifications WHERE user_id = p_user_id;\n"
_PUSH_DELETE = """          DELETE FROM push_deliveries WHERE notification_id IN
            (SELECT id FROM notifications WHERE user_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('push_deliveries', n);
          DELETE FROM push_devices WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('push_devices', n);
"""


def _previous_erasure() -> ModuleType:
    """0015, loaded by path: a revision file is not an importable module name."""
    path = Path(__file__).with_name("0015_profile_images.py")
    spec = importlib.util.spec_from_file_location("_bp_0015_profile_images", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def erase_with_push_devices() -> str:
    previous: str = _previous_erasure().erase_with_photos()
    if previous.count(_ANCHOR) != 1:
        raise RuntimeError("0015's erase_candidate no longer has the notifications delete")
    return previous.replace(_ANCHOR, _PUSH_DELETE + _ANCHOR)
