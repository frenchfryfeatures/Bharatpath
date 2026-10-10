"""KYB: send back with flagged fields, review history, refill after rejection.

* `kyb_submissions.review_flags` -- what the last reviewer pointed at while
  the employer corrects it.
* `kyb_submissions.previous_submission_id` -- the rejected submission a new
  one was filled in from.
* `kyb_reviews` -- every decision, with the answers and documents it was made
  on, so a resubmission shows what changed. Tenant RLS like the rest of KYB,
  and append-only for the app role.

The baseline builds all of this from the current models, so every statement
here is safe on a database built from it.

Revision ID: 0016_kyb_review_flow
Revises: 0015_profile_images
Create Date: 2026-10-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016_kyb_review_flow"
down_revision = "0015_profile_images"
branch_labels = None
depends_on = None

APP_ROLE = "bharatpath_app"
TABLE = "kyb_reviews"


def upgrade() -> None:
    op.execute(
        "ALTER TABLE kyb_submissions "
        "ADD COLUMN IF NOT EXISTS review_flags JSONB NOT NULL DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE kyb_submissions ADD COLUMN IF NOT EXISTS previous_submission_id UUID "
        "REFERENCES kyb_submissions(id) ON DELETE RESTRICT"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kyb_submissions_previous ON kyb_submissions "
        "(previous_submission_id) WHERE previous_submission_id IS NOT NULL"
    )
    _create_reviews()
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {TABLE}_tenant_isolation ON {TABLE}")
    op.execute(
        f"""
        CREATE POLICY {TABLE}_tenant_isolation ON {TABLE}
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute(f"REVOKE UPDATE, DELETE ON {TABLE} FROM {APP_ROLE}")


def downgrade() -> None:
    op.drop_table(TABLE, if_exists=True)
    op.execute("DROP INDEX IF EXISTS ix_kyb_submissions_previous")
    op.execute("ALTER TABLE kyb_submissions DROP COLUMN IF EXISTS previous_submission_id")
    op.execute("ALTER TABLE kyb_submissions DROP COLUMN IF EXISTS review_flags")


def _create_reviews() -> None:
    if sa.inspect(op.get_bind()).has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("kyb_submissions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("decision", sa.String(24), nullable=False),
        sa.Column("reason", sa.Text),
        sa.Column("flags", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "reviewed_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "answers", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "documents", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.CheckConstraint(
            "decision IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED')",
            name="ck_kyb_reviews_decision",
        ),
        sa.CheckConstraint(
            "decision NOT IN ('REJECTED', 'MORE_INFO_REQUIRED') OR reason IS NOT NULL",
            name="ck_kyb_reviews_reason",
        ),
        sa.CheckConstraint(
            "decision IN ('REJECTED', 'MORE_INFO_REQUIRED') OR flags = '[]'::jsonb",
            name="ck_kyb_reviews_flags",
        ),
    )
    op.create_index("ix_kyb_reviews_submission", TABLE, ["submission_id", "reviewed_at"])
    op.create_index("ix_kyb_reviews_reviewed_by", TABLE, ["reviewed_by"])
