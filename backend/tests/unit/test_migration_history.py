"""The migration graph must retain every revision used by a shared database."""

from pathlib import Path

from alembic.script import ScriptDirectory

ROOT = Path(__file__).resolve().parents[2]


def _scripts() -> ScriptDirectory:
    return ScriptDirectory(str(ROOT / "alembic"))


def test_migration_graph_has_one_head() -> None:
    assert len(_scripts().get_heads()) == 1


def test_deployed_search_filter_revision_remains_resolvable() -> None:
    revision = _scripts().get_revision("0002_search_filter_options")
    assert revision is not None
    assert revision.down_revision == "0001_baseline"


def test_the_mobile_interview_revision_remains_resolvable() -> None:
    revision = _scripts().get_revision("0002_interviews_in_subscription")
    assert revision is not None
    assert revision.down_revision == "0001_baseline"


def test_mains_merge_revision_stays_under_the_portal_dashboards() -> None:
    """`0005_merge_migration_heads` reached `main` first and may be applied
    somewhere; the portal revision follows it rather than competing with it."""
    revision = _scripts().get_revision("0005_portal_dashboards")
    assert revision is not None
    assert revision.down_revision == "0005_merge_migration_heads"


def test_interviews_are_bought_again_at_the_head() -> None:
    assert _scripts().get_heads() == ["0006_interviews_are_bought"]
