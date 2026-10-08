"""The Week 4 gate: all ten invariants have a test, and it is collected.

Plan §14 tracks invariant coverage in a table a human maintains. This is the
machine's copy, and it exists because of how the human one fails: a file is
renamed in a refactor, or a suite is excluded by a `pytest.ini` change, and the
table still says green. Nothing else notices, because an invariant test that
never runs passes in exactly the same way as one that does.

So each invariant below names the file that proves it, and this asserts the
file exists, is not empty of tests, and that the whole suite collects without
error. The table here and the one in `README.md` are read together at handover.
"""

from __future__ import annotations

import re
from pathlib import Path

TESTS = Path(__file__).resolve().parent.parent
HERE = TESTS / "invariants"

#: `invariant -> (path under tests/, a phrase the file must contain)`. The
#: phrase is there so that renaming a test to something unrelated fails rather
#: than passing on a file that happens to still exist.
#:
#: **Two of these live in `tests/integration/`**, and deliberately: invariants
#: 3 and 8 are proved against the database's own grants and triggers, by going
#: round the service rather than through it, which is an integration test by
#: construction. They are named here so they are as hard to lose as the rest.
COVERAGE: dict[str, tuple[str, str]] = {
    "1 score is reproducible": ("invariants/test_invariant_01_02_03_scoring.py", "replay"),
    "2 scale is 700-990": ("invariants/test_invariant_01_02_03_scoring.py", "990"),
    "3 score is not human-editable": (
        "integration/test_rls_and_grants.py",
        "test_scores_are_insert_only",
    ),
    "4' add-on contributions are bounded": (
        "invariants/test_invariant_01_02_03_scoring.py",
        "add_on",
    ),
    "5 no age-gating": ("invariants/test_invariant_05_no_age_gating.py", "age"),
    "6 no financial framing": (
        "invariants/test_invariant_06_no_financial_framing.py",
        "vocabulary",
    ),
    "7 masked without an access window": (
        "invariants/test_invariant_07_access_window.py",
        "access_window",
    ),
    "7' every reveal is audited": ("invariants/test_invariant_07_prime_reveal_audit.py", "audit"),
    "8 no publish before KYB": (
        "integration/test_jobs.py",
        "test_the_database_refuses_a_publish_that_skips_the_service",
    ),
    "9 consent, and every reveal audited": ("invariants/test_invariant_09_consent.py", "consent"),
    # Not numbered in the plan, but enforced the same way and worth the same
    # protection against a quietly deleted file.
    "the confirm gate (SRS 1.4.4)": ("invariants/test_confirm_gate.py", "version_confirmed"),
    "the erasure policy": ("invariants/test_erasure_plan.py", "ERASURE_PLAN"),
    "streak points never move the score": (
        "invariants/test_streak_never_moves_the_score.py",
        "engagement",
    ),
}


def test_every_invariant_names_a_file_that_still_proves_it() -> None:
    problems: list[str] = []
    for invariant, (filename, phrase) in COVERAGE.items():
        path = TESTS / filename
        if not path.exists():
            problems.append(f"{invariant}: {filename} is gone")
            continue
        body = path.read_text(encoding="utf-8")
        if not re.search(r"^(async )?def test_", body, re.M):
            problems.append(f"{invariant}: {filename} has no tests")
        if phrase.lower() not in body.lower():
            problems.append(f"{invariant}: {filename} no longer mentions {phrase!r}")
    assert not problems, problems


def test_no_invariant_file_is_unaccounted_for() -> None:
    """The other direction: a file here proves something, so say what."""
    named = {Path(filename).name for filename, _ in COVERAGE.values()}
    on_disk = {p.name for p in HERE.glob("test_*.py")}
    extra = sorted(on_disk - named - {Path(__file__).name})
    # These guard rules that are not numbered invariants; they are listed so
    # the set is closed and a new file forces a decision about which it is.
    known_unnumbered = {
        "test_admin_console.py",
        "test_cross_tenant_routes.py",
        "test_discovery_suppression.py",
        "test_masked_candidate.py",
        "test_questionnaire_never_scores.py",
        "test_route_authorisation.py",
        "test_schema_guards.py",
        "test_score_never_explained.py",
        "test_scoring_calibration.py",
    }
    assert not set(extra) - known_unnumbered, (
        f"{sorted(set(extra) - known_unnumbered)}: add it to COVERAGE against the invariant it "
        "proves, or to `known_unnumbered` with a note saying what rule it guards."
    )
