"""admin - pure domain logic

Queues, drill-downs, disputes, suspensions.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Who may do what in the console** is no longer here (2026-11-19). It was
the `CONSOLE_ROLES` map, four hardcoded roles; it is now the permission
catalogue in `app/core/staff_permissions.py` and the role assignments in the
`access` module, and every route names its permission.

**Disputes** are raised by all three external groups and closed by us. The
machine is small on purpose -- open, being looked at, closed one of two ways
-- and it lives twice from one source: `DISPUTE_TRANSITIONS` below, and
`guard_dispute_write` in the baseline, generated from it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Final, Literal

# ---------------------------------------------------------------------------
# The sales follow-up list (2026-10-13)
# ---------------------------------------------------------------------------
#: Where a candidate is between signing up and paying. **Computed on read,
#: never stored**, from rows that already exist, so it cannot disagree with
#: them. In precedence order: the first that holds is the stage.
#:
#: * PAID -- a candidate subscription exists. A row is written only once a
#:   verified payment bought its first period, so a lapsed one still counts:
#:   they paid, and win-back is a different list.
#: * COLLEGE_SEAT -- a live college seat gives them access without paying us.
#: * RESUME_DOWNLOADED -- took a built resume away (`resume_builder_drafts`).
#: * PROFILE_COMPLETE -- answered the onboarding questions.
#: * SIGNED_UP -- has an account, and nothing else yet.
LEAD_STAGES: Final = ("PAID", "COLLEGE_SEAT", "RESUME_DOWNLOADED", "PROFILE_COMPLETE", "SIGNED_UP")
LeadStage = Literal["PAID", "COLLEGE_SEAT", "RESUME_DOWNLOADED", "PROFILE_COMPLETE", "SIGNED_UP"]
#: What the list shows when not told otherwise: everyone not yet paying us.
UNPAID_STAGES: Final[tuple[LeadStage, ...]] = (
    "RESUME_DOWNLOADED",
    "PROFILE_COMPLETE",
    "SIGNED_UP",
)


def lead_stage(*, paid: bool, seated: bool, downloaded: bool, profile_completed: bool) -> str:
    """The rule `repository.leads` applies in SQL, once more in Python so it
    can be read and tested on its own. An integration test holds the two equal."""
    if paid:
        return "PAID"
    if seated:
        return "COLLEGE_SEAT"
    if downloaded:
        return "RESUME_DOWNLOADED"
    if profile_completed:
        return "PROFILE_COMPLETE"
    return "SIGNED_UP"


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
# Searching for a person (2026-10-21)
# ---------------------------------------------------------------------------
def partial_contact_search(reads_whole_contacts: bool) -> bool:
    """Whether a caller may find someone by **part** of an email or phone.

    Only one that already reads a whole contact (`candidate_contact.view`,
    held for every organisation).
    Anyone else matches the whole address or number: on a list that masks
    contacts, a partial match answers "does any address contain `a`, `ab`,
    `abc`...?" and spells out the hidden contact one character at a time.
    A name is shown on the row anyway, so part of a name is for everyone."""
    return reads_whole_contacts


@dataclass(frozen=True)
class PersonSearch:
    """A list's one search box (`q`), matched against a person's name, email
    and phone at once: a row matches if any of the three does.

    The service hands over `name` (the text, trimmed), `email` (the text,
    normalised) and `phone` (its digits, only when the text looks like a
    phone number). Part of the name always matches; part of the email or
    phone only when `partial_contact` -- otherwise the whole address or
    number (`partial_contact_search`)."""

    name: str | None = None
    email: str | None = None
    phone: str | None = None
    partial_contact: bool = False

    @property
    def given(self) -> bool:
        return any(v is not None for v in (self.name, self.email, self.phone))

    def audit(self) -> dict[str, bool]:
        """What the audit row says about the search: that one was made, and
        whether contacts matched in part. Never the text searched for."""
        return {"searched": self.given, "partial_contact": self.partial_contact}


# ---------------------------------------------------------------------------
# The dashboard
# ---------------------------------------------------------------------------
#: The dashboard sections that are a queue, each shown only to someone
#: holding the permission that opens that queue. A KYB reviewer's landing page
#: does not count integrity signals they could not open.
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


#: The permission that opens each queue section's queue.
SECTION_PERMISSION: Final[dict[DashboardSection, str]] = {
    "kyb": "kyb.view",
    "integrity": "integrity.view",
    "disputes": "disputes.view",
    "tenants": "organisations.view",
}


def dashboard_sections(permissions: frozenset[str]) -> frozenset[DashboardSection]:
    """The queue sections someone holding `permissions` (for every
    organisation) sees: each queue's own permission, never a list by hand."""
    return frozenset(s for s in DASHBOARD_SECTIONS if SECTION_PERMISSION[s] in permissions)


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
