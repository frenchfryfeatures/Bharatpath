"""Static schema guards. No database required - these read the ORM metadata.

They catch the class of mistake that is invisible in review and expensive
later: a table that gains a `tenant_id` but no RLS policy, a money column
stored as a float, a table the migration forgets to create.
"""

from __future__ import annotations

import importlib
import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import Float, Numeric

pytestmark = pytest.mark.invariant

ROOT = Path(__file__).resolve().parents[2]


def _load_metadata() -> object:
    """The same loader Alembic uses, deliberately.

    An earlier version of this file had its own import loop while
    `alembic/env.py` had a different (incomplete) one - so these guards
    passed against complete metadata while the migration ran against empty
    metadata and died in CI. One loader, one thing to get right.
    """
    from app.core.metadata import load_all_models

    return load_all_models()


def _load_baseline() -> ModuleType:
    path = ROOT / "alembic" / "versions" / "0001_baseline_schema.py"
    spec = importlib.util.spec_from_file_location("baseline", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_tenant_scoped_table_has_rls_or_a_documented_exemption() -> None:
    """INVARIANT 7 / SRS 2.24.7, guarded structurally.

    A `tenant_id` column with no Row-Level Security policy is a cross-tenant
    leak waiting for the first repository method that forgets its WHERE
    clause. Every such table must either be in TENANT_SCOPED_TABLES or carry a
    written reason in RLS_EXEMPT.

    This test is the reason exemptions need a sentence rather than a shrug.
    """
    metadata = _load_metadata()
    baseline = _load_baseline()

    with_tenant = {name for name, table in metadata.tables.items() if "tenant_id" in table.c}
    policied = set(baseline.TENANT_SCOPED_TABLES)
    exempt = set(baseline.RLS_EXEMPT)

    unprotected = with_tenant - policied - exempt
    assert not unprotected, (
        "These tables carry tenant_id but have neither an RLS policy nor a "
        f"documented exemption: {sorted(unprotected)}.\n"
        "Add them to TENANT_SCOPED_TABLES in the baseline migration, or to "
        "RLS_EXEMPT with a reason explaining why the policy would be wrong."
    )


def test_rls_declarations_refer_to_real_tables() -> None:
    """A policy on a table that no longer exists is a migration that fails."""
    metadata = _load_metadata()
    baseline = _load_baseline()

    for name in (*baseline.TENANT_SCOPED_TABLES, *baseline.RLS_EXEMPT):
        assert name in metadata.tables, f"{name} is declared but has no model"
        assert "tenant_id" in metadata.tables[name].c, (
            f"{name} is declared tenant-scoped but has no tenant_id column"
        )


def test_every_exemption_has_a_real_reason() -> None:
    """An exemption without an explanation is how isolation quietly lapses."""
    baseline = _load_baseline()
    for table, reason in baseline.RLS_EXEMPT.items():
        assert len(reason) > 80, f"RLS exemption for {table!r} needs a real explanation, not a note"


def test_migration_creates_every_table() -> None:
    """Every model must be created by the baseline, or it exists only in tests."""
    metadata = _load_metadata()

    source = (ROOT / "alembic" / "versions" / "0001_baseline_schema.py").read_text(encoding="utf-8")

    missing = [name for name in metadata.tables if f'"{name}"' not in source]
    assert not missing, f"These tables have models but the baseline never creates them: {missing}"


def test_money_is_never_a_float() -> None:
    """Money is integer minor units (paise). Never a float, never Numeric.

    Floating-point money produces rounding errors that show up as one-paise
    discrepancies in reconciliation, months later, in a report someone else
    has to explain.
    """
    metadata = _load_metadata()
    offenders: list[str] = []

    for table_name, table in metadata.tables.items():
        for column in table.c:
            looks_monetary = any(
                token in column.name for token in ("price", "amount", "salary", "minor", "fee")
            )
            if looks_monetary and isinstance(column.type, (Float, Numeric)):
                offenders.append(f"{table_name}.{column.name} ({column.type})")

    assert not offenders, f"Money stored as float/Numeric: {offenders}"


def test_monetary_columns_are_named_minor() -> None:
    """The unit belongs in the name, so nobody has to guess at the call site."""
    metadata = _load_metadata()
    unclear: list[str] = []

    for table_name, table in metadata.tables.items():
        for column in table.c:
            if any(
                t in column.name for t in ("price", "amount", "salary")
            ) and not column.name.endswith("_minor"):
                unclear.append(f"{table_name}.{column.name}")

    assert not unclear, f"Monetary columns must end in _minor to state their unit: {unclear}"


def test_scores_table_bounds_the_scale() -> None:
    """INVARIANT 2, at the database level.

    700-990 (client, 2026-08-27). 990 is arithmetic - 700 + 200 + 30 + 60 -
    not a clamp. The constraint asserts it; if it ever fires that is a bug,
    not a business rule.
    """
    metadata = _load_metadata()
    constraints = {c.name for c in metadata.tables["scores"].constraints}

    assert "ck_scores_range_700_990" in constraints
    assert "ck_scores_addon_cap" in constraints
    # base + addon must equal the total, or replay and the stored value can
    # disagree without anything noticing.
    assert "ck_scores_components_sum" in constraints


def test_no_table_stores_an_otp() -> None:
    """Twilio Verify owns code generation and checking.

    No OTP value should ever be persisted on our side - that removes a real
    class of leak. There is deliberately no `otp_challenges` table.
    """
    metadata = _load_metadata()
    assert "otp_challenges" not in metadata.tables

    for table_name, table in metadata.tables.items():
        for column in table.c:
            assert "otp" not in column.name.lower(), (
                f"{table_name}.{column.name} looks like it stores an OTP value"
            )


def test_importing_app_modules_alone_does_not_populate_metadata() -> None:
    """The bug that broke the first migration run, pinned as a test.

    `alembic/env.py` used to do `from app.modules import ALL_MODULES` and
    assume the metadata was complete. It is not: that loads each module's
    `__init__.py`, which carries only `name`, `prefix` and `get_router()`.
    The ORM classes live in `<module>/models.py` and nothing imports them by
    side effect, so the baseline migration ran against an empty metadata and
    died with `KeyError: 'users'`.

    This asserts the property that actually matters -- `load_all_models()` is
    the thing that populates it -- so anyone tempted to "simplify" env.py back
    to a bare package import finds out here rather than in CI.
    """
    from app.core.metadata import load_all_models

    metadata = load_all_models()
    assert "users" in metadata.tables
    assert len(metadata.tables) >= 39


def test_migration_batches_have_no_forward_foreign_keys() -> None:
    """The baseline creates tables in batches, so order matters.

    `create_all` sorts by dependency *within* the list it is given. It cannot
    know about a table in a later batch, so a foreign key pointing forward
    fails at migration time with a confusing error about a missing relation.
    """
    metadata = _load_metadata()
    baseline = _load_baseline()
    source = (ROOT / "alembic" / "versions" / "0001_baseline_schema.py").read_text(encoding="utf-8")

    # The order the batch functions are called in `upgrade()`.
    order = [
        "_create_core_tables",
        "_create_identity_tables",
        "_create_candidate_tables",
        "_create_employer_tables",
        "_create_billing_tables",
        "_create_college_tables",
        # Disputes and notifications point at users, tenants,
        # applications and roster entries, so they come last.
        "_create_platform_tables",
    ]
    upgrade_body = source.split("def upgrade()")[1].split("def downgrade()")[0]
    called = [fn for fn in order if fn in upgrade_body]
    assert called == order, "batch order changed - update this test deliberately"

    created: set[str] = set()
    problems: list[str] = []

    for fn_name in order:
        block = source.split(f"def {fn_name}()")[1].split("\ndef ")[0]
        batch = {name for name in metadata.tables if f'"{name}"' in block}

        for table_name in batch:
            for fk in metadata.tables[table_name].foreign_keys:
                target = fk.column.table.name
                if target not in created and target not in batch:
                    problems.append(f"{table_name} -> {target} (created later)")
        created |= batch

    assert not problems, f"foreign keys pointing at a later batch: {problems}"
    assert created == set(metadata.tables), (
        f"tables created by no batch: {sorted(set(metadata.tables) - created)}"
    )
    assert baseline.TENANT_SCOPED_TABLES  # sanity: the module loaded
