"""The posting's long form: `jobs.details`, validated by `jobs.details.JobDetails`."""

from alembic import op

revision = "0012_job_details"
down_revision = "0011_candidate_career_details"
branch_labels = None
depends_on = None


def upgrade():
    # The baseline builds `jobs` from the current ORM metadata, so a fresh
    # database already has the column; an existing one needs it added. `{}`
    # reads as every default, which is PUBLIC -- what every job was until now.
    op.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb")


def downgrade():
    op.drop_column("jobs", "details")
