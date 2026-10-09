"""Who hears about what, the gates a message passes, and the nudge rules."""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.modules.notifications.domain import (
    DEFAULT_NUDGE_RULES,
    NOTIFYING_EVENTS,
    NUDGE_TEMPLATES,
    NudgeRulesError,
    Preferences,
    Recipient,
    delivery_decision,
    fit_variable,
    format_amount,
    format_date,
    nudge_due,
    nudge_rules_from_config,
    plan_for,
    render,
    within_sending_hours,
)
from app.modules.notifications.templates import (
    MAX_VARIABLE_CHARS,
    TEMPLATES,
    template_by_code,
)

MODULES = Path(__file__).resolve().parents[2] / "app" / "modules"
PAYLOADS: dict[str, dict[str, object]] = {
    "applications.stage_changed": {"to_stage": "SHORTLISTED"},
    "subscriptions.state_changed": {"to_state": "LAPSED"},
    "kyb.reviewed": {"decision": "APPROVED"},
    "college.consent_revoked": {"scopes": ["ROSTER", "INDIVIDUAL"]},
    "interview.session_evaluated": {"outcome": "EVALUATED"},
}
ACTIVE = Recipient(account_active=True, phone="+919800000001", email="a@example.test")


def _plans(event: str) -> tuple:
    return plan_for(event, PAYLOADS.get(event, {}))


# --- fan-out --------------------------------------------------------------------------
@pytest.mark.parametrize("event", sorted(NOTIFYING_EVENTS))
def test_every_notifying_event_tells_someone_with_templates_that_exist(event: str) -> None:
    plans = _plans(event)
    assert plans, f"{event} is routed to notifications and tells nobody"
    for plan in plans:
        for code in plan.templates:
            template = template_by_code(code)
            assert template is not None, code
            assert set(template.variables) <= set(plan.variables), (event, code)


@pytest.mark.parametrize("event", sorted(NOTIFYING_EVENTS))
def test_every_notifying_event_is_one_a_module_actually_emits(event: str) -> None:
    """The routing is keyed on strings; a renamed event would route to nothing
    and every message it should have caused would silently stop."""
    module, name = event.split(".", 1)
    source = "".join(path.read_text(encoding="utf-8") for path in (MODULES / module).glob("*.py"))
    assert f'"{event}"' in source or f'.{name}"' in source, event


def test_a_glance_is_not_news() -> None:
    assert plan_for("applications.stage_changed", {"to_stage": "VIEWED"}) == ()
    assert plan_for("subscriptions.state_changed", {"to_state": "ACTIVE"}) == ()
    assert plan_for("kyb.reviewed", {"decision": "REJECTED"}) == ()
    assert plan_for("interview.session_evaluated", {"outcome": "FAILED"}) == ()
    assert plan_for("questionnaire.submitted", {}) == ()


def test_a_college_learns_that_a_student_left_and_never_which() -> None:
    [roster] = plan_for("college.consent_revoked", {"scopes": ["ROSTER", "INDIVIDUAL"]})
    [individual] = plan_for("college.consent_revoked", {"scopes": ["INDIVIDUAL"]})
    assert roster.templates == ("IN_APP_COLLEGE_STUDENT_DISCONNECTED",)
    assert individual.templates == ("IN_APP_COLLEGE_STUDENT_STOPPED_SHARING",)
    for plan in (roster, individual):
        template = template_by_code(plan.templates[0])
        assert template is not None and template.variables == ()


@pytest.mark.parametrize("event", sorted(NOTIFYING_EVENTS))
def test_nothing_is_sent_by_sms(event: str) -> None:
    """The client's decision of 2026-09-18: no SMS and no phone OTP until the
    organisation's registration and DLT exist. Every message goes by email and
    to the inbox. Routing an event to an SMS template again is that decision
    being reversed, and belongs in a conversation with the client first."""
    for plan in _plans(event):
        for code in plan.templates:
            template = template_by_code(code)
            assert template is not None and template.channel != "SMS", (event, code)


def test_the_pre_debit_notice_goes_by_email_and_ignores_the_email_preference() -> None:
    """UPI AutoPay requires the payer be told before every automatic debit.
    With no SMS, email is the channel that carries it outside the app."""
    [plan] = _plans("subscriptions.pre_debit_notified")
    assert plan.mandatory
    assert "EMAIL_MANDATE_PRE_DEBIT" in plan.templates
    email = template_by_code("EMAIL_MANDATE_PRE_DEBIT")
    assert email is not None and set(email.variables) == {"amount", "date"}
    assert _decide(
        "EMAIL_MANDATE_PRE_DEBIT", preferences=Preferences(email_enabled=False), mandatory=True
    ) == ("PENDING", None)


def test_only_the_pre_debit_notice_ignores_preferences() -> None:
    mandatory = {
        (event, code)
        for event in NOTIFYING_EVENTS
        for plan in _plans(event)
        if plan.mandatory
        for code in plan.templates
    }
    assert {event for event, _ in mandatory} == {"subscriptions.pre_debit_notified"}


@pytest.mark.parametrize("template", TEMPLATES, ids=[t.code for t in TEMPLATES])
def test_no_message_has_a_variable_that_could_carry_the_score(template: object) -> None:
    """An SMS is read on a lock screen. The score is behind a subscription."""
    names = " ".join(template.variables)  # type: ignore[attr-defined]
    assert not re.search(r"score|band|rank|threshold|points", names)
    body = template.body.lower()  # type: ignore[attr-defined]
    assert "score" not in body


# --- rendering -------------------------------------------------------------------------
def test_an_sms_variable_is_cut_to_the_dlt_limit_and_nothing_else_is() -> None:
    long = "Tata Consultancy Services Limited, Pune"
    assert len(fit_variable(long, channel="SMS")) == MAX_VARIABLE_CHARS
    assert fit_variable(long, channel="IN_APP") == long
    assert render("Update from {employer}.", {"employer": long}, channel="SMS").endswith("....")


def test_a_missing_variable_stays_visible() -> None:
    assert render("To {employer}.", {}, channel="IN_APP") == "To {employer}."


def test_money_in_an_sms_stays_inside_gsm_7() -> None:
    assert format_amount(149_900, channel="SMS") == "Rs 1,499"
    assert format_amount(149_950, channel="IN_APP") == "₹1,499.50"


def test_a_date_is_the_date_in_india() -> None:
    assert format_date(datetime(2026, 9, 2, 20, 0, tzinfo=UTC)) == "03 Sep 2026"


# --- delivery gates ----------------------------------------------------------------------
def _decide(code: str, **overrides: object) -> tuple[str, str | None]:
    template = template_by_code(code)
    assert template is not None
    arguments: dict[str, object] = {
        "template": template,
        "category": "TRANSACTIONAL",
        "recipient": ACTIVE,
        "preferences": Preferences(),
        "suppressed_channels": frozenset(),
        "provider_configured": True,
    }
    arguments.update(overrides)
    return delivery_decision(**arguments)  # type: ignore[arg-type]


def test_in_app_always_arrives_unless_the_account_is_gone() -> None:
    off = Preferences(sms_enabled=False, email_enabled=False, push_enabled=False)
    assert _decide(
        "IN_APP_PAYMENT_FAILED", preferences=off, suppressed_channels=frozenset({"ALL"})
    ) == ("DELIVERED", None)
    inactive = Recipient(account_active=False, phone=None, email=None)
    assert _decide("IN_APP_PAYMENT_FAILED", recipient=inactive) == ("SKIPPED", "ACCOUNT_INACTIVE")


def test_no_sms_leaves_without_a_dlt_registration_today() -> None:
    assert _decide("SMS_PAYMENT_FAILED") == ("SKIPPED", "DLT_UNREGISTERED")


def test_the_gates_run_in_the_order_support_explains_them() -> None:
    sms = template_by_code("SMS_PAYMENT_FAILED")
    assert sms is not None
    registered = replace(sms, dlt_template_id="1107000000000000001")
    assert _decide("SMS_PAYMENT_FAILED", template=registered) == ("PENDING", None)
    assert _decide("SMS_PAYMENT_FAILED", template=registered, provider_configured=False) == (
        "SKIPPED",
        "PROVIDER_UNCONFIGURED",
    )
    assert _decide(
        "SMS_PAYMENT_FAILED", template=registered, recipient=replace(ACTIVE, phone=None)
    ) == ("SKIPPED", "NO_CONTACT")
    assert _decide(
        "SMS_PAYMENT_FAILED", template=registered, suppressed_channels=frozenset({"SMS"})
    ) == ("SKIPPED", "SUPPRESSED")
    assert _decide(
        "SMS_PAYMENT_FAILED", template=registered, preferences=Preferences(sms_enabled=False)
    ) == ("SKIPPED", "OPTED_OUT")


def test_a_mandatory_notice_passes_an_opt_out_and_nothing_else() -> None:
    sms = template_by_code("SMS_MANDATE_PRE_DEBIT")
    assert sms is not None
    registered = replace(sms, dlt_template_id="1107000000000000002")
    no_sms = Preferences(sms_enabled=False)
    assert _decide(
        "SMS_MANDATE_PRE_DEBIT", template=registered, preferences=no_sms, mandatory=True
    ) == (
        "PENDING",
        None,
    )
    assert _decide(
        "SMS_MANDATE_PRE_DEBIT",
        template=registered,
        mandatory=True,
        suppressed_channels=frozenset({"SMS"}),
    ) == ("SKIPPED", "SUPPRESSED")


def test_turning_nudges_off_stops_every_nudge_channel() -> None:
    email = template_by_code("EMAIL_PROFILE_INCOMPLETE")
    assert email is not None
    assert _decide(
        "EMAIL_PROFILE_INCOMPLETE", category="NUDGE", preferences=Preferences(nudges_enabled=False)
    ) == ("SKIPPED", "OPTED_OUT")
    assert _decide("EMAIL_PROFILE_INCOMPLETE", category="NUDGE") == ("PENDING", None)


# --- nudges ------------------------------------------------------------------------------------
def test_every_nudge_template_exists_and_none_is_an_sms() -> None:
    templates = [template_by_code(code) for code in NUDGE_TEMPLATES]
    assert all(templates)
    assert not [t for t in templates if t is not None and t.channel == "SMS"]
    # The draft is kept for when SMS returns, in the category that needs the
    # recorded consent a reminder to a DND number requires.
    kept = template_by_code("SMS_PROFILE_INCOMPLETE")
    assert kept is not None and kept.dlt_category == "SERVICE_EXPLICIT"


def test_the_default_rules_are_ours_and_reasonable() -> None:
    rules = DEFAULT_NUDGE_RULES
    assert (rules.first_after_hours, rules.min_interval_hours, rules.max_nudges) == (24, 72, 3)


@pytest.mark.parametrize(
    "value",
    [
        {"max_nudges": "3"},
        {"min_interval_hours": 12},
        {"max_nudges": 50},
        {"send_from_hour": 21, "send_until_hour": 9},
        {"enabled": 1},
        {"cadence": "daily"},
        [],
    ],
    ids=[
        "string",
        "daily",
        "endless",
        "inverted-hours",
        "int-flag",
        "unknown-key",
        "not-an-object",
    ],
)
def test_a_config_row_cannot_make_nudging_daily_endless_or_ambiguous(value: object) -> None:
    with pytest.raises(NudgeRulesError):
        nudge_rules_from_config(value)


def test_a_config_row_can_make_nudging_rarer_or_stop_it() -> None:
    rules = nudge_rules_from_config({"min_interval_hours": 168, "max_nudges": 1})
    assert (rules.min_interval_hours, rules.max_nudges) == (168, 1)
    assert nudge_rules_from_config({"enabled": False}).enabled is False


def test_nudges_wait_their_interval_and_then_stop() -> None:
    now = datetime(2026, 9, 17, 8, 0, tzinfo=UTC)
    rules = DEFAULT_NUDGE_RULES
    assert nudge_due(now=now, sent=0, last_sent_at=None, rules=rules)
    assert not nudge_due(now=now, sent=1, last_sent_at=now - timedelta(hours=71), rules=rules)
    assert nudge_due(now=now, sent=1, last_sent_at=now - timedelta(hours=72), rules=rules)
    assert not nudge_due(now=now, sent=3, last_sent_at=now - timedelta(days=90), rules=rules)
    assert not nudge_due(now=now, sent=0, last_sent_at=None, rules=replace(rules, enabled=False))


def test_nobody_is_nudged_at_night_in_india() -> None:
    rules = DEFAULT_NUDGE_RULES
    assert within_sending_hours(datetime(2026, 9, 17, 3, 30, tzinfo=UTC), rules)  # 09:00 IST
    assert not within_sending_hours(datetime(2026, 9, 17, 3, 29, tzinfo=UTC), rules)
    assert not within_sending_hours(datetime(2026, 9, 17, 15, 30, tzinfo=UTC), rules)  # 21:00
