# Integration notes — for the four client teams

*Candidate mobile · Employer console · College console · Admin console*
Written at the end of the twenty-day backend sprint (2026-09-17).

This is the short document. It covers what every team needs regardless of
surface, what each team needs that the others do not, and — the part worth
reading before you estimate anything — **what is stubbed, so you do not build
against a behaviour that is not there yet**.

The full endpoint reference is [`APIs.md`](APIs.md), and the per-area guides
are in [`backend-guide/`](backend-guide/).

Generate your client from **`openapi.json`**, published as a CI artifact on
every build of `main` (job *publish openapi.json*). A **Postman collection** is
published beside it. Neither is committed to the repository, deliberately: a
checked-in copy is the one that goes stale, and a stale request 404s and looks
like a broken endpoint. Both are reproducible locally --
`python scripts/export_openapi.py && python scripts/export_postman.py`.

---

## 1. One API, four prefixes

There is one service. `/api/v1/candidate/*`, `/employer/*`, `/college/*` and
`/admin/*` are **namespacing for readability, not authorisation** — a
candidate calling an `/employer/*` route is refused by the role check, not by
the routing. Do not assume a prefix implies a permission.

Base URL is per environment; the version prefix `/api/v1` is part of it.

## 2. Authentication

This service **issues no tokens.** Cognito does, and there are two pools:

| Pool | Who | How they sign in |
|---|---|---|
| `CANDIDATE` | candidates, students | phone OTP, or email |
| `BUSINESS` | employer, college and platform staff | password, plus software-token MFA **if the user turned it on** (optional, off by default, 2026-10-07) |

Send the access token as `Authorization: Bearer <token>`. A token from the
wrong pool is rejected outright, never half-trusted.

**Role and tenant are resolved server-side on every request**, from our own
membership table, not from a token claim. Two consequences for you:

- A membership revoked while a token is still valid takes effect within about
  a minute. Handle a 403 appearing mid-session; it is not a bug.
- Nothing in a token tells you what the user may do. Ask the API.

**401 `account_inactive`** means the account is suspended or has been erased.
Sign the person out and clear stored credentials; retrying will not help.

Locally, `POST /auth/dev/token` mints a real token when
`AUTH_ALLOW_LOCAL_TOKENS=true`. The route does not exist in a deployed
environment — it is not a 403, it is absent.

## 3. Errors

Every deliberate error is `application/problem+json`:

```json
{
  "type": "https://bharatpath.example/problems/subscription_required",
  "title": "Subscription required",
  "status": 402,
  "code": "subscription_required",
  "instance": "/api/v1/candidate/score/me",
  "request_id": "…",
  "params": {"retry_after_seconds": 60}
}
```

**Branch on `code`, never on `title`.** `title` is English and will change;
`code` is the contract, and it is what you map to a localised string. `params`
holds substitution values for that string — never a pre-rendered sentence.

The codes worth handling everywhere:

| Status | Code | What the user should see |
|---|---|---|
| 401 | `account_inactive` | Signed out; the account is suspended or erased |
| 402 | `subscription_required` | The paywall. Offer the plan |
| 402 | `access_window_expired` | Employer only, on the reveal: the access period lapsed |
| 403 | `no_active_membership` / `tenant_suspended` | Talk to your organisation's owner / to us |
| 409 | `conflict` and the specific ones per area | Usually "you already did this" |
| 422 | validation | Field-level; the message is not for display |
| 429 | `rate_limited` | Back off by `Retry-After` |

**A missing row inside somebody else's tenant is 404, not 403** — deliberately,
because a 403 would confirm the row exists. Do not treat 404 as "bug".

## 4. Request correlation

Send `X-Request-ID` (any unique string) and it comes back on the response and
appears in our logs and in the error body. Put it in your bug reports; it is
the fastest way for us to find the request you mean.

## 5. Rate limits

429 with `Retry-After` in seconds. Two tiers: a generous global one (per IP,
per user, per tenant, per minute) that a person clicking will not reach, and
tight specific ones on OTP and the employer threshold preview.

**Back off by `Retry-After`.** The window counts refused requests too, so a
retry loop extends its own lockout. An organisation's staff share one tenant
budget — a background poller in one recruiter's tab spends everybody's.

## 6. Things that are asked for and will not be added

These are product and legal commitments, not gaps. If a design calls for one,
raise it before you build the screen.

- **The score is never explained.** No breakdown, no category, no "improve
  this" — to the candidate, in an export, or anywhere else. Employers see a
  **band**, never the number.
- **`min_score` is never returned to a candidate.** Beside their own score it
  is the gap, which is the explanation again. Use `eligibility`.
- **The score is never drawn as a red-to-green gauge, dial or speedometer.**
  That is the visual language of a credit bureau, and the product is not one.
  See [`design-system.md`](design-system.md) §1.
- **A masked candidate card structurally cannot hold a name, contact or
  score.** There is no flag that adds them; the reveal is a different
  endpoint, with an access window, caps and an audit row per open.
- **There is no bulk export of candidates.** Not a missing feature.
- **No age or date of birth exists anywhere.** Do not collect one.

## 7. Asynchronous work — what to poll, and for how long

Several things finish after the request that started them. All of them are
pollable, and none of them push yet.

| Started by | Poll | Terminal states |
|---|---|---|
| Resume upload | `GET /candidate/resume/files/{id}` → `parse_status` | `DONE`, `FAILED`, `BLOCKED` |
| Confirming a version | `GET /candidate/score/me` | a score, or still pending |
| Interview completion | the session's `state` | `EVALUATED`, `FAILED` |
| Data export | `GET /privacy/requests/{id}` → `download_available` | `COMPLETED`, `REJECTED` |

A score stays pending rather than showing a made-up number: there is
deliberately no fallback estimator, because a plausible wrong score is
unfixable once a candidate has seen it.

## 8. What is stubbed today — read before estimating

Everything here is built and tested; what is missing is an external
dependency or a schedule, and each is tracked in
[`blockers.md`](blockers.md).

| Area | What works | What does not, yet |
|---|---|---|
| **Payments** | Checkout, signed callbacks, entitlements, renewals | No real gateway. Locally, settle with `POST /billing/dev/payments/{id}/simulate` |
| **Background work** | Every task exists and is enqueued | No broker or scheduler is provisioned (**E4**), so sweeps — application expiry, subscription renewal, DSR erasure, nudges — do not run on their own yet |
| **SMS** | Templates, preferences, opt-outs, every decision recorded | No DLT template ids, so SMS is recorded as skipped and nothing is sent. In-app works |
| **Email** | The same | No provider configured by default |
| **Interview feedback** | Recording, storage, the report shape | No speech or evaluation model chosen: a completed session stays `COMPLETED` with its report pending |
| **Scoring** | The whole engine, replay, caps | No model wired by default; with none, a score stays pending rather than guessing |
| **Prices, courses, question banks, consent wording** | Placeholders that the build runs against | All ours, not the client's. Every one carries a flag a test asserts, so none can quietly become the product |

## 9. Per team

**Candidate mobile.** The confirm step is not a formality: a parsed CV is
shown for correction and **nothing is scored until the candidate confirms it**.
An edit creates a new version and never inherits confirmation, so the confirm
screen must appear again. Reading and withdrawing your own applications are
never paywalled; a lapsed subscriber loses access, not their data. The privacy
screens (§ APIs.md `/privacy`) are new this sprint — deletion has a
cooling-off period and can be withdrawn, and your UI should say so plainly.

**Employer console.** Payment gates jobs, the pipeline, search and the reveal;
organisation, team and KYB stay open so an unpaid employer can onboard. Search
returns **no total** and orders by band only. Opening a candidate is capped per
hour and per day across the organisation, and every open is audited — do not
prefetch cards, and do not open a profile to render a list row.

**College console.** A college never learns which of its students has an
account; there is no "matched" field and there will not be. Aggregates are
floored and suppressed (small cohorts return counts only), and a student's
name appears only where that student granted individual visibility, live, on
every request. Revoking is the student's act and immediate.

**Admin console.** Every cross-tenant read writes its audit row *first* and
then reads through a read-only connection; a failed audit reads nothing. A
drill-down shows a display value and a band, a masked phone, and counts —
never the stored score, a whole contact, or a CV.

## 10. Where to look next

| You want | Read |
|---|---|
| Every route | [`APIs.md`](APIs.md) |
| One area in depth | [`backend-guide/`](backend-guide/) |
| Running it locally | [`../backend/README.md`](../backend/README.md) |
| Deploying, CORS, environments | [`how-it-all-connects.md`](how-it-all-connects.md) |
| What is blocked and on whom | [`blockers.md`](blockers.md) |
| Why the rules are the rules | [`plan.md`](plan.md) §1 |
