"""The employer's tenant id on two college reads, for the employer's logo.

A college reading a student it may see by name is told where they were hired
(`college_student_hires`) and where they applied
(`college_student_applications`), each employer named. Every other surface
that names an organisation now carries its logo (2026-10-10), and a logo is
found by tenant id, which these two did not return.

**Only a column is added.** Each function is recreated with its own consent
CTE, exactly as it was -- the baseline's for the hires, 0005's (consent to
words that name the details) for the applications. The tenant id is used by
the service to find the logo and is never sent to the college. A return
type cannot change under `CREATE OR REPLACE`, so each is dropped first, in
this one transaction.

Both get 0005's grants: EXECUTE for the app role, none for PUBLIC. The
baseline left `college_student_hires` with Postgres's default PUBLIC
EXECUTE; it is SECURITY DEFINER and only the app role calls it, so the
recreated one does not get that back.

Revision ID: 0017_college_reads_employer_logo
Revises: 0016_kyb_review_flow
Create Date: 2026-10-10
"""

from __future__ import annotations

from alembic import op

revision = "0017_college_reads_employer_logo"
down_revision = "0016_kyb_review_flow"
branch_labels = None
depends_on = None

APP_ROLE = "bharatpath_app"

#: The two functions this revision recreates, and the consent CTE each
#: joins. `test_invariant_09_consent.py` gathers this beside the others.
COLLEGE_STUDENT_READS: dict[str, str] = {
    "college_student_hires": "individually_visible",
    "college_student_applications": "individually_visible",
}

#: The baseline's, unchanged: live INDIVIDUAL and live ROSTER consent.
_BASELINE_INDIVIDUALLY_VISIBLE_CTE = """
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

#: 0005's `DETAILS_CONSENT_VERSIONS`, frozen here as there.
_DETAILS_VERSIONS_SQL = "'placeholder-2-2026-09-29'"

#: 0005's, unchanged: as the baseline's, and to words that name the details.
_DETAILS_INDIVIDUALLY_VISIBLE_CTE = f"""individually_visible AS (
  SELECT i.candidate_id, i.id AS consent_id, i.granted_at AS visible_since,
         i.consent_version
    FROM student_consents i
    JOIN student_consents r
      ON r.tenant_id = i.tenant_id
     AND r.candidate_id = i.candidate_id
     AND r.scope = 'ROSTER' AND r.revoked_at IS NULL
    JOIN users u
      ON u.id = i.candidate_id AND u.status = 'ACTIVE' AND u.pool = 'CANDIDATE'
   WHERE i.tenant_id = (SELECT bound_college_tenant())
     AND i.scope = 'INDIVIDUAL'
     AND i.revoked_at IS NULL
     AND i.consent_version IN ({_DETAILS_VERSIONS_SQL})
)"""

_REACHED = """ARRAY(
                   SELECT DISTINCT ev.to_stage::text FROM application_events ev
                    WHERE ev.application_id = a.id
                      AND ev.to_stage IN ('SHORTLISTED', 'INTERVIEW', 'DECISION', 'HIRED')
                 )"""


def _hires(*, with_tenant: bool) -> str:
    column = " employer_tenant_id uuid," if with_tenant else ""
    value = " a.tenant_id," if with_tenant else ""
    return f"""
        CREATE FUNCTION college_student_hires(p_candidate_id uuid)
        RETURNS TABLE (job_title text, employer_name text,{column} hired_at timestamptz)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_BASELINE_INDIVIDUALLY_VISIBLE_CTE}
          SELECT j.title, e.legal_name,{value} a.candidate_confirmed_at
            FROM individually_visible v
            JOIN applications a ON a.candidate_id = v.candidate_id AND a.stage = 'HIRED'
            JOIN jobs j ON j.id = a.job_id
            JOIN employers e ON e.tenant_id = a.tenant_id
           WHERE v.candidate_id = p_candidate_id
           ORDER BY a.candidate_confirmed_at DESC
        $$;
        """


def _applications(*, with_tenant: bool) -> str:
    column = " employer_tenant_id uuid," if with_tenant else ""
    value = " a.tenant_id," if with_tenant else ""
    return f"""
        CREATE FUNCTION college_student_applications(p_candidate_id uuid)
        RETURNS TABLE (
          job_title text, employer_name text,{column} job_location text, stage text,
          applied_at timestamptz, updated_at timestamptz, reached text[]
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_DETAILS_INDIVIDUALLY_VISIBLE_CTE}
          SELECT j.title, e.legal_name,{value} j.location, a.stage, a.created_at, a.updated_at,
                 {_REACHED}
            FROM individually_visible v
            JOIN applications a ON a.candidate_id = v.candidate_id
            JOIN jobs j ON j.id = a.job_id
            JOIN employers e ON e.tenant_id = a.tenant_id
           WHERE v.candidate_id = p_candidate_id
           ORDER BY a.created_at DESC, a.id DESC
        $$;
        """


def _recreate(*, with_tenant: bool) -> None:
    for name in COLLEGE_STUDENT_READS:
        op.execute(f"DROP FUNCTION IF EXISTS {name}(uuid)")
    op.execute(_hires(with_tenant=with_tenant))
    op.execute(_applications(with_tenant=with_tenant))
    for name in COLLEGE_STUDENT_READS:
        op.execute(f"REVOKE ALL ON FUNCTION {name}(uuid) FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {name}(uuid) TO {APP_ROLE}")


def upgrade() -> None:
    _recreate(with_tenant=True)


def downgrade() -> None:
    _recreate(with_tenant=False)
