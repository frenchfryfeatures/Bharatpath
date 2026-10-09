#!/usr/bin/env python3
"""Scaffold a module, and check that every module is registered.

Every module has the same layered shape (router -> service -> repository,
with a pure `domain.py`), so a new one starts from the template below rather
than from a blank directory. Add it to MODULES and run the script: missing
files are created and `app/modules/__init__.py` is regenerated. An existing
file is never overwritten.

A layer a module does not need may be deleted after scaffolding -- an empty
file is noise, not structure. `--check` therefore requires only what the
application depends on: each module's package (`__init__.py`, which carries
`name`, `prefix` and `get_router()`) and its entry in the registry.

    python scripts/gen_modules.py           # scaffold anything missing
    python scripts/gen_modules.py --check   # exit non-zero on drift (CI)
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULES_DIR = ROOT / "app" / "modules"


@dataclass(frozen=True)
class ModuleSpec:
    name: str
    prefix: str
    summary: str


# Every module in the monolith (docs/plan.md section 4). The registry in
# `app/modules/__init__.py` is generated from this tuple.
MODULES: tuple[ModuleSpec, ...] = (
    ModuleSpec("identity", "/auth", "Users, sessions, Cognito linkage, memberships."),
    ModuleSpec("candidate", "/candidate", "Candidate profile, settings, language preference."),
    ModuleSpec(
        "resume",
        "/candidate/resume",
        "Upload, parse jobs, versions, review and confirm.",
    ),
    ModuleSpec("scoring", "/candidate/score", "Engine interface, versions, history, breakdown."),
    ModuleSpec("integrity", "/integrity", "Signals, severity policy, search suppression."),
    ModuleSpec(
        "questionnaire",
        "/candidate/questionnaire",
        "Optional attribute questionnaire. Imports nothing from scoring.",
    ),
    ModuleSpec(
        "interview",
        "/candidate/interview",
        "Audio sessions, chunk upload, evaluation, +20/session.",
    ),
    ModuleSpec(
        "courses",
        "/candidate/courses",
        "Catalogue, purchase, completion, +30 contribution.",
    ),
    ModuleSpec("employer", "/employer", "Employer tenant, team members, roles."),
    ModuleSpec("kyb", "/employer/kyb", "Submissions, documents, review state machine."),
    ModuleSpec("jobs", "/employer/jobs", "Composer, validation, publish gate, lifecycle."),
    ModuleSpec(
        "applications",
        "/candidate/applications",
        "Apply, stages, withdraw, expiry, hire confirm.",
    ),
    ModuleSpec(
        "discovery",
        "/employer/discovery",
        "Masked search, access-window checks, reveal audit.",
    ),
    ModuleSpec("billing", "/billing", "Payments, entitlements, signed callbacks."),
    ModuleSpec(
        "subscriptions",
        "/subscriptions",
        "Plans, periods, renewal, cancellation, seats.",
    ),
    ModuleSpec(
        "college",
        "/college",
        "Institution tenant, roster, invites, consent, referral codes.",
    ),
    ModuleSpec("analytics", "/college/analytics", "Cohort aggregates, placement tracking."),
    ModuleSpec("admin", "/admin", "Queues, drill-downs, disputes, suspensions."),
    ModuleSpec("notifications", "/notifications", "Event to channel fan-out, templates."),
    ModuleSpec("privacy", "/privacy", "Export and deletion requests, DSR tracking."),
    ModuleSpec(
        "engagement",
        "/candidate/streak",
        "Daily app-open streaks and engagement points. Never the score.",
    ),
)

#: What a new module is scaffolded with.
FILES = (
    "__init__.py",
    "router.py",
    "schemas.py",
    "models.py",
    "repository.py",
    "service.py",
    "domain.py",
    "events.py",
)

INIT_TEMPLATE = '''"""{name} module. {summary}"""

from __future__ import annotations

from fastapi import APIRouter

name = "{name}"
prefix = "{prefix}"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
'''

# One entry per file: the layer name, the rules that govern it, and the body.
# Keeping these as real multi-line templates rather than escaped concatenation
# means the generator reads as a description of the architecture.
LAYERS: dict[str, tuple[str, str, str]] = {
    "router.py": (
        "HTTP layer",
        "Routes only. No business logic, no repository access.\n"
        "import-linter enforces the second half of that sentence.",
        """
from fastapi import APIRouter

router = APIRouter()
""",
    ),
    "schemas.py": (
        "Pydantic request/response DTOs",
        "Separate Create / Update / Read schemas. ORM models are never exposed\n"
        "directly - the schema IS the API contract, and for several modules it\n"
        "is also where an invariant is enforced structurally.",
        """
from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")
""",
    ),
    "models.py": (
        "SQLAlchemy ORM models",
        "Every tenant-scoped table carries `tenant_id` and an RLS policy.\n"
        "Money is stored as integer minor units (paise) - never a float.",
        """
from app.core.db import Base  # noqa: F401
""",
    ),
    "repository.py": (
        "data access",
        "All database access for this module lives here. Private to the module:\n"
        "no other module may import it (import-linter contract `module-privacy`).",
        """
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401
""",
    ),
    "service.py": (
        "business rules and transaction boundaries",
        "Services own the transaction. They never touch `Request`, and anything\n"
        "that reveals private data writes its audit row on the same session\n"
        "before the transaction closes.",
        """
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401
""",
    ),
    "domain.py": (
        "pure domain logic",
        "No I/O. No database, no HTTP, no clock, no randomness that is not\n"
        "passed in. mypy runs in strict mode here and import-linter forbids I/O\n"
        "imports, because this is the layer the invariant property tests\n"
        "exercise directly.",
        "",
    ),
    "events.py": (
        "domain events",
        "Events this module emits through the transactional outbox. Consumers\n"
        "are idempotent by event id.",
        """
from typing import Final

MODULE: Final = "{name}"
""",
    ),
}


def header(m: ModuleSpec, layer: str, rules: str) -> str:
    return (
        f'"""{m.name} - {layer}\n\n'
        f"{m.summary}\n\n"
        f'{rules}\n"""\n\n'
        "from __future__ import annotations\n"
    )


def render(m: ModuleSpec, filename: str) -> str:
    if filename == "__init__.py":
        return INIT_TEMPLATE.format(name=m.name, prefix=m.prefix, summary=m.summary)

    if filename in LAYERS:
        layer, rules, body = LAYERS[filename]
        return header(m, layer, rules) + body.format(name=m.name)

    raise ValueError(filename)


def write_registry() -> None:
    """app/modules/__init__.py - the registry the API router walks."""
    lines = [
        '"""Module registry. The API router walks ALL_MODULES to mount every surface."""',
        "",
        "from __future__ import annotations",
        "",
        "from types import ModuleType",
        "",
        *[f"from . import {m.name}" for m in MODULES],
        "",
        "ALL_MODULES: tuple[ModuleType, ...] = (",
        *[f"    {m.name}," for m in MODULES],
        ")",
        "",
    ]
    (MODULES_DIR / "__init__.py").write_text("\n".join(lines), encoding="utf-8")


def check() -> list[str]:
    """Every module has a package, and the registry lists exactly MODULES."""
    problems = [
        f"{(MODULES_DIR / m.name / '__init__.py').relative_to(ROOT)} is missing"
        for m in MODULES
        if not (MODULES_DIR / m.name / "__init__.py").exists()
    ]
    registry = (MODULES_DIR / "__init__.py").read_text(encoding="utf-8")
    problems += [
        f"app/modules/__init__.py does not register {m.name}"
        for m in MODULES
        if f"    {m.name},\n" not in registry
    ]
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Exit non-zero if files are missing.")
    args = parser.parse_args()

    if args.check:
        problems = check()
        if problems:
            print(f"{len(problems)} problem(s). Run: python scripts/gen_modules.py")
            for problem in problems[:20]:
                print(f"  {problem}")
            return 1
        print(f"All {len(MODULES)} modules present and registered.")
        return 0

    created: list[str] = []
    for m in MODULES:
        directory = MODULES_DIR / m.name
        if (directory / "__init__.py").exists():
            continue  # an existing module keeps the layers it chose
        directory.mkdir(parents=True, exist_ok=True)
        for filename in FILES:
            path = directory / filename
            path.write_text(render(m, filename), encoding="utf-8")
            created.append(str(path.relative_to(ROOT)))

    write_registry()
    print(f"Created {len(created)} file(s) across {len(MODULES)} modules.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
