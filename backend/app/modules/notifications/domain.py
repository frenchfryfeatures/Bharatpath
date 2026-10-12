"""notifications - pure domain logic

Event to channel fan-out, templates.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

Three decisions live here, each one a table or a function a test can read:

* **`plan_for`** -- which event tells whom, with which templates. Events carry
  identifiers only; the service resolves names and contacts.
* **`delivery_decision`** -- the gates a message passes in order, and the one
  that stopped it. A skipped message is still recorded with its reason: "we
  never told them" is a dispute we must be able to answer.
* **`NudgeRules`** -- the incomplete-profile reminder (R9). Capped, spaced,
  quiet at night and stoppable, because nudging the same person daily forever
  is the failure this feature exists to avoid.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import datetime, timedelta, timezone
from typing import Final, Literal

from app.modules.notifications.templates import (
    MAX_VARIABLE_CHARS,
    MessageTemplate,
    is_dlt_ready,
    template_by_code,
)

IST: Final = timezone(timedelta(hours=5, minutes=30), "IST")

Channel = Literal["SMS", "EMAIL", "PUSH", "IN_APP"]
Category = Literal["TRANSACTIONAL", "NUDGE"]

NOTIFICATION_STATES: Final = ("PENDING", "SENT", "DELIVERED", "SKIPPED", "FAILED")
SKIP_REASONS: Final = (
    "ACCOUNT_INACTIVE",
    "OPTED_OUT",
    "SUPPRESSED",
    "NO_CONTACT",
    "DLT_UNREGISTERED",
    "PROVIDER_UNCONFIGURED",
)
CHANNELS: Final = ("SMS", "EMAIL", "PUSH", "IN_APP")
CATEGORIES: Final = ("TRANSACTIONAL", "NUDGE")
SUPPRESSION_REASONS: Final = ("BOUNCED", "COMPLAINED", "SUPPORT_REQUEST")

# ---------------------------------------------------------------------------
# Fan-out
# ---------------------------------------------------------------------------
Audience = Literal[
    #: `payload.candidate_id`
    "CANDIDATE",
    #: `payload.user_id`
    "USER",
    #: the owners of `payload.tenant_id` (employer)
    "EMPLOYER_OWNERS",
    #: the admins of `payload.tenant_id` (college)
    "COLLEGE_ADMINS",
    #: `payload.subscriber_*`: the person, or the organisation's owners/admins
    "SUBSCRIBER",
    #: the roster entry `aggregate_id` names, which may have no account
    "ROSTER_CONTACT",
    #: `payload.raised_by`
    "DISPUTE_RAISER",
    #: our staff who review KYB: `KYB_REVIEWER_ROLES` in the platform tenant
    "KYB_REVIEWERS",
]

#: The staff a submission waiting for review is announced to. The roles
#: holding the console's `kyb` capability; a test holds the two equal.
KYB_REVIEWER_ROLES: Final = frozenset({"PLATFORM_ADMIN", "KYB_REVIEWER"})

#: Variables the service resolves from identifiers in the payload.
#: `message`, `when` and `link` belong to an employer's message to an applicant
#: (2026-09-29), read at dispatch from the message the payload names.
#: `reason` is a KYB reviewer's words to the organisation (2026-10-10), read
#: at dispatch from the submission `payload.submission_id` names.
Variable = Literal["employer", "college", "amount", "date", "message", "when", "link", "reason"]


@dataclass(frozen=True, slots=True)
class Planned:
    audience: Audience
    templates: tuple[str, ...]
    variables: tuple[Variable, ...] = ()
    #: Sent whatever the recipient's channel preferences say. Only for a
    #: notice the law requires: the UPI pre-debit notice. Never for a nudge.
    mandatory: bool = False


#: Stages a candidate hears about. VIEWED is not one: it is recorded when an
#: employer merely opens an application, and a message for every glance is
#: noise that teaches people to ignore the ones that matter.
#: HIRED is the candidate's own confirmation and EXPIRED has its own event,
#: so neither is here.
NOTIFIED_STAGES: Final = frozenset({"SHORTLISTED", "INTERVIEW", "DECISION", "REJECTED"})

#: Every event notifications consumes. `app/tasks/routing.py` subscribes the
#: dispatch task to exactly these, so the list and the routing cannot drift.
NOTIFYING_EVENTS: Final = frozenset(
    {
        "applications.application_submitted",
        "applications.stage_changed",
        "applications.interview_scheduled",
        "applications.hire_proposed",
        "applications.application_expired",
        "applications.message_sent",
        "applications.shortlist_invited",
        "billing.payment_succeeded",
        "billing.payment_failed",
        "subscriptions.state_changed",
        "subscriptions.pre_debit_notified",
        "kyb.approved",
        "kyb.submitted",
        "kyb.reviewed",
        "college.consent_revoked",
        "college.invitation_sent",
        "interview.session_evaluated",
        "admin.dispute_closed",
    }
)


def plan_for(event_type: str, payload: dict[str, object]) -> tuple[Planned, ...]:
    """Who hears about this event, and how. Empty when nobody should.

    **No template takes the score, a band or a threshold**, and nothing here
    can ask for one: `Variable` has no member for it, and `notifications`
    may not import `scoring` (import-linter).

    **Email and in-app only** (2026-09-18): no SMS is sent until the client
    has DLT and a sender, and a unit test holds that nothing here names one.
    """
    candidate_update = Planned(
        "CANDIDATE", ("EMAIL_APPLICATION_UPDATE", "IN_APP_APPLICATION_UPDATE"), ("employer",)
    )
    if event_type == "applications.application_submitted":
        return (
            Planned(
                "CANDIDATE", ("EMAIL_APPLICATION_SENT", "IN_APP_APPLICATION_SENT"), ("employer",)
            ),
        )
    if event_type == "applications.stage_changed":
        return (candidate_update,) if payload.get("to_stage") in NOTIFIED_STAGES else ()
    if event_type in (
        "applications.interview_scheduled",
        "applications.hire_proposed",
        "applications.application_expired",
    ):
        return (candidate_update,)
    if event_type == "applications.message_sent":
        return (message_plan(payload),)
    if event_type == "applications.shortlist_invited":
        return (
            Planned(
                "CANDIDATE",
                ("EMAIL_SHORTLIST_INVITED", "IN_APP_SHORTLIST_INVITED"),
                ("employer",),
            ),
        )
    if event_type == "billing.payment_succeeded":
        return (Planned("USER", ("IN_APP_PAYMENT_RECEIVED",)),)
    if event_type == "billing.payment_failed":
        return (Planned("USER", ("EMAIL_PAYMENT_FAILED", "IN_APP_PAYMENT_FAILED")),)
    if event_type == "subscriptions.state_changed":
        if payload.get("to_state") != "LAPSED":
            return ()
        return (Planned("SUBSCRIBER", ("EMAIL_ACCESS_ENDED", "IN_APP_ACCESS_ENDED")),)
    if event_type == "subscriptions.pre_debit_notified":
        return (
            Planned(
                "SUBSCRIBER",
                ("EMAIL_MANDATE_PRE_DEBIT", "IN_APP_PRE_DEBIT"),
                ("amount", "date"),
                mandatory=True,
            ),
        )
    if event_type == "kyb.approved":
        return (Planned("EMPLOYER_OWNERS", ("EMAIL_KYB_APPROVED", "IN_APP_KYB_APPROVED")),)
    if event_type == "kyb.submitted":
        # Only while approval is manual: an automatic one emits kyb.approved.
        # Staff hear in their inbox, never by email (2026-10-10).
        template = (
            "IN_APP_KYB_RESUBMITTED" if payload.get("resubmission") else "IN_APP_KYB_SUBMITTED"
        )
        return (Planned("KYB_REVIEWERS", (template,), ("employer",)),)
    if event_type == "kyb.reviewed":
        decision = payload.get("decision")
        if decision == "APPROVED":
            return (Planned("EMPLOYER_OWNERS", ("EMAIL_KYB_APPROVED", "IN_APP_KYB_APPROVED")),)
        if decision == "MORE_INFO_REQUIRED":
            return (
                Planned(
                    "EMPLOYER_OWNERS",
                    ("EMAIL_KYB_NEEDS_INFO", "IN_APP_KYB_NEEDS_INFO"),
                    ("reason",),
                ),
            )
        if decision == "REJECTED":
            return (
                Planned(
                    "EMPLOYER_OWNERS", ("EMAIL_KYB_REJECTED", "IN_APP_KYB_REJECTED"), ("reason",)
                ),
            )
        return ()
    if event_type == "college.consent_revoked":
        scopes = payload.get("scopes")
        scopes = scopes if isinstance(scopes, list) else []
        template = (
            "IN_APP_COLLEGE_STUDENT_DISCONNECTED"
            if "ROSTER" in scopes
            else "IN_APP_COLLEGE_STUDENT_STOPPED_SHARING"
        )
        return (Planned("COLLEGE_ADMINS", (template,)),)
    if event_type == "college.invitation_sent":
        return (
            Planned(
                "ROSTER_CONTACT",
                # Email only. A roster contact given by phone alone hears
                # nothing until SMS returns.
                ("EMAIL_COLLEGE_INVITATION",),
                ("college",),
            ),
        )
    if event_type == "interview.session_evaluated":
        if payload.get("outcome") != "EVALUATED":
            return ()
        return (Planned("USER", ("IN_APP_INTERVIEW_FEEDBACK_READY",)),)
    if event_type == "admin.dispute_closed":
        return (Planned("DISPUTE_RAISER", ("IN_APP_DISPUTE_ANSWERED",)),)
    return ()


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def fit_variable(value: str, *, channel: str) -> str:
    """DLT caps a substituted SMS variable at 30 characters, and the operator
    drops a message that exceeds it rather than truncating. So we truncate,
    visibly, before sending."""
    if channel != "SMS" or len(value) <= MAX_VARIABLE_CHARS:
        return value
    return value[: MAX_VARIABLE_CHARS - 3].rstrip() + "..."


def render(text: str, variables: dict[str, str], *, channel: str) -> str:
    """Substitute `{name}` placeholders. A missing variable stays visible as
    `{name}` rather than failing the send -- the same rule as `translate`."""
    fitted = {k: fit_variable(v, channel=channel) for k, v in variables.items()}
    try:
        return text.format(**fitted)
    except (KeyError, IndexError, ValueError):
        return text


def format_amount(minor: int, *, channel: str) -> str:
    """`Rs 1,499` in an SMS, `₹1,499` elsewhere. The rupee sign is outside
    GSM-7, and one such character turns a 160-character message into a
    70-character one (templates.py)."""
    rupees, paise = divmod(minor, 100)
    number = f"{rupees:,}" if paise == 0 else f"{rupees:,}.{paise:02d}"
    return f"Rs {number}" if channel == "SMS" else f"₹{number}"


def format_moment(moment: datetime) -> str:
    """A date and a time in India, for an interview: `03 Oct 2026, 10:30 AM IST`."""
    return moment.astimezone(IST).strftime("%d %b %Y, %I:%M %p IST")


def format_date(moment: datetime) -> str:
    """The date in India, which is where the reader is: a debit at 01:00 IST
    on the 3rd is on the 3rd, not on UTC's 2nd."""
    return moment.astimezone(IST).strftime("%d %b %Y")


# ---------------------------------------------------------------------------
# Delivery gates
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Preferences:
    sms_enabled: bool = True
    email_enabled: bool = True
    push_enabled: bool = True
    nudges_enabled: bool = True


@dataclass(frozen=True, slots=True)
class Recipient:
    #: None for a roster contact who has no account.
    account_active: bool
    phone: str | None
    email: str | None


def delivery_decision(
    *,
    template: MessageTemplate,
    category: str,
    recipient: Recipient,
    preferences: Preferences,
    suppressed_channels: frozenset[str],
    provider_configured: bool,
    mandatory: bool = False,
) -> tuple[str, str | None]:
    """`(state, skip_reason)` for one message, before anything is sent.

    The order is the explanation a support agent gives, most fundamental
    first: the account, the person's choice, our suppression list, whether
    there is anywhere to send it, whether the operator will carry it, and
    whether we can send at all. An IN_APP message stops only at the first.
    """
    channel = template.channel
    if not recipient.account_active:
        return "SKIPPED", "ACCOUNT_INACTIVE"
    if channel == "IN_APP":
        return "DELIVERED", None
    if not mandatory:
        if category == "NUDGE" and not preferences.nudges_enabled:
            return "SKIPPED", "OPTED_OUT"
        enabled = {
            "SMS": preferences.sms_enabled,
            "EMAIL": preferences.email_enabled,
            "PUSH": preferences.push_enabled,
        }.get(channel, False)
        if not enabled:
            return "SKIPPED", "OPTED_OUT"
    if channel in suppressed_channels or "ALL" in suppressed_channels:
        return "SKIPPED", "SUPPRESSED"
    contact = {"SMS": recipient.phone, "EMAIL": recipient.email}.get(channel)
    if not contact:
        return "SKIPPED", "NO_CONTACT"
    if not is_dlt_ready(template):
        return "SKIPPED", "DLT_UNREGISTERED"
    if not provider_configured:
        return "SKIPPED", "PROVIDER_UNCONFIGURED"
    return "PENDING", None


# ---------------------------------------------------------------------------
# What a roster invitation can actually reach
# ---------------------------------------------------------------------------
#: Channel -> the roster column that can carry it.
_CONTACT_FIELD_FOR_CHANNEL: Final[dict[str, str]] = {"SMS": "phone", "EMAIL": "email"}

#: The event a committed roster row raises.
ROSTER_INVITATION_EVENT: Final = "college.invitation_sent"


def roster_invitation_contact_fields() -> frozenset[str]:
    """Which roster columns an invitation can actually be delivered to.

    `{"email"}` today. A roster row needs a phone *or* an email, but with SMS
    deferred (client, 2026-09-18) a phone-only row is recorded SKIPPED
    `NO_CONTACT` and the student never hears anything -- which the college
    would not otherwise know.
    `college.service` uses this to say so at preview time, before they
    commit.

    **Derived from the plan and from DLT readiness, never hardcoded.** When
    SMS returns -- a registered template id and a route in `plan_for` -- this
    answers `{"email", "phone"}` on its own and the college's preview stops
    warning about rows that are now perfectly reachable. A constant here
    would have to be remembered by whoever turns SMS back on, which is
    exactly the sort of thing nobody remembers.

    Deliberately *not* a function of whether a provider is configured. That
    is an operational state of one deployment; a roster is data, and a
    college re-uploading their CSV because our SES key was missing would be
    the wrong advice.
    """
    fields: set[str] = set()
    for planned in plan_for(ROSTER_INVITATION_EVENT, {}):
        for code in planned.templates:
            template = template_by_code(code)
            if template is None or not is_dlt_ready(template):
                continue
            field = _CONTACT_FIELD_FOR_CHANNEL.get(template.channel)
            if field is not None:
                fields.add(field)
    return frozenset(fields)


# ---------------------------------------------------------------------------
# Incomplete-profile nudges (R9)
# ---------------------------------------------------------------------------
NUDGE_TEMPLATES: Final = (
    "IN_APP_PROFILE_INCOMPLETE",
    "EMAIL_PROFILE_INCOMPLETE",
)

#: Hard limits a config row cannot cross. A row may make nudging rarer or stop
#: it; it may not make it daily or endless.
MIN_INTERVAL_FLOOR_HOURS: Final = 24
MAX_NUDGES_CEILING: Final = 6


class NudgeRulesError(ValueError):
    """A `notifications.nudges` config row that cannot be applied."""


@dataclass(frozen=True, slots=True)
class NudgeRules:
    enabled: bool = True
    #: How long after sign-up before the first nudge. A day: sooner reads as
    #: nagging someone who is still finding their CV.
    first_after_hours: int = 24
    #: Between nudges. Three days, then three days again -- ours, not the
    #: client's.
    min_interval_hours: int = 72
    #: Then stop, for good. Three unanswered reminders is an answer.
    max_nudges: int = 3
    #: Sending hours in IST, [start, end). TRAI's window for promotional
    #: traffic is 09:00-21:00; a reminder at midnight is how an unsubscribe
    #: happens even where it is technically allowed.
    send_from_hour: int = 9
    send_until_hour: int = 21


DEFAULT_NUDGE_RULES: Final = NudgeRules()


def nudge_rules_from_config(value: object) -> NudgeRules:
    """Parse a `config_values` document. **Strict**: an unknown key is likelier
    a misspelling than a decision, and a default left live while the row looks
    applied is the failure."""
    if not isinstance(value, dict):
        raise NudgeRulesError("notifications.nudges must be a JSON object")
    names = {f.name for f in fields(NudgeRules)}
    unknown = set(value) - names
    if unknown:
        raise NudgeRulesError(f"unknown nudge keys: {sorted(unknown)}")
    parsed: dict[str, object] = {}
    for name in names:
        raw = value.get(name, getattr(DEFAULT_NUDGE_RULES, name))
        if name == "enabled":
            if not isinstance(raw, bool):
                raise NudgeRulesError("enabled must be true or false")
        elif not isinstance(raw, int) or isinstance(raw, bool):
            raise NudgeRulesError(f"{name} must be an integer")
        parsed[name] = raw
    rules = NudgeRules(**parsed)  # type: ignore[arg-type]
    if rules.first_after_hours < 1:
        raise NudgeRulesError("first_after_hours must be at least 1")
    if rules.min_interval_hours < MIN_INTERVAL_FLOOR_HOURS:
        raise NudgeRulesError(f"min_interval_hours must be at least {MIN_INTERVAL_FLOOR_HOURS}")
    if not 0 <= rules.max_nudges <= MAX_NUDGES_CEILING:
        raise NudgeRulesError(f"max_nudges must be between 0 and {MAX_NUDGES_CEILING}")
    if not 0 <= rules.send_from_hour < rules.send_until_hour <= 24:
        raise NudgeRulesError(
            "sending hours must satisfy 0 <= send_from_hour < send_until_hour <= 24"
        )
    return rules


def within_sending_hours(now: datetime, rules: NudgeRules) -> bool:
    hour = now.astimezone(IST).hour
    return rules.send_from_hour <= hour < rules.send_until_hour


def nudge_due(
    *, now: datetime, sent: int, last_sent_at: datetime | None, rules: NudgeRules
) -> bool:
    """Whether this person is owed their next nudge now. The caller has already
    established they signed up long enough ago and have no CV."""
    if not rules.enabled or sent >= rules.max_nudges:
        return False
    if last_sent_at is None:
        return True
    return now - last_sent_at >= timedelta(hours=rules.min_interval_hours)


def message_plan(payload: dict[str, object]) -> Planned:
    """An employer's message to an applicant (2026-09-29), by its kind. The
    payload says only which kind and whether it has a time: the words, the
    time and the link are read at dispatch."""
    kind = payload.get("kind")
    if kind == "INTERVIEW":
        return Planned(
            "CANDIDATE",
            ("EMAIL_INTERVIEW_INVITATION", "IN_APP_INTERVIEW_INVITATION"),
            ("employer", "when", "link", "message"),
        )
    if kind == "ASSESSMENT":
        email = (
            "EMAIL_ASSESSMENT_INVITATION_DEADLINE"
            if payload.get("has_time")
            else "EMAIL_ASSESSMENT_INVITATION"
        )
        return Planned(
            "CANDIDATE",
            (email, "IN_APP_ASSESSMENT_INVITATION"),
            ("employer", "when", "link", "message"),
        )
    return Planned(
        "CANDIDATE", ("EMAIL_EMPLOYER_MESSAGE", "IN_APP_EMPLOYER_MESSAGE"), ("employer", "message")
    )
