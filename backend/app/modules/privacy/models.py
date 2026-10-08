"""privacy - SQLAlchemy ORM models.

Export and deletion requests, DSR tracking.

PRD section 8 requires users to be able to request export or deletion, tracked
with a due date.

**The policy this table enforces is now written down, and it is not complete.**
The client answered the substance on 2026-09-11 (*"do full delete for them"*)
and confirmed our carve-out on 2026-09-15 (*"B3 correct"*): personal data is
destroyed, financial and audit rows survive. Every table's disposition is in
`privacy.domain.ERASURE_PLAN`, and the cascade that executes it is
`erase_candidate` in the baseline migration.

What is **still** owed is the retention *period* on the rows that survive --
how long a payment or a view event lives before it, too, is destroyed. That is
counsel's and it has never arrived (blockers B3). So `policy_version` on every
completed row still starts `placeholder-`, and nothing here guesses a period:
a retained row is retained until somebody with the authority says otherwise.

`manifest` is what made the difference between a cascade we could ship and one
we could not. It records how many rows were destroyed in each table, so three
years later "what exactly was deleted?" has an answer that does not require
the data that would have answered it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey
from app.modules.privacy.domain import DSR_STATES, DSR_TYPES


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class DsrRequest(Base, UUIDPrimaryKey, Timestamps):
    """A data-subject request. Export or deletion.

    **This row outlives the erasure it records**, and that is the point: it is
    the evidence we complied. It holds a user id, two dates and a policy
    version, so it is not itself personal data once the account it points at
    has been emptied.
    """

    __tablename__ = "dsr_requests"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="RECEIVED", nullable=False)
    # Tracked, and visible to the user (SRS 2.13.2).
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Export only: a short-lived presigned URL over an encrypted archive.
    export_s3_key: Mapped[str | None] = mapped_column(String(512))
    #: Which version of `domain.ERASURE_PLAN` was in force. Stored for the same
    #: reason a score stores `algorithm_version`: the policy will change, and
    #: an old row must still say what it meant.
    policy_version: Mapped[str | None] = mapped_column(String(64))
    #: `{table: rows_destroyed}` from `erase_candidate`. Counts, never content.
    manifest: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(_in("type", DSR_TYPES), name="ck_dsr_type"),
        CheckConstraint(_in("state", DSR_STATES), name="ck_dsr_state"),
        # An erasure that reports nothing about itself is not auditable. The
        # database refuses to call one complete without both halves of the
        # record -- the policy it ran under, and what it destroyed.
        CheckConstraint(
            "state <> 'COMPLETED' OR type <> 'DELETE' "
            "OR (policy_version IS NOT NULL AND manifest IS NOT NULL)",
            name="ck_dsr_completed_delete_has_manifest",
        ),
        CheckConstraint(
            "state NOT IN ('COMPLETED', 'REJECTED') OR completed_at IS NOT NULL",
            name="ck_dsr_terminal_has_timestamp",
        ),
        Index(
            "ix_dsr_open_by_due",
            "due_at",
            postgresql_where=text("state IN ('RECEIVED', 'PROCESSING')"),
        ),
        Index("ix_dsr_user", "user_id", "created_at"),
        # One open request of each kind per person. Held by the database and
        # not only by the service's check, because two taps on "delete my
        # data" arrive as two concurrent requests and both would pass a read.
        Index(
            "uq_dsr_one_open_per_type",
            "user_id",
            "type",
            unique=True,
            postgresql_where=text("state IN ('RECEIVED', 'PROCESSING')"),
        ),
        # The deletion sweep's query: open deletions, oldest first. Without
        # this it is a sequential scan over every request ever made, growing
        # forever while the rows it wants stay a handful (`test_index_review.py`).
        Index(
            "ix_dsr_due_deletions",
            "created_at",
            postgresql_where=text("type = 'DELETE' AND state = 'RECEIVED'"),
        ),
        # The export-expiry sweep's query.
        Index(
            "ix_dsr_live_exports",
            "completed_at",
            postgresql_where=text("type = 'EXPORT' AND export_s3_key IS NOT NULL"),
        ),
    )
