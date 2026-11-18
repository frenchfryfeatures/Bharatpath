"""Candidate insights: tracked events, impression receipts and asynchronous daily summaries."""

from alembic import op

revision = "0026_profile_insights"
down_revision = "0025_education_taxonomy"
branch_labels = None
depends_on = None


def upgrade():
    from app.modules.profile_insights.models import (
        AnonymousTotal,
        InsightDay,
        InsightEvent,
        InsightRollup,
        SearchReceipt,
    )

    for model in (InsightEvent, SearchReceipt, InsightDay, InsightRollup, AnonymousTotal):
        model.__table__.create(op.get_bind(), checkfirst=True)
        op.execute(
            f"GRANT SELECT,INSERT,UPDATE,DELETE ON {model.__tablename__} TO bharatpath_admin"
        )
    for table in ("profile_insight_events", "profile_insight_receipts"):
        op.execute(f"GRANT SELECT,INSERT,UPDATE ON {table} TO bharatpath_app")
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY insights_owner ON {table} USING (candidate_id=current_candidate_id() OR tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)"
        )
    op.execute("GRANT SELECT ON profile_insight_days,profile_insight_rollup TO bharatpath_app")
    op.execute("ALTER TABLE profile_insight_days ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE profile_insight_days FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY insight_daily_owner ON profile_insight_days USING (candidate_id=current_candidate_id())"
    )
    # Only provable legacy views are backfilled. No historic impressions/actions are invented.
    op.execute("""INSERT INTO profile_insight_events
 (id,candidate_id,actor_id,tenant_id,metric,dedup_key,terms,occurred_at,aggregated)
 SELECT gen_random_uuid(),v.candidate_id,v.actor_id,v.tenant_id,'PROFILE_VIEW',
 'view:'||v.actor_id||':'||v.candidate_id||':'||v.day,'[]'::jsonb,v.viewed_at,false
 FROM (SELECT DISTINCT ON (e.actor_id,e.candidate_id,(e.viewed_at AT TIME ZONE 'Asia/Kolkata')::date)
 e.*,(e.viewed_at AT TIME ZONE 'Asia/Kolkata')::date AS day
 FROM candidate_view_events e JOIN users u ON u.id=e.candidate_id
 WHERE e.viewed_at>=now()-interval '365 days' AND u.status='ACTIVE'
 ORDER BY e.actor_id,e.candidate_id,(e.viewed_at AT TIME ZONE 'Asia/Kolkata')::date,e.viewed_at) v
 ON CONFLICT (dedup_key) DO NOTHING""")


def downgrade():
    for table in (
        "profile_insight_anonymous_totals",
        "profile_insight_rollup",
        "profile_insight_days",
        "profile_insight_receipts",
        "profile_insight_events",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
