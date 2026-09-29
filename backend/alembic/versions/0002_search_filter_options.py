"""Add the curated search-filter options table.

This revision was applied to shared databases but was later lost from the
repository. The current baseline also creates the table, so the upgrade is
conditional: old baseline databases receive the table, while databases built
from the current baseline keep the identical table they already have.

Revision ID: 0002_search_filter_options
Revises: 0001_baseline
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_search_filter_options"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "bharatpath_app"


def upgrade() -> None:
    op.create_table(
        "search_filter_options",
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column(
            "aliases",
            postgresql.ARRAY(sa.Text),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("state_code", sa.String(2)),
        sa.Column(
            "featured",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "sort_order",
            sa.Integer,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "active",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
        ),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
        ),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
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
        sa.UniqueConstraint(
            "kind",
            "key",
            name="uq_search_filter_options_kind_key",
        ),
        sa.CheckConstraint(
            "kind IN ('SKILL', 'CITY')",
            name="ck_search_filter_options_kind",
        ),
        sa.CheckConstraint(
            "key = lower(key) AND key <> '' AND char_length(label) > 0",
            name="ck_search_filter_options_key_normalised",
        ),
        sa.CheckConstraint(
            "(kind = 'CITY') = (state_code IS NOT NULL)",
            name="ck_search_filter_options_state_only_for_cities",
        ),
        sa.CheckConstraint(
            "cardinality(aliases) <= 10 AND NOT (key = ANY(aliases))",
            name="ck_search_filter_options_aliases",
        ),
        sa.CheckConstraint(
            "sort_order BETWEEN 0 AND 10000",
            name="ck_search_filter_options_sort_order",
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_search_filter_options_aliases",
        "search_filter_options",
        ["aliases"],
        postgresql_using="gin",
        if_not_exists=True,
    )
    op.create_index(
        "ix_search_filter_options_featured",
        "search_filter_options",
        ["kind", "sort_order"],
        postgresql_where=sa.text("featured AND active"),
        if_not_exists=True,
    )

    op.execute(f"REVOKE DELETE ON search_filter_options FROM {APP_ROLE}")


def downgrade() -> None:
    # The current baseline owns this table too, so dropping it here would make
    # a database at 0001 differ according to which baseline version built it.
    pass
