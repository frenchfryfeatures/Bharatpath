"""A discount code may be 100% (client, 2026-10-09).

Three CHECKs move, nothing else. A code's percentage may now reach 100, a
redemption may record a payment of zero, and a payment of zero must be a
code's COMPLIMENTARY settlement -- never a gateway's, never undiscounted.

The guards (`guard_payment_write`, `guard_discount_redemption`) are untouched:
a complimentary payment is still inserted PENDING and walked to SUCCEEDED,
and its redemption still needs that SUCCEEDED, verified payment.

The baseline builds these tables from the current models, so a fresh
database already has the new constraints; every statement here drops by
name first and is safe to run on either.
"""

from alembic import op

revision = "0014_complimentary_discounts"
down_revision = "0013_employer_profile"
branch_labels = None
depends_on = None

# Frozen here rather than imported: a revision says what it did on the day it
# ran. `billing.domain` holds the same values (`MAX_PERCENT_OFF`,
# `COMPLIMENTARY_PROVIDER`), and the models generate a fresh database's CHECKs
# from them.
_MAX_PERCENT_OFF = 100
_COMPLIMENTARY = "complimentary"


def _replace(table: str, name: str, check: str, *, not_valid: bool = False) -> None:
    op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
    suffix = " NOT VALID" if not_valid else ""
    op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({check}){suffix}")


def upgrade():
    _replace(
        "discount_codes",
        "ck_discount_codes_percent_bounds",
        f"percent_off IS NULL OR percent_off BETWEEN 1 AND {_MAX_PERCENT_OFF}",
    )
    _replace(
        "discount_redemptions",
        "ck_discount_redemptions_arithmetic",
        "discount_minor > 0 AND amount_minor >= 0 "
        "AND list_amount_minor = amount_minor + discount_minor",
    )
    # NOT VALID: it binds every payment written from now on without asking a
    # shared database to prove its history. No zero payment could be written
    # before this revision -- no code reached 100% and no plan is free -- so
    # validating would find nothing, but a deploy is the wrong place to learn
    # otherwise.
    _replace(
        "payments",
        "ck_payments_complimentary",
        f"(provider = '{_COMPLIMENTARY}') = (amount_minor = 0) "
        f"AND (provider <> '{_COMPLIMENTARY}' OR discount_code_id IS NOT NULL)",
        not_valid=True,
    )


def downgrade():
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_complimentary")
    _replace(
        "discount_redemptions",
        "ck_discount_redemptions_arithmetic",
        "discount_minor > 0 AND amount_minor > 0 "
        "AND list_amount_minor = amount_minor + discount_minor",
    )
    _replace(
        "discount_codes",
        "ck_discount_codes_percent_bounds",
        "percent_off IS NULL OR percent_off BETWEEN 1 AND 99",
    )
