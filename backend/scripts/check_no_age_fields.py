#!/usr/bin/env python3
"""INVARIANT 5 - no age-gating. Not even as a reasonable-looking default.

PRD section 3 rule 4: "The product must not require or gate functionality on a
user's age or date of birth. Do not implement an 18+ requirement anywhere in
the flow, even as a seemingly reasonable default."

SRS 1.3.1 repeats it as a business rule, and SRS 2.3.1 requires the candidate
login interface to have "no age-gating field or age-based restriction."

The failure mode this guards is not malice - it is a developer adding a
`date_of_birth` column because every other signup form has one, or a
validator checking `>= 18` because that is the habit. So the check is
structural: no column, no field, no validator, no constant.

Runs in CI on every push.

    python scripts/check_no_age_fields.py
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Fields that gate or describe a PERSON's age.
#
# Deliberately does NOT include `max_age`: that is standard HTTP vocabulary
# (Cache-Control, cookies, CORS preflight) with no connection to gating
# anyone, and flagging it produces noise on ordinary correct code. A noisy
# guard gets switched off, and a switched-off guard is worse than a narrower
# one because it still looks like coverage.
#
# `min_age` and `age_limit` stay - neither has an innocent technical meaning.
FIELD_RE = re.compile(
    r"\b(date_of_birth|dateofbirth|dob|birth_date|birthdate|birthday|"
    r"age_years|user_age|candidate_age|applicant_age|min_age|age_limit|"
    r"is_adult|is_minor|age_verified|age_group|age_bracket)\b",
    re.IGNORECASE,
)

# A bare `age` identifier is too common to ban outright (`message_age`,
# `cache_age`, `max_age` on a cookie). We ban the ones that gate a person.
AGE_GATE_RE = re.compile(
    r"(age\s*[><=]=?\s*(18|21))|((18|21)\s*[><=]=?\s*age)|"
    r"\bover_?18\b|\bunder_?18\b|\bage_gate\w*\b|\badults?_only\b",
    re.IGNORECASE,
)

SCAN_SUFFIXES = {".py", ".sql", ".json", ".yaml", ".yml"}
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
    "htmlcov",
    "dist",
    "build",
}
SKIP_FILES = {
    "scripts/check_no_age_fields.py",
    "tests/invariants/test_invariant_05_no_age_gating.py",
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


def scan_orm_columns(path: Path, text: str) -> list[str]:
    """Catch a mapped_column named after a birth date even if spelled oddly."""
    found: list[str] = []
    if path.suffix != ".py":
        return found
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return found
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and FIELD_RE.search(node.target.id)
        ):
            found.append(f"ORM/model field '{node.target.id}' (line {node.lineno})")
    return found


def main() -> int:
    violations: list[str] = []
    files = iter_files()

    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        rel = path.relative_to(ROOT).as_posix()

        for lineno, line in enumerate(text.splitlines(), start=1):
            if m := FIELD_RE.search(line):
                violations.append(
                    f"{rel}:{lineno}: age/DOB field '{m.group(0)}'\n    {line.strip()[:100]}"
                )
            if m := AGE_GATE_RE.search(line):
                violations.append(
                    f"{rel}:{lineno}: age gate '{m.group(0)}'\n    {line.strip()[:100]}"
                )

        for hit in scan_orm_columns(path, text):
            violations.append(f"{rel}: {hit}")

    if violations:
        print(f"INVARIANT 5 VIOLATED - {len(violations)} age-gating construct(s) found.\n")
        for v in violations:
            print(f"  {v}")
        print(
            "\nPRD section 3 rule 4 forbids age or date-of-birth anywhere in the "
            "product,\nexplicitly including 'seemingly reasonable defaults'. Remove "
            "the field.\nIf a real requirement seems to need it, that is a client "
            "conversation,\nnot a code change."
        )
        return 1

    print(f"Invariant 5 OK - no age-gating across {len(files)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
