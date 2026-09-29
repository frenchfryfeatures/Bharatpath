# 06 — Applications: the hiring pipeline

What happens after a candidate hits "Apply." Thirteen endpoints, three surfaces
(`/candidate/applications`, `/employer/applications`, `/employer/dashboard`), one shared state
machine underneath both.

Read [05-jobs-and-discovery-apis.md](05-jobs-and-discovery-apis.md) first —
applying requires an already-published job and a computed score.

---

## 0. The big picture — one state machine, three parties

```
SUBMITTED ──▶ VIEWED ──▶ SHORTLISTED ──▶ INTERVIEW ──▶ DECISION ──▶ HIRED
    │            │             │              │            │
    └────────────┴─────────────┴──────────────┴────────────┴──▶ REJECTED
    (any of the five pipeline stages can also go to:)
                              WITHDRAWN   (candidate only)
                              EXPIRED     (system only, employer went quiet)
```

**Three different parties move an application, and each can only move it in
their own way** — this is the single organizing idea of the whole module:

| Party | Can do |
|---|---|
| **Candidate** | Apply, withdraw (any point before an outcome), confirm/dispute a hire |
| **Employer** | Walk it **one stage forward at a time**, or reject it, from any open stage |
| **System** | Expire it, automatically, if the employer goes silent too long |

**HIRED belongs to nobody alone.** The employer *proposes* a hire (at
DECISION); it isn't real until the candidate *confirms* it. This two-sided
handshake is the one place the state machine needs two different actors to
agree before a transition is final — everything else is one party's call.

### Why "one stage forward, never a jump"

`applications/domain.py`'s `employer_move()` refuses SUBMITTED → DECISION
directly, even though nothing about the data would technically prevent it —
skipping straight to a decision would put a candidate at a decision screen
with no record of ever being shortlisted or interviewed on their own board.
The one exception baked into the same function: **acting on a SUBMITTED
application at all — shortlisting it, even rejecting it — silently records
VIEWED first.** So a candidate's history never claims an employer decided
about them without having opened their application.

### Two enforcement layers for the same rule (worth noticing as a pattern)

This is the second time you'll see this pattern in the codebase (the first
was the KYB-before-publish gate on jobs): the *legal* moves are defined once,
in pure Python (`domain.allowed_transitions()`), and then **the database's
own migration builds a trigger from that exact same list** — so even a
direct, hand-written `UPDATE applications SET stage = ...` that skipped the
application layer entirely would still be refused by Postgres itself. The
application code isn't the only thing standing between "requested" and
"happened."

---

## 1. `POST /candidate/applications` — apply to a job

Requires: `CANDIDATE` role + active subscription.

**Request body** (`ApplyRequest`):
```json
{ "job_id": "..." }
```
That's the *entire* body — no stage, no note, and definitely no score.
Eligibility is judged against the candidate's **already-stored** score, so
there's no field here that could smuggle a different one in.

**What happens, in this exact order:**
1. Already have an active (non-terminal) application to this job? → return
   the existing one, `200 OK` instead of `201` (applying twice is a
   harmless retry, not an error).
2. Is the job actually published and open? → else `404 job_not_found`.
3. Does the candidate have a computed score yet? → else `409 score_pending`
   (still `PENDING` from the scoring flow — not a rejection, just "not
   ready yet").
4. **Is this candidate visible under the exact same rule discovery search
   uses** (`is_candidate_visible`)? → else `409 application_unavailable`.
   This is a deliberate reuse, not a coincidence: without it, a candidate
   suppressed from employer search by an unresolved integrity signal could
   still reach that same employer's inbox by hitting "Apply" — the apply
   button would be a side door around the exact protection discovery search
   enforces.
5. Meets the job's `min_score`? → else `403 eligibility_below_threshold`,
   **with no number attached** — same "never explain the score" rule as
   everywhere else.
6. Insert the row, `SUBMITTED`.

**Response** — `201 Created` (or `200` on repeat) (`ApplicationResponse`):
```json
{
  "id": "...", "job_id": "...", "job_title": "Backend Engineer",
  "employer_name": "Acme Pvt Ltd", "stage": "SUBMITTED",
  "hire_confirmation": "NONE", "interview": null,
  "created_at": "...", "updated_at": "..."
}
```

---

## 2. `GET /candidate/applications` — "my applications" board

**Auth required:** `CANDIDATE` role only — **no subscription check**.
Reading your own applications is never paywalled; a lapsed subscriber loses
*access to new things*, never their existing data.

**Request:** no body. Optional `cursor`/`limit` query params for pagination.

**Response** — `200 OK`, a `Page` of `ApplicationResponse` (same shape as
§1's response), newest first:
```json
{
  "items": [
    {
      "id": "...", "job_id": "...", "job_title": "Backend Engineer",
      "employer_name": "Acme Pvt Ltd", "stage": "SUBMITTED",
      "hire_confirmation": "NONE", "interview": null,
      "created_at": "...", "updated_at": "..."
    }
  ],
  "next_cursor": null
}
```

## 3. `GET /candidate/applications/{application_id}` — one, with history

**Auth required:** `CANDIDATE`, not paywalled.

**Request:** no body, `application_id` in the path.

**Response** — `200 OK` (`ApplicationDetailResponse` — everything
`ApplicationResponse` has, plus `history`):
```json
{
  "id": "...", "job_id": "...", "job_title": "Backend Engineer",
  "employer_name": "Acme Pvt Ltd", "stage": "SHORTLISTED",
  "hire_confirmation": "NONE", "interview": null,
  "created_at": "...", "updated_at": "...",
  "history": [
    { "kind": "STAGE_CHANGED", "from_stage": null, "to_stage": "SUBMITTED", "by": "CANDIDATE", "occurred_at": "..." },
    { "kind": "STAGE_CHANGED", "from_stage": "SUBMITTED", "to_stage": "VIEWED", "by": "EMPLOYER", "occurred_at": "..." },
    { "kind": "STAGE_CHANGED", "from_stage": "VIEWED", "to_stage": "SHORTLISTED", "by": "EMPLOYER", "occurred_at": "..." }
  ]
}
```
**Notice `by` says *which party*, never *which recruiter*** — the
candidate's history never names an individual employer staff member. `404`
for another candidate's application, never `403`.

## 4. `POST /candidate/applications/{application_id}/withdraw`

**Auth required:** `CANDIDATE`, not paywalled.

**Request:** no body, `application_id` in the path.

**Response** — `200 OK`, the updated `ApplicationResponse` with
`"stage": "WITHDRAWN"`. Works from any stage **before** an outcome. `409`
if it's already `HIRED`, `REJECTED`, or `EXPIRED` — nothing to withdraw
from a story that's already over. Repeating it is harmless (returns the
already-withdrawn application, still `200`).

---

## 5. Hire confirm / dispute — the candidate's half of the handshake

### `POST /candidate/applications/{application_id}/hire/confirm`

**Auth required:** `CANDIDATE`, not paywalled.

**Request:** no body, `application_id` in the path.

**Response** — `200 OK`, updated `ApplicationResponse`:
```json
{ "id": "...", "job_id": "...", "stage": "HIRED", "hire_confirmation": "CONFIRMED", ... }
```
Only does something when the application is at `DECISION` **and** the
employer has already proposed the hire (`employer_confirmed_at` set) — else
`409 hire_confirmation_not_pending`. If already `HIRED`, this is a no-op
retry (still returns `200` with the same body). **This call is literally
what moves the stage to `HIRED`** — the employer's proposal alone never does.

### `POST /candidate/applications/{application_id}/hire/dispute`

**Auth required:** `CANDIDATE`, not paywalled.

**Request:** no body, `application_id` in the path.

**Response** — `200 OK`, updated `ApplicationResponse`:
```json
{ "id": "...", "job_id": "...", "stage": "DECISION", "hire_confirmation": "DISPUTED", ... }
```
Same preconditions as confirm (`409 hire_confirmation_not_pending` if
nothing's been proposed). **This does not reject or withdraw anything** —
`stage` stays `DECISION`, only `hire_confirmation` changes, and the
employer's proposal keeps standing. From here it can still go three ways:
the candidate confirms after all (maybe it was a misunderstanding), the
employer rejects, or the candidate withdraws. Deciding who was actually
right is a human review process that doesn't exist yet in this build (a
known, tracked gap).

---

## 6. The employer's pipeline

### `GET /employer/applications` — list applications, for one job or all of them

**Auth required:** any employer role (Owner/Recruiter/Viewer) + active subscription.

**Request:** no body. Every query param is optional:

| Param | Meaning |
|---|---|
| `job_id` | Only this job's applications. **Leave it out for every job the organisation has**, in one list. Another organisation's job is `404 job_not_found`. |
| `stage` | Only applications at this stage (`SUBMITTED`, `VIEWED`, `SHORTLISTED`, …). Works with or without `job_id`. |
| `limit` | Page size, default 50, at most 100 (`422` outside 1–100). |
| `cursor` | `next_cursor` from the previous page. |

```
GET /employer/applications                          # the whole pipeline board
GET /employer/applications?stage=SHORTLISTED        # one column, across every job
GET /employer/applications?job_id=e577...           # the job filter
```

**Response** — `200 OK`, a `Page` of `EmployerApplicationListItem`:
```json
{
  "items": [
    {
      "id": "...", "job_id": "...", "candidate_id": "9f2e...",
      "job_title": "Backend Engineer", "job_location": "Delhi",
      "stage": "SUBMITTED", "hire_confirmation": "NONE",
      "interview": null, "created_at": "...", "updated_at": "..."
    }
  ],
  "next_cursor": "eyJj...",
  "total": null
}
```
Oldest first (opposite of the candidate's own view, which is newest-first)
— a pipeline is worked queue-style. Across jobs it is still one order by
`created_at`, so the page is not grouped by job; group on `job_id` client-side.
`job_title` and `job_location` are the job's own (the organisation's data), so
a board spanning jobs does not need a request per card to label it;
`job_location` is `null` for a job with no location. `next_cursor` is `null` on
the last page, and there is no total.

**Draw the pipeline board from this list alone.** One request with no
`job_id` (and `limit=100`, following `next_cursor` if it is set) fills every
column. Two things must *not* be called per card:

- `GET /employer/applications/{id}` **records VIEWED** on a submitted
  application — the candidate sees that someone looked. Opening every card to
  draw the board marks the whole column viewed.
- `GET /employer/discovery/candidates/{id}` is the audited reveal: every call
  writes an audit row and counts against the organisation's hourly and daily
  view caps.

Listing is read-only and records nothing.

**This is explicitly not a candidate profile** — no name, no contact, no score.
`candidate_id` is only a handle; seeing who this actually is requires the
separate, audited reveal from [05](05-jobs-and-discovery-apis.md).

### `GET /employer/applications/{application_id}` — open one

**Auth required:** any employer role + active subscription.

**Request:** no body, `application_id` in the path.

**Response** — `200 OK` (`EmployerApplicationDetail` — everything
`EmployerApplicationSummary` has, plus `history`):
```json
{
  "id": "...", "job_id": "...", "candidate_id": "9f2e...",
  "stage": "VIEWED", "hire_confirmation": "NONE", "interview": null,
  "created_at": "...", "updated_at": "...",
  "history": [
    {
      "kind": "STAGE_CHANGED", "from_stage": null, "to_stage": "SUBMITTED",
      "by": "CANDIDATE", "actor_id": null, "note": null, "occurred_at": "..."
    },
    {
      "kind": "STAGE_CHANGED", "from_stage": "SUBMITTED", "to_stage": "VIEWED",
      "by": "EMPLOYER", "actor_id": "recruiter-user-id", "note": null, "occurred_at": "..."
    }
  ]
}
```
**Opening a `SUBMITTED` application silently moves it to `VIEWED`, once** —
this is the "acting on it is viewing it" rule from §0, applied to the
simple act of reading (so calling this GET can itself change the stage you
then see in the response). Unlike the candidate's version, each event here
carries `actor_id` (which team member acted) and `note`. **A note is
written about a candidate, never to them**, so it appears only on this
side, never on the candidate's own schema.

### `POST /employer/applications/{application_id}/stage` — move it

**Auth required:** Owner/Recruiter (not Viewer) + active subscription.

**Request body** (`MoveStageRequest`):
```json
{ "stage": "SHORTLISTED", "note": "Strong Python background" }
```
| Field | Type | Rule |
|---|---|---|
| `stage` | string | One of `VIEWED`, `SHORTLISTED`, `INTERVIEW`, `DECISION`, `REJECTED` — never `HIRED` (needs the candidate too), `WITHDRAWN`, or `EXPIRED` (not the employer's to set) |
| `note` | string or omitted | Up to 1000 chars, visible only on the employer side |

**Response** — `200 OK`, updated `EmployerApplicationDetail` (same shape as
the previous endpoint's response). `409 application_invalid_transition` for
anything that isn't a legal one-step move per §0's rules. Moving to the
stage it's already at is accepted and changes nothing.

### `PUT /employer/applications/{application_id}/interview` — book it

**Auth required:** Owner/Recruiter + active subscription.

**Request body** (`ScheduleInterviewRequest`):
```json
{ "interview_at": "2026-09-25T10:00:00+05:30", "meeting_url": "https://meet.example.com/abc" }
```
| Field | Type | Rule |
|---|---|---|
| `interview_at` | datetime | **Must carry a timezone offset** — a naive `"2026-09-25T10:00:00"` is a `422`, because "10:00" means something different in Pune than on the server's UTC clock. Can't be more than a year out. |
| `meeting_url` | string | 1–1024 chars, must be a real `https` link |

**Response** — `200 OK`, updated `EmployerApplicationDetail`, now with
`interview` filled in:
```json
{ "id": "...", "interview": { "interview_at": "2026-09-25T10:00:00+05:30", "meeting_url": "https://meet.example.com/abc" }, ... }
```
Only works at the `INTERVIEW` stage — `409 interview_not_at_stage`
otherwise. Calling it again re-books (overwrites the previous time/link).
**The platform hosts no call itself** — this is just storing the employer's
own meeting link for the candidate to see on their own board.

### `POST /employer/applications/{application_id}/hire` — propose

**Auth required:** Owner/Recruiter + active subscription.

**Request:** no body, `application_id` in the path.

**Response** — `200 OK`, updated `EmployerApplicationDetail`:
```json
{ "id": "...", "stage": "DECISION", "hire_confirmation": "PENDING", ... }
```
Only valid at `DECISION` — `409 hire_not_allowed` otherwise. Proposing
twice is a harmless retry (still `200`, same body). **This alone does not
hire anyone** — it sets `employer_confirmed_at` and waits;
`hire_confirmation` shows `PENDING` until the candidate acts. The stage
only becomes `HIRED` once the candidate calls `hire/confirm` from §5. A
`CHECK` constraint in the database itself refuses a row claiming stage
`HIRED` without *both* confirmations present — so even a bug that tried to
write `HIRED` directly, skipping the candidate's half, would be rejected at
the database level.

### `POST /employer/applications/{application_id}/messages` — write to the applicant

**Auth required:** Owner/Recruiter + active subscription. Added 2026-09-29:
the "message box per candidate" to invite someone to an interview or an
online assessment (OA).

**Request body** (`SendMessageRequest`) — one of three kinds:
```json
{ "kind": "INTERVIEW", "body": "Please bring your certificates.",
  "scheduled_at": "2026-10-03T05:00:00Z", "link": "https://meet.google.com/abc-defg-hij" }
```
```json
{ "kind": "ASSESSMENT", "body": "Forty minutes, any time before Friday.",
  "link": "https://www.hackerrank.com/test/xyz", "scheduled_at": "2026-10-04T12:30:00Z" }
```
```json
{ "kind": "GENERAL", "body": "Thank you for applying — we will be in touch this week." }
```
`INTERVIEW` needs `scheduled_at` (the link is optional: it may be in person).
`ASSESSMENT` needs `link` (the time is an optional deadline). Links must be
`https`. Times must be in the future and within a year.

**Response** — `201 Created` (`EmployerMessageResponse`):
```json
{ "id": "...", "kind": "INTERVIEW", "body": "…", "scheduled_at": "...", "link": "…",
  "sender_id": "the recruiter who wrote it", "created_at": "..." }
```

**What happens next** (in the background, through the outbox): the
candidate gets an **email** and an **in-app notification** in their
language — "Acme Pvt Ltd would like to interview you on 03 Oct 2026, 10:30 AM
IST", the link, and the employer's own words. **The employer never sees the
candidate's email address**: the platform sends it. The event carries only
the message id; the words are read when the email is built.

**Errors:**
| Code | When |
|---|---|
| `422 message_time_required` / `message_link_required` | Missing for that kind |
| `422 message_time_in_past` / `message_time_too_far` / `message_link_invalid` | Bad time or link |
| `409 message_not_allowed_at_stage` | The application is hired, rejected, withdrawn or expired |
| `429 message_limit_reached` | 10 messages to one application in a day (also 300/hour per organisation) |
| `404 application_not_found` | Not your organisation's application |

Only applicants: a message rides on an application, never on a search
result. Every message is audited (ids and kind, never the words) and counts
as employer activity, so the application does not expire mid-conversation.

### `GET /employer/applications/{application_id}/messages` and `GET /candidate/applications/{application_id}/messages`

Both oldest first. The employer's list includes `sender_id`; **the
candidate's never does** — it has `employer_name` instead, the same way a
stage change shows the candidate *that* the employer acted, never which
recruiter. The candidate's list is not paywalled, like the application itself.

---

## 7. Expiry — the one transition nobody calls

`EXPIRED` isn't reachable through any endpoint in this doc. A background
sweep task compares each open application's last-employer-activity
timestamp against a configured window (default 30 days, `config_values` key
`applications.expiry`) and expires anything the employer has gone silent on
for too long. A proposed hire never expires — once at `DECISION` with an
employer confirmation, the clock stops. (This sweep isn't wired to run on a
schedule yet in the current build — a tracked gap, not a design choice.)

---

## 8. The employer dashboard

Two endpoints for the portal's landing page. Both: **any employer role**
(Owner/Recruiter/Viewer) + **active subscription** (`402
subscription_required` otherwise, like the rest of the pipeline).

**Neither returns a name, contact, score or candidate id.** Everything is a
count, a job, or an application id — the same handles the pipeline screens
already take. Who a candidate is stays behind the audited reveal in
[05](05-jobs-and-discovery-apis.md).

### `GET /employer/dashboard` — the tiles, in one request

**Query:** `top_jobs` (1–20, default 5).

**Response** — `200 OK`, `EmployerDashboard`:
```json
{
  "generated_at": "2026-09-23T10:15:00Z",
  "jobs": { "total": 6, "active": 3, "draft": 1, "paused": 0, "closed": 2 },
  "applications": {
    "total": 120, "open": 45, "distinct_candidates": 110,
    "new_last_7_days": 12, "new_last_30_days": 40,
    "by_stage": { "SUBMITTED": 10, "VIEWED": 8, "SHORTLISTED": 12, "INTERVIEW": 9,
                  "DECISION": 6, "HIRED": 4, "REJECTED": 50, "WITHDRAWN": 15, "EXPIRED": 6 }
  },
  "needs_attention": {
    "unreviewed": 10, "interviews_to_schedule": 2, "interviews_next_7_days": 3,
    "hires_awaiting_candidate": 1, "hires_disputed": 0, "expiring_within_7_days": 4
  },
  "candidates_revealed": { "total": 30, "last_7_days": 5 },
  "top_jobs": [
    { "job_id": "...", "title": "Machine Operator", "status": "PUBLISHED",
      "applications": 41, "open": 18, "new_last_7_days": 6,
      "last_applied_at": "2026-09-23T08:02:11Z" }
  ],
  "upcoming_interviews": [
    { "application_id": "...", "job_id": "...", "job_title": "Machine Operator",
      "interview_at": "2026-09-25T04:30:00Z", "meeting_url": "https://meet.example.com/abc" }
  ],
  "applications_per_day": [ { "date": "2026-08-25", "count": 0 }, "... 30 entries ..." ]
}
```

| Field | Meaning |
|---|---|
| `jobs.active` | `PUBLISHED` — on the board now |
| `applications.total` | Every application ever received. Same number as the jobs list's `application_counts.total`, summed |
| `applications.open` | Not yet hired, rejected, withdrawn or expired |
| `applications.distinct_candidates` | People, not applications — someone who reapplied counts once |
| `applications.by_stage` | Where they stand **now**; every stage present; sums to `total` |
| `needs_attention.unreviewed` | `SUBMITTED` — nobody has opened them |
| `needs_attention.interviews_to_schedule` | At `INTERVIEW` with no time booked |
| `needs_attention.hires_awaiting_candidate` / `hires_disputed` | Hire proposed; candidate hasn't answered / said it didn't happen |
| `needs_attention.expiring_within_7_days` | Open applications the team hasn't touched for long enough that §7's sweep will expire them within a week — including any already overdue. A proposed hire never counts |
| `candidates_revealed` | Distinct candidates whose full profile the organisation opened — the design's "Candidates unlocked". Re-opening someone is not counted again |
| `top_jobs` | Busiest first, by `applications`; only jobs with at least one |
| `upcoming_interviews` | Next 5 booked, soonest first |
| `applications_per_day` | 30 **IST** calendar days ending today (today is partial), oldest first, zeros included — chart it directly |

"Recent" is the last seven days everywhere, so the tiles agree with each
other. Every number is read live on each request; nothing is cached, so a
refetch after a recruiter acts shows the change.

### `GET /employer/dashboard/activity` — recent activity feed

**Query:** `actor` (`CANDIDATE` | `EMPLOYER` | `SYSTEM`, optional),
`cursor`, `limit` (1–100, default 50).

**Response** — `200 OK`, a `Page` of `ActivityItem`, newest first:
```json
{
  "items": [
    { "id": "...", "application_id": "...", "job_id": "...", "job_title": "Machine Operator",
      "kind": "STAGE_CHANGED", "from_stage": "VIEWED", "to_stage": "SHORTLISTED",
      "by": "EMPLOYER", "actor_id": "recruiter-user-id", "occurred_at": "..." },
    { "id": "...", "application_id": "...", "job_id": "...", "job_title": "Machine Operator",
      "kind": "STAGE_CHANGED", "from_stage": null, "to_stage": "SUBMITTED",
      "by": "CANDIDATE", "actor_id": null, "occurred_at": "..." }
  ],
  "next_cursor": "..."
}
```
The same events as an application's `history` (§6), across every job.
`from_stage: null, to_stage: SUBMITTED` is "applied"; `by: SYSTEM,
to_stage: EXPIRED` is the sweep. `actor_id` is the team member, and only for
`EMPLOYER` rows. **No `note`** — open the application for that.

Pipeline events only, for now: job publishing, reveals, KYB and purchases
are not in this feed.

---

## Quick reference: who can reach which stage

| Target stage | Who can set it | How |
|---|---|---|
| `SUBMITTED` | Candidate | applying |
| `VIEWED` | Employer (often automatic) | opening, or moving past it |
| `SHORTLISTED` / `INTERVIEW` / `DECISION` | Employer | one step forward at a time |
| `REJECTED` | Employer | from any open stage |
| `HIRED` | **Both** | employer proposes, candidate confirms |
| `WITHDRAWN` | Candidate | any open stage |
| `EXPIRED` | System | background sweep only |
