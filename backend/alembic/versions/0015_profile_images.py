"""Profile photos and organisation logos (2026-10-09).

* `user_photos` -- one photo per person: a student, an employer's or a
  college's member, our staff. Personal data: erased with the person.
* `organisation_logos` -- one logo per employer or college. Not personal,
  and not under Row-Level Security: candidates read it across tenants on the
  board (its exemption is in the baseline's `RLS_EXEMPT`).
* `erase_candidate` -- replaced whole: 0010's, plus `user_photos`. The
  object itself is deleted before the cascade, from the key on the row
  (`privacy.repository.erasable_object_keys`).

The baseline builds both tables from the current models, so on a database
built from it they already exist and are created here only when missing.

Revision ID: 0015_profile_images
Revises: 0014_complimentary_discounts
Create Date: 2026-10-09
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0015_profile_images"
down_revision = "0014_complimentary_discounts"
branch_labels = None
depends_on = None

#: Frozen here: `profile_images.domain.MAX_EDGE_PX` on the day this ran.
_MAX_EDGE_PX = 512
_STORED_TYPES = "mime IN ('image/jpeg', 'image/png')"
_EDGES = f"width BETWEEN 1 AND {_MAX_EDGE_PX} AND height BETWEEN 1 AND {_MAX_EDGE_PX}"


def upgrade() -> None:
    _create_tables()
    op.execute(erase_with_photos())


def downgrade() -> None:
    op.execute(_previous_erasure().erase_with_shortlists())
    op.drop_table("organisation_logos", if_exists=True)
    op.drop_table("user_photos", if_exists=True)


def _image_columns() -> list[sa.Column]:
    return [
        sa.Column("s3_key", sa.String(255), nullable=False),
        sa.Column("mime", sa.String(32), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
    ]


def _create_tables() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("user_photos"):
        op.create_table(
            "user_photos",
            sa.Column(
                "user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            *_image_columns(),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(_STORED_TYPES, name="ck_user_photos_mime"),
            sa.CheckConstraint(_EDGES, name="ck_user_photos_edges"),
        )
    if not inspector.has_table("organisation_logos"):
        op.create_table(
            "organisation_logos",
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            *_image_columns(),
            sa.Column(
                "updated_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(_STORED_TYPES, name="ck_organisation_logos_mime"),
            sa.CheckConstraint(_EDGES, name="ck_organisation_logos_edges"),
        )


# ---------------------------------------------------------------------------
# The erasure cascade, replaced whole: 0010's, plus `user_photos`.
# `test_erasure_plan.py` reads the live definition.
# ---------------------------------------------------------------------------
_ANCHOR = "          DELETE FROM applications WHERE candidate_id = p_user_id;\n"
_PHOTOS_DELETE = """          DELETE FROM user_photos WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('user_photos', n);
"""


def _previous_erasure() -> ModuleType:
    """0010, loaded by path: a revision file is not an importable module name."""
    path = Path(__file__).with_name("0010_employer_shortlists.py")
    spec = importlib.util.spec_from_file_location("_bp_0010_employer_shortlists", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def erase_with_photos() -> str:
    previous: str = _previous_erasure().erase_with_shortlists()
    if previous.count(_ANCHOR) != 1:
        raise RuntimeError("0010's erase_candidate no longer has the applications delete")
    return previous.replace(_ANCHOR, _PHOTOS_DELETE + _ANCHOR)
