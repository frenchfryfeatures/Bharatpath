# 05 — Jobs, Discovery & Reveal: input/output reference

Two things employers do that are easy to confuse but are completely separate
features in this codebase: **posting a job** (`jobs`) and **searching the
candidate database directly** (`discovery` + the reveal). A candidate can be
found either way — by applying to a job, or by an employer searching and
opening their profile — and this doc covers both paths, plus the candidate's
own job board.

Read [04-resume-and-scoring-apis.md](04-resume-and-scoring-apis.md) first —
the score computed there is exactly what determines a candidate's `band`
everywhere in this doc.

---

## 0. The big picture

```
EMPLOYER SIDE                                    CANDIDATE SIDE
──────────────                                    ──────────────
POST /employer/jobs          (create a draft)
PATCH .../{id}                (edit while draft)
POST .../{id}/publish   ──┐
                          │ (needs approved KYB)
                          ▼
                    job now PUBLISHED    ────────▶  GET /candidate/jobs
                                                     (search board, sees "eligibility")
                                                     GET /candidate/jobs/{id}
                                                             │
                                                     (candidate applies — Day 12 doc)

  ─── OR, entirely separately: ───

GET /employer/discovery/candidates          (masked search — band only, no name)
        │
        ▼
GET /employer/discovery/candidates/{id}     (the reveal — costs a "view", audited)
        → NOW name, phone, email, exact score become visible
```

**Two independent ways an employer finds someone.** Posting a job and
waiting for applicants is one path. Directly searching the whole candidate
pool by score band/skills/location and "revealing" a specific person is the
other. Both ultimately show the same underlying data, but discovery is
*blanket* access (pay once, search everyone) while a job's applicants are
scoped to whoever applied — which is exactly why discovery needs so much
more protection (rate limits, caps, audit trail) than reading one job's
applicant list does.

---

## 1. `POST /employer/jobs` — create a draft

Requires: `EMPLOYER_OWNER` or `EMPLOYER_RECRUITER`, **and an active
subscription** (checked *after* the role check — a Viewer gets a plain 403
rather than being told to go pay for something they could never use anyway).

**Request body** (`CreateJobRequest`):
```json
{
  "title": "Backend Engineer",
  "description": "We're looking for someone who...",
  "skills": ["Python", "PostgreSQL"],
  "location": "Bangalore",
  "work_mode": "HYBRID",
  "experience_min_months": 24,
  "salary_min_minor": 8000000,
  "salary_max_minor": 15000000,
  "min_score": 750
}
```
| Field | Rule |
|---|---|
| `title` | 3–255 chars |
| `description` | 20–20,000 chars |
| `salary_min_minor` / `salary_max_minor` | **Mandatory**, integer paise (₹80,000/mo = `8000000`). Max can't be below min. A job with no salary range is refused — both here and by a `NOT NULL` in the database itself. |
| `experience_min_months` | Months of experience, **never an age or a birth year** — invariant 5 forbids age as a proxy for anything. |
| `min_score` | Optional, 700–990. The minimum score to be "eligible." `700` is the floor everyone already has, so setting it there filters nobody. |
| `work_mode` | `ONSITE` \| `HYBRID` \| `REMOTE` |

**Response** — `201 Created` (`JobResponse`):
```json
{
  "id": "7a1c...",
  "title": "Backend Engineer",
  "description": "We're looking for someone who...",
  "skills": ["Python", "PostgreSQL"],
  "location": "Bangalore",
  "work_mode": "HYBRID",
  "experience_min_months": 24,
  "salary_min_minor": 8000000,
  "salary_max_minor": 15000000,
  "min_score": 750,
  "status": "DRAFT",
  "published_at": null,
  "closed_at": null,
  "created_at": "2026-09-17T10:00:00Z"
}
```

**Notice there's no `status` field in the *request* at all** — `extra="forbid"`
on the schema makes sending `"status": "PUBLISHED"` here a flat `422`. A job
can only change status through the dedicated publish/pause/close actions
below — never smuggled into a create or edit body.

---

## 2. `GET /employer/jobs` — list the organisation's jobs

**Auth required:** any employer role (Owner/Recruiter/Viewer) + active subscription.

**Request:** optional query params:

- `status`: one of `DRAFT`, `PUBLISHED`, `PAUSED`, `CLOSED`
- `q`: case-insensitive text matched against title and location
- `limit`: 1–100
- `cursor`: the opaque `next_cursor` returned by the preceding page

No body. Omit `cursor` for the first page. Sending the returned cursor is what
fetches the next page; the server does not preload or expose later rows.

**Response** — `200 OK`, a cursor `Page[JobListItem]`, newest first:

```json
{
  "items": [
    {
      "id": "...", "title": "Backend Engineer", "status": "PUBLISHED",
      "application_counts": {
        "total": 13,
        "by_stage": {
          "SUBMITTED": 4, "VIEWED": 3, "SHORTLISTED": 2, "INTERVIEW": 1,
          "DECISION": 1, "HIRED": 1, "REJECTED": 1, "WITHDRAWN": 0, "EXPIRED": 0
        }
      }
    }
  ],
  "next_cursor": "opaque-or-null",
  "total": null
}
```

Each item has every field of `JobResponse` from §1, **plus the job's pipeline
counts**. `next_cursor: null` means this is the last page. `total` is null
because the cursor controls need only the current page and whether another
page exists.

Only ever the caller's own organisation's jobs — there's no parameter that
could reach another tenant's.

**`by_stage` is where applications are now, not where they have been.**
Each application sits at exactly one stage, so the nine numbers sum to
`total`: someone shortlisted after being viewed is counted under
`SHORTLISTED` alone, not under both. If you want a funnel in the "reached
this stage at some point" sense, that is a different question and the data
for it is `application_events`, not this.

**Every stage is always present, zeros included** — you never have to tell
an absent key from an empty stage. `total` counts every application ever
filed on the job, withdrawn and expired ones as well.

**This is why the list gives you the counts rather than making you ask per
job.** The counts are one aggregate across the current page, so a jobs table
with a column per stage costs one request per page however many rows it shows.
Don't loop `GET /employer/applications?job_id=…` over the rows to build the
same numbers.

## 3. `GET /employer/jobs/{job_id}` — one job

**Auth required:** any employer role + active subscription.

**Request:** no body, `job_id` in the path.

**Response** — `200 OK`, a single `JobResponse` (same shape as §1, **without
`application_counts`** — that is on the list only). `404` (never `403`) for a
job belonging to another organisation.

## 4. `PATCH /employer/jobs/{job_id}` — edit

**Auth required:** Owner/Recruiter + active subscription. **Only works
while the job is `DRAFT` or `PAUSED`** — `409` on a published or closed job.
The reasoning: a live job that candidates are actively applying to must be
taken off the board (paused) *before* its terms change, so nobody applies
to a role whose salary range just moved under them.

**Request body** (`UpdateJobRequest`) — partial, at least one field, same
field names/rules as `CreateJobRequest` in §1, all optional:
```json
{ "salary_max_minor": 18000000, "min_score": 780 }
```
Fields that are *always required once present* (`title`, `description`,
`skills`, `salary_min_minor`, `salary_max_minor`) can be **omitted** to
leave unchanged, but if you name one, you may not send it as `null` — e.g.
`{"title": null}` is a `422`, because a job can never be titleless.

**Response** — `200 OK`, the updated `JobResponse`.

## 5. `GET /employer/jobs/threshold-preview` — "how many candidates clear this bar?"

**Auth required:** Owner/Recruiter + active subscription.

**Route order matters here**, worth calling out as a general FastAPI gotcha:
this is declared *before* `/{job_id}` in the code, because otherwise FastAPI
would try to parse the literal word `threshold-preview` as a `job_id` UUID
and fail with a `422` instead of ever reaching this handler.

**Request:** no body — `?min_score=750` as a query param (must be a multiple of 10).

**Response** (`ThresholdPreviewResponse`):
```json
{ "min_score": 750, "approximate_count": 40, "fewer_than_ten": false }
```

**Deliberately imprecise**, and this is a real anti-abuse measure, not
laziness: counts are rounded **down to the nearest ten**, and anything under
ten is only ever reported as `fewer_than_ten: true` with `approximate_count:
0`. An *exact* count (e.g. "1 candidate scores exactly 813") combined with
adjustable thresholds would let an employer binary-search their way to a
specific person's exact score without ever "revealing" them — a leak the
reveal's audit trail would never even see happen. This endpoint is also
rate-limited per organisation for the same reason.

---

## 6. Publish / pause / close — the job's lifecycle

```
DRAFT ──publish──▶ PUBLISHED ──pause──▶ PAUSED ──publish──▶ PUBLISHED
  │                    │                                        │
  └────close───────────┴───────────────close───────────────────┘
                                                                  ▼
                                                               CLOSED (final)
```

All three below share the same shape: **auth required** is Owner/Recruiter
+ active subscription, **request** is no body (just `job_id` in the path),
**response** is `200 OK` with the updated `JobResponse` (same shape as §1,
with `status` — and, for publish, `published_at` — now changed).

### `POST /employer/jobs/{job_id}/publish`

**This is invariant 8, enforced twice — once in the service, once by a
database trigger.** If the organisation's `kyb_status` isn't `APPROVED`,
this returns `403 kyb_required`, no matter what the application code does —
even a bug that skipped the service-level check would still be caught at
the database level, because the trigger doesn't trust the application to
have checked. Only once published does a job appear on the candidate board.

Response now has `"status": "PUBLISHED"` and `"published_at"` filled in.

### `POST /employer/jobs/{job_id}/pause`

Response now has `"status": "PAUSED"`. Reversible — `publish` again later
puts it straight back to `PUBLISHED`, no KYB re-check needed (already
verified once).

### `POST /employer/jobs/{job_id}/close`

Response now has `"status": "CLOSED"` and `"closed_at"` filled in. **Not
reversible** — `CLOSED` is a dead end in the state diagram above; there is
no "reopen" action.

---

## 7. The candidate's job board

### `GET /candidate/jobs` — search published jobs

**Auth required:** `CANDIDATE` role + active subscription (role checked
first, so an employer hitting this by mistake gets a plain `403`, not a
"please subscribe" message meant for candidates).

**Query params:** `q` (title/description search), `location`, `work_mode`,
`skill`, `min_salary_minor`, `eligible_only`, plus `cursor`/`limit` for
pagination (see [01-architecture.md](01-architecture.md) — cursor-based, not
offset, because offset pagination on a growing table skips/repeats rows).

**Response** — a `Page` of `BoardJobSummary`:
```json
{
  "items": [
    {
      "id": "...", "title": "Backend Engineer", "employer_name": "Acme Pvt Ltd",
      "skills": ["Python"], "location": "Bangalore", "work_mode": "HYBRID",
      "salary_min_minor": 8000000, "salary_max_minor": 15000000,
      "published_at": "...", "eligibility": "ELIGIBLE"
    }
  ],
  "next_cursor": null
}
```

**Notice what's missing: `min_score`.** The candidate never sees a job's
threshold — only `eligibility`, one of `ELIGIBLE` / `BELOW_THRESHOLD` /
`SCORE_PENDING`. Why the threshold itself is withheld: showing a candidate
"you need 750, you have 690" next to their own score hands them the exact
gap — which is the same "score is never explained" rule from the scoring
doc, just applying to a job's requirement instead of the score's own
breakdown. `eligibility` is computed against the candidate's **stored**
score — there's no way to pass a hypothetical score in and probe thresholds.

### `GET /candidate/jobs/{job_id}` — one job's full detail

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body, `job_id` in the path.

**Response** — `200 OK` (`BoardJobDetail` — everything `BoardJobSummary`
has, plus `description`):
```json
{
  "id": "7a1c...", "title": "Backend Engineer", "employer_name": "Acme Pvt Ltd",
  "description": "We're looking for someone who...",
  "skills": ["Python"], "location": "Bangalore", "work_mode": "HYBRID",
  "experience_min_months": 24,
  "salary_min_minor": 8000000, "salary_max_minor": 15000000,
  "published_at": "2026-09-17T10:00:00Z", "eligibility": "ELIGIBLE"
}
```
`404` for anything not currently on the board — a draft, a paused job, a
closed job, and "doesn't exist at all" are all indistinguishable from
outside, on purpose.

---

## 8. `GET /employer/discovery/candidates` — masked search

**Auth required:** **Owner or Recruiter only** (not Viewer — SRS 1.14.1
names exactly these two; a Viewer can read jobs/pipeline but candidate
search is the surface a bulk-extraction attempt would actually use, so it's
deliberately not widened past spec), plus an active subscription.

**Request:** no body — every filter is a query param, all optional: `band`
(up to 4 values), `skill` (up to a max count, every one given must match),
`badge`, `min_experience_years`, `state` (2-letter code), `city`, `q`
(matches against skills), `cursor`/`limit` for pagination.

**Response** — a `Page` of `MaskedCandidate`:
```json
{
  "items": [
    {
      "candidate_id": "9f2e...",
      "band": "SOLID",
      "experience_years": 3,
      "skills": ["Python", "PostgreSQL"],
      "badges": ["COURSE_COMPLETED"],
      "city": "Bangalore",
      "state_code": "KA"
    }
  ]
}
```

**This is the single most locked-down schema in the codebase.** `MaskedCandidate` has **no field** for a name, phone, email, or the exact score — not "left blank," structurally absent, `extra="forbid"` refuses one arriving, and a dedicated invariant test (`test_masked_candidate.py`) pins the exact field list so nobody can widen this card without a very visible test failure. Employers get the **band** (`ENTRY`/`DEVELOPING`/`SOLID`/`STRONG`), never the number.

Two more things worth noticing in the validators: `city` is re-checked here
(`looks_like_contact`) even though the candidate module already refused a
city containing digits or `@` on the way in — a second lock in case a row
reached the table some other way. And `skills` runs through
`displayable_skills`, which drops anything that looks like a phone number —
because skills are pulled from CVs, and a CV can absolutely contain a stray
phone number as "text near the top of the page."

**No `total` field anywhere in this response** — deliberate, since a total
candidate-pool count is itself a small information leak.

---

## 9. `GET /employer/discovery/candidates/{candidate_id}` — the reveal

**Mounted from the `candidate` module, not `discovery`** — worth explaining
why, because it's a good example of the import-boundary rules from
[01-architecture.md](01-architecture.md) actually shaping where code lives:
this response needs the candidate's *display score*, and `discovery` is
forbidden from importing `scoring` at all (the same "add-ons can never
import scoring" boundary, applied here to keep discovery from ever computing
or touching a score). So the route lives where it's allowed to reach both
`scoring` and the discovery checks.

**Auth required:** Owner/Recruiter + `require_active_access_window` — for an
employer, **the subscription itself IS the access window** (R14); this reads
the same row as the subscription check but fails with a different code
(`access_window_expired` instead of `subscription_required`), because the
user story is different: this employer *was* using the product a minute
ago and their period just lapsed, vs. never having paid at all.

**No request body** — just `candidate_id` in the path.

**What happens, in this exact order** (from `discovery.service.open_candidate`):
1. Organisation's KYB is approved? Else `403 kyb_required`.
2. **One person's burst limit** — a per-user Redis rate limit (`429 rate_limited`).
3. **The organisation's caps** — a rolling-hour and rolling-day limit on
   *distinct* candidates viewed, checked under a per-tenant advisory lock —
   **before** the candidate is even looked up. This order is deliberate: a
   capped organisation learns nothing, not even whether the id they tried
   corresponds to a real candidate.
4. Is this candidate visible to employers at all? (Suppressed by an
   unresolved integrity signal, no score yet, etc. → `404
   candidate_not_found` — never a 403, so a suppressed candidate looks
   identical to one that doesn't exist.)
5. **Only now**, in the same database transaction: a `candidate_view_events`
   row and an `audit_events` row are written, and any anomaly-threshold
   crossing is flagged. If any of these writes fail, the whole reveal rolls
   back — nothing is considered "shown" that wasn't also recorded.

**Response** — `200 OK` (`RevealedCandidate`):
```json
{
  "candidate_id": "9f2e...",
  "full_name": "John Doe",
  "phone": "+919876543210",
  "email": "john@example.com",
  "score": 812,
  "band": "SOLID",
  "experience_years": 3,
  "skills": ["Python", "PostgreSQL"],
  "badges": ["COURSE_COMPLETED"],
  "city": "Bangalore",
  "state_code": "KA"
}
```

**This is a genuinely different schema from `MaskedCandidate`, not the same
one with more fields filled in** — it's the *only* employer-facing response
in the whole codebase that's allowed to carry contact details at all. `score`
here is the **display** score (floored, same `display_value()` boundary as
the candidate's own `/candidate/score/me`) — there is no field anywhere for
the raw internal value.

**Re-opening the same candidate again is free** — it doesn't count against
the caps a second time, only the *first* view of a given candidate in the
window does. But it **still writes a fresh audit row every single time**,
re-opens included — invariant 7′: every look, not just the first one, is on
the record.

**Errors:**
| Code | When |
|---|---|
| `402 access_window_expired` | Subscription lapsed |
| `403 kyb_required` | Organisation not verified |
| `429 rate_limited` | Personal burst limit |
| `429 view_cap_reached` (`params.window`: `"hour"` or `"day"`) | Org-wide cap |
| `404 candidate_not_found` | Not visible, or genuinely doesn't exist — indistinguishable |

There's **no batch/list form of this endpoint, and there's not meant to
be one** — one candidate per call, always. Bulk export was explicitly
decided against as a feature, not merely unbuilt.

---

## 10. The candidate's own profile — what a masked card and the reveal are built from

`GET /candidate/profile`, `PUT /candidate/profile/location`, `PUT
/candidate/profile/name` — mounted from the `candidate` module (the same
module the reveal in §9 lives in), prefix `/candidate`. Three fields, and
they're exactly the ones you've already seen on `MaskedCandidate` (§8:
`city`, `state_code`) and `RevealedCandidate` (§9: those two plus
`full_name`) — this is where a candidate actually sets them. Nothing here
is paywalled: a lapsed subscriber loses access to *using* the product, not
the ability to keep their own details correct, same reasoning as reading or
withdrawing an application.

### `GET /candidate/profile` — read it back

**Auth required:** `CANDIDATE` role. **Request:** no body.

**Response** — `200 OK` (`CandidateProfileResponse`):
```json
{ "full_name": "John Doe", "city": "Bengaluru", "state_code": "KA", "updated_at": "2026-09-17T10:00:00Z" }
```
**Before anything has ever been saved, this returns `200` with every field
`null`** — not `404`. An empty profile is a normal state for a brand-new
candidate, not a missing resource.

### `PUT /candidate/profile/location` — set city / state

**Request body** (`LocationRequest`) — both fields optional and
independent, send `null` to clear either one on its own:
```json
{ "city": "Bengaluru", "state_code": "KA" }
```
`state_code` must be a real Indian state/UT code (`STATE_CODES`, from
`app.core.reference.INDIAN_STATES`) — anything else is `422`. `city` is
normalised (whitespace collapsed) and restricted to **letters (any script),
spaces, and `. ' -` only** — no digit, no `@`, `422 validation_error`
otherwise. That's not a typo-catcher, it's the same rule the masked-search
card enforces a second time on the way out (§8): a city is shown to *every*
employer who searches, so it must never be able to carry a phone number or
an email address. It's a city, not an address — no street, no locality, no
PIN code (a PIN code next to a band and a skill list narrows a masked card
to a handful of real people).

**Response** — `200 OK`, the updated `CandidateProfileResponse`. Reaches
masked search on the *next* query — search reads the profile live, nothing
is copied or cached anywhere in between.

### `PUT /candidate/profile/name` — set the display name

**Request body** (`NameRequest`):
```json
{ "full_name": "John Doe" }
```
Same alphabet rule as the city (letters/marks/spaces/`. ' -`, so "D'Souza"
and "राहुल शर्मा" are both valid, a phone number is not), 1–200 characters
after whitespace collapsing. `422` otherwise.

**Response** — `200 OK`, the updated `CandidateProfileResponse`.

**Why this exists at all, and why it's asked rather than parsed off a CV:**
nothing else in the system stores a candidate's name — a resume is kept as
extracted *content*, not identity, and a name is never guessed from it
(invariant-adjacent: the resume module has no name field that scoring or
anyone else can read as "the" name). This is asked directly at sign-up for
exactly that reason. It's also never shown on a masked search card, only
once revealed (§9) — `full_name` in `RevealedCandidate` falls back to
whatever was typed on the structured resume form for anyone who signed up
before this endpoint existed, but this is what every new candidate sets.

---

## Quick reference: who can see what

| | Masked search card | The reveal | A job's applicant |
|---|---|---|---|
| Name/phone/email | ❌ never | ✅ | (Day 12 pipeline — separate doc) |
| Exact score | ❌ never | ✅ (display value) | — |
| Band | ✅ | ✅ | — |
| Costs a "view" / counted against caps | No | Yes (first open only) | — |
| Audited | No | Yes, every open | — |
