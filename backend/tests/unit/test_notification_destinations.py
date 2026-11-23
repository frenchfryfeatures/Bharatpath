"""Where a notification leads, and the end-of-day reminder's window
(2026-11-23). Pure: no database, no provider."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.modules.notifications import push
from app.modules.notifications.domain import (
    DAILY_REMINDER_TEMPLATE,
    Destination,
    daily_reminder_due,
    destination_for,
)
from app.modules.notifications.templates import IN_APP_TEMPLATES, template_by_code

APP = str(uuid.uuid4())
JOB = str(uuid.uuid4())
SESSION = str(uuid.uuid4())


@pytest.mark.parametrize(
    "code",
    [
        "IN_APP_APPLICATION_SENT",
        "IN_APP_APPLICATION_UPDATE",
        "IN_APP_INTERVIEW_INVITATION",
        "IN_APP_ASSESSMENT_INVITATION",
        "IN_APP_EMPLOYER_MESSAGE",
    ],
)
def test_application_messages_open_their_application(code: str) -> None:
    # The id on the payload wins: a message's aggregate is the message.
    assert destination_for(
        code,
        aggregate_type="application_message",
        aggregate_id=str(uuid.uuid4()),
        payload={"application_id": APP},
    ) == Destination("APPLICATION", APP)


def test_an_application_event_without_the_key_uses_its_aggregate() -> None:
    assert destination_for(
        "IN_APP_APPLICATION_SENT", aggregate_type="application", aggregate_id=APP, payload={}
    ) == Destination("APPLICATION", APP)


def test_a_message_whose_event_is_gone_still_opens_the_right_screen() -> None:
    assert destination_for(
        "IN_APP_EMPLOYER_MESSAGE", aggregate_type=None, aggregate_id=None, payload=None
    ) == Destination("APPLICATIONS")


def test_destinations_follow_the_template() -> None:
    cases = {
        "IN_APP_SHORTLIST_INVITED": (
            {"job_id": JOB},
            "shortlist",
            Destination("JOB", JOB),
        ),
        "IN_APP_INTERVIEW_FEEDBACK_READY": (
            {"session_id": SESSION},
            "interview_session",
            Destination("INTERVIEW_REPORT", SESSION),
        ),
        "IN_APP_PAYMENT_FAILED": ({}, None, Destination("SUBSCRIPTION")),
        "IN_APP_PROFILE_INCOMPLETE": ({}, None, Destination("PROFILE")),
        DAILY_REMINDER_TEMPLATE: ({}, None, Destination("STREAK")),
        "IN_APP_DISPUTE_ANSWERED": ({}, None, Destination("INBOX")),
    }
    for code, (payload, aggregate, expected) in cases.items():
        got = destination_for(code, aggregate_type=aggregate, aggregate_id=None, payload=payload)
        assert got == expected, code


def test_a_malformed_id_is_never_passed_on() -> None:
    got = destination_for(
        "IN_APP_APPLICATION_UPDATE",
        aggregate_type="application",
        aggregate_id="../../admin",
        payload={"application_id": "not-a-uuid"},
    )
    assert got == Destination("APPLICATIONS")


def test_push_carries_the_destination_and_not_the_text() -> None:
    payload = push.push_payload(
        token="ExpoPushToken[example]",
        notification_id="n1",
        template_code="IN_APP_APPLICATION_UPDATE",
        destination={"kind": "APPLICATION", "id": APP},
    )
    assert payload["data"] == {
        "notificationId": "n1",
        "destination": {"kind": "APPLICATION", "id": APP},
    }
    assert payload["body"] == "You have a new update. Open BharatPath to read it."


def test_the_reminder_is_an_in_app_template_with_no_variables() -> None:
    template = template_by_code(DAILY_REMINDER_TEMPLATE)
    assert template is not None and template in IN_APP_TEMPLATES
    assert template.variables == ()


@pytest.mark.parametrize(
    ("utc_hour", "due"),
    # 14:30 UTC is 20:00 IST; 17:30 UTC is 23:00 IST.
    [(14, False), (15, True), (17, True), (18, False), (3, False)],
)
def test_the_reminder_is_sent_only_in_the_evening_ist(utc_hour: int, due: bool) -> None:
    now = datetime(2026, 11, 23, utc_hour, 0, tzinfo=UTC)
    assert daily_reminder_due(now) is due
