"""PRD 7.2 and SRS 1.4.5, held structurally.

Two promises, each easy to break without any behavioural test noticing:

* **High-severity integrity signals suppress a candidate from discovery,
  inside the discovery query** -- not as a filtering step a new endpoint can
  forget. So every discovery query must be built on the one CTE that carries
  the rule.
* **Integrity never moves a score.** The integrity task has to read a score
  to find the extraction it checks, so it is the one place a write path could
  creep in.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.invariant

ROOT = Path(__file__).resolve().parents[2]
DISCOVERY = ROOT / "app" / "modules" / "discovery"


def _norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


#: Repository functions that query without the CTE because they read no
#: candidate at all. Each needs a reason, and the test below fails if one of
#: them starts naming a candidate table -- so this list cannot become the way
#: round the rule.
READS_NO_CANDIDATE: dict[str, str] = {
    "current_config": "reads config_values: the abuse limits, not a person",
    "lock_tenant_views": "takes an advisory lock; reads no table",
    "view_counts": "counts the organisation's own view log to enforce its caps",
    "revealed_counts": "counts the organisation's own view log for its dashboard",
    "ensure_view_partitions": "creates view-log partitions; reads no rows",
    # 2026-09-24: the search filter catalogue -- skill and city names staff
    # curate, never drawn from candidates.
    "featured_filter_options": "reads the filter catalogue",
    "suggest_filter_options": "reads the filter catalogue",
    "options_naming": "reads the filter catalogue",
    "options_claiming": "reads the filter catalogue",
    "lock_filter_catalogue": "takes an advisory lock; reads no table",
    "get_filter_option": "reads the filter catalogue",
    "list_filter_options": "reads the filter catalogue",
    "insert_filter_options": "writes the filter catalogue",
    "save_filter_option": "writes the filter catalogue",
}

#: Tables that hold something about a candidate, as SQL would name them.
CANDIDATE_TABLES = re.compile(
    r"\b(users|scores|candidate_search_documents|candidate_profiles|resume_\w+|integrity_\w+"
    r"|applications)\b|\b(Score|User|CandidateSearchDocument|CandidateProfile)\b"
)


def _query_functions() -> dict[str, str]:
    source = (DISCOVERY / "repository.py").read_text(encoding="utf-8")
    return {
        node.name: ast.get_source_segment(source, node) or ""
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.AsyncFunctionDef)
        and any(
            call in (ast.get_source_segment(source, node) or "") for call in ("session.", "execute")
        )
    }


def test_every_discovery_query_is_built_on_the_visibility_cte() -> None:
    """A query that skips the CTE shows suppressed candidates, and every other
    test in the suite still passes because the CTE itself is fine."""
    offenders = [
        name
        for name, body in _query_functions().items()
        if "VISIBLE_CANDIDATES_CTE" not in body and name not in READS_NO_CANDIDATE
    ]
    assert not offenders, f"{offenders} query candidates without the visibility CTE"


def test_the_queries_exempt_from_the_cte_read_no_candidate() -> None:
    functions = _query_functions()
    stale = sorted(set(READS_NO_CANDIDATE) - set(functions))
    assert not stale, f"exemptions for functions that no longer exist: {stale}"
    for name in READS_NO_CANDIDATE:
        body = functions[name].split('"""', 2)[-1]  # the docstring may mention anything
        found = CANDIDATE_TABLES.search(body)
        assert found is None, (
            f"{name} is exempt from the visibility CTE but reads {found.group(0)!r}"
        )


def test_the_suppression_predicate_matches_the_partial_index() -> None:
    """Identical text, so the planner can answer the NOT EXISTS from
    `ix_integrity_suppressing` instead of scanning every signal ever raised --
    which is what masked search would otherwise do on every page."""
    from app.modules.discovery.repository import VISIBLE_CANDIDATES_CTE
    from app.modules.integrity.models import IntegritySignal

    index = next(
        i for i in IntegritySignal.__table__.indexes if i.name == "ix_integrity_suppressing"
    )
    where = _norm(str(index.dialect_options["postgresql"]["where"]))
    expected = where.replace("severity", "g.severity").replace("state", "g.state")
    assert expected in _norm(VISIBLE_CANDIDATES_CTE), (
        f"the CTE no longer uses the index predicate {where!r}"
    )


def test_only_a_cleared_signal_restores_visibility() -> None:
    from app.modules.discovery.repository import VISIBLE_CANDIDATES_CTE

    cte = _norm(VISIBLE_CANDIDATES_CTE)
    assert "'OPEN'" in cte and "'CONFIRMED'" in cte
    assert "'CLEARED'" not in cte


def test_visibility_fails_closed_on_an_unchecked_version() -> None:
    from app.modules.discovery.repository import VISIBLE_CANDIDATES_CTE

    cte = _norm(VISIBLE_CANDIDATES_CTE)
    assert "EXISTS ( SELECT 1 FROM integrity_checks" in cte


def test_discovery_imports_neither_integrity_nor_scoring() -> None:
    """The CTE reads their tables in SQL, deliberately. Importing their code
    as well would make discovery a second place that can change what they
    decide."""
    imported: list[str] = []
    for path in DISCOVERY.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom) and node.module:
                imported.append(node.module)
            elif isinstance(node, ast.Import):
                imported.extend(alias.name for alias in node.names)
    assert not [
        m for m in imported if m.startswith(("app.modules.integrity", "app.modules.scoring"))
    ]


def test_the_integrity_task_never_names_a_scoring_write_path() -> None:
    """SRS 1.4.5. The task lives in `app/tasks/` so it can read from scoring
    while `integrity` itself cannot import it -- which also means the
    import-linter contract does not cover it. This does."""
    source = (ROOT / "app" / "tasks" / "detect_integrity.py").read_text(encoding="utf-8")
    forbidden = {"persist", "score_confirmed_resume", "insert_score", "replay"}
    named = {
        node.attr for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Attribute)
    } | {node.id for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Name)}
    assert not (named & forbidden), f"the integrity task names {sorted(named & forbidden)}"


def test_a_scored_version_is_routed_to_a_registered_integrity_task() -> None:
    import app.tasks.detect_integrity  # noqa: F401  - registers the task
    from app.tasks.routing import DETECT_INTEGRITY_TASK, tasks_for
    from app.worker import celery_app

    assert DETECT_INTEGRITY_TASK in tasks_for("scoring.score_computed")
    assert DETECT_INTEGRITY_TASK in celery_app.tasks
