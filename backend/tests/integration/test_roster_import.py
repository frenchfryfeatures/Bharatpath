"""Through HTTP and the database: roster import and invitations.

A roster is previewed before anything happens (SRS 2.25.3), committed
idempotently, and its invitations are found by the student from their own
verified contact -- never from anything the college can see about who has an
account. Accepting is invite-and-accept consent, ROSTER scope only.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.college.domain import CONSENT_VERSION
from tests.conftest import _seed_url, sessions
from tests.integration.test_college import APP_URL, COLLEGE, STUDENT, _allocate, _college
from tests.integration.test_payments import _scalar

pytestmark = pytest.mark.integration

IMPORTS = f"{COLLEGE}/roster-imports"


def _phone() -> str:
    return f"9{uuid.uuid4().int % 10**9:09d}"


async def _student(mint_token: Any, phone: str) -> dict[str, Any]:
    """A candidate whose verified phone is `+91<phone>`."""
    user_id, subject = uuid.uuid4(), f"local-test-{uuid.uuid4()}"
    number = f"+91{phone}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, phone, status, locale) "
                "VALUES (:u, :s, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "s": subject, "p": number},
        )
    headers, _ = mint_token(pool="CANDIDATE", subject=subject, phone=number)
    return {"id": user_id, "headers": headers}


async def _upload(client: Any, college: dict[str, Any], csv: str, name: str = "roster.csv") -> Any:
    return await client.post(
        IMPORTS, json={"file_name": name, "csv": csv}, headers=college["headers"]
    )


async def _committed_and_sent(client: Any, college: dict[str, Any], csv: str) -> str:
    upload = await _upload(client, college, csv)
    assert upload.status_code == 201, upload.text
    import_id = upload.json()["id"]
    assert (
        await client.post(f"{IMPORTS}/{import_id}/commit", headers=college["headers"])
    ).status_code == 200
    sent = await client.post(f"{IMPORTS}/{import_id}/invitations/send", headers=college["headers"])
    assert sent.status_code == 200, sent.text
    return str(import_id)


# ===========================================================================
# Preview
# ===========================================================================
async def test_a_roster_is_previewed_row_by_row_before_anything_happens(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    good, dup = _phone(), _phone()
    csv = (
        "name,phone,email,student_ref,caste\n"
        f"Asha,{good},,R1,X\n"
        f"Bilal,{dup},,R2,X\n"
        f"Bilal again,+91 {dup[:5]} {dup[5:]},,R3,X\n"
        "No contact,,,R4,X\n"
        "Bad email,,nope,R5,X\n"
    )
    upload = await _upload(client, college, csv)
    assert upload.status_code == 201, upload.text
    preview = upload.json()
    assert preview["state"] == "PREVIEW"
    assert (preview["total_rows"], preview["valid_rows"], preview["invalid_rows"]) == (5, 2, 2)
    assert preview["duplicate_rows"] == 1 and preview["ignored_columns"] == ["caste"]
    assert preview["invitations"] == dict.fromkeys(
        ("pending", "sent", "accepted", "declined", "expired"), 0
    )

    rows = (await client.get(f"{IMPORTS}/{preview['id']}/rows", headers=college["headers"])).json()[
        "items"
    ]
    assert [(r["row_number"], r["row_state"], r["issues"]) for r in rows] == [
        (2, "VALID", []),
        (3, "VALID", []),
        (4, "DUPLICATE", ["duplicate_in_file"]),
        (5, "INVALID", ["missing_contact"]),
        (6, "INVALID", ["invalid_email"]),
    ]
    assert all(r["invite_state"] is None for r in rows), "a preview invites nobody"

    page = await client.get(
        f"{IMPORTS}/{preview['id']}/rows",
        params={"limit": 2, "row_state": "VALID"},
        headers=college["headers"],
    )
    assert [r["row_number"] for r in page.json()["items"]] == [2, 3]
    assert page.json()["next_cursor"] is None

    again = await _upload(client, college, csv.replace("\n", "\r\n"), name="copy.csv")
    assert again.status_code == 200 and again.json()["id"] == preview["id"]

    unusable = await _upload(client, college, "name,roll\nAsha,1\n")
    assert unusable.status_code == 422 and unusable.json()["code"] == "roster_no_contact_column"


async def test_roster_import_is_paid_and_staff_can_run_it(client: Any, mint_token: Any) -> None:
    unpaid = await _college(client, mint_token, seats_paid=None)
    assert (await _upload(client, unpaid, f"phone\n{_phone()}\n")).status_code == 402

    college = await _college(client, mint_token)
    staff_email = f"{uuid.uuid4().hex[:12]}@example.test"
    await client.post(
        f"{COLLEGE}/team",
        json={"email": staff_email, "role": "COLLEGE_STAFF"},
        headers=college["headers"],
    )
    staff, _ = mint_token(pool="BUSINESS", email=staff_email)
    staffed = await client.post(
        IMPORTS, json={"file_name": "r.csv", "csv": f"phone\n{_phone()}\n"}, headers=staff
    )
    assert staffed.status_code == 201


async def test_roster_imports_are_cursor_paginated(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    uploaded = []
    for index in range(3):
        response = await _upload(
            client,
            college,
            f"name,phone\nStudent {index},{_phone()}\n",
            name=f"roster-{index}.csv",
        )
        assert response.status_code == 201, response.text
        uploaded.append(response.json())

    first_response = await client.get(
        IMPORTS,
        params={"limit": 2},
        headers=college["headers"],
    )
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()
    assert [item["id"] for item in first["items"]] == [
        uploaded[2]["id"],
        uploaded[1]["id"],
    ]
    assert first["next_cursor"]
    assert first["invitation_totals"] == dict.fromkeys(
        ("pending", "sent", "accepted", "declined", "expired"),
        0,
    )

    second_response = await client.get(
        IMPORTS,
        params={"limit": 2, "cursor": first["next_cursor"]},
        headers=college["headers"],
    )
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    assert [item["id"] for item in second["items"]] == [uploaded[0]["id"]]
    assert second["next_cursor"] is None


# ===========================================================================
# Commit, discard, send
# ===========================================================================
async def test_commit_rechecks_the_roster_and_keeps_only_what_will_be_invited(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    shared, own = _phone(), _phone()
    first = (await _upload(client, college, f"phone\n{shared}\n{own}\n,\n1234\n")).json()
    second = (await _upload(client, college, f"phone,name\n{shared},Later file\n")).json()
    assert second["valid_rows"] == 1, "nothing committed yet, so not a duplicate at preview"

    committed = await client.post(f"{IMPORTS}/{second['id']}/commit", headers=college["headers"])
    assert committed.status_code == 200 and committed.json()["state"] == "COMMITTED"
    assert committed.json()["invitations"]["pending"] == 1

    late = await client.post(f"{IMPORTS}/{first['id']}/commit", headers=college["headers"])
    assert late.status_code == 200
    body = late.json()
    assert (body["valid_rows"], body["duplicate_rows"]) == (1, 1), "re-checked at commit"
    assert body["invitations"]["pending"] == 1
    assert (
        await _scalar("SELECT count(*) FROM roster_entries WHERE import_id = :i", i=first["id"])
        == 1
    ), "rows that will never be invited are not kept"

    again = await client.post(f"{IMPORTS}/{first['id']}/commit", headers=college["headers"])
    assert again.status_code == 200 and again.json()["committed_at"] == body["committed_at"]
    discard = await client.post(f"{IMPORTS}/{first['id']}/discard", headers=college["headers"])
    assert discard.status_code == 409 and discard.json()["code"] == "roster_import_closed"


async def test_a_discarded_preview_takes_its_rows_with_it(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    csv = f"phone\n{_phone()}\n{_phone()}\n"
    preview = (await _upload(client, college, csv)).json()
    discarded = await client.post(f"{IMPORTS}/{preview['id']}/discard", headers=college["headers"])
    assert discarded.status_code == 200 and discarded.json()["state"] == "DISCARDED"
    assert (
        await _scalar("SELECT count(*) FROM roster_entries WHERE import_id = :i", i=preview["id"])
        == 0
    )
    closed = await client.post(f"{IMPORTS}/{preview['id']}/commit", headers=college["headers"])
    assert closed.status_code == 409
    sent = await client.post(
        f"{IMPORTS}/{preview['id']}/invitations/send", headers=college["headers"]
    )
    assert sent.status_code == 409

    retried = await _upload(client, college, csv, name="retried-roster.csv")
    assert retried.status_code == 201, retried.text
    retried_preview = retried.json()
    assert retried_preview["id"] != preview["id"]
    assert retried_preview["state"] == "PREVIEW"
    assert (retried_preview["total_rows"], retried_preview["valid_rows"]) == (2, 2)
    rows = await client.get(
        f"{IMPORTS}/{retried_preview['id']}/rows",
        headers=college["headers"],
    )
    assert rows.status_code == 200
    assert len(rows.json()["items"]) == 2


async def test_sending_queues_one_event_per_invitation_with_no_contact_in_it(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    phones = [_phone(), _phone()]
    upload = await _upload(client, college, "phone\n" + "\n".join(phones) + "\n")
    import_id = upload.json()["id"]
    early = await client.post(f"{IMPORTS}/{import_id}/invitations/send", headers=college["headers"])
    assert early.status_code == 409, "a preview is not sent"
    await client.post(f"{IMPORTS}/{import_id}/commit", headers=college["headers"])

    sent = await client.post(f"{IMPORTS}/{import_id}/invitations/send", headers=college["headers"])
    assert sent.status_code == 200
    assert sent.json()["sent"] == 2 and sent.json()["invitations"]["sent"] == 2
    again = await client.post(f"{IMPORTS}/{import_id}/invitations/send", headers=college["headers"])
    assert again.json()["sent"] == 0

    async with sessions(_seed_url())() as session:
        payloads = (
            (
                await session.execute(
                    text(
                        "SELECT o.payload::text FROM outbox o JOIN roster_entries e "
                        "ON e.id::text = o.aggregate_id::text "
                        "WHERE o.event_type = 'college.invitation_sent' "
                        "AND e.import_id = :i"
                    ),
                    {"i": import_id},
                )
            )
            .scalars()
            .all()
        )
    assert len(payloads) == 2
    assert not any(phone in payload for payload in payloads for phone in phones)


async def test_a_committed_roster_row_is_held_by_the_database(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    phone = _phone()
    import_id = await _committed_and_sent(client, college, f"phone\n{phone}\n")

    for statement in (
        "UPDATE roster_entries SET phone = '+919999999999' WHERE import_id = :i",
        "UPDATE roster_entries SET invite_state = 'PENDING' WHERE import_id = :i",
        "UPDATE roster_entries SET sent_at = now() WHERE import_id = :i",
        "DELETE FROM roster_entries WHERE import_id = :i",
    ):
        async with sessions(APP_URL)() as session:
            with pytest.raises(DBAPIError, match="ROSTER_GUARD"):
                async with session.begin():
                    await session.execute(
                        text("SELECT set_config('app.tenant_id', :t, true)"),
                        {"t": college["tenant_id"]},
                    )
                    await session.execute(text(statement), {"i": import_id})


# ===========================================================================
# The student's side: invite-and-accept
# ===========================================================================
async def test_a_student_finds_an_invitation_by_their_own_phone_and_accepts_it(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    await _allocate(college["tenant_id"], 5)
    phone = _phone()
    import_id = await _committed_and_sent(client, college, f"name,phone\nAsha,{phone}\n")
    student = await _student(mint_token, phone)
    stranger = await _student(mint_token, _phone())

    assert (await client.get(f"{STUDENT}/invitations", headers=stranger["headers"])).json() == []
    invitations = (await client.get(f"{STUDENT}/invitations", headers=student["headers"])).json()
    assert len(invitations) == 1 and invitations[0]["college_name"]
    invitation_id = invitations[0]["id"]

    taken = await client.post(
        f"{STUDENT}/invitations/{invitation_id}/accept",
        json={"consent_version": CONSENT_VERSION},
        headers=stranger["headers"],
    )
    assert taken.status_code == 404, "an invitation is accepted only by the contact it was sent to"

    stale = await client.post(
        f"{STUDENT}/invitations/{invitation_id}/accept",
        json={"consent_version": "placeholder-0"},
        headers=student["headers"],
    )
    assert stale.status_code == 409

    accepted = await client.post(
        f"{STUDENT}/invitations/{invitation_id}/accept",
        json={"consent_version": CONSENT_VERSION},
        headers=student["headers"],
    )
    assert accepted.status_code == 200, accepted.text
    link = accepted.json()
    assert (link["scope"], link["granted_via"], link["seat_held"]) == ("ROSTER", "INVITE", True)
    retried = await client.post(
        f"{STUDENT}/invitations/{invitation_id}/accept",
        json={"consent_version": CONSENT_VERSION},
        headers=student["headers"],
    )
    assert retried.status_code == 200 and retried.json()["granted_at"] == link["granted_at"]

    assert (
        await _scalar(
            "SELECT count(*) FROM student_consents "
            "WHERE candidate_id = :c AND roster_entry_id = :e",
            c=student["id"],
            e=invitation_id,
        )
        == 1
    )
    tracking = (await client.get(f"{IMPORTS}/{import_id}", headers=college["headers"])).json()
    assert tracking["invitations"]["accepted"] == 1 and tracking["invitations"]["sent"] == 0
    assert (await client.get(f"{STUDENT}/invitations", headers=student["headers"])).json() == []


async def test_declined_and_expired_invitations_link_nobody(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    declines, lapses = _phone(), _phone()
    import_id = await _committed_and_sent(client, college, f"phone\n{declines}\n{lapses}\n")
    decliner = await _student(mint_token, declines)
    late = await _student(mint_token, lapses)

    invitation = (await client.get(f"{STUDENT}/invitations", headers=decliner["headers"])).json()[0]
    declined = await client.post(
        f"{STUDENT}/invitations/{invitation['id']}/decline", headers=decliner["headers"]
    )
    assert declined.status_code == 204
    after = await client.post(
        f"{STUDENT}/invitations/{invitation['id']}/accept",
        json={"consent_version": CONSENT_VERSION},
        headers=decliner["headers"],
    )
    assert after.status_code == 404

    expiring = (await client.get(f"{STUDENT}/invitations", headers=late["headers"])).json()[0]
    async with sessions(_seed_url())() as session, session.begin():
        # A fresh row sent 31 days ago, as time passing would leave it: the
        # guard keeps `sent_at` fixed, so the migrator re-seeds the moment.
        await session.execute(
            text("ALTER TABLE roster_entries DISABLE TRIGGER trg_guard_roster_entry_write")
        )
        await session.execute(
            text("UPDATE roster_entries SET sent_at = now() - interval '31 days' WHERE id = :e"),
            {"e": expiring["id"]},
        )
        await session.execute(
            text("ALTER TABLE roster_entries ENABLE TRIGGER trg_guard_roster_entry_write")
        )
    assert (await client.get(f"{STUDENT}/invitations", headers=late["headers"])).json() == []
    expired = await client.post(
        f"{STUDENT}/invitations/{expiring['id']}/accept",
        json={"consent_version": CONSENT_VERSION},
        headers=late["headers"],
    )
    assert expired.status_code == 404

    tracking = (await client.get(f"{IMPORTS}/{import_id}", headers=college["headers"])).json()
    assert (tracking["invitations"]["declined"], tracking["invitations"]["expired"]) == (1, 1)
    for student in (decliner, late):
        assert (
            await _scalar(
                "SELECT count(*) FROM student_consents WHERE candidate_id = :c", c=student["id"]
            )
            == 0
        )


# ===========================================================================
# Rows nobody can reach
# ===========================================================================
# A roster row needs a phone *or* an email. With SMS deferred (2026-09-18) a
# phone-only row is valid, is committed, raises its invitation event, and is
# then recorded SKIPPED `NO_CONTACT` -- and the college had no way of knowing
# that a third of their students would hear nothing. The preview now says so
# *before* they commit, which is when they can still go and collect
# addresses.
PHONE_ONLY = (
    "name,phone,email\n"
    "Asha Menon,9812300011,\n"
    "Ravi Kumar,9812300012,\n"
    "Priya Shah,9812300013,priya@example.test\n"
)


async def test_the_preview_counts_rows_no_invitation_can_reach(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    upload = await _upload(client, college, PHONE_ONLY)
    assert upload.status_code == 201, upload.text
    body = upload.json()

    assert body["valid_rows"] == 3, "phone-only rows are valid; that is the point"
    assert body["unreachable_rows"] == 2, "two rows have no email and email is the only channel"


async def test_a_roster_with_addresses_reports_none_unreachable(
    client: Any, mint_token: Any
) -> None:
    """The other half: the warning must be absent when it does not apply, or
    a college learns to ignore it."""
    college = await _college(client, mint_token)
    csv = "name,phone,email\nAsha Menon,9812300021,asha@example.test\n"
    body = (await _upload(client, college, csv)).json()
    assert body["valid_rows"] == 1
    assert body["unreachable_rows"] == 0


async def test_the_count_is_derived_from_what_can_be_delivered_not_hardcoded(
    client: Any, mint_token: Any, monkeypatch: Any
) -> None:
    """**When SMS returns, this corrects itself.**

    The count asks `notifications.domain` which roster columns an invitation
    can actually be delivered to, and that answer is derived from `plan_for`
    and DLT readiness. A constant would have to be remembered by whoever
    turns SMS back on, which is exactly what nobody remembers -- and the
    college would go on being warned about rows that are now fine.
    """
    from app.modules.college import service as college_service

    college = await _college(client, mint_token)
    upload = await _upload(client, college, PHONE_ONLY)
    import_id = upload.json()["id"]
    assert upload.json()["unreachable_rows"] == 2

    # Exactly what registering the SMS template and routing to it would do.
    monkeypatch.setattr(
        college_service, "roster_invitation_contact_fields", lambda: frozenset({"email", "phone"})
    )
    again = await client.get(f"{IMPORTS}/{import_id}", headers=college["headers"])
    assert again.status_code == 200, again.text
    assert again.json()["unreachable_rows"] == 0, (
        "with SMS deliverable, a phone-only row is reachable again"
    )


async def test_the_count_is_recomputed_on_every_read_not_stored(
    client: Any, mint_token: Any, monkeypatch: Any
) -> None:
    """It is a fact about the deployment, not about the file. Storing it at
    upload time would leave a stale number on every roster ever imported."""
    from app.modules.college import service as college_service

    college = await _college(client, mint_token)
    import_id = (await _upload(client, college, PHONE_ONLY)).json()["id"]

    monkeypatch.setattr(college_service, "roster_invitation_contact_fields", frozenset)
    nothing_deliverable = await client.get(f"{IMPORTS}/{import_id}", headers=college["headers"])
    assert nothing_deliverable.json()["unreachable_rows"] == 3, (
        "with no channel at all, every valid row is unreachable and should say so"
    )
