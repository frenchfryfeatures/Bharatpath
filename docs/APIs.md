# APIs — every route, what it does, and how the flows fit together

The companion to [how-it-all-connects.md](how-it-all-connects.md) (deployment
topology) and [plan.md](plan.md) (scope and schedule). This one is the API
surface itself: every route that exists today, what guards it, and the request
sequences a client actually walks through.

All paths below are relative to the global prefix **`/api/v1`**
(`Settings.api_v1_prefix`, applied once in `app/main.py`). There is no
versioning below v1. `app/api/router.py` mounts `app.api.health.router`
unprefixed, then walks `app.modules.ALL_MODULES` in a fixed order, mounting
each module's `get_router()` at its declared prefix, plus any
`get_extra_routers()` at their own prefixes — this is how one module serves
two surfaces (`jobs` also answers under `/candidate/jobs`, `applications`
under `/employer/applications`, `subscriptions` under both `/candidate/...`
and `/employer/...`, and `candidate` mounts the employer-facing reveal route).

**Route prefixes are for readability only.** Authorization happens in
dependencies (`require_role`, `require_active_subscription`, …), never by
matching the path — see `app/core/deps.py`.

## Auth model

There is no login/token endpoint in this service. Cognito issues the token —
candidates via phone OTP (custom-auth) or email, business accounts via
password + mandatory software-token MFA — and this service only verifies the
token and then resolves role and tenant itself:

- **`CurrentUser` / `TenantContext`** — the authenticated caller, built from a
  verified Cognito token plus a live (60s-cached) lookup of the `memberships`
  table. Carries `user_id`, `role`, `pool` (`CANDIDATE` / `BUSINESS`),
  `tenant_id`. Token claims and Cognito groups are never the authority — see
  the CLAUDE.md note on membership revocation.
- **Roles**: `CANDIDATE`, `EMPLOYER_OWNER`, `EMPLOYER_RECRUITER`,
  `EMPLOYER_VIEWER`, `COLLEGE_ADMIN`, `COLLEGE_STAFF` (the college roles have
  no routes yet).
- **`require_role(*roles)`** — 403 if the caller's role isn't in the set.
- **`require_active_subscription`** — the pay-first gate (R13). Checks
  `has_active_subscription` live, for the caller's user or tenant. 402
  `subscription_required` if lapsed. Always applied *after* a role guard, so
  a wrong-role caller gets 403, not "pay us."
- **`require_active_access_window`** — the same live check, employer-tenant
  only, used solely by the candidate reveal. Same underlying state as
  subscription, but a distinct 402 code (`access_window_expired`) — see the
  Day 14 notes in CLAUDE.md.
- **`require_kyb_approved`** — invariant 8; also enforced at the DB-trigger
  level on job publish, so this dependency is belt, not suspenders.
- **`current_business_identity`** — resolves a BUSINESS-pool token to a
  user id and optional membership *without* requiring an org yet. Used by
  exactly two routes: `GET /employer/reference` and
  `POST /employer/organisation`. Nothing else should depend on it — every
  other route is a way in that skips the membership check.
- **Dev-only routes** don't exist at all (not just 403'd) unless their flag is
  set, and `Settings` refuses to boot with the flag set outside local/CI:
  `POST /auth/dev/token` (`AUTH_ALLOW_LOCAL_TOKENS`) and
  `POST /billing/dev/payments/{payment_id}/simulate` (`PAYMENTS_PROVIDER=stub`).

---

## Health — unauthenticated, no module prefix

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Liveness probe |
| GET | `/api/v1/health/ready` | Readiness probe — checks DB and Redis |

---

## identity — `/auth`

Cognito linkage, sessions, "who am I."

**Sign-up (2026-09-18, `docs/signup-and-accounts.md`)**: anyone registers in
Cognito by email and password. A candidate's first call creates their account.
A business account's first `GET /auth/me` is **403 `no_active_membership`**,
which means "create your organisation" (`POST /employer/organisation` or
`POST /college/organisation`). An email already used in the other pool is
**403 `account_contact_in_use`** (blockers E8).

| Method | Path | Auth | Body | Response | Notes |
|---|---|---|---|---|---|
| ~~POST~~ | ~~`/auth/otp/start`~~ | — | — | — | **Not registered** since 2026-09-18: the client deferred phone OTP. Exists only with `AUTH_PHONE_OTP_ENABLED=true`. Sign-in is email + password on both pools; Cognito emails every code |
| GET | `/auth/me` | Any authenticated user | — | `{user_id, role, pool, tenant_id, email, full_name}` | Smallest possible proof the auth chain works end to end. `email` is the caller's own. `full_name` is a candidate's profile name (null until set) and always null for a business account, which has no stored name |
| POST | `/auth/dev/token` | Dev-only, flag-gated | `{subject, pool, phone?, email?}` | `{access_token, subject, expires_in}` | Only exists when `AUTH_ALLOW_LOCAL_TOKENS=true`; mints a real RS256 token locally |

## candidate — `/candidate` (+ extra router at `/employer/discovery`)

Candidate's own profile, and — co-located because it needs the display score
— the employer's "open a profile" reveal route.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|---|
| GET | `/candidate/profile` | CANDIDATE | — | `CandidateProfileResponse` | |
| PUT | `/candidate/profile/location` | CANDIDATE | `{city?, state?}` | `CandidateProfileResponse` | Shown on masked employer cards; city rejects digits/`@` |
| PUT | `/candidate/profile/name` | CANDIDATE | `{full_name}` | `CandidateProfileResponse` | Only ever shown to an employer who reveals the profile; never guessed from a CV |
| GET | `/candidate/profile/views` | CANDIDATE | `?cursor&limit` | `Page[ProfileView]` | Who viewed my profile: one entry per organisation (`employer_name`, `last_viewed_at`), last 90 days, latest first. Never the recruiter, no count of opens, no total. Not paywalled |
| GET | `/employer/discovery/candidates/{candidate_id}` | OWNER/RECRUITER + `require_active_access_window` | path | `RevealedCandidate` | **The reveal.** Name, contact, display score. Every call — including re-opens — writes an audit row and a view event in the same transaction. 402 `access_window_expired`, 403 `kyb_required`, 429 rate/view-cap, 404 not visible |

## resume — `/candidate/resume`

Upload → parse → review → **confirm gate**. Every route is CANDIDATE-only.

| Method | Path | Body/Params | Response | Notes |
|---|---|---|---|---|
| POST | `/candidate/resume/uploads` | — | `{upload_id, url, expires_in_seconds, max_bytes, accepted_types}` (201) | Presigned S3 PUT ticket; nothing written to the DB yet |
| POST | `/candidate/resume/uploads/{upload_id}/complete` | path | `{resume_file_id, scan_status, parse_status}` (202) | Server re-derives key/size/type itself; queues async parse (pypdf/docx first, Textract only on a length-floor miss) |
| GET | `/candidate/resume/files/{resume_file_id}` | path | `ResumeFileStatusResponse` | Poll until scan/parse hits a terminal state; 404 (not 403) for someone else's file |
| POST | `/candidate/resume/text` | `{text}` | `ResumeVersionResponse` (201) | Pasted-text CV — no file, no scan, no OCR |
| POST | `/candidate/resume/manual` | `ManualResumeRequest` | `ResumeVersionResponse` (201) | Structured-form CV; no DOB/age field exists anywhere in it (invariant 5) |
| GET | `/candidate/resume/versions` | — | `list[ResumeVersionSummary]` | The version chain, no content |
| GET | `/candidate/resume/versions/{id}` | path | `ResumeVersionDetailResponse` | Full parsed content — the review screen |
| POST | `/candidate/resume/versions/{id}/edit` | path + `ResumeEditRequest` | `ResumeVersionResponse` (201) | A correction creates a **new** unconfirmed version chained by `supersedes_id`; never inherits confirmation; 409 if the source was already superseded |
| POST | `/candidate/resume/versions/{id}/confirm` | path | `{resume_version_id, confirmed_at, already_confirmed}` | **The only door to scoring** (SRS 1.4.4). Idempotent — 200 on a repeat call |

## scoring — `/candidate/score`

The number, and the scale it sits on. Nothing that explains it.

| Method | Path | Auth | Response | Notes |
|---|---|---|---|---|
| GET | `/candidate/score/me` | CANDIDATE + active subscription | `{status: PENDING\|READY, value?, band?, computed_at?}` | 200 `PENDING` while unscored, not 404. Never a breakdown — the score is never explained, by dedicated test. Lapsed subscriber gets 402 |
| GET | `/candidate/score/scale` | CANDIDATE (not paywalled) | `{lowest, highest, bands: [{band, lowest, highest}]}` | The engine's own constants: 700, 990, and the four bands in order (inclusive, contiguous). Draw the scale from this — never hardcode it. **Do not show "N points to next band"** or a delta between scores: both explain the score (R11) |

Scoring itself has no other HTTP surface: it fires on the
`resume.version_confirmed` event, never `version_created`, and
`replay(score_id)` (internal, not a route) re-derives a historical score from
the stored model extraction without ever calling the model again.

## integrity — `/integrity`

Stub. No routes yet — signal severity, search suppression are wired
internally (`integrity-never-imports-scoring`) but there's no HTTP surface for
review actions (blocked on platform-staff accounts, `docs/blockers.md` E10).

## questionnaire — `/candidate/questionnaire`

Worth **zero points** — its event routes to nothing in scoring. Every route:
CANDIDATE + active subscription.

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/candidate/questionnaire` | — | `QuestionnaireView` | Bank + saved answers |
| PUT | `/candidate/questionnaire/answers` | `{answers}` | `QuestionnaireView` | Merge-save; 422 lists every invalid answer |
| POST | `/candidate/questionnaire/submit` | — | `QuestionnaireView` | Shares the saved answers with employers |
| GET | `/candidate/questionnaire/report` | — | `QuestionnaireReportResponse` | What was shared, by section |

## interview — `/candidate/interview`

Mock interview, bought like a one-off, not an entitlement. Every route needs
an active subscription; a session additionally needs its own purchase.

| Method | Path | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/candidate/interview/offer` | — | `OfferResponse` | Price, device-check status, whether a session would move the score |
| POST | `/candidate/interview/device-checks` | `{mic_ok, audio_out_ok, network_kbps, storage_mb, quiet_env_ok}` | `DeviceCheckResponse` (201) | 201 whether it passes or fails |
| POST | `/candidate/interview/checkout` | `{acknowledge_no_score_increase}` | `CheckoutResponse` (201) | 409 without a passed device check in the last hour, or without the acknowledgement once 3 sessions are already held; grants nothing until the payment callback lands |
| POST | `/candidate/interview/sessions` | — | `SessionResponse` (201) | Returns the already-open session if there is one — that's the recovery path, there's no abandon. Holds **one** question, written by the AI for this candidate (`question_set_code` ADAPTIVE); the rest come from `next-question`. 503 `interview_question_unavailable` if the model cannot write it — nothing is created and the purchase is not spent; retry |
| GET | `/candidate/interview/sessions` | — | `list[SessionSummary]` | Newest first |
| GET | `/candidate/interview/history` | — | `list[SessionHistoryItem]` | 2026-09-29. Every session, with `questions_asked`, `answers_stored`, `report_status` (NOT_COMPLETED / PENDING / READY / FAILED) |
| GET | `/candidate/interview/sessions/{id}` | path | `SessionResponse` | Session + answer manifest. `questions` is what has been asked so far; `questions_total` is how many there will be |
| POST | `/candidate/interview/sessions/{id}/next-question` | path | `SessionResponse` | 2026-09-29. Hears the stored answers and writes the next question (the last entry of `questions`). Takes a few seconds. Called before the latest question's answer is stored, it returns the session unchanged (a retry gets the same question). 409 `interview_previous_answer_not_stored` (`params.missing`) only if an earlier answer is missing. 503 `interview_question_unavailable` if the model cannot write one (three refused drafts, or unreachable): nothing written, retry. About 9 s |
| GET | `/candidate/interview/sessions/{id}/recordings` | path | `list[RecordingSchema]` | 2026-09-29. One presigned GET per stored answer, with the question and the transcript once heard. Links expire; ask again |
| POST | `/candidate/interview/sessions/{id}/answers/{q}/upload` | path | `AnswerUploadResponse` (201) | Presigned URL for one audio answer. 409 `interview_question_not_ready` for a question not written yet |
| POST | `/candidate/interview/sessions/{id}/answers/{q}/complete` | path + `{duration_ms}` | `AnswerResponse` | A STORED answer never changes afterward |
| POST | `/candidate/interview/sessions/{id}/complete` | path | `SessionResponse` | Needs every question answered; +20 per completed session, a fourth included, +60 cap enforced by scoring alone |

## courses — `/candidate/courses`

Catalogue, lessons, progress and purchase. **Locked until bought**: the
syllabus shows, no lesson plays. **No completion route** — the candidate
reports where they are in a lesson; the server decides a lesson is watched
(90% reached *and* half its length elapsed since first opened) and, when
every published lesson is, records the completion **as the system**
(`courses.service.record_progress`, rule `lessons-watched-1-2026-09-29`). It
routes to `rescore_for_addons`, not `score_resume` (which is idempotent per
version and would silently no-op).

| Method | Path | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/candidate/courses` | — | `list[CourseResponse]` | Courses on sale, with `purchased`, `completed`, `locked`, `lessons_total`, `lessons_completed`, `percent_complete`. Ownership is by course code, so a buyer of an earlier price keeps it |
| GET | `/candidate/courses/{course_id}` | path | `CourseDetailResponse` | Modules → lessons. `media_url` is null until bought; then a YouTube embed URL (iframe) or a four-hour presigned GET (`<video>`). `position_seconds` is where to resume |
| POST | `/candidate/courses/{course_id}/lessons/{lesson_id}/progress` | path + `{position_seconds}` | `LessonProgressResponse` | Every ~15 s while playing, and on pause/close. 409 `course_not_purchased` |
| POST | `/candidate/courses/{course_id}/checkout` | path | `CheckoutResponse` (201) | Nothing granted until the payment callback settles |

## employer — `/employer`

Org and team. Only `GET /employer/reference` and `POST /employer/organisation`
are reachable before an org exists.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/employer/reference` | business account, no org needed | — | `{employer_types, industries}` | Vocab for the org-creation form |
| POST | `/employer/organisation` | business account, no org needed | `CreateOrganisationRequest` | `OrganisationResponse` (201) | Caller becomes owner; 409 if the account is already in an org, including a suspended one |
| GET | `/employer/organisation` | any employer role | — | `OrganisationResponse` | |
| PATCH | `/employer/organisation` | OWNER only | `UpdateOrganisationRequest` | `OrganisationResponse` | Name/type/industry only — **not** KYB status (invariant 8; that's `kyb.service.set_kyb_status` alone) |
| GET | `/employer/team` | any employer role | — | `list[TeamMemberResponse]` | |
| POST | `/employer/team` | OWNER only | `{email, role}` | `TeamMemberResponse` (201) | Access granted on that person's next sign-in |
| PATCH | `/employer/team/{user_id}` | OWNER only | path + `{role}` | `TeamMemberResponse` | 404 outside the org; 409 if it would leave the org ownerless |
| DELETE | `/employer/team/{user_id}` | OWNER only | path | 204 | Revoked, not deleted |

## kyb — `/employer/kyb`

Every route: OWNER only.

| Method | Path | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/employer/kyb/form` | — | `KybFormResponse` | Definition/options; server validates independently of what the client shows |
| GET | `/employer/kyb` | — | `KybSubmissionResponse` | Current submission |
| PUT | `/employer/kyb/answers` | `SaveAnswersRequest` | `KybSubmissionResponse` | Merge-save; 422 lists malformed fields |
| POST | `/employer/kyb/documents` | `{doc_type}` | `DocumentTicketResponse` (201) | Presigned upload URL |
| POST | `/employer/kyb/documents/{upload_id}/complete` | path + `{doc_type}` | `KybSubmissionResponse` | Key rebuilt from the caller's own org; 404 for someone else's upload |
| POST | `/employer/kyb/submit` | — | `KybSubmissionResponse` | Auto-approves under the default config row, or queues for review (R15 — `kyb.require_approval`); 422 lists missing items. No reviewer-action route exists yet — no platform-staff account can exist (`docs/blockers.md` E10) |

## jobs — `/employer/jobs` (+ extra router at `/candidate/jobs`)

Employer composer and the candidate board. `/threshold-preview` is declared
ahead of `/{job_id}` to avoid a path collision.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|
| POST | `/employer/jobs` | OWNER/RECRUITER + active subscription | `CreateJobRequest` | `JobResponse` (201) | Draft |
| GET | `/employer/jobs` | any employer role + active subscription | `status`, `cursor`, `limit` (≤100, default 50) | `Page[JobListItem]` | Newest first, each with pipeline counts |
| GET | `/employer/jobs/threshold-preview` | OWNER/RECRUITER + active subscription | `min_score` (700–990, stepped, rate-limited per org) | `ThresholdPreviewResponse` | Rounded/coarse count only, floored under ten — never exact, so a threshold can't be used to binary-search one candidate's score |
| GET | `/employer/jobs/{job_id}` | any employer role + active subscription | path | `JobResponse` | 404 cross-org |
| PATCH | `/employer/jobs/{job_id}` | OWNER/RECRUITER + active subscription | path + `UpdateJobRequest` | `JobResponse` | 409 once published/closed — pause first |
| POST | `/employer/jobs/{job_id}/publish` | OWNER/RECRUITER + active subscription | path | `JobResponse` | 403 `kyb_required` without approved KYB — invariant 8, also enforced by a DB trigger |
| POST | `/employer/jobs/{job_id}/pause` | OWNER/RECRUITER + active subscription | path | `JobResponse` | |
| POST | `/employer/jobs/{job_id}/close` | OWNER/RECRUITER + active subscription | path | `JobResponse` | Terminal |
| GET | `/candidate/jobs` | CANDIDATE + active subscription | `q, location, work_mode, skill, min_salary_minor, eligible_only, cursor, limit` | `Page[BoardJobSummary]` | Published jobs only; `eligibility` is computed against the candidate's **stored** score — the threshold number itself is never shown |
| GET | `/candidate/jobs/{job_id}` | CANDIDATE + active subscription | path | `BoardJobDetail` | 404 for anything not currently on the board |

## applications — `/candidate/applications` (+ extra router at `/employer/applications`)

The pipeline. Stage machine lives in `applications.domain` and is mirrored by
a DB guard (`guard_application_write`) that no writer, including the
migrator, can bypass.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|
| POST | `/candidate/applications` | CANDIDATE + active subscription | `{job_id}` | `ApplicationResponse` (201 new / 200 repeat) | 404 job not on the board, 409 `score_pending`/`application_unavailable`, 403 `eligibility_below_threshold` — no gap or number given |
| GET | `/candidate/applications` | CANDIDATE | `cursor, limit` | `Page[ApplicationResponse]` | Not paywalled — reading your own data is always allowed |
| GET | `/candidate/applications/{id}` | CANDIDATE | path | `ApplicationDetailResponse` | With stage history |
| POST | `/candidate/applications/{id}/withdraw` | CANDIDATE | path | `ApplicationResponse` | Any pre-outcome stage; 409 once hired/rejected/expired |
| POST | `/candidate/applications/{id}/hire/confirm` | CANDIDATE | path | `ApplicationResponse` | Finalizes a hire the employer proposed; the candidate's confirmation, not the employer's, is what writes HIRED; 409 `hire_confirmation_not_pending` |
| POST | `/candidate/applications/{id}/hire/dispute` | CANDIDATE | path | `ApplicationResponse` | |
| GET | `/employer/applications` | OWNER/RECRUITER/VIEWER + active subscription | `job_id, stage, cursor, limit` (all optional) | `Page[EmployerApplicationListItem]` | Oldest first. No `job_id` = every job in one list; each row carries `job_title`, `job_location`. Read-only: never records VIEWED |
| GET | `/employer/applications/{id}` | OWNER/RECRUITER/VIEWER + active subscription | path | `EmployerApplicationDetail` | Opening a SUBMITTED application auto-moves it to VIEWED, once |
| POST | `/employer/applications/{id}/stage` | OWNER/RECRUITER + active subscription | path + `{stage, note}` | `EmployerApplicationDetail` | One stage forward, or REJECTED; 409 otherwise |
| PUT | `/employer/applications/{id}/interview` | OWNER/RECRUITER + active subscription | path + `{interview_at, meeting_url}` | `EmployerApplicationDetail` | Book/rebook, only at INTERVIEW stage (409 otherwise); 422 for a non-https link or a time over a year out |
| POST | `/employer/applications/{id}/hire` | OWNER/RECRUITER + active subscription | path | `EmployerApplicationDetail` | *Proposes* a hire (`employer_confirmed_at`) — HIRED itself is never the employer's to write. Only from DECISION stage (409 `hire_not_allowed`); idempotent |
| POST | `/employer/applications/{id}/messages` | OWNER/RECRUITER + active subscription | path + `{kind: INTERVIEW\|ASSESSMENT\|GENERAL, body, scheduled_at?, link?}` | `EmployerMessageResponse` (201) | 2026-09-29. Sent to the candidate **by email and in the app**; the employer never sees their address. INTERVIEW needs `scheduled_at`, ASSESSMENT needs `link` (https). 422 `message_invalid` with the reason as `code`; 409 `message_not_allowed_at_stage` once the application is closed; 429 `message_limit_reached` after 10 to one application in a day (plus `applications.message`, 300/hour per organisation) |
| GET | `/employer/applications/{id}/messages` | OWNER/RECRUITER/VIEWER + active subscription | path | `list[EmployerMessageResponse]` | Oldest first, with `sender_id` |
| GET | `/candidate/applications/{id}/messages` | CANDIDATE | path | `list[CandidateMessageResponse]` | Not paywalled. `employer_name`, never which recruiter wrote it |

## discovery — `/employer/discovery`

Masked search. The reveal route is mounted here too but lives in the
`candidate` module (see above) because it needs `display_value`, and
`discovery` may not import `scoring`.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/employer/discovery/candidates` | OWNER/RECRUITER + active subscription | `band[], skill[] (all must match), badge[], min_experience_years, state, city, q, cursor, limit` | `Page[MaskedCandidate]` | No name/phone/email/score on the card, ever — only band. Built entirely on `VISIBLE_CANDIDATES_CTE`, so a suppressed candidate never appears even though their search document still exists |

## billing — `/billing`

Payments and the gateway callback. **The only route that actually grants
anything** across subscriptions, courses, and interview purchases.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/billing/payments/{payment_id}` | any authenticated user | path | `PaymentResponse` | Own payments only; someone else's is 404 |
| POST | `/billing/callbacks/{provider}` | **Public** — HMAC-SHA256 (`X-Payment-Signature`) over the raw body, not a bearer token | path + raw body | `{received, duplicate}` | Unsigned or mis-signed → 401, nothing stored. This is where `process_callback` actually settles a payment and grants the entitlement |
| POST | `/billing/dev/payments/{payment_id}/simulate` | any authenticated user, dev-only (`PAYMENTS_PROVIDER=stub`) | path + `{outcome, failure_code?}` | `PaymentResponse` | Signs and runs the exact same callback code path a real gateway would |

## subscriptions — mounted twice: `/candidate/subscription` and `/employer/subscription`

`get_router()` returns `None` on purpose — nothing is mounted at a bare
`/subscriptions`; the same five routes are mounted once per audience with
different guards.

| Method | Path | Candidate guard | Employer guard | Body | Response | Notes |
|---|---|---|---|---|---|---|
| GET | `.../plans` | CANDIDATE | OWNER/RECRUITER/VIEWER | — | `list[PlanResponse]` | Plans on sale for that audience |
| GET | `.../` | CANDIDATE | OWNER/RECRUITER/VIEWER | — | `SubscriptionResponse` | Current state; anyone in the org can read |
| POST | `.../checkout` | CANDIDATE | OWNER only | `{plan_code, discount_code?}` | `CheckoutResponse` (201) | First purchase or manual renewal; grants nothing until the callback. With a code, `amount_minor` is discounted and `list_amount_minor` is the plan price; a refused code is 422 `discount_code_invalid` / `_expired` / `_exhausted` / `_already_used` / `discount_exceeds_price`. The code is used only when the payment succeeds |
| POST | `.../checkout/discount-preview` | CANDIDATE | OWNER only | `{plan_code, discount_code}` | `{list_amount_minor, discount_minor, amount_minor}` | Writes nothing, holds nothing. Same 422 codes. 40 tries/hour per person, shared with checkout |
| POST | `.../cancel` | CANDIDATE | OWNER only | — | `SubscriptionResponse` | Stops auto-renew at period end; idempotent |
| POST | `.../mandate` | CANDIDATE | OWNER only | — | `{state, max_amount_minor, valid_until, authorisation_url}` (201) | Sets up UPI AutoPay; stays manual until the payer approves in the UPI app; a debit still needs a NOTIFIED `mandate_debit_notices` row ≥24h ahead |

## engagement — `/candidate/streak`

Daily check-in points. Deliberately **not** behind `require_active_subscription`
— a lapsed subscriber shouldn't lose a streak for not paying — and
structurally unable to touch the score: `engagement` and `scoring` are kept
independent by import-linter.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/candidate/streak/me` | CANDIDATE | — | `StreakResponse` | Current streak, points, milestones; never counts "today" on its own |
| POST | `/candidate/streak/me/check-in` | CANDIDATE | — | `{counted, streak, changes[]}` | Idempotent per IST calendar day; call on every app open/foreground |
| GET | `/candidate/streak/me/points` | CANDIDATE | `limit` (1–200, default 50) | `list[StreakPointsChangeResponse]` | Newest first |

## college — `/college` (+ extra router at `/candidate/colleges`)

A college's organisation, seats, referral codes and rosters (Day 17), and the
consent a student gives it (Day 18). **Pay-first** gates issuing codes,
importing, committing, sending, and the student view; organisation, team,
onboarding, seats, revoking a code and discarding a preview stay open.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|---|
| POST | `/college/organisation` | business account, no org needed | `{name, institution_type}` | `CollegeResponse` (201) | Caller becomes COLLEGE_ADMIN |
| GET / PATCH | `/college/organisation` | any college role / ADMIN | `{name?, institution_type?}` | `CollegeResponse` | |
| GET / POST | `/college/team` | any college role / ADMIN | `{email, role}` | `TeamMemberResponse` | |
| PATCH / DELETE | `/college/team/{user_id}` | ADMIN | `{role}` | `TeamMemberResponse` / 204 | 409 if it would leave no admin |
| GET | `/college/onboarding` | any college role | — | `OnboardingResponse` | Versioned form + saved answers |
| PUT | `/college/onboarding/answers` | ADMIN | `{answers}` | `OnboardingResponse` | Merge-save |
| POST | `/college/onboarding/submit` | ADMIN | — | `OnboardingResponse` | 422 lists what is missing |
| GET | `/college/seats` | any college role | — | `SeatsResponse` | Counts only. The allowance is set by our staff: `PUT /admin/colleges/{tenant_id}/seats` |
| POST | `/college/referral-codes` | ADMIN + paid | `{expires_in_days, max_uses?}` | `ReferralCodeResponse` (201) | A credential: 60 bits, always expiring |
| GET | `/college/referral-codes` | any college role | — | `list[ReferralCodeResponse]` | |
| POST | `/college/referral-codes/{code_id}/revoke` | ADMIN | path | `ReferralCodeResponse` | Not paywalled. Linked students stay linked |
| POST | `/college/roster-imports` | any college role + paid | `{file_name, csv}` | `RosterImportResponse` (201; 200 same file) | Preview only: malformed and duplicate rows identified, nobody invited |
| GET | `/college/roster-imports`, `/{import_id}`, `/{import_id}/rows` | any college role | `row_state`, `cursor`, `limit` | imports / rows | Invitation tracking counts per import |
| POST | `/college/roster-imports/{import_id}/commit` | any college role + paid | path | `RosterImportResponse` | Duplicates re-checked; rows never invited are deleted |
| POST | `/college/roster-imports/{import_id}/discard` | any college role | path | `RosterImportResponse` | Not paywalled |
| POST | `/college/roster-imports/{import_id}/invitations/send` | any college role + paid | path | `{sent, invitations}` | Outbox event per invitation; delivery not live (DLT, SES) |
| GET | `/college/students` | any college role + paid | `cursor`, `limit` | `VisibleStudentsPage` | **Only students with live INDIVIDUAL consent.** Every page read writes an audit row (`college_students_listed`, ids only) |
| GET | `/college/students/{candidate_id}` | any college role + paid | path | `CollegeStudentResponse` | Name, display score and band, application/interview counts, platform hires. **404 unless the consent is live right now**; every open audited (`college_student_viewed`), re-opens included |
| GET | `/candidate/colleges/consent-terms` | CANDIDATE | `scope` = `ROSTER` (default) or `INDIVIDUAL` | `ConsentTermsResponse` | Send `consent_version` back with the act |
| GET | `/candidate/colleges` | CANDIDATE | — | `list[CollegeLinkResponse]` | Every grant, revoked ones included |
| POST | `/candidate/colleges/link` | CANDIDATE | `{code, consent_version}` | `CollegeLinkResponse` (201; 200 if linked) | Entering the code **is** ROSTER consent, nothing more |
| GET | `/candidate/colleges/invitations` | CANDIDATE | — | `list[CandidateInvitationResponse]` | Matched on the student's own verified contact |
| POST | `/candidate/colleges/invitations/{id}/accept` / `decline` | CANDIDATE | `{consent_version}` / — | `CollegeLinkResponse` / 204 | Accepting is ROSTER consent |
| POST | `/candidate/colleges/{college_id}/individual-visibility` | CANDIDATE | `{consent_version}` | `CollegeLinkResponse` (201; 200 if granted) | **A separate grant** (PRD 3.8). 404 `college_link_not_found` without a live link; 409 stale terms |
| POST | `/candidate/colleges/{college_id}/revoke` | CANDIDATE | `{scope: ROSTER\|INDIVIDUAL}` | `{college_id, revoked, revoked_at}` | **Immediate.** `INDIVIDUAL` keeps the link; `ROSTER` disconnects and ends the seat and INDIVIDUAL in the same statement. Never paywalled. Idempotent; 404 for a college never linked |

**A student's details (2026-09-29).** Served only under INDIVIDUAL consent to
the **current** words (`INDIVIDUAL_CONSENT_VERSION` placeholder-2-2026-09-29),
which name everything below; read only through the consent-joined functions
`college_student_details`, `college_student_courses` and
`college_student_applications` (migration 0005). A student who agreed to the
earlier words keeps the earlier view until they agree again —
`POST /candidate/colleges/{college_id}/individual-visibility` with the new
version replaces the old grant.

| Method | Path | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|---|
| GET | `/college/students/{candidate_id}/details` | any college role + paid | path | `CollegeStudentDetailsResponse` | Contact, city, locale, questionnaire answers in words (never the accessibility answer), whether a CV is confirmed, practice interviews completed, course progress (%), every application with its stage, and stage analytics. 409 `college_student_details_not_shared` on the earlier words; 404 without live consent. Audited (`college_student_viewed`, `view: details`) |
| GET | `/college/students/{candidate_id}/resume` | any college role + paid | path | `CollegeStudentResumeResponse` | The confirmed CV the score was built from: text, or a form's fields, and the uploaded file by presigned GET. 404 `college_student_resume_not_found` before there is one. Audited (`college_student_resume_opened`) |

## analytics — `/college/analytics`

Aggregates over the students linked to the college **right now**, read through
database functions that INNER JOIN live consent (invariant 9). Never cached, so
a revocation leaves every figure on the next request. Floors are config
(`analytics.privacy`): under `min_cohort_size` (default 10) connected students
only the counts show. Above it every figure is **exact** (client, 2026-09-30):
`min_cell_size` defaults to 1, which withholds nothing. A config row that raises
it makes a band or month under it `null`, together with a complement.

| Method | Path | Auth | Response | Notes |
|---|---|---|---|---|
| GET | `/college/analytics/overview` | any college role + paid | `CohortOverviewResponse` | Connected, individually visible, score distribution by band, median (rounded to 10), applicants, applications, interviews, platform hires. 500 `analytics_floors_invalid` on a bad config row |
| GET | `/college/analytics/placements` | any college role + paid | `PlacementReportResponse` | `source: PLATFORM` always. Hires both sides confirmed, by IST month (12) and job location (`OTHER` pools small ones). Disputed hires and outside placements never count |

## admin — `/admin` (+ extra router at `/disputes`)

Our own staff, who belong to the one **PLATFORM** tenant (Day 19, closing
blockers E10). Staff are provisioned by `scripts/create_platform_staff.py`,
never by a route. Who may call what is `admin.domain.CONSOLE_ROLES`;
`tests/invariants/test_admin_console.py` drives every route with every role.
**Every cross-tenant read writes its audit row before the read-only bypass
session opens**; a read whose audit cannot be written returns nothing.

| Method | Path | Roles | Body/Params | Response | Notes |
|---|---|---|---|---|---|
| GET | `/admin/kyb/submissions` | PLATFORM_ADMIN, KYB_REVIEWER | `state`, `cursor`, `limit` | `KybSubmissionsPage` | No answers. `review_required` shows `kyb.require_approval`: while false this is a record, not a queue |
| GET | `/admin/kyb/submissions/{submission_id}` | same | path | `KybSubmissionResponse` | Answers and documents. Audited (`admin_kyb_submission_opened`) |
| POST | `/admin/kyb/submissions/{submission_id}/decision` | same | `{decision, reason?}` | `KybSubmissionResponse` | `kyb.service.review`; reason required to reject or ask for more |
| GET | `/admin/integrity/signals` | PLATFORM_ADMIN, INTEGRITY_REVIEWER | `state` (OPEN), `severity`, `cursor` | `IntegritySignalsPage` | Oldest first, no evidence. Audited as a bypass read |
| GET | `/admin/integrity/signals/{signal_id}` | same | path | `IntegritySignalDetail` | Evidence can quote the CV. Audited |
| POST | `/admin/integrity/signals/{signal_id}/resolve` | same | `{outcome: CLEARED\|CONFIRMED, note?}` | `IntegritySignalDetail` | Only CLEARED restores search visibility. Final (409 twice). Never moves a score |
| GET | `/admin/tenants` | PLATFORM_ADMIN, KYB_REVIEWER, SUPPORT_AGENT | `type`, `status`, `q`, `cursor` | `TenantsPage` | Employers and colleges; never the PLATFORM tenant. Not audited (names no person) |
| POST | `/admin/tenants/{tenant_id}/suspend` | PLATFORM_ADMIN | `{reason}` | `SuspensionResponse` (201) | **Immediate**: every member's next request is 403 `tenant_suspended`; jobs leave the board; a college's seat access stops (E29). Deletes nothing. 409 if already suspended or PLATFORM |
| POST | `/admin/tenants/{tenant_id}/reinstate` | PLATFORM_ADMIN | — | `SuspensionResponse` | Lifting is a latch; 409 if not suspended |
| GET | `/admin/tenants/{tenant_id}/suspensions` | as `/admin/tenants` | path | `list[SuspensionResponse]` | Newest first |
| PUT | `/admin/colleges/{tenant_id}/seats` | PLATFORM_ADMIN | `{seats}` | `{allocated, used, filled}` | `college.service.allocate_seats`: never below used, never above the live plan (409 `college_seats_*`). Seats waiting students. Audited |
| GET | `/admin/candidates/{user_id}` | PLATFORM_ADMIN, SUPPORT_AGENT, INTEGRITY_REVIEWER | path | `CandidateDrilldown` | Masked phone/email, display score and band, resume counts (never content), signals, applications, subscription, college links, disputes. Audited every open |
| GET | `/admin/candidates/{user_id}/onboarding` | PLATFORM_ADMIN, SUPPORT_AGENT (`candidate_contact`) | path | `CandidateOnboarding` | 2026-09-29. Everything given at sign-up and on the profile, **contact unmasked**, questionnaire in words, college links. Audited |
| GET | `/admin/candidates/{user_id}/resume` | + INTEGRITY_REVIEWER (`candidate_resume`) | path | `CandidateResumeView` | The newest version and the newest confirmed one: text or fields, and the file by presigned GET. Audited (`admin_candidate_resume_opened`) |
| GET | `/admin/candidates/{user_id}/score-timeline` | as the drill-down | path | `ScoreTimeline` | Every score, oldest first: display value, band, change, and cause (FIRST_SCORE, RESUME_CHANGED, ADD_ON, RECOMPUTED). Never the stored number. Audited |
| GET | `/admin/candidates/{user_id}/interviews` | as the drill-down | path | `list[InterviewSessionRow]` | Every session with questions asked, answers stored, report status. Audited |
| GET | `/admin/candidates/{user_id}/interviews/{session_id}/recordings` | PLATFORM_ADMIN, SUPPORT_AGENT (`candidate_recordings`) | path | `list[InterviewRecordingRow]` | Presigned GET per answer, with question and transcript. Audited (`admin_interview_recordings_opened`) |
| GET | `/admin/candidates/{user_id}/courses` | as the drill-down | path | `list[CourseStatusRow]` | Purchase, lessons watched, percent, completion. Audited |
| GET | `/admin/candidates/{user_id}/applications` | as the drill-down | path | `CandidateApplications` | Every application with job, employer and stage, plus `analytics` (by stage, open, and how many ever reached SHORTLISTED / INTERVIEW / DECISION / HIRED). Audited |
| GET | `/admin/employers/{tenant_id}` | PLATFORM_ADMIN, SUPPORT_AGENT, KYB_REVIEWER | path | `EmployerDrilldown` | KYB, members, jobs, pipeline, subscription, suspension, distinct candidates viewed (1d/30d), anomaly flags. Audited |
| GET | `/admin/colleges/{tenant_id}` | PLATFORM_ADMIN, SUPPORT_AGENT | path | `CollegeDrilldown` | Counts only: seats, codes, consents by scope, imports, invitations. Audited |
| POST | `/admin/users/{user_id}/notification-suppressions` | PLATFORM_ADMIN, SUPPORT_AGENT | `{channel, reason}` | `{user_id, channel, created}` | Our stop (bounce, complaint, support request), apart from the person's preferences. Audited |
| GET | `/admin/disputes` | PLATFORM_ADMIN, SUPPORT_AGENT | `state`, `kind`, `party`, `cursor` | `DisputesPage` | Default OPEN + IN_REVIEW, oldest first, all three groups |
| GET | `/admin/disputes/{dispute_id}` | same | path | `DisputeDetail` | Description, cross-links (application's two sides, live integrity signals). Audited |
| POST | `/admin/disputes/{dispute_id}/assign` | same | — | `DisputeDetail` | Caller takes it; IN_REVIEW |
| POST | `/admin/disputes/{dispute_id}/resolve` | same | `{outcome: RESOLVED\|REJECTED, resolution}` | `DisputeDetail` | The raiser reads `resolution`. Changes nothing else. Closed is final |
| GET | `/admin/courses` | PLATFORM_ADMIN (`courses`) | — | `list[AdminCourseView]` | 2026-09-29. Every course at its latest version, with all modules and lessons |
| POST | `/admin/courses/{code}/modules` | same | `{title, sort_order?}` | `AdminCourseView` (201) | Audited (`course_content_changed`) |
| PATCH | `/admin/course-modules/{module_id}` | same | `{title?, sort_order?, active?}` | `AdminCourseView` | Switched off, never deleted |
| POST | `/admin/course-modules/{module_id}/lessons` | same | `{title, description?, duration_seconds, sort_order?, youtube_url?}` | `AdminLessonView` (201) | With `youtube_url` (YouTube hosts only; unlisted is watchable by anyone with the link) the lesson plays at once. Without it: upload |
| PATCH | `/admin/course-lessons/{lesson_id}` | same | `{title?, description?, duration_seconds?, sort_order?, active?, youtube_url?}` | `AdminLessonView` | |
| POST | `/admin/course-lessons/{lesson_id}/upload` | same | — | `LessonUploadResponse` | Presigned PUT (MP4/WebM, ≤2 GB) to `bharatpath-course-media`. Re-issuing takes the lesson off until confirmed |
| POST | `/admin/course-lessons/{lesson_id}/upload/confirm` | same | — | `AdminLessonView` | Size from S3, format from the bytes; a non-video is deleted (422 `course_lesson_media_invalid`) |
| PUT | `/admin/courses/{code}/published` | same | `{published}` | `AdminCourseView` | On sale needs ≥1 playable lesson (409 `course_not_publishable`). Off sale stops new purchases only |
| POST | `/admin/accounts/candidates` | PLATFORM_ADMIN | `{email}` | `ProvisionedAccountResponse` (201) | 2026-09-18. Makes the account; **Cognito emails a temporary password**; the first sign-in adopts it. 409 `identity_account_exists`. 502 `account_directory_unavailable` if Cognito refuses (nothing created). Audited |
| POST | `/admin/accounts/employers` | PLATFORM_ADMIN | `{owner_email, legal_name, employer_type?, industry?}` | same (201) | The employer and its owner. KYB and payment are the owner's as usual. 409 `identity_already_in_organisation`. Audited |
| POST | `/admin/accounts/colleges` | PLATFORM_ADMIN | `{admin_email, name, institution_type}` | same (201) | The college and its admin. Audited |
| POST | `/admin/tenants/{tenant_id}/members` | PLATFORM_ADMIN | `{email, role}` | same (201) | A member of an existing employer or college, with a role of its kind (409 `identity_cannot_add_member` otherwise). Invites anyone who has never signed in. Audited |
| POST | `/admin/accounts/{user_id}/resend-invitation` | PLATFORM_ADMIN, SUPPORT_AGENT | path | `{user_id, resent}` | Only before the first sign-in (409 `identity_account_already_active`). Audited |
| POST | `/admin/discount-codes` | PLATFORM_ADMIN | `{code?, audience, percent_off? \| amount_off_minor?, valid_from?, valid_until?, usage_limit?, label?}` | `DiscountCodeResponse` (201) | Omit `code` to generate one. Terms never change afterwards. 409 `discount_code_taken`. Audited |
| GET | `/admin/discount-codes` | PLATFORM_ADMIN, SUPPORT_AGENT | `audience`, `cursor`, `limit` | `DiscountCodesPage` | With `usage_count`, `status` (ACTIVE/SCHEDULED/EXPIRED/EXHAUSTED/DISABLED) and the placeholder `policy_version` |
| GET | `/admin/discount-codes/{code_id}` | same | path | `DiscountCodeResponse` | |
| POST | `/admin/discount-codes/{code_id}/disable` | PLATFORM_ADMIN | path | `DiscountCodeResponse` | For good; idempotent. Audited |
| GET | `/admin/discount-codes/{code_id}/redemptions` | PLATFORM_ADMIN, SUPPORT_AGENT | `cursor`, `limit` | `DiscountRedemptionsPage` | The usage log: payer, subscriber (organisation named), amounts, when |
| GET | `/admin/audit-events` | PLATFORM_ADMIN | `actor_id`, `action`, `target_type`, `target_id`, `tenant_id`, `from`, `to`, `cursor` | `AuditEventsPage` | Newest first, keyset. The search is itself audited with its filters |
| POST | `/disputes` | CANDIDATE, EMPLOYER_OWNER/RECRUITER, COLLEGE_ADMIN/STAFF | `{kind, application_id?, description}` | `MyDisputeResponse` (201) | HIRE needs an application the caller can see (else 404); colleges cannot dispute a hire (422). 5/day per person |
| GET | `/disputes` | same | — | `list[MyDisputeResponse]` | A candidate's own; an organisation's. No staff identities |

A candidate's `POST /candidate/applications/{id}/hire/dispute` also files a
HIRE dispute in the queue, as the candidate's (`admin.open_hire_dispute` task).

## notifications — `/notifications`

Every signed-in account, only its own messages. Never paywalled.

| Method | Path | Body/Params | Response | Notes |
|---|---|---|---|---|
| GET | `/notifications` | `cursor`, `limit` | `InboxPage` | In-app messages, newest first, with `unread` |
| POST | `/notifications/{notification_id}/read` | path | `InboxItem` | 404 for someone else's |
| GET / PATCH | `/notifications/preferences` | `{locale?, sms_enabled?, email_enabled?, push_enabled?, nudges_enabled?}` | `PreferencesResponse` | In-app cannot be turned off. The UPI pre-debit notice ignores an SMS opt-out |

Messages are caused by outbox events (`notifications.domain.plan_for`) and by
the incomplete-profile sweep. **No SMS is sent without a DLT template id**
(every one is `None` today) and no provider is configured by default, so
today only the in-app inbox delivers; every skipped message is still recorded
with its reason.

## privacy — `/privacy` (Day 20)

Every signed-in account, its own requests only. **Never paywalled** — a right
of access that costs a subscription is not a right of access.

| Method | Path | Body/Params | Response | Notes |
|---|---|---|---|---|
| POST | `/privacy/requests/export` | — | `DsrRequestResponse` (202) | One open export at a time (409 `dsr_request_already_open`). Built in the background |
| POST | `/privacy/requests/deletion` | — | `DsrRequestResponse` (202) | **Candidates only**; a business account gets 403 `dsr_deletion_requires_support` |
| GET | `/privacy/requests` | — | `DsrRequestList` | Newest first |
| GET | `/privacy/requests/{id}` | path | `DsrRequestResponse` | 404 for someone else's. Poll `download_available` |
| POST | `/privacy/requests/{id}/withdraw` | path | `DsrRequestResponse` | A deletion, while still RECEIVED. 409 `dsr_request_not_withdrawable` |
| GET | `/privacy/requests/{id}/download` | path | `ExportDownloadResponse` | A 10-minute link, minted per call and audited. 409 `dsr_export_not_ready` / `dsr_export_expired` |

`due_at` is when we have promised to answer (30 days). A deletion shows
`erasable_at`: nothing is destroyed before it, and the request can be
withdrawn until then. Afterwards the sweep erases the account in one
transaction — personal data destroyed, payment and audit records kept under
the legal carve-out, pointing at an account that identifies nobody. **A token
issued before an erasure stops working immediately** (401 `account_inactive`),
so a client holding one should sign the person out rather than retry.

The export is a zip of JSON, one file per section. It carries the score and
**not** how it was calculated — the platform never explains a score, and an
export is not a way round that.

## Rate limits (Day 20)

Two tiers, both answering **429** with a `Retry-After` header in seconds:

- **Global** — per IP, per user and per tenant, per minute. Generous: a guard
  against a runaway client, not something a person clicking can reach. An
  organisation's staff share one tenant budget.
- **Specific** — tightest on OTP (per phone and per IP, hourly; the route is
  off while phone OTP is deferred) and the employer threshold preview (per
  organisation, hourly); the privacy routes and discount codes (40/hour per
  person) have their own, looser ones.

A client should back off by `Retry-After` rather than retrying immediately;
retrying inside the window extends its own lockout, because the window counts
refused requests too.

## Stub modules — registered, no routes yet

| Module | Prefix | What's planned |
|---|---|---|
| integrity | `/integrity` | Nothing of its own: review routes live in `/admin/integrity` |

---

## Major flows

### 1. Candidate onboarding → score

```
POST /auth/otp/start
  → Cognito custom-auth (external, not this API)
GET  /auth/me

POST /candidate/resume/uploads              (presigned S3 ticket)
  → client PUTs the file straight to S3
POST /candidate/resume/uploads/{id}/complete   (queues async parse)
GET  /candidate/resume/files/{id}            (poll until terminal)
GET  /candidate/resume/versions/{id}         (review what was extracted)
POST /candidate/resume/versions/{id}/edit    (optional — makes a NEW version, back to review)
POST /candidate/resume/versions/{id}/confirm (the gate — nothing scores before this)
  → async: resume.version_confirmed → scoring
GET  /candidate/score/me                     (needs active subscription; PENDING until ready)
```

`POST /candidate/resume/text` and `POST /candidate/resume/manual` are
alternate entry points that skip file upload/scanning entirely but still land
at the same confirm gate before scoring will touch them.

### 2. Candidate job search → hire

```
GET  /candidate/jobs                         (eligibility computed from the STORED score)
GET  /candidate/jobs/{id}
POST /candidate/applications                 (403 if below threshold — no number given)
GET  /candidate/applications/{id}            (poll for stage changes)
  ... employer moves stage / books interview / proposes hire ...
POST /candidate/applications/{id}/hire/confirm   (or /hire/dispute)
```

### 3. Employer onboarding → publish a job

```
(Cognito business-pool sign-in, admin-provisioned account)
GET  /employer/reference
POST /employer/organisation                  (caller becomes owner)

GET/PUT /employer/kyb/*                      (form, answers)
POST /employer/kyb/documents (+ .../complete)
POST /employer/kyb/submit                    (auto-approves under default config, or queues)

POST /employer/subscription/checkout
  → gateway → POST /billing/callbacks/{provider}   (signed; this is what actually grants the subscription)
  (dev: POST /billing/dev/payments/{id}/simulate runs the same signed path locally)
GET  /billing/payments/{id}                   (poll for outcome)

POST /employer/jobs                          (draft; needs active subscription)
POST /employer/jobs/{id}/publish             (needs approved KYB — 403 kyb_required otherwise)
```

### 4. Employer discovery → reveal

```
GET /employer/discovery/candidates                       (masked search, band only)
GET /employer/discovery/candidates/{candidate_id}         (= candidate module's reveal route)
```
The reveal needs `require_active_access_window` (a live subscription check,
distinct 402 from search's `require_active_subscription`), approved KYB, and
is rate- and view-capped per organisation. Every call, including a re-open of
the same candidate, writes an `audit_events` row and a `candidate_view_events`
row in the same transaction.

### 5. Payment / entitlement flow (shared shape across subscriptions, courses, interview sessions)

```
POST <surface>/checkout          (subscriptions, courses, interview — same shape)
  → creates a Payment row, grants NOTHING yet
  → client is sent to the gateway
gateway → POST /billing/callbacks/{provider}   (HMAC-signed, public, no bearer token)
  → billing.service.process_callback verifies the signature and settles the
    payment — THIS is what grants the subscription / course ownership /
    interview session credit
client → GET /billing/payments/{payment_id}    (poll for outcome)
```
In non-prod, `POST /billing/dev/payments/{id}/simulate` signs and runs the
exact same callback path in place of a real gateway.

### 6. Add-on flows

**Questionnaire** (worth zero score points, by design):
```
GET /candidate/questionnaire
PUT /candidate/questionnaire/answers   (repeatable)
POST /candidate/questionnaire/submit
GET /candidate/questionnaire/report
```

**Mock interview** (bought per-session, not an entitlement):
```
GET  /candidate/interview/offer
POST /candidate/interview/device-checks
POST /candidate/interview/checkout          (needs a passed device check + acknowledgement past 3 sessions)
  → payment callback settles it
POST /candidate/interview/sessions
  for each question:
    POST .../answers/{i}/upload
    POST .../answers/{i}/complete
POST /candidate/interview/sessions/{id}/complete   (+20 to score, capped at +60 total)
```

**Courses** (completion is never a client call):
```
GET  /candidate/courses
POST /candidate/courses/{course_id}/checkout
  → payment callback grants ownership
  → courses.service.record_completion (internal only) → scoring.rescore_for_addons
```

### 7. College → linked students → analytics

```
POST /college/organisation → pay (/college/subscription) → seats allocated by our staff
POST /college/referral-codes            or   POST /college/roster-imports → commit → invitations/send
POST /candidate/colleges/link                 POST /candidate/colleges/invitations/{id}/accept
  → ROSTER consent: counted in /college/analytics/*, seat taken if free
POST /candidate/colleges/{college_id}/individual-visibility   (separate, optional)
  → INDIVIDUAL consent: named in /college/students, every read audited
POST /candidate/colleges/{college_id}/revoke {scope}
  → gone from both on the very next request
```

---

## Implementation status

Fully implemented with routes: identity, candidate, resume, scoring,
questionnaire, interview, courses, employer, kyb, jobs, applications,
discovery, billing, subscriptions, engagement, college, analytics, admin,
notifications.

Registered but empty (`router = APIRouter()`, no routes): integrity (its
review routes are under `/admin`), privacy. See `docs/blockers.md` and
`docs/plan.md` §14 for what's gating each.
