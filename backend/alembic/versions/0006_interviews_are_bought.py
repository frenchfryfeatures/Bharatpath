"""A mock-interview session is bought again, one purchase per session.

`0002_interviews_in_subscription` (mobile branch, 2026-09-22) made sessions
free for any subscriber: `purchase_id` nullable, and a guard that accepted a
live subscription instead of a purchase. The client never decided that, and it
let a subscriber take unlimited sessions and the whole +60 without paying for
one, past the "this will not increase your score" acknowledgement.

This puts back the baseline's rule, for every writer: a session starts from
its owner's purchase, and `purchase_id` is NOT NULL.

**A session started without a purchase stops this migration** rather than
being deleted or backfilled here. Such a row can only have come from the
free flow; whether it is test data to remove or a candidate to refund is
somebody's decision, and a migration is the wrong place to make it silently.

Revision ID: 0006_interviews_are_bought
Revises: 0005_portal_dashboards
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

from app.modules.interview.bank import QUESTIONS_PER_SESSION
from app.modules.interview.domain import SESSION_TRANSITIONS

revision: str = "0006_interviews_are_bought"
down_revision: str | None = "0005_portal_dashboards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM interview_sessions WHERE purchase_id IS NULL) THEN
            RAISE EXCEPTION
              'interview_sessions has % row(s) started without a purchase (the subscription-included flow). Decide what they are before migrating.',
              (SELECT count(*) FROM interview_sessions WHERE purchase_id IS NULL);
          END IF;
        END;
        $$;
        """
    )
    op.execute("ALTER TABLE interview_sessions ALTER COLUMN purchase_id SET NOT NULL")

    # The baseline's function, unchanged: `_create_interview_guards` in
    # `0001_baseline_schema.py`.
    pairs = ", ".join(f"('{a}', '{b}')" for a, b in sorted(SESSION_TRANSITIONS))
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


def downgrade() -> None:
    raise NotImplementedError("The baseline is rebuilt rather than downgraded.")
