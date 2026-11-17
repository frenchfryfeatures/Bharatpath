"""Explicit salary currency and immediate joining for inactive employment."""
from alembic import op

revision = "0022_career_currency"
down_revision = "0021_resume_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Amounts have always been INR major units. Preserve every existing value.
    op.execute("""
        UPDATE candidate_profiles
        SET career = jsonb_set(career, '{details}',
            '{"annual_salary_currency":"INR","preferred_salary_currency":"INR"}'::jsonb
            || (career->'details')
            || CASE WHEN career->'details'->>'currently_employed' = 'NO'
                     OR career->'details'->>'work_status' = 'FRESHER'
                    THEN '{"notice_period":"IMMEDIATE"}'::jsonb ELSE '{}'::jsonb END)
        WHERE jsonb_typeof(career->'details') = 'object'
    """)


def downgrade() -> None:
    # Keep currency metadata: dropping it could reinterpret USD values as INR.
    pass
