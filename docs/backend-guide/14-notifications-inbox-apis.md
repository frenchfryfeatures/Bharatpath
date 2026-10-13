# 14 — Notifications: the in-app inbox and per-channel preferences

Five endpoints, module `notifications`, prefix `/notifications`. Like
[15-privacy-and-data-rights-apis.md](15-privacy-and-data-rights-apis.md),
this whole module was missing from the API checklist until this pass —
recorded as having no HTTP surface at all, which was true of the *sending*
side (nothing calls a notifications endpoint to trigger a message — see
§0) but not of the reading side documented here.

---

## 0. The big picture — this module only ever answers, never triggers

**No endpoint here ever sends a message.** Every actual notification — a
payment receipt, a KYB decision, a hire confirmation — is decided and sent
entirely inside the backend, triggered by other modules' own events flowing
through the outbox relay (see the root `CLAUDE.md`'s note on Celery Beat and
`app/tasks/notify.py`). What this module's five HTTP routes give a signed-in
person is:

```
GET  /notifications                    → the in-app inbox, newest first
POST /notifications/{id}/read          → mark one message read
GET  /notifications/preferences        → my language + which channels reach me
PATCH /notifications/preferences       → change them
POST /notifications/unsubscribe        → stop nudges, from an email link
                                          (the ONE unauthenticated route here)
```

**Every signed-in account has an inbox** — candidate, employer, college and
platform staff alike — and every route above (bar the last) reads or
changes only the *caller's own* messages and settings; there is no
parameter anywhere that could name someone else's. **Nothing here is
paywalled.** A lapsed subscriber must still be able to read the message
that says their access ended, and to turn off further reminders about it —
gating "read your own notifications" behind the very subscription those
notifications might be *about* would be a genuinely absurd trap.

---

## 1. `GET /notifications` — the inbox

**Auth required:** any signed-in account. **Request:** `cursor`/`limit`
query params (cursor-based pagination, max 100 per page).

**Response** — `200 OK` (`InboxPage`):
```json
{
  "items": [
    {
      "id": "9f2e...",
      "template_code": "PAYMENT_SUCCEEDED",
      "body": "Your payment of ₹999 was received. Your subscription is now active.",
      "created_at": "2026-09-23T09:00:00Z",
      "read_at": null
    }
  ],
  "next_cursor": null,
  "unread": 3
}
```
| Field | Meaning |
|---|---|
| `body` | The message **exactly as it was rendered and stored at send time**, in whatever language the reader's locale was *then* — never re-rendered on read. If their locale preference changes later, old messages don't retroactively change language; only new ones do. |
| `template_code` | Which template produced this, so a client can pick an icon or a tap-destination. **Not** a translation key for the client to re-render text from — the `body` is already the final words. |
| `unread` | A running count, independent of pagination — a badge can show this without walking every page. |

**No field here can ever hold a score.** `notifications-never-import-scoring`
is an enforced import-linter contract, and no template variable exists for
one — a message that told someone their score changed would be explaining
the score, which R11 forbids everywhere, including here.

## 2. `POST /notifications/{notification_id}/read` — mark one message read

**Auth required:** any signed-in account, own messages only.

**Request:** no body.

**Response** — `200 OK`, the updated `InboxItem` (`read_at` now set).

**`404 notification_not_found`** for someone else's message id, or one that
doesn't exist — **never `403`**, so a caller can't use the difference to
learn whether a given id belongs to anyone at all. Idempotent: marking an
already-read message read again just returns it unchanged.

---

## 3. `GET /notifications/preferences` — read my settings

**Auth required:** any signed-in account. **Request:** no body.

**Response** — `200 OK` (`PreferencesResponse`):
```json
{ "locale": "hi", "sms_enabled": true, "email_enabled": true, "push_enabled": true, "nudges_enabled": true }
```
Everything defaults to **on** for an account that's never touched this
endpoint — `locale` comes from the account's own profile setting, not this
module.

## 4. `PATCH /notifications/preferences` — change one or more

**Auth required:** any signed-in account.

**Request body** (`UpdatePreferencesRequest`) — send only what changes,
every field optional:
```json
{ "sms_enabled": false, "nudges_enabled": false }
```
`locale` must be one of the platform's nine supported codes (`en`, `hi`,
`bn`, `mr`, `pa`, `te`, `ta`, `gu`, `kn` — the exact set `LOCALE_CODES`
resolves to; `422` for anything else).

**Response** — `200 OK`, the updated `PreferencesResponse`.

**One flag this endpoint structurally cannot touch: there is no field to
turn off the in-app inbox itself.** `sms_enabled`, `email_enabled`, and
`push_enabled` govern channels; the inbox is where a message the law
requires the person to be able to see still reaches them regardless of
every other setting, so it was never given an on/off field at all.

**One category of message ignores `sms_enabled` entirely, by law, not by
a bug:** a UPI pre-debit notice (`EMAIL_MANDATE_PRE_DEBIT` — an email
despite the name, per the "no SMS at all" decision covered in the root
`CLAUDE.md`) is sent regardless of channel opt-outs, because the notice is
legally required before an automatic debit and isn't something a payer is
allowed to opt out of just by disliking reminders.

---

## 5. `POST /notifications/unsubscribe` — the one unauthenticated route here

**Auth required: none, deliberately.** No token, no session — this exists
specifically so someone doesn't need one.

**Request body** (`UnsubscribeRequest`):
```json
{ "token": "eyJhbGc..." }
```
The token comes from the `List-Unsubscribe` header of an email the person
was sent — not something a client ever constructs itself.

**Response** — `200 OK` (`UnsubscribeResponse`), **always the same body,
regardless of what actually happened**:
```json
{ "detail": "If that link was still valid, you will not receive profile reminders again." }
```
This is deliberate, not a missed edge case: an unauthenticated endpoint
that answered differently for a valid token, an expired one, a forged one,
and one naming an account that no longer exists would be a way for anyone
to probe for valid tokens and for whether a given account exists at all —
and there's nothing the caller could act on differently anyway, since all
they can do is read this message.

**Why this route is `POST`, not the `GET` an "unsubscribe link" suggests:**
mail clients and corporate security scanners routinely *prefetch* every
link inside an email before a human ever clicks anything. A `GET` here
would silently unsubscribe people who never actually chose to. This is
specifically the RFC 8058 one-click pattern — the same standard `Gmail`
and `Outlook` expect, named by the `List-Unsubscribe-Post` header on the
originating email.

**What it can and cannot do:** it can only turn **nudges off** — the
incomplete-profile reminder sequence — for the one account the token names.
It cannot touch any other preference, cannot turn anything back **on**, and
cannot read anything about the account. The worst a stolen link can do is
stop reminders its holder was already going to receive anyway.

---

## 6. Push notifications — register this phone (2026-10-12)

The mobile app (Expo) registers its push token after sign-in so in-app
messages also arrive as phone notifications. Any signed-in account.

### `POST /notifications/devices`

**Request:**
```json
{ "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "android" }
```
`token` must look like an Expo token (`ExponentPushToken[…]` or
`ExpoPushToken[…]`, 20–256 characters); `platform` is `android` or `ios`.

**Response** — `204 No Content`. Idempotent: call it on every sign-in. A
token that last belonged to another account moves to this one, and a
switched-off token is switched back on.

### `DELETE /notifications/devices`

**Request:** `{ "token": "ExponentPushToken[…]" }`. **Response** — `204`.
Call it on sign-out. It switches the token off for this account only; an
unknown token is not an error.

### What gets pushed

- **Only in-app messages**, and only ones created while the device was
  registered: registering never replays the backlog.
- **The push never carries the message.** The lock screen shows a generic
  title ("Application update", "Interview update" or "BharatPath update")
  and "You have a new update. Open BharatPath to read it."; `data` carries
  `notificationId` so a tap can open it in the inbox.
- `push_enabled: false` in the preferences (§4), or a staff suppression on
  `PUSH` or `ALL`, stops it. Sent by beat every 30 seconds
  (`notifications.push_pending`), so allow that delay.

---

## Quick reference

| Question | Answer |
|---|---|
| Does this module ever send anything through these routes? | No — sending is entirely event-triggered internally; see §0. |
| Is any of this paywalled? | No, none of it — reading your own inbox and settings never requires an active subscription. |
| Can a client render a score from a notification? | Never — no schema field for one, and an import-linter contract forbids the module from even reaching `scoring`'s code. |
| What's the one message type nobody can opt out of? | The UPI pre-debit notice — legally mandatory, sent regardless of channel preference. |
