"""The resume builder (2026-10-13).

* `resume_builder_drafts` -- one draft per candidate: the resume they are
  building from their onboarding answers, its template, and whether they
  downloaded it or made it their resume. Personal data: erased with the
  person.
* `ck_resume_versions_source` -- gains `BUILDER`, the source of a version made
  in the builder (its file is the PDF the builder drew).
* `erase_candidate` -- replaced whole: 0018's, plus the draft, deleted just
  before the resume versions it may point at.

The baseline builds the table from the current models, so on a database built
from it the table and the wider CHECK already exist; both steps here are
idempotent.

**Downgrading fails on a database holding a BUILDER version**, because the
narrower CHECK no longer admits it. What such a version is -- a candidate's
resume, possibly scored -- is a decision, not something a downgrade deletes.

Revision ID: 0019_resume_builder
Revises: 0018_push_devices
Create Date: 2026-10-13
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019_resume_builder"
down_revision = "0018_push_devices"
branch_labels = None
depends_on = None

#: Frozen here: `resume_builder.domain.TEMPLATE_KEYS` on the day this ran.
_TEMPLATES = "template_key IN ('classic', 'modern', 'sidebar', 'minimal')"
_SOURCES_BEFORE = "source IN ('UPLOAD', 'PASTE', 'MANUAL', 'EDIT')"
_SOURCES_AFTER = "source IN ('UPLOAD', 'PASTE', 'MANUAL', 'EDIT', 'BUILDER')"


def upgrade() -> None:
    _create_table()
    _replace_source_check(_SOURCES_AFTER)
    op.execute(erase_with_resume_builder())


def downgrade() -> None:
    op.execute(_previous_erasure().erase_with_push_devices())
    _replace_source_check(_SOURCES_BEFORE)
    op.drop_table("resume_builder_drafts", if_exists=True)


def _create_table() -> None:
    if sa.inspect(op.get_bind()).has_table("resume_builder_drafts"):
        return
    op.create_table(
        "resume_builder_drafts",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("template_key", sa.String(32), nullable=False),
        sa.Column("content", postgresql.JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("first_downloaded_at", sa.DateTime(timezone=True)),
        sa.Column("last_downloaded_at", sa.DateTime(timezone=True)),
        sa.Column("download_count", sa.Integer, nullable=False),
        sa.Column(
            "pushed_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resume_versions.id", ondelete="SET NULL"),
        ),
        sa.Column("pushed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(_TEMPLATES, name="ck_resume_builder_drafts_template"),
        sa.CheckConstraint("download_count >= 0", name="ck_resume_builder_drafts_downloads"),
        sa.CheckConstraint(
            "(download_count = 0) = (first_downloaded_at IS NULL)",
            name="ck_resume_builder_drafts_first_download",
        ),
    )
    op.create_index(
        "ix_resume_builder_drafts_pushed_version", "resume_builder_drafts", ["pushed_version_id"]
    )


def _replace_source_check(condition: str) -> None:
    op.execute("ALTER TABLE resume_versions DROP CONSTRAINT IF EXISTS ck_resume_versions_source")
    op.execute(
        f"ALTER TABLE resume_versions ADD CONSTRAINT ck_resume_versions_source CHECK ({condition})"
    )


# ---------------------------------------------------------------------------
# The erasure cascade, replaced whole: 0018's, plus `resume_builder_drafts`.
# `test_erasure_plan.py` reads the live definition.
# ---------------------------------------------------------------------------
_ANCHOR = "          DELETE FROM resume_versions WHERE user_id = p_user_id;\n"
_DRAFT_DELETE = """          DELETE FROM resume_builder_drafts WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('resume_builder_drafts', n);
"""


def _previous_erasure() -> ModuleType:
    """0018, loaded by path: a revision file is not an importable module name."""
    path = Path(__file__).with_name("0018_push_devices.py")
    spec = importlib.util.spec_from_file_location("_bp_0018_push_devices", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def erase_with_resume_builder() -> str:
    previous: str = _previous_erasure().erase_with_push_devices()
    if previous.count(_ANCHOR) != 1:
        raise RuntimeError("0018's erase_candidate no longer has the resume_versions delete")
    return previous.replace(_ANCHOR, _DRAFT_DELETE + _ANCHOR)
