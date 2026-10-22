"""Resume sync: file names, and when a builder draft last caught up (2026-10-22).

* `resume_files.original_filename` -- the name the candidate's device gave
  the file, for their own list of uploaded resumes (`GET
  /candidate/resume/files`). A label only: the key and the type never come
  from it. NULL for every upload before this revision; nothing is back-filled,
  because the name was never received.
* `resume_builder_drafts.synced_at` -- when the draft last caught up with the
  candidate's resume (first saved, refilled, pushed, or kept on purpose). A
  CV read after it makes the draft `out_of_date`. Existing drafts take the
  later of their first save and their last push, so a draft started before a
  newer upload says so -- which is the case this revision exists for.

The baseline builds both tables from the current models, so on a database
built from it the columns already exist; every step here is idempotent.
Both tables carry table-level grants, which cover a new column.

Revision ID: 0021_resume_sync
Revises: 0020_admin_list_search
Create Date: 2026-10-22
"""

from __future__ import annotations

from alembic import op

revision = "0021_resume_sync"
down_revision = "0020_admin_list_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS original_filename varchar(255)")
    op.execute("ALTER TABLE resume_builder_drafts ADD COLUMN IF NOT EXISTS synced_at timestamptz")
    op.execute(
        """
        UPDATE resume_builder_drafts
           SET synced_at = GREATEST(created_at, COALESCE(pushed_at, created_at))
         WHERE synced_at IS NULL
        """
    )
    op.execute(
        """
        ALTER TABLE resume_builder_drafts
          ALTER COLUMN synced_at SET DEFAULT now(),
          ALTER COLUMN synced_at SET NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE resume_builder_drafts DROP COLUMN IF EXISTS synced_at")
    op.execute("ALTER TABLE resume_files DROP COLUMN IF EXISTS original_filename")
