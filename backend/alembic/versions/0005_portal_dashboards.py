"""The portal dashboards the client asked for on 2026-09-29.

* `interview_session_questions` -- every question a session asked, since the
  questions are now written for each candidate (`interview/questions.py`).
* `course_modules`, `course_lessons`, `course_lesson_progress` -- the course,
  built by staff from YouTube links or uploaded videos, and how far each
  candidate is through it.
* `application_messages` -- an employer's interview or assessment invitation,
  or note, to an applicant.
* `college_student_details`, `college_student_courses`,
  `college_student_applications` -- what the second version of the INDIVIDUAL
  consent words name, read by a college only through live consent **to those
  words** (invariant 9).
* `erase_candidate` -- replaced whole, to erase the three new tables that
  hold a candidate's data.

It follows `0005_merge_migration_heads`, which joined `main`'s two heads
(`0004_merge_migration_heads` and the mobile branch's
`0002_interviews_in_subscription`).

The baseline builds the five tables from the current models too, as it does
every table (`test_schema_guards.py`), so on a database built from it they
already exist: tables and indexes are created only when missing, as
`0002_search_filter_options` does. Grants, functions and the cascade are
written either way.

Revision ID: 0005_portal_dashboards
Revises: 0005_merge_migration_heads
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_portal_dashboards"
down_revision: str | None = "0005_merge_migration_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "bharatpath_app"

#: `college.domain.INDIVIDUAL_DETAILS_VERSIONS`, frozen here as SQL. A test
#: holds the two equal; a new version of the words is a new migration.
DETAILS_CONSENT_VERSIONS = ("placeholder-2-2026-09-29",)

#: Every function this revision gives a college to read a student through,
#: and the consent CTE each joins. `test_invariant_09_consent.py` gathers
#: this beside the baseline's own `COLLEGE_STUDENT_READS`.
COLLEGE_STUDENT_READS: dict[str, str] = {
    "college_student_details": "individually_visible",
    "college_student_courses": "individually_visible",
    "college_student_applications": "individually_visible",
    "college_cohort_applications": "roster_cohort",
}

_VERSIONS_SQL = ", ".join(f"'{v}'" for v in DETAILS_CONSENT_VERSIONS)

#: As the baseline's, with one more condition: the INDIVIDUAL grant is to
#: words that name what these functions return.
_INDIVIDUALLY_VISIBLE_CTE = f"""individually_visible AS (
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
     AND i.consent_version IN ({_VERSIONS_SQL})
)"""

#: The baseline's: students linked to the bound college right now.
_ROSTER_COHORT_CTE = """roster_cohort AS (
  SELECT sc.candidate_id
    FROM student_consents sc
    JOIN users u
      ON u.id = sc.candidate_id AND u.status = 'ACTIVE' AND u.pool = 'CANDIDATE'
   WHERE sc.tenant_id = (SELECT bound_college_tenant())
     AND sc.scope = 'ROSTER'
     AND sc.revoked_at IS NULL
)"""

#: A lesson a candidate can play, as `courses.repository.lessons_for` has it.
_PUBLISHED_LESSON = "m.active AND l.active AND l.media_ready_at IS NOT NULL"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def _uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True)


def _create_table(name: str, *columns: object) -> None:
    """Only when missing: see the module docstring."""
    if not sa.inspect(op.get_bind()).has_table(name):
        op.create_table(name, *columns)  # type: ignore[arg-type]


def upgrade() -> None:
    _create_interview_questions()
    _create_course_lessons()
    _create_application_messages()
    _grants()
    _create_college_reads()
    op.execute(ERASE_WITH_NEW_TABLES)


def downgrade() -> None:
    op.execute(ERASE_BEFORE)
    for name, cte in COLLEGE_STUDENT_READS.items():
        args = "" if cte == "roster_cohort" else "uuid"
        op.execute(f"DROP FUNCTION IF EXISTS {name}({args})")
    for table in (
        "application_messages",
        "course_lesson_progress",
        "course_lessons",
        "course_modules",
        "interview_session_questions",
    ):
        op.drop_table(table)


def _create_interview_questions() -> None:
    _create_table(
        "interview_session_questions",
        _uuid_pk(),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("question_index", sa.Integer, nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("key", sa.String(128)),
        sa.Column("prompt", sa.String(1000), nullable=False),
        sa.Column("looking_for", sa.String(1000), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("model_id", sa.String(128)),
        sa.Column("prompt_version", sa.String(64)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "question_index >= 0 AND question_index < 6",
            name="ck_interview_session_questions_index",
        ),
        sa.CheckConstraint(
            "kind IN ('OPENING', 'FOLLOW_UP', 'NEW_TOPIC', 'BANK')",
            name="ck_interview_session_questions_kind",
        ),
        sa.CheckConstraint(
            "source IN ('MODEL', 'BANK') AND (source = 'BANK') = (kind = 'BANK') AND "
            "(source = 'MODEL') = (model_id IS NOT NULL AND prompt_version IS NOT NULL)",
            name="ck_interview_session_questions_source",
        ),
        sa.UniqueConstraint(
            "session_id", "question_index", name="uq_interview_session_question_slot"
        ),
        sa.UniqueConstraint("session_id", "code", name="uq_interview_session_question_code"),
    )


def _create_course_lessons() -> None:
    _create_table(
        "course_modules",
        _uuid_pk(),
        sa.Column("course_code", sa.String(64), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        *_timestamps(),
    )
    op.create_index(
        "ix_course_modules_course",
        "course_modules",
        ["course_code", "sort_order"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_course_modules_created_by", "course_modules", ["created_by"], if_not_exists=True
    )

    _create_table(
        "course_lessons",
        _uuid_pk(),
        sa.Column(
            "module_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("course_modules.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.String(2000)),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("duration_seconds", sa.Integer, nullable=False),
        sa.Column("media_kind", sa.String(16), nullable=False),
        sa.Column("youtube_video_id", sa.String(16)),
        sa.Column("s3_key", sa.String(512)),
        sa.Column("media_ready_at", sa.DateTime(timezone=True)),
        sa.Column("mime", sa.String(32)),
        sa.Column("size_bytes", sa.BigInteger),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        *_timestamps(),
        sa.CheckConstraint(
            "duration_seconds > 0 AND duration_seconds <= 14400",
            name="ck_course_lessons_duration",
        ),
        sa.CheckConstraint(
            "media_kind IN ('YOUTUBE', 'UPLOAD')", name="ck_course_lessons_media_kind"
        ),
        sa.CheckConstraint(
            "(media_kind = 'YOUTUBE') = (youtube_video_id IS NOT NULL) AND "
            "(media_kind = 'UPLOAD') = (s3_key IS NOT NULL) AND "
            "(media_kind = 'UPLOAD' OR media_ready_at IS NOT NULL)",
            name="ck_course_lessons_media",
        ),
    )
    op.create_index(
        "ix_course_lessons_module",
        "course_lessons",
        ["module_id", "sort_order"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_course_lessons_created_by", "course_lessons", ["created_by"], if_not_exists=True
    )

    _create_table(
        "course_lesson_progress",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "lesson_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("course_lessons.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("position_seconds", sa.Integer, nullable=False, server_default="0"),
        sa.Column("furthest_seconds", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "first_opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.CheckConstraint(
            "position_seconds >= 0 AND furthest_seconds >= position_seconds",
            name="ck_course_lesson_progress_positions",
        ),
    )
    op.create_index(
        "ix_course_lesson_progress_lesson",
        "course_lesson_progress",
        ["lesson_id"],
        if_not_exists=True,
    )


def _create_application_messages() -> None:
    _create_table(
        "application_messages",
        _uuid_pk(),
        sa.Column(
            "application_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("body", sa.String(2000), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True)),
        sa.Column("link", sa.String(1024)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.CheckConstraint(
            "kind IN ('INTERVIEW', 'ASSESSMENT', 'GENERAL')", name="ck_application_messages_kind"
        ),
        sa.CheckConstraint(
            "kind <> 'INTERVIEW' OR scheduled_at IS NOT NULL",
            name="ck_application_messages_interview_time",
        ),
        sa.CheckConstraint(
            "kind <> 'ASSESSMENT' OR link IS NOT NULL",
            name="ck_application_messages_assessment_link",
        ),
        sa.CheckConstraint(
            "link IS NULL OR link LIKE 'https://%'", name="ck_application_messages_https"
        ),
    )
    op.create_index(
        "ix_application_messages_application",
        "application_messages",
        ["application_id", "created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_application_messages_sender", "application_messages", ["sender_id"], if_not_exists=True
    )


def _grants() -> None:
    # A question put to a candidate, and a message sent to one, are what was
    # said: written once, never rewritten, never deleted by the app.
    for table in ("interview_session_questions", "application_messages"):
        op.execute(f"REVOKE UPDATE, DELETE ON {table} FROM {APP_ROLE}")
    # The course is switched off, never deleted; progress only moves forward
    # and goes only with an erasure.
    for table in ("course_modules", "course_lessons", "course_lesson_progress"):
        op.execute(f"REVOKE DELETE ON {table} FROM {APP_ROLE}")


def _create_college_reads() -> None:
    """Invariant 9, as the baseline's reads: SECURITY DEFINER, no tenant
    argument, INNER JOIN of live INDIVIDUAL consent beside a live ROSTER link
    for the bound college -- and consent to words that name these fields."""
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_student_details(p_candidate_id uuid)
        RETURNS TABLE (
          consent_id uuid, consent_version text, email text, phone text, city text,
          state_code text, locale text, questionnaire jsonb,
          questionnaire_submitted_at timestamptz, resume_source text, resume_parsed jsonb,
          resume_confirmed_at timestamptz, resume_s3_key text, resume_mime text,
          interviews_completed bigint
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT v.consent_id, v.consent_version, u.email, u.phone, p.city, p.state_code,
                 u.locale,
                 -- The accessibility answer is promised to employers applied
                 -- to, and to nobody else.
                 COALESCE(q.answers, '{{}}'::jsonb) - 'ACCESSIBILITY_ADJUSTMENTS',
                 q.submitted_at,
                 rv.source, rv.parsed, rv.confirmed_at, rf.s3_key, rf.mime,
                 (SELECT count(*) FROM interview_sessions s
                   WHERE s.user_id = v.candidate_id
                     AND s.state IN ('COMPLETED', 'EVALUATED', 'FAILED'))
            FROM individually_visible v
            JOIN users u ON u.id = v.candidate_id
            LEFT JOIN candidate_profiles p ON p.user_id = v.candidate_id
            LEFT JOIN questionnaire_responses q ON q.user_id = v.candidate_id
            LEFT JOIN LATERAL (
                   SELECT x.source, x.parsed, x.confirmed_at, x.resume_file_id
                     FROM resume_versions x
                    WHERE x.user_id = v.candidate_id AND x.confirmed_at IS NOT NULL
                    ORDER BY x.confirmed_at DESC, x.id DESC
                    LIMIT 1
                 ) AS rv ON true
            LEFT JOIN resume_files rf ON rf.id = rv.resume_file_id
           WHERE v.candidate_id = p_candidate_id
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_student_courses(p_candidate_id uuid)
        RETURNS TABLE (
          course_code text, title text, purchased_at timestamptz, lessons_total bigint,
          lessons_completed bigint, completed_at timestamptz
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT c.code, c.title, cp.purchased_at,
                 (SELECT count(*) FROM course_lessons l
                    JOIN course_modules m ON m.id = l.module_id
                   WHERE m.course_code = c.code AND {_PUBLISHED_LESSON}),
                 (SELECT count(*) FROM course_lesson_progress pr
                    JOIN course_lessons l ON l.id = pr.lesson_id
                    JOIN course_modules m ON m.id = l.module_id
                   WHERE pr.user_id = v.candidate_id AND pr.completed_at IS NOT NULL
                     AND m.course_code = c.code AND {_PUBLISHED_LESSON}),
                 cc.completed_at
            FROM individually_visible v
            JOIN course_purchases cp ON cp.user_id = v.candidate_id
            JOIN courses c ON c.id = cp.course_id
            LEFT JOIN course_completions cc
              ON cc.user_id = v.candidate_id AND cc.course_id = cp.course_id
           WHERE v.candidate_id = p_candidate_id
           ORDER BY cp.purchased_at
        $$;
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_student_applications(p_candidate_id uuid)
        RETURNS TABLE (
          job_title text, employer_name text, job_location text, stage text,
          applied_at timestamptz, updated_at timestamptz, reached text[]
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_INDIVIDUALLY_VISIBLE_CTE}
          SELECT j.title, e.legal_name, j.location, a.stage, a.created_at, a.updated_at,
                 ARRAY(
                   SELECT DISTINCT ev.to_stage::text FROM application_events ev
                    WHERE ev.application_id = a.id
                      AND ev.to_stage IN ('SHORTLISTED', 'INTERVIEW', 'DECISION', 'HIRED')
                 )
            FROM individually_visible v
            JOIN applications a ON a.candidate_id = v.candidate_id
            JOIN jobs j ON j.id = a.job_id
            JOIN employers e ON e.tenant_id = a.tenant_id
           WHERE v.candidate_id = p_candidate_id
           ORDER BY a.created_at DESC, a.id DESC
        $$;
        """
    )
    # An aggregate, like the baseline's cohort reads: one row per application
    # of a linked student, with **nothing saying whose**, so the floors in
    # `analytics.domain` are applied to values that cannot be joined back.
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION college_cohort_applications()
        RETURNS TABLE (stage text, reached text[])
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
          WITH {_ROSTER_COHORT_CTE}
          SELECT a.stage,
                 ARRAY(
                   SELECT DISTINCT ev.to_stage::text FROM application_events ev
                    WHERE ev.application_id = a.id
                      AND ev.to_stage IN ('SHORTLISTED', 'INTERVIEW', 'DECISION', 'HIRED')
                 )
            FROM applications a
            JOIN roster_cohort c ON c.candidate_id = a.candidate_id
        $$;
        """
    )
    for name in COLLEGE_STUDENT_READS:
        args = "" if COLLEGE_STUDENT_READS[name] == "roster_cohort" else "uuid"
        op.execute(f"REVOKE ALL ON FUNCTION {name}({args}) FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {name}({args}) TO {APP_ROLE}")


# ---------------------------------------------------------------------------
# The erasure cascade, replaced whole: the baseline's, plus
# `application_messages`, `interview_session_questions` and
# `course_lesson_progress`. `test_erasure_plan.py` reads the live definition.
# ---------------------------------------------------------------------------
ERASE_WITH_NEW_TABLES = """
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
          DELETE FROM application_messages
           WHERE application_id IN (SELECT id FROM applications WHERE candidate_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('application_messages', n);
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
          DELETE FROM interview_session_questions
           WHERE session_id IN (SELECT id FROM interview_sessions WHERE user_id = p_user_id);
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('interview_session_questions', n);
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

          DELETE FROM course_lesson_progress WHERE user_id = p_user_id;
          GET DIAGNOSTICS n = ROW_COUNT;
          m := m || jsonb_build_object('course_lesson_progress', n);
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

#: The baseline's, for the downgrade.
ERASE_BEFORE = """
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
