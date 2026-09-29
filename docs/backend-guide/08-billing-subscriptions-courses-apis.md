# 08 — Payments, Subscriptions & Courses: input/output reference

Three modules, one underlying idea: **nothing is ever granted by an API
response.** A checkout call only ever returns "here's where to pay" — the
actual subscription, course access, or interview session only becomes real
later, when a signed callback from the payment gateway is processed. This
doc covers `billing` (3 endpoints), `subscriptions` (6 endpoints × 3
audiences = 18), and `courses` (2 endpoints) — 23 endpoints in total.

---

## 0. The big picture — checkout, callback, settle: three separate moments

```
1. CANDIDATE/EMPLOYER/COLLEGE calls a checkout endpoint
   (POST .../subscription/checkout, or POST /candidate/courses/{id}/checkout)
        │
        ▼
   A `payments` row is created, state PENDING.
   Response: a `redirect_url` — where to send the payer to actually pay.
        │
        ▼
2. App sends the user to `redirect_url`. They pay on the gateway's own page.
   Our backend is NOT involved in this step at all.
        │
        ▼
3. THE GATEWAY calls US, server-to-server, independently of the user's browser:
        POST /billing/callbacks/{provider}
        (signed, no user token — a payment gateway cannot hold one)
        │
        ▼
   Verified and stored immediately. An event fires; a background worker
   actually settles it — moves `payments.status` to SUCCEEDED, and THAT is
   what grants the subscription / course / session.
        │
        ▼
4. App polls: GET /billing/payments/{payment_id}
   until status is no longer PENDING.
```

**Why a redirect back to your app after payment proves nothing, and why you
must poll instead:** a gateway's redirect is just the browser bouncing back
— it can be spoofed, skipped, or lost (the user closes the tab). The only
thing that's actually trustworthy is the gateway's own signed server-to-
server callback. So the UI pattern every checkout in this product follows
is the same: **checkout → redirect to pay → poll `GET
/billing/payments/{payment_id}` → show success once `status: SUCCEEDED`.**

### Why the callback route has no auth, and why that's not a hole

`POST /billing/callbacks/{provider}` is genuinely public — no
`Authorization` header at all. That's correct, not an oversight: a payment
gateway's server can't hold one of *our* user tokens. Instead, it signs the
raw request body with an HMAC secret only it and we share
(`X-Payment-Signature` header), and **that signature is checked before a
single byte of the body is parsed or written anywhere** — a forged callback
costs us one failed HMAC check and leaves no trace in the database at all.

### `PAYMENTS_PROVIDER` — how this works without a real gateway in dev/test

In local dev and CI, `PAYMENTS_PROVIDER=stub`. The default,
`PAYMENTS_PROVIDER=none`, makes every checkout endpoint answer `503` — no
gateway configured, nothing to redirect to. `Settings` **refuses to boot
with the stub provider in staging or production** — the same shape of
safety rail as `AUTH_ALLOW_LOCAL_TOKENS`. With the stub active, one extra
endpoint exists (§4) to simulate a gateway's callback without needing a real
one.

---

## 1. `GET /billing/payments/{payment_id}` — check a payment's status

**Auth required:** any valid token (candidate or business) — but only for
**your own** payment. `404` for someone else's, never `403`.

**Request:** no body, `payment_id` in the path.

**Response** — `200 OK` (`PaymentResponse`):
```json
{
  "id": "9f2e...",
  "status": "PENDING",
  "purpose": "SUBSCRIPTION",
  "item_code": "EMPLOYER_QUARTERLY",
  "amount_minor": 999900,
  "list_amount_minor": null,
  "currency": "INR",
  "failure_code": null,
  "created_at": "2026-09-17T10:00:00Z",
  "settled_at": null
}
```
`list_amount_minor` is the price **before** a discount code was applied —
`null` whenever this checkout didn't use one, in which case it equals
`amount_minor` anyway. `status` is one of `PENDING` / `SUCCEEDED` /
`FAILED` / `REFUNDED`. **This is
the endpoint every checkout flow polls** — there's no webhook or push to the
frontend, so the app is expected to call this every couple of seconds after
redirecting the user to pay, until `status` moves off `PENDING`.

---

## 2. `POST /billing/callbacks/{provider}` — the gateway tells us what happened

**Auth required: none.** Public route, by design (see §0). Instead of a
bearer token, it requires:
```
X-Payment-Signature: <HMAC-SHA256 of the raw body>
```

**Request body:** whatever shape the specific gateway (`{provider}` in the
path) sends — this route reads it as raw bytes first, verifies the
signature against those exact bytes, and only *then* parses it as JSON.

**Response** — `200 OK` (`CallbackAck`):
```json
{ "received": true, "duplicate": false }
```
`duplicate: true` when this exact event was already received before — the
gateway is told `200` either way (a `retry me` response would just make it
send the same callback again forever), but nothing changes on a repeat.

**What actually happens in this call: verify, store, and enqueue —
nothing more.** No entitlement is granted here. The route:
1. Verifies the signature.
2. Parses and validates the payload shape.
3. Stores the raw callback (kept as evidence — a later payment dispute is
   answered from exactly what the gateway sent, not from our interpretation
   of it).
4. Fires an internal event (`billing.callback_received`).

**Errors:**
| Code | When |
|---|---|
| `401` | Signature missing or doesn't match |
| `404` | `{provider}` isn't the one this deployment is configured for |
| `422` | Body doesn't parse into a recognisable callback shape |
| `413` | Body too large |

### What happens after this call returns — a background worker settles it

The `billing.callback_received` event routes (via `app/tasks/routing.py`,
the same routing table from the resume-confirm doc) to a background task
that actually applies the outcome: moves the `payments` row to `SUCCEEDED`
or `FAILED`, and **only on success**, grants whatever was bought — activates
the subscription period, marks the course purchased, etc. This is why the
route itself is described as granting nothing: by the time this HTTP
response has been sent, the actual grant hasn't happened yet — it happens
moments later, off the request entirely.

---

## 3. `POST /billing/dev/payments/{payment_id}/simulate` — dev/test only

**This route doesn't exist unless `PAYMENTS_PROVIDER=stub`** — same
"genuinely absent, not just refused" pattern as `/auth/dev/token`.

**Auth required:** the payment's own owner.

**Request body** (`SimulatePaymentRequest`):
```json
{ "outcome": "SUCCEEDED" }
```
or
```json
{ "outcome": "FAILED", "failure_code": "insufficient_funds" }
```

**Response** — `200 OK`, the updated `PaymentResponse`:
```json
{
  "id": "9f2e...",
  "status": "SUCCEEDED",
  "purpose": "SUBSCRIPTION",
  "item_code": "EMPLOYER_QUARTERLY",
  "amount_minor": 999900,
  "list_amount_minor": null,
  "currency": "INR",
  "failure_code": null,
  "created_at": "2026-09-17T10:00:00Z",
  "settled_at": "2026-09-17T10:02:00Z"
}
```
(`status: "FAILED"` and `failure_code` set, `settled_at: null`, if you sent
`"outcome": "FAILED"`.)

**What it does under the hood:** signs a callback exactly the way the real
stub gateway would, and runs it through the **exact same** verify → store →
settle path as §2 — this isn't a shortcut that skips logic, it's a way to
drive the real logic without a real gateway sitting in AWS somewhere.

---

## 4. Subscriptions — the same 6 endpoints, mounted three times

**Why one set of code serves three different URL prefixes:** a subscription
always belongs to *somebody* — a candidate's own, or an organisation's — so
these routes are mounted under `/candidate/subscription`,
`/employer/subscription`, and `/college/subscription`, built from one
shared implementation with per-audience role guards. **Reading is
open to more roles than buying is:**

| Audience | Who can **read** (`GET`) | Who can **buy/cancel/set-up-renewal** |
|---|---|---|
| Candidate | `CANDIDATE` | `CANDIDATE` (same person — no "org" above them) |
| Employer | Owner, Recruiter, Viewer | **Owner only** |
| College | Admin, Staff | **Admin only** |

The reasoning stated in the code: an organisation's money is its owner's to
spend, not its staff's — a recruiter can *see* what plan the company is on,
but can't buy or cancel it.

### `GET /{candidate,employer,college}/subscription/plans` — what's for sale

**Auth required:** the "read" role for that audience, from the table above
(any employer/college role reads; a candidate reads their own).

**Request:** no body.

**Response** — `200 OK`, array of `PlanResponse`:
```json
[{ "code": "EMPLOYER_QUARTERLY", "audience": "EMPLOYER", "period": "QUARTERLY", "months": 3, "price_minor": 999900, "currency": "INR", "seat_allowance": null }]
```
Only plans matching *this* audience — a candidate never sees employer
plans and vice versa. `seat_allowance` is only meaningful for `COLLEGE`
plans (how many student seats it buys).

### `GET /{candidate,employer,college}/subscription` — the current state

**Auth required:** the "read" role for that audience (same as `/plans`).

**Request:** no body.

**Response** — `200 OK` (`SubscriptionResponse`):
```json
{
  "state": "ACTIVE",
  "has_access": true,
  "plan_code": "EMPLOYER_QUARTERLY",
  "period": "QUARTERLY",
  "current_period_start": "2026-09-01T00:00:00Z",
  "current_period_end": "2026-12-01T00:00:00Z",
  "cancel_at": null,
  "renews_automatically": true,
  "mandate_state": "ACTIVE"
}
```
`state` is one of `NONE` / `PENDING` / `ACTIVE` / `GRACE` / `LAPSED` /
`CANCELLED`. **`has_access` is the field that actually matters for gating
everything else** — `GRACE` (an auto-renewal payment is being retried) still
has `has_access: true` right up to `current_period_end`, so a momentary
retry doesn't lock anyone out mid-grace.

### `POST /{...}/subscription/checkout/discount-preview` — price a plan with a code, without buying

**Auth required:** the "buy" role for that audience (same as checkout —
previewing a price is gated exactly like spending money, not like reading
one).

**Request body** (`DiscountPreviewRequest`):
```json
{ "plan_code": "CANDIDATE_MONTHLY", "discount_code": "launch50" }
```
Both fields required — unlike checkout, a code isn't optional here; this
endpoint exists specifically to answer "what would this code do."

**Response** — `200 OK` (`DiscountPreviewResponse`):
```json
{ "list_amount_minor": 14900, "discount_minor": 2980, "amount_minor": 11920 }
```
**Writes nothing at all** — no payment row, no reservation, nothing that
could be left dangling. It's refused with the **exact same** `422` codes
checkout itself would raise for a bad code (below), sharing the same
per-person rate limit as checkout (40 attempts an hour) so it can't be used
to brute-force-guess a valid code either. **The code can still fail at
actual checkout even after a successful preview** — nothing here holds or
reserves anything, so a code that had one use left when previewed can be
gone by the time checkout actually runs.

### `POST /{...}/subscription/checkout` — buy a period

**Auth required:** the "buy" role for that audience (Owner / College Admin
/ the candidate themselves — **not** a Recruiter, Viewer, or College Staff).

**Request body** (`SubscriptionCheckoutRequest`):
```json
{ "plan_code": "EMPLOYER_QUARTERLY", "discount_code": "launch50" }
```
`discount_code` is optional and case-insensitive; omit it entirely for a
full-price checkout.

**Response** — `201 Created` (`CheckoutResponse`):
```json
{ "payment_id": "9f2e...", "status": "PENDING", "amount_minor": 11920, "list_amount_minor": 14900, "currency": "INR", "redirect_url": "https://gateway.example.com/pay/..." }
```
With a `discount_code`, `amount_minor` is already the **discounted**
figure and `list_amount_minor` is what it would have been without the
code — without one, `list_amount_minor` is `null`. **Nothing is granted
here** — see §0; and the code itself only counts as used once this payment
actually succeeds (a redemption row is written beside the grant, in the
same step, never at checkout time — see
[13-admin-console-and-disputes-apis.md §8](13-admin-console-and-disputes-apis.md#8-discount-codes--admindiscount-codes)
for where codes are created and disabled). Calling checkout twice for the
same plan/price within a short reuse window returns the **same** pending
payment rather than opening a second one (so a user who double-clicks
"pay" doesn't end up with two competing checkouts for the same thing).

**Errors:**
| Code | When |
|---|---|
| `403` | Caller has the read role but not the buy role for this audience |
| `404 plan_not_found` | `plan_code` doesn't exist, or isn't sold to this audience |
| `422 discount_code_invalid` | The code doesn't exist, doesn't parse, is `DISABLED`/`SCHEDULED`, or isn't sold to this audience |
| `422 discount_code_expired` | Past `valid_until` |
| `422 discount_code_exhausted` | `usage_limit` already reached — counting both actual redemptions and other fresh checkouts currently holding a use, so the last use can't be sold twice |
| `422 discount_code_already_used` | This subscriber (this candidate, or this employer's/college's organisation) has already redeemed this code once — one use per subscriber |
| `422 discount_exceeds_price` | The code would take the price to zero or below |

### `POST /{...}/subscription/cancel` — stop auto-renewing

**Auth required:** the "buy" role for that audience (same as checkout).

**Request:** no body.

**Response** — `200 OK`, updated `SubscriptionResponse`, now with
`cancel_at` set. **Access continues to the end of what was already paid
for** — cancelling doesn't cut anyone off mid-period, it just stops the
*next* renewal from happening. Idempotent — cancelling an already-cancelled
subscription just returns the same state.

**Errors:**
| Code | When |
|---|---|
| `409 subscription_not_active` | There's no live subscription to cancel at all (e.g. `state: "NONE"` or already `LAPSED`) |

### `POST /{...}/subscription/mandate` — set up automatic renewal (UPI AutoPay)

**Auth required:** the "buy" role for that audience (same as checkout/cancel).

**Request:** no body.

**Response** — `201 Created` (`MandateResponse`):
```json
{ "state": "PENDING", "max_amount_minor": 999900, "valid_until": "2027-09-01T00:00:00Z", "authorisation_url": "https://gateway.example.com/mandate/..." }
```
`state` stays `PENDING` (renewal stays **manual**) until the payer actually
approves the mandate in their own UPI app at `authorisation_url` — this
endpoint only starts that process, it doesn't complete it. A separate
gateway callback (`MANDATE_ACTIVATED`, handled the same way as a payment
callback) is what flips it to `ACTIVE`. `max_amount_minor` is **fixed at
registration to the plan's current price** — if the plan's price rises
later, the mandate is never silently allowed to debit more than the payer
originally authorised; the subscriber falls back to manual renewal instead.

**Errors:**
| Code | When |
|---|---|
| `409 subscription_not_active` | No live subscription to attach a mandate to, or its period has already ended |
| `409 subscription_cancelling` | Subscription is already set to cancel — no point auto-renewing something ending on purpose |
| `409 mandate_exists` | An open mandate already exists for this subscription |
| `422 mandate_amount_over_limit` | The plan's price exceeds the configured per-mandate ceiling |

---

## 5. `GET /candidate/courses` — the catalogue

**Auth required:** `CANDIDATE` role + active subscription (a course is
itself a tool that's gated behind having already subscribed).

**Request:** no body.

**Response** — `200 OK`, array of `CourseResponse`:
```json
[{ "id": "...", "code": "COURSE_RESUME_FOUNDATION", "title": "Presenting Your Work",
   "price_minor": 49900, "currency": "INR", "purchased": false, "completed": false,
   "locked": true, "lessons_total": 6, "lessons_completed": 0, "percent_complete": 0 }]
```
`purchased`, `completed`, `locked` and the progress fields are **per this
specific candidate** — the same list endpoint doubles as "what's on sale" and
"what have I already bought, and how far am I". Ownership goes by course
*code*: a candidate who bought at an old price keeps the course when staff
reprice it (which makes a new version row).

**A course appears here only once staff have published it** with at least
one playable lesson (§7). An empty course is never sold.

## 5a. `GET /candidate/courses/{course_id}` — the syllabus, locked until bought

**Auth required:** `CANDIDATE` + active subscription. **Request:** no body.

**Response** — `200 OK` (`CourseDetailResponse`): everything in §5, plus the
modules and their lessons:
```json
{ "id": "...", "code": "COURSE_RESUME_FOUNDATION", "locked": false, "percent_complete": 50,
  "modules": [
    { "id": "...", "title": "Writing Practice", "lessons": [
      { "id": "...", "title": "Writing an Email", "description": null, "duration_seconds": 600,
        "media_kind": "YOUTUBE",
        "media_url": "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        "position_seconds": 240, "completed": false },
      { "id": "...", "title": "Short Story Writing", "duration_seconds": 1980,
        "media_kind": "UPLOAD",
        "media_url": "https://…/course-media/…?X-Amz-Signature=…",
        "position_seconds": 0, "completed": false }
    ] }
  ] }
```
- **While `locked` is true every `media_url` is `null`.** The titles and
  lengths show so the student can see what they would get (the locked tab);
  nothing is playable.
- `YOUTUBE` → put `media_url` in an `<iframe>` (the no-cookie embed).
  `UPLOAD` → a presigned GET for a `<video>` element, valid for four hours;
  fetch the course again for fresh links.
- `position_seconds` is where to resume.
- **An unlisted YouTube video is not behind the paywall** — anyone with the
  link can watch it. Uploaded videos are. The client chose to allow both.

## 5b. `POST /candidate/courses/{course_id}/lessons/{lesson_id}/progress` — report watching

**Auth required:** `CANDIDATE` + active subscription.

**Request body:**
```json
{ "position_seconds": 540 }
```
Send it every ~15 seconds while the video plays, and on pause and close.

**Response** — `200 OK`:
```json
{ "lesson_id": "...", "position_seconds": 540, "completed": true,
  "lessons_total": 6, "lessons_completed": 6, "percent_complete": 100,
  "course_completed": true }
```
**The server decides "watched", not the app.** A lesson counts once the
student has reached 90% of it **and** at least half its length has actually
passed since they first opened it — dragging the slider to the end does not
count. `completed` is a latch. When the last published lesson is watched the
server records the course completion (+30 toward the score) **as the system**
(§6's "why there's no completion endpoint" still holds: nobody posts a
completion). `409 course_not_purchased` for a course not bought.

## 6. `POST /candidate/courses/{course_id}/checkout` — buy one

**Auth required:** `CANDIDATE` + active subscription.

**Request:** no body, `course_id` in the path.

**Response** — `201 Created` (`CheckoutResponse`), identical shape to the
subscription checkout in §4. Same rule: **nothing is granted by this call**
— `purchased` only becomes `true` once the gateway callback settles.

**Errors:**
| Code | When |
|---|---|
| `404 course_not_found` | Bad `course_id` |
| `409 course_already_purchased` | Already owns this course — nothing to buy again |

### Why there's no "mark this course completed" endpoint

Worth calling out because its absence is deliberate, not a gap: a course
completion is written **only** by `courses.service.record_completion`,
callable only as `SYSTEM` or `PLATFORM_ADMIN` — never through any HTTP
route a candidate or even an employer could reach. Since 2026-09-29 the
system calls it from §5b, when the rule (`lessons-watched-1-2026-09-29`:
every published lesson watched) is met by what the server itself measured. If a candidate could
call an endpoint to mark their own course "done," the +30 points it awards
toward the score would be self-certified — exactly the kind of thing the
whole scoring design (Layer 1 model / Layer 2-3 code split, from
[04](04-resume-and-scoring-apis.md)) exists to prevent happening anywhere
in the system.

## 7. Building the course — the admin console

Staff (PLATFORM_ADMIN only) build courses; the routes live under `/admin`
and are listed with the console in [13](13-admin-console-and-disputes-apis.md).
The order of operations:

1. `POST /admin/courses/{code}/modules` `{ "title": "Writing Practice" }`
2. `POST /admin/course-modules/{module_id}/lessons` with either
   - `{ "title", "duration_seconds", "youtube_url": "https://youtu.be/…" }` —
     playable at once (YouTube hosts only; anything else is `422`), or
   - `{ "title", "duration_seconds" }` then
     `POST /admin/course-lessons/{id}/upload` → PUT the MP4/WebM to the URL →
     `POST /admin/course-lessons/{id}/upload/confirm` (the server checks the
     bytes really are a video, and deletes them if not).
3. `PUT /admin/courses/{code}/published` `{ "published": true }` — refused
   (`409 course_not_publishable`) until at least one lesson can play.

Staff give each lesson's duration because a YouTube embed tells the server
nothing, and the "watched" rule in §5b is measured against it. Modules and
lessons are switched off, never deleted; every change is audited.

---

## Quick reference: who's a "buyer" vs a "reader"

| | Candidate | Employer | College |
|---|---|---|---|
| Read subscription / plans | `CANDIDATE` | Owner, Recruiter, Viewer | Admin, Staff |
| Buy / cancel / mandate | `CANDIDATE` | **Owner only** | **Admin only** |
| Courses | `CANDIDATE` only (no employer/college equivalent) | — | — |
