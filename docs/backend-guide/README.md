# Backend guide — learn this codebase from zero

A from-scratch walkthrough of the BharatPath backend: what a backend is,
how this one is put together, and what every module does — written for
someone with no prior backend experience. This is separate from
[`docs/plan.md`](../plan.md) (the build plan and source of truth for scope)
and [`docs/how-it-all-connects.md`](../how-it-all-connects.md) (how the four
frontends reach this API in production) — this series is the "teach me the
backend itself" companion to both.

Read in order. Each doc assumes the ones before it.

## Foundations

| Doc | Covers |
|---|---|
| [00-foundations.md](00-foundations.md) | What a backend/API/database/cache/queue *is*, in general — for absolute beginners. |
| [01-architecture.md](01-architecture.md) | How *this* backend is shaped: the module template (router → service → repository), FastAPI dependencies, authentication, tenant isolation (RLS), and what "invariants" means here. |
| [02-api-checklist.md](02-api-checklist.md) | **Every API endpoint (208 operations in a local build), grouped by surface, with a status column.** The tracker that guarantees nothing gets skipped as this series goes on. |
| [03-login-signup-apis.md](03-login-signup-apis.md) | Login & signup, endpoint by endpoint: exact request/response JSON, field rules, error codes, for candidates, employers, and colleges. |
| [04-resume-and-scoring-apis.md](04-resume-and-scoring-apis.md) | The core loop: upload/paste/manual CV → review → the mandatory confirm gate → the `resume.version_confirmed` event → background scoring → `GET /candidate/score/me`. |
| [05-jobs-and-discovery-apis.md](05-jobs-and-discovery-apis.md) | Employer job posting lifecycle, the candidate job board, masked candidate search, and the audited "reveal" that shows name/contact/exact score. |
| [06-applications-pipeline-apis.md](06-applications-pipeline-apis.md) | The hiring pipeline state machine: apply → stages → the two-sided hire handshake (employer proposes, candidate confirms) → withdraw/expiry, and employer messages (interview / OA invitations by email + in-app). |
| [07-kyb-apis.md](07-kyb-apis.md) | Employer verification: the form, document upload, submit — and the one config switch that decides whether anyone actually reviews it. |
| [08-billing-subscriptions-courses-apis.md](08-billing-subscriptions-courses-apis.md) | Checkout → gateway redirect → signed callback → background settle → poll for status. Subscriptions (3 audiences) and course purchases both follow this exact pattern. Courses built from YouTube or uploaded lessons, locked until bought, completed by watching. |
| [09-questionnaire-and-interview-apis.md](09-questionnaire-and-interview-apis.md) | The questionnaire (structurally worth zero points) vs. the mock interview (+20/session, capped at 3, disclosed before payment) — device checks, AI-written questions that follow each answer and never repeat, history and playback, feedback without a number. |
| [10-college-apis.md](10-college-apis.md) | Onboarding, seats, referral codes, roster imports, and the two-scope consent model (ROSTER = counted, INDIVIDUAL = named) from both the college's and the student's side, and the consent-v2 details and CV views. |
| [11-college-analytics-apis.md](11-college-analytics-apis.md) | Cohort overview, platform-sourced placements and the application funnel — the number-only companion to Day 10's `GET /college/students`, and why nothing here ever names a person. |
| [12-engagement-streak-apis.md](12-engagement-streak-apis.md) | Daily check-in streaks and engagement points — a separate balance that can never move the 700–990 score, and why. |
| [13-admin-console-and-disputes-apis.md](13-admin-console-and-disputes-apis.md) | The platform-staff console (30 endpoints) — KYB/integrity review, tenant suspension, seats, the candidate list and cross-module drill-downs, disputes, audit search, staff-made accounts, discount codes, the full candidate page (CV, score timeline, recordings) and course building. |
| [14-notifications-inbox-apis.md](14-notifications-inbox-apis.md) | The in-app inbox and per-channel notification preferences — the reading side of a module that only ever answers, never triggers a send. |
| [15-privacy-and-data-rights-apis.md](15-privacy-and-data-rights-apis.md) | Export and erasure requests (DPDP Act rights): the 24-hour cooling-off window, the withdraw path, and the one-time-mint download link. |
| [16-profile-images-apis.md](16-profile-images-apis.md) | Profile photos for every account, and employer and college logos: the three-call upload, what the server keeps (re-encoded, no metadata), and who may see a student's photo (the student and staff only). |

## Modules

One doc per module, in roughly build order (each leans on the ones before
it). Written as each is covered — not all exist yet.

| Day | Module | Doc | Status |
|---|---|---|---|
| 1–2 | `identity` | — | not yet written |
| 6 | `resume` | — | not yet written |
| 7 | `scoring` | — | not yet written |
| 7 | `integrity` | — | not yet written |
| 9 | `employer` | — | not yet written |
| 9 | `discovery` | — | not yet written |
| 10 | `kyb` | — | not yet written |
| 10 | `jobs` | — | not yet written |
| 11 | `candidate` | — | not yet written |
| 12 | `applications` | — | not yet written |
| 13–14 | `candidate` (masked search, reveal) | — | not yet written |
| 15 | `billing` | — | not yet written |
| 15 | `subscriptions` | — | not yet written |
| 15 | `courses` | — | not yet written |
| 16 | `questionnaire` | — | not yet written |
| 16–17 | `interview` | — | not yet written |
| 17–18 | `college` | — | not yet written |
| 18 | `analytics` | — | not yet written |
| — | `engagement` | — | not yet written |
| — | `notifications` | — | not yet written |
| — | `admin` | — | not yet written |
| — | `privacy` | — | not yet written |

## Cross-cutting

| Doc | Covers |
|---|---|
| — | Testing, CI, migrations, background jobs — not yet written |
| — | Glossary/index across the whole series — not yet written |

---

**Note on accuracy:** these docs describe what's actually implemented, cross-
checked against the code and against [`docs/progress.md`](../progress.md)
(which tracks what's done vs. partial). Where a module is only partially
built, the doc says so rather than describing the plan as if it were done.
