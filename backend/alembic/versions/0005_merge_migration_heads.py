"""Merge interview subscription with existing heads.

Revision ID: 0005_merge_migration_heads
Revises: 0004_merge_migration_heads, 0002_interviews_in_subscription
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0005_merge_migration_heads"
down_revision: str | Sequence[str] | None = (
    "0004_merge_migration_heads",
    "0002_interviews_in_subscription",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
