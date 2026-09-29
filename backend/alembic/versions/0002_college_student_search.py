"""Add college student search and roster pagination indexes.

The indexes are created `IF NOT EXISTS`: the baseline builds `roster_imports`,
`referral_codes` and `roster_entries` from the current models, which declare
them, so a fresh database already has them when this revision runs.

Revision ID: 0002_college_student_search
Revises: 0001_baseline
Create Date: 2026-09-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_college_student_search"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_INDIVIDUALLY_VISIBLE_CTE = """
individually_visible AS (
  SELECT i.candidate_id, i.id AS consent_id, i.granted_at AS visible_since
    FROM student_consents i
    JOIN student_consents r
      ON r.tenant_id = i.tenant_id
     AND r.candidate_id = i.candidate_id
     AND r.scope = 'ROSTER'
     AND r.revoked_at IS NULL
    JOIN users u
      ON u.id = i.candidate_id AND u.status = 'ACTIVE' AND u.pool = 'CANDIDATE'
   WHERE i.tenant_id = (SELECT bound_college_tenant())
     AND i.scope = 'INDIVIDUAL'
     AND i.revoked_at IS NULL
)"""

_LATEST_SCORE = """
LEFT JOIN LATERAL (
  SELECT s.raw_value, s.computed_at, s.resume_version_id
    FROM scores s
   WHERE s.user_id = v.candidate_id
   ORDER BY s.computed_at DESC, s.id DESC
   LIMIT 1
) AS ls ON true"""


def _drop_visible_students_functions() -> None:
    op.execute(
        "DROP FUNCTION IF EXISTS "
        "college_visible_students(integer, timestamptz, uuid, text)"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS "
        "college_visible_students(integer, timestamptz, uuid)"
    )


def upgrade() -> None:
    op.create_index(
        "ix_roster_imports_tenant_created",
        "roster_imports",
        ["tenant_id", "created_at", "id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_referral_codes_tenant_created",
        "referral_codes",
        ["tenant_id", "created_at", "id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_roster_entries_tenant_sent_stage",
        "roster_entries",
        ["tenant_id", "sent_at", "id"],
        postgresql_where=sa.text("invite_state = 'SENT'"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_roster_entries_tenant_accepted_stage",
        "roster_entries",
        ["tenant_id", "responded_at", "id"],
        postgresql_where=sa.text("invite_state = 'ACCEPTED'"),
        if_not_exists=True,
    )

    _drop_visible_students_functions()
    op.execute(
        f"""
        CREATE FUNCTION college_visible_students(
          p_limit integer, p_after_since timestamptz, p_after_id uuid,
          p_query text DEFAULT NULL
        )
        RETURNS TABLE (
          candidate_id uuid, consent_id uuid, visible_since timestamptz,
          full_name text, score_resume_version_id uuid
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT v.candidate_id, v.consent_id, v.visible_since, p.full_name,
                 ls.resume_version_id
            FROM individually_visible v
            LEFT JOIN candidate_profiles p ON p.user_id = v.candidate_id
            {_LATEST_SCORE}
            LEFT JOIN resume_versions rv ON rv.id = ls.resume_version_id
           WHERE (
                  p_after_since IS NULL
                  OR (v.visible_since, v.candidate_id) > (p_after_since, p_after_id)
                 )
             AND (
                  p_query IS NULL
                  OR strpos(
                       lower(
                         COALESCE(
                           NULLIF(btrim(p.full_name), ''),
                           NULLIF(btrim(rv.parsed ->> 'full_name'), ''),
                           ''
                         )
                       ),
                       lower(p_query)
                     ) > 0
                 )
           ORDER BY v.visible_since, v.candidate_id
           LIMIT LEAST(GREATEST(p_limit, 1), 101)
        $$;
        """
    )


def downgrade() -> None:
    _drop_visible_students_functions()
    op.execute(
        f"""
        CREATE FUNCTION college_visible_students(
          p_limit integer, p_after_since timestamptz, p_after_id uuid
        )
        RETURNS TABLE (
          candidate_id uuid, consent_id uuid, visible_since timestamptz,
          full_name text, score_resume_version_id uuid
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT v.candidate_id, v.consent_id, v.visible_since, p.full_name,
                 ls.resume_version_id
            FROM individually_visible v
            LEFT JOIN candidate_profiles p ON p.user_id = v.candidate_id
            {_LATEST_SCORE}
           WHERE (
                  p_after_since IS NULL
                  OR (v.visible_since, v.candidate_id) > (p_after_since, p_after_id)
                 )
           ORDER BY v.visible_since, v.candidate_id
           LIMIT LEAST(GREATEST(p_limit, 1), 101)
        $$;
        """
    )
    op.drop_index(
        "ix_roster_entries_tenant_accepted_stage",
        table_name="roster_entries",
    )
    op.drop_index(
        "ix_roster_entries_tenant_sent_stage",
        table_name="roster_entries",
    )
    op.drop_index(
        "ix_referral_codes_tenant_created",
        table_name="referral_codes",
    )
    op.drop_index(
        "ix_roster_imports_tenant_created",
        table_name="roster_imports",
    )
