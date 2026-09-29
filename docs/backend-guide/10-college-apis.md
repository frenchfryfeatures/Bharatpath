# 10 — College: seats, referral codes, roster, consent, students

The college side, minus the organisation/team signup already covered in
[03-login-signup-apis.md](03-login-signup-apis.md#6-college-signup--team)
(same pattern, `COLLEGE_ADMIN`/`COLLEGE_STAFF`). This doc covers everything
that happens *after* a college exists: onboarding, seats, getting students
linked (referral codes and roster imports), the student's own side of
consent, and what a college is finally allowed to see. 23 endpoints across
two surfaces: `/college/*` (the college's) and `/candidate/colleges/*` (the
student's).

---

## 0. The big picture — how a student actually ends up "at" a college

```
COLLEGE SIDE                              STUDENT SIDE
─────────────                             ────────────
Onboarding (a form, like KYB's)
        │
Two ways to get a student connected:
  (a) Issue a referral code            → student enters the code themselves
      (a password to hand out)              POST /candidate/colleges/link
  (b) Upload a roster CSV                     │
      → preview → commit → send            (b) student is sent an invitation
              invitations                       from their own recognised
                                                 phone/email
                                                 GET  .../invitations
                                                 POST .../invitations/{id}/accept
        │                                        │
        └────────────── either way ──────────────┘
                            │
                            ▼
              Student now has a ROSTER-scope link.
              College can COUNT them (aggregate analytics),
              cannot see their name.
                            │
                  (a separate, later choice)
                            ▼
       POST /candidate/colleges/{college_id}/individual-visibility
                            │
                            ▼
         College can now see this ONE student BY NAME,
         through GET /college/students — audited every time.
```

**Two consent scopes, and they are not the same act, ever:**

| Scope | What it means | How it's granted |
|---|---|---|
| `ROSTER` | The college can **count** this student in aggregate numbers. Never sees their name. | Entering a referral code, or accepting an invitation |
| `INDIVIDUAL` | The college can see **this specific student, by name**, through `/college/students`. | A **separate**, explicit grant — never implied by `ROSTER` |

**Why they're kept apart:** a student joining their college's roster (so the
college can see "our average score is X") is a completely different act of
trust from letting one specific staff member look up their name and
application history. Bundling them would mean a student who just wants to
be *counted* accidentally also becomes *individually visible*.

**A student never binds the college's tenant.** Every route on
`/candidate/colleges/*` binds only the student's own identity
(`app.user_id`) — a code or an invitation *names* a college, but nothing
about linking hands the student's session that college's tenant id. This
matters because it's exactly the SRS 2.24.7 rule from
[01-architecture.md](01-architecture.md) applied here: a tenant id never
comes from client input, even indirectly through "which college's code did
you type."

---

## 1. Onboarding — `GET /college/onboarding`, `PUT .../answers`, `POST .../submit`

Same shape as KYB's form ([07](07-kyb-apis.md)) — a published, data-driven
form rather than a hardcoded client screen, saved incrementally, validated
fully only at submit.

**`GET /college/onboarding`** — **Auth:** any college role. Returns the
form definition, its dropdown options, and whatever's saved so far
(`OnboardingResponse`):
```json
{
  "form": { "sections": [ /* like KYB's */ ] },
  "options": { "reference.INDIAN_STATES": [{ "code": "KA", "label": "Karnataka" }] },
  "answers": {},
  "form_version": null,
  "submitted_at": null
}
```

**`PUT /college/onboarding/answers`** — **Auth:** `COLLEGE_ADMIN` only.
Request: `{ "answers": { "affiliation": "AUTONOMOUS" } }` — partial save.
`422` lists every malformed answer. `409` once already submitted (no
editing after the fact).

**`POST /college/onboarding/submit`** — **Auth:** `COLLEGE_ADMIN` only. No
body. `422` lists everything still missing. Idempotent — submitting an
already-submitted form just returns its current state.

---

## 2. `GET /college/seats` — how many students the college can carry

**Auth required:** any college role.

**Request:** no body.

**Response** — `200 OK` (`SeatsResponse`):
```json
{ "seats_allocated": 500, "seats_used": 312, "seats_available": 188, "subscription_active": true }
```
**Counts only — never *which* students hold a seat.** `seats_allocated` is
set by BharatPath's own staff (no public route grants seats to a college;
that's an internal action), not something a college can raise itself.
`subscription_active: false` means seats exist on paper but grant nobody
access right now — a seat only works while the college's own subscription
is in period.

---

## 3. Referral codes — the "hand out a password" way in

### `POST /college/referral-codes` — issue one

**Auth required:** `COLLEGE_ADMIN` + active subscription (issuing is
paywalled — it's how students reach the product, which is exactly the kind
of action R13 gates).

**Request body** (`IssueCodeRequest`):
```json
{ "expires_in_days": 90, "max_uses": 200 }
```
Both optional (default 90-day expiry, unlimited uses if `max_uses` omitted).

**Response** — `201 Created` (`ReferralCodeResponse`):
```json
{ "id": "...", "code": "ABCD-EFGH-JKMN", "state": "ACTIVE", "uses": 0, "max_uses": 200, "expires_at": "...", "revoked_at": null, "created_at": "..." }
```
**Treat this code like a password, not a link** — anyone holding it can
link themselves to this college. It always expires; there's no
never-expiring option.

### `GET /college/referral-codes` — list them

**Auth required:** any college role (reading is free, not paywalled — only
issuing is).

**Request:** no body. **Response:** array of `ReferralCodeResponse`, newest
first.

### `POST /college/referral-codes/{code_id}/revoke`

**Auth required:** `COLLEGE_ADMIN`. **Not paywalled, deliberately** —
revoking a leaked code must never wait on a subscription payment.

**Request:** no body. **Response:** updated `ReferralCodeResponse`,
`state: "REVOKED"`. Stops new links immediately; **students already linked
through it stay linked** — revoking a code doesn't retroactively unlink
anyone. Idempotent.

---

## 4. Roster imports — the "upload a CSV" way in

A four-stage pipeline: **upload → (review) → commit → send.** Nothing is
sent to a single student until commit — an upload is just a preview.

### `POST /college/roster-imports` — upload and preview

**Auth required:** any college role + active subscription.

**Request body** (`RosterUploadRequest`):
```json
{ "file_name": "cohort_2026.csv", "csv": "name,phone,email,student_ref\nJohn Doe,+919876543210,,STU001\n..." }
```
Header row must have `name`, `phone`, `email`, `student_ref` — **phone or
email is required per row**, other columns are ignored (and listed back so
nothing silently vanishes without the college knowing).

**Response** — `201 Created` (or `200` if this exact file was already
uploaded — idempotent by content) (`RosterImportResponse`):
```json
{
  "id": "...", "file_name": "cohort_2026.csv", "state": "PREVIEW",
  "total_rows": 500, "valid_rows": 480, "invalid_rows": 15, "duplicate_rows": 5,
  "ignored_columns": ["department"], "created_at": "...", "committed_at": null,
  "invitations": { "pending": 0, "sent": 0, "accepted": 0, "declined": 0, "expired": 0 }
}
```
`422 roster_*` only when the file itself is unusable (unreadable, no header
row) — a row with bad data doesn't fail the whole upload, it just gets
counted under `invalid_rows` and can be inspected via §4's row-listing
endpoint.

### `GET /college/roster-imports` and `GET .../roster-imports/{import_id}`

**Auth required:** any college role. No body. List: array of
`RosterImportResponse`, newest first. Single: one, `404` outside this
college.

### `GET /college/roster-imports/{import_id}/rows` — inspect before committing

**Auth required:** any college role. **Request:** optional
`?row_state=INVALID` filter, `cursor`/`limit` for pagination.

**Response** — `200 OK` (`RosterRowsPage`):
```json
{
  "items": [
    { "row_number": 3, "full_name": "Jane Roe", "phone": null, "email": null, "student_ref": "STU003", "row_state": "INVALID", "issues": ["missing_phone_or_email"], "invite_state": null }
  ],
  "next_cursor": null
}
```
This is the screen a college admin uses to actually see *why* 15 rows were
invalid, before deciding whether to fix the CSV and re-upload or just
commit what's valid.

### `POST /college/roster-imports/{import_id}/commit` — make it real

**Auth required:** any college role + active subscription.

**Request:** no body. **Response:** updated `RosterImportResponse`,
`state: "COMMITTED"`, `committed_at` filled in, rows now counted under
`invitations.pending`.

**What actually happens:** every valid, non-duplicate row becomes a
committed roster entry (an invitation *waiting to be sent*, not sent yet).
Duplicates are **re-checked against the live roster as it stands right
now** — not against the stale preview from upload time — because another
import could have added the same student in between. Rows that won't be
invited (the invalid/duplicate ones) are deleted at commit, not kept
around. `409` if this import was already discarded.

### `POST /college/roster-imports/{import_id}/discard`

**Auth required:** any college role. **Not paywalled** — discarding a bad
preview must never require payment, mirroring the referral-code revoke
rule. **Request:** no body. `409` once already committed — you can't
discard something that's already gone live.

### `POST /college/roster-imports/{import_id}/invitations/send`

**Auth required:** any college role + active subscription.

**Request:** no body.

**Response** — `200 OK` (`InvitationsSentResponse`):
```json
{ "sent": 480, "invitations": { "pending": 0, "sent": 480, "accepted": 0, "declined": 0, "expired": 0 } }
```
Marks each pending invitation `SENT` and queues actual delivery. **Worth
being upfront about: SMS and email delivery for this are not live yet**
(the DLT-registered template and email sending infrastructure aren't wired
in this build) — the invitation exists and is visible to the student inside
the app regardless (matched against *their own verified* phone/email, never
by a college seeing "this matched"), but the notification nudging them to
check isn't sent yet.

---

## 5. The student's side — `/candidate/colleges/*`

**None of this is paywalled.** Linking is how a seated student gets access
to the product at all — gating it behind a subscription would mean paying
for the thing their college already paid for.

### `GET /candidate/colleges/consent-terms?scope=ROSTER`

**Auth required:** `CANDIDATE`. **Request:** query param `scope`
(`ROSTER` default, or `INDIVIDUAL`). **Response** (`ConsentTermsResponse`):
```json
{ "consent_version": "placeholder-1", "scope": "ROSTER", "key": "college.consent.roster", "text": "By entering this code, you agree your college may count you..." }
```
Meant to be shown **before** the student links or grants visibility — the
`consent_version` returned here is exactly what must be sent back with the
actual action (§5.2, §5.6), so a stale version (terms changed since the
screen was shown) is refused rather than silently accepted.

### `GET /candidate/colleges` — the student's own links

**Auth:** `CANDIDATE`. No body. Response: array of `CollegeLinkResponse`:
```json
[{ "college_id": "...", "college_name": "IIT Example", "scope": "ROSTER", "granted_via": "REFERRAL_CODE", "granted_at": "...", "revoked_at": null, "seat_held": true }]
```

### `POST /candidate/colleges/link` — enter a code

**Request body** (`LinkByCodeRequest`):
```json
{ "code": "ABCD-EFGH-JKMN", "consent_version": "placeholder-1" }
```
**Response** — `201` (or `200` if already linked) `CollegeLinkResponse`.
**Entering the code IS the consent** — no separate confirmation click.

**Errors:** `422 referral_code_invalid` covers every kind of bad code
(expired, revoked, exhausted, doesn't exist) — **one code for all of them**,
so a student fishing for valid codes learns nothing about *why* one
failed. `409 consent_version_outdated` if the terms shown are stale. `429`
after too many attempts (a code-guessing throttle).

### `GET /candidate/colleges/invitations` and accept/decline

**`GET`** — **Auth:** `CANDIDATE`. Lists invitations addressed to *this
student's own verified* phone/email (`CandidateInvitationResponse`):
```json
[{ "id": "...", "college_name": "IIT Example", "sent_at": "...", "expires_at": "..." }]
```

**`POST .../invitations/{id}/accept`** — body `{ "consent_version": "..." }`
— same consent semantics as linking by code. `404` if not addressed to this
student, expired, or already declined.

**`POST .../invitations/{id}/decline`** — no body, `204 No Content`.

### `POST /candidate/colleges/{college_id}/individual-visibility` — the separate, bigger grant

**Request body** (`GrantIndividualVisibilityRequest`):
```json
{ "consent_version": "placeholder-2-2026-09-29" }
```
(A *different* consent text/version than `ROSTER` — always
`GET .../consent-terms?scope=INDIVIDUAL` first.)

**Version 2 (2026-09-29) shows the college more** — sign-up details
including phone and email, the CV, practice interviews, course progress, each
application's stage — and its words say so. A student who agreed to version
1 keeps version 1's narrower view until they call this again with version 2,
which **replaces** their old grant (the old row is revoked, a new one
written) rather than returning it.

**Response** — `201` (or `200` if already granted) `CollegeLinkResponse`,
now `scope: "INDIVIDUAL"`. `404 college_link_not_found` if there's no live
`ROSTER` link to upgrade — **individual visibility can never exist without
roster consent underneath it**, by a database-level check, not just an API
convention.

### `POST /candidate/colleges/{college_id}/revoke` — withdraw consent

**Request body** (`RevokeConsentRequest`):
```json
{ "scope": "ROSTER" }
```
**Response** — `200 OK` (`RevokeConsentResponse`):
```json
{ "college_id": "...", "revoked": ["ROSTER", "INDIVIDUAL"], "revoked_at": "..." }
```
**Revoking `ROSTER` takes `INDIVIDUAL` with it in the same action** — you
can't stay individually visible to a college you've disconnected from
entirely, so the response's `revoked` array can show both scopes ending
from a single `ROSTER` revoke. Revoking `INDIVIDUAL` alone leaves the
`ROSTER` link (and any seat) intact — the student is still counted, just no
longer named. **Takes effect on the very next request anyone makes** —
never cached. `404 college_link_not_found` for a college never linked to;
otherwise idempotent.

---

## 6. What a college finally gets to see — `GET /college/students`, `GET /college/students/{id}`

**Auth required, both:** any college role + active subscription (paid, like
the analytics beside it).

### `GET /college/students` — list

**Request:** `cursor`/`limit`. **Response** — `200 OK` (`VisibleStudentsPage`):
```json
{ "items": [{ "candidate_id": "9f2e...", "full_name": "John Doe", "visible_since": "2026-09-10T..." }], "next_cursor": null }
```
**Only students with a currently-live `INDIVIDUAL` consent appear here at
all** — a `ROSTER`-only student (the overwhelming majority, in practice) is
invisible to this endpoint entirely; they're counted only in aggregate
analytics ([11](11-college-analytics-apis.md)), never named. **Every page
read of this list is audited**, not just opening one student.

### `GET /college/students/{candidate_id}` — open one

**Response** — `200 OK` (`CollegeStudentResponse`):
```json
{
  "candidate_id": "9f2e...", "full_name": "John Doe", "visible_since": "2026-09-10T...",
  "score": 812, "band": "SOLID", "scored_at": "...",
  "applications": 4, "interviews": 1,
  "hires": [{ "job_title": "SDE-2", "employer_name": "Acme Pvt Ltd", "hired_at": "...", "source": "PLATFORM" }]
}
```
`404 college_student_not_found` unless the consent is live **right now** —
checked live, not cached, so a student who just revoked disappears on the
very next request, same as the reveal in
[05](05-jobs-and-discovery-apis.md). **Every open is audited, re-opens
included** — same invariant as the employer reveal. `hires[].source` is
always `"PLATFORM"` — a hire made outside BharatPath entirely is never
attributed to it here.

**This field list is exactly what it is and no more** — an invariant test
pins it, because widening it (adding a phone number, say) is a decision for
counsel and the client about what "letting a college see you by name"
actually means, not a casual API change. When the client did widen it
(2026-09-29), it went into the two endpoints below, behind a new consent
version, and this one stayed as it was.

### `GET /college/students/{candidate_id}/details` — everything consent version 2 names

**Auth:** any college role + paid. **Response** — `200 OK`:
```json
{
  "candidate_id": "9f2e...", "consent_version": "placeholder-2-2026-09-29",
  "email": "ravi@example.com", "phone": "+919876543210",
  "city": "Pune", "state_code": "MH", "locale": "hi",
  "questionnaire": [
    { "code": "SHIFT_WILLINGNESS", "question": "Which shifts could you work?", "answer": "Night shift" }
  ],
  "questionnaire_submitted_at": "...",
  "resume_confirmed_at": "...", "has_resume_file": true,
  "interviews_completed": 2,
  "courses": [
    { "code": "COURSE_RESUME_FOUNDATION", "title": "Presenting Your Work", "purchased_at": "...",
      "lessons_total": 6, "lessons_completed": 3, "percent_complete": 50, "completed_at": null }
  ],
  "applications": [
    { "job_title": "Warehouse Supervisor", "employer_name": "Acme Pvt Ltd", "job_location": "Pune",
      "stage": "INTERVIEW", "applied_at": "...", "updated_at": "..." }
  ],
  "analytics": { "total": 1, "open": 1,
    "by_stage": { "SUBMITTED": 0, "VIEWED": 0, "SHORTLISTED": 0, "INTERVIEW": 1, "...": 0 },
    "reached": { "SHORTLISTED": 1, "INTERVIEW": 1, "DECISION": 0, "HIRED": 0 } }
}
```
- `409 college_student_details_not_shared` — the student lets you see them,
  but under version 1, which did not include this. Only they can agree to
  version 2. `404` without live consent at all.
- The questionnaire never includes the free-text accessibility answer: its
  own help text promises it only to employers the student applies to.
- Read through consent-joined database functions, like everything a college
  sees (invariant 9), and audited on every open.

### `GET /college/students/{candidate_id}/resume` — the CV

**Response** — `200 OK`: `{ "confirmed_at", "source", "text", "fields",
"file_url", "file_mime" }` — the confirmed CV the score was built from, as
text (or a form-built CV's fields), and the uploaded file by a presigned GET
that expires. Same consent rule and `409` as `/details`;
`404 college_student_resume_not_found` before there is one. Its own audit row
(`college_student_resume_opened`), because a CV is a bigger reveal than the
profile.

---

## Quick reference

| Who acts | Paywalled? | Endpoints |
|---|---|---|
| College reads (org, seats, codes list, imports list/rows, onboarding) | No | Free to view |
| College issues/commits/sends (codes, roster commit, send invites) | **Yes** | Reaching students costs money |
| College revokes/discards (code revoke, import discard) | No | Stopping something is never gated |
| Student links, consents, revokes | No | Never paywalled, by decision |
| College reads students (list/open, details, CV) | **Yes** | Same gate as analytics |
