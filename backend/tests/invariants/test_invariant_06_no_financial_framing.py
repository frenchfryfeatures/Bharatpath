"""INVARIANT 6 - no financial or lending framing (PRD section 3 rule 5).

Stated in the PRD as a legal requirement rather than a style
preference, and the risk sharpened in v4-v6: the product now sells items that
raise the number, the number sits behind a paywall, and it is never explained.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "check_vocabulary.py"

pytestmark = pytest.mark.invariant


def test_no_banned_vocabulary_anywhere() -> None:
    result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, cwd=ROOT)
    assert result.returncode == 0, (
        "Invariant 6 violated. This is a legal requirement (PRD section 3 "
        f"rule 5), not a style preference.\n\n{result.stdout}"
    )


@pytest.mark.parametrize(
    "offending_line",
    [
        "user_credit_score = 720",
        "def compute_creditworthiness(): ...",
        "# check CIBIL before approving",
        "loan_amount = 0",
        "eligibility_score = 700",
        "class UnderwritingPolicy: ...",
    ],
)
def test_scan_detects_violations(offending_line: str) -> None:
    """The guard must catch what it claims to catch."""
    import re

    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import check_vocabulary as checker
    finally:
        sys.path.pop(0)

    assert any(re.search(p, offending_line, re.IGNORECASE) for p in checker.BANNED), (
        f"guard failed to flag: {offending_line!r}"
    )


@pytest.mark.parametrize(
    "innocent_line",
    [
        "candidate_score = 700",
        "score_band = 'STRONG'",
        "min_score_threshold = 750",
    ],
)
def test_approved_vocabulary_passes(innocent_line: str) -> None:
    """The words we DO use must not trip the guard."""
    import re

    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import check_vocabulary as checker
    finally:
        sys.path.pop(0)

    assert not any(re.search(p, innocent_line, re.IGNORECASE) for p in checker.BANNED)
