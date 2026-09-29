"""Allow a discarded roster file to be uploaded again.

Revision ID: 0003_roster_reupload
Revises: 0002_college_student_search
Create Date: 2026-09-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_roster_reupload"
down_revision: str | None = "0002_college_student_search"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: a database built from the current baseline already has the
    # model's partial index and never had the old constraint.
    op.execute("ALTER TABLE roster_imports DROP CONSTRAINT IF EXISTS uq_roster_import_source")
    op.create_index(
        "uq_roster_import_source_retained",
        "roster_imports",
        ["tenant_id", "source_sha256"],
        unique=True,
        postgresql_where=sa.text("state <> 'DISCARDED'"),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_roster_import_source_retained",
        table_name="roster_imports",
    )
    op.create_unique_constraint(
        "uq_roster_import_source",
        "roster_imports",
        ["tenant_id", "source_sha256"],
    )
