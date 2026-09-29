# 13 — The admin console and disputes: 30 endpoints, entirely missing from this series until now

Module `admin`, two surfaces: **`/admin/*`** (28 routes — our own staff
only) and **`/disputes`** (2 routes — where a candidate, employer or
college raises one). **This entire module was recorded in the API
checklist as having "no HTTP endpoints at all"** — true of `integrity`,
false of this one, and it's the single biggest gap this pass of the
backend-guide series found. Day 19 in the root `CLAUDE.md` describes why
this exists: KYB review, integrity review, tenant suspension, seat
allocation, cross-module drill-downs, disputes, audit search, staff-made
accounts, and discount codes, all in one console because they're all the
same shape of problem — *someone on our side needs to see across tenant
boundaries that RLS otherwise enforces absolutely.*

Read [01-architecture.md §5](01-architecture.md#5-tenant-isolation-keeping-companies-data-apart)
first — this entire doc is about the one deliberate, audited hole punched
through that isolation.

---

## 0. The big picture — one permission table, one bypass session, one audit row per look

**Staff are members of exactly one tenant: `PLATFORM`.** There is no
self-registration for any of it — `scripts/create_platform_staff.py`, or a
console route under §7 below, is how a staff account comes to exist.
Four roles: `PLATFORM_ADMIN` (everything), `KYB_REVIEWER`,
`INTEGRITY_REVIEWER`, `SUPPORT_AGENT` — each holding only the capabilities
`CONSOLE_ROLES` actually grants them:

| Capability | Who holds it |
|---|---|
| `kyb` | Admin, KYB Reviewer |
| `integrity` | Admin, Integrity Reviewer |
| `tenants` (read) | Admin, KYB Reviewer, Support Agent |
| `suspend`, `seats`, `audit_search`, `accounts`, `discounts` | **Admin only** |
| `candidate_drilldown` (the candidate list and the drill-down) | Admin, Support Agent, Integrity Reviewer |
| `employer_drilldown` | Admin, Support Agent, KYB Reviewer |
| `college_drilldown`, `disputes`, `suppress_notifications`, `resend_invitation`, `discounts_read` | Admin, Support Agent |
| `dashboard` | **Every** staff role (sections inside are gated by the rows above — §0.5) |

**Every single route names its capability from this one table** — nowhere
in the router are roles listed by hand per-route, so "can a Support Agent
suspend an employer?" has exactly one place to answer it (no — only
`suspend`, held by `PLATFORM_ADMIN` alone), and an invariant test
(`tests/invariants/test_admin_console.py`) drives every route with every
role and every outsider to hold that table to the router.

**No payment gate anywhere in this doc.** Every other paid surface in this
product checks `require_active_subscription`; the console never does — it's
ours, and a dispute about a payment must not itself require one.

**Every cross-tenant read goes through the same two-step pattern:** an
audit row is written on the caller's own session first (so the *attempt* to
look is recorded even if the lookup that follows somehow fails), then the
actual read runs on a separate, read-only bypass database session
(`DATABASE_ADMIN_URL`, `SET TRANSACTION READ ONLY`) that RLS doesn't apply
to — because RLS on our staff's own connection would (correctly) show them
nothing, and there's no tenant to `SET LOCAL app.tenant_id` to when the
whole point is reading across all of them. **A drill-down or an opened
record never shows the stored raw score, a whole phone number/email, or a
CV** — only `display_value`/`band` (the same number the person themself
sees), `phone_masked`/`email_masked`, and resume *counts*, never content.

---

## 0.5 `GET /admin/dashboard` — the landing page, one request

**Auth required:** any staff role (`dashboard` capability). **Audited:** one
`admin_bypass_session_opened` row per load (`target_type: "admin_dashboard"`)
— fewer than building the page from the queue endpoints, which write one
each.

**A queue section is `null` for a role that can't open that queue.** The
page shows each person what their other capabilities already let them work:

| Section | Shown to |
|---|---|
| `kyb` | Admin, KYB Reviewer |
| `integrity` | Admin, Integrity Reviewer |
| `disputes` | Admin, Support Agent |
| `organisations` | Admin, KYB Reviewer, Support Agent (the `tenants` capability) |
| `platform_totals`, `oldest_waiting`, `throughput` | Everyone — but the last two are drawn only from the queues that caller sees |

**Response** — `200 OK`, `AdminDashboard`:
```json
{
  "generated_at": "2026-09-23T10:15:00Z",
  "kyb": { "review_required": false, "awaiting_review": 0, "awaiting_employer": 1,
           "oldest_waiting_since": null },
  "integrity": { "open": 7, "open_by_severity": { "HIGH": 2, "MEDIUM": 3, "LOW": 2 },
                 "candidates_held_back": 2, "oldest_waiting_since": "2026-09-19T06:10:00Z" },
  "disputes": { "open": 3, "in_review": 1, "unassigned": 2,
                "by_kind": { "HIRE": 1, "PAYMENT": 2, "ACCOUNT": 1, "OTHER": 0 },
                "oldest_waiting_since": "2026-09-20T11:00:00Z" },
  "organisations": { "employers": { "active": 42, "suspended": 1, "closed": 0 },
                     "colleges":  { "active": 6,  "suspended": 0, "closed": 0 } },
  "platform_totals": { "candidates": 1840, "employers": 42, "colleges": 6,
                       "jobs_published": 95, "applications": 3120, "hires": 58 },
  "oldest_waiting": [
    { "type": "INTEGRITY", "id": "...", "waiting_since": "2026-09-19T06:10:00Z",
      "detail": "INJECTED_INSTRUCTIONS", "candidate_id": "9f2e...", "severity": "HIGH",
      "organisation": null, "tenant_id": null, "party": null },
    { "type": "DISPUTE", "id": "...", "waiting_since": "2026-09-20T11:00:00Z",
      "detail": "PAYMENT", "party": "EMPLOYER", "organisation": "Acme Pvt Ltd",
      "tenant_id": "...", "candidate_id": null, "severity": null }
  ],
  "throughput": [ { "date": "2026-09-10", "intake": 2, "cleared": 1 }, "... 14 entries ..." ]
}
```

| Field | Meaning |
|---|---|
| `kyb.awaiting_review` | `SUBMITTED` or `UNDER_REVIEW` — waiting on a reviewer. Always 0 while `review_required` is false (R15: every submission is approved on arrival) |
| `kyb.awaiting_employer` | `MORE_INFO_REQUIRED` — waiting on the employer, not us |
| `integrity.candidates_held_back` | People with an **OPEN HIGH** signal. They are already out of employer search, before anyone has looked — the most urgent number on the page |
| `disputes.unassigned` | Open or in review, nobody assigned |
| `organisations` / `platform_totals.employers` | "Active employers" is `organisations.employers.active` (or `platform_totals.employers`, which every role sees) |
| `platform_totals.candidates` | Active candidate accounts. `hires` counts only hires confirmed by both sides |
| `oldest_waiting` | Up to 5, oldest first, from the KYB, integrity and dispute queues the caller sees. `detail` is the KYB state, the integrity rule, or the dispute kind. **Ids, never a person's name**; open the item for the rest |
| `throughput` | 14 **IST** days ending today (today is partial), zeros included. `intake` = items that entered those queues that day; `cleared` = items decided. Auto-approved KYB is neither |

Everything is read live on each request, never cached: a reviewer who has just
cleared an item should see it gone.

---

## 1. KYB review — `GET/POST /admin/kyb/*`

**Auth:** `kyb` capability (Admin or KYB Reviewer).

### `GET /admin/kyb/submissions` — every submission, newest first

**Request:** `?state=`, `cursor`, `limit` (max 100), all optional.

**Response** — `200 OK` (`KybSubmissionsPage`):
```json
{
  "items": [
    { "id": "...", "tenant_id": "...", "organisation": "Acme Pvt Ltd", "state": "APPROVED", "form_version": "kyb-v3", "submitted_at": "...", "reviewed_at": "...", "auto_approved": true, "created_at": "..." }
  ],
  "next_cursor": null,
  "review_required": false
}
```
`review_required` mirrors the live `kyb.require_approval` config row
(see [07-kyb-apis.md](07-kyb-apis.md)). **While it's `false`, this whole list is a historical
record, not a queue** — every submission arriving was approved on the spot
(R15), and `auto_approved: true` says exactly that on each row.

### `GET /admin/kyb/submissions/{id}` — one, with its answers and documents (audited)

**Response** — `200 OK`, `KybSubmissionResponse` — the same shape
[07-kyb-apis.md](07-kyb-apis.md)'s own `GET /employer/kyb` uses for the
organisation itself (full form answers and document metadata). `404
kyb_submission_not_found` outside this id.

### `POST /admin/kyb/submissions/{id}/decision` — record a decision

**Request body** (`KybDecisionRequest`):
```json
{ "decision": "REJECTED", "reason": "GST certificate does not match the legal name given." }
```
`decision` is one of `UNDER_REVIEW` / `APPROVED` / `REJECTED` /
`MORE_INFO_REQUIRED`. `reason` is what the organisation reads back on its
own `GET /employer/kyb` — required in practice for anything but a plain
approval, since "rejected, no reason given" tells an employer nothing to
act on.

**Response** — `200 OK`, the updated `KybSubmissionResponse`. Only a
submission actually awaiting review can be decided — this is the human
half of invariant 8, the machine half being the database trigger on
`employers.kyb_status` covered in [07-kyb-apis.md](07-kyb-apis.md).

---

## 2. Integrity review — `GET/POST /admin/integrity/*`

**Auth:** `integrity` capability (Admin or Integrity Reviewer).

### `GET /admin/integrity/signals` — the review queue, oldest first

**Request:** `?state=OPEN` (default; also `CLEARED`/`CONFIRMED`),
`?severity=HIGH` (optional filter), `cursor`, `limit`.

**Response** — `200 OK` (`IntegritySignalsPage`):
```json
{ "items": [{ "id": "...", "candidate_id": "...", "resume_version_id": "...", "rule_id": "hidden_text", "rule_version": "1", "severity": "HIGH", "state": "OPEN", "created_at": "...", "resolved_at": null }], "next_cursor": null }
```
**Oldest first, not newest** — the opposite ordering from every other
queue in this doc, because a HIGH signal removes a candidate from employer
search the instant it's raised (see the root `CLAUDE.md`'s note on
severity design); the queue is meant to be worked down front-to-back so the
oldest suppression is the first one resolved.

### `GET /admin/integrity/signals/{id}` — one signal with its evidence (audited)

**Response** — `200 OK` (`IntegritySignalDetail` — everything the row above
has, plus `thresholds_version`, `evidence` (what the rule actually saw —
**can quote the CV**, which is exactly why opening one is audited and the
list above never carries it), `resolved_by`, `resolution_note`).

### `POST /admin/integrity/signals/{id}/resolve` — clear or confirm

**Request body** (`ResolveSignalRequest`):
```json
{ "outcome": "CLEARED", "note": "Hidden text was leftover template formatting, not an injection attempt." }
```
**Response** — `200 OK`, the updated `IntegritySignalDetail`.
`CLEARED` returns a HIGH-flagged candidate to employer search;
`CONFIRMED` keeps them suppressed. **Neither one ever moves a score** —
SRS 1.4.5, and this is the human decision the whole
`integrity`-never-imports-`scoring` boundary exists to make safe. A
decision here is final — there's no re-open.

---

## 3. Tenants, suspension, seats — `/admin/tenants/*`, `/admin/colleges/{id}/seats`

### `GET /admin/tenants` — employers and colleges by name

**Auth:** `tenants` capability. **Request:** `?type=EMPLOYER|COLLEGE`,
`?status=ACTIVE|SUSPENDED|CLOSED`, `?q=` (name search), `cursor`, `limit`.

**Response** — `200 OK` (`TenantsPage`):
```json
{ "items": [{ "id": "...", "type": "EMPLOYER", "name": "Acme Pvt Ltd", "status": "ACTIVE", "created_at": "..." }], "next_cursor": null }
```

**There is no `?type=CANDIDATE`, and it answers `422`.** A candidate is not
a tenant: they hold no membership and belong to no organisation, so there
is no `tenants` row to list (`identity.domain.TENANT_TYPES` is `EMPLOYER`,
`COLLEGE`, `PLATFORM`, and `PLATFORM` is never listed). Candidates are
listed by [`GET /admin/candidates`](#get-admincandidates--find-a-candidate-audited),
which is audited where this list is not, because every row names a person.

### `POST /admin/tenants/{id}/suspend` — stop an organisation operating, immediately

**Auth:** `suspend` (Admin only).

**Request body** (`SuspendTenantRequest`):
```json
{ "reason": "Repeated KYB documents flagged as forged." }
```
`reason` (3–500 chars) is kept on the suspension row for whoever lifts it
later — **never** copied into the audit trail or an event, because it's
free text naming a specific organisation and its problem.

**Response** — `201 Created` (`SuspensionResponse`):
```json
{ "id": "...", "tenant_id": "...", "reason": "...", "suspended_by": "...", "suspended_at": "...", "lifted_by": null, "lifted_at": null }
```
**`409 identity_tenant_already_suspended`** if it's already suspended —
this row and `tenants.status` are kept in lockstep by a database trigger
(`guard_tenant_suspension_write`) specifically so nobody can set `status`
by hand and drift the two apart; the trigger refuses a suspend-on-suspend
the same way it would refuse a hand-edited status.

**What actually happens:** every member of that organisation is refused on
their **very next request** — despite the 60-second membership cache from
[01-architecture.md §4](01-architecture.md#4-authentication-who-is-this-and-what-can-they-do),
because suspension flags the tenant (`membership.mark_tenant_changed`) so
cached rows are distrusted immediately rather than merely expiring. The
organisation's jobs come off the candidate board and its applications stop
accepting new candidates. **Nothing is deleted.** The one tenant this can
never target is `PLATFORM` itself — there's no path to suspending our own
staff's home tenant.

### `POST /admin/tenants/{id}/reinstate` — lift a suspension

**Auth:** `suspend`. **Request:** no body.

**Response** — `200 OK`, the `SuspensionResponse` now with `lifted_by`/
`lifted_at` filled in. **`409 identity_tenant_not_suspended`** if there was
nothing to lift.

### `GET /admin/tenants/{id}/suspensions` — history, newest first

**Auth:** `tenants`. **Response** — `200 OK`, array of `SuspensionResponse`
— every suspend/reinstate cycle this organisation has ever been through,
never just the current one.

### `PUT /admin/colleges/{id}/seats` — set a college's seat allowance

**Auth:** `seats` (Admin only).

**Request body** (`AllocateSeatsRequest`):
```json
{ "seats": 500 }
```
**Response** — `200 OK` (`SeatAllocationResponse`):
```json
{ "allocated": 500, "used": 312, "filled": 8 }
```
`filled` is how many *already-linked, waiting* students this specific
change seated (longest-linked first) — raising the allowance can
immediately activate students who'd linked to the college before a seat
existed for them. **Errors carry their own codes rather than a generic
422**: `college_seats_below_used` (can't set the allowance under what's
already occupied) and `college_seats_exceed_plan` (can't set it above what
the college's live subscription plan actually pays for,
`seat_allowance`) — this is the one place a tenant id in the path is
legitimate, because it names *which* college's own allowance is being read
back against its own plan, not a value trusted to grant access on its own.

---

## 4. Drill-downs — `GET /admin/{candidates,employers,colleges}/{id}`

**The read-everything-about-one-entity screens.** Each is audited on
every open, re-opens included — invariant 7′ applied to staff exactly as
it's applied to an employer's candidate reveal.

Employers and colleges are found through `GET /admin/tenants` (§3).
Candidates are not tenants, so they have their own list, next.

### `GET /admin/candidates` — find a candidate (audited)

**Auth:** `candidate_drilldown` capability — whoever may open a candidate
may find one (Admin, Support Agent, Integrity Reviewer; a KYB Reviewer gets
`403`).

**Request** — all optional:

| Param | Meaning |
|---|---|
| `status` | `ACTIVE` \| `SUSPENDED` \| `DELETED` (an erased account: its row stays, emptied, so its name and contacts come back `null`) |
| `q` | Part of the full name, case-insensitive, max 100 chars. `%` and `_` are matched literally, not as wildcards |
| `email` | The **exact** address, case and surrounding spaces ignored — for "someone wrote to support from this address". Not a partial match, so it cannot enumerate a domain |
| `cursor`, `limit` | Keyset paging, `limit` 1–100 (default as elsewhere) |

Newest account first. **Only candidate accounts**: a business account
(employer, college or staff) never appears, even searched for by its exact
email.

**Response** — `200 OK` (`CandidatesPage`):
```json
{
  "items": [{
    "id": "...", "status": "ACTIVE",
    "full_name": "Priya Sharma", "city": "Pune", "state_code": "MH",
    "phone_masked": "+91******3210", "email_masked": "p***@example.com",
    "created_at": "2026-09-20T10:15:00Z"
  }],
  "next_cursor": "eyJ0Ijoi..."
}
```
`full_name`, `city`, `state_code` are `null` until the candidate has given
them. **Deliberately not on the row:** the score or band, the CV,
subscription, applications — every one of those is behind the drill-down
below, which audits the one person opened. The list is for picking
someone, not for reading them.

**Audited on every page**: one `admin_bypass_session_opened` row, target
type `candidates`, metadata `{"view": "candidates", "status": ..., "by_name":
true|false, "by_email": true|false}`. **The search terms themselves are not
recorded** — a name or an email address is personal data, and the audit log
holds ids. The row says *that* this person searched, not *for whom*.

`422 invalid_cursor` for a mangled cursor; `422` (FastAPI's shape) for a
bad `status`.

### `GET /admin/candidates/{user_id}` — `candidate_drilldown` capability

**Response** — `200 OK` (`CandidateDrilldown`):
```json
{
  "id": "...", "status": "ACTIVE", "locale": "hi", "created_at": "...",
  "full_name": "John Doe", "city": "Bangalore", "state_code": "KA",
  "phone_masked": "+91******3210", "email_masked": "j***@example.com",
  "score": { "display_value": 812, "band": "SOLID", "computed_at": "...", "scores_computed": 1 },
  "resume": { "files": 2, "versions": 3, "last_confirmed_at": "..." },
  "visible_to_employers": true,
  "integrity_signals": [{ "severity": "LOW", "state": "CLEARED", "count": 1 }],
  "applications_by_stage": { "SUBMITTED": 1, "HIRED": 1 },
  "hire_disputes": 0,
  "subscription": { "state": "ACTIVE", "plan_code": "CANDIDATE_MONTHLY", "current_period_end": "..." },
  "college_links": [{ "tenant_id": "...", "college": "IIT Example", "scope": "ROSTER", "granted_at": "..." }],
  "seat_held": true,
  "disputes_by_state": {}
}
```
`404 admin_candidate_not_found` for a bad id. **Notice what's absent even
here, at the deepest cross-tenant view in the whole system**: no field
named anything with "raw" in it — `score.display_value` is the exact same
number the candidate's own `GET /candidate/score/me` returns, never the
internal value — and `resume` counts files and versions but includes no
content. A CV is never read from this screen, only counted.

### The full candidate page — `GET /admin/candidates/{user_id}/…` (2026-09-29)

The client asked for one page per student with everything on it. It is
**seven endpoints, not one**, so that each larger reveal is its own
permission and its own audit row — a member of staff checking where an
application stands has not thereby read a CV or listened to anyone.

| Endpoint | Capability (roles) | What it returns |
|---|---|---|
| `…/onboarding` | `candidate_contact` (admin, support) | Everything given at sign-up and on the profile, **phone and email unmasked**, questionnaire answers in words, college links |
| `…/resume` | `candidate_resume` (+ integrity reviewer) | The newest CV version and the newest confirmed one (what the score was built from): text or form fields, and the uploaded file by presigned GET |
| `…/score-timeline` | `candidate_drilldown` | Every score, oldest first |
| `…/interviews` | `candidate_drilldown` | Every mock-interview session |
| `…/interviews/{session_id}/recordings` | `candidate_recordings` (admin, support) | One presigned GET per answer, with the question and transcript |
| `…/courses` | `candidate_drilldown` | Purchase, lessons watched, percent, completion |
| `…/applications` | `candidate_drilldown` | Every application with job, employer and stage, plus analytics |

The score timeline shows **what the candidate saw**, never the stored number:
```json
{ "points": [
  { "computed_at": "...", "display_value": 760, "band": "DEVELOPING", "change": null, "cause": "FIRST_SCORE" },
  { "computed_at": "...", "display_value": 780, "band": "DEVELOPING", "change": 20, "cause": "RESUME_CHANGED" },
  { "computed_at": "...", "display_value": 800, "band": "SOLID", "change": 20, "cause": "ADD_ON" }
] }
```
`cause` is `FIRST_SCORE`, `RESUME_CHANGED` (a new confirmed CV), `ADD_ON` (an
interview or the course) or `RECOMPUTED`. The candidate is not shown this
history (the client declined it); staff are, so "why did my score drop?" has
an answer.

The applications part carries the same analytics a college sees per student:
```json
{ "items": [ { "id": "...", "job_title": "Warehouse Supervisor", "employer_name": "Acme Pvt Ltd",
               "stage": "INTERVIEW", "applied_at": "...", "interview_at": "..." } ],
  "analytics": { "total": 3, "open": 1,
                 "by_stage": { "SUBMITTED": 0, "INTERVIEW": 1, "REJECTED": 2, "...": 0 },
                 "reached": { "SHORTLISTED": 3, "INTERVIEW": 2, "DECISION": 0, "HIRED": 0 } } }
```
`reached` counts applications that were ever at each milestone, wherever
they are now.

### Building the course — `/admin/courses`, `/admin/course-modules/*`, `/admin/course-lessons/*`

Capability `courses`, PLATFORM_ADMIN only: a lesson counts toward a score
once watched, so what the course contains, and when it goes on sale, is the
admin's alone. The walk-through (modules → YouTube or uploaded lessons →
publish) is in [08](08-billing-subscriptions-courses-apis.md) §7. Every change
writes a `course_content_changed` audit row.

### `GET /admin/employers/{tenant_id}` — `employer_drilldown` capability

**Response** — `200 OK` (`EmployerDrilldown`): organisation identity, KYB
status and its `latest_kyb` summary, `members_by_role`, `jobs_by_status`,
`applications_by_stage`, `subscription`, `suspension` (if any),
**`candidates_viewed_last_day` / `_last_30_days`** (distinct candidates
opened through the reveal — the same counting rule as the organisation's
own view caps in [05-jobs-and-discovery-apis.md](05-jobs-and-discovery-apis.md)),
`view_anomaly_flags_last_30_days`, `disputes_by_state`. `404
admin_organisation_not_found` for a bad or wrong-type id.

### `GET /admin/colleges/{tenant_id}` — `college_drilldown` capability

**Response** — `200 OK` (`CollegeDrilldown`): identity, onboarding/
verification state, `members_by_role`, `seats` (allocated/used/plan
allowance), `live_referral_codes`, **`connected_students`** (live ROSTER)
and **`individually_visible`** (live INDIVIDUAL) — the exact same two
counts the college's own [11-college-analytics-apis.md](11-college-analytics-apis.md)
overview shows it about itself, `roster_imports_by_state`,
`invitations_by_state`, `subscription`, `suspension`, `disputes_by_state`.

### `POST /admin/users/{user_id}/notification-suppressions` — stop messages on a channel

**Auth:** `suppress_notifications`.

**Request body** (`SuppressRequest`):
```json
{ "channel": "EMAIL", "reason": "BOUNCED" }
```
`channel`: `SMS` / `EMAIL` / `PUSH` / `ALL`. `reason`: `BOUNCED` /
`COMPLAINED` / `SUPPORT_REQUEST`.

**Response** — `200 OK` (`SuppressResponse`):
```json
{ "user_id": "...", "channel": "EMAIL", "created": true }
```
`created: false` if that channel was already suppressed. **This is our
own decision, kept apart from the person's own preferences** in
[14-notifications-inbox-apis.md](14-notifications-inbox-apis.md) — a
bounced address or a complaint is us stopping delivery, not them opting
out, and the two lists are never merged.

---

## 5. Disputes, the console's side — `/admin/disputes/*`

**Auth:** `disputes` capability (Admin or Support Agent).

### `GET /admin/disputes` — the queue, across all three parties

**Request:** `?state=` (`OPEN`/`IN_REVIEW`/`RESOLVED`/`REJECTED`),
`?kind=` (`HIRE`/`PAYMENT`/`ACCOUNT`/`OTHER`), `?party=`
(`CANDIDATE`/`EMPLOYER`/`COLLEGE`), `cursor`, `limit`. **Without `state`,
this shows only `OPEN` and `IN_REVIEW`** — what actually still needs
someone, not the whole closed history by default.

**Response** — `200 OK` (`DisputesPage`), array of `DisputeRow`:
```json
{ "items": [{ "id": "...", "kind": "HIRE", "party": "CANDIDATE", "source": "HIRE_DISPUTE", "raised_by": "...", "tenant_id": null, "application_id": "...", "state": "OPEN", "assigned_to": null, "created_at": "...", "resolved_at": null }], "next_cursor": null }
```
`source` is `RAISED` (came in through `POST /disputes`) or `HIRE_DISPUTE`
(a candidate's `POST /candidate/applications/{id}/hire/dispute` from
[06-applications-pipeline-apis.md](06-applications-pipeline-apis.md) —
**that action has always fed this same queue**, just unread by anyone
until this module existed).

### `GET /admin/disputes/{id}` — one, cross-linked (audited)

**Response** — `200 OK` (`DisputeDetail` — the row above, plus
`description`, `resolution`, `resolved_by`, and `links`: `candidate_id`,
`raiser_tenant_id`, the linked `application` if it's a HIRE dispute
(candidate, employer, job, stage, both confirmation timestamps), and
`live_integrity_signals` — any OPEN/CONFIRMED signal on this candidate, by
severity, so a reviewer sees at a glance whether the person behind a
dispute has an unresolved integrity flag). `404 dispute_not_found`.

### `POST /admin/disputes/{id}/assign` — take it

**Request:** no body. **Response** — `200 OK`, `DisputeDetail` with
`assigned_to` now the caller. **`409 dispute_transition_invalid`** if the
dispute isn't in a state that can be assigned from (already resolved,
already rejected).

### `POST /admin/disputes/{id}/resolve` — close it with an answer

**Request body** (`ResolveDisputeRequest`):
```json
{ "outcome": "RESOLVED", "resolution": "Confirmed with the employer directly — the offer stands and the candidate has been re-added to the pipeline." }
```
`resolution` (1–2000 chars) is **what the raiser reads** — write it for
them, not as an internal note. **Response** — `200 OK`, the closed
`DisputeDetail`. **`409 dispute_transition_invalid`** from any state that
isn't `OPEN` or `IN_REVIEW`.

**Resolving a dispute records words and moves nothing else** — closing a
HIRE dispute never itself reverses a hire, refunds a payment, or reopens
an application; whatever operational fix a resolution implies happens
through that module's own service, by a human acting on what they just
read here, not automatically as a side effect of this call.

---

## 6. `GET /admin/audit-events` — search the audit trail

**Auth:** `audit_search` (Admin only — the tightest capability in the
console, because this is where *everyone else's* actions are recorded).

**Request:** `?actor_id=`, `?action=`, `?target_type=`, `?target_id=`,
`?tenant_id=`, `?from=`/`?to=` (inclusive/exclusive respectively),
`cursor`, `limit`.

**Response** — `200 OK` (`AuditEventsPage`):
```json
{
  "items": [
    { "id": 48213, "actor_id": "...", "actor_role": "EMPLOYER_OWNER", "action": "CANDIDATE_REVEALED", "target_type": "candidate", "target_id": "9f2e...", "tenant_id": "...", "request_id": "...", "metadata": {}, "occurred_at": "..." }
  ],
  "next_cursor": null
}
```
Newest first. **`422 audit_action_unknown`** for an `action` value that
isn't a real audited action name (catches a typo rather than silently
returning zero rows and looking like "nothing happened"). **`422
audit_time_range_invalid`** if `from` is after `to`.

**This search is itself written to the trail, with its own filters** —
searching the audit log is an action worth auditing, so a search for
everything a specific staff member did is itself visible to a later
search.

---

## 7. Accounts made on someone's behalf — `/admin/accounts/*`, `/admin/tenants/{id}/members`

**Auth:** `accounts` (provisioning, Admin only) or `resend_invitation`
(Admin or Support Agent). Added 2026-09-18, closing blockers E7 alongside
opening self-registration to everyone (see
[03-login-signup-apis.md](03-login-signup-apis.md), which now needs a
rewrite of its own "business accounts are admin-create-only" framing — see
that doc's note). **The rule that ties every route below together: our row
is written first, Cognito is asked to create the login second — invite
last.** A refusal at our own validation step emails nobody; a Cognito
failure after our row exists rolls the whole thing back, so there's never
a Cognito account with no matching row or vice versa.

### `POST /admin/accounts/candidates` — make a candidate account

**Request body** (`ProvisionCandidateRequest`):
```json
{ "email": "candidate@example.com" }
```
**Response** — `201 Created` (`ProvisionedAccountResponse`):
```json
{ "user_id": "...", "kind": "CANDIDATE", "tenant_id": null, "role": null, "invitation": "SENT" }
```
`invitation: "SENT"` means Cognito emailed a temporary password just now;
`"ALREADY_REGISTERED"` means this address already has a sign-in — nothing
was emailed, and they should just sign in as usual. **`409
identity_account_exists`** if the address has any account at all, in
either pool.

### `POST /admin/accounts/employers` — make an employer and its owner

**Request body** (`ProvisionEmployerRequest`):
```json
{ "owner_email": "owner@acme.com", "legal_name": "Acme Pvt Ltd", "employer_type": "PRIVATE_LIMITED", "industry": "IT_SERVICES" }
```
**Response** — `201 Created`, `ProvisionedAccountResponse` with
`kind: "EMPLOYER"`, `tenant_id` and `role: "EMPLOYER_OWNER"` filled in.
The owner still completes KYB and pays like any other employer — this
endpoint only saves them typing the organisation-creation form themselves.
**`409 identity_already_in_organisation`** if the address already runs
one.

### `POST /admin/accounts/colleges` — make a college and its admin

**Request body** (`ProvisionCollegeRequest`):
```json
{ "admin_email": "admin@iit-example.edu", "name": "IIT Example", "institution_type": "ENGINEERING_COLLEGE" }
```
**Response** — same shape, `kind: "COLLEGE"`, `role: "COLLEGE_ADMIN"`.

### `POST /admin/tenants/{tenant_id}/members` — add someone to an existing org

**Request body** (`AddOrganisationMemberRequest`):
```json
{ "email": "recruiter@acme.com", "role": "EMPLOYER_RECRUITER" }
```
`role` must match the tenant's own kind (`EMPLOYER_*` for an employer,
`COLLEGE_*` for a college — `422 admin_account_invalid` otherwise).
**Response** — `201 Created`, `ProvisionedAccountResponse`,
`kind: "MEMBER"`.

### `POST /admin/accounts/{user_id}/resend-invitation` — email the temp password again

**Auth:** `resend_invitation` (Admin or Support Agent — the one
account-provisioning action Support can do alone, because it adds nobody,
it only re-sends what an Admin already decided).

**Request:** no body. **Response** — `200 OK` (`InvitationResentResponse`):
```json
{ "user_id": "...", "resent": true }
```
**`409 identity_account_already_active`** for an account that has already
signed in once — resending only makes sense for someone who's never used
the temporary password at all; the new one gets a fresh expiry.

---

## 8. Discount codes — `/admin/discount-codes*`

**Auth:** `discounts` (create/disable, Admin only) or `discounts_read`
(list/get/redemptions, Admin or Support Agent — support answers "why
didn't my code work" without being able to mint new ones). Added
2026-09-18 alongside the discount-preview endpoint documented in
[08-billing-subscriptions-courses-apis.md](08-billing-subscriptions-courses-apis.md).

### `POST /admin/discount-codes` — create one

**Request body** (`CreateDiscountCodeRequest`) — **exactly one** of
`percent_off` or `amount_off_minor`:
```json
{ "audience": "CANDIDATE", "percent_off": 50, "label": "Launch promo", "usage_limit": 500, "valid_until": "2026-12-31T23:59:59Z" }
```
Leave `code` out to have one generated; `percent_off` is 1–99,
`amount_off_minor` is paise, `valid_from` defaults to now.

**Response** — `201 Created` (`DiscountCodeResponse`):
```json
{
  "id": "...", "code": "LAUNCH50", "audience": "CANDIDATE",
  "percent_off": 50, "amount_off_minor": null,
  "valid_from": "...", "valid_until": "2026-12-31T23:59:59Z",
  "usage_limit": 500, "usage_count": 0, "status": "ACTIVE",
  "label": "Launch promo", "created_by": "...", "created_at": "...",
  "disabled_at": null, "disabled_by": null
}
```
`status` is **computed**, never stored directly — `ACTIVE` /
`SCHEDULED` (before `valid_from`) / `EXPIRED` (past `valid_until`) /
`EXHAUSTED` (hit `usage_limit`) / `DISABLED`. **`409
discount_code_taken`** for a chosen `code` that already exists. **A code's
terms never change once created** (`guard_discount_code_write`) —
`422 discount_code_terms_invalid` covers sending both discount fields, or
neither, or a code that's already something other than brand-new; to
change a percentage, switch the old code off and make a new one.

### `GET /admin/discount-codes` — list, newest first

**Request:** `?audience=`, `cursor`, `limit`. **Response** — `200 OK`
(`DiscountCodesPage`), an array of the shape above plus a top-level
`policy_version` (currently `placeholder-...` — the discount policy itself,
like several other client decisions noted in the root `CLAUDE.md`'s
placeholder table, is still ours, not the client's final word).

### `GET /admin/discount-codes/{id}` — one

**Response** — `200 OK`, a single `DiscountCodeResponse`. `404
discount_code_not_found`.

### `POST /admin/discount-codes/{id}/disable` — switch it off, for good

**Request:** no body. **Response** — `200 OK`, `status: "DISABLED"`,
`disabled_at`/`disabled_by` filled in. **Idempotent.** **Payments already
made with this code are completely untouched** — disabling only stops
*future* checkouts from applying it; nothing about a past discount is
reversed.

### `GET /admin/discount-codes/{id}/redemptions` — who used it

**Request:** `cursor`, `limit`. **Response** — `200 OK`
(`DiscountRedemptionsPage`):
```json
{ "items": [{ "id": "...", "payment_id": "...", "user_id": "...", "subscriber_type": "USER", "subscriber_id": "...", "organisation": null, "list_amount_minor": 29900, "discount_minor": 14950, "amount_minor": 14950, "redeemed_at": "..." }], "next_cursor": null }
```
**A use is recorded when its payment succeeds, not at checkout** — exactly
the same "nothing is granted until the signed callback settles" rule from
[08](08-billing-subscriptions-courses-apis.md) applies to counting a
redemption. For a business subscriber, `organisation` names the tenant; for
a candidate, only the `user_id` is shown — open their drill-down (§4),
itself audited, for more.

---

## 9. `/disputes` — where the three external parties raise and read their own

**Mounted from this same `admin` module but a completely different
surface**, because a dispute has to be raised by an external account and
worked by an internal one, and this is the one point where those two
worlds share a table. **No console capability applies here at all** — auth
is simply `require_role` over `CANDIDATE`, `EMPLOYER_OWNER`,
`EMPLOYER_RECRUITER`, `COLLEGE_ADMIN`, `COLLEGE_STAFF` (a Viewer reads,
raising a dispute *for* the organisation is a step up from reading, so
Viewers are left out).

### `POST /disputes` — raise one

**Request body** (`RaiseDisputeRequest`):
```json
{ "kind": "PAYMENT", "description": "Charged twice for the same subscription period on 22 Sept." }
```
or, for a `HIRE` dispute:
```json
{ "kind": "HIRE", "application_id": "...", "description": "Employer confirmed the hire verbally but never opened the confirm screen." }
```
`kind`: `HIRE` / `PAYMENT` / `ACCOUNT` / `OTHER`. **`application_id` is
required for `HIRE` and refused for every other kind** — `422
dispute_application_required` / `422 dispute_application_unexpected`
respectively. `description` is 10–2000 characters.

**Response** — `201 Created` (`MyDisputeResponse`):
```json
{ "id": "...", "kind": "PAYMENT", "source": "RAISED", "application_id": null, "description": "...", "state": "OPEN", "resolution": null, "created_at": "...", "resolved_at": null }
```
**Notice what's absent: no `assigned_to`, no `resolved_by`.** Which member
of staff is working a dispute is ours to know, not the raiser's — the
answer they eventually get is the same regardless of who wrote it.

**Errors:**
| Code | When |
|---|---|
| `422 dispute_kind_not_allowed` | A college trying to raise `HIRE` — colleges have no applications, so this is the one kind restricted by party (`KINDS_BY_PARTY`). |
| `422 dispute_application_required` / `dispute_application_unexpected` | `application_id` and `kind` disagree about whether one belongs. |
| `404 dispute_application_not_found` | The named application isn't one the caller (or their organisation) can actually see. |
| `429` | Five a day per person — a hard, documented cap. |

**A candidate's own hire dispute has a second door in, already covered in
[06-applications-pipeline-apis.md](06-applications-pipeline-apis.md):**
`POST /candidate/applications/{id}/hire/dispute` writes into this exact
same table, with `source: "HIRE_DISPUTE"` instead of `"RAISED"` — one
dispute system underneath two different ways of arriving at it.

### `GET /disputes` — mine, or my organisation's

**Request:** no body. **Response** — `200 OK`, array of
`MyDisputeResponse` — every dispute this account raised, or (for an
employer/college role) every dispute anyone at their organisation raised.
No cursor — this is a personal/organisational list, not expected to grow
into the thousands the way the console's own queue might.

---

## Quick reference

| Question | Answer |
|---|---|
| Can a Support Agent suspend a tenant or allocate seats? | No — both are `PLATFORM_ADMIN`-only capabilities. |
| Does resolving a dispute automatically undo the thing it's about? | Never — it records an answer for the raiser; any actual fix happens through that module's own service, separately. |
| Can staff read a candidate's raw stored score? | Never — `display_value`/`band` only, the timeline included. |
| Can staff read a CV or hear an interview? | Yes since 2026-09-29, through their own endpoints and capabilities (`candidate_resume`, `candidate_recordings`), each audited. The drill-down itself still only counts. |
| Why does `GET /admin/tenants?type=CANDIDATE` fail? | A candidate isn't a tenant. Use `GET /admin/candidates` (search by `q` name or exact `email`), then open one with `GET /admin/candidates/{user_id}`. |
| Is any of this paywalled? | No — the console is internal, and disputing a payment must never itself require one. |
| Where did HIRE disputes go before this doc existed? | Into the exact same table this doc covers — `POST .../hire/dispute` has always fed this queue; it was simply unread until Day 19. |
