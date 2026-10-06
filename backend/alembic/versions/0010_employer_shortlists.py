"""The shortlist: an employer keeps a candidate from search, or invites them to a job.

An employer who has opened a candidate can **save** them (private to the
organisation) or **invite** them to one published job. The pipeline is made of
applications, and an application is the candidate's act, so an invitation is
a question: only the candidate's yes files an application -- which then lands
at SHORTLISTED, the employer's choice already made (`applications.domain`).

* `employer_shortlists` -- one row per organisation, candidate and job (one
  SAVED row with no job). Tenant RLS, plus two candidate policies: a candidate
  reads their invitations, never a SAVED row, and may decline one.
* `guard_shortlist_write` -- the states for every writer, generated from
  `applications.domain.SHORTLIST_MOVES`. Only a SAVED row is ever deleted.
* `accept_shortlist_invitation` -- the candidate's yes, in one transaction:
  the application filed (or found), walked SUBMITTED -> VIEWED -> SHORTLISTED,
  and the invitation marked ACCEPTED. SECURITY DEFINER because the
  application guard lets a candidate's transaction move no stage but its own
  withdraw and confirm; for the two employer stages it binds neither party,
  so the guard still holds its transition list and latches, and it records
  them as the inviting employer's.
* `erase_candidate` -- replaced whole: 0007's, plus `employer_shortlists`.

The baseline builds the table and its tenant policy from the current models
too, so on a database built from it they already exist: the table is created
only when missing and the policy is dropped and made again. The rest is
written either way.

Revision ID: 0010_employer_shortlists
Revises: 0009_candidate_profile_views
Create Date: 2026-10-05
"""

from __future__ import annotations

import importlib.util
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_employer_shortlists"
down_revision: str | None = "0009_candidate_profile_views"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "bharatpath_app"
TABLE = "employer_shortlists"

#: `applications.domain.SHORTLIST_STATUSES`, frozen here as SQL.
STATUSES = ("SAVED", "INVITED", "ACCEPTED", "DECLINED", "CANCELLED")
#: `applications.domain.SHORTLIST_MOVES`, frozen here. A test holds the two equal.
MOVES = {
    ("INVITED", "ACCEPTED"): "CANDIDATE",
    ("INVITED", "DECLINED"): "CANDIDATE",
    ("INVITED", "CANCELLED"): "EMPLOYER",
    ("CANCELLED", "INVITED"): "EMPLOYER",
}
#: `applications.domain.TERMINAL_STAGES`.
_TERMINAL = "'HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'"


def upgrade() -> None:
    _create_table()
    _row_level_security()
    _guard()
    _accept_function()
    _replace_erasure()


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS accept_shortlist_invitation(uuid)")
    op.execute(f"DROP TRIGGER IF EXISTS trg_guard_shortlist_write ON {TABLE}")
    op.execute("DROP FUNCTION IF EXISTS guard_shortlist_write()")
    op.execute(_previous_erasure().ERASE_WITH_ACTIVITY_DAYS)
    op.drop_table(TABLE, if_exists=True)


# ---------------------------------------------------------------------------
def _create_table() -> None:
    if not sa.inspect(op.get_bind()).has_table(TABLE):
        statuses = ", ".join(f"'{s}'" for s in STATUSES)
        op.create_table(
            TABLE,
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "candidate_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("job_id", postgresql.UUID(as_uuid=True)),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column(
                "created_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column(
                "application_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("applications.id", ondelete="SET NULL"),
            ),
            sa.Column("answered_at", sa.DateTime(timezone=True)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(f"status IN ({statuses})", name="ck_shortlists_status"),
            sa.CheckConstraint("(job_id IS NULL) = (status = 'SAVED')", name="ck_shortlists_job"),
            sa.CheckConstraint(
                "(answered_at IS NOT NULL) = (status IN ('ACCEPTED', 'DECLINED'))",
                name="ck_shortlists_answered",
            ),
            sa.CheckConstraint(
                "application_id IS NULL OR status = 'ACCEPTED'",
                name="ck_shortlists_application",
            ),
            sa.ForeignKeyConstraint(
                ["job_id", "tenant_id"],
                ["jobs.id", "jobs.tenant_id"],
                name="fk_shortlists_job_tenant",
                ondelete="CASCADE",
            ),
        )
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS uq_shortlists_entry ON {TABLE} "
        "(tenant_id, candidate_id, job_id) NULLS NOT DISTINCT"
    )
    for name, columns in (
        ("ix_shortlists_tenant_created", "tenant_id, created_at, id"),
        ("ix_shortlists_candidate", "candidate_id, created_at"),
        ("ix_shortlists_job", "job_id, tenant_id"),
        ("ix_employer_shortlists_tenant_id", "tenant_id"),
    ):
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {TABLE} ({columns})")
    op.execute(
        f"CREATE INDEX IF NOT EXISTS ix_shortlists_application ON {TABLE} (application_id) "
        "WHERE application_id IS NOT NULL"
    )


def _row_level_security() -> None:
    """The baseline's tenant policy, and two for the candidate.

    A candidate reads an invitation addressed to them, **never a SAVED row**:
    that an organisation keeps someone in a private list is the
    organisation's business. Their one write is a decline; accepting files an
    application and goes through the function below.
    """
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    for policy in (
        f"{TABLE}_tenant_isolation",
        f"{TABLE}_candidate_read",
        f"{TABLE}_candidate_decline",
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {TABLE}")
    op.execute(
        f"""
        CREATE POLICY {TABLE}_tenant_isolation ON {TABLE}
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute(
        f"""
        CREATE POLICY {TABLE}_candidate_read ON {TABLE} FOR SELECT
          USING (candidate_id = (SELECT current_candidate_id()) AND status <> 'SAVED')
        """
    )
    op.execute(
        f"""
        CREATE POLICY {TABLE}_candidate_decline ON {TABLE} FOR UPDATE
          USING (candidate_id = (SELECT current_candidate_id()) AND status = 'INVITED')
          WITH CHECK (candidate_id = (SELECT current_candidate_id()) AND status = 'DECLINED')
        """
    )


def _guard() -> None:
    """The states, for every writer, told apart by what is bound -- as the
    application guard does. A transaction binding neither (the migrator, the
    accept function) is held to the transitions and the immutable columns."""
    moves = "\n".join(
        f"            WHEN OLD.status = '{a}' AND NEW.status = '{b}' THEN '{who}'"
        for (a, b), who in sorted(MOVES.items())
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION guard_shortlist_write()
        RETURNS TRIGGER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          tenant_bound boolean := NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL;
          candidate_bound boolean := NOT tenant_bound
            AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL;
          mover text;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status <> 'SAVED' THEN
              RAISE EXCEPTION 'SHORTLIST_GUARD: an invitation is cancelled, never deleted'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN OLD;
          END IF;

          IF TG_OP = 'INSERT' THEN
            IF NEW.status NOT IN ('SAVED', 'INVITED')
               OR NEW.application_id IS NOT NULL OR NEW.answered_at IS NOT NULL THEN
              RAISE EXCEPTION 'SHORTLIST_GUARD: a shortlist row starts SAVED or INVITED'
                USING ERRCODE = 'check_violation';
            END IF;
            IF candidate_bound THEN
              RAISE EXCEPTION 'SHORTLIST_GUARD: a candidate does not shortlist'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          IF NEW.tenant_id <> OLD.tenant_id OR NEW.candidate_id <> OLD.candidate_id
             OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.created_by <> OLD.created_by
             OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'SHORTLIST_GUARD: a shortlist row is never refiled'
              USING ERRCODE = 'check_violation';
          END IF;

          IF NEW.status = OLD.status THEN
            -- Only the foreign key's own SET NULL may touch the link unmoved.
            IF NEW.answered_at IS DISTINCT FROM OLD.answered_at
               OR (NEW.application_id IS DISTINCT FROM OLD.application_id
                   AND NEW.application_id IS NOT NULL) THEN
              RAISE EXCEPTION 'SHORTLIST_GUARD: an answer is a latch'
                USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
          END IF;

          mover := CASE
{moves}
          END;
          IF mover IS NULL THEN
            RAISE EXCEPTION 'SHORTLIST_GUARD: % -> % is not a shortlist transition',
              OLD.status, NEW.status USING ERRCODE = 'check_violation';
          END IF;
          IF (tenant_bound AND mover <> 'EMPLOYER') OR (candidate_bound AND mover <> 'CANDIDATE')
          THEN
            RAISE EXCEPTION 'SHORTLIST_GUARD: % -> % is not this party''s move',
              OLD.status, NEW.status USING ERRCODE = 'check_violation';
          END IF;
          IF candidate_bound AND NEW.status = 'ACCEPTED' THEN
            RAISE EXCEPTION 'SHORTLIST_GUARD: accepting files an application; use the function'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(f"DROP TRIGGER IF EXISTS trg_guard_shortlist_write ON {TABLE}")
    op.execute(
        f"""
        CREATE TRIGGER trg_guard_shortlist_write
          BEFORE INSERT OR UPDATE OR DELETE ON {TABLE}
          FOR EACH ROW EXECUTE FUNCTION guard_shortlist_write();
        """
    )


def _accept_function() -> None:
    """The candidate's yes. Returns the application's id; NULL when there is
    no invitation of theirs by that id. Raises `SHORTLIST_NOT_PENDING` for a
    declined or cancelled one, `SHORTLIST_JOB_CLOSED` when the job left the
    board. An application the candidate already has for the job is used, and
    walked forward only as far as SHORTLISTED.

    It reads `current_candidate_id()` and takes no candidate id, so it can
    only ever accept for the candidate the transaction is bound to.
    """
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION accept_shortlist_invitation(p_shortlist_id uuid)
        RETURNS uuid
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $fn$
        DECLARE
          v_candidate uuid := (SELECT current_candidate_id());
          v_user text := current_setting('app.user_id', true);
          v_row {TABLE}%ROWTYPE;
          v_app uuid;
          v_stage text;
        BEGIN
          IF v_candidate IS NULL THEN
            RAISE EXCEPTION 'SHORTLIST_GUARD: only the invited candidate accepts'
              USING ERRCODE = 'insufficient_privilege';
          END IF;
          SELECT * INTO v_row FROM {TABLE}
           WHERE id = p_shortlist_id AND candidate_id = v_candidate AND status <> 'SAVED'
           FOR UPDATE;
          IF NOT FOUND THEN
            RETURN NULL;
          END IF;
          IF v_row.status = 'ACCEPTED' THEN
            RETURN v_row.application_id;
          END IF;
          IF v_row.status <> 'INVITED' THEN
            RAISE EXCEPTION 'SHORTLIST_NOT_PENDING' USING ERRCODE = 'check_violation';
          END IF;
          IF NOT job_accepts_applications(v_row.job_id) THEN
            RAISE EXCEPTION 'SHORTLIST_JOB_CLOSED' USING ERRCODE = 'check_violation';
          END IF;

          -- Neither party bound from here: the application guard holds its
          -- transitions and latches, and these writes are this function's.
          PERFORM set_config('app.user_id', '', true);

          SELECT id, stage INTO v_app, v_stage FROM applications
           WHERE job_id = v_row.job_id AND candidate_id = v_candidate
             AND stage NOT IN ({_TERMINAL})
           FOR UPDATE;
          IF v_app IS NULL THEN
            INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage)
            VALUES (gen_random_uuid(), v_row.tenant_id, v_row.job_id, v_candidate, 'SUBMITTED')
            RETURNING id INTO v_app;
            v_stage := 'SUBMITTED';
            INSERT INTO application_events
                   (id, application_id, kind, from_stage, to_stage, actor_type, actor_id)
            VALUES (gen_random_uuid(), v_app, 'STAGE_CHANGED', NULL, 'SUBMITTED',
                    'CANDIDATE', v_candidate);
          END IF;
          IF v_stage = 'SUBMITTED' THEN
            UPDATE applications SET stage = 'VIEWED', employer_active_at = now(),
                   updated_at = now()
             WHERE id = v_app;
            INSERT INTO application_events
                   (id, application_id, kind, from_stage, to_stage, actor_type, actor_id)
            VALUES (gen_random_uuid(), v_app, 'STAGE_CHANGED', 'SUBMITTED', 'VIEWED',
                    'EMPLOYER', v_row.created_by);
            v_stage := 'VIEWED';
          END IF;
          IF v_stage = 'VIEWED' THEN
            UPDATE applications SET stage = 'SHORTLISTED', employer_active_at = now(),
                   updated_at = now()
             WHERE id = v_app;
            INSERT INTO application_events
                   (id, application_id, kind, from_stage, to_stage, actor_type, actor_id)
            VALUES (gen_random_uuid(), v_app, 'STAGE_CHANGED', 'VIEWED', 'SHORTLISTED',
                    'EMPLOYER', v_row.created_by);
          END IF;

          UPDATE {TABLE}
             SET status = 'ACCEPTED', application_id = v_app, answered_at = now(),
                 updated_at = now()
           WHERE id = v_row.id;

          PERFORM set_config('app.user_id', v_user, true);
          RETURN v_app;
        END;
        $fn$;
        """
    )
    op.execute("REVOKE ALL ON FUNCTION accept_shortlist_invitation(uuid) FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION accept_shortlist_invitation(uuid) TO {APP_ROLE}")


# ---------------------------------------------------------------------------
# The erasure cascade, replaced whole: 0007's, plus `employer_shortlists`,
# deleted before the applications an accepted row points at.
# `test_erasure_plan.py` reads the live definition.
# ---------------------------------------------------------------------------
_ANCHOR = "          DELETE FROM applications WHERE candidate_id = p_user_id;\n"
_SHORTLISTS_DELETE = f"""          DELETE FROM {TABLE} WHERE candidate_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('{TABLE}', n);
"""


def _previous_erasure() -> ModuleType:
    """0007, loaded by path: a revision file is not an importable module name."""
    path = Path(__file__).with_name("0007_streak_calendar.py")
    spec = importlib.util.spec_from_file_location("_bp_0007_streak_calendar", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def erase_with_shortlists() -> str:
    previous: str = _previous_erasure().ERASE_WITH_ACTIVITY_DAYS
    if previous.count(_ANCHOR) != 1:
        raise RuntimeError("0007's erase_candidate no longer has the applications delete")
    return previous.replace(_ANCHOR, _SHORTLISTS_DELETE + _ANCHOR)


def _replace_erasure() -> None:
    op.execute(erase_with_shortlists())
