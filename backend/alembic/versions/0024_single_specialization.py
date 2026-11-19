"""One specialization answer; retain legacy text outside the active form data."""
from alembic import op

revision = "0024_single_specialization"
down_revision = "0023_job_taxonomy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
      UPDATE candidate_profiles SET career =
        jsonb_set(career, '{legacy_specialization_name}', career->'details'->'specialization_name')
        || jsonb_build_object('details',
          ((career->'details') - 'specialization_name') || jsonb_build_object('specialization',
            COALESCE(NULLIF(btrim(career->'details'->>'specialization'), ''),
                     career->'details'->>'specialization_name', '')))
      WHERE jsonb_typeof(career->'details')='object'
        AND career->'details' ? 'specialization_name'
    """)


def downgrade() -> None:
    # Keep the canonical answer and archived legacy text; do not create a second input.
    pass
