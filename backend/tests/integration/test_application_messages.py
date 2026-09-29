"""An employer writing to an applicant (2026-09-29): an interview or
online-assessment invitation, or a note, sent to the candidate by email and in
the app -- without the employer ever seeing the candidate's address."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.modules.notifications.providers import StubEmailProvider
from tests.integration.test_notifications import (
    _dispatch,
    _event_id,
    _give_email,
    _rows,
    _send,
)
from tests.integration.test_payments import _scalar
from tests.integration.test_pipeline import PIPELINE, _applied, _walk

pytestmark = pytest.mark.integration

LINK = "https://meet.example.com/abc-defg"


@pytest.fixture
def stub_email(monkeypatch: pytest.MonkeyPatch) -> StubEmailProvider:
    from app.modules.notifications import service

    provider = StubEmailProvider()
    monkeypatch.setattr(service, "get_email_provider", lambda: provider)
    return provider


def _soon() -> str:
    return (datetime.now(UTC) + timedelta(days=2)).isoformat()


async def _send_message(client: Any, a: dict[str, Any], **body: Any) -> Any:
    return await client.post(
        f"{PIPELINE}/{a['id']}/messages", json=body, headers=a["employer"]["headers"]
    )


async def test_an_interview_invitation_reaches_the_candidate_by_email_and_in_the_app(
    client: Any, mint_token: Any, stub_email: StubEmailProvider
) -> None:
    a = await _applied(client, mint_token)
    email = await _give_email(a["candidate"]["id"])
    sent = await _send_message(
        client,
        a,
        kind="INTERVIEW",
        body="Please bring your certificates.",
        scheduled_at=_soon(),
        link=LINK,
    )
    assert sent.status_code == 201, sent.text
    message = sent.json()
    assert message["sender_id"] and email not in sent.text

    event_id = await _event_id("applications.message_sent", message["id"])
    assert await _send(await _dispatch(event_id)) == ["SENT"]
    [mail] = stub_email.sent
    assert mail["to"] == email and mail["subject"] == "An interview invitation"
    for part in (a["employer"]["name"], LINK, "Please bring your certificates.", "IST"):
        assert part in mail["body"], part
    [in_app] = [r for r in await _rows(source_event_id=event_id) if r["channel"] == "IN_APP"]
    assert in_app["template_code"] == "IN_APP_INTERVIEW_INVITATION"

    # Audited without the words; counted as the employer being active.
    metadata = await _scalar(
        "SELECT metadata::text FROM audit_events "
        "WHERE action = 'application_message_sent' AND target_id = :a",
        a=a["id"],
    )
    assert "INTERVIEW" in metadata and "certificates" not in metadata


async def test_the_candidate_reads_their_messages_without_learning_who_sent_them(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    await _send_message(
        client, a, kind="ASSESSMENT", body="Complete the test.", link=LINK, scheduled_at=_soon()
    )
    await _send_message(client, a, kind="GENERAL", body="Thanks for your time.")

    mine = await client.get(
        f"/api/v1/candidate/applications/{a['id']}/messages", headers=a["candidate"]["headers"]
    )
    assert mine.status_code == 200, mine.text
    assert [m["kind"] for m in mine.json()] == ["ASSESSMENT", "GENERAL"]
    assert all("sender_id" not in m for m in mine.json())
    assert mine.json()[0]["employer_name"] == a["employer"]["name"]

    theirs = await client.get(f"{PIPELINE}/{a['id']}/messages", headers=a["employer"]["headers"])
    assert [m["kind"] for m in theirs.json()] == ["ASSESSMENT", "GENERAL"]


async def test_an_assessment_with_a_deadline_says_so(
    client: Any, mint_token: Any, stub_email: StubEmailProvider
) -> None:
    a = await _applied(client, mint_token)
    await _give_email(a["candidate"]["id"])
    sent = await _send_message(
        client, a, kind="ASSESSMENT", body="Forty minutes.", link=LINK, scheduled_at=_soon()
    )
    event_id = await _event_id("applications.message_sent", sent.json()["id"])
    await _send(await _dispatch(event_id))
    [mail] = stub_email.sent
    assert "online assessment by" in mail["body"] and LINK in mail["body"]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"kind": "INTERVIEW", "body": "Come in."}, "message_time_required"),
        ({"kind": "ASSESSMENT", "body": "Take it."}, "message_link_required"),
        (
            {"kind": "ASSESSMENT", "body": "Take it.", "link": "http://test.example.com"},
            "message_link_invalid",
        ),
        (
            {"kind": "INTERVIEW", "body": "Come in.", "scheduled_at": "2020-01-01T10:00:00Z"},
            "message_time_in_past",
        ),
    ],
)
async def test_a_message_that_cannot_be_sent_is_refused(
    client: Any, mint_token: Any, body: dict[str, Any], code: str
) -> None:
    a = await _applied(client, mint_token)
    refused = await _send_message(client, a, **body)
    assert refused.status_code == 422 and refused.json()["code"] == code
    assert (
        await _scalar(
            "SELECT count(*) FROM application_messages WHERE application_id = :a", a=a["id"]
        )
        == 0
    )


async def test_nobody_else_can_write_to_or_read_an_applicant(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    other = await _applied(client, mint_token)
    intruder = await client.post(
        f"{PIPELINE}/{a['id']}/messages",
        json={"kind": "GENERAL", "body": "Hello."},
        headers=other["employer"]["headers"],
    )
    assert intruder.status_code == 404
    peek = await client.get(
        f"/api/v1/candidate/applications/{a['id']}/messages",
        headers=other["candidate"]["headers"],
    )
    assert peek.status_code == 404


async def test_a_closed_application_takes_no_messages_and_one_candidate_is_not_flooded(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    for n in range(10):
        ok = await _send_message(client, a, kind="GENERAL", body=f"Message {n}.")
        assert ok.status_code == 201, ok.text
    flood = await _send_message(client, a, kind="GENERAL", body="One more.")
    assert flood.status_code == 429 and flood.json()["code"] == "message_limit_reached"

    closed = await _applied(client, mint_token)
    await _walk(client, closed, "REJECTED")
    refused = await _send_message(client, closed, kind="GENERAL", body="Sorry.")
    assert refused.status_code == 409
    assert refused.json()["code"] == "message_not_allowed_at_stage"
