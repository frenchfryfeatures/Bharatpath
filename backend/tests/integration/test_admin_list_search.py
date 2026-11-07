# ruff: noqa: F811 - `made` is a pytest fixture imported from the search-filter tests

"""Searching and sorting the console's lists (2026-10-21).

Every `/admin` list takes `sort` and `order` beside its filters, and one
search box, `q`; on a list of people it is tried against the name, the email
and the phone at once (2026-10-22). Two rules matter more than the mechanics:

* **Part of an email or phone is for the roles that read whole contacts.**
  An integrity reviewer lists candidates with their contacts masked; if part
  of an address matched, `a`, `ab`, `abc`... would spell it out. They match
  the whole address or number.
* **The search text never reaches the audit row.** It records that a
  search was made (`searched`, `partial_contact`), never what was typed.

The database is shared with every other test, so each test gives its people
a letters-only token and narrows every list to it.
"""

from __future__ import annotations

import json
import random
import string
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from app.core.pagination import IST
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _scalar, _staff
from tests.integration.test_candidate_marketplace import _employer
from tests.integration.test_integrity_pipeline import (
    EXTRACTED,
    INJECTED_CV,
    _evaluate,
    _high_signal_id,
    _scored_version,
)
from tests.integration.test_search_filters import _add, made  # noqa: F401 - fixture

pytestmark = pytest.mark.integration

API = "/api/v1"
ADMIN = f"{API}/admin"
DISPUTES = f"{API}/disputes"


def _token() -> str:
    """Letters only: a hex token can hold a run of digits that a phone search
    would also match."""
    return "".join(random.choices(string.ascii_lowercase, k=12))


def _today() -> date:
    """A list filter's day is an Indian one, whatever the machine's zone."""
    return datetime.now(IST).date()


def _times(rows: list[dict], field: str = "created_at") -> list[datetime]:
    return [datetime.fromisoformat(r[field]) for r in rows]


def _phone() -> str:
    return f"+9193{random.randrange(10**8):08d}"


async def _person(
    token: str,
    *,
    local: str,
    name: str | None,
    account_phone: str | None = None,
    profile_phone: str | None = None,
    city: str | None = None,
    signed_up: datetime | None = None,
) -> uuid.UUID:
    """A candidate account, seeded as the migrator. `profile_phone` is the one
    given at onboarding, which is where most candidates' number lives."""
    user_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, email, phone, status, locale, created_at) "
                "VALUES (:u, 'CANDIDATE', :e, :p, 'ACTIVE', 'en', :t)"
            ),
            {
                "u": str(user_id),
                "e": f"{local}.{token}@example.test",
                "p": account_phone,
                "t": signed_up or datetime.now(UTC),
            },
        )
        if name is not None or profile_phone is not None or city is not None:
            await session.execute(
                text(
                    "INSERT INTO candidate_profiles (user_id, full_name, city, career) "
                    "VALUES (:u, :n, :c, CAST(:career AS jsonb))"
                ),
                {
                    "u": str(user_id),
                    "n": name,
                    "c": city,
                    "career": json.dumps({"details": {"phone": profile_phone or ""}}),
                },
            )
    return user_id


async def _people(token: str) -> dict[str, Any]:
    """Three candidates sharing `token`: one with the account's phone, one
    with only an onboarding phone and a city, and one with no name who
    signed up ten days ago."""
    asha_phone, ravi_phone = _phone(), _phone()
    asha = await _person(token, local="asha", name=f"Asha {token}", account_phone=asha_phone)
    ravi = await _person(
        token, local="ravi", name=f"Ravi {token}", profile_phone=ravi_phone, city="Pimpri-Chinchwad"
    )
    nameless = await _person(
        token, local="zed", name=None, signed_up=datetime.now(UTC) - timedelta(days=10)
    )
    return {
        "asha": asha,
        "ravi": ravi,
        "nameless": nameless,
        "asha_phone": asha_phone,
        "ravi_phone": ravi_phone,
    }


async def _ids(client: Any, url: str, headers: dict, **params: Any) -> list[str]:
    response = await client.get(url, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()["items"]]


async def _walk(client: Any, url: str, headers: dict, **params: Any) -> list[dict]:
    """Every row, one page of `limit` at a time, following the cursor."""
    rows: list[dict] = []
    cursor = None
    for _ in range(50):
        query = {**params, **({"cursor": cursor} if cursor else {})}
        response = await client.get(url, params=query, headers=headers)
        assert response.status_code == 200, response.text
        rows.extend(response.json()["items"])
        cursor = response.json()["next_cursor"]
        if cursor is None:
            return rows
    raise AssertionError("more pages than any test makes")


# --- the candidate list -------------------------------------------------------------
async def test_one_search_box_finds_a_candidate_by_name_email_or_phone(
    client: Any, mint_token: Any
) -> None:
    """Support types anything into `q`: part of a name, part of an email or
    the digits of a phone, and a candidate matching any of the three is in."""
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    token = _token()
    p = await _people(token)
    url, headers = f"{ADMIN}/candidates", agent["headers"]
    asha, ravi, nameless = str(p["asha"]), str(p["ravi"]), str(p["nameless"])

    # The token is in two names and in all three addresses.
    assert set(await _ids(client, url, headers, q=token.upper())) == {asha, ravi, nameless}
    assert await _ids(client, url, headers, q=f" ASHA.{token} ") == [asha], "part of an email"
    assert await _ids(client, url, headers, q=f"ravi {token}") == [ravi], "part of a name"
    assert await _ids(client, url, headers, q=f"zed.{token}@example.test") == [nameless]

    # The onboarding phone is searched as well as the account's, by its digits.
    spaced = f"{p['ravi_phone'][:3]} {p['ravi_phone'][3:8]}-{p['ravi_phone'][8:]}"
    assert await _ids(client, url, headers, q=spaced) == [ravi]
    assert asha in await _ids(client, url, headers, q=p["asha_phone"][-6:])
    [row] = (await client.get(url, params={"q": p["ravi_phone"]}, headers=headers)).json()["items"]
    assert row["phone_masked"].endswith(p["ravi_phone"][-4:])
    assert p["ravi_phone"] not in json.dumps(row), "the list still masks"

    assert await _ids(client, url, headers, q=token, city="CHINCH") == [ravi]
    today = _today().isoformat()
    week_ago = (_today() - timedelta(days=7)).isoformat()
    assert set(await _ids(client, url, headers, q=token, created_from=week_ago)) == {asha, ravi}
    assert await _ids(client, url, headers, q=token, created_to=week_ago) == [nameless]
    backwards = await client.get(
        url, params={"created_from": today, "created_to": week_ago}, headers=headers
    )
    assert backwards.status_code == 422 and backwards.json()["code"] == "invalid_date_range"

    wildcard = await client.get(url, params={"q": f"%{token}"}, headers=headers)
    assert wildcard.json()["items"] == [], "a % in a search is a character, not a wildcard"
    words = await client.get(url, params={"q": f"call {token}"}, headers=headers)
    assert words.status_code == 200 and words.json()["items"] == [], "text is not a phone"

    leaked = await _scalar(
        "SELECT count(*) FROM audit_events WHERE actor_id = :u AND "
        "(metadata::text ILIKE :t OR metadata::text LIKE :p)",
        u=agent["user_id"],
        t=f"%{token}%",
        p=f"%{p['ravi_phone'][-6:]}%",
    )
    assert int(leaked) == 0, "the audit row says a search was made, never what for"
    how = await _scalar(
        "SELECT metadata FROM audit_events WHERE actor_id = :u "
        "AND metadata->>'view' = 'candidates' AND metadata->>'searched' = 'true' LIMIT 1",
        u=agent["user_id"],
    )
    assert how["partial_contact"] is True


async def test_a_role_that_cannot_read_contacts_matches_only_a_whole_one(
    client: Any, mint_token: Any
) -> None:
    """The integrity reviewer lists candidates with masked contacts. In the
    same search box, part of a name still finds someone -- the name is on the
    row -- but part of an address or number finds nobody; the whole does."""
    reviewer = await _staff(mint_token, "INTEGRITY_REVIEWER")
    token = _token()
    p = await _people(token)
    url, headers = f"{ADMIN}/candidates", reviewer["headers"]
    asha, ravi, nameless = str(p["asha"]), str(p["ravi"]), str(p["nameless"])

    assert set(await _ids(client, url, headers, q=token)) == {asha, ravi}, (
        "by name only: the nameless account matches by part of its email, which "
        "this role may not search"
    )
    assert await _ids(client, url, headers, q=f"zed.{token}") == []
    assert await _ids(client, url, headers, q=f"zed.{token}@example.test") == [nameless]
    assert await _ids(client, url, headers, q=p["ravi_phone"][-6:]) == []
    assert await _ids(client, url, headers, q=p["ravi_phone"]) == [ravi]
    how = await _scalar(
        "SELECT metadata FROM audit_events WHERE actor_id = :u "
        "AND metadata->>'view' = 'candidates' AND metadata->>'searched' = 'true' LIMIT 1",
        u=reviewer["user_id"],
    )
    assert how["partial_contact"] is False


async def test_candidates_sort_by_name_with_the_nameless_last_either_way(
    client: Any, mint_token: Any
) -> None:
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    token = _token()
    p = await _people(token)
    url, headers = f"{ADMIN}/candidates", agent["headers"]
    asha, ravi, nameless = str(p["asha"]), str(p["ravi"]), str(p["nameless"])

    def ids(rows: list[dict]) -> list[str]:
        return [r["id"] for r in rows]

    by_name = await _walk(client, url, headers, q=token, sort="full_name", limit=1)
    assert ids(by_name) == [asha, ravi, nameless]
    by_name_desc = await _walk(
        client, url, headers, q=token, sort="full_name", order="desc", limit=1
    )
    assert ids(by_name_desc) == [ravi, asha, nameless]
    newest = await _walk(client, url, headers, q=token, limit=2)
    assert ids(newest)[-1] == nameless, "newest first by default"
    oldest = await _walk(client, url, headers, q=token, order="asc", limit=2)
    assert ids(oldest)[0] == nameless

    first = await client.get(
        url, params={"q": token, "sort": "full_name", "limit": 1}, headers=headers
    )
    cursor = first.json()["next_cursor"]
    elsewhere = await client.get(
        url, params={"q": token, "sort": "created_at", "cursor": cursor}, headers=headers
    )
    assert elsewhere.status_code == 422 and elsewhere.json()["code"] == "invalid_cursor"
    turned = await client.get(
        url,
        params={"q": token, "sort": "full_name", "order": "desc", "cursor": cursor},
        headers=headers,
    )
    assert turned.status_code == 422 and turned.json()["code"] == "invalid_cursor"
    unknown = await client.get(url, params={"sort": "email"}, headers=headers)
    assert unknown.status_code == 422


# --- the sales follow-up list ------------------------------------------------------
async def test_the_leads_list_is_searched_and_sorted_the_same_way(
    client: Any, mint_token: Any
) -> None:
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    token = _token()
    p = await _people(token)
    url, headers = f"{ADMIN}/leads", agent["headers"]

    rows = await _walk(client, url, headers, q=token, sort="full_name", limit=1)
    assert [r["id"] for r in rows] == [str(p["asha"]), str(p["ravi"]), str(p["nameless"])]
    by_phone = (await client.get(url, params={"q": p["ravi_phone"][-7:]}, headers=headers)).json()[
        "items"
    ]
    [ravi] = [r for r in by_phone if r["id"] == str(p["ravi"])]
    assert ravi["phone"] == p["ravi_phone"]
    assert await _ids(client, url, headers, q=f"asha {token}") == [str(p["asha"])]
    week_ago = (_today() - timedelta(days=7)).isoformat()
    assert await _ids(client, url, headers, q=token, signed_up_to=week_ago) == [str(p["nameless"])]
    never = await _walk(client, url, headers, q=token, sort="last_downloaded_at", limit=2)
    assert len(never) == 3, "nobody downloaded, and nobody is lost for it"
    leaked = await _scalar(
        "SELECT count(*) FROM audit_events WHERE actor_id = :u AND metadata::text ILIKE :t",
        u=agent["user_id"],
        t=f"%{token}%",
    )
    assert int(leaked) == 0


# --- organisations --------------------------------------------------------------------
async def test_staff_find_an_organisation_by_a_members_email(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    kyb = await _staff(mint_token, "KYB_REVIEWER")
    employer = await _employer(client, mint_token)
    owner_email = await _scalar(
        "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = :t",
        t=employer["tenant_id"],
    )
    url = f"{ADMIN}/tenants"
    local = owner_email.split("@")[0]

    assert employer["tenant_id"] in await _ids(client, url, admin["headers"], q=local)
    assert await _ids(client, url, kyb["headers"], q=local) == []
    assert await _ids(client, url, kyb["headers"], q=owner_email.upper()) == [employer["tenant_id"]]
    newest = await _ids(client, url, admin["headers"], sort="created_at", type="EMPLOYER", limit=5)
    assert employer["tenant_id"] in newest, "just made, so among the newest"
    named = await client.get(url, params={"sort": "name", "limit": 3}, headers=admin["headers"])
    following = await client.get(
        url,
        params={"sort": "name", "limit": 3, "cursor": named.json()["next_cursor"]},
        headers=admin["headers"],
    )
    assert following.status_code == 200, following.text
    seen = [r["id"] for r in named.json()["items"] + following.json()["items"]]
    assert len(seen) == len(set(seen))


# --- the integrity queue ----------------------------------------------------------------
async def test_the_integrity_queue_finds_a_candidates_signals_by_their_whole_email(
    client: Any, mint_token: Any
) -> None:
    reviewer = await _staff(mint_token, "INTEGRITY_REVIEWER")
    admin = await _staff(mint_token)
    token = _token()
    candidate = await _person(token, local="flagged", name=f"Flagged {token}")
    version_id, _ = await _scored_version(candidate, INJECTED_CV, EXTRACTED)
    await _evaluate(candidate, version_id, INJECTED_CV, EXTRACTED)
    signal_id = str(await _high_signal_id(version_id))
    url, email = f"{ADMIN}/integrity/signals", f"flagged.{token}@example.test"

    assert signal_id in await _ids(client, url, reviewer["headers"], q=email)
    assert await _ids(client, url, reviewer["headers"], q=f"flagged.{token}") == []
    assert signal_id in await _ids(client, url, admin["headers"], q=f"flagged.{token}")
    assert signal_id in await _ids(client, url, reviewer["headers"], q=token), "by name"
    found = await _ids(client, url, reviewer["headers"], q=token, rule_id="no-such-rule")
    assert found == []

    by_severity = await client.get(
        url, params={"sort": "severity", "limit": 20}, headers=reviewer["headers"]
    )
    ranks = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
    severities = [ranks[r["severity"]] for r in by_severity.json()["items"]]
    assert severities == sorted(severities, reverse=True), "HIGH first"
    oldest = await client.get(url, params={"limit": 20}, headers=reviewer["headers"])
    times = _times(oldest.json()["items"])
    assert times == sorted(times), "first in, first out by default"


# --- disputes ---------------------------------------------------------------------------
async def test_the_dispute_queue_finds_a_dispute_by_who_raised_it(
    client: Any, mint_token: Any
) -> None:
    from tests.integration.test_payments import _candidate as _paying_candidate

    agent = await _staff(mint_token, "SUPPORT_AGENT")
    token = _token()
    raiser = await _paying_candidate(mint_token)
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE users SET email = :e WHERE id = :u"),
            {"e": f"raiser.{token}@example.test", "u": str(raiser["id"])},
        )
    raised = await client.post(
        DISPUTES,
        json={"kind": "PAYMENT", "description": "Charged twice for one month."},
        headers=raiser["headers"],
    )
    assert raised.status_code == 201, raised.text
    dispute_id = raised.json()["id"]
    url = f"{ADMIN}/disputes"

    assert await _ids(client, url, agent["headers"], q=token) == [dispute_id]
    assert await _ids(client, url, agent["headers"], q=token, kind="HIRE") == []
    taken = await client.post(f"{url}/{dispute_id}/assign", headers=agent["headers"])
    assert taken.status_code == 200, taken.text
    mine = await _ids(client, url, agent["headers"], assigned_to=str(agent["user_id"]), q=token)
    assert mine == [dispute_id]
    newest = await client.get(url, params={"order": "desc", "limit": 5}, headers=agent["headers"])
    times = _times(newest.json()["items"])
    assert times == sorted(times, reverse=True)
    closed_last = await client.get(
        url, params={"sort": "resolved_at", "limit": 5}, headers=agent["headers"]
    )
    assert closed_last.status_code == 200, closed_last.text


# --- the audit trail ----------------------------------------------------------------------
async def test_the_audit_trail_reads_oldest_first_on_request(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    token = _token()
    candidate = await _person(token, local="audited", name=None)
    for _ in range(3):
        await client.get(f"{ADMIN}/candidates/{candidate}", headers=agent["headers"])
    url = f"{ADMIN}/audit-events"
    filters = {"actor_id": str(agent["user_id"]), "action": "admin_candidate_drilldown"}

    oldest = await _walk(client, url, admin["headers"], **filters, order="asc", limit=2)
    newest = await _walk(client, url, admin["headers"], **filters, limit=2)
    assert [r["id"] for r in oldest] == [r["id"] for r in reversed(newest)]
    assert len(oldest) == 3

    first = await client.get(url, params={**filters, "limit": 1}, headers=admin["headers"])
    turned = await client.get(
        url,
        params={**filters, "order": "asc", "cursor": first.json()["next_cursor"]},
        headers=admin["headers"],
    )
    assert turned.status_code == 422 and turned.json()["code"] == "invalid_cursor"


# --- discount codes -------------------------------------------------------------------
async def test_a_codes_status_filter_agrees_with_the_status_on_each_row(
    client: Any, mint_token: Any
) -> None:
    """The filter runs `domain.discount_status` in SQL; each row's status is
    the Python. Every code here is in exactly the bucket its row says, at
    three instants that move codes between buckets."""
    from app.modules.billing import service as billing_service
    from app.modules.subscriptions import service as subscriptions_service
    from tests.integration.test_discount_codes import _checkout, _make
    from tests.integration.test_payments import _candidate as _paying_candidate
    from tests.integration.test_payments import _settle

    async with sessions(_seed_url())() as session, session.begin():
        await subscriptions_service.sync_plans(session)
    admin = await _staff(mint_token)
    token = _token()
    now = datetime.now(UTC)
    label = f"List test {token}"
    codes = {
        "active": await _make(client, admin, label=label),
        "scheduled": await _make(
            client, admin, label=label, valid_from=(now + timedelta(days=1)).isoformat()
        ),
        "ending": await _make(
            client, admin, label=label, valid_until=(now + timedelta(hours=1)).isoformat()
        ),
        "disabled": await _make(client, admin, label=label),
        "single": await _make(client, admin, label=label, usage_limit=1),
    }
    disabled = await client.post(
        f"{ADMIN}/discount-codes/{codes['disabled']['id']}/disable", headers=admin["headers"]
    )
    assert disabled.status_code == 200, disabled.text
    payer = await _paying_candidate(mint_token)
    checkout = await _checkout(client, payer, codes["single"]["code"])
    assert checkout.status_code == 201, checkout.text
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"

    statuses = ("ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "DISABLED")
    for at in (now, now + timedelta(hours=2), now + timedelta(days=2)):
        async with sessions(_seed_url())() as session:
            everyone, _ = await billing_service.list_discount_codes(
                session, audience=None, cursor=None, limit=100, query=token, now=at
            )
            assert len(everyone) == len(codes)
            shown = {view.code.id: view.status for view in everyone}
            for status in statuses:
                filtered, _ = await billing_service.list_discount_codes(
                    session,
                    audience=None,
                    cursor=None,
                    limit=100,
                    query=token,
                    statuses=(status,),
                    now=at,
                )
                assert {v.code.id for v in filtered} == {
                    i for i, s in shown.items() if s == status
                }, (at, status)

    url = f"{ADMIN}/discount-codes"
    exhausted = await _ids(client, url, admin["headers"], q=token, status="EXHAUSTED")
    assert exhausted == [codes["single"]["id"]]
    both = await _ids(client, url, admin["headers"], q=token, status=["DISABLED", "SCHEDULED"])
    assert set(both) == {codes["disabled"]["id"], codes["scheduled"]["id"]}
    by_code = await _walk(client, url, admin["headers"], q=token, sort="code", limit=2)
    code_names = [r["code"] for r in by_code]
    assert code_names == sorted(code_names) and len(code_names) == len(codes)
    by_expiry = await _walk(client, url, admin["headers"], q=token, sort="valid_until", limit=2)
    assert by_expiry[0]["id"] == codes["ending"]["id"], "codes that never end come last"

    log = f"{url}/{codes['single']['id']}/redemptions"
    assert len(await _ids(client, log, admin["headers"], sort="amount_minor")) == 1
    redeemed_today = await _ids(client, log, admin["headers"], redeemed_from=_today().isoformat())
    assert len(redeemed_today) == 1
    assert await _ids(client, log, admin["headers"], subscriber_type="TENANT") == []


# --- search filter options ------------------------------------------------------------
async def test_search_filter_options_sort_by_label_and_filter_by_featured(
    client: Any, mint_token: Any, made: list[str]
) -> None:
    """Its own options, narrowed by a token: a CI database holds no starter
    catalogue, and a local one holds 156 options nobody here made."""
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    url, token = f"{ADMIN}/search-filters", _token()
    for word, featured in (("zeta", False), ("alpha", True), ("mid", False), ("beta", False)):
        await _add(client, agent, made, kind="SKILL", label=f"{word} {token}", featured=featured)

    by_label = await _walk(client, url, agent["headers"], q=token, sort="label", limit=1)
    assert [r["label"].split()[0] for r in by_label] == ["alpha", "beta", "mid", "zeta"]
    backwards = await _walk(
        client, url, agent["headers"], q=token, sort="label", order="desc", limit=3
    )
    assert [r["id"] for r in backwards] == [r["id"] for r in reversed(by_label)]
    [featured] = (
        await client.get(url, params={"q": token, "featured": "true"}, headers=agent["headers"])
    ).json()["items"]
    assert featured["label"] == f"alpha {token}"
    newest = await _walk(client, url, agent["headers"], q=token, sort="created_at", limit=2)
    assert [r["id"] for r in newest] == list(reversed(made)), "newest first"
