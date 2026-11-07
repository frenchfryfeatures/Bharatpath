# 04 — Resume & Score APIs: input/output reference

This is the core loop of the whole product: a candidate gets a CV into the
system, reviews what was read from it, confirms it, and — only then — a score
appears. Read [01-architecture.md](01-architecture.md) first for the general
module shape; this doc covers `resume` (9 endpoints) and `scoring`
(1 endpoint).

---

## 0. The big picture — three ways in, one gate, one trigger

There are **three different ways** a CV's content can get into the system:

| Way | Endpoint | When used |
|---|---|---|
| Upload a file | `POST /candidate/resume/uploads` → `.../complete` | Candidate has a PDF/DOCX |
| Paste text | `POST /candidate/resume/text` | Candidate has no file, just text |
| Fill a form | `POST /candidate/resume/manual` | Candidate has neither |

**All three roads lead to the same place: an unconfirmed "resume version."**
None of them produce a score by themselves. Every version — however it was
created — must pass through the same **review → confirm** step before
scoring will ever touch it. That's the single most important rule in this
whole module, so the full sequence for the *upload* path (the longest one)
looks like this:

```
1. POST /candidate/resume/uploads
      → backend hands back a presigned S3 URL. Nothing saved in the DB yet.
2. App uploads the raw file bytes DIRECTLY to S3 using that URL
      → our backend is not even involved in this step.
3. POST /candidate/resume/uploads/{upload_id}/complete
      → NOW a `resume_files` row is created. Backend re-checks the file
        itself (size, type) from S3 — never trusts what the client claims.
        Kicks off a virus scan and queues parsing. Returns 202 (queued).
4. App polls: GET /candidate/resume/files/{resume_file_id}
      → until parse_status is DONE (or FAILED/BLOCKED)
5. Parsing finishes → a `resume_version` row now exists, UNCONFIRMED.
6. GET /candidate/resume/versions/{resume_version_id}
      → "the review screen." Shows exactly what was extracted.
7. Candidate looks at it. Two branches:
      a) Looks right  → POST /candidate/resume/versions/{id}/confirm
      b) Something's wrong → POST /candidate/resume/versions/{id}/edit
                              → creates a NEW unconfirmed version, back to step 6
8. Confirm succeeds → an event fires → a background worker scores it
9. GET /candidate/score/me
      → PENDING at first, then READY once the worker finishes
```

**Paste-text and manual-form skip steps 1–5** (no file, no scan, no async
parsing — the version is created directly, already sitting at step 6/7),
but they still go through review → confirm exactly the same way. There is
**no path, of any kind, that reaches a score without passing through
confirm.**

### Why review-then-confirm exists at all

Resume parsing is not perfectly accurate — a two-column layout, a scanned
photo, a borderless table can all produce text that reads as plausible but
is wrong, in a way only the candidate themself can catch. Attaching a score
to that without the candidate having seen it first would mean scoring
garbage silently. So the system makes it structurally impossible to skip:
`resume.service.get_scorable_version` — the only function scoring is allowed
to read through — filters with `WHERE confirmed_at IS NOT NULL` at the SQL
level. An unconfirmed version isn't "hidden," it's **never loaded** by
anything that scores.

### Why confirming triggers scoring through an *event*, not a direct call

`confirm_version()` doesn't call the scoring code. It emits an event,
`resume.version_confirmed`, onto an outbox, and a routing table
(`app/tasks/routing.py`) says what happens next:

```python
EVENT_SUBSCRIPTIONS = {
    "resume.version_confirmed": (SCORE_RESUME_TASK,),   # ← only this event
    ...
}
```

The obvious-looking alternative — trigger scoring when a version is
*created* — is explicitly wrong and explicitly tested against
(`tests/invariants/test_confirm_gate.py`): a version is created on **every**
parse and **every** correction, confirmed or not, so wiring scoring to
creation would score content the candidate never approved, while every other
test in the app kept passing. The confirm gate would still exist in the code
— it just would never be called. Subscribing to the *confirmed* event
specifically is what makes the gate actually load-bearing.

---

## 1. `POST /candidate/resume/uploads` — start a file upload

Requires: `CANDIDATE` role.

**No request body.**

**Response** — `201 Created` (`UploadTicketResponse`):
```json
{
  "upload_id": "9f2e...",
  "url": "https://s3.../presigned-put-url...",
  "method": "PUT",
  "expires_in_seconds": 900,
  "max_bytes": 10485760,
  "accepted_types": ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
}
```

**Nothing is written to the database at this point** — deliberately. If the
upload never happens or fails partway, there's no half-finished row to clean
up; the object just expires from S3 on its own.

**What the app does next:** `PUT` the raw file bytes straight to `url`, not
to our backend. There's also no `key` field in this response — the object's
S3 path is derived server-side from the caller's own id, so a client can
never write into another candidate's storage prefix even if it tried.

---

## 2. `POST /candidate/resume/uploads/{upload_id}/complete`

Requires: `CANDIDATE` role.

**Optional request body** (`UploadCompleteRequest`, since 2026-10-22):
```json
{ "filename": "Priya Sharma CV.pdf" }
```
Send the name the file had on the device. It labels the file in the
candidate's history (§6b) and nothing else reads it: the key and the type
are still the server's. It is cut to a display name (last path segment, no
control characters, at most 255 characters). Sending no body is still
accepted, and the file is listed with `filename: null`. A retry does not
rename the file.

**Response** — `202 Accepted` (`UploadCompleteResponse`):
```json
{ "resume_file_id": "9f2e...", "scan_status": "PENDING", "parse_status": "QUEUED" }
```

**What happens on the backend, in order:**
1. Re-derives the expected S3 key from *the authenticated user*, not from
   anything the client sent.
2. Reads the actual file size from S3 (never trusts a client-reported size).
3. Reads the first few bytes and **sniffs the real file type** from content,
   not from the filename or a claimed `Content-Type`.
4. If it fails any check → the object is deleted from S3 immediately (no
   reason to keep personal data we're about to reject) and this returns an
   error, never a row.
5. If it passes → kicks off a virus scan, creates the `resume_files` row,
   and queues parsing as a background job.

**202, not 200 or 201:** parsing hasn't happened yet — this only confirms
the file was accepted for processing.

**Idempotent:** calling this twice for the same `upload_id` doesn't create a
second row or re-queue anything — it just returns that row's current state.

---

## 3. `GET /candidate/resume/files/{resume_file_id}` — poll for parse result

Requires: `CANDIDATE` role. The app calls this repeatedly after step 2 until
parsing settles.

**Response** — `200 OK` (`ResumeFileStatusResponse`):
```json
{
  "resume_file_id": "9f2e...",
  "scan_status": "CLEAN",
  "parse_status": "DONE",
  "parse_error_code": null,
  "terminal": true,
  "uploaded_at": "2026-09-17T10:00:00Z",
  "resume_version_id": "3a1c...",
  "filename": "Priya Sharma CV.pdf"
}
```
| Field | Meaning |
|---|---|
| `scan_status` | Virus scan result — separate from parsing because they fail differently and the candidate can only act on one of them. |
| `parse_status` | `QUEUED` → `DONE` / `FAILED` / `BLOCKED`. |
| `terminal` | **Stop polling when this is `true`** — not when `resume_version_id` appears. A `FAILED` parse never produces a version, so polling for a version on a failed parse waits forever. |
| `resume_version_id` | Only present once parsing succeeded — this is what you fetch next. |

404, never 403, for a file belonging to someone else — existence of another
candidate's row is never confirmed.

---

## 3b. `POST /candidate/resume/intake` — one-shot upload during onboarding

Requires: `CANDIDATE` role. Not paywalled. The sign-up flow's way in
([`student-career-onboarding.md`](../student-career-onboarding.md)): the file
read before the account existed (`POST /auth/resume-preview`, [03](03-login-signup-apis.md))
is sent again once the person is signed in, and is stored this time.

Unlike steps 1–3 it is **one synchronous request**: the bytes go to the API,
not to a presigned URL, and the answer is the new version, with no polling
and no worker.

**Request:** `multipart/form-data`, one part `file` (PDF or `.docx`, at most
10 MB, sniffed from the bytes).

What the server does, in order: validates the type, reads the text locally
(**no Textract** on this path), stores the original in the resumes bucket,
virus-scans it, writes the structured display view (best effort), then the
`resume_files` and `resume_versions` rows, and emits `resume.version_created`.

**Response** — `201 Created` (`ResumeVersionResponse`):
```json
{ "resume_version_id": "3a1c...", "source": "UPLOAD", "confirmed": false, "created_at": "2026-10-13T09:00:00Z" }
```
**`confirmed: false`, and nothing is scored.** The version goes through the
same review and confirm gate (§7, §9) as every other.

**Errors:** 422 with `upload_empty`, `upload_too_large`,
`upload_unrecognised_type`, `upload_legacy_doc_unsupported` or
`upload_unsupported_type` (and `params.detail`); 422 `resume_scan_blocked`
when the scan refuses the file (the stored object is deleted).

---

## 4. `POST /candidate/resume/text` — paste-text path

Requires: `CANDIDATE` role. No file, no scan, no async wait.

**Request body** (`PasteTextRequest`):
```json
{ "text": "John Doe\nSoftware Engineer at Acme...\n(at least 50 characters)" }
```
`text` must be ≥50 characters *after* whitespace normalisation — and that
normalisation happens **once, here, at write time, forever**. Why it can
never be re-normalised later: a score must be reproducible from exactly what
was stored (invariant 1) — if the normalisation rule changed later and was
re-applied, the same stored row could yield a different score on replay.

**Response** — `201 Created` (`ResumeVersionResponse`):
```json
{ "resume_version_id": "3a1c...", "source": "PASTE", "confirmed": false, "created_at": "..." }
```
Straight to `201`, not `202` — there's nothing asynchronous to wait for. This
version is already reviewable (skip to step 6 below).

---

## 5. `POST /candidate/resume/manual` — structured form path

Requires: `CANDIDATE` role. For a candidate with no document at all.

**Request body** (`ManualResumeRequest`):
```json
{
  "full_name": "John Doe",
  "headline": "Backend Engineer",
  "experience": [
    { "employer": "Acme Corp", "title": "SDE-2", "start_year": 2021, "end_year": null, "summary": "..." }
  ],
  "education": [
    { "institution": "XYZ University", "qualification": "B.Tech CSE", "completed_year": 2020 }
  ],
  "skills": ["Python", "PostgreSQL"]
}
```
**Notice what's absent: no date of birth, no age, anywhere.** That's not an
oversight — invariant 5 forbids age-gating entirely, and
`scripts/check_no_age_fields.py` fails the CI build if a field like that is
ever added. `end_year` must not be before `start_year` (validated).

**Response:** same `ResumeVersionResponse` shape as the paste-text path,
`source: "MANUAL"`.

> **The resume builder** (2026-10-13) is the fuller way to make a resume
> without a file: four templates, a draft filled in from the onboarding
> answers, a PDF download. Its versions have `source: "BUILDER"` and carry
> the PDF as their file. See [18](18-resume-builder-apis.md).

---

## 6. `GET /candidate/resume/versions` — the version list

Requires: `CANDIDATE` role. Lists every version this candidate has ever
created, **newest first, no content** — just enough for a history screen
(dates, confirmed/not, which one replaced which).

**Response** — `200 OK`, array of `ResumeVersionSummary`:
```json
[
  {
    "resume_version_id": "3a1c...", "source": "EDIT", "confirmed": true,
    "confirmed_at": "2026-09-17T11:00:00Z", "supersedes_id": "9f2e...",
    "superseded": false, "created_at": "2026-09-17T10:55:00Z",
    "resume_file_id": "9f2e...", "filename": "Priya Sharma CV.pdf",
    "current": true
  }
]
```
`superseded: true` means a *newer* version has replaced this one — a
superseded version can no longer be edited or confirmed (it's frozen
history at that point).

**`current` is the version being scored:** the newest confirmed one,
whichever chain it is in. At most one is `true`, and none before anything
is confirmed. **Use it to pick the resume to show. Don't infer it from
`confirmed && !superseded`.** A builder push starts a chain of its own,
so after one is confirmed, two versions are confirmed and unsuperseded at once.

`resume_file_id` is the document the version was read from or drawn as.
Corrections carry it forward, so versions sharing one are the same resume.
`filename` is that document's name (§2), or `null`.

---

## 6b. `GET /candidate/resume/files` — the uploaded-resumes history

Requires: `CANDIDATE` role. Added 2026-10-22. **One row per document,
newest first.** That covers each upload and each PDF the resume builder drew
when the candidate pushed. An upload and its corrections are one row. An
upload that failed or was blocked is listed too, with no version, so the
history shows that it did not work. At most 50.

**Response** — `200 OK`, array of `ResumeFileSummary`:
```json
[
  {
    "resume_file_id": "9f2e...", "filename": "Priya Sharma CV.pdf",
    "origin": "UPLOAD", "mime": "application/pdf", "size_bytes": 84211,
    "uploaded_at": "2026-10-20T09:12:00Z", "scan_status": "CLEAN",
    "parse_status": "DONE", "parse_error_code": null, "terminal": true,
    "latest_version_id": "3a1c...", "confirmed": true, "current": true
  }
]
```
| Field | Meaning |
|---|---|
| `origin` | `UPLOAD` (a file the candidate sent) or `BUILDER` (the builder's PDF). Filter on it for an "uploaded files only" list. |
| `latest_version_id` | The newest version made from this file: the upload, or the latest correction of it. Open it with §7 and its file with §7b. `null` when the file was never read. |
| `confirmed` | That newest version is confirmed. |
| `current` | This file holds the version being scored now. At most one row. |
| `filename` | As sent in §2. `null` for uploads from before 2026-10-22. |

There is no "restore an older resume" action. Making an older CV the
scored one again would be a new version and a re-score, which is a product
decision that hasn't been taken. Today the candidate uploads it again.

---

## 7. `GET /candidate/resume/versions/{resume_version_id}` — the review screen

Requires: `CANDIDATE` role. **This is the only endpoint in the entire module
that returns the full extracted content.** Everything else deliberately
withholds it (see §6's list, which shows only metadata).

**Response** — `200 OK` (`ResumeVersionDetailResponse`):
```json
{
  "resume_version_id": "3a1c...",
  "source": "UPLOAD",
  "parsed": {
    "full_name": "John Doe",
    "experience": [ ... ],
    "education": [ ... ],
    "skills": [ ... ],
    "extractor": { "parser": "pypdf", "parser_version": "4.2.0" }
  },
  "confirmed": false,
  "confirmed_at": null,
  "supersedes_id": null,
  "superseded": false,
  "created_at": "..."
}
```
`parsed` includes an `extractor` provenance block — *which* parser produced
this text and what version. That's not bookkeeping: a different parser
produces different text and therefore a legitimately different score, so a
future dispute or re-score needs to know exactly which engine read this CV.

**This is the exact content that gets scored if confirmed** — so this
response is what makes confirming an informed decision, not a blind button
press.

---

## 7b. Seeing the CV as it was sent — `/preview` and `/document`

Both require the `CANDIDATE` role and answer only for the caller's own
versions (another candidate's version is `404 resume_version_not_found`).
Neither is paywalled and neither depends on the confirm gate: they show the
person their own CV during onboarding, before they have paid.

### `GET /candidate/resume/versions/{resume_version_id}/preview`

The in-app CV viewer. **A PDF is drawn on the server**, so no third-party
viewer ever receives the CV or a link to it.

**Response** — `200 OK`:
```json
{
  "pages": ["iVBORw0KGgoAAAANSUhEUgAA..."],
  "text": "",
  "truncated": false,
  "structured_resume": { "...": "the model's display view, as on the review screen" },
  "structured_status": "READY"
}
```
| Field | Meaning |
|---|---|
| `pages` | An uploaded **PDF**: each page as a base64 PNG (no `data:` prefix), at most 20 pages. Empty for anything else. |
| `text` | A `.docx` upload, pasted text or the manual form: the readable text. Empty when `pages` is filled. |
| `truncated` | `true` when the PDF has more than 20 pages. |
| `structured_resume`, `structured_status` | The structured display view (never scored), or `null`. Status `READY`, `FAILED` (the model could not write it) or `UNAVAILABLE` (no model configured, or a version from before 2026-10-06). |

Errors: `404 resume_version_not_found`, `404 resume_upload_not_found` (the
file row is gone).

### `GET /candidate/resume/versions/{resume_version_id}/document`

The original file, for "Download my CV".

**Response** — `200 OK`:
```json
{ "url": "https://...s3...presigned..." }
```
A presigned GET that expires (15 minutes by default): open it, don't store
it. `url` is `null` for a version with no file (pasted text or the manual
form).

---

## 8. `POST /candidate/resume/versions/{resume_version_id}/edit` — correct it

Requires: `CANDIDATE` role.

**Request body** (`ResumeEditRequest`) — send **exactly one** of:
```json
{ "text": "the corrected CV, as plain text, at least 50 characters..." }
```
or
```json
{ "structured": { "full_name": "...", "experience": [...], "education": [...], "skills": [...] } }
```
Sending both, or neither, is a `422` — there's no rule for how to merge two
different shapes of "the truth," so the API refuses to guess.

**Response** — `201 Created`, a new `ResumeVersionResponse`, `source: "EDIT"`.

**`409 resume_version_built`** for a `BUILDER` version: a built resume is
edited in the resume builder, which redraws its PDF ([18](18-resume-builder-apis.md)).

**What actually happens:** this **never modifies** the version you're
correcting — it creates a **brand-new** version, chained to the old one
(`supersedes_id`), and the new one starts **unconfirmed again**, even if the
one it replaced was already confirmed. A correction always has to go back
through review (§7) and be confirmed again — nothing is exempt from the
gate just because a similar version once passed it. `409` if the version
you're trying to edit has already been superseded by something newer (you
can only edit the current tip of the chain).

---

## 9. `POST /candidate/resume/versions/{resume_version_id}/confirm` — the gate

Requires: `CANDIDATE` role. **This is SRS 1.4.4, the mandatory confirm gate.**

**No request body** — just the version id in the path.

**Response** — `200 OK` (`ResumeConfirmResponse`):
```json
{ "resume_version_id": "3a1c...", "confirmed_at": "2026-09-17T11:00:00Z", "already_confirmed": false }
```

**Order of checks inside this call matters:**
1. Does this version exist, and belong to this candidate? (else `404`)
2. Has it already been superseded by a newer edit? (else `409` — confirming
   stale content that the candidate has since corrected would score the
   wrong thing)
3. Is it already confirmed? If so, this is treated as a harmless retry —
   returns `200` with `already_confirmed: true` and the **original**
   `confirmed_at` timestamp, never a new one. When a candidate approved
   their content is a fact about them, not about how many times their phone
   lost signal mid-request.
4. Has this candidate confirmed **any** version in the last
   `resume.scoring_interval` days (default **15**)? If so, `409
   resume_scoring_cooldown` with `params.next_scoring_at` (ISO timestamp)
   and `params.interval_days`. Nothing is confirmed, nothing is scored, and
   the last confirmed version stays the one scored. The first confirmation
   is always allowed.
5. Otherwise: the confirmation is written (a one-way latch — `confirmed_at`
   can only move from `NULL` to a value, never back), and **only now** the
   `resume.version_confirmed` event fires.

That event is what a background worker picks up to actually run scoring —
see §0 above for why it's this specific event and not "version created."

**Uploading is never limited; scoring is** (2026-10-26). A candidate may
upload, paste, correct and push from the builder as often as they like. Only
the confirm, which is what sends a resume to scoring, is held to one per
interval. The interval is measured from the last *confirmation*, not the last
score, so a score that's still computing has already used the turn. A retry
of a confirmation already made still answers `200 already_confirmed` (check 3
runs first). The interval is `config_values` key `resume.scoring_interval`,
`{"days": n}`, 0 (off) to 365; change it by inserting a new version of the
row. A malformed row is a `500`, never the default. Add-on re-scores (a
course or interview completed) are not confirmations and are not limited.

---

## 9b. `GET /candidate/resume/scoring-window` — when the next confirm is allowed

Requires: `CANDIDATE` role. **Not paywalled** — it only says when; the
confirm itself still needs a subscription.

**Response** — `200 OK` (`ResumeScoringWindowResponse`):
```json
{
  "interval_days": 15,
  "last_confirmed_at": "2026-10-20T09:00:00Z",
  "next_scoring_at": "2026-11-04T09:00:00Z",
  "can_confirm_now": false
}
```
| Field | Meaning |
|---|---|
| `interval_days` | One confirmation per this many days. `0` means no limit. |
| `last_confirmed_at` | The candidate's last confirmation, or `null` if none. |
| `next_scoring_at` | When a confirmation is next allowed; `null` means now. |
| `can_confirm_now` | `next_scoring_at == null`. |

Read it before showing the review screen's confirm button, so the app can say
"Your next scoring is available on 4 Nov" instead of letting the tap fail.
The `409` from §9 carries the same date.

---

## 10. `GET /candidate/score/me` — the candidate's own score

Requires: `CANDIDATE` role **and an active subscription** (pay-first, R13 —
a lapsed subscriber gets `402`, but their score history is never deleted).

**No request body.**

**Response while scoring hasn't finished yet** — `200 OK` (not `404` — a
confirmed resume waiting on a background job is a normal state, not a
missing resource):
```json
{ "status": "PENDING", "value": null, "band": null, "computed_at": null }
```

**Response once scored** — `200 OK`:
```json
{ "status": "READY", "value": 812, "band": "SOLID", "computed_at": "2026-09-17T11:05:00Z" }
```
| Field | Meaning |
|---|---|
| `value` | 700–990. Floored at display time (`display_value`) — what's stored is what was computed, the floor is applied only at this response boundary. |
| `band` | One of `ENTRY` / `DEVELOPING` / `SOLID` / `STRONG`. |

**What this response will *never* contain, on purpose, and it's tested
against (`test_score_never_explained.py`):** any breakdown, any category
score, any "what to improve," the model's raw output, or the
`resume_version_id` that produced it. The client confirmed twice (2026-08-27
and 2026-09-11) that the score is shown as a single number and nothing else
— no explanation screen exists anywhere in this product, by design, not by
omission.

**What actually computes the number** — Layer 1 (an AI model reads the CV
into structured facts) then Layers 2–3 (ordinary versioned code turns facts
into a 700–990 number) — is its own topic; this doc stops at "an event
triggers it and here's what comes back." A dedicated scoring-internals doc
can go deeper if useful later.

---

## 10b. `GET /candidate/score/scale` — the scale itself

Requires: `CANDIDATE` role. **Not paywalled**: it is the same for everyone
and says nothing about this candidate. Draw the score's scale and band
labels from it rather than hard-coding them.

**Response** — `200 OK` (`ScoreScaleResponse`):
```json
{
  "lowest": 700,
  "highest": 990,
  "bands": [
    { "band": "ENTRY", "lowest": 700, "highest": 769 },
    { "band": "DEVELOPING", "lowest": 770, "highest": 819 },
    { "band": "SOLID", "lowest": 820, "highest": 864 },
    { "band": "STRONG", "lowest": 865, "highest": 990 }
  ]
}
```
Read from `scoring.domain`, so the numbers drawn are the ones the engine
uses. It must never grow a "points to the next band" or a split of the scale
into what earns what: that is the breakdown R11 rules out, and
`test_score_never_explained.py` scans this schema too.

**Never draw it as a red-to-green gauge or speedometer** (`docs/design-system.md` §1):
that is how an Indian bureau score is drawn.

---

## Quick reference: state machine at a glance

```
 upload/paste/manual
        │
        ▼
  UNCONFIRMED version ──edit──▶ new UNCONFIRMED version (old one: superseded)
        │
     confirm
        │
        ▼
   CONFIRMED version  (latched — can never become unconfirmed again)
        │
   resume.version_confirmed event
        │
        ▼
   scoring.score_resume task runs
        │
        ▼
   GET /candidate/score/me → PENDING, then READY
```
