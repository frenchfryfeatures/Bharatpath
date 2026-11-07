"""Trigram indexes for the console's name and email search (2026-10-21).

* `ix_users_email_trgm` -- part of an email (`GET /admin/candidates`,
  `/admin/leads`, `/admin/integrity/signals`, ...), for the roles that read
  whole contacts.
* `ix_candidate_profiles_full_name_trgm` -- part of a candidate's name.

pg_trgm is created with the database (`scripts/init_db_extensions.sql`) and
already serves `ix_candidate_profiles_city_trgm`. The baseline builds both
tables from the current models, which declare these indexes, so on a database
built from it they exist already and are created here only when missing.

Phone search reads the account's number or the onboarding one
(`COALESCE` across two tables), which no single index serves; it is a scan
of the candidates matched by the other filters.

Revision ID: 0020_admin_list_search
Revises: 0019_resume_builder
Create Date: 2026-10-21
"""

from __future__ import annotations

from alembic import op

revision = "0020_admin_list_search"
down_revision = "0019_resume_builder"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_users_email_trgm",
        "users",
        ["email"],
        postgresql_using="gin",
        postgresql_ops={"email": "gin_trgm_ops"},
        if_not_exists=True,
    )
    op.create_index(
        "ix_candidate_profiles_full_name_trgm",
        "candidate_profiles",
        ["full_name"],
        postgresql_using="gin",
        postgresql_ops={"full_name": "gin_trgm_ops"},
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_candidate_profiles_full_name_trgm", "candidate_profiles", if_exists=True)
    op.drop_index("ix_users_email_trgm", "users", if_exists=True)
