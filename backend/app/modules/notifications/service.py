"""notifications - business rules and transaction boundaries

Event to channel fan-out, templates.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**Two phases, two kinds of transaction.** `dispatch_event` and `nudge_page`
decide: they write one `notifications` row per recipient, channel and
template -- skipped rows included, with their reason -- and return what is
left to send. The task commits that, then `send` delivers each message in its
own short transaction. A provider call never runs inside the transaction that
decided to make it, so a slow SMS gateway holds no locks, and a crash between
the two leaves a PENDING row rather than a message sent twice.

**At least once, deduplicated.** The relay may deliver an event twice. Every
row is keyed (`dedupe_key`: the event or nudge, the recipient, the template),
so the second dispatch writes nothing new and returns the rows still PENDING
from the first, which `send` then claims with `SKIP LOCKED`.

**Contacts never reach the table or the outbox.** A row names the account or
the roster entry; the phone number or address is resolved in memory for the
send and dropped.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, audit_event
from app.core.errors import AppError, NotFoundError, ValidationError
from app.core.i18n import DEFAULT_LOCALE, load_bundle
from app.core.logging import get_logger
from app.core.pagination import clamp_limit, decode_cursor, encode_cursor
from app.core.tenant import TenantContext
from app.modules.applications import service as applications_service
from app.modules.college import service as college_service
from app.modules.identity import service as identity_service
from app.modules.notifications import repository, unsubscribe
from app.modules.notifications.domain import (
    DEFAULT_NUDGE_RULES,
    NUDGE_TEMPLATES,
    NudgeRules,
    NudgeRulesError,
    Planned,
    Preferences,
    Recipient,
    delivery_decision,
    format_amount,
    format_date,
    format_moment,
    nudge_due,
    nudge_rules_from_config,
    plan_for,
    render,
    within_sending_hours,
)
from app.modules.notifications.providers import (
    DeliveryError,
    get_email_provider,
    get_sms_provider,
)
from app.modules.notifications.schemas import (
    InboxItem,
    InboxPage,
    PreferencesResponse,
    SuppressResponse,
)
from app.modules.notifications.templates import (
    TEMPLATES_VERSION,
    MessageTemplate,
    template_by_code,
)
from app.modules.resume import service as resume_service

logger = get_logger(__name__)

NUDGE_CONFIG_KEY: Final = "notifications.nudges"
NUDGE_PAGE_SIZE: Final = 500
EMPLOYER_OWNER_ROLES: Final = frozenset({"EMPLOYER_OWNER"})
COLLEGE_ADMIN_ROLES: Final = frozenset({"COLLEGE_ADMIN"})


class NotificationNotFoundError(NotFoundError):
    code = "notification_not_found"
    title = "Notification not found"


class NudgeRulesInvalidError(AppError):
    """A bad `notifications.nudges` row stops the sweep. Falling back to the
    defaults would nudge people on rules nobody chose."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "nudge_rules_invalid"
    title = "Nudge rules are misconfigured"


@dataclass(frozen=True, slots=True)
class Outgoing:
    """One message to hand to a provider. Held in memory only."""

    notification_id: uuid.UUID
    channel: str
    to: str
    subject: str | None
    body: str
    dlt_template_id: str | None
    #: Who it is for and what kind, so `send` can attach RFC 8058 unsubscribe
    #: headers to a nudge. A nudge is the only message a person
    #: may reasonably not want; a transactional one carries no unsubscribe,
    #: because "your payment failed" is not something to opt out of.
    user_id: uuid.UUID | None = None
    category: str = "TRANSACTIONAL"


@dataclass(frozen=True, slots=True)
class _Addressee:
    key: str
    user_id: uuid.UUID | None
    roster_entry_id: uuid.UUID | None
    locale: str
    recipient: Recipient
    preferences: Preferences
    suppressed: frozenset[str]


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


def _uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value is not None else None
    except ValueError:
        return None


def _localised(template: MessageTemplate, locale: str) -> str:
    """The reader's language, else English, else the template's own source.
    Per key, so one missing translation does not revert the message."""
    return (
        load_bundle(locale).get(template.key)
        or load_bundle(DEFAULT_LOCALE).get(template.key)
        or template.body
    )


def _provider_configured(channel: str) -> bool:
    if channel == "SMS":
        return get_sms_provider().configured
    if channel == "EMAIL":
        return get_email_provider().configured
    return channel == "IN_APP"


# ---------------------------------------------------------------------------
# Who
# ---------------------------------------------------------------------------
async def _account_addressees(session: AsyncSession, user_ids: list[uuid.UUID]) -> list[_Addressee]:
    unique = list(dict.fromkeys(user_ids))
    contacts = await identity_service.contacts(session, user_ids=unique)
    preferences = await repository.preferences_for(session, user_ids=unique)
    suppressions = await repository.open_suppressions(session, user_ids=unique)
    addressees = []
    for user_id in unique:
        contact = contacts.get(user_id)
        if contact is None:
            continue
        stored = preferences.get(user_id)
        addressees.append(
            _Addressee(
                key=f"user:{user_id}",
                user_id=user_id,
                roster_entry_id=None,
                locale=contact.locale,
                recipient=Recipient(
                    account_active=contact.status == "ACTIVE",
                    phone=contact.phone,
                    email=contact.email,
                ),
                preferences=Preferences(
                    sms_enabled=stored.sms_enabled,
                    email_enabled=stored.email_enabled,
                    push_enabled=stored.push_enabled,
                    nudges_enabled=stored.nudges_enabled,
                )
                if stored
                else Preferences(),
                suppressed=suppressions.get(user_id, frozenset()),
            )
        )
    return addressees


async def _organisation_members(
    session: AsyncSession, tenant_id: uuid.UUID | None, roles: frozenset[str]
) -> list[uuid.UUID]:
    if tenant_id is None:
        return []
    return await identity_service.member_ids(session, tenant_id=tenant_id, roles=roles)


async def _addressees(
    session: AsyncSession, plan: Planned, payload: dict[str, Any], aggregate_id: str
) -> list[_Addressee]:
    audience = plan.audience
    if audience == "CANDIDATE":
        ids = [_uuid(payload.get("candidate_id"))]
    elif audience == "USER":
        ids = [_uuid(payload.get("user_id"))]
    elif audience == "DISPUTE_RAISER":
        ids = [_uuid(payload.get("raised_by"))]
    elif audience == "EMPLOYER_OWNERS":
        ids = list(
            await _organisation_members(
                session, _uuid(payload.get("tenant_id")), EMPLOYER_OWNER_ROLES
            )
        )
    elif audience == "COLLEGE_ADMINS":
        ids = list(
            await _organisation_members(
                session, _uuid(payload.get("tenant_id")), COLLEGE_ADMIN_ROLES
            )
        )
    elif audience == "SUBSCRIBER":
        subscriber = _uuid(payload.get("subscriber_id"))
        if payload.get("subscriber_type") == "USER":
            ids = [subscriber]
        elif subscriber is None:
            ids = []
        else:
            tenant = await identity_service.get_tenant(session, tenant_id=subscriber)
            roles = EMPLOYER_OWNER_ROLES if tenant.type == "EMPLOYER" else COLLEGE_ADMIN_ROLES
            ids = list(await _organisation_members(session, subscriber, roles))
    else:  # ROSTER_CONTACT
        return await _roster_addressee(session, payload, aggregate_id)
    return await _account_addressees(session, [i for i in ids if i is not None])


async def _roster_addressee(
    session: AsyncSession, payload: dict[str, Any], aggregate_id: str
) -> list[_Addressee]:
    """A college's invitation, to whatever contact the college uploaded. The
    contact may belong to nobody on the platform yet, so there is no account,
    no language and no preference to consult: English, everything on."""
    tenant_id, entry_id = _uuid(payload.get("tenant_id")), _uuid(aggregate_id)
    if tenant_id is None or entry_id is None:
        return []
    found = await college_service.invitation_recipient(
        session, tenant_id=tenant_id, entry_id=entry_id
    )
    if found is None:
        return []
    return [
        _Addressee(
            key=f"roster:{entry_id}",
            user_id=None,
            roster_entry_id=entry_id,
            locale=DEFAULT_LOCALE,
            recipient=Recipient(account_active=True, phone=found.phone, email=found.email),
            preferences=Preferences(),
            suppressed=frozenset(),
        )
    ]


async def _variables(
    session: AsyncSession, plan: Planned, payload: dict[str, Any]
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for name in plan.variables:
        if name in ("employer", "college"):
            tenant_id = _uuid(payload.get("tenant_id"))
            if tenant_id is not None:
                values[name] = (
                    await identity_service.get_tenant(session, tenant_id=tenant_id)
                ).name
        elif name == "amount" and isinstance(payload.get("amount_minor"), int):
            values[name] = int(payload["amount_minor"])
        elif name == "date" and payload.get("debit_not_before"):
            values[name] = datetime.fromisoformat(str(payload["debit_not_before"]))
    if {"message", "when", "link"} & set(plan.variables):
        values.update(await _message_variables(session, payload))
    return values


async def _message_variables(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    """An employer's message, read at dispatch: the payload names it and
    carries none of its words. A template that does not use a value ignores
    it; a missing link becomes an empty line, never a visible `{link}`."""
    message_id = _uuid(payload.get("message_id"))
    found = (
        await applications_service.message_for_delivery(session, message_id=message_id)
        if message_id is not None
        else None
    )
    if found is None:
        return {}
    values: dict[str, Any] = {"message": found.body, "link": found.link or ""}
    if found.scheduled_at is not None:
        values["when"] = found.scheduled_at
    return values


def _for_channel(values: dict[str, Any], channel: str) -> dict[str, str]:
    rendered: dict[str, str] = {}
    for name, value in values.items():
        if name == "amount":
            rendered[name] = format_amount(int(value), channel=channel)
        elif name == "date":
            rendered[name] = format_date(value)
        elif name == "when":
            rendered[name] = format_moment(value)
        else:
            rendered[name] = str(value)
    return rendered


# ---------------------------------------------------------------------------
# Decide
# ---------------------------------------------------------------------------
async def _write(
    session: AsyncSession,
    *,
    addressee: _Addressee,
    template: MessageTemplate,
    category: str,
    values: dict[str, Any],
    dedupe_key: str,
    source_event_id: uuid.UUID | None,
    mandatory: bool,
    now: datetime,
) -> Outgoing | None:
    channel = template.channel
    body = render(
        _localised(template, addressee.locale), _for_channel(values, channel), channel=channel
    )
    state, reason = delivery_decision(
        template=template,
        category=category,
        recipient=addressee.recipient,
        preferences=addressee.preferences,
        suppressed_channels=addressee.suppressed,
        provider_configured=_provider_configured(channel),
        mandatory=mandatory,
    )
    notification_id = await repository.insert_notification(
        session,
        user_id=addressee.user_id,
        roster_entry_id=addressee.roster_entry_id,
        template_code=template.code,
        channel=channel,
        category=category,
        locale=addressee.locale,
        templates_version=TEMPLATES_VERSION,
        subject=template.subject,
        body=body,
        state=state,
        skip_reason=reason,
        source_event_id=source_event_id,
        dedupe_key=dedupe_key,
        sent_at=now if state == "DELIVERED" else None,
    )
    if notification_id is None:
        # Written by an earlier delivery of the same event. Still PENDING if
        # that attempt died before sending, and then it is ours to send.
        existing = await repository.pending_by_key(session, dedupe_key=dedupe_key)
        if existing is None:
            return None
        notification_id, state = existing, "PENDING"
    if state != "PENDING":
        return None
    to = addressee.recipient.phone if channel == "SMS" else addressee.recipient.email
    assert to is not None  # delivery_decision refused a missing contact
    return Outgoing(
        notification_id=notification_id,
        channel=channel,
        to=to,
        subject=template.subject,
        body=body,
        dlt_template_id=template.dlt_template_id,
        user_id=addressee.user_id,
        category=category,
    )


async def dispatch_event(
    session: AsyncSession, *, event_id: uuid.UUID, now: datetime | None = None
) -> list[Outgoing]:
    """Decide every message one outbox event causes. See the module docstring."""
    now = _now(now)
    event = await repository.outbox_event(session, event_id=event_id)
    if event is None:
        return []
    payload = dict(event.payload or {})
    outgoing: list[Outgoing] = []
    for plan in plan_for(event.event_type, payload):
        values = await _variables(session, plan, payload)
        for addressee in await _addressees(session, plan, payload, event.aggregate_id):
            for code in plan.templates:
                template = template_by_code(code)
                assert template is not None, code  # test_every_planned_template_exists
                message = await _write(
                    session,
                    addressee=addressee,
                    template=template,
                    category="TRANSACTIONAL",
                    values=values,
                    dedupe_key=f"event:{event.id}:{addressee.key}:{code}",
                    source_event_id=event.id,
                    mandatory=plan.mandatory,
                    now=now,
                )
                if message is not None:
                    outgoing.append(message)
    logger.info("notifications_dispatched", event_type=event.event_type, to_send=len(outgoing))
    return outgoing


# ---------------------------------------------------------------------------
# Send
# ---------------------------------------------------------------------------
def _unsubscribe_headers(message: Outgoing) -> dict[str, str]:
    """RFC 8058 headers, on a nudge to an account, when configured.

    **Only a nudge.** A transactional message -- a receipt, a failed payment,
    a pre-debit notice -- carries no unsubscribe, because it is not something
    to opt out of and offering it would either lie or quietly turn off
    messages the person needs. A roster invitation has no account to
    unsubscribe, which is why `user_id` is checked and not assumed.
    """
    if message.category != "NUDGE" or message.user_id is None:
        return {}
    return unsubscribe.headers_for(message.user_id)


async def send(session: AsyncSession, *, message: Outgoing, now: datetime | None = None) -> str:
    """Hand one message to its provider and record the outcome. Returns the
    row's state, or `NOT_PENDING` if another worker has it or it is done."""
    row = await repository.claim_pending(session, notification_id=message.notification_id)
    if row is None:
        return "NOT_PENDING"
    try:
        if message.channel == "SMS":
            if message.dlt_template_id is None:  # pragma: no cover - refused at decision
                raise DeliveryError("dlt_unregistered")
            provider_name = get_sms_provider().name
            ref = await get_sms_provider().send(
                to=message.to, body=message.body, dlt_template_id=message.dlt_template_id
            )
        else:
            provider_name = get_email_provider().name
            ref = await get_email_provider().send(
                to=message.to,
                subject=message.subject or "",
                body=message.body,
                headers=_unsubscribe_headers(message),
            )
    except DeliveryError as exc:
        await repository.mark(
            session, notification_id=row.id, state="FAILED", failure_code=exc.code[:64]
        )
        logger.warning("notification_failed", channel=message.channel, code=exc.code)
        return "FAILED"
    await repository.mark(
        session,
        notification_id=row.id,
        state="SENT",
        provider=provider_name,
        provider_ref=ref[:128],
        sent_at=_now(now),
    )
    return "SENT"


# ---------------------------------------------------------------------------
# Incomplete-profile nudges (R9)
# ---------------------------------------------------------------------------
async def load_nudge_rules(session: AsyncSession, *, now: datetime) -> tuple[NudgeRules, int]:
    """The rules and the config version they came from (0: our defaults)."""
    row = await repository.current_config(session, key=NUDGE_CONFIG_KEY, now=now)
    if row is None:
        return DEFAULT_NUDGE_RULES, 0
    try:
        return nudge_rules_from_config(row.value), row.version
    except NudgeRulesError as exc:
        logger.error("nudge_rules_invalid", config_version=row.version, error=str(exc))
        raise NudgeRulesInvalidError() from exc


@dataclass(frozen=True, slots=True)
class NudgePage:
    examined: int
    nudged: int
    outgoing: list[Outgoing]
    #: Pass back as `after_id` for the next page; None when done.
    next_after: uuid.UUID | None


async def nudge_page(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    after_id: uuid.UUID | None = None,
    limit: int = NUDGE_PAGE_SIZE,
) -> NudgePage:
    """One page of the sweep: candidates who signed up long enough ago and
    have started no profile at all -- no upload, no paste, no form.

    Each is nudged only if due (`domain.nudge_due`: under the cap, past the
    interval), has not turned reminders off, and only inside sending hours.
    The nudge's number is claimed before any message is written, so two
    sweeps at once give a person one nudge, and that number is the cap.
    """
    now = _now(now)
    rules, version = await load_nudge_rules(session, now=now)
    if not rules.enabled or rules.max_nudges == 0 or not within_sending_hours(now, rules):
        return NudgePage(examined=0, nudged=0, outgoing=[], next_after=None)

    page = await identity_service.candidates_signed_up_before(
        session,
        before=now - timedelta(hours=rules.first_after_hours),
        after_id=after_id,
        limit=limit,
    )
    started = await resume_service.users_with_any_resume(session, user_ids=page)
    waiting = [user_id for user_id in page if user_id not in started]
    history = await repository.nudge_history(session, user_ids=waiting)
    due = [
        user_id
        for user_id in waiting
        if nudge_due(
            now=now,
            sent=history.get(user_id, (0, None))[0],
            last_sent_at=history.get(user_id, (0, None))[1],
            rules=rules,
        )
    ]

    outgoing: list[Outgoing] = []
    nudged = 0
    for addressee in await _account_addressees(session, due):
        if not addressee.preferences.nudges_enabled or not addressee.recipient.account_active:
            continue
        assert addressee.user_id is not None
        nudge_id = await repository.record_nudge(
            session,
            user_id=addressee.user_id,
            sequence=history.get(addressee.user_id, (0, None))[0] + 1,
            rules_version=version,
            now=now,
        )
        if nudge_id is None:
            continue
        nudged += 1
        for code in NUDGE_TEMPLATES:
            template = template_by_code(code)
            assert template is not None, code
            message = await _write(
                session,
                addressee=addressee,
                template=template,
                category="NUDGE",
                values={},
                dedupe_key=f"nudge:{nudge_id}:{code}",
                source_event_id=None,
                mandatory=False,
                now=now,
            )
            if message is not None:
                outgoing.append(message)

    logger.info("profile_nudge_page", examined=len(page), nudged=nudged)
    return NudgePage(
        examined=len(page),
        nudged=nudged,
        outgoing=outgoing,
        next_after=page[-1] if len(page) == limit else None,
    )


# ---------------------------------------------------------------------------
# The reader's side
# ---------------------------------------------------------------------------
async def inbox(
    session: AsyncSession, *, ctx: TenantContext, cursor: str | None, limit: int | None
) -> InboxPage:
    size = clamp_limit(limit)
    after: tuple[datetime, uuid.UUID] | None = None
    if cursor is not None:
        payload = decode_cursor(cursor)
        try:
            after = (datetime.fromisoformat(str(payload["t"])), uuid.UUID(str(payload["i"])))
        except (KeyError, ValueError) as exc:
            raise ValidationError(code="invalid_cursor") from exc
    rows = await repository.inbox(session, user_id=ctx.user_id, after=after, limit=size)
    return InboxPage(
        items=[InboxItem.model_validate(row) for row in rows],
        next_cursor=encode_cursor({"t": rows[-1].created_at.isoformat(), "i": str(rows[-1].id)})
        if len(rows) == size
        else None,
        unread=await repository.unread_count(session, user_id=ctx.user_id),
    )


async def mark_read(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    notification_id: uuid.UUID,
    now: datetime | None = None,
) -> InboxItem:
    """Someone else's message is a 404, never a 403."""
    row = await repository.mark_read(
        session, user_id=ctx.user_id, notification_id=notification_id, now=_now(now)
    )
    if row is None:
        raise NotificationNotFoundError()
    return InboxItem.model_validate(row)


async def preferences(session: AsyncSession, *, ctx: TenantContext) -> PreferencesResponse:
    contacts = await identity_service.contacts(session, user_ids=[ctx.user_id])
    stored = (await repository.preferences_for(session, user_ids=[ctx.user_id])).get(ctx.user_id)
    current = (
        Preferences(
            sms_enabled=stored.sms_enabled,
            email_enabled=stored.email_enabled,
            push_enabled=stored.push_enabled,
            nudges_enabled=stored.nudges_enabled,
        )
        if stored
        else Preferences()
    )
    return PreferencesResponse(
        locale=contacts[ctx.user_id].locale,
        sms_enabled=current.sms_enabled,
        email_enabled=current.email_enabled,
        push_enabled=current.push_enabled,
        nudges_enabled=current.nudges_enabled,
    )


async def update_preferences(
    session: AsyncSession, *, ctx: TenantContext, changes: dict[str, Any]
) -> PreferencesResponse:
    locale = changes.pop("locale", None)
    if locale is not None:
        await identity_service.set_locale(session, user_id=ctx.user_id, locale=locale)
    flags = {k: bool(v) for k, v in changes.items() if v is not None}
    if flags:
        current = await preferences(session, ctx=ctx)
        await repository.upsert_preferences(
            session,
            user_id=ctx.user_id,
            values={
                "sms_enabled": current.sms_enabled,
                "email_enabled": current.email_enabled,
                "push_enabled": current.push_enabled,
                "nudges_enabled": current.nudges_enabled,
                **flags,
            },
        )
    return await preferences(session, ctx=ctx)


async def suppress(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    channel: str,
    reason: str,
    request_id: str | None = None,
) -> SuppressResponse:
    """Put one account on the suppression list for a channel, or for all of
    them. Our decision, not the person's preference: a bounced address, a
    complaint, a request made to support. Audited."""
    if not await identity_service.contacts(session, user_ids=[user_id]):
        raise NotificationNotFoundError(code="notification_recipient_not_found")
    created = await repository.suppress(
        session, user_id=user_id, channel=channel, reason=reason, created_by=ctx.user_id
    )
    await audit_event(
        session,
        action=AuditAction.NOTIFICATIONS_SUPPRESSED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"channel": channel, "reason": reason, "created": created},
    )
    return SuppressResponse(user_id=user_id, channel=channel, created=created)


# ---------------------------------------------------------------------------
# Messages a crashed worker left behind
# ---------------------------------------------------------------------------
#: How long a message must sit PENDING before the sweep treats it as
#: abandoned rather than in flight. `send_all` works through a batch one short
#: transaction at a time, so a large fan-out can legitimately leave rows
#: PENDING for a while; fifteen minutes is far longer than that takes and far
#: shorter than a person would wait to hear about a payment.
ORPHAN_AFTER_MINUTES: Final = 15

#: A bounded batch, like every other sweep here. A backlog drains over
#: several runs rather than holding one worker for an unbounded time.
ORPHAN_BATCH: Final = 200


async def orphaned_messages(
    session: AsyncSession, *, now: datetime | None = None, limit: int = ORPHAN_BATCH
) -> list[Outgoing]:
    """Rebuild the messages a crashed worker decided and never sent.

    **The contact has to be resolved again, not read back.** Nothing stores
    it: `Notification` keeps the rendered body and who it was for, and never
    the address, because a contact on a message row is a second copy of
    personal data that the erasure would then have to find. So this asks
    `identity` for the address exactly as the original dispatch did.

    That re-resolution is also a correctness win rather than a cost. A
    message decided an hour ago and sent now goes to the address the person
    has *now*, and a message for somebody since deleted resolves to no
    contact and is dropped here rather than sent to a stranger.
    """
    moment = _now(now)
    rows = await repository.orphaned_pending(
        session, cutoff=moment - timedelta(minutes=ORPHAN_AFTER_MINUTES), limit=limit
    )
    if not rows:
        return []

    user_ids = [row.user_id for row in rows if row.user_id is not None]
    contacts = await identity_service.contacts(session, user_ids=user_ids)

    outgoing: list[Outgoing] = []
    for row in rows:
        contact = contacts.get(row.user_id) if row.user_id is not None else None
        if contact is None or contact.status != "ACTIVE":
            # Erased, suspended, or simply gone between the decision and now.
            await repository.mark(
                session, notification_id=row.id, state="SKIPPED", skip_reason="ACCOUNT_INACTIVE"
            )
            continue
        address = contact.phone if row.channel == "SMS" else contact.email
        if not address:
            await repository.mark(
                session, notification_id=row.id, state="SKIPPED", skip_reason="NO_CONTACT"
            )
            continue
        template = template_by_code(row.template_code)
        outgoing.append(
            Outgoing(
                notification_id=row.id,
                channel=row.channel,
                to=address,
                subject=row.subject,
                # The stored body, never re-rendered. It was written in the
                # reader's language at the time and against the template
                # version recorded on the row; re-rendering now could quietly
                # send different words than the ones we recorded sending.
                body=row.body,
                dlt_template_id=template.dlt_template_id if template is not None else None,
                user_id=row.user_id,
                category=row.category,
            )
        )
    return outgoing


async def unsubscribe_by_token(session: AsyncSession, *, token: str) -> bool:
    """Turn nudges off for whoever this token names.

    **Nudges only, and only off.** The token cannot turn anything on, cannot
    touch another preference, and cannot read anything. The worst a stolen
    one does is stop reminders its holder was already receiving.

    Returns False for a token that is expired, forged, for another purpose,
    or names an account that no longer exists. The caller answers the same
    way in every case: an unauthenticated endpoint that distinguishes them is
    a way to probe for valid tokens, and for an account's existence.

    Idempotent -- a mail client that retries one-click must not be an error.
    """
    user_id = unsubscribe.verify(token)
    if user_id is None:
        return False
    found = await identity_service.contacts(session, user_ids=[user_id])
    if user_id not in found:
        return False
    current = await repository.preferences_for(session, user_ids=[user_id])
    stored = current.get(user_id)
    await repository.upsert_preferences(
        session,
        user_id=user_id,
        values={
            "sms_enabled": stored.sms_enabled if stored else True,
            "email_enabled": stored.email_enabled if stored else True,
            "push_enabled": stored.push_enabled if stored else True,
            "nudges_enabled": False,
        },
    )
    logger.info("nudges_unsubscribed", user_id=str(user_id), via="email_link")
    return True
