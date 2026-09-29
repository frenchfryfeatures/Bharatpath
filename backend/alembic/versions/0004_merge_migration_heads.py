"""Merge the search-filter and college/roster migration branches.

Revision ID: 0004_merge_migration_heads
Revises: 0002_search_filter_options, 0003_roster_reupload
Create Date: 2026-09-26
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0004_merge_migration_heads"
down_revision: str | Sequence[str] | None = (
    "0002_search_filter_options",
    "0003_roster_reupload",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
