"""The price list, as data.

**These prices are ours, not the client's.** The client asked us to "create
best for now according to your knowledge" (2026-09-11), well enough to build
and seed against. They are
benchmarked against what Indian hiring platforms charge and against what the
audiences can plausibly pay -- they are *not* a margin calculation, because the
per-candidate cost figure that would drive one does not exist yet
(`scoring-approach.md` §12). **Do not launch on them without a pricing decision.**

Changing a price is editing a number here and re-running the seed. No code
moves, because nothing below is logic.

---

**Why a `PLACEHOLDER_PRICING` flag rather than a comment.** A comment saying
"these are invented" does not survive the moment somebody demonstrates the
product to a paying customer. The flag is asserted by a test, printed by the
seeder, and is the single thing to flip when real prices land.

**Money is integer paise.** Never a float, and never rupees -- `CLAUDE.md`
conventions, and the column is `price_minor`.

**Tax.** Consumer prices (candidates) are quoted tax-inclusive, which is what
an Indian consumer expects to see and what the ads must show. Business prices
(employers, colleges) are quoted exclusive, which is what a B2B invoice does.
Getting this backwards is an 18% revenue error found at the first GST filing,
so it is a field on every entry rather than an assumption.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

#: Flip to False only when the client has signed off on real prices.
PLACEHOLDER_PRICING: Final = True

#: Bump when any price changes. Stored nowhere yet -- it exists so the seeder
#: can refuse to quietly overwrite a price list somebody is already selling on.
CATALOGUE_VERSION: Final = "placeholder-2-2026-09-12"

#: The GST rate the two tax bases have to be reconciled across.
#:
#: Needed because a candidate price is quoted tax-INCLUSIVE and a college price
#: tax-EXCLUSIVE, so comparing them directly overstates what a seat earns by
#: 18%. That comparison is now a revenue question rather than a presentational
#: one -- see `seat_share_of_direct` -- which is why the rate is a constant
#: here instead of being applied at the invoice and nowhere else.
GST_RATE: Final = 0.18

Audience = Literal["CANDIDATE", "EMPLOYER", "COLLEGE"]
Period = Literal["MONTHLY", "QUARTERLY", "SEMESTER", "SEMI_ANNUAL", "ANNUAL"]

#: Months of access each period grants. SEMESTER and SEMI_ANNUAL are both six
#: months and both exist because a college buys a semester and a business buys
#: half a year -- same duration, different renewal conversation.
PERIOD_MONTHS: Final[dict[str, int]] = {
    "MONTHLY": 1,
    "QUARTERLY": 3,
    "SEMESTER": 6,
    "SEMI_ANNUAL": 6,
    "ANNUAL": 12,
}


@dataclass(frozen=True, slots=True)
class PlanEntry:
    code: str
    audience: Audience
    period: Period
    price_minor: int
    #: Colleges only. One payment per period covering up to N students
    #: (client, 2026-08-27). Two seat counts are two rows here, not two systems.
    #:
    #: **A seat covers that student's subscription entirely** (client,
    #: 2026-09-12). They pay nothing. So this number is not a discount on a
    #: tool the college buys alongside student revenue -- it is the divisor on
    #: the ONLY revenue those students will ever produce.
    seat_allowance: int | None = None
    tax_inclusive: bool = False
    active: bool = True

    @property
    def monthly_equivalent_minor(self) -> int:
        """What the buyer is really comparing when they choose a period."""
        return self.price_minor // PERIOD_MONTHS[self.period]

    @property
    def price_ex_tax_minor(self) -> int:
        """The price with GST removed, so two audiences can be compared.

        Consumer prices here are inclusive and business prices exclusive, so
        the raw `price_minor` of a candidate plan and a college plan are not
        the same kind of number. Comparing them without this overstates a
        seat's yield by 18%.
        """
        if not self.tax_inclusive:
            return self.price_minor
        return int(self.price_minor / (1 + GST_RATE))

    @property
    def per_seat_minor(self) -> int | None:
        """What one student is worth on this plan, ex-tax. `None` if not a
        seat plan.

        **This is the number that matters commercially**, and until
        2026-09-12 nothing computed it. The totals looked like reasonable
        institutional invoices while the per-seat figure was a tenth of what
        the same student would have paid directly -- which was defensible only
        under the assumption that the student was also paying, and they are
        not.
        """
        if not self.seat_allowance:
            return None
        return self.price_ex_tax_minor // self.seat_allowance


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------
# "Nothing free" (client, 2026-08-24), which means this is the price of seeing
# your own score at all. That makes it a very different number from an employer
# tool: the buyer is frequently a student, often on a parent's money, and the
# alternative is not a competitor but giving up.
#
# Four periods because the client named four. The discount ladder is steep on
# purpose -- annual is a third off monthly -- because a candidate's job search
# lasts months and a monthly plan they forget to cancel is a refund request and
# a bad review, not revenue.

CANDIDATE_PLANS: Final[tuple[PlanEntry, ...]] = (
    PlanEntry("CANDIDATE_MONTHLY", "CANDIDATE", "MONTHLY", 14_900, tax_inclusive=True),
    PlanEntry("CANDIDATE_QUARTERLY", "CANDIDATE", "QUARTERLY", 39_900, tax_inclusive=True),
    PlanEntry("CANDIDATE_SEMESTER", "CANDIDATE", "SEMESTER", 69_900, tax_inclusive=True),
    PlanEntry("CANDIDATE_ANNUAL", "CANDIDATE", "ANNUAL", 119_900, tax_inclusive=True),
)

# ---------------------------------------------------------------------------
# Employers
# ---------------------------------------------------------------------------
# Pay monthly, see everyone (client, 2026-08-27, confirmed again since).
# No tiers, no per-unlock pricing, no seat counts -- one subscription is the
# entitlement, and that is why `subscriptions` alone answers "can this tenant
# see this candidate".
#
# Benchmarked well below an Indian resume-database product, which is priced in
# lakhs per year. That is deliberate for a marketplace with no candidates in it
# yet: the first hundred employers are buying a promise.

EMPLOYER_PLANS: Final[tuple[PlanEntry, ...]] = (
    PlanEntry("EMPLOYER_MONTHLY", "EMPLOYER", "MONTHLY", 499_900),
    PlanEntry("EMPLOYER_QUARTERLY", "EMPLOYER", "QUARTERLY", 1_349_900),
    PlanEntry("EMPLOYER_ANNUAL", "EMPLOYER", "ANNUAL", 4_799_900),
)

# ---------------------------------------------------------------------------
# Colleges
# ---------------------------------------------------------------------------
# One payment per period covering up to N students. Seat counts are price-list
# entries, so "add a 2000-seat annual plan" is one line here.
#
# Sold per semester as well as per year because a placement cell's budget is
# released per semester and its intake arrives per year, and asking it to
# commit annually in month one loses the deal.
#
# ---------------------------------------------------------------------------
# **Repriced 2026-09-12, and the reason is the whole point of these numbers.**
#
# C12 asked whether a college seat covers the student's own subscription. It
# had never been put to the client, and the first price list was built on the
# assumption that the answer was no -- seat and subscription as separate
# purchases, so a college deal earned the seat fee ON TOP OF whatever those
# students paid us directly. On that reading, ~Rs 12-17 per seat per month was
# a placement-cell tool priced alongside real candidate revenue.
#
# The client answered **no, the student does not pay** (2026-09-12). That makes
# the seat fee the *entire* lifetime revenue from that student, and the old
# ladder indefensible: at Rs 11.67/seat/month against a direct candidate paying
# Rs 99.92/month ex-tax, every college deal we signed would have earned about a
# tenth of what those same students were worth unsigned. A thousand-seat annual
# deal would have displaced roughly Rs 10.2 lakh of candidate revenue to book
# Rs 1.4 lakh.
#
# So a seat is now priced as what it actually is: **a bulk-rate candidate
# subscription**, discounted for volume rather than invented independently.
# The discount is real and defensible -- the college pays upfront in one
# invoice, brings its students at zero acquisition cost, and carries the
# onboarding itself -- but it is a discount on a known number, not a different
# number. Roughly 53% off direct at 250 seats and 63% at 1000, ex-tax both
# sides; `test_a_seat_never_undercuts_direct_candidate_revenue` holds the floor
# so this cannot drift back by increments.
#
# The totals are ~2.7x the previous ones. That is not a price rise; it is the
# first list being wrong about what it was selling.
#
# **Still placeholder.** PLACEHOLDER_PRICING is still True and this still needs
# the client's sign-off -- but it is now wrong in a direction that costs them
# a deal rather than wrong in a direction that costs them the business.
# ---------------------------------------------------------------------------

COLLEGE_PLANS: Final[tuple[PlanEntry, ...]] = (
    PlanEntry("COLLEGE_SEMESTER_250", "COLLEGE", "SEMESTER", 6_999_900, seat_allowance=250),
    PlanEntry("COLLEGE_SEMESTER_1000", "COLLEGE", "SEMESTER", 21_999_900, seat_allowance=1000),
    PlanEntry("COLLEGE_ANNUAL_250", "COLLEGE", "ANNUAL", 11_999_900, seat_allowance=250),
    PlanEntry("COLLEGE_ANNUAL_1000", "COLLEGE", "ANNUAL", 37_999_900, seat_allowance=1000),
)

#: The least a seat may be worth, as a share of what that student would have
#: paid us directly for the same period, ex-tax on both sides.
#:
#: A floor rather than a formula, because volume discounting is a commercial
#: judgement and this is only here to stop the judgement reaching a number that
#: makes signing a college worse than not signing one. **The old price list sat
#: at roughly 0.10.**
MIN_SEAT_SHARE_OF_DIRECT: Final = 0.35


def seat_share_of_direct(plan: PlanEntry) -> float | None:
    """What one seat earns, against that student paying us directly.

    `None` for anything that is not a seat plan. Ex-tax on both sides -- see
    `price_ex_tax_minor` for why that is not optional.
    """
    per_seat = plan.per_seat_minor
    if per_seat is None:
        return None
    direct = next(
        (p for p in CANDIDATE_PLANS if PERIOD_MONTHS[p.period] == PERIOD_MONTHS[plan.period]),
        None,
    )
    if direct is None:  # pragma: no cover - every college period has a candidate twin
        return None
    return per_seat / direct.price_ex_tax_minor


PLANS: Final[tuple[PlanEntry, ...]] = CANDIDATE_PLANS + EMPLOYER_PLANS + COLLEGE_PLANS


# ---------------------------------------------------------------------------
# One-off purchases
# ---------------------------------------------------------------------------
# Not subscriptions: bought once, owned forever, and both move the score. They
# live here because "the price list" is one thing to a client even though it is
# two tables to us.


@dataclass(frozen=True, slots=True)
class ProductEntry:
    code: str
    price_minor: int
    tax_inclusive: bool = True


#: The course. Priced as an impulse purchase on top of a subscription, not as a
#: training product -- what is being bought is +30 points, and pricing it like
#: a ₹5,000 certification invites the comparison that the points are for sale,
#: which is the reputational risk `check_vocabulary.py` exists to hold back.
COURSE_PRODUCT: Final = ProductEntry("COURSE_RESUME_FOUNDATION", 49_900)

#: One audio mock interview. Three of them reach the +60 cap; a fourth earns
#: nothing, which `interview/models.py` already notes must be confirmed before
#: payment or it becomes a refund request.
INTERVIEW_SESSION_PRODUCT: Final = ProductEntry("INTERVIEW_SESSION", 34_900)

PRODUCTS: Final[tuple[ProductEntry, ...]] = (COURSE_PRODUCT, INTERVIEW_SESSION_PRODUCT)


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

PLAN_CODES: Final[frozenset[str]] = frozenset(p.code for p in PLANS)


def plans_for(audience: Audience) -> tuple[PlanEntry, ...]:
    return tuple(p for p in PLANS if p.audience == audience and p.active)


def plan_by_code(code: str) -> PlanEntry | None:
    return next((p for p in PLANS if p.code == code), None)


def format_inr(minor: int) -> str:
    """Rupees for display and for talking to the client about the price list.

    Never used to compute anything -- integer paise is the only arithmetic.
    """
    rupees, paise = divmod(minor, 100)
    return f"₹{rupees:,}" if paise == 0 else f"₹{rupees:,}.{paise:02d}"
