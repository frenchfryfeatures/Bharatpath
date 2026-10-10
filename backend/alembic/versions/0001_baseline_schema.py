"""Baseline schema: tables, RLS, append-only grants, publish gate.

This migration does four things the ORM cannot express, and each one is an
invariant rather than a nicety:

  1. **Row-Level Security** on every tenant-scoped table (invariant 7, SRS
     2.24.7). Policy: `tenant_id = current_setting('app.tenant_id')::uuid`.
  2. **Append-only `audit_events`** - UPDATE and DELETE revoked from the
     application role (invariant 7-prime, PRD rule 9).
  3. **INSERT-only `scores`** - no UPDATE, no DELETE (invariant 3). A score is
     not human-editable, directly or indirectly.
  4. **The publish gate as a Postgres trigger** (invariant 8) so a job cannot
     reach PUBLISHED for an unverified employer even via a direct repository
     call that bypasses the domain service.

Revision ID: 0001_baseline
Create Date: 2026-08-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "bharatpath_app"

# Every table that gets the tenant-isolation policy. Adding a tenant-scoped
# table without listing it here is caught by
# tests/invariants/test_invariant_07_rls.py, which reads the ORM metadata and
# fails on any tenant_id column that is neither policied nor deliberately
# exempted below.
TENANT_SCOPED_TABLES = (
    "employers",
    "kyb_submissions",
    "kyb_documents",
    "jobs",
    "applications",
    "candidate_view_events",
    "colleges",
    "college_seats",
    "roster_imports",
    "roster_entries",
    "student_consents",
    "referral_codes",
    "college_seat_assignments",
    # Day 19. NULL for a candidate's dispute, which the policy then never
    # matches; the candidate and staff policies are added beside it.
    "disputes",
    # 2026-10-05. The candidate's policies, the guard and the accept function
    # are migration 0010's, which runs on every database, fresh or not.
    "employer_shortlists",
)

# Tables that carry a tenant_id but must NOT get the policy. Each exemption is
# a deliberate decision with a reason, and the invariant test requires the
# reason to exist -- an unexplained exemption is how tenant isolation quietly
# stops applying.
RLS_EXEMPT: dict[str, str] = {
    "memberships": (
        "Chicken and egg: this table is read to DETERMINE app.tenant_id. At "
        "the moment it is queried the setting is not yet established, so the "
        "policy would match nothing and every request would fail to "
        "authenticate. Isolation here comes from the query always filtering "
        "on the authenticated user_id, which the caller cannot forge."
    ),
    "tenant_suspensions": (
        "Read during authentication, before tenant context exists -- same "
        "ordering problem as memberships. Written only by platform admins on "
        "the bypass engine, and every such write is audited."
    ),
    "audit_events": (
        "tenant_id is nullable here: candidate and platform-admin actions "
        "have no tenant. A WITH CHECK policy would reject those inserts and "
        "silently break the audit trail -- which is the one thing that must "
        "never fail to write. Reads go through the admin bypass engine."
    ),
    "organisation_logos": (
        "A logo is read by every candidate browsing an organisation's jobs, "
        "across tenants, and a candidate binds no tenant -- the policy would "
        "hide every logo on the board. It is not private: an organisation "
        "shows it to candidates on purpose. Writes take the tenant from the "
        "resolved membership, and every read and write filters on tenant_id "
        "(2026-10-09)."
    ),
}


def upgrade() -> None:
    _create_core_tables()
    _create_identity_tables()
    _create_candidate_tables()
    _create_employer_tables()
    _create_billing_tables()
    _create_college_tables()
    _create_platform_tables()

    _enable_row_level_security()
    _apply_append_only_grants()
    _create_view_event_partitions()
    _create_publish_gate_trigger()
    _create_published_at_stamp()
    _create_candidate_marketplace_access()
    _create_application_guard()
    _create_candidate_search_projection()
    _create_payment_guards()
    _create_discount_guards()
    _create_interview_guards()
    _create_college_access()
    _create_college_student_reads()
    _create_platform_access()
    _create_privacy_access()


def downgrade() -> None:
    # Deliberately not implemented. This is the baseline; "downgrading" it
    # means dropping every table in the product. If you need to start over in
    # development, recreate the database.
    raise NotImplementedError("The baseline migration is not reversible.")


# ---------------------------------------------------------------------------
# Cross-cutting
# ---------------------------------------------------------------------------
def _create_core_tables() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), index=True),
        sa.Column("actor_role", sa.String(64), nullable=False),
        sa.Column("action", sa.String(64), nullable=False, index=True),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.String(64), index=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), index=True),
        sa.Column("request_id", sa.String(64)),
        sa.Column(
            "metadata",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_audit_actor_time", "audit_events", ["actor_id", "occurred_at"])
    op.create_index("ix_audit_action_time", "audit_events", ["action", "occurred_at"])
    op.create_index("ix_audit_tenant_time", "audit_events", ["tenant_id", "occurred_at"])

    op.create_table(
        "idempotency_keys",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("endpoint", sa.String(255), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="IN_PROGRESS"),
        sa.Column("response_status", sa.Integer),
        sa.Column("response_body", postgresql.JSONB),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, index=True),
    )

    op.create_table(
        "outbox",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("event_type", sa.String(128), nullable=False, index=True),
        sa.Column("aggregate_type", sa.String(64), nullable=False),
        sa.Column("aggregate_id", sa.String(64), nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            index=True,
        ),
    )
    # The relay polls this. A partial index keeps the scan proportional to the
    # backlog rather than to total history.
    op.create_index(
        "ix_outbox_unpublished",
        "outbox",
        ["created_at"],
        postgresql_where=sa.text("published_at IS NULL"),
    )

    op.create_table(
        "config_values",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("key", sa.String(128), nullable=False, index=True),
        sa.Column("value", postgresql.JSONB, nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "effective_from",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("note", sa.Text),
        sa.UniqueConstraint("key", "version", name="uq_config_key_version"),
    )


# ---------------------------------------------------------------------------
# The rest of the schema is created from the ORM metadata, because keeping two
# hand-written definitions in sync is how they drift. Only the constructs
# SQLAlchemy cannot express -- RLS, grants, triggers -- are written by hand.
# ---------------------------------------------------------------------------
def _create_from_metadata(*table_names: str) -> None:
    # Load the models here rather than trusting the caller. This migration
    # failed in CI with KeyError: 'users' because env.py imported
    # `app.modules` (the packages) but never `<module>.models` (the ORM
    # classes), so the metadata was empty. Idempotent - imports are cached.
    from app.core.metadata import load_all_models

    metadata = load_all_models()
    bind = op.get_bind()
    missing = [n for n in table_names if n not in metadata.tables]
    if missing:
        raise RuntimeError(
            f"No ORM model registered for: {missing}. "
            "Metadata is incomplete - see app/core/metadata.py."
        )

    metadata.create_all(
        bind=bind,
        tables=[metadata.tables[name] for name in table_names],
        checkfirst=False,
    )


def _create_identity_tables() -> None:
    _create_from_metadata("users", "tenants", "memberships", "tenant_suspensions")


def _create_candidate_tables() -> None:
    _create_from_metadata(
        "resume_files",
        "resume_versions",
        "resume_extractions",
        "scores",
        "integrity_signals",
        "integrity_checks",
        "device_checks",
        "questionnaire_responses",
        "dsr_requests",
        "user_streaks",
        "streak_point_events",
        # 2026-09-29, also created by 0007 on a database built before it.
        "streak_activity_days",
        "candidate_profiles",
        "candidate_search_documents",
    )


def _create_employer_tables() -> None:
    _create_from_metadata(
        "employers",
        "kyb_submissions",
        "kyb_documents",
        "jobs",
        "applications",
        "application_events",
        # 2026-09-29, also created by 0005 on a database built before it.
        "application_messages",
        "candidate_view_events",
        # 2026-10-05, also created by 0010 on a database built before it.
        "employer_shortlists",
    )


def _create_billing_tables() -> None:
    _create_from_metadata(
        # Before `payments`, which names the code a checkout carried.
        "discount_codes",
        "payments",
        "payment_callbacks",
        "entitlements",
        "plans",
        "subscriptions",
        "subscription_events",
        "upi_mandates",
        "mandate_debit_notices",
        "courses",
        "course_purchases",
        "course_completions",
        # 2026-09-29, also created by 0005 on a database built before it.
        "course_modules",
        "course_lessons",
        "course_lesson_progress",
        "interview_products",
        "interview_checkout_notices",
        "interview_purchases",
        "interview_sessions",
        "interview_session_questions",
        "interview_answers",
        "interview_transcripts",
        "interview_evaluations",
        "discount_redemptions",
    )


def _create_platform_tables() -> None:
    """Day 19: the dispute queue and notifications."""
    _create_from_metadata(
        "disputes",
        "notifications",
        "notification_preferences",
        "notification_suppressions",
        "profile_nudges",
        # 2026-09-24: the skills and cities the search filter panel offers.
        "search_filter_options",
        # 2026-10-09, also created by 0015 on a database built before it.
        "user_photos",
        "organisation_logos",
    )


def _create_college_tables() -> None:
    _create_from_metadata(
        "colleges",
        "college_seats",
        "roster_imports",
        "roster_entries",
        "student_consents",
        "referral_codes",
        "college_seat_assignments",
    )


# ---------------------------------------------------------------------------
# Invariant 7 / SRS 2.24.7 -- Row-Level Security
# ---------------------------------------------------------------------------
def _enable_row_level_security() -> None:
    """Second line of tenant isolation.

    `FORCE ROW LEVEL SECURITY` matters: without it the policy would not apply
    to the table owner, and a future migration that changed ownership would
    silently disable isolation. With FORCE, only BYPASSRLS gets past -- which
    is exactly the one role we grant deliberately and audit.

    `current_setting(..., true)` (missing_ok) means an unset `app.tenant_id`
    yields NULL, the comparison is NULL, and **no rows are returned**. Failing
    closed is the point: forgetting to set the tenant shows nothing rather
    than everything.
    """
    for table in TENANT_SCOPED_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
              USING (
                tenant_id = NULLIF(
                  current_setting('app.tenant_id', true), ''
                )::uuid
              )
              WITH CHECK (
                tenant_id = NULLIF(
                  current_setting('app.tenant_id', true), ''
                )::uuid
              )
            """
        )


# ---------------------------------------------------------------------------
# Invariants 3 and 7-prime -- grants that make tables append-only
# ---------------------------------------------------------------------------
def _apply_append_only_grants() -> None:
    # Invariant 7-prime: the audit trail is append-only from the application
    # path. PRD rule 9 requires it and SRS 2.24.5 repeats it. Revoking at the
    # role level means even a bug cannot rewrite history.
    op.execute(f"REVOKE UPDATE, DELETE ON audit_events FROM {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE ON candidate_view_events FROM {APP_ROLE}")

    # Invariant 3: the score is never human-editable, directly or indirectly.
    # No route accepts a score value, and the database will not accept one
    # either. Score history is every row of this table, never mutated.
    op.execute(f"REVOKE UPDATE, DELETE ON scores FROM {APP_ROLE}")

    # Append-only event logs. Rewriting a stage transition or a subscription
    # transition after the fact would make both audit trails worthless.
    op.execute(f"REVOKE UPDATE, DELETE ON application_events FROM {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE ON subscription_events FROM {APP_ROLE}")

    # Score-moving writes (invariant 3's blast radius). Now that add-ons move
    # the score, a mutable completion row is a mutable score.
    op.execute(f"REVOKE UPDATE, DELETE ON course_completions FROM {APP_ROLE}")

    # Money (Day 15). A payment is the financial record the deletion carve-out
    # keeps (blockers B3); its status moves, so it keeps UPDATE, and
    # `guard_payment_write` holds what an update may change. A stored callback
    # is dispute evidence: the app may mark it processed and nothing else.
    op.execute(f"REVOKE DELETE ON payments FROM {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE ON payment_callbacks FROM {APP_ROLE}")
    op.execute(f"GRANT UPDATE (processed_at, outcome) ON payment_callbacks TO {APP_ROLE}")
    # A purchase grants a score-moving course; it is written once, by billing.
    op.execute(f"REVOKE UPDATE, DELETE ON course_purchases FROM {APP_ROLE}")
    # Day 16. A device check and a checkout notice are evidence of what was
    # measured and what the candidate was told before paying; a purchase is
    # written once, by billing. A session is score-moving once completed, so
    # it is never deleted, and `guard_interview_session_write` holds what an
    # update may change; a stored answer is held by its own guard.
    for table in ("device_checks", "interview_checkout_notices", "interview_purchases"):
        op.execute(f"REVOKE UPDATE, DELETE ON {table} FROM {APP_ROLE}")
    # Day 17. A transcript is what the evaluator was given and an evaluation
    # is what it said; either rewritten afterwards makes a dispute about
    # feedback unanswerable.
    for table in ("interview_transcripts", "interview_evaluations"):
        op.execute(f"REVOKE UPDATE, DELETE ON {table} FROM {APP_ROLE}")
    for table in ("interview_products", "interview_sessions", "interview_answers"):
        op.execute(f"REVOKE DELETE ON {table} FROM {APP_ROLE}")
    # Discount codes (2026-09-18). A code is created and then only switched
    # off -- its terms are what every redemption was priced on. A redemption
    # is the record that a code was used, written once when its payment
    # settled.
    op.execute(f"REVOKE UPDATE, DELETE ON discount_codes FROM {APP_ROLE}")
    op.execute(
        f"GRANT UPDATE (disabled_at, disabled_by, updated_at) ON discount_codes TO {APP_ROLE}"
    )
    op.execute(f"REVOKE UPDATE, DELETE ON discount_redemptions FROM {APP_ROLE}")
    # Lapsing loses access, not history (R13).
    for table in ("plans", "subscriptions", "upi_mandates", "mandate_debit_notices"):
        op.execute(f"REVOKE DELETE ON {table} FROM {APP_ROLE}")

    # Day 17 -- colleges. A seat count is moved by the seat guard alone, so
    # the app may set the allowance and never the count. A consent is revoked,
    # never rewritten or deleted (invariant 9). A referral code's use count is
    # moved only by `consume_referral_code`; the college may revoke it. A seat
    # is released, never deleted -- it is who the college was paying for.
    op.execute(f"REVOKE UPDATE, DELETE ON college_seats FROM {APP_ROLE}")
    op.execute(
        f"GRANT UPDATE (seats_allocated, allocated_by, updated_at) ON college_seats TO {APP_ROLE}"
    )
    op.execute(f"REVOKE UPDATE, DELETE ON student_consents FROM {APP_ROLE}")
    op.execute(f"GRANT UPDATE (revoked_at) ON student_consents TO {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE ON referral_codes FROM {APP_ROLE}")
    op.execute(f"GRANT UPDATE (revoked_at, revoked_by, updated_at) ON referral_codes TO {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE ON college_seat_assignments FROM {APP_ROLE}")
    op.execute(
        f"GRANT UPDATE (released_at, release_reason) ON college_seat_assignments TO {APP_ROLE}"
    )
    op.execute(f"REVOKE DELETE ON roster_imports FROM {APP_ROLE}")

    # The engagement-points ledger. Not a score, but it is a balance a
    # candidate sees, and one that could be rewritten would explain nothing.
    op.execute(f"REVOKE UPDATE, DELETE ON streak_point_events FROM {APP_ROLE}")

    # The masked-search document is written by the trigger on `scores` and by
    # nothing else (`_create_candidate_search_projection`). The app role reads
    # it; a write from the application would be a card the score does not
    # support. Not even INSERT, unlike the tables above.
    op.execute(f"REVOKE INSERT, UPDATE, DELETE ON candidate_search_documents FROM {APP_ROLE}")

    # Search filter options (2026-09-24) are switched off, never deleted, so
    # a saved search naming one still reads as plain text.
    op.execute(f"REVOKE DELETE ON search_filter_options FROM {APP_ROLE}")


# ---------------------------------------------------------------------------
# Invariant 7-prime -- the view log, partitioned by month
# ---------------------------------------------------------------------------
_VIEW_EVENT_PARTITIONS_SQL = f"""
CREATE OR REPLACE FUNCTION ensure_candidate_view_partitions(first_month date, months integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created integer := 0;
  lower_bound timestamptz;
  partition_name text;
BEGIN
  IF first_month IS NULL OR months IS NULL OR months < 1 OR months > 36 THEN
    RAISE EXCEPTION 'ensure_candidate_view_partitions: months must be between 1 and 36';
  END IF;
  FOR i IN 0 .. months - 1 LOOP
    lower_bound := (date_trunc('month', first_month::timestamp) + make_interval(months => i))
                   AT TIME ZONE 'UTC';
    partition_name := 'candidate_view_events_' || to_char(lower_bound AT TIME ZONE 'UTC', 'YYYY_MM');
    IF to_regclass(partition_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF candidate_view_events FOR VALUES FROM (%L) TO (%L)',
        partition_name, lower_bound, lower_bound + interval '1 month'
      );
      EXECUTE format('REVOKE ALL ON %I FROM {APP_ROLE}', partition_name);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;
"""

#: One statement each: the driver prepares what `op.execute` sends, and a
#: prepared statement holds exactly one command.
_VIEW_EVENT_PARTITION_STATEMENTS = (
    _VIEW_EVENT_PARTITIONS_SQL,
    "REVOKE ALL ON FUNCTION ensure_candidate_view_partitions(date, integer) FROM PUBLIC",
    f"GRANT EXECUTE ON FUNCTION ensure_candidate_view_partitions(date, integer) TO {APP_ROLE}",
    "CREATE TABLE candidate_view_events_default PARTITION OF candidate_view_events DEFAULT",
    f"REVOKE ALL ON candidate_view_events_default FROM {APP_ROLE}",
    "SELECT ensure_candidate_view_partitions("
    "(date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month')::date, 15)",
)


def _create_view_event_partitions() -> None:
    """Monthly partitions for `candidate_view_events`, and the function that adds them.

    Every profile an employer opens writes a row (invariant 7'), so this is
    the fastest-growing table in the schema. By month, so that retiring a
    month is a `DETACH PARTITION` rather than a `DELETE` over millions of rows
    -- and the retention period for this audit trail is still a question for
    counsel (blockers B3), so nothing detaches anything yet.

    **The partitions are revoked from the app role.** Default privileges grant
    it DML on every table the migrator creates, partitions included, and RLS
    on the parent does not apply to a query that names a partition directly.
    So the app reads and writes through `candidate_view_events` or not at all.

    **The DEFAULT partition is the safety net, not the plan.** A month with no
    partition lands there, so a missed maintenance run never refuses a reveal
    -- and never loses its audit row. `ensure_candidate_view_partitions` then
    refuses to create that month while the default holds its rows, which is
    loud on purpose: move them, then create it. The maintenance task
    (`app/tasks/view_event_partitions.py`) keeps three months ahead, and this
    creates fifteen from last month so nothing depends on it being scheduled
    (blockers E4).

    SECURITY DEFINER so the app role's worker can add a partition without
    holding DDL rights itself; it can create partitions of this one table,
    named by month, and nothing else.
    """
    for statement in _VIEW_EVENT_PARTITION_STATEMENTS:
        op.execute(statement)


# ---------------------------------------------------------------------------
# Invariant 8 -- no job publish before KYB approval
# ---------------------------------------------------------------------------
def _create_publish_gate_trigger() -> None:
    """PRD rule 7 / SRS 1.11.4, enforced below the service layer.

    The domain service checks this too. The trigger exists because the
    invariant test bypasses the API *and* the service and calls the repository
    directly -- and it must still fail. A gate that only lives in application
    code is a gate that a future refactor can route around.

    Note this fires regardless of `kyb.require_approval`. With auto-approval
    on, employers reach APPROVED immediately and the gate passes trivially;
    the invariant test runs with the flag off so the gate stays genuinely
    exercised whatever production is set to.
    """
    # SECURITY DEFINER is required, not decorative. `employers` carries FORCE
    # ROW LEVEL SECURITY, so without it this SELECT would be filtered by the
    # caller's tenant policy -- and in the invariant test, which inserts
    # directly with no tenant context set, the lookup would return no row.
    # The gate would then fire for the *wrong reason* (employer invisible
    # rather than employer unverified), which is a passing test that proves
    # nothing. Running as the owner makes the check read what is actually
    # there.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION enforce_kyb_before_publish()
        RETURNS TRIGGER
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          employer_status TEXT;
        BEGIN
          IF NEW.status <> 'PUBLISHED' THEN
            RETURN NEW;
          END IF;

          IF TG_OP = 'UPDATE' AND OLD.status = 'PUBLISHED' THEN
            RETURN NEW;   -- already live; this is an edit, not a publish
          END IF;

          SELECT kyb_status INTO employer_status
            FROM employers WHERE tenant_id = NEW.tenant_id;

          IF employer_status IS DISTINCT FROM 'APPROVED' THEN
            RAISE EXCEPTION
              'KYB_REQUIRED: employer % is not verified (kyb_status=%)',
              NEW.tenant_id, COALESCE(employer_status, 'NONE')
              USING ERRCODE = 'check_violation';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_enforce_kyb_before_publish
          BEFORE INSERT OR UPDATE OF status ON jobs
          FOR EACH ROW EXECUTE FUNCTION enforce_kyb_before_publish();
        """
    )


# ---------------------------------------------------------------------------
# Day 11 -- a published job always knows when it was published
# ---------------------------------------------------------------------------
def _create_published_at_stamp() -> None:
    """Stamp `published_at` on the way into PUBLISHED, in the database.

    The candidate board pages on `(published_at, id)`, and a keyset cursor over
    a nullable column skips or repeats rows. The service already sets the
    column; this makes it true for every other writer too -- fixtures and data
    migrations insert PUBLISHED rows directly. `ck_jobs_published_at` then
    holds it. A separate trigger from the KYB gate, so that function keeps
    doing exactly one thing.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION stamp_published_at()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF NEW.status = 'PUBLISHED' AND NEW.published_at IS NULL THEN
            NEW.published_at := now();
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_stamp_published_at
          BEFORE INSERT OR UPDATE OF status ON jobs
          FOR EACH ROW EXECUTE FUNCTION stamp_published_at();
        """
    )


# ---------------------------------------------------------------------------
# Day 11 -- what a candidate may read and write under Row-Level Security
# ---------------------------------------------------------------------------
#: Policies added for candidates, who belong to no tenant. Listed so the count
#: `reset_local_db.sh` prints can be reconciled: 12 tenant policies plus these.
CANDIDATE_POLICIES = (
    "jobs_candidate_board",
    "employers_candidate_board",
    "applications_candidate_read",
    "applications_candidate_apply",
    "applications_candidate_update",
)


def _create_candidate_marketplace_access() -> None:
    """A candidate reads the job board and their own applications, and nothing else.

    The tenant policy cannot serve a candidate: they have no tenant, and the
    board is every employer's published jobs at once. Binding `app.tenant_id`
    to each employer in turn would be the tenant id coming from somewhere other
    than a membership, which is the thing SRS 2.24.7 forbids.

    So a second, narrower identity is bound instead: `app.user_id`, set by the
    candidate services from the verified token (`set_transaction_user`).
    `current_candidate_id()` turns it into a user id **only** when

      * no tenant is bound -- a business transaction always binds one, so an
        employer never sees another employer's jobs through these policies;
      * the id is an ACTIVE account in the CANDIDATE pool.

    Anything else yields NULL, every policy below matches nothing, and the
    fail-closed property of the tenant policies is kept: a session that binds
    nothing still reads no jobs (`test_unset_tenant_returns_no_rows_not_all_rows`).

    **Permissive policies OR together**, so these add reach and remove none.
    They grant SELECT on the board, and INSERT/UPDATE on the candidate's own
    applications only. Nothing lets a candidate write a job or an employer.

    `job_accepts_applications` is SECURITY DEFINER for the same reason as the
    KYB trigger, plus one more: an INSERT check on `applications` that read
    `jobs` under RLS would expand the `jobs` policy, which reads `applications`
    -- Postgres refuses that as infinite recursion. The function is opaque to
    the rewriter and reports only whether a job is live, which is public.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION current_candidate_id()
        RETURNS uuid
        LANGUAGE sql STABLE
        SET search_path = public, pg_temp
        AS $$
          SELECT u.id
            FROM users u
           WHERE NULLIF(current_setting('app.tenant_id', true), '') IS NULL
             AND u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND u.pool = 'CANDIDATE'
             AND u.status = 'ACTIVE'
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION job_accepts_applications(p_job_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM jobs j JOIN tenants t ON t.id = j.tenant_id
             WHERE j.id = p_job_id AND j.status = 'PUBLISHED' AND t.status = 'ACTIVE'
          )
        $$;
        """
    )

    # `(SELECT current_candidate_id())` rather than a bare call: the subquery
    # form is evaluated once per statement as an InitPlan, not once per row.
    #
    # The board shows PUBLISHED jobs, plus any job the candidate has applied
    # to -- otherwise an application to a job that later closed would lose
    # its title on the candidate's own Application Board. Board queries still
    # filter on status explicitly for that reason.
    #
    # A suspended employer's jobs leave the board (Day 19): stopping an
    # organisation that keeps recruiting is not stopping it. Jobs already
    # applied to stay readable to the candidate who applied.
    op.execute(
        """
        CREATE POLICY jobs_candidate_board ON jobs FOR SELECT
          USING (
            (SELECT current_candidate_id()) IS NOT NULL
            AND (
              (
                status = 'PUBLISHED'
                AND EXISTS (
                  SELECT 1 FROM tenants t WHERE t.id = jobs.tenant_id AND t.status = 'ACTIVE'
                )
              )
              OR EXISTS (
                SELECT 1 FROM applications a
                 WHERE a.job_id = jobs.id
                   AND a.candidate_id = (SELECT current_candidate_id())
              )
            )
          )
        """
    )
    # An employer's name, for employers with a job the candidate can see. The
    # subquery on `jobs` runs under the policy above, so this cannot reach an
    # employer with nothing on the board.
    op.execute(
        """
        CREATE POLICY employers_candidate_board ON employers FOR SELECT
          USING (
            (SELECT current_candidate_id()) IS NOT NULL
            AND EXISTS (SELECT 1 FROM jobs j WHERE j.tenant_id = employers.tenant_id)
          )
        """
    )
    op.execute(
        """
        CREATE POLICY applications_candidate_read ON applications FOR SELECT
          USING (candidate_id = (SELECT current_candidate_id()))
        """
    )
    # Applying is checked in the service too; this is the version a direct
    # repository call cannot route around. The tenant the row is filed under is
    # held by the composite foreign key to `jobs (id, tenant_id)`, not here.
    op.execute(
        """
        CREATE POLICY applications_candidate_apply ON applications FOR INSERT
          WITH CHECK (
            candidate_id = (SELECT current_candidate_id())
            AND stage = 'SUBMITTED'
            AND job_accepts_applications(job_id)
          )
        """
    )
    # No job-status check on update: withdrawing from a job that has since
    # closed must still work.
    op.execute(
        """
        CREATE POLICY applications_candidate_update ON applications FOR UPDATE
          USING (candidate_id = (SELECT current_candidate_id()))
          WITH CHECK (candidate_id = (SELECT current_candidate_id()))
        """
    )


# ---------------------------------------------------------------------------
# Day 12 -- the hiring pipeline, held below the service
# ---------------------------------------------------------------------------
def _create_application_guard() -> None:
    """The stage machine and the two-sided hire, for every writer.

    The service checks all of this and says what went wrong. This is the
    version a direct repository call cannot route around, in the same way the
    publish trigger backs invariant 8. Four rules:

      1. **An application is filed once.** It starts at SUBMITTED with no
         interview and no hire, and its job, tenant and candidate never change.
      2. **A stage change is one the pipeline allows** -- the pairs come from
         `applications.domain.allowed_transitions()`, the same function the
         service's rules are tested against, so the two cannot drift.
      3. **Hire confirmations are latches.** Once set, nobody moves or clears
         them; a dispute likewise. With the CHECKs on the table, that makes
         HIRED unreachable without both parties.
      4. **Each party writes only its own side.** A candidate transaction
         (`app.user_id` bound, no tenant) may withdraw or confirm, and cannot
         touch the stage otherwise, the interview or the employer's
         confirmation. A tenant transaction cannot withdraw on the candidate's
         behalf, confirm for them, or dispute.

    A transaction binding neither -- the migrator seeding tests, a data
    migration -- is held to rules 1 to 3 only.

    Not SECURITY DEFINER: it reads nothing but the row and the two settings.
    """
    from app.modules.applications.domain import allowed_transitions

    pairs = ", ".join(f"('{a}', '{b}')" for a, b in sorted(allowed_transitions()))
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_application_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          tenant_bound boolean := NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL;
          candidate_bound boolean := NOT tenant_bound
            AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL;
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.stage <> 'SUBMITTED'
               OR NEW.employer_confirmed_at IS NOT NULL
               OR NEW.candidate_confirmed_at IS NOT NULL
               OR NEW.hire_disputed_at IS NOT NULL
               OR NEW.meeting_url IS NOT NULL THEN
              RAISE EXCEPTION 'APPLICATION_GUARD: an application starts at SUBMITTED'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF NEW.tenant_id <> OLD.tenant_id OR NEW.job_id <> OLD.job_id
             OR NEW.candidate_id <> OLD.candidate_id OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'APPLICATION_GUARD: an application is never refiled'
              USING ERRCODE = 'check_violation';
          END IF;

          IF NEW.stage <> OLD.stage AND (OLD.stage, NEW.stage) NOT IN ({pairs}) THEN
            RAISE EXCEPTION 'APPLICATION_GUARD: % -> % is not a pipeline transition',
              OLD.stage, NEW.stage USING ERRCODE = 'check_violation';
          END IF;

          IF (OLD.employer_confirmed_at IS NOT NULL
                AND NEW.employer_confirmed_at IS DISTINCT FROM OLD.employer_confirmed_at)
             OR (OLD.candidate_confirmed_at IS NOT NULL
                AND NEW.candidate_confirmed_at IS DISTINCT FROM OLD.candidate_confirmed_at)
             OR (OLD.hire_disputed_at IS NOT NULL
                AND NEW.hire_disputed_at IS DISTINCT FROM OLD.hire_disputed_at) THEN
            RAISE EXCEPTION 'APPLICATION_GUARD: hire confirmations are latches'
              USING ERRCODE = 'check_violation';
          END IF;

          IF candidate_bound AND (
               (NEW.stage <> OLD.stage AND NEW.stage NOT IN ('WITHDRAWN', 'HIRED'))
               OR NEW.employer_confirmed_at IS DISTINCT FROM OLD.employer_confirmed_at
               OR NEW.meeting_url IS DISTINCT FROM OLD.meeting_url
               OR NEW.interview_at IS DISTINCT FROM OLD.interview_at
               OR NEW.employer_active_at IS DISTINCT FROM OLD.employer_active_at) THEN
            RAISE EXCEPTION 'APPLICATION_GUARD: not the candidate''s to change'
              USING ERRCODE = 'check_violation';
          END IF;

          IF tenant_bound AND (
               (NEW.stage <> OLD.stage AND NEW.stage IN ('WITHDRAWN', 'HIRED'))
               OR NEW.candidate_confirmed_at IS DISTINCT FROM OLD.candidate_confirmed_at
               OR NEW.hire_disputed_at IS DISTINCT FROM OLD.hire_disputed_at) THEN
            RAISE EXCEPTION 'APPLICATION_GUARD: not the employer''s to change'
              USING ERRCODE = 'check_violation';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_application_write
          BEFORE INSERT OR UPDATE ON applications
          FOR EACH ROW EXECUTE FUNCTION guard_application_write();
        """
    )


# ---------------------------------------------------------------------------
# Day 13 -- the masked-search document, written by the database
# ---------------------------------------------------------------------------
_SEARCH_PROJECTION_SQL = r"""
CREATE OR REPLACE FUNCTION project_candidate_search_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_features jsonb := COALESCE(NEW.extracted_features, '{}'::jsonb);
  v_skills text[];
  v_months bigint;
  v_badges text[];
BEGIN
  -- Distinct canonical skills, first spelling wins, contact-like text dropped.
  SELECT COALESCE(array_agg(d.skill ORDER BY d.ord), '{}'::text[])
    INTO v_skills
    FROM (
      SELECT DISTINCT ON (lower(btrim(s.e->>'canonical_name', E' \t\r\n')))
             btrim(s.e->>'canonical_name', E' \t\r\n') AS skill, s.ord
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(v_features->'skills') = 'array'
                    THEN v_features->'skills' ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS s(e, ord)
       WHERE jsonb_typeof(s.e->'canonical_name') = 'string'
         AND btrim(s.e->>'canonical_name', E' \t\r\n') <> ''
         AND char_length(btrim(s.e->>'canonical_name', E' \t\r\n')) <= __MAX_SKILL_LENGTH__
         AND btrim(s.e->>'canonical_name', E' \t\r\n') !~ '__CONTACT_LIKE__'
       ORDER BY lower(btrim(s.e->>'canonical_name', E' \t\r\n')), s.ord
    ) AS d;

  -- Months summed from the roles as `features_from_extraction` sums them:
  -- positive JSON integers only. CASE, not AND, so the cast is never
  -- attempted on "77", 12.5 or true.
  SELECT COALESCE(sum(
           CASE WHEN jsonb_typeof(r->'months') = 'number'
                     AND (r->>'months') ~ '^[0-9]{1,9}$'
                THEN (r->>'months')::bigint ELSE 0 END
         ), 0)
    INTO v_months
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(v_features->'roles') = 'array'
                THEN v_features->'roles' ELSE '[]'::jsonb END
         ) AS r;

  SELECT COALESCE(array_agg(DISTINCT k.badge ORDER BY k.badge), '{}'::text[])
    INTO v_badges
    FROM (
      SELECT __BADGE_CASE__ AS badge
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(NEW.contributing_events) = 'array'
                    THEN NEW.contributing_events ELSE '[]'::jsonb END
             ) AS e
    ) AS k
   WHERE k.badge IS NOT NULL;

  INSERT INTO candidate_search_documents AS doc (
           user_id, score_id, resume_version_id, computed_at, band, band_rank,
           experience_months, skills, skill_keys, badges, search_vector)
  VALUES (
           NEW.user_id, NEW.id, NEW.resume_version_id, NEW.computed_at,
           __BAND_CASE__, __RANK_CASE__,
           LEAST(v_months, 2147483647)::integer,
           v_skills,
           ARRAY(SELECT lower(x) FROM unnest(v_skills) AS x),
           v_badges,
           to_tsvector('simple', array_to_string(v_skills, ' ')))
  ON CONFLICT (user_id) DO UPDATE
     SET score_id = EXCLUDED.score_id,
         resume_version_id = EXCLUDED.resume_version_id,
         computed_at = EXCLUDED.computed_at,
         band = EXCLUDED.band,
         band_rank = EXCLUDED.band_rank,
         experience_months = EXCLUDED.experience_months,
         skills = EXCLUDED.skills,
         skill_keys = EXCLUDED.skill_keys,
         badges = EXCLUDED.badges,
         search_vector = EXCLUDED.search_vector
   -- The discovery CTE's "latest": greatest (computed_at, id). An older score
   -- arriving late never overwrites a newer document.
   WHERE (doc.computed_at, doc.score_id) <= (EXCLUDED.computed_at, EXCLUDED.score_id);

  RETURN NULL;
END;
$$;
"""


def _create_candidate_search_projection() -> None:
    """Keep `candidate_search_documents` equal to each candidate's latest score.

    **A trigger, not a task.** Masked search filters on facts taken from the
    stored extraction, and an event-driven copy can miss an event, fall behind
    a re-score, or be written by code that has a bug in it. An `AFTER INSERT`
    trigger on `scores` runs in the transaction that wrote the score, reads
    nothing but that row, and is the only writer the table has -- the app role
    holds no INSERT, UPDATE or DELETE on it (`_apply_append_only_grants`).

    **Generated from the rules it mirrors**, as the application guard is built
    from `allowed_transitions()`:

      * bands from `scoring.domain.BANDS`, out-of-range values going to the
        nearest end exactly as `band_for` does;
      * badges from `discovery.domain.BADGE_FOR_ADDON_KIND`;
      * the contact filter from `discovery.domain.CONTACT_LIKE_PATTERN`, a
        regex written in the dialect Python and Postgres share.

    Experience is summed in SQL rather than generated, and
    `test_masked_search.py` holds it equal to `features_from_extraction` on
    malformed extractions as well as ordinary ones.

    SECURITY DEFINER so the trigger can write a table the role that inserted
    the score cannot. It reads only `NEW`.
    """
    from app.modules.discovery.domain import (
        BADGE_FOR_ADDON_KIND,
        CONTACT_LIKE_PATTERN,
        MAX_SKILL_LENGTH,
    )
    from app.modules.scoring.domain import BANDS

    upper_bounds = [(label, high) for label, _low, high in BANDS[:-1]]
    band_case = (
        "CASE "
        + " ".join(f"WHEN NEW.raw_value <= {high} THEN '{label}'" for label, high in upper_bounds)
        + f" ELSE '{BANDS[-1][0]}' END"
    )
    rank_case = (
        "CASE "
        + " ".join(
            f"WHEN NEW.raw_value <= {high} THEN {i}" for i, (_, high) in enumerate(upper_bounds)
        )
        + f" ELSE {len(BANDS) - 1} END"
    )
    badge_case = (
        "CASE e->>'kind' "
        + " ".join(
            f"WHEN '{kind}' THEN '{badge}'" for kind, badge in sorted(BADGE_FOR_ADDON_KIND.items())
        )
        + " END"
    )

    op.execute(
        _SEARCH_PROJECTION_SQL.replace("__BAND_CASE__", band_case)
        .replace("__RANK_CASE__", rank_case)
        .replace("__BADGE_CASE__", badge_case)
        .replace("__CONTACT_LIKE__", CONTACT_LIKE_PATTERN.replace("'", "''"))
        .replace("__MAX_SKILL_LENGTH__", str(MAX_SKILL_LENGTH))
    )
    op.execute(
        """
        CREATE TRIGGER trg_project_candidate_search_document
          AFTER INSERT ON scores
          FOR EACH ROW EXECUTE FUNCTION project_candidate_search_document();
        """
    )


# ---------------------------------------------------------------------------
# Day 15 -- no entitlement without a verified payment, below the service
# ---------------------------------------------------------------------------
def _create_payment_guards() -> None:
    """A payment is settled only by a verified callback, for every writer.

    The service verifies the signature before it settles anything. These make
    that true for a direct repository call too, as the publish trigger does
    for invariant 8:

      * **`guard_payment_write`** -- a payment is inserted PENDING and
        unverified; what was charged, to whom and for what never changes;
        `signature_verified_at` is a latch; and status moves only along
        `billing.domain.PAYMENT_TRANSITIONS`, generated from the same set the
        service is tested against. With `ck_payments_settled_only_when_verified`
        that makes SUCCEEDED unreachable without a verification timestamp.
      * **`guard_course_purchase`** -- a course purchase needs this user's
        SUCCEEDED, verified payment for this course. A forged callback that
        somehow got past the service still cannot produce the row that makes
        a completion, and so a score change, possible.

    Not SECURITY DEFINER: `payments` is not under Row-Level Security, and the
    guards read nothing but the row and its payment.
    """
    from app.modules.billing.domain import PAYMENT_TRANSITIONS

    pairs = ", ".join(f"('{a}', '{b}')" for a, b in sorted(PAYMENT_TRANSITIONS))
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_payment_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.status <> 'PENDING' OR NEW.signature_verified_at IS NOT NULL
               OR NEW.settled_at IS NOT NULL THEN
              RAISE EXCEPTION 'PAYMENT_GUARD: a payment starts PENDING and unverified'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF NEW.user_id <> OLD.user_id OR NEW.provider <> OLD.provider
             OR NEW.provider_ref <> OLD.provider_ref OR NEW.amount_minor <> OLD.amount_minor
             OR NEW.currency <> OLD.currency OR NEW.purpose <> OLD.purpose
             OR NEW.item_code <> OLD.item_code OR NEW.item_id <> OLD.item_id
             OR NEW.subscriber_type IS DISTINCT FROM OLD.subscriber_type
             OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
             OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
             OR NEW.discount_code_id IS DISTINCT FROM OLD.discount_code_id
             OR NEW.list_amount_minor IS DISTINCT FROM OLD.list_amount_minor
             OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'PAYMENT_GUARD: what was charged, to whom and for what never changes'
              USING ERRCODE = 'check_violation';
          END IF;

          IF OLD.signature_verified_at IS NOT NULL
             AND NEW.signature_verified_at IS DISTINCT FROM OLD.signature_verified_at THEN
            RAISE EXCEPTION 'PAYMENT_GUARD: signature verification is a latch'
              USING ERRCODE = 'check_violation';
          END IF;

          IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN ({pairs}) THEN
            RAISE EXCEPTION 'PAYMENT_GUARD: % -> % is not a payment transition',
              OLD.status, NEW.status USING ERRCODE = 'check_violation';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_payment_write
          BEFORE INSERT OR UPDATE ON payments
          FOR EACH ROW EXECUTE FUNCTION guard_payment_write();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_course_purchase()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM payments p
             WHERE p.id = NEW.payment_id
               AND p.user_id = NEW.user_id
               AND p.purpose = 'COURSE'
               AND p.item_id = NEW.course_id
               AND p.status = 'SUCCEEDED'
               AND p.signature_verified_at IS NOT NULL
          ) THEN
            RAISE EXCEPTION 'COURSE_PURCHASE_GUARD: a course is bought only by its verified payment'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_course_purchase
          BEFORE INSERT ON course_purchases
          FOR EACH ROW EXECUTE FUNCTION guard_course_purchase();
        """
    )


def _create_discount_guards() -> None:
    """A discount is spent only by the payment that carried it (2026-09-18).

    * **`guard_discount_redemption`** -- a redemption needs this code's
      SUCCEEDED, verified payment, by the same payer, for the same
      subscriber and the same amounts. The shape of `guard_course_purchase`:
      a row that says a code was used is written only by money that moved.
    * **`guard_discount_code_write`** -- a code's terms never change after
      it exists, and switching it off is a latch. The column grants already
      stop the app role; this stops every writer, the migrator included.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_discount_redemption()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM payments p
             WHERE p.id = NEW.payment_id
               AND p.discount_code_id = NEW.discount_code_id
               AND p.user_id = NEW.user_id
               AND p.purpose = 'SUBSCRIPTION'
               AND p.subscriber_type = NEW.subscriber_type
               AND p.subscriber_id = NEW.subscriber_id
               AND p.amount_minor = NEW.amount_minor
               AND p.list_amount_minor = NEW.list_amount_minor
               AND p.status = 'SUCCEEDED'
               AND p.signature_verified_at IS NOT NULL
          ) THEN
            RAISE EXCEPTION 'DISCOUNT_GUARD: a code is redeemed only by its verified payment'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_discount_redemption
          BEFORE INSERT ON discount_redemptions
          FOR EACH ROW EXECUTE FUNCTION guard_discount_redemption();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_discount_code_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF NEW.code <> OLD.code OR NEW.audience <> OLD.audience
             OR NEW.percent_off IS DISTINCT FROM OLD.percent_off
             OR NEW.amount_off_minor IS DISTINCT FROM OLD.amount_off_minor
             OR NEW.valid_from <> OLD.valid_from
             OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
             OR NEW.usage_limit IS DISTINCT FROM OLD.usage_limit
             OR NEW.label IS DISTINCT FROM OLD.label
             OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'DISCOUNT_GUARD: a code''s terms never change'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.disabled_at IS NOT NULL AND (
               NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
               OR NEW.disabled_by IS DISTINCT FROM OLD.disabled_by) THEN
            RAISE EXCEPTION 'DISCOUNT_GUARD: switching a code off is a latch'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_discount_code_write
          BEFORE UPDATE ON discount_codes
          FOR EACH ROW EXECUTE FUNCTION guard_discount_code_write();
        """
    )


# ---------------------------------------------------------------------------
# Day 16 -- the mock interview, held below the service
# ---------------------------------------------------------------------------
def _create_interview_guards() -> None:
    """A session is bought by a verified payment and completed by stored audio,
    for every writer.

      * **`guard_interview_purchase`** -- as for a course: this user's
        SUCCEEDED, verified payment for this product, or no row.
      * **`guard_interview_session_write`** -- a session starts CREATED from
        the candidate's own purchase; what it is never changes; it moves only
        along `interview.domain.SESSION_TRANSITIONS` (generated); completion is
        a latch; and COMPLETED needs every answer STORED, counted in SQL
        against `QUESTIONS_PER_SESSION`. So +20 cannot be reached by an UPDATE
        that skips the recording, from any path. EVALUATED and FAILED (Day 17)
        need the `interview_evaluations` row that says so.
      * **`guard_interview_answer_write`** -- a STORED answer never changes,
        and nothing is written to a session no longer being recorded.

    Not SECURITY DEFINER: none of these tables is under Row-Level Security.
    """
    from app.modules.interview.bank import QUESTIONS_PER_SESSION
    from app.modules.interview.domain import OPEN_STATES, SESSION_TRANSITIONS

    pairs = ", ".join(f"('{a}', '{b}')" for a, b in sorted(SESSION_TRANSITIONS))
    open_states = ", ".join(f"'{state}'" for state in sorted(OPEN_STATES))
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_interview_purchase()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM payments p
             WHERE p.id = NEW.payment_id
               AND p.user_id = NEW.user_id
               AND p.purpose = 'INTERVIEW_SESSION'
               AND p.item_id = NEW.product_id
               AND p.status = 'SUCCEEDED'
               AND p.signature_verified_at IS NOT NULL
          ) THEN
            RAISE EXCEPTION 'INTERVIEW_PURCHASE_GUARD: a session is bought only by its verified payment'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_interview_purchase
          BEFORE INSERT ON interview_purchases
          FOR EACH ROW EXECUTE FUNCTION guard_interview_purchase();
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_interview_session_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.state <> 'CREATED' OR NEW.completed_at IS NOT NULL
               OR NEW.points_awarded IS NOT NULL THEN
              RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: a session starts CREATED'
                USING ERRCODE = 'check_violation';
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM interview_purchases p
               WHERE p.id = NEW.purchase_id AND p.user_id = NEW.user_id
            ) THEN
              RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: a session starts from its owner''s purchase'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF NEW.user_id <> OLD.user_id OR NEW.purchase_id <> OLD.purchase_id
             OR NEW.device_check_id <> OLD.device_check_id
             OR NEW.session_number <> OLD.session_number
             OR NEW.question_set_code <> OLD.question_set_code
             OR NEW.question_set_version <> OLD.question_set_version
             OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: what a session is never changes'
              USING ERRCODE = 'check_violation';
          END IF;

          IF OLD.completed_at IS NOT NULL AND (
               NEW.completed_at IS DISTINCT FROM OLD.completed_at
               OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
               OR NEW.contribution_version IS DISTINCT FROM OLD.contribution_version) THEN
            RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: a completion is a latch'
              USING ERRCODE = 'check_violation';
          END IF;

          IF NEW.state <> OLD.state AND (OLD.state, NEW.state) NOT IN ({pairs}) THEN
            RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: % -> % is not a session transition',
              OLD.state, NEW.state USING ERRCODE = 'check_violation';
          END IF;

          IF NEW.state IN ('EVALUATED', 'FAILED') AND NEW.state <> OLD.state AND NOT EXISTS (
               SELECT 1 FROM interview_evaluations e
                WHERE e.session_id = NEW.id AND e.outcome = NEW.state
             ) THEN
            RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: % needs the evaluation that records it', NEW.state
              USING ERRCODE = 'check_violation';
          END IF;

          IF NEW.state = 'COMPLETED' AND OLD.state <> 'COMPLETED' AND (
               SELECT count(*) FROM interview_answers a
                WHERE a.session_id = NEW.id AND a.upload_state = 'STORED'
             ) < {QUESTIONS_PER_SESSION} THEN
            RAISE EXCEPTION 'INTERVIEW_SESSION_GUARD: a session completes only with every answer stored'
              USING ERRCODE = 'check_violation';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_interview_session_write
          BEFORE INSERT OR UPDATE ON interview_sessions
          FOR EACH ROW EXECUTE FUNCTION guard_interview_session_write();
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_interview_answer_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF TG_OP = 'UPDATE' AND OLD.upload_state = 'STORED' THEN
            RAISE EXCEPTION 'INTERVIEW_ANSWER_GUARD: a stored answer never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM interview_sessions s
             WHERE s.id = NEW.session_id AND s.state IN ({open_states})
          ) THEN
            RAISE EXCEPTION 'INTERVIEW_ANSWER_GUARD: the session is no longer being recorded'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_interview_answer_write
          BEFORE INSERT OR UPDATE ON interview_answers
          FOR EACH ROW EXECUTE FUNCTION guard_interview_answer_write();
        """
    )


# ---------------------------------------------------------------------------
# Day 17 -- colleges: seats, referral codes, invitations, held below the service
# ---------------------------------------------------------------------------
#: Policies added so a candidate, who belongs to no tenant, can link to a
#: college and read their own links. Listed beside `CANDIDATE_POLICIES`.
COLLEGE_CANDIDATE_POLICIES = (
    "student_consents_candidate_read",
    "student_consents_candidate_grant",
    "student_consents_candidate_revoke",
    "student_consents_only_the_student_grants",
    "student_consents_only_the_student_revokes",
    "college_seat_assignments_candidate_read",
    "colleges_candidate_linked",
)


def _create_college_access() -> None:
    """What a student may do about a college, and what holds a seat's count.

    A student has no tenant, and the college tables are all tenant-scoped.
    Binding `app.tenant_id` to the college named by a code the student typed
    would be a tenant id taken from a request body, which SRS 2.24.7 forbids --
    and it would open every row of that college to the transaction. So, as on
    Day 11, the candidate binds `app.user_id` and reaches the college tables
    through policies and **narrow SECURITY DEFINER functions** that each answer
    one question and return no more than it needs:

      * `referral_code_tenant(code)` -- which college a live code belongs to.
        Candidates only, so an employer cannot use it to test codes.
      * `consume_referral_code(id)` -- one use, only while the code is live and
        under `max_uses`, as one conditional UPDATE.
      * `referral_code_admits(id, tenant)` / `invitation_admits(entry, tenant)`
        -- read by the INSERT policy on `student_consents`, so a consent row
        must name a live code of that college, or an invitation this student
        accepted. A student cannot attach themselves to a roster by writing one.
      * `invitations_for_candidate()` / `answer_invitation(entry, accept)` --
        invitations **matched on the student's own verified phone or email**,
        never on anything they send.
      * `claim_college_seat(tenant)` -- a seat for this student at a college
        they are linked to, if one is free; NULL otherwise, never an error.
      * `candidate_has_college_seat(user)` -- the seat limb of
        `require_active_subscription`: a live seat, a live ROSTER consent, an
        ACTIVE college, and that college's subscription in period, read live.

    And for every writer, the migrator included:

      * `guard_college_seat_assignment` -- a seat needs its student's live
        ROSTER consent at that college and a free place in the allowance; it
        moves `college_seats.seats_used` itself, so the count cannot drift;
        release is a latch.
      * `release_seat_on_consent_revoke` -- revoking ROSTER consent releases
        the seat it paid for, in the same statement (Day 18 builds revocation;
        this makes it correct the day it lands).
      * `guard_student_consent_write` -- revocation is a latch, and nothing
        else about a consent changes.
      * `guard_roster_entry_write` -- a committed row's contact never changes,
        invitations move only along `college.domain.INVITE_TRANSITIONS`
        (generated), and only an uncommitted row may be deleted.
    """
    from app.modules.college.domain import INVITATION_VALID_FOR, INVITE_TRANSITIONS

    valid_days = INVITATION_VALID_FOR.days
    invite_pairs = ", ".join(f"('{a}', '{b}')" for a, b in sorted(INVITE_TRANSITIONS))
    #: The student's own contact, as `users` holds it, against a roster row.
    matches = """(
               (u.phone IS NOT NULL AND e.phone = u.phone)
            OR (u.email IS NOT NULL AND e.email = lower(u.email))
          )"""

    op.execute(
        """
        CREATE OR REPLACE FUNCTION referral_code_tenant(p_code text)
        RETURNS TABLE (code_id uuid, tenant_id uuid)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT rc.id, rc.tenant_id
            FROM referral_codes rc
            JOIN tenants t ON t.id = rc.tenant_id
           WHERE (SELECT current_candidate_id()) IS NOT NULL
             AND rc.code = p_code
             AND rc.revoked_at IS NULL
             AND rc.expires_at > now()
             AND (rc.max_uses IS NULL OR rc.uses < rc.max_uses)
             AND t.type = 'COLLEGE'
             AND t.status = 'ACTIVE'
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION consume_referral_code(p_code_id uuid)
        RETURNS boolean
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF (SELECT current_candidate_id()) IS NULL THEN
            RETURN false;
          END IF;
          UPDATE referral_codes
             SET uses = uses + 1, updated_at = now()
           WHERE id = p_code_id
             AND revoked_at IS NULL
             AND expires_at > now()
             AND (max_uses IS NULL OR uses < max_uses);
          RETURN FOUND;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION referral_code_admits(p_code_id uuid, p_tenant_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM referral_codes rc
             WHERE rc.id = p_code_id
               AND rc.tenant_id = p_tenant_id
               AND rc.revoked_at IS NULL
               AND rc.expires_at > now()
          )
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION invitations_for_candidate()
        RETURNS TABLE (entry_id uuid, tenant_id uuid, college_name text, sent_at timestamptz)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT e.id, e.tenant_id, c.name, e.sent_at
            FROM users u
            JOIN roster_entries e ON {matches}
            JOIN colleges c ON c.tenant_id = e.tenant_id
            JOIN tenants t ON t.id = e.tenant_id
           WHERE u.id = (SELECT current_candidate_id())
             AND e.invite_state = 'SENT'
             AND e.sent_at > now() - interval '{valid_days} days'
             AND t.status = 'ACTIVE'
           ORDER BY e.sent_at DESC
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION answer_invitation(p_entry_id uuid, p_accept boolean)
        RETURNS uuid
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          v_tenant uuid;
        BEGIN
          UPDATE roster_entries e
             SET invite_state = CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'DECLINED' END,
                 responded_at = now()
            FROM users u
           WHERE u.id = (SELECT current_candidate_id())
             AND e.id = p_entry_id
             AND e.invite_state = 'SENT'
             AND e.sent_at > now() - interval '{valid_days} days'
             AND {matches}
          RETURNING e.tenant_id INTO v_tenant;
          IF v_tenant IS NOT NULL THEN
            RETURN v_tenant;
          END IF;
          -- Answering the same way twice is a retry, not a new answer.
          SELECT e.tenant_id INTO v_tenant
            FROM roster_entries e, users u
           WHERE u.id = (SELECT current_candidate_id())
             AND e.id = p_entry_id
             AND e.invite_state = CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'DECLINED' END
             AND {matches};
          RETURN v_tenant;
        END;
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION invitation_admits(p_entry_id uuid, p_tenant_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM roster_entries e, users u
             WHERE u.id = (SELECT current_candidate_id())
               AND e.id = p_entry_id
               AND e.tenant_id = p_tenant_id
               AND e.invite_state = 'ACCEPTED'
               AND {matches}
          )
        $$;
        """
    )

    # Policies. `(SELECT current_candidate_id())` for the InitPlan, as on Day 11.
    op.execute(
        """
        CREATE POLICY student_consents_candidate_read ON student_consents FOR SELECT
          USING (candidate_id = (SELECT current_candidate_id()))
        """
    )
    # ROSTER needs the code or invitation it names to admit this student to
    # this college. INDIVIDUAL is the student's own separate act, DIRECT, and
    # `guard_student_consent_insert` requires a live ROSTER link beside it.
    op.execute(
        """
        CREATE POLICY student_consents_candidate_grant ON student_consents FOR INSERT
          WITH CHECK (
            candidate_id = (SELECT current_candidate_id())
            AND revoked_at IS NULL
            AND CASE scope
                  WHEN 'ROSTER' THEN CASE granted_via
                      WHEN 'REFERRAL_CODE' THEN referral_code_admits(referral_code_id, tenant_id)
                      WHEN 'INVITE' THEN invitation_admits(roster_entry_id, tenant_id)
                      ELSE false
                    END
                  WHEN 'INDIVIDUAL' THEN granted_via = 'DIRECT'
                  ELSE false
                END
          )
        """
    )
    # Day 18. Revocation is the student's: their own live rows, to revoked.
    op.execute(
        """
        CREATE POLICY student_consents_candidate_revoke ON student_consents FOR UPDATE
          USING (candidate_id = (SELECT current_candidate_id()) AND revoked_at IS NULL)
          WITH CHECK (candidate_id = (SELECT current_candidate_id()) AND revoked_at IS NOT NULL)
        """
    )
    # **Institution-side bypass of student consent is prohibited** (SRS
    # 1.15.3). Permissive policies OR together, so the tenant policy alone
    # would let a college's own transaction INSERT a consent naming any
    # student, or revoke one. These RESTRICTIVE policies AND with everything
    # else: whatever the tenant policy allows, a consent is granted and
    # revoked only by the student it names. The cascade and seat triggers are
    # SECURITY DEFINER and are not subject to them.
    op.execute(
        """
        CREATE POLICY student_consents_only_the_student_grants ON student_consents
          AS RESTRICTIVE FOR INSERT
          WITH CHECK (candidate_id = (SELECT current_candidate_id()))
        """
    )
    op.execute(
        """
        CREATE POLICY student_consents_only_the_student_revokes ON student_consents
          AS RESTRICTIVE FOR UPDATE
          USING (candidate_id = (SELECT current_candidate_id()))
          WITH CHECK (candidate_id = (SELECT current_candidate_id()))
        """
    )
    op.execute(
        """
        CREATE POLICY college_seat_assignments_candidate_read ON college_seat_assignments
          FOR SELECT USING (candidate_id = (SELECT current_candidate_id()))
        """
    )
    op.execute(
        """
        CREATE POLICY colleges_candidate_linked ON colleges FOR SELECT
          USING (
            (SELECT current_candidate_id()) IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM student_consents sc WHERE sc.tenant_id = colleges.tenant_id
            )
          )
        """
    )

    # Seats.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_college_seat_assignment()
        RETURNS TRIGGER
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          v_seats college_seats%ROWTYPE;
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.released_at IS NOT NULL OR NEW.release_reason IS NOT NULL THEN
              RAISE EXCEPTION 'COLLEGE_SEAT_GUARD: a seat starts held'
                USING ERRCODE = 'check_violation';
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM student_consents sc
               WHERE sc.id = NEW.consent_id
                 AND sc.tenant_id = NEW.tenant_id
                 AND sc.candidate_id = NEW.candidate_id
                 AND sc.scope = 'ROSTER'
                 AND sc.revoked_at IS NULL
            ) THEN
              RAISE EXCEPTION 'COLLEGE_SEAT_GUARD: a seat needs the student''s live roster consent'
                USING ERRCODE = 'check_violation';
            END IF;
            SELECT * INTO v_seats FROM college_seats WHERE tenant_id = NEW.tenant_id FOR UPDATE;
            IF NOT FOUND OR v_seats.seats_used >= v_seats.seats_allocated THEN
              RAISE EXCEPTION 'COLLEGE_SEAT_GUARD: no seat is free'
                USING ERRCODE = 'check_violation';
            END IF;
            UPDATE college_seats SET seats_used = seats_used + 1, updated_at = now()
             WHERE tenant_id = NEW.tenant_id;
            RETURN NEW;
          END IF;

          IF NEW.tenant_id <> OLD.tenant_id OR NEW.candidate_id <> OLD.candidate_id
             OR NEW.consent_id <> OLD.consent_id OR NEW.assigned_at <> OLD.assigned_at THEN
            RAISE EXCEPTION 'COLLEGE_SEAT_GUARD: whose seat it is never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.released_at IS NOT NULL THEN
            RAISE EXCEPTION 'COLLEGE_SEAT_GUARD: a released seat stays released'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.released_at IS NOT NULL THEN
            UPDATE college_seats SET seats_used = seats_used - 1, updated_at = now()
             WHERE tenant_id = NEW.tenant_id;
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_college_seat_assignment
          BEFORE INSERT OR UPDATE ON college_seat_assignments
          FOR EACH ROW EXECUTE FUNCTION guard_college_seat_assignment();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION claim_college_seat(p_tenant_id uuid)
        RETURNS uuid
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          v_candidate uuid := (SELECT current_candidate_id());
          v_consent uuid;
          v_seat uuid;
          v_seats college_seats%ROWTYPE;
        BEGIN
          IF v_candidate IS NULL THEN
            RETURN NULL;
          END IF;
          SELECT id INTO v_seat FROM college_seat_assignments
           WHERE candidate_id = v_candidate AND released_at IS NULL;
          IF FOUND THEN
            -- One live seat per student. Theirs already, or another college's.
            RETURN (SELECT id FROM college_seat_assignments
                     WHERE id = v_seat AND tenant_id = p_tenant_id);
          END IF;
          SELECT id INTO v_consent FROM student_consents
           WHERE tenant_id = p_tenant_id AND candidate_id = v_candidate
             AND scope = 'ROSTER' AND revoked_at IS NULL;
          IF NOT FOUND THEN
            RETURN NULL;
          END IF;
          SELECT * INTO v_seats FROM college_seats WHERE tenant_id = p_tenant_id FOR UPDATE;
          IF NOT FOUND OR v_seats.seats_used >= v_seats.seats_allocated THEN
            RETURN NULL;
          END IF;
          INSERT INTO college_seat_assignments (id, tenant_id, candidate_id, consent_id)
          VALUES (gen_random_uuid(), p_tenant_id, v_candidate, v_consent)
          RETURNING id INTO v_seat;
          RETURN v_seat;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fill_college_seats(p_tenant_id uuid)
        RETURNS integer
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          v_free integer;
          v_filled integer := 0;
          r record;
        BEGIN
          SELECT seats_allocated - seats_used INTO v_free
            FROM college_seats WHERE tenant_id = p_tenant_id FOR UPDATE;
          IF NOT FOUND OR v_free <= 0 THEN
            RETURN 0;
          END IF;
          -- Linked longest first: the fairest order, and the one a student
          -- can predict.
          FOR r IN
            SELECT sc.id, sc.candidate_id
              FROM student_consents sc
              JOIN users u ON u.id = sc.candidate_id AND u.status = 'ACTIVE'
             WHERE sc.tenant_id = p_tenant_id
               AND sc.scope = 'ROSTER'
               AND sc.revoked_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM college_seat_assignments a
                  WHERE a.candidate_id = sc.candidate_id AND a.released_at IS NULL
               )
             ORDER BY sc.granted_at, sc.id
             LIMIT v_free
          LOOP
            INSERT INTO college_seat_assignments (id, tenant_id, candidate_id, consent_id)
            VALUES (gen_random_uuid(), p_tenant_id, r.candidate_id, r.id);
            v_filled := v_filled + 1;
          END LOOP;
          RETURN v_filled;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION candidate_has_college_seat(p_user_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1
              FROM college_seat_assignments a
              JOIN student_consents sc
                ON sc.id = a.consent_id AND sc.revoked_at IS NULL AND sc.scope = 'ROSTER'
              JOIN tenants t ON t.id = a.tenant_id AND t.status = 'ACTIVE'
              JOIN subscriptions s
                ON s.subscriber_type = 'TENANT'
               AND s.subscriber_id = a.tenant_id
               AND s.state IN ('ACTIVE', 'GRACE')
               AND s.current_period_start <= now()
               AND s.current_period_end > now()
             WHERE a.candidate_id = p_user_id
               AND a.released_at IS NULL
          )
        $$;
        """
    )

    # Consents.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_student_consent_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF OLD.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'CONSENT_GUARD: a revoked consent stays revoked'
              USING ERRCODE = 'check_violation';
          END IF;
          IF (NEW.id, NEW.tenant_id, NEW.candidate_id, NEW.scope, NEW.granted_at,
              NEW.granted_via, NEW.consent_version)
             IS DISTINCT FROM
             (OLD.id, OLD.tenant_id, OLD.candidate_id, OLD.scope, OLD.granted_at,
              OLD.granted_via, OLD.consent_version)
             OR NEW.referral_code_id IS DISTINCT FROM OLD.referral_code_id
             OR NEW.roster_entry_id IS DISTINCT FROM OLD.roster_entry_id THEN
            RAISE EXCEPTION 'CONSENT_GUARD: a consent is revoked, never rewritten'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_student_consent_write
          BEFORE UPDATE ON student_consents
          FOR EACH ROW EXECUTE FUNCTION guard_student_consent_write();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION release_seat_on_consent_revoke()
        RETURNS TRIGGER
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.scope = 'ROSTER' THEN
            UPDATE college_seat_assignments
               SET released_at = NEW.revoked_at, release_reason = 'CONSENT_REVOKED'
             WHERE consent_id = NEW.id AND released_at IS NULL;
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_release_seat_on_consent_revoke
          AFTER UPDATE OF revoked_at ON student_consents
          FOR EACH ROW EXECUTE FUNCTION release_seat_on_consent_revoke();
        """
    )
    # Day 18. INDIVIDUAL sits on a live ROSTER link, for every writer. The
    # link row is locked FOR SHARE, so a disconnect racing this grant either
    # commits first (and this refuses) or waits and then revokes the grant
    # through the cascade below -- never an INDIVIDUAL left without a link.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_student_consent_insert()
        RETURNS TRIGGER
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF NEW.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'CONSENT_GUARD: a consent starts live'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.scope = 'INDIVIDUAL' THEN
            PERFORM 1 FROM student_consents sc
             WHERE sc.tenant_id = NEW.tenant_id
               AND sc.candidate_id = NEW.candidate_id
               AND sc.scope = 'ROSTER'
               AND sc.revoked_at IS NULL
               FOR SHARE;
            IF NOT FOUND THEN
              RAISE EXCEPTION 'CONSENT_GUARD: individual visibility needs a live link to that college'
                USING ERRCODE = 'check_violation';
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_student_consent_insert
          BEFORE INSERT ON student_consents
          FOR EACH ROW EXECUTE FUNCTION guard_student_consent_insert();
        """
    )
    # Disconnecting ends individual visibility in the same statement
    # (`college.domain.scopes_revoked_with`), at the same instant.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION revoke_individual_with_roster()
        RETURNS TRIGGER
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.scope = 'ROSTER' THEN
            UPDATE student_consents
               SET revoked_at = NEW.revoked_at
             WHERE tenant_id = NEW.tenant_id
               AND candidate_id = NEW.candidate_id
               AND scope = 'INDIVIDUAL'
               AND revoked_at IS NULL;
          END IF;
          RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_revoke_individual_with_roster
          AFTER UPDATE OF revoked_at ON student_consents
          FOR EACH ROW EXECUTE FUNCTION revoke_individual_with_roster();
        """
    )

    # Roster rows.
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_roster_entry_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.invite_state IS NOT NULL THEN
              RAISE EXCEPTION 'ROSTER_GUARD: a committed roster row is never deleted'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN OLD;
          END IF;

          IF NEW.tenant_id <> OLD.tenant_id OR NEW.import_id <> OLD.import_id
             OR NEW.row_number <> OLD.row_number THEN
            RAISE EXCEPTION 'ROSTER_GUARD: a row stays where it was uploaded'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.invite_state IS NOT NULL AND (
               NEW.phone IS DISTINCT FROM OLD.phone OR NEW.email IS DISTINCT FROM OLD.email
               OR NEW.full_name IS DISTINCT FROM OLD.full_name
               OR NEW.student_ref IS DISTINCT FROM OLD.student_ref
               OR NEW.row_state IS DISTINCT FROM OLD.row_state
               OR NEW.issues IS DISTINCT FROM OLD.issues) THEN
            RAISE EXCEPTION 'ROSTER_GUARD: a committed row is not edited'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.invite_state IS DISTINCT FROM OLD.invite_state
             AND (COALESCE(OLD.invite_state, 'NONE'), COALESCE(NEW.invite_state, 'NONE'))
                 NOT IN ({invite_pairs}) THEN
            RAISE EXCEPTION 'ROSTER_GUARD: % -> % is not an invitation transition',
              OLD.invite_state, NEW.invite_state USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
            RAISE EXCEPTION 'ROSTER_GUARD: when an invitation was sent never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_roster_entry_write
          BEFORE UPDATE OR DELETE ON roster_entries
          FOR EACH ROW EXECUTE FUNCTION guard_roster_entry_write();
        """
    )


# ---------------------------------------------------------------------------
# Day 18 -- invariant 9: what a college reads about its students
# ---------------------------------------------------------------------------
#: A college's live, ROSTER-consented students: the only set a college may
#: count. **An INNER JOIN on the consent row, not a filter applied later**, so
#: a revoked consent is absent from the query itself (plan.md section 1, rule 9).
#: The tenant is the one bound from the caller's membership, never a parameter.
_ROSTER_COHORT_CTE = """
roster_cohort AS (
  SELECT sc.candidate_id
    FROM student_consents sc
    JOIN users u
      ON u.id = sc.candidate_id AND u.status = 'ACTIVE' AND u.pool = 'CANDIDATE'
   WHERE sc.tenant_id = (SELECT bound_college_tenant())
     AND sc.scope = 'ROSTER'
     AND sc.revoked_at IS NULL
)"""

#: Students a college may see as people: live INDIVIDUAL **and** live ROSTER
#: consent, both joined. The cascade keeps the two together; joining both
#: means a gap in the cascade would still show nobody.
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

#: Reached an interview: the application moved to INTERVIEW at some point.
_REACHED_INTERVIEW = """EXISTS (
    SELECT 1 FROM application_events e
     WHERE e.application_id = a.id AND e.to_stage = 'INTERVIEW'
  )"""

#: The newest score, for the INDIVIDUAL reads.
_LATEST_SCORE = """LEFT JOIN LATERAL (
              SELECT s.raw_value, s.computed_at, s.resume_version_id
                FROM scores s
               WHERE s.user_id = v.candidate_id
               ORDER BY s.computed_at DESC, s.id DESC
               LIMIT 1
            ) AS ls ON true"""

#: Every function a college reads a student through, and the consent CTE
#: each must join. `tests/invariants/test_invariant_09_consent.py` reads the
#: definitions back from `pg_proc` and fails on one that does not.
COLLEGE_STUDENT_READS: dict[str, str] = {
    "college_cohort_summary": "roster_cohort",
    "college_cohort_scores": "roster_cohort",
    "college_cohort_hires": "roster_cohort",
    "college_visible_students": "individually_visible",
    "college_student_profile": "individually_visible",
    "college_student_hires": "individually_visible",
}


def _create_college_student_reads() -> None:
    """Invariant 9: a college reads a student only through consent.

    Applications live under each *employer's* tenant, and a college's
    transaction binds the college's, so the tenant policies correctly show a
    college none of them. Rather than widen those policies, a college reads
    through these SECURITY DEFINER functions, each of which answers one
    question and **INNER JOINs live consent** for the college bound from the
    membership (`bound_college_tenant`). None takes a tenant id. Bound to an
    employer, a candidate, or nothing, they return no rows.

    **Aggregates return no identifiers.** `college_cohort_scores` and
    `college_cohort_hires` return one row per student or hire with nothing
    saying whose, so the cohort floor and cell suppression (`analytics.domain`)
    are applied to values that cannot be joined back to a person. Only the
    three INDIVIDUAL functions return a candidate id or a name.
    """
    op.execute(
        """
        CREATE OR REPLACE FUNCTION bound_college_tenant()
        RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          SELECT t.id
            FROM tenants t
           WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND t.type = 'COLLEGE'
             AND t.status = 'ACTIVE'
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_cohort_summary()
        RETURNS TABLE (
          connected bigint, individually_visible bigint, scored bigint,
          applicants bigint, applications bigint, interviews bigint, hires bigint
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_ROSTER_COHORT_CTE}, {_INDIVIDUALLY_VISIBLE_CTE},
          cohort_applications AS (
            SELECT a.id, a.candidate_id, a.stage
              FROM applications a
              JOIN roster_cohort c ON c.candidate_id = a.candidate_id
          )
          SELECT
            (SELECT count(*) FROM roster_cohort),
            (SELECT count(*) FROM individually_visible),
            (SELECT count(DISTINCT s.user_id)
               FROM scores s JOIN roster_cohort c ON c.candidate_id = s.user_id),
            (SELECT count(DISTINCT candidate_id) FROM cohort_applications),
            (SELECT count(*) FROM cohort_applications),
            (SELECT count(*) FROM cohort_applications a WHERE {_REACHED_INTERVIEW}),
            (SELECT count(*) FROM cohort_applications WHERE stage = 'HIRED')
           WHERE (SELECT bound_college_tenant()) IS NOT NULL
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_cohort_scores()
        RETURNS TABLE (stored_score integer)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_ROSTER_COHORT_CTE}
          SELECT latest.raw_value
            FROM (
                  SELECT DISTINCT ON (s.user_id) s.user_id, s.raw_value
                    FROM scores s
                    JOIN roster_cohort c ON c.candidate_id = s.user_id
                   ORDER BY s.user_id, s.computed_at DESC, s.id DESC
                 ) AS latest
        $$;
        """
    )
    # A hire is platform-sourced by construction: an application on this
    # platform that both sides confirmed (SRS 1.13.3). A disputed or
    # unconfirmed hire is not HIRED and is not counted (blockers E12).
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_cohort_hires()
        RETURNS TABLE (hired_at timestamptz, job_location text)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_ROSTER_COHORT_CTE}
          SELECT a.candidate_confirmed_at, j.location
            FROM applications a
            JOIN roster_cohort c ON c.candidate_id = a.candidate_id
            JOIN jobs j ON j.id = a.job_id
           WHERE a.stage = 'HIRED'
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_visible_students(
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
          SELECT v.candidate_id, v.consent_id, v.visible_since, p.full_name, ls.resume_version_id
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
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_student_profile(p_candidate_id uuid)
        RETURNS TABLE (
          candidate_id uuid, consent_id uuid, visible_since timestamptz, full_name text,
          stored_score integer, scored_at timestamptz, score_resume_version_id uuid,
          applications bigint, interviews bigint, hires bigint
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT v.candidate_id, v.consent_id, v.visible_since, p.full_name,
                 ls.raw_value, ls.computed_at, ls.resume_version_id,
                 (SELECT count(*) FROM applications a WHERE a.candidate_id = v.candidate_id),
                 (SELECT count(*) FROM applications a
                   WHERE a.candidate_id = v.candidate_id AND {_REACHED_INTERVIEW}),
                 (SELECT count(*) FROM applications a
                   WHERE a.candidate_id = v.candidate_id AND a.stage = 'HIRED')
            FROM individually_visible v
            LEFT JOIN candidate_profiles p ON p.user_id = v.candidate_id
            {_LATEST_SCORE}
           WHERE v.candidate_id = p_candidate_id
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_student_hires(p_candidate_id uuid)
        RETURNS TABLE (job_title text, employer_name text, hired_at timestamptz)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT j.title, e.legal_name, a.candidate_confirmed_at
            FROM individually_visible v
            JOIN applications a ON a.candidate_id = v.candidate_id AND a.stage = 'HIRED'
            JOIN jobs j ON j.id = a.job_id
            JOIN employers e ON e.tenant_id = a.tenant_id
           WHERE v.candidate_id = p_candidate_id
           ORDER BY a.candidate_confirmed_at DESC
        $$;
        """
    )


# ---------------------------------------------------------------------------
# Day 19 -- platform staff, suspension, disputes
# ---------------------------------------------------------------------------
def _create_platform_access() -> None:
    """Our own staff, stopping an organisation, and the dispute queue.

    **Staff are members of the one PLATFORM tenant** (blockers E10). That kept
    `memberships.tenant_id` NOT NULL and the single-membership rule intact,
    and it makes one new thing dangerous: a staff role in any other tenant,
    or an employer role in ours. `guard_membership_tenant_type` refuses both,
    for every writer, generated from `identity.domain.ROLE_TENANT_TYPE`.

    **A suspension is a row, and the tenant's status follows it.**
    `guard_tenant_suspension_write` refuses a suspension of anything but an
    employer or a college, keeps what was suspended and why immutable, makes
    lifting a latch, and mirrors the open row onto `tenants.status` in the
    same statement. `guard_tenant_status` holds the other direction: no writer
    marks a tenant SUSPENDED without an open suspension, or ACTIVE with one.
    Every check that already reads `tenants.status = 'ACTIVE'` -- the college
    functions, the seat limb -- therefore stops with the suspension, and so
    now do the job board and applying.

    **`platform_tenant_bound()`** is the staff equivalent of
    `current_candidate_id()`: true only when the transaction's bound tenant
    is the PLATFORM tenant, which only a staff membership can bind. The
    dispute policy for staff reads it.
    """
    from app.modules.admin.domain import DISPUTE_TRANSITIONS
    from app.modules.identity.domain import ROLE_TENANT_TYPE

    role_pairs = ", ".join(f"('{r}', '{t}')" for r, t in sorted(ROLE_TENANT_TYPE.items()))
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_membership_tenant_type()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          t_type text;
        BEGIN
          SELECT type INTO t_type FROM tenants WHERE id = NEW.tenant_id;
          IF (NEW.role, t_type) NOT IN ({role_pairs}) THEN
            RAISE EXCEPTION 'MEMBERSHIP_GUARD: % cannot be held in a % tenant',
              NEW.role, t_type USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_membership_tenant_type
          BEFORE INSERT OR UPDATE OF role, tenant_id ON memberships
          FOR EACH ROW EXECUTE FUNCTION guard_membership_tenant_type()
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_tenant_status()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          open_suspension boolean;
        BEGIN
          IF TG_OP = 'UPDATE' AND NEW.type <> OLD.type THEN
            RAISE EXCEPTION 'TENANT_GUARD: a tenant never changes type'
              USING ERRCODE = 'check_violation';
          END IF;
          IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
            RETURN NEW;
          END IF;
          SELECT EXISTS (
            SELECT 1 FROM tenant_suspensions s
             WHERE s.tenant_id = NEW.id AND s.lifted_at IS NULL
          ) INTO open_suspension;
          IF (NEW.status = 'SUSPENDED') <> open_suspension THEN
            RAISE EXCEPTION 'TENANT_GUARD: status SUSPENDED follows an open suspension, and only one'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_tenant_status
          BEFORE INSERT OR UPDATE ON tenants
          FOR EACH ROW EXECUTE FUNCTION guard_tenant_status()
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION guard_tenant_suspension_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          t_type text;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            -- The app role holds no DELETE; this is a migrator's repair.
            IF OLD.lifted_at IS NULL THEN
              UPDATE tenants SET status = 'ACTIVE', updated_at = now()
               WHERE id = OLD.tenant_id AND status = 'SUSPENDED';
            END IF;
            RETURN OLD;
          END IF;

          IF TG_OP = 'INSERT' THEN
            SELECT type INTO t_type FROM tenants WHERE id = NEW.tenant_id;
            IF t_type IS DISTINCT FROM 'EMPLOYER' AND t_type IS DISTINCT FROM 'COLLEGE' THEN
              RAISE EXCEPTION 'SUSPENSION_GUARD: only an employer or a college can be suspended'
                USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.lifted_at IS NOT NULL THEN
              RAISE EXCEPTION 'SUSPENSION_GUARD: a suspension starts open'
                USING ERRCODE = 'check_violation';
            END IF;
            UPDATE tenants SET status = 'SUSPENDED', updated_at = now()
             WHERE id = NEW.tenant_id AND status <> 'SUSPENDED';
            RETURN NEW;
          END IF;

          IF NEW.tenant_id <> OLD.tenant_id OR NEW.reason <> OLD.reason
             OR NEW.suspended_by <> OLD.suspended_by
             OR NEW.suspended_at <> OLD.suspended_at THEN
            RAISE EXCEPTION 'SUSPENSION_GUARD: what was suspended, why and by whom never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.lifted_at IS NOT NULL
             AND (NEW.lifted_at IS DISTINCT FROM OLD.lifted_at
                  OR NEW.lifted_by IS DISTINCT FROM OLD.lifted_by) THEN
            RAISE EXCEPTION 'SUSPENSION_GUARD: lifting a suspension is a latch'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL THEN
            UPDATE tenants SET status = 'ACTIVE', updated_at = now()
             WHERE id = NEW.tenant_id AND status = 'SUSPENDED';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    # AFTER, so the suspension row is visible to `guard_tenant_status` when
    # the tenant is marked, and so an ON CONFLICT DO NOTHING that skips the
    # insert marks nothing.
    op.execute(
        """
        CREATE TRIGGER trg_guard_tenant_suspension_write
          AFTER INSERT OR UPDATE OR DELETE ON tenant_suspensions
          FOR EACH ROW EXECUTE FUNCTION guard_tenant_suspension_write()
        """
    )
    op.execute(f"REVOKE DELETE ON tenant_suspensions FROM {APP_ROLE}")
    op.execute(f"REVOKE UPDATE ON tenant_suspensions FROM {APP_ROLE}")
    op.execute(f"GRANT UPDATE (lifted_at, lifted_by) ON tenant_suspensions TO {APP_ROLE}")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION platform_tenant_bound()
        RETURNS boolean
        LANGUAGE sql STABLE
        SET search_path = public, pg_temp
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM tenants t
             WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
               AND t.type = 'PLATFORM'
               AND t.status = 'ACTIVE'
          )
        $$;
        """
    )

    # Disputes. The tenant policy (TENANT_SCOPED_TABLES) lets an employer or a
    # college read and raise its own; these add the candidate and our staff.
    op.execute(
        """
        CREATE POLICY disputes_candidate_read ON disputes FOR SELECT
          USING (tenant_id IS NULL AND raised_by = (SELECT current_candidate_id()))
        """
    )
    op.execute(
        """
        CREATE POLICY disputes_candidate_raise ON disputes FOR INSERT
          WITH CHECK (
            tenant_id IS NULL
            AND party = 'CANDIDATE'
            AND raised_by = (SELECT current_candidate_id())
          )
        """
    )
    op.execute(
        """
        CREATE POLICY disputes_platform_staff ON disputes FOR ALL
          USING ((SELECT platform_tenant_bound()))
          WITH CHECK ((SELECT platform_tenant_bound()))
        """
    )

    pairs = ", ".join(f"('{a}', '{b}')" for a, b in sorted(DISPUTE_TRANSITIONS))
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_dispute_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.state <> 'OPEN' OR NEW.assigned_to IS NOT NULL
               OR NEW.resolved_at IS NOT NULL THEN
              RAISE EXCEPTION 'DISPUTE_GUARD: a dispute starts OPEN and unassigned'
                USING ERRCODE = 'check_violation';
            END IF;
            -- Read under the writer's own row-level security: a candidate
            -- sees their applications, an employer its tenant's, and nobody
            -- can name one they cannot see.
            IF NEW.application_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM applications WHERE id = NEW.application_id) THEN
              RAISE EXCEPTION 'DISPUTE_GUARD: the application is not the raiser''s'
                USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.party <> 'CANDIDATE' AND NOT EXISTS (
                 SELECT 1 FROM memberships m JOIN tenants t ON t.id = m.tenant_id
                  WHERE m.user_id = NEW.raised_by AND m.tenant_id = NEW.tenant_id
                    AND m.status = 'ACTIVE' AND t.type = NEW.party) THEN
              RAISE EXCEPTION 'DISPUTE_GUARD: the raiser is not a member of that organisation'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF OLD.state IN ('RESOLVED', 'REJECTED') THEN
            RAISE EXCEPTION 'DISPUTE_GUARD: a closed dispute never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.kind <> OLD.kind OR NEW.party <> OLD.party OR NEW.source <> OLD.source
             OR NEW.raised_by <> OLD.raised_by
             OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
             OR NEW.application_id IS DISTINCT FROM OLD.application_id
             OR NEW.description <> OLD.description OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'DISPUTE_GUARD: what was raised, and by whom, never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          -- Only our staff work a dispute. The permissive tenant policy lets
          -- an organisation UPDATE its own rows; this is what stops it
          -- closing them.
          IF NOT platform_tenant_bound() THEN
            RAISE EXCEPTION 'DISPUTE_GUARD: only platform staff work a dispute'
              USING ERRCODE = 'insufficient_privilege';
          END IF;
          IF NEW.state <> OLD.state AND (OLD.state, NEW.state) NOT IN ({pairs}) THEN
            RAISE EXCEPTION 'DISPUTE_GUARD: % -> % is not a dispute transition',
              OLD.state, NEW.state USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_dispute_write
          BEFORE INSERT OR UPDATE ON disputes
          FOR EACH ROW EXECUTE FUNCTION guard_dispute_write()
        """
    )
    op.execute(f"REVOKE DELETE ON disputes FROM {APP_ROLE}")

    # Notifications. "Were they told?" must stay answerable: a message row is
    # never deleted, and after it is written only its delivery can change --
    # never who it was for or what it said. A nudge is a count the cadence cap
    # reads, so it is insert-only; a suppression is lifted, never removed.
    op.execute(f"REVOKE UPDATE, DELETE ON notifications FROM {APP_ROLE}")
    op.execute(
        "GRANT UPDATE (state, skip_reason, failure_code, provider, provider_ref, sent_at, "
        f"read_at) ON notifications TO {APP_ROLE}"
    )
    op.execute(f"REVOKE UPDATE, DELETE ON profile_nudges FROM {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE ON notification_suppressions FROM {APP_ROLE}")
    op.execute(f"GRANT UPDATE (lifted_at) ON notification_suppressions TO {APP_ROLE}")


# ---------------------------------------------------------------------------
# Day 20 -- the right to be forgotten, and the carve-out under it
# ---------------------------------------------------------------------------
def _create_privacy_access() -> None:
    """Erasure is one SECURITY DEFINER function, and a guard over the request.

    **Why the cascade is not Python.** The application role deliberately holds
    no DELETE on `scores`, `course_completions`, `device_checks` or
    `application_events`: that is invariant 3 and the append-only event logs,
    and `test_scores_are_insert_only` proves the grant rather than trusting
    it. Granting DELETE so an erasure task could run as the app role would
    trade one legal requirement for another. So `erase_candidate` runs as its
    owner -- the migrator -- and is the only thing on the platform that may
    destroy a score.

    **Why it is one statement.** Half an erasure is not a smaller erasure, it
    is a corrupt account: a candidate with no CV and a live search document,
    or scores with no resume to replay them from. One function, one
    transaction, one manifest.

    **Why the order is what it is.** Children before parents, because most of
    these foreign keys are NO ACTION rather than CASCADE -- deliberately, so
    that nothing deletes a person's history as a side effect of something
    else. Two steps are worth reading twice:

      * **The seat is released, not deleted.** `seats_used` is the seat
        guard's, and it only ever moves through that guard. Deleting an
        assignment row would leave a college's count one too high forever, so
        the erasure releases the seat the ordinary way and then removes the
        row -- the college gets its seat back, which is also the fair answer.
      * **The extraction cache is content-addressed and shared.** A key is
        deleted only when no other candidate's score still names it, which is
        why `scores.extraction_cache_key` exists at all: without it the
        model's reading of a person's career survives their erasure, in a
        table with no column linking it to them.

    `users` is emptied rather than deleted. It is the anchor every retained
    payment and audit row points at, and an id pointing at a row with no
    phone, no email and no Cognito link identifies nobody -- which is the
    non-reversible pseudonymisation of answers-log 7.4, done once instead of
    rewritten across an append-only trail we are forbidden to touch.

    **`dsr_requests` is deliberately not under RLS**, for the same reason
    `application_events` is not: the deletion sweep is a system transaction
    binding neither a tenant nor a user, and a policy loose enough to admit it
    would be loose enough to admit a forgotten binding. Reads are scoped in
    the predicate instead -- every repository function that returns a request
    takes a `user_id`, and `tests/invariants/test_erasure_plan.py` asserts
    there is no unscoped reader.
    """
    from app.modules.privacy.domain import STATE_TRANSITIONS

    pairs = ", ".join(
        f"('{src}', '{dst}')"
        for src, targets in sorted(STATE_TRANSITIONS.items())
        for dst in sorted(targets)
    )

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_dsr_request_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $fn$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            IF NEW.state <> 'RECEIVED' OR NEW.completed_at IS NOT NULL
               OR NEW.manifest IS NOT NULL THEN
              RAISE EXCEPTION 'DSR_GUARD: a request starts RECEIVED and has finished nothing'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF NEW.user_id <> OLD.user_id OR NEW.type <> OLD.type
             OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'DSR_GUARD: whose request it is, and what was asked, never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          -- A latch. "We deleted your data" can never be un-said, and neither
          -- can "we refused", which is the sentence somebody appeals against.
          IF OLD.completed_at IS NOT NULL
             AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
            RAISE EXCEPTION 'DSR_GUARD: a finished request stays finished'
              USING ERRCODE = 'check_violation';
          END IF;
          IF OLD.state IN ('COMPLETED', 'REJECTED') AND NEW.state <> OLD.state THEN
            RAISE EXCEPTION 'DSR_GUARD: % is terminal', OLD.state
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.state <> OLD.state AND (OLD.state, NEW.state) NOT IN ({pairs}) THEN
            RAISE EXCEPTION 'DSR_GUARD: % -> % is not a request transition',
              OLD.state, NEW.state USING ERRCODE = 'check_violation';
          END IF;
          -- The manifest is the evidence. Written once, with the completion.
          IF OLD.manifest IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest THEN
            RAISE EXCEPTION 'DSR_GUARD: a recorded manifest never changes'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $fn$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_guard_dsr_request_write
          BEFORE INSERT OR UPDATE ON dsr_requests
          FOR EACH ROW EXECUTE FUNCTION guard_dsr_request_write()
        """
    )
    # The record that somebody asked to be forgotten, and that we did it, is
    # the evidence we complied. It is not the thing being forgotten.
    op.execute(f"REVOKE DELETE ON dsr_requests FROM {APP_ROLE}")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION erase_candidate(p_user_id uuid, p_policy_version text)
        RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $fn$
        DECLARE
          m jsonb := '{}'::jsonb;
          n integer;
        BEGIN
          IF p_policy_version IS NULL OR p_policy_version = '' THEN
            RAISE EXCEPTION 'ERASURE: refusing to erase under no stated policy'
              USING ERRCODE = 'check_violation';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM users WHERE id = p_user_id AND pool = 'CANDIDATE'
          ) THEN
            -- A business account is entangled with an organisation that
            -- outlives it: erasing the last owner of an employer strands the
            -- tenant, its jobs and its staff. Those go through support until
            -- somebody decides what happens to the organisation (blockers B3).
            RAISE EXCEPTION 'ERASURE: only a candidate account is erased this way'
              USING ERRCODE = 'check_violation';
          END IF;

          -- The employer-facing projection first: it is written by a trigger
          -- on `scores`, so deleting the scores alone would leave the card.
          DELETE FROM candidate_search_documents WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('candidate_search_documents', n);

          DELETE FROM integrity_signals WHERE candidate_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('integrity_signals', n);
          DELETE FROM integrity_checks WHERE candidate_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('integrity_checks', n);

          -- Shared and content-addressed, so a key goes only when this person
          -- is the last one whose score names it.
          DELETE FROM resume_extractions re
           WHERE re.cache_key IN (
                   SELECT s.extraction_cache_key FROM scores s
                    WHERE s.user_id = p_user_id AND s.extraction_cache_key IS NOT NULL)
             AND NOT EXISTS (
                   SELECT 1 FROM scores s2
                    WHERE s2.extraction_cache_key = re.cache_key
                      AND s2.user_id <> p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('resume_extractions', n);

          DELETE FROM scores WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('scores', n);

          DELETE FROM resume_versions WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('resume_versions', n);
          DELETE FROM resume_files WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('resume_files', n);

          -- A dispute about one of these applications goes with it, whoever
          -- raised it: it exists to be read beside the application.
          DELETE FROM disputes
           WHERE raised_by = p_user_id
              OR application_id IN (SELECT id FROM applications WHERE candidate_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('disputes', n);
          DELETE FROM application_events
           WHERE application_id IN (SELECT id FROM applications WHERE candidate_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('application_events', n);
          DELETE FROM applications WHERE candidate_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('applications', n);

          DELETE FROM interview_evaluations
           WHERE session_id IN (SELECT id FROM interview_sessions WHERE user_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('interview_evaluations', n);
          DELETE FROM interview_transcripts
           WHERE session_id IN (SELECT id FROM interview_sessions WHERE user_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('interview_transcripts', n);
          DELETE FROM interview_answers
           WHERE session_id IN (SELECT id FROM interview_sessions WHERE user_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('interview_answers', n);
          DELETE FROM interview_sessions WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('interview_sessions', n);
          DELETE FROM interview_checkout_notices WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('interview_checkout_notices', n);
          DELETE FROM device_checks WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('device_checks', n);

          DELETE FROM course_completions WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('course_completions', n);
          DELETE FROM entitlements WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('entitlements', n);

          DELETE FROM questionnaire_responses WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('questionnaire_responses', n);
          DELETE FROM streak_point_events WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('streak_point_events', n);
          DELETE FROM user_streaks WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('user_streaks', n);

          -- Released through the guard, then removed: `seats_used` only ever
          -- moves through that guard, and a deleted row would leave a college
          -- one seat short forever.
          UPDATE college_seat_assignments
             SET released_at = now(), release_reason = 'ERASURE'
           WHERE candidate_id = p_user_id AND released_at IS NULL;
          DELETE FROM college_seat_assignments WHERE candidate_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('college_seat_assignments', n);
          DELETE FROM student_consents WHERE candidate_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('student_consents', n);

          DELETE FROM profile_nudges WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('profile_nudges', n);
          DELETE FROM notification_suppressions WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('notification_suppressions', n);
          DELETE FROM notification_preferences WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('notification_preferences', n);
          DELETE FROM notifications WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('notifications', n);

          DELETE FROM candidate_profiles WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('candidate_profiles', n);
          DELETE FROM memberships WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('memberships', n);

          -- The anchor. Emptied, never dropped: `payments`, `audit_events`
          -- and `candidate_view_events` still point here, and they are the
          -- carve-out the client confirmed (answers-log 7.4, Round 10.2).
          --
          -- The subject is replaced by its SHA-256, not nulled. A token
          -- issued before the erasure stays cryptographically valid until it
          -- expires, and with a NULL here sign-in would find no row for it
          -- and create a fresh account from the erased person's credential.
          -- The hash cannot be turned back into the subject; sign-in hashes
          -- the presented one and refuses a match as `account_inactive`.
          UPDATE users
             SET phone = NULL, email = NULL,
                 cognito_sub = encode(sha256(convert_to(cognito_sub, 'UTF8')), 'hex'),
                 status = 'DELETED', locale = 'en', updated_at = now()
           WHERE id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('users', n);

          RETURN m;
        END;
        $fn$;
        """
    )
    op.execute("REVOKE ALL ON FUNCTION erase_candidate(uuid, text) FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION erase_candidate(uuid, text) TO {APP_ROLE}")
