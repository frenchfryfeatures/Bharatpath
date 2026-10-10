"""admin - pure domain logic

Queues, drill-downs, disputes, suspensions.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Who may do what in the console** is one table, `CONSOLE_ROLES`, so the
question "can a support agent suspend an employer?" has a single answer that
the router reads and a test pins. The staff roles exist only in the PLATFORM
tenant (`identity.domain.ROLE_TENANT_TYPE`), so a role guard here is also a
tenant guard.

**Disputes** are raised by all three external groups and closed by us. The
machine is small on purpose -- open, being looked at, closed one of two ways
-- and it lives twice from one source: `DISPUTE_TRANSITIONS` below, and
`guard_dispute_write` in the baseline, generated from it.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Final, Literal

# ---------------------------------------------------------------------------
# The console's permission table
# ---------------------------------------------------------------------------
PLATFORM_ADMIN: Final = "PLATFORM_ADMIN"
KYB_REVIEWER: Final = "KYB_REVIEWER"
INTEGRITY_REVIEWER: Final = "INTEGRITY_REVIEWER"
SUPPORT_AGENT: Final = "SUPPORT_AGENT"

Capability = Literal[
    "kyb",
    "kyb_policy",
    "integrity",
    "tenants",
    "suspend",
    "seats",
    "candidate_drilldown",
    "employer_drilldown",
    "college_drilldown",
    "disputes",
    "suppress_notifications",
    "audit_search",
    "accounts",
    "resend_invitation",
    "discounts",
    "discounts_read",
    "dashboard",
    "search_filters",
    "courses",
    "candidate_resume",
    "candidate_contact",
    "candidate_recordings",
]

#: `capability -> the staff roles that hold it`. PLATFORM_ADMIN holds all of
#: them. Stopping an organisation, changing what a college paid for and
#: reading the audit trail are the admin's alone: the first two change what
#: other people can do, and the third is where every other role's actions are
#: recorded.
CONSOLE_ROLES: Final[dict[Capability, frozenset[str]]] = {
    "kyb": frozenset({PLATFORM_ADMIN, KYB_REVIEWER}),
    # 2026-10-09. Whether employers are reviewed at all is the admin's alone:
    # switching to automatic approves every employer from then on, unread,
    # and a reviewer must not be able to switch their own queue off.
    "kyb_policy": frozenset({PLATFORM_ADMIN}),
    "integrity": frozenset({PLATFORM_ADMIN, INTEGRITY_REVIEWER}),
    "tenants": frozenset({PLATFORM_ADMIN, KYB_REVIEWER, SUPPORT_AGENT}),
    "suspend": frozenset({PLATFORM_ADMIN}),
    "seats": frozenset({PLATFORM_ADMIN}),
    # The integrity reviewer follows a signal to the person; the KYB reviewer
    # follows a submission to the organisation. Neither needs the other.
    "candidate_drilldown": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT, INTEGRITY_REVIEWER}),
    "employer_drilldown": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT, KYB_REVIEWER}),
    "college_drilldown": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    "disputes": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    # A bounce, a complaint, or someone who asked support to stop messaging
    # them. Not their own opt-out, which is theirs to set.
    "suppress_notifications": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    "audit_search": frozenset({PLATFORM_ADMIN}),
    # 2026-09-18. Making an account or an organisation on someone's behalf,
    # and adding a member to one, is the admin's alone: it decides who gets
    # into an organisation that holds candidate data. Resending an invitation
    # is support's too -- it adds nobody, it only re-sends what was decided.
    "accounts": frozenset({PLATFORM_ADMIN}),
    "resend_invitation": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    # A code is money off the product: made and switched off by the admin,
    # read by support, who answer "my code did not work".
    "discounts": frozenset({PLATFORM_ADMIN}),
    "discounts_read": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    # 2026-09-23. The landing page, for every member of staff. It shows each
    # of them the queues their other capabilities already open, and platform
    # totals, which are counts and name nobody.
    "dashboard": frozenset({PLATFORM_ADMIN, KYB_REVIEWER, INTEGRITY_REVIEWER, SUPPORT_AGENT}),
    # 2026-09-24. The skills and cities employers filter by. Support edits
    # them too (client, 2026-09-24): an option is a suggestion that names
    # nobody and prices nothing, and every change is audited.
    "search_filters": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    # 2026-09-29. What the course teaches, and when it goes on sale. A lesson
    # counts toward a score once watched, so building the course is the
    # admin's alone, as the price of anything is.
    "courses": frozenset({PLATFORM_ADMIN}),
    # 2026-09-29, the full candidate page the client asked for. The CV is
    # what anyone who can open a candidate is already looking into, the
    # integrity reviewer above all. A recording is a person's own voice, and
    # nothing about reviewing a CV needs it, so the integrity reviewer does
    # not hear them.
    "candidate_resume": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT, INTEGRITY_REVIEWER}),
    # The onboarding page carries the whole phone number and email: support
    # contacts people; reviewing a CV does not need to.
    "candidate_contact": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
    "candidate_recordings": frozenset({PLATFORM_ADMIN, SUPPORT_AGENT}),
}


# ---------------------------------------------------------------------------
# Disputes
# ---------------------------------------------------------------------------
DISPUTE_KINDS: Final = ("HIRE", "PAYMENT", "ACCOUNT", "OTHER")
DISPUTE_PARTIES: Final = ("CANDIDATE", "EMPLOYER", "COLLEGE")
DISPUTE_STATES: Final = ("OPEN", "IN_REVIEW", "RESOLVED", "REJECTED")
CLOSED_DISPUTE_STATES: Final = frozenset({"RESOLVED", "REJECTED"})
#: How a dispute arrived. `HIRE_DISPUTE` is opened for the candidate when they
#: say a hire did not happen (`applications.hire_disputed`).
DISPUTE_SOURCES: Final = ("RAISED", "HIRE_DISPUTE")

DisputeKind = Literal["HIRE", "PAYMENT", "ACCOUNT", "OTHER"]
DisputeParty = Literal["CANDIDATE", "EMPLOYER", "COLLEGE"]
DisputeOutcome = Literal["RESOLVED", "REJECTED"]

DISPUTE_TRANSITIONS: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("OPEN", "IN_REVIEW"),
        ("OPEN", "RESOLVED"),
        ("OPEN", "REJECTED"),
        ("IN_REVIEW", "RESOLVED"),
        ("IN_REVIEW", "REJECTED"),
    }
)

#: What each group may dispute. A college has no applications, so it cannot
#: dispute a hire; everyone can dispute a payment or their account.
KINDS_BY_PARTY: Final[dict[str, frozenset[str]]] = {
    "CANDIDATE": frozenset(DISPUTE_KINDS),
    "EMPLOYER": frozenset(DISPUTE_KINDS),
    "COLLEGE": frozenset({"PAYMENT", "ACCOUNT", "OTHER"}),
}

_PARTY_BY_ROLE: Final[dict[str, str]] = {
    "CANDIDATE": "CANDIDATE",
    "EMPLOYER_OWNER": "EMPLOYER",
    "EMPLOYER_RECRUITER": "EMPLOYER",
    "COLLEGE_ADMIN": "COLLEGE",
    "COLLEGE_STAFF": "COLLEGE",
}
#: The roles that may raise a dispute. A viewer reads; raising a dispute on
#: an organisation's behalf is acting for it.
DISPUTE_RAISER_ROLES: Final[frozenset[str]] = frozenset(_PARTY_BY_ROLE)

MAX_DISPUTE_DESCRIPTION: Final = 2000
MAX_RESOLUTION: Final = 2000


def party_for_role(role: str) -> str | None:
    return _PARTY_BY_ROLE.get(role)


def dispute_refusal(*, party: str, kind: str, has_application: bool) -> str | None:
    """Why a dispute cannot be raised as asked, or None.

    A HIRE dispute names the application; nothing else does, because an
    application id on a payment dispute is a cross-link nobody asked for and
    that the queue would then have to explain.
    """
    if kind not in KINDS_BY_PARTY.get(party, frozenset()):
        return "dispute_kind_not_allowed"
    if (kind == "HIRE") != has_application:
        return (
            "dispute_application_required" if kind == "HIRE" else "dispute_application_unexpected"
        )
    return None


def dispute_transition_refusal(current: str, target: str) -> str | None:
    if current in CLOSED_DISPUTE_STATES:
        return "dispute_closed"
    if (current, target) not in DISPUTE_TRANSITIONS:
        return "dispute_transition_invalid"
    return None


# ---------------------------------------------------------------------------
# What a drill-down shows of a person's contact details
# ---------------------------------------------------------------------------
_DIGITS: Final = re.compile(r"\d")


def mask_phone(phone: str | None) -> str | None:
    """`+919876543210` -> `+91******3210`.

    A support agent confirming "is this your number ending 3210?" needs the
    last four digits and nothing more. The full number would put every
    candidate's phone one console screen away from anyone with the role.
    """
    if not phone:
        return None
    digits = [i for i, ch in enumerate(phone) if _DIGITS.match(ch)]
    if len(digits) <= 4:
        return "*" * len(phone)
    keep_prefix = 2 if phone.startswith("+") else 0
    hidden = set(digits[keep_prefix:-4])
    return "".join("*" if i in hidden else ch for i, ch in enumerate(phone))


def mask_email(email: str | None) -> str | None:
    """`priya.sharma@example.com` -> `p***@example.com`. The domain stays: it
    is how support tells a work address from a personal one."""
    if not email or "@" not in email:
        return None
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


# ---------------------------------------------------------------------------
# The dashboard
# ---------------------------------------------------------------------------
#: The dashboard sections that are a queue, each shown only to a role holding
#: the capability that opens that queue. A KYB reviewer's landing page does
#: not count integrity signals they could not open.
DashboardSection = Literal["kyb", "integrity", "disputes", "tenants"]
DASHBOARD_SECTIONS: Final[tuple[DashboardSection, ...]] = (
    "kyb",
    "integrity",
    "disputes",
    "tenants",
)

#: India keeps one offset all year. A day on the chart is a reviewer's day.
IST: Final = timezone(timedelta(hours=5, minutes=30), "IST")
#: The same zone by its Postgres name. Not "+05:30", which Postgres reads
#: with the sign reversed.
IST_ZONE_NAME: Final = "Asia/Kolkata"
THROUGHPUT_DAYS: Final = 14
OLDEST_ITEMS: Final = 5


def dashboard_sections(role: str) -> frozenset[DashboardSection]:
    """The queue sections `role` sees, straight from `CONSOLE_ROLES`."""
    return frozenset(s for s in DASHBOARD_SECTIONS if role in CONSOLE_ROLES[s])


def throughput_start(now: datetime) -> datetime:
    """Midnight IST at the start of the chart's first day; today is the last."""
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    first = now.astimezone(IST).date() - timedelta(days=THROUGHPUT_DAYS - 1)
    return datetime.combine(first, time.min, IST)


def throughput_series(
    intake: dict[date, int], cleared: dict[date, int], *, now: datetime
) -> list[tuple[date, int, int]]:
    """`(IST date, intake, cleared)` for every day of the chart, oldest
    first, zeros included -- a quiet day is a bar of zero, not a gap."""
    first = throughput_start(now).date()
    days = [first + timedelta(days=i) for i in range(THROUGHPUT_DAYS)]
    return [(day, intake.get(day, 0), cleared.get(day, 0)) for day in days]
