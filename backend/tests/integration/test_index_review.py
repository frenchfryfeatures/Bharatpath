"""Day 20 index review: no growing table is scanned end to end.

Two checks, because each catches what the other misses.

**Every foreign key is indexed, or excused in writing.** An unindexed foreign
key costs nothing until its parent row is deleted, and then Postgres scans the
whole child table to check it -- once per parent row. That used to be rare
here; since Day 20 an erasure deletes a candidate's scores, resume versions,
device checks and consents, so every unindexed child of those is now a
sequential scan inside the erasure transaction, growing with the platform.

**The hot query shapes use an index.** Each query below is the shape an
endpoint or a sweep actually runs, planned with sequential scans priced out
(`enable_seqscan = off`). If the plan still contains `Seq Scan` on a growing
table, no index can serve that query at all -- which is what an empty test
database would otherwise hide, because the planner rightly prefers a scan of
twelve rows.

`EXPLAIN` only, never `ANALYZE`: nothing here executes, so the erasure shapes
can be planned without erasing anybody.
"""

# ruff: noqa: E501 -- the query table reads best one query per line.

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration

#: Tables that grow with use. A scan of `plans` is fine forever.
GROWING = frozenset(
    {
        "users", "memberships", "audit_events", "outbox", "resume_files", "resume_versions",
        "scores", "integrity_signals", "integrity_checks", "candidate_search_documents",
        "applications", "application_events", "candidate_view_events", "notifications",
        "payments", "subscriptions", "subscription_events", "student_consents",
        "college_seat_assignments", "roster_entries", "interview_sessions", "interview_answers",
        "device_checks", "interview_checkout_notices", "dsr_requests", "disputes",
        "streak_point_events", "questionnaire_responses", "course_completions", "entitlements",
        "referral_codes", "roster_imports",
    }
)  # fmt: skip

#: Referenced tables whose rows are never deleted, so a foreign key into them
#: never triggers a child-side check. `users` is on this list because of Day 20
#: itself: an erasure empties the row and never removes it.
NEVER_DELETED_PARENTS = frozenset(
    {
        "users",  # emptied by erase_candidate, never deleted
        "tenants",  # suspended or closed, never deleted
        "payments",  # REVOKE DELETE -- a financial record
        "subscriptions",  # retained under the carve-out
        "plans", "courses", "interview_products",  # versioned catalogue, never edited
    }
)  # fmt: skip

#: Foreign keys covered by an index that leads with part of the key.
COVERED = {
    # `ix_applications_job_stage` leads with job_id; tenant_id is the job's own.
    ("applications", "fk_applications_job_tenant"),
}


async def _rows(sql: str, **params: object) -> list[tuple[object, ...]]:
    async with sessions(_seed_url())() as session:
        return [tuple(r) for r in (await session.execute(text(sql), params)).all()]


async def test_every_foreign_key_on_a_growing_table_is_indexed() -> None:
    unindexed = await _rows(
        """
        WITH fk AS (
          SELECT c.conrelid, rel.relname AS child, parent.relname AS parent, c.conname,
                 array_agg(k.attnum ORDER BY k.ord)::int2[] AS nums
            FROM pg_constraint c
            JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
            JOIN pg_class rel ON rel.oid = c.conrelid
            JOIN pg_class parent ON parent.oid = c.confrelid
           WHERE c.contype = 'f' AND NOT rel.relispartition
           GROUP BY c.conrelid, rel.relname, parent.relname, c.conname
        )
        SELECT child, parent, conname FROM fk
         WHERE NOT EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = fk.conrelid
              AND (i.indkey::int2[])[0:array_length(fk.nums, 1) - 1] = fk.nums)
        """
    )
    gaps = sorted(
        f"{child}.{name} -> {parent}"
        for child, parent, name in unindexed
        if child in GROWING and parent not in NEVER_DELETED_PARENTS and (child, name) not in COVERED
    )
    assert not gaps, (
        "unindexed foreign keys on growing tables whose parent can be deleted -- every parent "
        f"delete scans the child: {gaps}"
    )


#: `(name, query)`. Parameters are placeholders; the plan does not depend on them.
HOT_PATHS: tuple[tuple[str, str], ...] = (
    ("audit by actor", "SELECT * FROM audit_events WHERE actor_id = :u ORDER BY occurred_at DESC LIMIT 50"),
    ("audit by tenant", "SELECT * FROM audit_events WHERE tenant_id = :u ORDER BY occurred_at DESC LIMIT 50"),
    ("audit by action", "SELECT * FROM audit_events WHERE action = 'dsr_completed' ORDER BY occurred_at DESC LIMIT 50"),
    ("outbox backlog", "SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100"),
    ("latest score", "SELECT * FROM scores WHERE user_id = :u ORDER BY computed_at DESC, id DESC LIMIT 1"),
    ("pipeline by job", "SELECT * FROM applications WHERE job_id = :u AND stage = 'SUBMITTED' ORDER BY created_at"),
    ("pipeline across jobs", "SELECT * FROM applications WHERE tenant_id = :u AND (created_at, id) > (now(), :u) ORDER BY created_at, id LIMIT 51"),
    ("my applications","SELECT * FROM applications WHERE candidate_id = :u ORDER BY created_at DESC"),
    ("application history", "SELECT * FROM application_events WHERE application_id = :u"),
    ("employer dashboard", "SELECT stage, count(*) FROM applications WHERE tenant_id = :u GROUP BY stage"),
    ("employer activity feed", "SELECT e.* FROM application_events e JOIN applications a ON a.id = e.application_id WHERE a.tenant_id = :u ORDER BY e.occurred_at DESC, e.id DESC LIMIT 51"),
    ("inbox", "SELECT * FROM notifications WHERE user_id = :u AND channel = 'IN_APP' ORDER BY created_at DESC LIMIT 20"),
    ("pending messages", "SELECT * FROM notifications WHERE state = 'PENDING' ORDER BY created_at LIMIT 100"),
    ("admin candidate list", "SELECT * FROM users WHERE pool = 'CANDIDATE' AND (created_at, id) < (now(), :u) ORDER BY created_at DESC, id DESC LIMIT 51"),
    ("integrity queue","SELECT * FROM integrity_signals WHERE state = 'OPEN' AND severity = 'HIGH' ORDER BY created_at LIMIT 50"),
    ("my consents", "SELECT * FROM student_consents WHERE candidate_id = :u"),
    ("college roster consents", "SELECT * FROM student_consents WHERE tenant_id = :u"),
    ("college sent roster", "SELECT * FROM roster_entries WHERE tenant_id = :u AND invite_state = 'SENT' AND sent_at > now() ORDER BY sent_at, id LIMIT 51"),
    ("college accepted roster", "SELECT * FROM roster_entries WHERE tenant_id = :u AND invite_state = 'ACCEPTED' ORDER BY responded_at, id LIMIT 51"),
    ("college referral codes", "SELECT * FROM referral_codes WHERE tenant_id = :u AND (created_at, id) < (now(), :u) ORDER BY created_at DESC, id DESC LIMIT 31"),
    ("college roster imports", "SELECT * FROM roster_imports WHERE tenant_id = :u AND (created_at, id) < (now(), :u) ORDER BY created_at DESC, id DESC LIMIT 31"),
    ("my requests", "SELECT * FROM dsr_requests WHERE user_id = :u ORDER BY created_at DESC"),
    ("due erasures", "SELECT id FROM dsr_requests WHERE type = 'DELETE' AND state = 'RECEIVED' AND created_at <= now() ORDER BY created_at LIMIT 50"),
    ("expired exports", "SELECT id FROM dsr_requests WHERE type = 'EXPORT' AND export_s3_key IS NOT NULL AND completed_at IS NOT NULL AND completed_at <= now() ORDER BY completed_at LIMIT 50"),
    ("membership", "SELECT * FROM memberships WHERE user_id = :u"),
    ("payments by user", "SELECT * FROM payments WHERE user_id = :u ORDER BY created_at"),
    ("live access window", "SELECT 1 FROM subscriptions WHERE subscriber_type = 'USER' AND subscriber_id = :u AND state IN ('ACTIVE', 'GRACE') AND current_period_end > now()"),
    # The erasure's own predicates, one per growing table it reaches.
    ("erase: search document", "DELETE FROM candidate_search_documents WHERE user_id = :u"),
    ("erase: integrity signals", "DELETE FROM integrity_signals WHERE candidate_id = :u"),
    ("erase: integrity checks", "DELETE FROM integrity_checks WHERE candidate_id = :u"),
    ("erase: shared cache", "SELECT 1 FROM scores s2 WHERE s2.extraction_cache_key = 'k' AND s2.user_id <> :u"),
    ("erase: scores", "DELETE FROM scores WHERE user_id = :u"),
    ("erase: resume versions", "DELETE FROM resume_versions WHERE user_id = :u"),
    ("erase: resume files", "DELETE FROM resume_files WHERE user_id = :u"),
    ("erase: applications", "DELETE FROM applications WHERE candidate_id = :u"),
    ("erase: interview sessions", "DELETE FROM interview_sessions WHERE user_id = :u"),
    ("erase: checkout notices", "DELETE FROM interview_checkout_notices WHERE user_id = :u"),
    ("erase: device checks", "DELETE FROM device_checks WHERE user_id = :u"),
    ("erase: seats", "DELETE FROM college_seat_assignments WHERE candidate_id = :u"),
    ("erase: consents", "DELETE FROM student_consents WHERE candidate_id = :u"),
    ("erase: notifications", "DELETE FROM notifications WHERE user_id = :u"),
    ("erase: completions", "DELETE FROM course_completions WHERE user_id = :u"),
    ("erase: entitlements", "DELETE FROM entitlements WHERE user_id = :u"),
    ("erase: streak points", "DELETE FROM streak_point_events WHERE user_id = :u"),
    ("erase: questionnaire", "DELETE FROM questionnaire_responses WHERE user_id = :u"),
    ("erase: memberships", "DELETE FROM memberships WHERE user_id = :u"),
)  # fmt: skip


@pytest.mark.parametrize(("name", "query"), HOT_PATHS, ids=[n for n, _ in HOT_PATHS])
async def test_a_hot_path_is_served_by_an_index(name: str, query: str) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(text("SET LOCAL enable_seqscan = off"))
        rows = await session.execute(text(f"EXPLAIN {query}"), {"u": str(uuid.uuid4())})
        plan = "\n".join(str(row[0]) for row in rows.all())
    scanned = sorted(set(re.findall(r"Seq Scan on (\w+)", plan)) & GROWING)
    assert not scanned, f"{name}: no index serves this query on {scanned}\n{plan}"
