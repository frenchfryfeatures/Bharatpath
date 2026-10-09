# 02 — The full API checklist

**Purpose of this doc: nothing gets missed.** Every HTTP endpoint in the
backend is listed below, grouped by which surface calls it (Candidate app /
Employer console / College console / shared). Pulled directly from every
module's `router.py` — not from `openapi.json`, which is stale (only 5 paths)
because nobody has regenerated it recently.

**Status key:** ✅ fully walked through in conversation · 🟡 mentioned in
passing, not walked through in detail · ⬜ not covered yet.

Total: **208 operations** in a local build (dev-only routes included), across
21 modules — 26 added 2026-09-29 for the portal dashboards, and 26 older
ones this list had missed, now at the end. Only one module — `integrity` —
exposes **no** HTTP endpoints at all; it only runs as a background task,
triggered by other modules' events, and is never called directly. (An
earlier version of this doc also filed `admin`, `notifications` and
`privacy` here, incorrectly — all three have real, fully-built HTTP
surfaces that simply hadn't been walked through yet. That was the biggest
correction to come out of this pass.)

---

## Login / accounts (`identity`, prefix `/auth`)

| Status | Method | Path | What it's for |
|---|---|---|---|
| ✅ | POST | `/auth/otp/start` | Candidate: request an OTP (outer throttle only — Cognito+Twilio actually send it) |
| ✅ | GET | `/auth/me` | Anyone: "who does the server think I am" |
| ✅ | POST | `/auth/dev/token` | Local dev/test only — mints a fake-but-real token, skips Cognito entirely |

## Employer — organisation & team (`employer`, prefix `/employer`)

| Status | Method | Path | What it's for |
|---|---|---|---|
| ✅ | GET | `/employer/reference` | Employer types / industries for the signup form |
| ✅ | POST | `/employer/organisation` | Create the company, caller becomes Owner |
| ✅ | GET | `/employer/organisation` | Read the caller's own company |
| ✅ | PATCH | `/employer/organisation` | Owner edits company name/type/industry |
| ✅ | GET | `/employer/team` | List active team members |
| ✅ | POST | `/employer/team` | Owner invites someone by email |
| ✅ | PATCH | `/employer/team/{user_id}` | Owner changes someone's role |
| ✅ | DELETE | `/employer/team/{user_id}` | Owner removes someone |

## College — organisation & team (`college`, prefix `/college`)

| Status | Method | Path |
|---|---|---|
| ✅ | POST | `/college/organisation` |
| ✅ | GET | `/college/organisation` |
| ✅ | PATCH | `/college/organisation` |
| ✅ | GET | `/college/team` |
| ✅ | POST | `/college/team` |
| ✅ | PATCH | `/college/team/{user_id}` |
| ✅ | DELETE | `/college/team/{user_id}` |

## Employer — KYB verification (`kyb`, prefix `/employer/kyb`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/employer/kyb/form` |
| ✅ | GET | `/employer/kyb` |
| ✅ | PUT | `/employer/kyb/answers` |
| ✅ | POST | `/employer/kyb/documents` |
| ✅ | POST | `/employer/kyb/documents/{upload_id}/complete` |
| ✅ | POST | `/employer/kyb/submit` |

## Candidate — resume intake (`resume`, prefix `/candidate/resume`)

| Status | Method | Path |
|---|---|---|
| ✅ | POST | `/candidate/resume/uploads` |
| ✅ | POST | `/candidate/resume/uploads/{upload_id}/complete` |
| ✅ | GET | `/candidate/resume/files/{resume_file_id}` |
| ✅ | POST | `/candidate/resume/text` |
| ✅ | POST | `/candidate/resume/manual` |
| ✅ | GET | `/candidate/resume/versions` |
| ✅ | GET | `/candidate/resume/versions/{resume_version_id}` |
| ✅ | POST | `/candidate/resume/versions/{resume_version_id}/edit` |
| ✅ | POST | `/candidate/resume/versions/{resume_version_id}/confirm` |

## Candidate — score (`scoring`, prefix `/candidate/score`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/score/me` |

## Candidate — profile (`candidate`, prefix `/candidate`)

Covered in [05-jobs-and-discovery-apis.md §10](05-jobs-and-discovery-apis.md#10-the-candidates-own-profile--what-a-masked-card-and-the-reveal-are-built-from)
— these three fields are exactly what feeds `MaskedCandidate` and
`RevealedCandidate` there.

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/profile` |
| ✅ | PUT | `/candidate/profile/location` |
| ✅ | PUT | `/candidate/profile/name` |
| ✅ | GET | `/candidate/profile/views` |

## Employer — masked search & reveal (`discovery` + `candidate`, prefix `/employer/discovery`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/employer/discovery/candidates` | masked search results |
| ✅ | GET | `/employer/discovery/candidates/{candidate_id}` | the reveal — full profile |

## Employer — jobs (`jobs`, prefix `/employer/jobs`)

| Status | Method | Path |
|---|---|---|
| ✅ | POST | `/employer/jobs` |
| ✅ | GET | `/employer/jobs` |
| ✅ | GET | `/employer/jobs/threshold-preview` |
| ✅ | GET | `/employer/jobs/{job_id}` |
| ✅ | PATCH | `/employer/jobs/{job_id}` |
| ✅ | POST | `/employer/jobs/{job_id}/publish` |
| ✅ | POST | `/employer/jobs/{job_id}/pause` |
| ✅ | POST | `/employer/jobs/{job_id}/close` |

## Candidate — job board (`jobs`, prefix `/candidate/jobs`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/jobs` |
| ✅ | GET | `/candidate/jobs/{job_id}` |
| ✅ | GET | `/candidate/recommended-jobs/similar-to-applied` |
| ✅ | GET | `/candidate/recommended-jobs/matching-profile` |

## Candidate — applying (`applications`, prefix `/candidate/applications`)

| Status | Method | Path |
|---|---|---|
| ✅ | POST | `/candidate/applications` |
| ✅ | GET | `/candidate/applications` |
| ✅ | GET | `/candidate/applications/{application_id}` |
| ✅ | POST | `/candidate/applications/{application_id}/withdraw` |
| ✅ | POST | `/candidate/applications/{application_id}/hire/confirm` |
| ✅ | POST | `/candidate/applications/{application_id}/hire/dispute` |
| ✅ | GET | `/candidate/applications/{application_id}/messages` |

## Employer — the hiring pipeline (`applications`, prefix `/employer/applications`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/employer/applications` |
| ✅ | GET | `/employer/applications/{application_id}` |
| ✅ | POST | `/employer/applications/{application_id}/stage` |
| ✅ | PUT | `/employer/applications/{application_id}/interview` |
| ✅ | POST | `/employer/applications/{application_id}/hire` |
| ✅ | POST | `/employer/applications/{application_id}/messages` |
| ✅ | GET | `/employer/applications/{application_id}/messages` |

## Payments (`billing`, prefix `/billing`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/billing/payments/{payment_id}` |
| ✅ | POST | `/billing/callbacks/{provider}` |
| ✅ | POST | `/billing/dev/payments/{payment_id}/simulate` |

## Subscriptions — same 5 routes, 3 audiences (`subscriptions`)

| Status | Method | Candidate path | Employer path | College path |
|---|---|---|---|---|
| ✅ | GET | `/candidate/subscription/plans` | `/employer/subscription/plans` | `/college/subscription/plans` |
| ✅ | GET | `/candidate/subscription` | `/employer/subscription` | `/college/subscription` |
| ✅ | POST | `/candidate/subscription/checkout` | `/employer/subscription/checkout` | `/college/subscription/checkout` |
| ✅ | POST | `/candidate/subscription/cancel` | `/employer/subscription/cancel` | `/college/subscription/cancel` |
| ✅ | POST | `/candidate/subscription/mandate` | `/employer/subscription/mandate` | `/college/subscription/mandate` |

## Candidate — courses (`courses`, prefix `/candidate/courses`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/courses` |
| ✅ | POST | `/candidate/courses/{course_id}/checkout` |
| ✅ | GET | `/candidate/courses/{course_id}` |
| ✅ | POST | `/candidate/courses/{course_id}/lessons/{lesson_id}/progress` |

## Candidate — questionnaire, worth zero score (`questionnaire`, prefix `/candidate/questionnaire`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/questionnaire` |
| ✅ | PUT | `/candidate/questionnaire/answers` |
| ✅ | POST | `/candidate/questionnaire/submit` |
| ✅ | GET | `/candidate/questionnaire/report` |

## Candidate — mock interview (`interview`, prefix `/candidate/interview`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/interview/offer` |
| ✅ | POST | `/candidate/interview/device-checks` |
| ✅ | POST | `/candidate/interview/checkout` |
| ✅ | POST | `/candidate/interview/sessions` |
| ✅ | GET | `/candidate/interview/sessions` |
| ✅ | GET | `/candidate/interview/sessions/{session_id}` |
| ✅ | POST | `/candidate/interview/sessions/{session_id}/answers/{question_index}/upload` |
| ✅ | POST | `/candidate/interview/sessions/{session_id}/answers/{question_index}/complete` |
| ✅ | POST | `/candidate/interview/sessions/{session_id}/complete` |
| ✅ | GET | `/candidate/interview/sessions/{session_id}/report` |
| ✅ | POST | `/candidate/interview/sessions/{session_id}/next-question` |
| ✅ | GET | `/candidate/interview/sessions/{session_id}/recordings` |
| ✅ | GET | `/candidate/interview/history` |

## Candidate — daily streaks (`engagement`, prefix `/candidate/streak`)

Covered in [12-engagement-streak-apis.md](12-engagement-streak-apis.md).

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/streak/me` |
| ✅ | POST | `/candidate/streak/me/check-in` |
| ✅ | GET | `/candidate/streak/me/points` |

## Candidate — linking to a college (`college`, prefix `/candidate/colleges`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/candidate/colleges/consent-terms` |
| ✅ | GET | `/candidate/colleges` |
| ✅ | POST | `/candidate/colleges/link` |
| ✅ | GET | `/candidate/colleges/invitations` |
| ✅ | POST | `/candidate/colleges/invitations/{invitation_id}/accept` |
| ✅ | POST | `/candidate/colleges/invitations/{invitation_id}/decline` |
| ✅ | POST | `/candidate/colleges/{college_id}/individual-visibility` |
| ✅ | POST | `/candidate/colleges/{college_id}/revoke` |

## College — onboarding, seats, roster, students (`college`, prefix `/college`)

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/college/onboarding` |
| ✅ | PUT | `/college/onboarding/answers` |
| ✅ | POST | `/college/onboarding/submit` |
| ✅ | GET | `/college/seats` |
| ✅ | POST | `/college/referral-codes` |
| ✅ | GET | `/college/referral-codes` |
| ✅ | POST | `/college/referral-codes/{code_id}/revoke` |
| ✅ | POST | `/college/roster-imports` |
| ✅ | GET | `/college/roster-imports` |
| ✅ | GET | `/college/roster-imports/{import_id}` |
| ✅ | GET | `/college/roster-imports/{import_id}/rows` |
| ✅ | POST | `/college/roster-imports/{import_id}/commit` |
| ✅ | POST | `/college/roster-imports/{import_id}/discard` |
| ✅ | POST | `/college/roster-imports/{import_id}/invitations/send` |
| ✅ | GET | `/college/students` |
| ✅ | GET | `/college/students/{candidate_id}` |
| ✅ | GET | `/college/students/{candidate_id}/details` |
| ✅ | GET | `/college/students/{candidate_id}/resume` |

## College — analytics (`analytics`, prefix `/college/analytics`)

Covered in [11-college-analytics-apis.md](11-college-analytics-apis.md).

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/college/analytics/overview` |
| ✅ | GET | `/college/analytics/placements` |
| ✅ | GET | `/college/analytics/applications` |

## System

Covered in [01-architecture.md §8](01-architecture.md#8-system-health-checks--for-infrastructure-not-for-the-app).
No auth, no module, no client app ever calls these — a load balancer does.

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/api/v1/health` |
| ✅ | GET | `/api/v1/health/ready` |

## Admin console (`admin`, prefix `/admin`) — Day 19, staff only

**This entire section was missing until this pass** — the module was
recorded below as having no HTTP surface at all, which was never true.
Covered in [13-admin-console-and-disputes-apis.md](13-admin-console-and-disputes-apis.md).

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/admin/kyb/submissions` |
| ✅ | GET | `/admin/kyb/submissions/{submission_id}` |
| ✅ | POST | `/admin/kyb/submissions/{submission_id}/decision` |
| ✅ | GET | `/admin/integrity/signals` |
| ✅ | GET | `/admin/integrity/signals/{signal_id}` |
| ✅ | POST | `/admin/integrity/signals/{signal_id}/resolve` |
| ✅ | GET | `/admin/tenants` |
| ✅ | POST | `/admin/tenants/{tenant_id}/suspend` |
| ✅ | POST | `/admin/tenants/{tenant_id}/reinstate` |
| ✅ | GET | `/admin/tenants/{tenant_id}/suspensions` |
| ✅ | PUT | `/admin/colleges/{tenant_id}/seats` |
| ✅ | GET | `/admin/candidates` |
| ✅ | GET | `/admin/candidates/{user_id}` |
| ✅ | GET | `/admin/candidates/{user_id}/onboarding` |
| ✅ | GET | `/admin/candidates/{user_id}/resume` |
| ✅ | GET | `/admin/candidates/{user_id}/score-timeline` |
| ✅ | GET | `/admin/candidates/{user_id}/interviews` |
| ✅ | GET | `/admin/candidates/{user_id}/interviews/{session_id}/recordings` |
| ✅ | GET | `/admin/candidates/{user_id}/courses` |
| ✅ | GET | `/admin/candidates/{user_id}/applications` |
| ✅ | GET | `/admin/courses` |
| ✅ | POST | `/admin/courses/{code}/modules` |
| ✅ | PATCH | `/admin/course-modules/{module_id}` |
| ✅ | POST | `/admin/course-modules/{module_id}/lessons` |
| ✅ | PATCH | `/admin/course-lessons/{lesson_id}` |
| ✅ | POST | `/admin/course-lessons/{lesson_id}/upload` |
| ✅ | POST | `/admin/course-lessons/{lesson_id}/upload/confirm` |
| ✅ | PUT | `/admin/courses/{code}/published` |
| ✅ | GET | `/admin/employers/{tenant_id}` |
| ✅ | GET | `/admin/colleges/{tenant_id}` |
| ✅ | POST | `/admin/users/{user_id}/notification-suppressions` |
| ✅ | GET | `/admin/disputes` |
| ✅ | GET | `/admin/disputes/{dispute_id}` |
| ✅ | POST | `/admin/disputes/{dispute_id}/assign` |
| ✅ | POST | `/admin/disputes/{dispute_id}/resolve` |
| ✅ | GET | `/admin/audit-events` |
| ✅ | POST | `/admin/accounts/candidates` |
| ✅ | POST | `/admin/accounts/employers` |
| ✅ | POST | `/admin/accounts/colleges` |
| ✅ | POST | `/admin/tenants/{tenant_id}/members` |
| ✅ | POST | `/admin/accounts/{user_id}/resend-invitation` |
| ✅ | POST | `/admin/discount-codes` |
| ✅ | GET | `/admin/discount-codes` |
| ✅ | GET | `/admin/discount-codes/{code_id}` |
| ✅ | POST | `/admin/discount-codes/{code_id}/disable` |
| ✅ | GET | `/admin/discount-codes/{code_id}/redemptions` |

## Disputes — raised by candidates, employers, colleges (`admin`, prefix `/disputes`)

Mounted from the same `admin` module (it's where the console side, above,
and the raiser side meet). Also covered in
[13-admin-console-and-disputes-apis.md §9](13-admin-console-and-disputes-apis.md#9-disputes--where-the-three-external-parties-raise-and-read-their-own).

| Status | Method | Path |
|---|---|---|
| ✅ | POST | `/disputes` |
| ✅ | GET | `/disputes` |

## Notifications (`notifications`, prefix `/notifications`)

**Also missing until this pass.** Covered in
[14-notifications-inbox-apis.md](14-notifications-inbox-apis.md).

| Status | Method | Path |
|---|---|---|
| ✅ | GET | `/notifications` |
| ✅ | POST | `/notifications/{notification_id}/read` |
| ✅ | GET | `/notifications/preferences` |
| ✅ | PATCH | `/notifications/preferences` |
| ✅ | POST | `/notifications/unsubscribe` |

## Privacy / data rights (`privacy`, prefix `/privacy`)

**Also missing until this pass.** Covered in
[15-privacy-and-data-rights-apis.md](15-privacy-and-data-rights-apis.md).

| Status | Method | Path |
|---|---|---|
| ✅ | POST | `/privacy/requests/export` |
| ✅ | POST | `/privacy/requests/deletion` |
| ✅ | GET | `/privacy/requests` |
| ✅ | GET | `/privacy/requests/{dsr_id}` |
| ✅ | POST | `/privacy/requests/{dsr_id}/withdraw` |
| ✅ | GET | `/privacy/requests/{dsr_id}/download` |

## No HTTP endpoints (internal-only)

- **`integrity`** — runs as a background task after scoring; never called
  directly. This is the only module for which "no HTTP endpoints" was ever
  actually true — `admin`, `notifications` and `privacy` were incorrectly
  filed here in earlier passes of this doc and each now has its own
  section above.

---

**Running tally:** 160 ✅ · 0 🟡 · 0 ⬜ (of 160) — every endpoint in the
backend now has a walkthrough somewhere in this series. (Was 121 before
this pass turned up the entire admin console, `/disputes`, `notifications`
and `privacy` — 39 endpoints that a prior version of this checklist had
marked as not existing.)

## Routes this list missed until 2026-09-29

Found by comparing this file with the app's own route table. All are
walked through in the linked docs; they were simply never added here.

| Status | Method | Path | What it's for |
|---|---|---|---|
| ✅ | GET | `/admin/dashboard` | Console landing page ([13](13-admin-console-and-disputes-apis.md) §0.5) |
| ✅ | GET | `/admin/search-filters` | Curated skills/cities for employer search |
| ✅ | POST | `/admin/search-filters` | Add an option |
| ✅ | POST | `/admin/search-filters/import` | Import up to 500, all or none |
| ✅ | GET | `/admin/search-filters/{option_id}` | One option |
| ✅ | PATCH | `/admin/search-filters/{option_id}` | Edit / switch off an option |
| ✅ | GET | `/employer/dashboard` | Employer landing tiles ([06](06-applications-pipeline-apis.md) §8) |
| ✅ | GET | `/employer/dashboard/activity` | Recent activity feed |
| ✅ | GET | `/employer/discovery/filters` | Filter panel options, no counts |
| ✅ | GET | `/employer/discovery/filters/skills` | Skill typeahead |
| ✅ | GET | `/employer/discovery/filters/locations` | City typeahead |
| ✅ | GET | `/{candidate,employer,college}/subscription/plans` | Plans — the subscription routes are mounted three times ([08](08-billing-subscriptions-courses-apis.md) §4) |
| ✅ | GET | `/{employer,college}/subscription` | Current subscription |
| ✅ | POST | `/{employer,college}/subscription/checkout` | Buy a period |
| ✅ | POST | `/{candidate,employer,college}/subscription/checkout/discount-preview` | Price with a discount code |
| ✅ | POST | `/{employer,college}/subscription/cancel` | Stop auto-renewing |
| ✅ | POST | `/{employer,college}/subscription/mandate` | UPI AutoPay |
