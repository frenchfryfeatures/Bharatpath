"""The organisation's own profile: trade name, headcount, website, about."""

from alembic import op

revision = "0013_employer_profile"
down_revision = "0012_job_details"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("trade_name", "VARCHAR(255)"),
    ("employee_count_band", "VARCHAR(16)"),
    ("website", "VARCHAR(255)"),
    ("about", "TEXT"),
)


def upgrade():
    # The baseline builds `employers` from the current ORM metadata, so a
    # fresh database already has these; an existing one needs them added.
    for name, kind in _COLUMNS:
        op.execute(f"ALTER TABLE employers ADD COLUMN IF NOT EXISTS {name} {kind}")


def downgrade():
    for name, _ in reversed(_COLUMNS):
        op.drop_column("employers", name)
