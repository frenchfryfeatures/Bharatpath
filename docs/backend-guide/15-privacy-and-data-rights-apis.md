# 15 — Privacy: exporting and erasing your own data

Six endpoints, module `privacy`, prefix `/privacy`. **This entire module was
missing from the API checklist and from this series** until this pass — it
had been marked as having "no HTTP endpoints at all," which was true of
three other modules (`admin`, `notifications`, `privacy` were *all*
mis-marked that way) but not, in fact, of this one. It implements India's
DPDP Act data-subject rights: the right to a copy of your own data, and the
right to have it erased. Read [01-architecture.md](01-architecture.md)
first for the general shape; this doc stands on its own otherwise.

---

## 0. The big picture — a request, a wait, then either a file or a cascade

```
POST /privacy/requests/export           POST /privacy/requests/deletion
        │                                        │
        ▼                                        ▼
  202, state RECEIVED                    202, state RECEIVED
  a background job builds                a 24-hour cooling-off window starts —
  the archive                            the account stays fully usable
        │                                        │
        ▼                                POST .../withdraw (any time before
  state → COMPLETED,                     erasable_at) cancels it, no trace
  download_available: true                       │
        │                                (nothing withdrawn)
        ▼                                        ▼
GET .../download                        after erasable_at, the sweep runs
→ a short-lived, one-time-mint link     the erasure cascade — one transaction,
  to the archive                        one SECURITY DEFINER function,
                                         irreversible

Anytime: GET /privacy/requests (list), GET /privacy/requests/{id} (one)
```

**Never paywalled, and rate-limited tighter than almost anything else in the
product.** A lapsed subscriber can still ask for their own data or to have
it erased — access to the product and a legal right over your own data are
different things, and the same decision already made for reading and
withdrawing your own job applications ([06](06-applications-pipeline-apis.md))
applies here for the same reason: the law doesn't recognise "but they didn't
pay this month" as an answer to a data-rights request. Every write route
below shares one limiter, `privacy.request` — 60 calls per hour per user —
tighter than the platform's ordinary global ceiling, because an export is
the single most expensive *read* on the whole platform (it assembles a
person's entire record) and a deletion request is the most consequential
*write* (it's the one action in the entire system with no undo once its
grace period passes).

---

## 1. `POST /privacy/requests/export` — ask for a copy of your data

**Auth required:** any signed-in account — candidate, employer, college, or
staff. **Request:** no body.

**Response** — `202 Accepted` (`DsrRequestResponse`):
```json
{
  "id": "9f2e...",
  "type": "EXPORT",
  "state": "RECEIVED",
  "created_at": "2026-09-23T09:00:00Z",
  "due_at": "2026-10-23T09:00:00Z",
  "completed_at": null,
  "erasable_at": null,
  "download_available": false
}
```
`202`, not `201` — nothing is ready yet, this only records that the request
exists and queues the work that will build it. `due_at` is exactly 30 days
out — **the platform's own committed answer time, not a number the law
hands down** (the DPDP Act leaves the actual period to rules that, as of
this writing, haven't been notified — so this is a promise this product can
keep, surfaced to the requester specifically so it *is* one, not a
statutory quote).

**`409 dsr_request_already_open`** if this account already has an export
request that hasn't reached `COMPLETED` or `REJECTED` yet — **one open
export at a time**, so a second tap of the button doesn't queue a duplicate
build of the same archive.

---

## 2. `POST /privacy/requests/deletion` — ask for your account to be erased

**Auth required:** **candidates only.** **Request:** no body.

**Response** — `202 Accepted`, same `DsrRequestResponse` shape as export,
but with `erasable_at` filled in:
```json
{
  "id": "3a1c...",
  "type": "DELETE",
  "state": "RECEIVED",
  "created_at": "2026-09-23T09:00:00Z",
  "due_at": "2026-10-23T09:00:00Z",
  "completed_at": null,
  "erasable_at": "2026-09-24T09:00:00Z",
  "download_available": false
}
```
`erasable_at` is exactly **24 hours** after `created_at` — the earliest
instant anything is actually allowed to be destroyed. Before that moment,
this request can still be withdrawn (§4) and nothing about the account has
changed at all; **the account stays fully usable through the entire
window** — logging in, applying to jobs, everything — because locking it
during the cooling-off period would lock the person out of the one action
(withdrawing) the grace period exists to let them take.

**`403 dsr_deletion_requires_support`** for a business account (employer or
college). Erasing a whole organisation isn't a self-service button — it
goes through support, because it isn't only that account's data at stake.

**`409 dsr_request_already_open`** — same rule as export, one open
deletion request at a time.

---

## 3. `GET /privacy/requests` — your own requests, newest first

**Auth required:** any signed-in account. **Request:** no body.

**Response** — `200 OK` (`DsrRequestList`):
```json
{
  "items": [
    { "id": "9f2e...", "type": "EXPORT", "state": "COMPLETED", "created_at": "...", "due_at": "...", "completed_at": "...", "erasable_at": null, "download_available": true }
  ]
}
```
Everything this account has ever asked for, of either type — this is the
screen a "your data" settings page renders directly.

## 4. `GET /privacy/requests/{dsr_id}` — check one request

**Auth required:** any signed-in account, and only your own request — `404`,
never `403`, for someone else's id, so a request id existing at all is
never confirmed to a caller it doesn't belong to.

**Response** — `200 OK`, a single `DsrRequestResponse` (same shape as §1/§2).
Meant to be polled after creating a request until `state` reaches
`COMPLETED` (export) or the deletion actually runs.

## 5. `POST /privacy/requests/{dsr_id}/withdraw` — cancel a deletion before it runs

**Auth required:** the request's own owner.

**Request:** no body.

**Response** — `200 OK`, the updated `DsrRequestResponse`, `state` back to
one that isn't a deletion in progress.

**`409 dsr_request_not_withdrawable`** once the request is past the point
where withdrawing means anything — already `COMPLETED`, already
`REJECTED`, or (implicitly, by the time the sweep has already run past
`erasable_at`) too late. **This is the entire safety net for a candidate
who changed their mind** — call it any time before `erasable_at`, and
nothing about the account is ever touched. There's no equivalent "undo" once
the cascade has actually run, by design: an erasure with an undo isn't one.

## 6. `GET /privacy/requests/{dsr_id}/download` — a link to a finished export

**Auth required:** the request's own owner.

**Request:** no body.

**Response** — `200 OK` (`ExportDownloadResponse`):
```json
{ "url": "https://s3.../export-archive.zip?X-Amz-Signature=...", "expires_in_seconds": 600 }
```
**A brand-new, one-time link every time this is called, valid for exactly
10 minutes** — never a stored or reusable URL. That short a lifetime is
deliberate: this link is a bearer token for **an entire person's complete
personal record** in one file, so it's made worth as little as possible for
as short as possible; anyone who calls this route again gets a fresh link
rather than a cached one, and **each call is itself audited**, because
minting a way to read a whole record is worth a trail even when nothing was
actually downloaded yet.

**Errors:**
| Code | When |
|---|---|
| `409 dsr_export_not_ready` | The archive hasn't finished building yet — `download_available` on the request is still `false`. |
| `409 dsr_export_expired` | The archive itself has already been deleted from storage — see §7. |
| `404` | Not your request, or it isn't an `EXPORT` at all. |

---


**What the archive holds** (one JSON file per section): `account`,
`profile`, `resumes`, `scores` (the number, never how it was worked out),
`applications`, `subscriptions`, `purchases`, `interviews`,
`interview_questions` (the questions written for them — 2026-09-29),
`courses` (lessons watched — 2026-09-29), `messages` (what employers sent
them, never which recruiter — 2026-09-29), `questionnaire`, `streaks`,
`colleges`, `notifications`, `requests`. Erasure deletes the three new ones
too (`erase_candidate`, replaced in migration 0005).

## 7. What actually happens between "requested" and "ready" — and why nothing lingers

**The export archive is not kept indefinitely.** Once built, it sits in
storage for 48 hours and is then deleted by a sweep, whether or not it was
ever downloaded — leaving a complete copy of someone's personal data
sitting in a bucket earning nothing but risk, long after they asked for a
one-time copy, is exactly the kind of exposure this module exists to avoid
creating in the first place.

**The erasure cascade is one database transaction, not application code.**
`erase_candidate` runs as a single SECURITY DEFINER function — deliberately
not a series of Python deletes — because the app's own database role holds
no `DELETE` grant on `scores`, `course_completions`, `device_checks` or
`application_events`, and never will: half an erasure partway through isn't
a smaller erasure, it's a corrupt account. `docs/privacy` policy in the root
`CLAUDE.md` explains the table-by-table disposition (`ERASE` / `RETAIN` /
`NOT_PERSONAL` / `SELF_EXPIRING`) — retained rows (payments, audit trail)
survive under a legal carve-out, pointed at a `users` row that's been
**emptied, never deleted**, so a payment from a year ago still resolves to
*something*, just nothing that identifies the person anymore.

**Nothing in any response here ever explains a score.** An export carries
the score value itself but never its breakdown — the same "the score is
never explained" rule from [04-resume-and-scoring-apis.md](04-resume-and-scoring-apis.md)
applies to a data export exactly as it applies to the candidate's own
`GET /candidate/score/me`; a personal-data export is another door into the
same room, not an exception to the rule that guards it.

---

## Quick reference

| Question | Answer |
|---|---|
| Can an employer or college request deletion here? | No — `403 dsr_deletion_requires_support`; that goes through support, not self-service. |
| Does a lapsed subscription block any of this? | Never — these rights aren't paywalled. |
| Can a deletion be undone after the cooling-off window? | No — that's the entire point of the window existing beforehand. |
| How long does a download link last? | 10 minutes, freshly minted every call, and audited every call. |
| How long does the archive itself exist? | 48 hours after it's built, then a sweep deletes it regardless of download status. |
