"""Through HTTP: data-subject requests, the export, and the erasure.

The erasure test builds a candidate who has touched most of the platform --
a scored CV, an integrity check, a profile, an application with its history,
a college seat, a subscription, a view event and audit rows -- and then checks
both halves of the policy the client confirmed: everything personal is gone,
and the financial and audit carve-out is still there, pointing at an account
that identifies nobody.

**The erasure sweep is called one request at a time** (`erase_one`), never as
`run_erasures`: the database is shared, and a sweep would erase other tests'
candidates whose deletion requests happened to be old enough.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.privacy.domain import (
    DELETION_GRACE_HOURS,
    ERASURE_PLAN,
    RETENTION_POLICY_VERSION,
    Disposition,
)
from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import _candidate
from tests.integration.test_college import APP_URL, _allocate, _code, _college, _link
from tests.integration.test_college_consent import _application, _employer

pytestmark = pytest.mark.integration

PRIVACY = "/api/v1/privacy/requests"


class FakeExportS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[tuple[str, str]] = []

    async def put_object(self, *, bucket: str, key: str, body: bytes, content_type: str) -> None:
        self.objects[key] = body

    async def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append((bucket, key))
        self.objects.pop(key, None)

    async def presign_get(self, *, bucket: str, key: str, expires_in: int) -> str:
        return f"https://s3.test/{bucket}/{key}?expires={expires_in}"


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> FakeExportS3:
    from app.core import storage

    fake = FakeExportS3()
    for name in ("put_object", "delete_object", "presign_get"):
        monkeypatch.setattr(storage, name, getattr(fake, name))
    return fake


async def _scalar(sql: str, **params: Any) -> Any:
    async with sessions(_seed_url())() as session:
        return (await session.execute(text(sql), params)).scalar()


async def _exec(sql: str, **params: Any) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(text(sql), params)


# ===========================================================================
# Export
# ===========================================================================
async def test_an_export_is_built_downloaded_by_a_short_link_and_audited(
    client: Any, mint_token: Any, fake_s3: FakeExportS3
) -> None:
    from app.tasks.privacy_requests import run_export

    me = await _candidate(mint_token)
    await _exec(
        "INSERT INTO candidate_profiles (user_id, full_name) VALUES (:u, 'Asha Export')",
        u=str(me["id"]),
    )

    asked = await client.post(f"{PRIVACY}/export", headers=me["headers"])
    assert asked.status_code == 202, asked.text
    body = asked.json()
    assert body["state"] == "RECEIVED" and body["download_available"] is False
    assert body["erasable_at"] is None
    due = datetime.fromisoformat(body["due_at"]) - datetime.fromisoformat(body["created_at"])
    assert timedelta(days=29) < due <= timedelta(days=30, seconds=1)

    again = await client.post(f"{PRIVACY}/export", headers=me["headers"])
    assert again.status_code == 409 and again.json()["code"] == "dsr_request_already_open"

    early = await client.get(f"{PRIVACY}/{body['id']}/download", headers=me["headers"])
    assert early.status_code == 409 and early.json()["code"] == "dsr_export_not_ready"

    outcome = await run_export(
        dsr_id=uuid.UUID(body["id"]), user_id=me["id"], now=datetime.now(UTC)
    )
    assert outcome == {"status": "completed"}
    # Redelivered: nothing happens twice.
    again_run = await run_export(
        dsr_id=uuid.UUID(body["id"]), user_id=me["id"], now=datetime.now(UTC)
    )
    assert again_run == {"status": "nothing_to_do"}

    shown = (await client.get(f"{PRIVACY}/{body['id']}", headers=me["headers"])).json()
    assert shown["state"] == "COMPLETED" and shown["download_available"] is True
    assert "export_s3_key" not in shown and "manifest" not in shown

    link = await client.get(f"{PRIVACY}/{body['id']}/download", headers=me["headers"])
    assert link.status_code == 200, link.text
    assert link.json()["expires_in_seconds"] == 600
    assert (
        await _scalar(
            "SELECT count(*) FROM audit_events WHERE action = 'dsr_export_downloaded' "
            "AND target_id = :t",
            t=body["id"],
        )
        == 1
    )

    (archive_bytes,) = fake_s3.objects.values()
    archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
    account = json.loads(archive.read("account.json"))
    assert account[0]["phone"].startswith("+91")
    assert json.loads(archive.read("profile.json"))[0]["full_name"] == "Asha Export"
    scores = json.loads(archive.read("scores.json"))
    assert scores and scores[0]["score"] == me["score"]
    whole = b"".join(archive.read(n) for n in archive.namelist()).decode()
    for forbidden in ("breakdown", "raw_model_response", "cognito_sub", "extracted_features"):
        assert forbidden not in whole, f"{forbidden} leaked into an export"


async def test_someone_elses_request_is_a_404(client: Any, mint_token: Any) -> None:
    owner, stranger = await _candidate(mint_token), await _candidate(mint_token)
    asked = await client.post(f"{PRIVACY}/export", headers=owner["headers"])
    for path in ("", "/download"):
        seen = await client.get(
            f"{PRIVACY}/{asked.json()['id']}{path}", headers=stranger["headers"]
        )
        assert seen.status_code == 404, path
    listed = await client.get(PRIVACY, headers=stranger["headers"])
    assert listed.json()["items"] == []


async def test_an_expired_export_is_destroyed_and_says_so(
    client: Any, mint_token: Any, fake_s3: FakeExportS3
) -> None:
    from app.modules.privacy import service
    from app.tasks.privacy_requests import run_export

    me = await _candidate(mint_token, scored=False)
    asked = (await client.post(f"{PRIVACY}/export", headers=me["headers"])).json()
    await run_export(dsr_id=uuid.UUID(asked["id"]), user_id=me["id"], now=datetime.now(UTC))
    key = await _scalar("SELECT export_s3_key FROM dsr_requests WHERE id = :i", i=asked["id"])

    # Found by the sweep only once it is older than the retention window.
    async with sessions(APP_URL)() as session:
        now = datetime.now(UTC)
        assert (uuid.UUID(asked["id"]), key) not in await service.expired_exports(
            session, now=now, limit=10_000
        )
        assert (uuid.UUID(asked["id"]), key) in await service.expired_exports(
            session, now=now + timedelta(hours=49), limit=10_000
        )
    # Expire just this one, the way the sweep does.
    from app.core import storage

    await storage.delete_object(bucket="exports", key=key)
    async with sessions(APP_URL)() as session, session.begin():
        await service.forget_export(session, dsr_id=uuid.UUID(asked["id"]))

    assert ("exports", key) in fake_s3.deleted
    gone = await client.get(f"{PRIVACY}/{asked['id']}/download", headers=me["headers"])
    assert gone.status_code == 409 and gone.json()["code"] == "dsr_export_expired"


async def test_a_business_user_may_export_but_not_self_erase(client: Any, mint_token: Any) -> None:
    headers, _ = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:10]}@example.test")
    created = await client.post(
        "/api/v1/employer/organisation", json={"legal_name": "DSR Test Pvt Ltd"}, headers=headers
    )
    assert created.status_code == 201, created.text

    refused = await client.post(f"{PRIVACY}/deletion", headers=headers)
    assert refused.status_code == 403
    assert refused.json()["code"] == "dsr_deletion_requires_support"
    assert (await client.post(f"{PRIVACY}/export", headers=headers)).status_code == 202


# ===========================================================================
# Deletion: request, cooling off, withdraw
# ===========================================================================
async def test_a_deletion_waits_out_its_grace_and_can_be_withdrawn(
    client: Any, mint_token: Any
) -> None:
    from app.modules.privacy import service
    from app.tasks.privacy_requests import erase_one

    me = await _candidate(mint_token, scored=False)
    asked = await client.post(f"{PRIVACY}/deletion", headers=me["headers"])
    assert asked.status_code == 202, asked.text
    body = asked.json()
    created = datetime.fromisoformat(body["created_at"])
    assert datetime.fromisoformat(body["erasable_at"]) - created == timedelta(
        hours=DELETION_GRACE_HOURS
    )
    dsr_id = uuid.UUID(body["id"])

    async with sessions(APP_URL)() as session:
        inside = await service.due_deletions(
            session, now=created + timedelta(hours=1), limit=10_000
        )
        after = await service.due_deletions(
            session, now=created + timedelta(hours=DELETION_GRACE_HOURS, minutes=1), limit=10_000
        )
    assert (dsr_id, me["id"]) not in inside, "nothing is destroyed inside the grace period"
    assert (dsr_id, me["id"]) in after

    withdrawn = await client.post(f"{PRIVACY}/{dsr_id}/withdraw", headers=me["headers"])
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["state"] == "REJECTED" and withdrawn.json()["completed_at"]
    twice = await client.post(f"{PRIVACY}/{dsr_id}/withdraw", headers=me["headers"])
    assert twice.status_code == 409 and twice.json()["code"] == "dsr_request_not_withdrawable"

    # A sweep that read it before the withdrawal cannot erase it after.
    assert await erase_one(dsr_id=dsr_id, user_id=me["id"], now=datetime.now(UTC)) == "skipped"
    assert (await client.get(PRIVACY, headers=me["headers"])).status_code == 200


# ===========================================================================
# The erasure
# ===========================================================================
async def test_an_erasure_destroys_the_person_and_keeps_the_carve_out(
    client: Any, mint_token: Any, fake_s3: FakeExportS3
) -> None:
    from app.tasks.privacy_requests import erase_one

    me = await _candidate(mint_token)  # scored, integrity-checked, subscribed
    other = await _candidate(mint_token, scored=False)
    uid = str(me["id"])

    # -- a life on the platform ------------------------------------------
    await _exec(
        "INSERT INTO candidate_profiles (user_id, full_name, city) "
        "VALUES (:u, 'Ravi Erase', 'Pune')",
        u=uid,
    )
    resume_key = f"resumes/{uid}/{uuid.uuid4()}.pdf"
    await _exec(
        "INSERT INTO resume_files (id, user_id, s3_key, mime, size_bytes, scan_status, "
        "parse_status) "
        "VALUES (gen_random_uuid(), :u, :k, 'application/pdf', 1024, 'CLEAN', 'DONE')",
        u=uid,
        k=resume_key,
    )
    # Two cache rows: one only this candidate's score names, one shared.
    mine, shared = uuid.uuid4().hex * 2, uuid.uuid4().hex * 2
    for key in (mine, shared):
        await _exec(
            "INSERT INTO resume_extractions (cache_key, model_id, prompt_version, schema_version, "
            "raw_response, extracted_features) VALUES (:k, 'm', 'p', 's', '{}', '{}')",
            k=key,
        )
    version = await _scalar(
        "SELECT resume_version_id FROM scores WHERE user_id = :u LIMIT 1", u=uid
    )
    for owner, key in ((uid, mine), (uid, shared), (str(other["id"]), shared)):
        if owner != uid:
            await _exec(
                "INSERT INTO resume_versions (id, user_id, source, parsed, confirmed_at) "
                "VALUES (gen_random_uuid(), :u, 'UPLOAD', '{}', now())",
                u=owner,
            )
        ver = (
            version
            if owner == uid
            else await _scalar("SELECT id FROM resume_versions WHERE user_id = :u LIMIT 1", u=owner)
        )
        await _exec(
            "INSERT INTO scores (id, user_id, resume_version_id, algorithm_version, raw_value, "
            "base_value, addon_value, contribution_version, extraction_cache_key) VALUES "
            "(gen_random_uuid(), :u, :v, 'test', 800, 800, 0, 'v1', :k)",
            u=owner,
            v=str(ver),
            k=key,
        )

    employer = await _employer()
    await _application(employer, me["id"], outcome="INTERVIEW")
    await _exec(
        "INSERT INTO candidate_view_events (tenant_id, actor_id, candidate_id, viewed_at) "
        "SELECT :t, u.id, :c, now() FROM users u "
        "WHERE u.pool = 'BUSINESS' LIMIT 1",
        t=str(employer[0]),
        c=uid,
    )
    await _exec(
        "INSERT INTO audit_events (actor_id, actor_role, action, target_type, target_id, "
        "tenant_id) VALUES (NULL, 'EMPLOYER_RECRUITER', 'candidate_profile_viewed', "
        "'candidate', :c, :t)",
        c=uid,
        t=str(employer[0]),
    )

    college = await _college(client, mint_token)
    await _allocate(college["tenant_id"], 5)
    code = await _code(client, college)
    linked = await _link(client, me, code["code"])
    assert linked.json()["seat_held"] is True
    seats_before = await _scalar(
        "SELECT seats_used FROM college_seats WHERE tenant_id = :t", t=college["tenant_id"]
    )

    # -- the request -----------------------------------------------------
    asked = (await client.post(f"{PRIVACY}/deletion", headers=me["headers"])).json()
    outcome = await erase_one(
        dsr_id=uuid.UUID(asked["id"]), user_id=me["id"], now=datetime.now(UTC)
    )
    assert outcome == "erased"

    # -- gone ------------------------------------------------------------
    assert resume_key in [key for _, key in fake_s3.deleted], "the CV object goes first"
    for table, plan in ERASURE_PLAN.items():
        if plan.disposition is not Disposition.ERASE or table in ("resume_extractions",):
            continue
        link = plan.link
        if link in ("application_id", "session_id", "answer_id", "raised_by"):
            continue  # reached through a parent checked here
        count = await _scalar(f"SELECT count(*) FROM {table} WHERE {link} = :u", u=uid)
        assert count == 0, f"{table} still holds {count} rows for an erased candidate"
    assert (
        await _scalar("SELECT count(*) FROM resume_extractions WHERE cache_key = :k", k=mine) == 0
    )
    assert (
        await _scalar("SELECT count(*) FROM resume_extractions WHERE cache_key = :k", k=shared) == 1
    ), "a cache row another candidate's score still names must survive"

    user = await _scalar(
        "SELECT json_build_object('phone', phone, 'email', email, 'sub', cognito_sub, "
        "'status', status) FROM users WHERE id = :u",
        u=uid,
    )
    import hashlib

    assert user["phone"] is None and user["email"] is None and user["status"] == "DELETED"
    assert user["sub"] is not None and len(user["sub"]) == 64
    assert user["sub"] == hashlib.sha256(me["subject"].encode()).hexdigest(), (
        "the subject is replaced by its hash, so a live token is recognised and refused"
    )
    assert (
        await _scalar(
            "SELECT seats_used FROM college_seats WHERE tenant_id = :t", t=college["tenant_id"]
        )
        == seats_before - 1
    ), "the college gets its seat back"

    # -- kept ------------------------------------------------------------
    assert await _scalar("SELECT count(*) FROM subscriptions WHERE subscriber_id = :u", u=uid) == 1
    assert (
        await _scalar("SELECT count(*) FROM candidate_view_events WHERE candidate_id = :u", u=uid)
        == 1
    )
    assert await _scalar("SELECT count(*) FROM audit_events WHERE target_id = :u", u=uid) >= 1

    record = await _scalar(
        "SELECT json_build_object('state', state, 'policy', policy_version, 'manifest', manifest) "
        "FROM dsr_requests WHERE id = :i",
        i=asked["id"],
    )
    assert record["state"] == "COMPLETED"
    assert record["policy"] == RETENTION_POLICY_VERSION
    # One score from `_candidate`, two added above.
    assert record["manifest"]["scores"] == 3 and record["manifest"]["applications"] == 1
    assert record["manifest"]["users"] == 1
    assert (
        await _scalar(
            "SELECT count(*) FROM audit_events WHERE action = 'dsr_completed' AND target_id = :i",
            i=asked["id"],
        )
        == 1
    )

    # The token is still cryptographically valid, and opens nothing.
    after = await client.get(PRIVACY, headers=me["headers"])
    assert after.status_code == 401 and after.json()["code"] == "account_inactive"


async def test_an_erasure_destroys_an_export_this_person_already_took(
    client: Any, mint_token: Any, fake_s3: FakeExportS3
) -> None:
    """An archive is the whole of somebody's record in one object. Asking for
    an export and then asking to be forgotten must not leave that copy behind
    for a sweep that has no schedule yet."""
    from app.tasks.privacy_requests import erase_one, run_export

    me = await _candidate(mint_token, scored=False)
    export = (await client.post(f"{PRIVACY}/export", headers=me["headers"])).json()
    await run_export(dsr_id=uuid.UUID(export["id"]), user_id=me["id"], now=datetime.now(UTC))
    key = await _scalar("SELECT export_s3_key FROM dsr_requests WHERE id = :i", i=export["id"])
    assert key in fake_s3.objects

    deletion = (await client.post(f"{PRIVACY}/deletion", headers=me["headers"])).json()
    assert (
        await erase_one(dsr_id=uuid.UUID(deletion["id"]), user_id=me["id"], now=datetime.now(UTC))
        == "erased"
    )

    assert key in [k for _, k in fake_s3.deleted], "the archive goes with the person"
    assert (
        await _scalar("SELECT export_s3_key FROM dsr_requests WHERE id = :i", i=export["id"])
        is None
    ), "and the row stops saying where a copy of it used to be"


async def test_a_failed_object_delete_puts_the_request_back_for_retry(
    client: Any, mint_token: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core import storage
    from app.tasks.privacy_requests import erase_one

    me = await _candidate(mint_token, scored=False)
    await _exec(
        "INSERT INTO resume_files (id, user_id, s3_key, mime, size_bytes, scan_status, "
        "parse_status) "
        "VALUES (gen_random_uuid(), :u, 'resumes/x.pdf', 'application/pdf', 1, 'CLEAN', 'DONE')",
        u=str(me["id"]),
    )

    async def broken(*, bucket: str, key: str) -> None:
        raise RuntimeError("s3 is down")

    monkeypatch.setattr(storage, "delete_object", broken)
    asked = (await client.post(f"{PRIVACY}/deletion", headers=me["headers"])).json()
    result = await erase_one(dsr_id=uuid.UUID(asked["id"]), user_id=me["id"], now=datetime.now(UTC))

    assert result == "failed"
    assert (
        await _scalar("SELECT state FROM dsr_requests WHERE id = :i", i=asked["id"]) == "RECEIVED"
    )
    assert await _scalar("SELECT status FROM users WHERE id = :u", u=str(me["id"])) == "ACTIVE"
    assert (
        await _scalar("SELECT count(*) FROM resume_files WHERE user_id = :u", u=str(me["id"])) == 1
    ), "rows, and so the keys, stay for the retry"


# ===========================================================================
# The database holds it
# ===========================================================================
async def test_the_request_guard_and_grants(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token, scored=False)
    asked = (await client.post(f"{PRIVACY}/export", headers=me["headers"])).json()

    with pytest.raises(DBAPIError, match="DSR_GUARD"):
        await _exec(
            "INSERT INTO dsr_requests (id, user_id, type, state, due_at, completed_at) "
            "VALUES (gen_random_uuid(), :u, 'DELETE', 'COMPLETED', now(), now())",
            u=str(me["id"]),
        )
    with pytest.raises(DBAPIError, match="DSR_GUARD"):
        await _exec("UPDATE dsr_requests SET state = 'COMPLETED' WHERE id = :i", i=asked["id"])
    with pytest.raises(DBAPIError, match="DSR_GUARD"):
        await _exec("UPDATE dsr_requests SET type = 'DELETE' WHERE id = :i", i=asked["id"])

    await _exec(
        "UPDATE dsr_requests SET state = 'REJECTED', completed_at = now() WHERE id = :i",
        i=asked["id"],
    )
    with pytest.raises(DBAPIError, match="DSR_GUARD"):
        await _exec("UPDATE dsr_requests SET completed_at = now() WHERE id = :i", i=asked["id"])

    with pytest.raises(DBAPIError, match="permission denied"):
        async with sessions(APP_URL)() as session, session.begin():
            await session.execute(
                text("DELETE FROM dsr_requests WHERE id = :i"), {"i": asked["id"]}
            )


async def test_a_deletion_cannot_complete_without_its_evidence(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token, scored=False)
    asked = (await client.post(f"{PRIVACY}/deletion", headers=me["headers"])).json()
    await _exec("UPDATE dsr_requests SET state = 'PROCESSING' WHERE id = :i", i=asked["id"])
    with pytest.raises(DBAPIError, match="ck_dsr_completed_delete_has_manifest"):
        await _exec(
            "UPDATE dsr_requests SET state = 'COMPLETED', completed_at = now() WHERE id = :i",
            i=asked["id"],
        )


async def test_erase_candidate_refuses_business_accounts_and_no_policy(
    mint_token: Any, client: Any
) -> None:
    headers, _ = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:10]}@example.test")
    created = await client.post(
        "/api/v1/employer/organisation", json={"legal_name": "Erase Refusal Ltd"}, headers=headers
    )
    owner = await _scalar(
        "SELECT user_id FROM memberships WHERE tenant_id = :t", t=created.json()["tenant_id"]
    )
    for user_id, policy in ((owner, RETENTION_POLICY_VERSION), (uuid.uuid4(), "")):
        with pytest.raises(DBAPIError, match="ERASURE"):
            async with sessions(APP_URL)() as session, session.begin():
                await session.execute(
                    text("SELECT erase_candidate(:u, :p)"), {"u": str(user_id), "p": policy}
                )


# ===========================================================================
# The sign-in itself
# ===========================================================================
# Before this, an erasure emptied the `users` row and left the Cognito user
# standing. `cognito_sub` is replaced by its SHA-256 rather than nulled, so a
# token issued before the erasure still matched the DELETED row and was
# refused -- which is right. But so was a *fresh* sign-in with the same
# address, because Cognito handed back the same subject and its hash was
# still on file. The person was locked out permanently instead of being able
# to start again, and only support could fix it.
async def test_an_erasure_destroys_the_cognito_user(
    client: Any, mint_token: Any, fake_s3: FakeExportS3
) -> None:
    from app.core.auth.directory import get_account_directory
    from app.tasks.privacy_requests import erase_one

    directory = get_account_directory()
    me = await _candidate(mint_token, scored=False)

    requested = await client.post(f"{PRIVACY}/deletion", headers=me["headers"])
    assert requested.status_code == 202, requested.text
    dsr_id = uuid.UUID(requested.json()["id"])

    before = len(directory.deleted)
    assert await erase_one(dsr_id=dsr_id, user_id=me["id"], now=datetime.now(UTC)) == "erased"

    asked = directory.deleted[before:]
    assert [d["subject"] for d in asked] == [me["subject"]], (
        "the erasure did not ask for the sign-in to be destroyed"
    )
    assert asked[0]["pool"] == "CANDIDATE"


async def test_the_subject_is_read_before_the_cascade_destroys_it() -> None:
    """**Why the order is what it is.** `erase_candidate` replaces
    `cognito_sub` with its SHA-256, so after the cascade there is no
    identifier left to delete the Cognito user by -- only a hash that
    addresses nothing in the pool. Reading it afterwards reads the hash and
    would ask Cognito to delete a user that does not exist.
    """
    from app.core.auth.users import erased_subject
    from app.modules.privacy import repository

    user_id, subject = uuid.uuid4(), f"local-test-{uuid.uuid4()}"
    await _exec(
        "INSERT INTO users (id, cognito_sub, pool, status, locale) "
        "VALUES (:u, :s, 'CANDIDATE', 'ACTIVE', 'en')",
        u=str(user_id),
        s=subject,
    )
    async with sessions(_seed_url())() as session:
        assert await repository.sign_in_to_destroy(session, user_id=user_id) == (
            "CANDIDATE",
            subject,
        )

    # Simulate what the cascade leaves behind.
    await _exec(
        "UPDATE users SET cognito_sub = :hashed WHERE id = :u",
        u=str(user_id),
        hashed=erased_subject(subject),
    )
    async with sessions(_seed_url())() as session:
        after = await repository.sign_in_to_destroy(session, user_id=user_id)
    assert after is not None
    assert after[1] != subject, "reading after the cascade yields the hash, which deletes nothing"


async def test_an_account_nobody_ever_signed_in_to_has_no_sign_in_to_destroy() -> None:
    """A staff-created account that was never used has a `users` row and no
    Cognito user. Asking Cognito to delete nothing would be an error we would
    then have to special-case, so it is simply not asked."""
    from app.modules.privacy import repository

    user_id = uuid.uuid4()
    await _exec(
        "INSERT INTO users (id, pool, email, status, locale) "
        "VALUES (:u, 'CANDIDATE', :e, 'ACTIVE', 'en')",
        u=str(user_id),
        e=f"{uuid.uuid4().hex[:12]}@example.test",
    )
    async with sessions(_seed_url())() as session:
        assert await repository.sign_in_to_destroy(session, user_id=user_id) is None


async def test_a_failed_cognito_delete_leaves_the_data_intact_for_a_retry(
    client: Any, mint_token: Any, fake_s3: FakeExportS3, monkeypatch: Any
) -> None:
    """**The reason the Cognito call precedes the cascade.**

    Every step before the cascade is retryable, because the cascade is what
    makes its own inputs unreachable. So a Cognito outage releases the request
    back to RECEIVED with the person's data still present and still erasable,
    rather than destroying the data and leaving a sign-in nothing can name.
    """
    from app.core.auth import directory as directory_module
    from app.tasks.privacy_requests import erase_one

    me = await _candidate(mint_token, scored=False)
    requested = await client.post(f"{PRIVACY}/deletion", headers=me["headers"])
    dsr_id = uuid.UUID(requested.json()["id"])

    class Refusing(directory_module.LocalAccountDirectory):
        async def delete_user(self, *, pool: Any, subject: str) -> None:
            raise directory_module.DirectoryError("cognito_ServiceUnavailable")

    monkeypatch.setattr(directory_module, "get_account_directory", lambda: Refusing())

    assert await erase_one(dsr_id=dsr_id, user_id=me["id"], now=datetime.now(UTC)) == "failed"

    async with sessions(_seed_url())() as session:
        state = await session.scalar(
            text("SELECT state FROM dsr_requests WHERE id = :d"), {"d": str(dsr_id)}
        )
        status = await session.scalar(
            text("SELECT status FROM users WHERE id = :u"), {"u": str(me["id"])}
        )
    assert state == "RECEIVED", "a failure must return the request to the queue"
    assert status == "ACTIVE", "the person must still be erasable on the next sweep"
