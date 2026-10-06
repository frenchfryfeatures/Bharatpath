"""Candidate-owned onboarding details, independent of paid scoring."""

from alembic import op

revision = "0011_candidate_career_details"
down_revision = "0010_employer_shortlists"
branch_labels = None
depends_on = None


def upgrade():
    # The baseline uses current ORM metadata when creating a fresh database.
    # Existing databases still need the column, fresh ones can already have it.
    op.execute(
        "ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS career JSONB NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade():
    op.drop_column("candidate_profiles", "career")
