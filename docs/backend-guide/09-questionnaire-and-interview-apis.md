# 09 — Questionnaire & Mock Interview: input/output reference

Two candidate "extras" that sit next to the resume/score core, and that make
an interesting contrast: **the questionnaire is worth zero points, on
purpose and enforced**, while **the mock interview genuinely adds up to +60**
— but only the first three sessions count, and the candidate must be told
that *before* they pay for a fourth. 4 endpoints + 13 endpoints.

**Since 2026-09-29 every interview question is written by an AI model for
that one candidate** — there are no fixed questions any more (§8a).

Read [04-resume-and-scoring-apis.md](04-resume-and-scoring-apis.md) first —
both modules plug into the same score, from opposite directions.

---

## 0. The big picture

```
QUESTIONNAIRE                          MOCK INTERVIEW
──────────────                         ──────────────
Save answers (any number of times)     Device check (mic/audio/network)
        │                                       │
     Submit                              Checkout ONE session
        │                              (blocked without a fresh device
   Nothing happens to the score.        check, or — past the 3rd — without
   Ever. Structurally.                  an explicit "this won't move your
                                         score" acknowledgement)
                                                 │
                                          Start session → the AI writes
                                          question 1 from the CV + onboarding
                                                 │
                                          Answer it (upload audio)
                                                 │
                                          next-question → the AI *hears* that
                                          answer and writes question 2
                                          (…repeat until 6)
                                                 │
                                          Complete session → +20,
                                          if this is session 1-3
                                                 │
                                          (separately, later) an AI
                                          evaluator produces feedback —
                                          feedback only, never a number
```

### The questionnaire's zero is structural, not a policy nobody's tested

Every schema in `questionnaire/schemas.py` is checked by
`tests/invariants/test_questionnaire_never_scores.py`, which fails the build
if any field there looks even slightly score-shaped. The module is also
forbidden by `import-linter` from ever importing `scoring` at all — so
"the questionnaire could accidentally influence a score" isn't a runtime
risk that's mitigated, it's a category of bug that literally cannot compile.

### Why the interview *does* move the score, but with a hard ceiling

Each **completed** session (not "good," just *completed* — see §6) is worth
a flat **+20**. But only the first **three** sessions a candidate has ever
held count toward that — a 4th session is a real thing they can pay for and
record (maybe they just want the practice), but it adds nothing. The
`+60` ceiling this produces is enforced independently in two places that
mirror each other on purpose:
- `interview/domain.py`'s `purchase_earns_points()` — so the **offer/
  checkout screens can honestly tell the candidate in advance** "this one
  won't help your score."
- `scoring/domain.py`'s own cap — the actual, authoritative limit applied
  when the score is computed. The interview module's version exists purely
  to inform the candidate before they pay; it doesn't get to decide the
  real number, and if the two ever disagreed, scoring's own cap wins.

---

## 1. `GET /candidate/questionnaire` — the form and saved answers

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response** — `200 OK` (`QuestionnaireView`):
```json
{
  "bank_version": "placeholder-v1",
  "sections": [
    {
      "code": "career_goals",
      "questions": [
        {
          "code": "preferred_work_mode", "key": "questionnaire.preferred_work_mode",
          "prompt": "What kind of work setup do you prefer?", "type": "SINGLE",
          "options": [{ "code": "REMOTE", "label": "Remote" }, { "code": "HYBRID", "label": "Hybrid" }],
          "required": false, "help_text": null
        }
      ]
    }
  ],
  "answers": {},
  "submitted": false,
  "submitted_at": null,
  "updated_at": null
}
```
Same data-driven-form pattern as the KYB form
([07](07-kyb-apis.md)) — questions and options are published data, not
hardcoded per client. `key` is a translation key; `prompt` is the English
fallback shown if a translation is missing.

## 2. `PUT /candidate/questionnaire/answers` — save progress

**Auth required:** `CANDIDATE` role + active subscription.

**Request body** (`SaveAnswersRequest`):
```json
{ "answers": { "preferred_work_mode": "HYBRID", "relocate_willing": null } }
```
A `null` value **clears** that answer; a code you don't mention is left as
whatever it already was. **All-or-nothing validation**: if any answer in
this one request is invalid, *none* of the request is saved — so the app
never has to work out which half of a screen actually got kept after a
partial failure.

**Response** — `200 OK`, the updated `QuestionnaireView` (same shape as §1).

**Errors:**
| Code | When |
|---|---|
| `422 questionnaire_answers_invalid` | Lists **every** bad answer, each by its own question code and reason code |

## 3. `POST /candidate/questionnaire/submit` — share it

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response** — `200 OK`, updated `QuestionnaireView`, `submitted: true`.

**Every question is skippable, including all of them at once** — an
entirely empty questionnaire can be submitted. The only consequence of
skipping everything is appearing in fewer of an employer's *filtered*
searches later (some discovery filters read questionnaire answers) — never
a penalty, never a missed points opportunity, because there were never any
points to miss.

## 4. `GET /candidate/questionnaire/report` — what was shared

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response** — `200 OK` (`QuestionnaireReportResponse`):
```json
{
  "bank_version": "placeholder-v1",
  "submitted_at": "2026-09-17T10:00:00Z",
  "sections": [
    {
      "code": "career_goals", "answered": 2, "total": 4,
      "items": [
        { "code": "preferred_work_mode", "prompt": "What kind of work setup do you prefer?", "answered": true, "display": ["Hybrid"] }
      ]
    }
  ]
}
```
This is a **summary view for the candidate to see what they shared** — a
recap screen, not an admin tool. `404 questionnaire_not_submitted` if
nothing's been submitted yet (§3's job first) — a `NotFoundError`, not a
conflict, because there's genuinely no report resource yet to conflict
with.

---

## 5. `GET /candidate/interview/offer` — the pre-checkout screen

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response** — `200 OK` (`OfferResponse`):
```json
{
  "on_sale": true,
  "price_minor": 29900,
  "currency": "INR",
  "will_increase_score": true,
  "requires_acknowledgement": false,
  "device_check_passed": false,
  "device_check_valid_until": null,
  "sessions_available": 0,
  "open_session_id": null
}
```
**This single response is designed to answer every question a "buy a
session" screen needs before showing a pay button:** is it even on sale
right now, what does it cost, will paying for it actually help the score
(the exact truthful answer, computed from how many sessions this candidate
has already held), does the device check need doing (again) first, is there
an already-open session to resume instead of starting a new one.

If `will_increase_score: false`, the frontend is expected to tell the
candidate plainly *before* the payment screen — that's what makes
`requires_acknowledgement: true` matter at checkout (§7).

## 6. `POST /candidate/interview/device-checks` — record a check

**Auth required:** `CANDIDATE` role + active subscription.

**Request body** (`DeviceCheckRequest`):
```json
{ "mic_ok": true, "audio_out_ok": true, "network_kbps": 2500, "storage_mb": 500, "quiet_env_ok": true }
```
**Notice what's absent: no camera, no lighting, anything visual.** This
product's mock interview is audio-only — there is no video field anywhere
in this module, in a request or a response.

**Response** — `201 Created` (`DeviceCheckResponse`):
```json
{
  "id": "9f2e...", "passed": true, "failures": [],
  "rule_version": "v1", "checked_at": "2026-09-17T10:00:00Z",
  "valid_until": "2026-09-17T11:00:00Z"
}
```
`201` regardless of whether it passed — **a failed check is recorded too**,
not rejected as a bad request; failing a device check is a normal, expected
outcome, not a client error. A passed check stays valid for a limited
window (`valid_until`) — checkout and starting a session both require one
that's still fresh, so a check from yesterday doesn't clear you today.

## 7. `POST /candidate/interview/checkout` — buy one session

**Auth required:** `CANDIDATE` role + active subscription.

**Request body** (`InterviewCheckoutRequest`):
```json
{ "acknowledge_no_score_increase": false }
```
Default `false`. **Must be sent `true`** if `will_increase_score` was
`false` on the offer — otherwise this call is refused before any payment
row is even created.

**Response** — `201 Created` (`CheckoutResponse`), same shape as billing
checkouts elsewhere ([08](08-billing-subscriptions-courses-apis.md)) — a
`redirect_url` to actually pay, nothing granted yet.

**What's checked, in order, *before* a payment can even be opened:**
1. Is there a device check that's both `passed` and still within its valid
   window? Else `409 interview_device_check_required`.
2. Is a session product currently on sale? Else `409` (unavailable).
3. Would this session earn points (fewer than 3 held so far)? If not, was
   `acknowledge_no_score_increase: true` sent? Else `409
   interview_no_score_increase_unacknowledged`.

**Why refuse *before* opening a payment, rather than after:** the point is
that a candidate is never charged for a session they legally couldn't
record (no working mic) or for points they were explicitly not told they'd
get. Refusing after payment would mean either a refund process or a
candidate stuck having paid for nothing — refusing before means the payment
row never exists.

**What's recorded alongside the payment:** an insert-only
`interview_checkout_notices` row capturing exactly what the candidate was
told (`will_increase_score`, whether they acknowledged) — evidence of what
was disclosed, that can never be edited after the fact.

---

## 8. `POST /candidate/interview/sessions` — start (or resume)

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response** — `201 Created` (`SessionResponse`):
```json
{
  "id": "3a1c...", "session_number": 1, "state": "CREATED",
  "question_set_code": "ADAPTIVE", "question_set_title": "Questions written for you",
  "question_set_version": "openai-questions-v2-2026-09-29",
  "created_at": "...", "started_at": null, "completed_at": null,
  "questions_total": 6,
  "questions": [
    { "index": 0, "code": "S1Q1", "key": null,
      "prompt": "You are a warehouse supervisor in Pune. Tell me about your night shift and the change you made that cut truck turnaround time.",
      "preparation_seconds": 30, "answer_seconds": 120, "looking_for": null }
  ],
  "answers": [
    { "question_index": 0, "upload_state": "PENDING", "duration_ms": null, "uploaded_at": null },
    { "question_index": 1, "upload_state": "PENDING", "duration_ms": null, "uploaded_at": null }
  ]
}
```
(`answers` always has all six entries; trimmed here.)

**Only one question comes back.** `questions` holds what has been asked *so
far*; `questions_total` says how many there will be. The next five are
written one at a time, after each answer (§10a). `key` is `null` because the
question was written in the candidate's own language (their account locale)
and there is nothing to translate. Start takes about **3 seconds**, because
the model is writing question 1 while you wait.

**If the model cannot write the first question** (unreachable, or three
unusable drafts in a row), this answers **`503 interview_question_unavailable`
and nothing happens**: no session is created and the purchase is not spent.
Show "try again" and call it again.
**If a session is already open (`CREATED`/`IN_PROGRESS`), this returns that
same session rather than starting a new one.** That's the recovery path for
an interrupted attempt — a crashed app, a lost connection — not a bug: the
`GET /candidate/interview/offer` response even tells the frontend
`open_session_id` in advance so it can jump straight to resuming instead of
calling this blind. **There is currently no "abandon this session" action**
reachable through the API — a documented, tracked gap, not a hidden one.

**Notice `looking_for` is `null` for every question at the start.** This
field — "what a good answer contains" — is deliberately withheld until
*after* that specific answer has been recorded (§10 shows it appearing).
Showing the rubric before the answer would turn the exercise into reading a
script aloud instead of an actual answer.

## 8a. Where the questions come from

This is the part most likely to surprise you, so it gets its own section.

- **Who writes them:** an OpenAI model (`INTERVIEW_QUESTION_PROVIDER=openai`,
  a pinned `INTERVIEW_QUESTION_MODEL_ID`), code in `interview/questions.py`
  and `interview/openai_questioner.py`. Tests use a deterministic stub.
- **What it is shown:** the candidate's confirmed CV **with phone, email,
  links and name stripped out** (`domain.redact_contacts`), their onboarding
  answers in words (never the free-text accessibility answer), the language to
  ask in, **every question they were asked in any earlier session**, and this
  session's questions with what the candidate said (the transcripts). Never
  the score, never a name.
- **What it returns:** exactly `{kind, prompt, looking_for}`. `kind` is
  `OPENING` for question 1, then `FOLLOW_UP` (digging into the last answer) or
  `NEW_TOPIC`.
- **No repeats, enforced twice.** The model is told not to repeat an earlier
  question, *and* `domain.parse_drafted_question` refuses a draft that matches
  any earlier question after ignoring case, punctuation and spacing. A refused
  draft is sent back to the model with the reason, up to three tries
  (`MAX_DRAFT_ATTEMPTS`). The client asked for this because a second paid
  interview that repeats the first feels like money wasted.
- **No fixed fallback.** If no usable question comes back, the request is a
  `503` and the app retries. The old fixed question sets in `bank.py` are
  only read for sessions started before 2026-09-29.
- Every question is stored (`interview_session_questions`) with the model and
  prompt version that wrote it, so a report, a replay or a dispute always
  shows exactly what was asked.

## 9. `GET /candidate/interview/sessions` and `GET .../sessions/{session_id}`

**Auth required:** `CANDIDATE` role + active subscription, both.

**Request:** no body. List: no filters. Single: `session_id` in path.

**List response** — `200 OK`, array of `SessionSummary` (a lighter version
of `SessionResponse` — no questions/answers, just state and timestamps),
newest first. **Single response** — the full `SessionResponse` shown in §8,
current state.

---

## 10. Answering a question — two calls per answer, same upload pattern as everywhere else

### `POST /candidate/interview/sessions/{session_id}/answers/{question_index}/upload`

**Auth required:** `CANDIDATE` role + active subscription. `question_index`
must be between `0` and `QUESTIONS_PER_SESSION - 1` (6 questions per
session) — anything outside that range is a `422` before the handler even
runs. A question that has not been written yet is
`409 interview_question_not_ready`: ask for it first (§10a).

**Request:** no body.

**Response** — `201 Created` (`AnswerUploadResponse`):
```json
{ "url": "https://s3.../presigned-put-url...", "method": "PUT", "expires_in_seconds": 300, "max_bytes": 10485760, "max_duration_ms": 120000, "accepted_types": ["audio/webm", "audio/mp4"] }
```
Same presigned-upload shape as resume files and KYB documents — no `key`
field, derived server-side. **What frontend does next:** record the audio
answer, then `PUT` the bytes to `url`.

### `POST /candidate/interview/sessions/{session_id}/answers/{question_index}/complete`

**Request body** (`CompleteAnswerRequest`):
```json
{ "duration_ms": 87000 }
```

**Response** — `200 OK` (`AnswerResponse`):
```json
{ "question_index": 0, "upload_state": "STORED", "duration_ms": 87000, "uploaded_at": "...", "looking_for": "A specific project, the challenge, and what they did about it." }
```
**Now `looking_for` appears** — only after this specific answer is safely
stored, feedback about what a good answer would contain is finally shown
(useful for the candidate's own learning, harmless once they've already
answered).

### 10a. `POST /candidate/interview/sessions/{session_id}/next-question`

**Auth required:** `CANDIDATE` role + active subscription. **Request:** no body.

Call it right after an answer's `/complete` returns `STORED`. The server
transcribes that answer (Sarvam, in-session), shows the model everything in
§8a, and writes the next question.

**Response** — `200 OK`, the whole `SessionResponse` with one more entry in
`questions`; the new question is the last one:
```json
{ "question_set_code": "ADAPTIVE", "questions_total": 6,
  "questions": [
    { "index": 0, "code": "S1Q1", "prompt": "…", "looking_for": "What you were responsible for, and one thing you changed." },
    { "index": 1, "code": "S1Q2", "key": null,
      "prompt": "You said you re-sequenced the dock slots. How did you decide the new order, and what changed on a typical night?",
      "looking_for": null }
  ], "...": "..." }
```
- **It takes about 9 seconds** (≈6 s hearing the answer, ≈3 s writing).
  Show an "interviewer is thinking" state.
- **Safe to retry.** Called again before the new question's answer is
  stored, it returns the same session unchanged — a dropped response never
  produces a second question.
- `409 interview_previous_answer_not_stored` only if an *earlier* answer is
  missing. `503 interview_question_unavailable` if the model could not write
  one: nothing was written, call again.
- If transcription fails, the question is still written — just without
  hearing that answer — so the candidate is never stuck mid-interview.

---

## 11. `POST /candidate/interview/sessions/{session_id}/complete` — finish

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response** — `200 OK`, updated `SessionResponse`, `state: "COMPLETED"`.

**Requires every one of the 6 answers to be `STORED`** — not "good," just
present. This is exactly where the **+20** is actually recorded (if this is
one of the candidate's first three sessions), through the same
event-and-background-task pattern as scoring elsewhere
(`interview.session_completed` → a re-score task, per the routing table in
[04](04-resume-and-scoring-apis.md)). A session that stalls with unanswered
questions simply can't be completed — there's no partial-credit path.

## 12. `GET /candidate/interview/sessions/{session_id}/report` — feedback

**Auth required:** `CANDIDATE` role + active subscription.

**Request:** no body.

**Response while evaluation hasn't run yet** — `200 OK`:
```json
{ "session_id": "...", "status": "PENDING", "failure_reason": null, "evaluated_at": null }
```

**Response once ready** — `200 OK`:
```json
{
  "session_id": "...", "status": "READY", "evaluated_at": "...", "report_version": "v1",
  "dimensions": [
    { "code": "CLARITY", "key": "interview.dim.clarity", "label": "Clarity", "level": "STRONG", "what_good_looks_like": "Structured, specific answers with a clear outcome." }
  ],
  "strengths": ["CLARITY"],
  "focus_areas": ["CONCISENESS"],
  "questions": [
    {
      "index": 0, "code": "Q1", "prompt": "Tell me about a challenging project.",
      "looking_for": "A specific project, the challenge, and what they did about it.",
      "transcript": "So there was this one time when...", "spoken": true,
      "comment": "Good structure, could be more concise."
    }
  ]
}
```
**`level` is a word — `STRONG` / `DEVELOPING` / `FOCUS_AREA` — never a
number, anywhere in this response.** This is feedback, evaluated separately
from (and after) the +20 that completing the session already earned; a bad
evaluation, or none at all, never takes those points back.

`409` while the session is still being recorded (evaluation only makes
sense on a completed session — poll `GET .../sessions/{id}` for `state`
first). `status: "FAILED"` with a `failure_reason` (`no_speech`,
`evaluation_invalid`) is a real, final outcome, not a retryable error — some
recordings genuinely can't be evaluated, and that's reported as such rather
than silently retried forever.

---

## 13. `GET /candidate/interview/history` — every session, for the history screen

**Auth required:** `CANDIDATE` role + active subscription. **Request:** no body.

**Response** — `200 OK`, newest first:
```json
[
  { "id": "3a1c...", "session_number": 2, "state": "EVALUATED",
    "question_set_code": "ADAPTIVE", "question_set_title": "Questions written for you",
    "created_at": "...", "completed_at": "...",
    "questions_asked": 6, "answers_stored": 6, "report_status": "READY" }
]
```
`report_status` is `NOT_COMPLETED` (still being recorded, or abandoned),
`PENDING`, `READY` or `FAILED` — exactly what §12 would say, so the list can
show a badge without one call per session.

## 14. `GET /candidate/interview/sessions/{session_id}/recordings` — hear yourself

**Auth required:** `CANDIDATE` role + active subscription. **Request:** no body.

**Response** — `200 OK`, one entry per stored answer:
```json
[
  { "question_index": 0, "question_code": "S1Q1", "prompt": "…",
    "url": "https://…/interview-audio/…?X-Amz-Signature=…", "expires_in_seconds": 900,
    "mime": "audio/ogg", "duration_ms": 12000, "uploaded_at": "...",
    "transcript": "मैं चाकण में वेयरहाउस सुपरवाइज़र हूँ…" }
]
```
`url` is a **presigned GET that expires** — put it straight in an `<audio>`
element, and fetch the list again for fresh links rather than storing them.
`transcript` is `null` until that answer has been heard. Someone else's
session is a `404`. Staff hear the same recordings through the admin console,
audited ([13](13-admin-console-and-disputes-apis.md)).

---

## Quick reference

| | Questionnaire | Mock interview |
|---|---|---|
| Moves the score? | **Never** — structurally forbidden | **Yes**, +20/session, first 3 only |
| Needs its own purchase? | No (subscription only) | **Yes** — one purchase per session |
| Has a device check gate? | No | Yes, required and time-limited |
| Produces feedback? | A recap of what was shared | Per-dimension levels, transcript, comments |
| Where the questions come from | A fixed bank | **Written by AI per candidate**, one after each answer, never repeating an earlier session |
| Can you replay it? | — | Yes: history (§13) and recordings (§14) |
| Auth on every endpoint | `CANDIDATE` + active subscription | `CANDIDATE` + active subscription |
