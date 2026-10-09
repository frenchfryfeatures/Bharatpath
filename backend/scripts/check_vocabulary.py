#!/usr/bin/env python3
"""INVARIANT 6 - no financial or lending framing. Anywhere.

PRD section 3 rule 5: "Do not use terms like 'credit score,' 'loan
eligibility,' or similar in any user-facing copy, variable names, or
documentation, even internally - this is a legal requirement, not a style
preference."

The reason this rule exists is that a three-digit score shown to Indian
consumers closely resembles a credit bureau score, and the product is not a
lending or credit product. The client's counsel is aware of the risk; the
codebase is part of what would be examined.

**The risk got sharper, not softer.** The product now sells items that
provably raise the number (R1), the score sits behind a paywall (R5/R13), and
the candidate is never told how it was reached (R11). An unexplained
three-digit score that rises when you pay is close to the worst possible shape
for the concern this rule exists to prevent. See docs/plan.md, "Legal".

Runs in CI on every push.

    python scripts/check_vocabulary.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Matched case-insensitively, on word boundaries, against source, migrations,
# schemas and locale files.
BANNED: dict[str, str] = {
    r"credit[\s_-]?score": "financial framing - use 'candidate score' or 'score'",
    r"credit[\s_-]?worth\w*": "financial framing",
    r"\bcibil\b": "names an Indian credit bureau",
    # `\bloan\b` would MISS `loan_amount`, because `_` is a word character so
    # there is no boundary after "loan". Identifiers are the main thing this
    # rule is aimed at, so the suffix has to be part of the match.
    r"\bloan\w*": "lending framing",
    r"lending": "lending framing",
    r"borrow\w*": "lending framing",
    r"eligibility[\s_-]?score": "reads as a credit-decisioning term - use 'threshold'",
    r"\bunderwrit\w*": "lending framing",
    r"\bdefault[\s_-]?risk\b": "lending framing",
    r"\bcreditor\b": "lending framing",
    r"\bfico\b": "names a credit scoring product",
}

SCAN_SUFFIXES = {".py", ".sql", ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".ini", ".cfg"}

SKIP_DIRS = {
    ".git",
    # Local Claude Code session artefacts -- hook logs and transcripts. Already
    # gitignored, so CI never sees them, but a local run scans them and they
    # quote this file's own banned-term list back at it. Tooling scratch, not
    # product source.
    ".claude",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    "node_modules",
    ".idea",
    ".vscode",
    "htmlcov",
    "dist",
    "build",
}

# This file names every banned term by definition, and so does its test.
SKIP_FILES = {
    "scripts/check_vocabulary.py",
    "tests/invariants/test_invariant_06_no_financial_framing.py",
}


def iter_files() -> list[Path]:
    out: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in SCAN_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.relative_to(ROOT).as_posix() in SKIP_FILES:
            continue
        out.append(path)
    return out


def main() -> int:
    patterns = [(re.compile(p, re.IGNORECASE), why) for p, why in BANNED.items()]
    violations: list[str] = []

    for path in iter_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for pattern, why in patterns:
                if match := pattern.search(line):
                    rel = path.relative_to(ROOT).as_posix()
                    violations.append(
                        f"{rel}:{lineno}: '{match.group(0)}' - {why}\n    {line.strip()[:100]}"
                    )

    if violations:
        print(f"INVARIANT 6 VIOLATED - {len(violations)} banned term(s) found.\n")
        for v in violations:
            print(f"  {v}")
        print(
            "\nThis is a legal requirement (PRD section 3 rule 5), not a style "
            "preference.\nRename the identifier or reword the copy. Do not add a "
            "skip - if a term\ngenuinely must appear, that is a conversation with "
            "the client's counsel first."
        )
        return 1

    print(f"Invariant 6 OK - no financial framing across {len(iter_files())} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
