"""Include personal Insights activity in the existing atomic erasure cascade."""

import importlib.util
from pathlib import Path

from alembic import op

revision = "0027_insights_privacy"
down_revision = "0026_profile_insights"
branch_labels = None
depends_on = None


def previous_erasure():
    path = Path(__file__).with_name("0019_resume_builder.py")
    spec = importlib.util.spec_from_file_location("_bp_0019_resume_builder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.erase_with_resume_builder()


def insights_erasure():
    source = previous_erasure()
    anchor = "          DELETE FROM resume_versions WHERE user_id = p_user_id;\n"
    assert source.count(anchor) == 1
    statements = ""
    for table in ("profile_insight_events", "profile_insight_receipts", "profile_insight_days"):
        predicate = "candidate_id = p_user_id" + (
            " OR actor_id = p_user_id" if table != "profile_insight_days" else ""
        )
        statements += f"          DELETE FROM {table} WHERE {predicate};\n"  # noqa: S608 - fixed migration identifiers
        statements += f"          GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object('{table}', n);\n"
    return source.replace(anchor, statements + anchor)


def upgrade():
    op.execute(insights_erasure())


def downgrade():
    op.execute(previous_erasure())
