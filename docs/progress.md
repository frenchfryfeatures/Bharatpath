# Progress log

Running record of what has been built, what is blocked, and what is next.
**Update this at the end of any session that changes state.**

`plan.md` §14 holds the formal tracker; this file holds the narrative and the
operational detail — resource IDs, gotchas, and the reasoning behind partial
states. Newest entries first.

---

## 2026-10-09 — recommended jobs on the candidate home screen

Asked for by the user, after Naukri's home page: two sections, **jobs like
the ones you applied for** and **jobs that fit your profile**. Backend only.
The app teams get the contract in `backend-guide/05` §7.

- `GET /candidate/recommended-jobs/similar-to-applied`: matched on the
  skills, title words and places of the last 20 applications, ignoring
  withdrawn ones.
- `GET /candidate/recommended-jobs/matching-profile`: matched on the career
  profile's key skills, desired role, current title, role category,
  preferred locations, city and experience.
- Both are paywalled like the board. Both show only board jobs (published,
  PUBLIC) and never one already applied to. Both carry `eligibility` and
  `matched_skills`, and no threshold or relevance number. `has_basis: false`
  tells the app to prompt rather than show an empty list.
- **Deliberately not used:** gender and salary from the profile (salary's
  unit is not fixed by the form), and the job's threshold in the ordering.
- **Weights are ours** (skill 3, title word 4, place 2, experience fit 1, in
  `jobs/domain.py`). No client decision behind them. Tune them by changing
  that file; no schema or migration is involved.
- Tests: `tests/unit/test_job_recommendations.py`,
  `tests/integration/test_job_recommendations.py`.

---

## 2026-10-09 — backend review: comments, dead code, stale claims

Asked for by the manager: make the backend read as production code. Branch
`chore/backend-production-review`. **No behaviour change**; the suite and
every CI check pass on a freshly rebuilt database.

- **Comments say why, not when.** About 330 "Day N", "Week N gate", "Round
  7.x" and closed-blocker references across `app/`, `scripts/`, `tests/` and
  `.importlinter` were rewritten into the rule and its reason. Client
  decisions keep their date where the date is the reason; open blocker ids
  stay. Migration SQL was left alone: it is the record of what ran.
- **About twenty comments were false, not merely dated**, and were
  corrected: five periodic tasks claiming EventBridge and "not provisioned"
  (all on beat); the masked card "cannot hold a name" (it carries
  `full_name`); the employer subscription gate "lands on Day 15" (it is on
  every employer route); hidden text "never populated"; interview question
  sets presented as what candidates are asked; the course described as
  seeded and assessment-based; employer types "validated against
  `config_values`" (they are checked against `employer/reference.py`);
  "deployments use SQS" (Redis, E44).
- **Dead code removed.** Nine placeholder files from the module scaffold,
  an empty `integrity/router.py`, an empty `tests/contract/` package, the
  unused `ASSESSMENT_*` constants, and `app/core/idempotency.py` with its
  two error classes -- no route ever used it. The six operations it claimed
  are idempotent through their own state (commit `e945198` lists how).
  `gen_modules.py --check` now checks registration, not that eight files
  exist in every module.
- **`backend/README.md` rewritten**: port 8099, `dev_all.sh` and beat,
  incremental migrations, RFC 9457 and the second error shape, and an
  invariant table naming the proving test. `CLAUDE.md` corrected where it
  had gone stale (E4, E6, E15, E32 closed; `allocate_seats` routed).

**Left for a decision:** the `idempotency_keys` table is unused and kept
(documented on its model); dropping it is a migration on every shared
database. The `celery_broker_url` default is still `sqs://`, which fails
loudly at worker boot if the variable is ever missing.

---

## 2026-10-07 — business MFA is optional, off by default (closes E37)

The client asked for business users (employers, colleges, staff) to turn
authenticator-app MFA on or off themselves, off by default.

- **Terraform only.** Business pool `mfa_configuration` `"ON"` → `"OPTIONAL"`,
  software token still enabled (it is the only factor -- no SMS). Under `ON`
  a user cannot turn it off; with `OFF` they cannot turn it on. The API
  never checked MFA, so no code changed -- docstrings and docs that said
  "mandatory" were corrected.
- **Not yet applied.** `terraform plan -out` must show an **in-place update**
  of `aws_cognito_user_pool.business`; a replace would delete every business
  user.
- Users enrolled while it was mandatory keep MFA until they turn it off. A
  lost device is a staff reset (`admin-set-user-mfa-preference`); there is no
  console route.
- Frontend: sign-in already handles both cases. The settings toggle is new
  and calls Cognito directly -- `docs/signup-and-accounts.md` → _MFA for
  business accounts_.

---

## 2026-10-07 — two seeded test accounts renamed on the deployed stack

The client-facing demo showed a developer's name in two sign-in emails, so the
seeded employer and institute accounts were moved to neutral addresses
(requested by Rishabh). Done on the deployed stack (account `335345888157`),
not locally:

- `vanshadiyora@gmail.com` → `testingemployer@gmail.com`
- `diyoravansh@gmail.com` → `testinginstitute@gmail.com`

**Both stores had to change.** Sign-in matches the Cognito email, while our
`users.email` is what the app shows; the rows join on `cognito_sub`, so
`users.id` and all seeded data were untouched. Cognito: business pool
`ap-south-1_YlPonHUV6`, `admin-update-user-attributes` with
`email_verified=true`, run by hand in CloudShell (the host's instance role has
no `AdminUpdateUserAttributes`, deliberately). Database: one transaction as the
migrator, one row each.

**These two addresses are not real mailboxes.** An email code sent to them goes
nowhere; any flow that needs one cannot be completed by the client. Passwords
are unchanged and are not recorded here.

---

## 2026-10-06 — company settings save to the server (PR #56)

From the backend review of PR #56. The new company tab saved trade name,
website, about, headcount **and PAN/GSTIN/CIN/TAN** to `localStorage` under
keys shared by every account on the browser, sent only `industry` to the API
(errors swallowed, "saved" shown regardless), "locked" identifiers in the
browser only, and drew all three KYB undertakings as accepted whatever was
stored.

- **Backend:** `employers` gains `trade_name`, `employee_count_band`,
  `website` (https only, like a job's external URL) and `about` (1,000
  chars); `PATCH /employer/organisation` edits them, blank or null clears.
  Migration `0013_employer_profile` (idempotent, after `0012_job_details`, so
  **PR #54 merges first**). `EMPLOYEE_COUNT_BANDS` moved to
  `app.core.reference`.
- **Frontend:** the four fields load from the organisation (from the KYB
  answers until the profile is first saved) and save through the PATCH,
  changed fields only; a failure is shown and nothing claims success.
  Statutory details are read-only from KYB with a link back to verification
  while it is still editable. The undertakings show what was ticked. The
  correspondence address is dropped (decision: nowhere to keep it). The old
  `localStorage` keys are removed on load.
- `resume-showcase.tsx` read the clock during render (a lint error the PR
  added); it now reads it once at mount.

---

## 2026-10-06 — review fixes on the job posting (PR #54)

From the backend review of PR #54. Decisions by the backend lead.

- **The external apply route is withheld from anyone `apply` would refuse.**
  The student page drew "Apply on company site" with no eligibility check
  and the API sent `external_url` to every candidate, so an EXTERNAL job with
  `min_score` took anyone and a HIGH integrity signal stopped nothing. Now
  `for_candidate(..., may_apply=)` drops the link and the email unless the
  candidate is ELIGIBLE and visible; `BoardJobDetail.can_apply_externally`
  tells the client. The method/URL validator moved to the employer's
  `Application` so the candidate's copy may hold EXTERNAL without its link.
- **Screening questions may not ask about age or gender** -- English,
  romanised Hindi and Devanagari, question and options. Deliberately narrow
  ("man-hours" and "stage" pass) so it refuses the person, never the work.
- **Salary "not disclosed" stays display-only** (option a). The range is still
  sent, as PRD 5.2 requires; the composer now says so. Hiding it from the API
  is the client's call and would make the salary fields nullable for mobile.
- **"Invite only" relabelled "Unlisted (link or invitation)"**: nothing
  enforces an invitation. Referrals, applicant access and scheduled
  publication are hidden from the composer and the job view; their stored
  values round-trip untouched.

## 2026-10-06 — the frontend builds again (7 type errors)

`cd frontend && npm run build` failed on the branch `Rishabh/CreateJobUpdate`.
`tsc --noEmit` named exactly seven errors, both from commits that touched one
side of a shared component and not the other.

- **`store/shortlist/shortlist.api.ts`** typed `EmployerInvitation.candidate`
  as `{ full_name, city, band }` while the invitation drawer read
  `state_code`, `experience_years` and `skills` too. The block is the
  backend's `ApplicantCard`, which returns all of those plus `badges`, so the
  type was stale rather than the UI wrong. It now mirrors `ApplicantCard`
  exactly (`ShortlistedCandidate`, reusing `CandidateBand`/`CandidateBadge`).
  **No contact and no score** — widening it to `ApplicantProfile` would put a
  reveal's fields on a list row.
- **`ParsingStep` gained a required `onCancel`** (commit `9f6a4c1`, "Update the
  student flow") with the button *Cancel and return to previous resume*.
  `resume-details.tsx` was wired; the sign-up flow was not, so its call site
  failed. The prop is now optional and the button renders only when a caller
  passes one: sign-up has no previous resume, so the label would be a lie
  there.
- Both `tsc --noEmit` and `npm run build` exit 0 afterwards. The four
  remaining `npm run lint` errors are pre-existing, in files not touched.

---

## 2026-10-06 — the resume prefill no longer fails on one bad field

`POST /auth/resume-preview` answered 503 `resume_prefill_unavailable` for some
CVs while OpenAI answered 200 each time, and the same file usually worked on
retry. Reproduced on the host, one run in eight: the model wrote the city as
"Bengaluru, Karnataka", `normalise_city` refuses the comma, and that one
`ValidationError` discarded the whole draft. The strict schema cannot carry
`CareerDetails`' rules (lengths, phone and date formats, the city's
characters, the cross-field checks), so any of them could do the same.
`/candidate/profile/prefill` did not catch it at all and answered 500.

- **`candidate.extraction.draft_from`** validates the model's answer and
  leaves each refused field blank (one bad list item, not the list), for the
  person to fill. A cross-field error names no field; the first of
  `_CROSS_FIELD` whose removal clears it is dropped. The rules are unchanged:
  nothing they refuse is kept, so a city still never carries a PIN or digits.
- The prompt now asks for the city name alone.
- Logs `career_prefill_fields_dropped` (field names only) and, on the 503 that
  remains (OpenAI unreachable or a truncated answer),
  `resume_prefill_unavailable` with the reason. Neither logs a value.
- Tests: `tests/unit/test_career_prefill_draft.py`.

---

## 2026-10-06 — the structured CV on the employer, admin and college views

Asked for by the portal team. Earlier the same day the structured document
was kept to the candidate's own screens; it now also rides on every surface
that already shows the whole CV, and nowhere else.

- **Where:** `SharedResumeView` (the reveal, `GET /employer/discovery/
  candidates/{id}`, and the opened application, `GET /employer/applications/
  {id}`), the admin `ResumeVersionView` (`GET /admin/candidates/{id}/resume`)
  and `GET /college/students/{id}/resume`. Each gains `structured_resume` and
  `structured_status`, filled by `structuring.structured_view`. Additive.
- **Why it is safe there:** each of these already returns `raw_text` and the
  original file, so the structured document holds nothing new -- the same
  contacts, in fields. The confirm gate is unchanged (employer and college
  read confirmed versions only; admin `latest` already showed drafts).
- **Not on `GET /college/students`.** That is a list under one
  `college_students_listed` audit row; the CV is its own endpoint, its own
  audit row and its own consent-version check. The portal reads `/resume`.
- **No back-fill** (decided by the backend owner): versions from before today
  read `UNAVAILABLE` and the apps draw `sections`/`text`. A back-fill would
  need its own table, since a version is immutable.
- **`resume.service.shared_fields`** now builds `fields` for all three
  surfaces. Admin and college used `dict(parsed)`, which sent a form-built
  CV's `extractor` provenance block; it is stripped, as `shared_resume`
  already did.
- Tests: `test_resume_structured_view.py` (shared, admin, `shared_fields`),
  `test_college_student_details.py` (READY and UNAVAILABLE on `/resume`).

---

## 2026-10-06 — the full job posting, and one job page for every portal

Branch `Rishabh/CreateJobUpdate`. The client asked for a Naukri-style job page
and a twelve-section job composer.

- **`jobs.details`** (migration `0012_job_details`, JSONB, `{}` default),
  validated by `jobs/details.py` `JobDetails`: basics, extra locations,
  experience max and salary period/type/disclosure, responsibilities and
  qualifications, preferred skills and tools, education, languages and notice
  period, application method, screening questions, hiring process, visibility.
  Strict shape, optional presence -- an old client sending no `details` still
  works. The composer decides what is required.
- **Refused, deliberately: minimum/maximum age and gender.** Invariant 5 and
  the discrimination rule (`blockers.md` C3). `extra="forbid"` makes either a
  422; `test_a_job_cannot_ask_for_age_or_gender` holds it. The composer says so
  in section 7.
- **Candidates read `CandidateJobDetails`**: no hiring manager, no screening
  questions or knockout answers, no internal settings (featured only).
- **Enforced**: visibility -- only PUBLIC jobs are listed on the board;
  PRIVATE/INVITE_ONLY are published but unlisted (open by link). External
  application URLs must be https.
- **Recorded, not yet acted on**: screening questions are not asked at apply
  (the apply request is held to `job_id` alone by a test); cover letter and
  portfolio are shown, not collected; `featured` is a badge, not a ranking;
  referrals and applicant access change no permission; `publish_on` is a
  planned date, publishing stays manual. Salary "not disclosed" hides the
  range on screen (`salary_disclosed` on board rows) but the range is still
  mandatory and still in the API (PRD 5.2).
- **Frontend**: `features/jobs/` holds the shared types and
  `JobDescriptionView` (tone `student` / `employer`), used by the student job
  page, the new employer page `/employer/jobs/[id]` and the composer preview.
  Colleges have no job surface to put it on. The mobile app is unchanged.

---

## 2026-10-06 — the CV as structured JSON, for review and preview

Backend only, asked for by the backend owner: give the apps the CV as fields
(contacts and profile links, each job, each qualification, projects,
certifications, languages, the rest) rather than the parser's text.

- **`resume/structuring.py`**: one OpenAI call per created version, schema
  `StructuredResume` (facts only -- no rating, nothing on age, gender, marital
  status or family; the prompt forbids them and `_without_personal_details`
  drops what slips into the catch-all sections). Links become full https URLs.
- **Written beside `raw_text` at creation**, under `parsed.structured_resume`
  with status, model id, prompt and schema versions -- in the parse task,
  `/intake`, paste and text/section edits. A version is immutable, so it is
  never added later. Form-built versions are mapped on read, with no model.
- **Never scored.** `raw_text` is still Layer 1's input (`sections.py` says
  why) and no scoring code reads the new key. Employer, college and admin
  views show `fields` only for text-less versions, so they never see it.
- **Best effort.** No key, switched off (`RESUME_STRUCTURING_ENABLED`) or a
  failed call stores `UNAVAILABLE`/`FAILED` and the version is still created;
  the sections view remains. CI has no key, so CI never calls it.
- **Responses:** `GET /resume/versions/{id}` gains `structured_resume` and
  `structured_status` (the stored copy is left out of its `parsed` echo);
  `GET /resume/versions/{id}/preview` gains the same two keys. Additive:
  `parsed.raw_text` and `sections` are unchanged for the apps until they switch.
- **Cost and latency:** the model call sits inside `/intake`, paste and edit
  requests (seconds), and in the parse task. Versions made before today read
  `UNAVAILABLE` and are not back-filled.
- Tests: `tests/unit/test_resume_structuring.py`,
  `tests/integration/test_resume_structured_view.py`.

---

## 2026-10-06 — filters on the employer's jobs and applications lists

Asked for by the portal team; the filter set is ours (no UI spec existed).
All filters AND together; dates are IST days, both ends inclusive, through
`app.core.pagination.ist_day_range` (422 `invalid_date_range` when inverted).

- **`GET /employer/jobs`**: `status` now repeatable, plus `work_mode`, `skill`
  (whole, any case -- the board's `_has_skill`), `created_from`/`created_to`.
- **`GET /employer/applications`**: `stage` now repeatable, plus `status`
  (ACTIVE/CLOSED, `STATUS_STAGES`), `q` (applicant's profile name),
  `applied_from`/`applied_to`, `order=oldest|newest` (default unchanged).
- **The name search is discovery's** (`applicants_named`, on the CTE). Searching
  `candidate_profiles` from `applications` would find a hidden candidate by
  name and their `candidate: null` row would confirm who it is. Ids only, not
  audited; the page drawn from it is, through `applicant_cards`.
- Both changes are additive: a single `?status=`/`?stage=` still works.
- Tests: `tests/integration/test_employer_list_filters.py`.

REJECTED / WITHDRAWN / EXPIRED may be re-invited -- confirmed by the backend
owner the same day.

## 2026-10-06 — no invitation to a candidate already hired for the job

Portal team found an invitation going to a candidate who was already HIRED for
that job. `shortlist_candidate` refused only `repository.active_for`, which
excludes `TERMINAL_STAGES`, and HIRED is terminal -- so a candidate who applied
directly and was hired had no shortlist row and nothing stopped the invite.
Now 409 `already_hired` (`params.application_id`), `repository.hired_for`,
test `test_a_candidate_already_hired_for_the_job_is_not_invited`. REJECTED,
WITHDRAWN and EXPIRED still allow a fresh invitation, by decision.

**Not changed:** an invitation sent *before* the hire stays INVITED, and
`insert_if_absent` lets a hired candidate apply to the same job again.

---

## 2026-10-05 — applicants named, CVs to employers, the shortlist, passwords

Backend only. Six requests from the portal teams, agreed with the backend owner.

### Built

- **Password minimums** (`infra/terraform/cognito.tf`): candidate pool 12 → **8**,
  business pool 14 → **12**. **Applied 2026-10-05** (`2 changed`, in place;
  confirmed with `describe-user-pool`, and a re-plan shows no drift). Web and
  app forms still enforce their own length until their teams change it.
- **`GET /candidate/applications?status=ACTIVE|CLOSED`** -- ACTIVE is the
  pipeline stages, CLOSED the terminal ones (`applications.domain.STATUS_STAGES`).
- **The pipeline names who applied.** List rows carry `candidate`
  (`ApplicantCard`: name, band, experience, skills, badges, city -- no
  contact, no score). The opened application carries `candidate`
  (`ApplicantProfile`: plus phone, email, display score and the CV). Both go
  through `discovery.applicant_cards` / `open_applicant`, built on
  `VISIBLE_CANDIDATES_CTE` and joined to the tenant's own application, so a
  candidate a HIGH signal hides is an application with `candidate: null`.
  **Audited**: one `applicants_listed` row per list page, one
  `applicant_profile_viewed` per response that carries the profile (the moves
  included). No view caps and no view event: they applied.
- **The CV on the reveal and the opened application** --
  `resume.service.shared_resume`, confirmed versions only, `SharedResumeView`
  (text, sections from `resume/sections.py`, form fields, presigned file
  link with `file_url_expires_at`).
- **The shortlist** (`employer_shortlists`, migration `0010`). From an opened
  profile an employer **saves** a candidate (private) or **invites** them to
  a published job. The candidate sees invitations at
  `/candidate/shortlist-invitations` and is emailed; **accepting files the
  application and lands it at SHORTLISTED** (SUBMITTED by the candidate,
  VIEWED and SHORTLISTED as the inviting employer's), through the SECURITY
  DEFINER `accept_shortlist_invitation`. A decline stands for that job; an
  employer may cancel and re-invite before an answer. The reveal carries
  `shortlist` (button state). Guard trigger, RLS (tenant + two candidate
  policies; a SAVED row is never the candidate's to see), erasure plan,
  `erase_candidate` replaced, export section `shortlists`.
- **Integrity queue** carries rule title and description
  (`integrity.domain.RULE_TEXT`), `hides_candidate`, the candidate's name and
  masked contact, other open signals, resolver and note. The detail adds the
  resume version's dates, display score and band, `visible_to_employers` and
  the candidate's other signals. Never the CV text (its own endpoint).

### Decisions taken inside that work

- **`test_the_pipeline_is_not_a_candidate_profile` was narrowed, not
  dropped**: the application's own fields still name nobody, and identity
  rides only in the audited `candidate` block. `REVEALED_FIELDS` gained
  `resume` and `shortlist`.
- **Shortlisting needs a prior reveal by the same organisation**
  (`discovery.require_shortlistable`). Otherwise the shortlist list would show
  names of people picked off masked cards, a reveal that skipped the caps.
- **A VIEWER sees who applied and the score, never contact or the CV**
  (`applications.service.CONTACT_ROLES`): the reveal already refuses viewers,
  and the pipeline must not be a way round that.
- **Accepting is not paywalled and skips the job's minimum score**: the
  employer chose the person. The discovery rule still applies.
- **No stage-changed events on accept**, only `application_submitted` (when the
  application is new) and `shortlist_answered`: the candidate just said yes, and
  a "you were shortlisted" email a second later is noise.
- Invitations are rate-limited at 60 an hour per organisation
  (`applications.shortlist_invite`). Ours.

### Found while building

- **The data export reads RLS-protected sections on an unbound session**
  (`app/tasks/privacy_requests.run_export`): `applications`, `messages`,
  `colleges` and now `shortlists` will read empty under the app role. No test
  looks at those sections' contents. Not fixed here.
- Non-English strings for the new notification carry the bundles'
  `needs_native_speaker_pass`.

---

## 2026-10-05 — resume loading follows the backend parse state

The resume-reading checklist no longer advances through contact, education,
experience, skills, and certificates on a client-side timer. The backend
exposes the parse as one authoritative `QUEUED` → terminal operation, not five
section-level jobs, so the UI now keeps the loader on the first pending row
until polling reports that parsing really finished. Only then does it show the
section results returned by the completed resume version; failures stop the
loader and retain the existing recovery actions.

---

## 2026-10-05 — sidebar identities never display internal IDs

All four portal sidebars now use the server-authoritative identity returned by
`GET /auth/me`: a candidate's profile name first, then the account email, then
a readable role/account label. The frontend previously ignored `email` and
`full_name` from that response and could display Cognito's opaque username
claim (often a UUID). UUIDs, user IDs, and tenant IDs are now explicitly
rejected as display-label fallbacks in both the shared portal sidebar and the
student sidebar.

---

## 2026-10-05 — admin email-only user invitations verified end to end

The admin Users page has a separate Invite action for candidates, employers,
and institutions. Its drawer asks only for the recipient's email; the active
tab supplies the backend's required account kind so Cognito selects the
candidate or business user pool. This path does not create a local user,
profile, or organisation. Integration coverage now holds all three mappings,
email normalization, the no-local-account invariant, and the required kind.
Invite failures also use invitation-specific wording in the frontend.

---

## 2026-10-03 — Terraform records the mobile app's Cognito sign-in flow

A plan for an unrelated change wanted to remove `ALLOW_USER_PASSWORD_AUTH`
from the candidate pool's app client. Someone had enabled it in the console,
and the mobile app signs in with `InitiateAuth` `USER_PASSWORD_AUTH`
(`mobile-app/services/api/auth.ts`), so applying the plan would have broken
mobile sign-in. `cognito.tf` now lists it; a full plan shows no resource
changes.

Also: SSH to the host is pinned to the user's home IP, which changed to
38.183.13.187. `ssh_allowed_cidrs` in the gitignored `deploy.auto.tfvars` was
updated and applied with a plan targeted at `aws_security_group.app[0]` only.

---

## 2026-10-03 — staff fill the onboarding in when they invite

Asked for: an admin inviting an employer, college or student can fill in the
onboarding details at the same time. The person gets the usual email with a
temporary password, verifies, and finds everything already filled in.

**Saved as a draft, never submitted.** Undertakings, documents and pressing
submit stay with the person. A box our staff tick is not an employer
promising not to resell candidate data, and with `kyb.require_approval` off,
submitting a KYB *is* approval.

- Backend: `kyb_answers` / `onboarding_answers` on the employer and college
  invites, `full_name` / `city` / `state_code` on the candidate invite.
  `GET /admin/accounts/forms` serves both forms minus CHECKBOX and FILE
  fields (`app.core.forms.staff_fillable_sections`). Validated in the same
  transaction, before the Cognito invitation, so a refusal emails nobody.
- The organisation's name, type and industry now start the KYB draft and the
  college form even without extra answers. The owner used to type them twice.
- Audit metadata `prefilled` names the codes staff gave, never the values.
- `identity.service.provision_candidate` became `create_candidate_account`
  (no email). The admin service writes the profile and then invites last, as
  the business invites already did.
- **Backend only.** No console screen calls it yet: the admin portal's invite
  form is the frontend team's (render `GET /admin/accounts/forms` the way the
  employer KYB wizard renders `/employer/kyb/form`).
- A test holds every CHECKBOX on both forms inside an `undertakings` section,
  because "staff may fill anything but a checkbox" depends on it.

Validated: CI's static checks, `test_admin_accounts.py` and
`test_form_validation.py` (52 passed), the full backend suite (2945 passed).

---

## 2026-10-03 — `/auth/me` returns the caller's email and name

`GET /auth/me` carried only `user_id, role, pool, tenant_id`; a web client
wanted to show who is signed in.

- Added `email` (the caller's own `users.email`) and `full_name` to
  `MeResponse`. Both nullable, so existing clients are unaffected.
- **`full_name` exists only for a candidate** (`candidate_profiles.full_name`,
  via `candidate.service.get_profile`). **A business account has no stored
  name anywhere**, so it is null rather than guessed from the address. Giving
  staff and employers a name means a new column on `users`, its entry in
  `erase_candidate`, and a way to set it -- not done; a product decision.
- Tests added in `test_auth_chain.py` (a candidate's email, then name after
  `PUT /candidate/profile/name`; a business account's email and null name).

---

## 2026-10-03 — the Vercel web app may call the API (CORS)

PR #33 moved the web frontend's sign-in to Cognito in the browser and removed
its Next.js proxy routes, so the browser now calls the API directly from
`https://bharatpath-chi.vercel.app`, and the API answered for localhost only.

- **Live:** `CORS_ALLOWED_ORIGINS` added to the host's `/opt/bharatpath/.env`
  (backup beside it, `.env.bak-20261003-025043`), the Vercel origin plus the
  four localhost origins that were the default; only `api` recreated.
  Verified from outside: preflight 200 with
  `Access-Control-Allow-Origin` for Vercel, an unknown origin still 400.
- **Durable:** `var.cors_allowed_origins` in Terraform, written into
  `host_env_file`, validated to scheme and host with no path or wildcard. A
  rebuilt host gets the same list. No `terraform apply` is needed for the
  running host.
- The frontend signs in with Amplify's `signIn`, not the hosted UI, so no
  Cognito callback URL was needed.

---

## 2026-10-02 — a document too long for a CV is refused, not scored

A tester uploaded a whole book. It was cut to its first 40 pages, sent to the
model (20,292 input tokens, the 60,000-character cap), found to hold no roles,
skills or education, and scored **700**. Then it sat in employer search as an
ENTRY-band candidate.

- **A PDF over 10 pages is refused** with `parse_error_code`
  `resume_too_long` (`params.max_pages`), counted before any text is read.
  No version, no model call, no score. `resume.parser.MAX_PAGES` 40 → 10, and
  it now refuses rather than truncates.
- **Any document over 30,000 characters is refused the same way**
  (`MAX_TEXT_CHARS`). A .docx has no page count, so a book saved as .docx
  would otherwise still pass.
- **A too-long document is never sent to Textract.** The fallback used to
  catch every parse error and OCR the file, billed per page.
  `resume_textract_max_pages` 20 → 10, a test holds it equal to `MAX_PAGES`,
  and Textract answers with the same code.
- **Nothing already stored changes.** Every document within the limit was
  always read in full, so its text is identical; no re-score, and
  `EXTRACTOR_REVISION` is unchanged. Versions parsed from longer documents
  before today keep their scores; re-checking them is a decision.
- Not changed: the paste-text path still takes up to `resume_max_text_chars`
  (60,000), the same setting that caps what scoring sends to the model.
  Lowering it also changes the text of any re-extraction, so it was left.

**Cost per score, measured** from the 8 extractions on the live database
(`gpt-5.4-mini`, $0.75 / $4.50 per 1M tokens): a real CV is ~1,300–2,200
input tokens but 2,000–9,300 output tokens, 80–90% of them reasoning
(`REASONING_EFFORT = "medium"`). **About $0.022 a CV on average ($0.010–0.044),
so roughly 45 CVs per dollar.** Output is ~93% of the cost.

---

## 2026-10-02 — three merged backend APIs reach the frontend

Frontend-only session: the brief was to touch nothing outside `frontend/`.
Every route in `docs/APIs.md` was audited against every call the web app
actually makes, and the three that recent backend PRs added which no screen
called were wired up.

- **`GET /candidate/profile/views`** (PR #30) — `getStudentProfileViews` in
  `store/student/student.api.ts`, and a **Profile views** card on
  `/student/profile`: the organisation's name and its last open, latest
  first, first ten, with loading, error-retry and empty states. Only the two
  fields the API holds — never the recruiter, never a count of opens. The
  card sits outside the page's blocking skeleton, so a slow view log does
  not hold up the profile.
- **`GET /candidate/streak/me/calendar`** (PR #27) — the activity strip on
  `/student/streak` now reads the server's days instead of deriving them.
  `streak-utils.ts` said *"The API does not return a day-by-day calendar"*:
  true when written, false since PR #27. The comment is fixed, and
  `activeDateKeys` is now only the fallback used while the request is in
  flight or has failed — still exactly right for the current run, and it
  never guesses older activity.
  - **Week and month pass `period` anchored on the server's IST `today`; the
    year view passes `from`/`to` for 1 January – 31 December.** `period=year`
    is the *rolling* 366 days ending today, not the calendar year the
    heatmap draws. A whole calendar year is at most 366 days
    (`domain.MAX_CALENDAR_DAYS`), so a leap year still fits in one call.
  - The header now shows `opened · missed · best run`, and day labels say
    "opened" rather than "current streak", because the set is no longer only
    the current run.
- **`GET /college/analytics/applications`** (PR #23) — a **"Where
  applications stand"** panel on `/college/analytics`: current stage and
  ever-reached milestones side by side, the total in the panel's meta. Stage
  order lives in `use-analytics.ts` rather than being read off the response,
  so the panel never depends on JSON key order. A withheld cell is an em
  dash over a zero-width bar, **never `0`** — a zero would let the total
  give back exactly what the floors withhold — and under the cohort floor
  the whole panel is one note.

**Audited and still not integrated** (left out deliberately: the scope was
the recent PRs): `/disputes` raise and list; the seven unused
`/candidate/colleges/*` routes (link, consent-terms, invitations, accept,
decline, individual-visibility, revoke — only the list is called);
`GET /candidate/questionnaire/report`; `POST /notifications/unsubscribe`; all
six `/candidate/subscription/*` routes, because the student portal has no
billing screen at all; `checkout/discount-preview` for employer and college;
`/admin/accounts/*` with tenant members and resend-invitation; the five
`/admin/discount-codes/*` routes; and the eight `/admin/courses/*`
course-builder routes. None of them has a screen waiting, so they are
features rather than wiring.

**Verified:** `npx tsc --noEmit`, `npx eslint` clean on all ten touched files
(the repo's four lint errors are pre-existing, in `student-app-shell.tsx`
and `features/college/settings/*`), `npx next build` green.

---

## 2026-10-02 — who viewed my profile (candidate)

`GET /candidate/profile/views`. The privacy screen's "Who has seen me" had no
API (screen-flows §2.1).

- **One entry per organisation**, `employer_name` and `last_viewed_at`, last
  **90 days**, latest first, cursor-paged, no total. Built from the
  `candidate_view_events` row every reveal already writes; nothing new is
  recorded.
- **Never the recruiter (`actor_id`) and no count of opens.** A test holds
  `ProfileView`'s field list.
- **Through a SECURITY DEFINER function, not a policy**
  (`candidate_profile_views`, migration `0009_candidate_profile_views`). A
  candidate cannot read the view log under RLS (tenant policy only,
  partitions revoked), and the `employers` candidate policy only names
  organisations with a job on the board. The function reads
  `current_candidate_id()` and takes no candidate id; bound to a tenant or to
  nobody it returns nothing. It clamps its own lookback and row count.
- **Not paywalled**, like the rest of the profile.
- **Ours, not the client's:** the 90-day lookback
  (`discovery.domain.PROFILE_VIEWS_LOOKBACK_DAYS`, frozen in 0009 and held
  equal by a test), showing the organisation's name at all rather than only a
  count, and not paywalling it. Employers are not yet told that a candidate
  can see they opened the profile. That belongs in their terms.
- No table changed, so `erase_candidate` and the erasure plan are untouched;
  the view log stays RETAIN.

---

## 2026-10-01 — deployed to a new AWS account: EC2 + RDS

The old account (`592033927084`) expired. Everything was built fresh in
`335345888157`, with Postgres moved to RDS so the database has backups —
option B of the costing (~$43/month against $100 of Free-plan credit). The API
is live at `https://bharatpath-api.duckdns.org/api/v1`; `aws-deployment.md` §0
is the as-built record and the rebuild sequence.

**Verified on the live stack:** `/health` over a real Let's Encrypt
certificate; every migration to `0008` and all four seeds on RDS as the
migrator; `bharatpath_app` is `bypassrls=false` and owns nothing; beat sends
the relay every 30s and the worker runs it against RDS; a real Cognito access
token from the candidate pool gets 200 on `/auth/me` (an ID token gets 401).
The smoke user was deleted from Cognito; its `users` row
(`b28ad9eb-4f25-43b7-b6b6-f3e8bb461d0d`) remains as test data.

**New:** `rds.tf` (`deploy_rds`; private, TLS forced, deletion-protected,
`prevent_destroy`), `network.tf` (the picture and why there is no NAT),
`budgets.tf` (gross spend — a budget that nets credits off never fires),
remote state in S3 (`backend.tf`), `deploy/init_rds.sh` (the three roles on
RDS) and `deploy/ship.sh` (ship the tree, build on the host, restart). The
app verifies the RDS certificate against Amazon's bundle, which the image
downloads (`DATABASE_SSL_ROOT_CERT`; `connect_args_for` refuses an RDS host
without it). Postgres in compose is now the `local-db` profile. 2 GiB swap and
`standard` CPU credits on the host.

**Seven things that had never run anywhere, and broke on first contact:**

1. Cognito pools could not be created on a fresh account: the provider sends
   an empty SMS invite, and the API wants six characters. A placeholder is set;
   nothing is sent by SMS.
2. The app's inline IAM user policy outgrew the 2,048-byte cap; it is a
   managed policy now.
3. The Free plan caps RDS backup retention at **1 day** (`FreeTierRestrictionError`).
4. `seed_config.py` died with `No module named 'app'` in the image — scripts
   put `scripts/` on the path, not `/srv`. `PYTHONPATH=/srv` in the Dockerfile.
   `create_platform_staff.py` had the same bug.
5. The prod compose never ran `seed_catalogue.py`, so no plan could be bought.
   It runs now, and refuses its placeholder prices outside dev, which fails the
   deploy rather than selling them.
6. Beat could not write its state file: `/mnt/data/celerybeat` belonged to
   ec2-user, the image runs as uid 10001.
7. **The SQS broker never worked** (E44): nothing reads `SQS_QUEUE_URL`, so
   kombu wanted a queue named `celery` and ListQueues/CreateQueue. The host's
   broker is Redis now.

Also: the RDS master user does **not** hold BYPASSRLS, yet RDS let it create
the two roles that do. The worker and beat no longer inherit the image's
HTTP healthcheck, which reported them unhealthy.

**Open:** upgrade to the Paid plan before the credit or 2027-04-01 runs out
(E45), then set `rds_backup_retention_days = 7`; SES production access
(notifications go through SES from `bharatpath63@gmail.com` since later on
2026-10-01, sandboxed; **Cognito stays on its own sender** --
`cognito_email_via_ses` -- because a sandboxed SES would deliver sign-up codes
to nobody but us); the first platform admin exists (bharatpath63@gmail.com, PLATFORM_ADMIN,
invited by Cognito) but **cannot sign in from any client yet: the web and
mobile apps sign in through `/auth/dev/token`**, which the deployed API does not
register and must not;
SSH is limited to one home IP, which will change.

---

## 2026-09-30 — college analytics show exact numbers (client decision)

A college dashboard showed "—" for September: one platform hire, under the
cell floor of 5, withheld with October beside it. The client (Rishabh, relayed
by the backend lead) asked for exact numbers, because they are what a college
pays for on its students' behalf, and accepted the consent residual
(answers-log Round 12).

- `analytics.domain.DEFAULT_FLOORS.min_cell_size` is **1**, which withholds
  nothing: bands, placement months, the application funnel and job locations
  are exact above the cohort floor. `LOWEST_CELL_FLOOR` is 1.
- **Existing databases** hold `analytics.privacy` version 1 with 5, and the
  seed never updates a key, so `0008_exact_college_analytics` inserts
  **version 2** copying the row in effect and changing only `min_cell_size`.
  Nothing when there is no row or it is already 1. Checked on a database
  seeded by `main`: v1 kept, v2 written, the app reads cell 1.
- **Unchanged:** the cohort floor (10; the code refuses below 5) and the median
  rounded to 10 -- neither was asked about. A withheld figure is still
  `null`, never `0`.
- The suppression code and its tests stay: a config row raising
  `min_cell_size` switches it back on, and
  `test_a_raised_cell_floor_withholds_small_cells_again` holds that. Invariant
  9's revocation test is sharper for it: the one STRONG student is counted as
  1 and gone on the next read after revoking.
- E28 (a before/after read can show one student's band) is wider now and was
  accepted by the client; counsel has not been asked. E27's cell-floor half is
  answered.

---

## 2026-09-29 — streak activity calendar (week, month, year)

For the mobile "This week's activity" strip and a LeetCode-style calendar.
`GET /candidate/streak/me/calendar`, `docs/streaks.md` §4.1.

**Client decisions (2026-09-29):** opened or not, with no count of opens; kept for one
year.

- **Before this, no day was stored.** `user_streaks` held only the current
  run, so a past week could not be drawn. `streak_activity_days` is now one
  row per counted day: the date, nothing else. The check-in that counts the
  day writes it.
- **Every day comes back with a status** (`ACTIVE`, `MISSED`,
  `TODAY_PENDING`, `UPCOMING`, `BEFORE_START`, `NOT_RETAINED`), so clients
  never work out IST days. A day before the first open, or today before the
  app is opened, is never `MISSED`. `user_streaks.first_active_on` (new, set
  once) is what tells those apart, because the days table forgets anything a
  year old.
- **Retention is a SECURITY DEFINER purge**, `purge_streak_activity_days`:
  the app role has no DELETE, and the function clamps the cut-off to the
  database's IST day, so a wrong clock can only delete less. Scheduled daily
  at 00:10 IST (`streak-activity-retention`). Its 365 is frozen in `0007`,
  and a test holds it equal to `domain.ACTIVITY_RETENTION_DAYS`.
- **Migration `0007_streak_calendar`** creates the table and column only
  when missing, backfills from the ledger, adds the purge and replaces
  `erase_candidate` whole. The backfill works because a run is consecutive
  days and each penalty and milestone row names its run's start and length.
  A run with no ledger row (a break under a 0 penalty) is not recovered.
- ERASE in the deletion policy, `streak_days.json` in the export, the new
  queries in the index review.

**Checked:**
- a local database at `0006` upgraded with a seeded broken run and current
  run, and the backfill rebuilt exactly those days;
- downgrade and upgrade again;
- a fresh build from the baseline in a scratch database, with the grants,
  purge EXECUTE and erase cascade confirmed;
- the CI lint set.

---

## 2026-09-29 — the score scale is served, not hardcoded

The candidate home card was drawing the score as "832 / 999": the app had
guessed the ceiling. `GET /candidate/score/scale` returns `lowest` (700),
`highest` (990) and the four bands with inclusive ranges, read from
`scoring.domain` (`BASE_SCORE`, `MAX_SCORE`, `BANDS`), so a change there
reaches every client. Candidate role only; **not paywalled**, because it is
the same for everyone and says nothing about this candidate's number.

- The schemas live in `scoring/schemas.py`, so the never-explained scan
  covers them. Field names are `lowest`/`highest`, kept well away from a
  job's `min_score`, which must never reach a candidate.
- `tests/integration/test_score_scale.py` compares the response with the
  domain constants rather than literals, and checks that every value from 700
  to 990 falls in exactly one band, the one `band_for` gives.
- **What the frontend was told not to build from it:** "33 more to next
  band" (screen-flows §2 already forbids it, R11) and the "+26" change badge,
  which is the score history the client declined to show (see
  `CandidateScoreResponse`). Neither is in any response.

---

## 2026-09-30 — admin candidate detail layout

The candidate detail page keeps Resume and Practice interviews in the right
column, opposite Onboarding details and Score timeline. The details use stacked
flex columns rather than a row-based grid; at desktop widths, Practice
interviews stretches to the same bottom edge as the Score timeline.

## 2026-09-30 — student interview checkout

The student interview page follows the portal's purple, cream and navy palette.
Its checkout uses the existing offer, device-check, interview checkout and
session APIs, including the required network and storage measurements. In local
stub-payment mode, the page settles its checkout through the development-only
simulation endpoint rather than sending candidates to the stub gateway's
unavailable redirect URL; successful settlement refreshes the interview offer.

## 2026-09-30 — student portal page headers

Removed redundant in-page "Your board" and detail-page top bars from the
student board, interview, and course screens. The shell header remains the
single page heading; course routes now show "Courses" there. Course and
interview content remains on its existing page without a redundant back arrow.

## 2026-09-30 — session expiry prompt

Protected routing still sends a request with no session token to login without
a session-expired notice. When a token is present but expired, routing sends
the user to login with a brief session-expired toast. An expiry detected while
the page is open uses the same redirect and toast flow.

## 2026-09-30 — frontend session timeout and route guard

Protected frontend routes now require the HTTP-only session cookie to contain
a parseable, unexpired token. Missing or expired sessions are cleared and
redirected to the login page with a session-timeout dialog; login, signup and
admin login remain public. A client guard also detects token expiry while a
page is open. A backend 401 clears the browser token and follows the same
logout-to-login path. The backend build plan remains unchanged: its scope is
the backend, while this is a frontend auth correction.

## 2026-09-29 — `main` made correct again after PRs 21, 22 and 23

PR 21 (college APIs) was merged with red CI; the mobile branch (PR 22) and
several fixes reached `main` by direct push, also red. Everything below lands
through PR 23.

**Put right**

- **A fresh database would not build on `main`** (0002/0003 created indexes
  the baseline already had). Fixed in PR 23's first commit.
- **Migration heads.** The mobile branch's `0002_interviews_in_subscription`
  revised the baseline beside `0004`; `main` then merged the two with
  `0005_merge_migration_heads`. `0005_portal_dashboards` follows that, and
  `0006_interviews_are_bought` is the single head. Checked: a fresh build, a
  database at `0004`, and one at `main`'s head.
- **Interviews are bought again.** The mobile branch had made sessions free
  for any subscriber (`purchase_id` NULL, a guard accepting a live
  subscription): unlimited sessions and the whole +60 unpaid, past the
  "will not increase your score" acknowledgement. The client never decided
  that. Code and tests are back to one purchase per session; `0006` restores
  the baseline guard and NOT NULL, and **stops if a database already holds an
  unpaid session** rather than deleting or backfilling it.
- **College analytics floors restored** (PR 21 had removed them and edited
  `test_invariant_09_consent.py` and `test_analytics_domain.py` to match): a
  withheld band is `null` again, not `0`; below the cohort floor only the two
  counts show, not a `median_score` of 0; small months in the placement trend
  are withheld with their complement. The college frontend already rendered
  `null` as "—"; its API types now say so, and a withheld month is labelled
  "—" on the chart instead of drawn as 0.
- **CI.** Lint was red because a fresh install picked up SQLAlchemy 2.1
  (pinned `<2.1`, three annotations); "publish openapi.json" failed because
  Settings needs an OpenAI key unless `INTERVIEW_QUESTION_PROVIDER=stub`, now
  set for that job.
- Removed `E501` from the `scripts/**` ignores: it was added for
  `seed_test_jobs.py`, which is not in the repository, and nothing that is
  needs it.
- Kept from the mobile branch, and correct: `resume.file_uploaded` now routes
  to the parse task (before it nothing parsed an uploaded CV), one event loop
  per Celery worker, and presigned URLs a phone can reach in local dev.

**Left for others**

- The mobile app starts a session without buying one, so it now gets
  `409 interview_purchase_required`. It needs the checkout step back:
  `GET …/offer` → device check → `POST …/checkout` (with
  `acknowledge_no_score_increase` when asked) → payment → `POST …/sessions`.
- `frontend/package-lock.json` is out of sync with `package.json`
  (`npm ci` refuses), and `features/college/students/student-roster.tsx` has
  four ESLint errors. Neither is backend's, and no CI job here checks the
  frontend.

## 2026-09-29 — the portal dashboards: admin, college, employer and student

The client's requests for all four portals (answers-log Round 11), backend
only; the frontend is its own work. One migration, `0005_portal_dashboards`,
on top of `0004`.

**Fixed on the way in: `main` could not build a fresh database.** The
baseline creates tables from the current models, which already declare the
indexes `0002_college_student_search` then created again, and the constraint
`0003_roster_reupload` dropped never existed on a fresh build.
`reset_local_db.sh` and CI failed at `alembic upgrade`. Both revisions are now
idempotent; a shared database that already ran them is unaffected. Also on
`main` and fixed here: `test_the_list_filters_every_link_stage` expected 201
from accepting an invitation, which has always answered 200
(`test_roster_import.py`); and two files failed `ruff format --check`.

**Verified:** 2829 tests pass on a fresh build; a database built by `main`
(at `0004`) upgrades to `0005` with the five tables, the three college reads,
the new cascade and the intended grants (insert-only tables have no UPDATE,
none has DELETE).

**Admin — the full candidate page** (`/admin/candidates/{id}/…`): onboarding
(contact unmasked), CV (text + presigned file), score timeline (display value,
band, change, cause -- never the stored number), interviews, recordings,
courses, applications with stage analytics. Three new capabilities --
`candidate_contact` and `candidate_recordings` (admin, support) and
`candidate_resume` (+ integrity reviewer) -- and every part writes its own
audit row. The drill-down itself is unchanged.

**College — the widened student view** (`/college/students/{id}/details`,
`/resume`): contact, questionnaire (not the accessibility answer), CV,
practice interviews completed, course %, every application with its stage,
and analytics. **Only under INDIVIDUAL consent version 2**, whose placeholder
words name all of it; three consent-joined SECURITY DEFINER reads in 0005.
Version-1 students get 409 `college_student_details_not_shared` and keep the
old view; re-granting replaces their row.

**Employer — messages to applicants** (`/employer/applications/{id}/messages`):
INTERVIEW (time required), ASSESSMENT (https link required) or GENERAL, sent
by email and in-app through the ordinary notification relay, seven new
templates in all six priority bundles (still `needs_native_speaker_pass`).
Applicants only, open stages only, 10 per application per day and 300/hour
per organisation. The candidate reads them at
`/candidate/applications/{id}/messages`, without the sender.

**Student — courses and interviews.**

- The course is built by staff (`/admin/courses`, modules and lessons, a
  YouTube link or an upload to `bharatpath-course-media`) and published
  explicitly. Candidates see it locked until bought, then embed URLs or
  four-hour presigned links, and report progress. **C1 closed**: completion
  is every published lesson watched, recorded as the system.
- **Every interview question is written by AI** (client, same day: "only ai
  and not fixed questions"): the first from the CV and onboarding answers,
  each next one after hearing the previous answer (`POST …/next-question`),
  never an earlier session's question. Six per session, still
  `QUESTIONS_PER_SESSION`. **No fixed-question fallback**: a refused draft is
  sent back with the reason (up to 3 tries), then a 503 the app retries; a
  failed start spends no purchase. OpenAI is the default provider; tests and
  CI use the stub.
- `/candidate/interview/history` and `…/sessions/{id}/recordings` for going
  back through sessions and hearing them.

**Decisions worth knowing:**

- **Unlisted YouTube is not behind the paywall** -- anyone with the link can
  watch. The client asked for it; uploads are the option that is.
- **The widened college view reverses the version-1 words**, which promised
  no contact and no CV. Hence a new version rather than a wider old one.
- Transcribing in-session means Sarvam is billed per answer during the
  interview rather than after; the evaluation reuses those transcripts, so
  nothing is paid twice.
- The course's `sync_catalogue` no longer decides `active`: re-running the
  seed never takes a published course off sale or puts an empty one on.

**Also added:** the data export gains `interview_questions`, `courses` and
`messages` (never the sender); colleges get
`GET /college/analytics/applications`, the cohort's application funnel,
floored and suppressed like every aggregate (`college_cohort_applications`).

**Tested live, 2026-09-29, with the real keys.** `scripts/smoke_interview_live.py`
(OpenAI writes → OpenAI TTS speaks an answer → Sarvam hears it → OpenAI
writes the follow-up, six times; the evaluator rates it; a second session
repeats nothing) passed, questions in Hindi from a Hindi locale. A full run
through the API on :8099 against LocalStack S3 -- sign-in, CV, questionnaire,
subscription, device check, purchase, six real audio uploads, completion,
evaluation, report, history, playback -- passed. Timing: first question
~3 s, each next ~9 s (≈6 s Sarvam + ≈3 s OpenAI); the app needs a
"thinking" state. Sarvam once heard "साठ" (60) as "सात" (7).

**To deploy:** run migration 0005 (`alembic upgrade head`). **The API now
refuses to boot without `OPENAI_API_KEY`** (the question writer defaults to
`openai`, model `gpt-5.4-mini-2026-03-17`); set
`INTERVIEW_TRANSCRIPTION_PROVIDER=sarvam` + `SARVAM_API_KEY` too, or
questions cannot follow up answers. `infra/terraform/outputs.tf` now writes
both question variables into the EC2 env file.

---

## 2026-09-28 — product logo replaces panel monograms

The supplied BharatPath logo now replaces the square `B` / `BP` monograms in
the shared employer, college and admin sidebar and in both desktop and mobile
student sidebars. The root Next.js metadata also points the browser-tab icon at
the same bundled PNG, so every frontend surface uses one brand asset.

Targeted ESLint and the Next.js production build pass. Browser validation
confirmed the rendered logo in both sidebar implementations and the generated
`rel="icon"` link.

---

## 2026-09-28 — student header shows the daily engagement streak

The student shell now calls the idempotent
`POST /candidate/streak/me/check-in` endpoint when it opens and maps the full
response into typed frontend models. The student header alone renders the
current streak as a compact amber flame-and-count pill, following the familiar
LeetCode treatment without presenting engagement points as the BharatPath
score. Loading and retry states stay within the same header footprint, and
successful automatic check-ins do not trigger a global success popup. No
backend code changed.

Targeted ESLint, the Next.js production build and TypeScript all pass. A
browser pass with a mocked 12-day response verified the loaded desktop header
and the 390px mobile header with no horizontal overflow. The repository-wide
frontend lint still reports six unrelated pre-existing errors in college
settings/roster and existing student animation/shell effects.

---

## 2026-09-28 — email sign-in bundles its account directory

Deployed sign-in (`POST /api/auth/token` on Vercel) answered 500 "The account
directory is unavailable on this server." The route read
`../backend/scripts/seed_output/accounts.json` from disk, a file outside the
frontend that is untracked and never shipped with the deployment.

The directory now lives at `frontend/lib/auth/accounts.json` and is imported
statically, so Next bundles it into the server chunks (verified absent from
`.next/static`). `DEV_ACCOUNTS_FILE` still overrides it. `seed_demo.py` writes
the manifest to both places, so a re-seed keeps them in step; the frontend copy
must be committed and redeployed after one. `credentials.json` was not moved:
the frontend never reads it, and it holds bearer tokens. `tsc` and `next build`
pass.

---

## 2026-09-28 — restored frontend success-feedback type safety

The success-feedback middleware now narrows fulfilled actions to the RTK Query
mutation metadata shape before reading the endpoint name or original arguments.
This resolves the TypeScript errors introduced by Redux Toolkit's stricter
`unknown` metadata typing while preserving suppression flags, mapped success
messages, and development warnings for unmapped mutations. VS Code reports no
diagnostics in the middleware.

---

## 2026-09-26 — college Students API accepts the deployed stage casing

The deployed Students page called
`GET /college/students?stage=All&limit=10`, while the backend contract names
the enum value `ALL`. The current frontend already maps its "All link states"
label to `ALL`, but an older deployed frontend can remain cached or live during
a rolling deployment. The route now normalizes known stage values
case-insensitively before validating the same closed enum. `All`, `linked`,
`Invited` and `consent_pending` therefore work; an unknown value still returns
422, and OpenAPI still advertises only `ALL`, `LINKED`, `INVITED` and
`CONSENT_PENDING`.

The original screenshot's 500 preceded the migration-lineage repair below.
After that repair, all three queries used by the `ALL` view were executed
against the configured shared database: linked, invited and consent-pending
reads all completed. Pylance reports no diagnostics, Ruff passes, the focused
normalization and migration tests pass (7 tests), and the database-backed
integration regression collects successfully. It still cannot execute locally
without Docker Desktop and its Postgres/Redis services.

---

## 2026-09-26 — restored the deployed Alembic migration lineage

The configured shared database was stamped at
`0002_search_filter_options`, but that revision no longer existed in the
repository. Alembic therefore could not resolve the database's current state
and refused every `current` or `upgrade` command before it could apply the
college-search and roster re-upload migrations.

The deployed catalog confirmed that the lost revision had created the
`search_filter_options` table with the same columns, constraints, indexes and
app-role privileges now present in the baseline. The revision has been
restored as a compatibility migration: it uses `IF NOT EXISTS` DDL so an old
baseline receives the table while a database built from the current baseline
keeps its existing table. The already-merged college and roster revisions were
not rewritten. `0004_merge_migration_heads` joins their branch to the restored
search-filter branch, preserving every revision that a shared database may
already hold.

`python -m alembic upgrade head` completed against the configured Neon
database. It is now at the single head `0004_merge_migration_heads`; the four
college pagination indexes exist, `college_visible_students` accepts its
fourth `p_query` argument, `uq_roster_import_source` is gone, and
`uq_roster_import_source_retained` is present. Full offline SQL generation
from `base` to `head`, Ruff, and 49 focused unit tests pass. A migration-history
unit test now requires one head and keeps the deployed search-filter revision
resolvable. The database-backed roster re-upload test could not run locally
because Docker Desktop is unavailable, so neither local Postgres nor Redis
could be started.

---

## 2026-09-26 — college Students frontend split into feature modules

The college Students frontend is no longer one flat feature backed by one
monolithic API file. The page is now a thin composition layer over four
sections: visible-student roster and detail, roster imports and previews,
referral codes, and link-state summaries. Each section owns its components,
hook and public barrel; the infinite-scroll viewport is the only
Students-shared component.

The RTK Query layer now follows the same boundaries. Visible students,
roster imports and referral codes have separate API and type modules, while
college-wide settings, analytics and billing remain outside the Students
feature. The college dashboard was moved to the referral-code API rather than
depending on the visible-students API. Unused student slice, schema, action,
status-badge and duplicate roster-preview files were removed.

The latest-upload pinning remains in the roster-import hook, so the
successfully uploaded PREVIEW row stays visible even against a stale empty
list response. Workspace diagnostics report no frontend errors. Browser
validation covered the student list and audited detail drawer, referral-code
invite modal, all four Students sections, a valid CSV upload with Preview,
Commit and Discard actions, and the nested roster-preview route rendering its
uploaded row.

---

## 2026-09-26 — deployed college student listing migration

Fixed the deployed `GET /college/students` 500 introduced by name search. The
application called `college_visible_students` with a fourth search argument,
but the change had been edited into the already-applied baseline migration, so
an existing database still exposed only the original three-argument function.

The baseline is restored to its historical definition. Migration
`0002_college_student_search` now replaces the function with its searchable
four-argument form and creates the referral-code, roster-import, and
roster-stage pagination indexes added with the same feature. The production
migrate service applies it through the existing `alembic upgrade head` step.

Static workspace diagnostics pass. Runtime migration and integration tests
could not run because the sandbox denied shell access to the workspace.

---

## 2026-09-26 — roster upload restores its preview row immediately

A valid college roster CSV now inserts the successful upload response into the
RTK Query roster-import cache and keeps a deduplicated collection of recent
uploads above the server results. Each new PREVIEW therefore appears
immediately with Preview, Commit and Discard actions, remains visible when the
paginated list response is stale or unavailable, and survives opening its
preview route and returning to Students. Re-uploading a retained PREVIEW or
COMMITTED file remains idempotent and cannot create a duplicate import.

Upload does not invalidate and immediately refetch the list: a lagging list
response could overwrite the successful POST response and make the new preview
disappear. Later commit, discard and send actions still invalidate the
server-backed list. The file input is reset after each attempt so the same file
can be deliberately selected again, and a new PREVIEW scrolls the Roster
imports card into view.

Discard is different because it permanently deletes the staged rows. Migration
`0003_roster_reupload` replaces the all-state fingerprint constraint with a
partial unique index over PREVIEW and COMMITTED imports. Uploading identical
content after discard now creates a fresh PREVIEW and fresh rows; uploading
content already in PREVIEW or COMMITTED still returns that retained import.

Workspace TypeScript diagnostics pass for every changed frontend file. A fresh
browser context started with an empty imports response, uploaded a valid
one-row CSV, deliberately kept the imports response stale and empty, and still
observed the upload as one PREVIEW row with its Preview, Commit and Discard
actions. The row remained after opening its preview and navigating back. At
the 1024px layout, import details now stack above a single compact action row
instead of competing for the narrow half-width card; 768px, 1024px and 1440px
browser checks all have no row or page overflow. Discarding an import deletes
its staged rows in the backend, so a DISCARDED entry no longer offers Preview;
the successful discard response updates the local list immediately and cannot
be overwritten by a stale PREVIEW list response.

The exact upload, discard, same-file upload sequence was browser-tested at
1024px with a stale empty list response: the discarded history row remained
without actions and a second, new PREVIEW row appeared above it with Preview,
Commit and Discard. The focused backend regression was added, but the editor
test runner did not discover the Python test; shell-based pytest remains
blocked by the workspace sandbox policy.

The downloadable roster CSV now writes sample phones as `91 98765 43210`.
The embedded spaces make spreadsheet applications retain the field as text,
while the roster parser accepts it and stores `+919876543210`. The upload card
also states that plain 10-digit and `+91` forms are accepted. A focused runtime
check parsed both template rows as VALID with normalized `+91` values.

The first container deployment exposed that migration `0003_roster_reupload`
had not been applied: the new service tried to insert the second import while
PostgreSQL still enforced `uq_roster_import_source`, and raised
`UniqueViolationError`. Container startup remains Uvicorn-only by deployment
decision. Apply `python -m alembic upgrade head` separately with
`DATABASE_URL_MIGRATOR` before deploying the application image; the official
Compose deployment already does this through its dedicated migrator service.

---

## 2026-09-26 — candidate loading skeleton matches result cards

The employer Candidates screen now uses one shared candidate-card skeleton for
both route transitions and API loading/refetches. Its avatar, candidate
metadata, band/add-on pills, skills and profile action preserve the loaded
card's footprint instead of showing a compact divided-list placeholder. The
route fallback also preserves the fixed pagination footer and filter rail, so
the page does not resize when it becomes interactive.

Workspace TypeScript diagnostics pass for every changed frontend file. The
loading state was checked in the browser at 1440x900 with the candidate request
held open; the card stack, footer and filter rail remain aligned. The live API
returned 401 after the request was released because the local browser session
was expired, unrelated to this loading-state change.

---

## 2026-09-26 — frontend diagnostics cleanup

Resolved the frontend errors introduced around the college roster updates:
removed the duplicate roster-preview route export, repaired the student drawer
header markup, made reported component props read-only, moved table column
renderers outside their parent components, and adopted the canonical Tailwind
utilities reported by the editor. The employer Jobs table now displays only
the job title without its generated initials tile.

Workspace diagnostics pass for every changed frontend file. The sandbox denied
shell access to the frontend path, so ESLint and the TypeScript CLI could not
be run.

---

## 2026-09-25 — attribute modal no longer asks for sort order

The Admin Attributes add/edit modal no longer exposes `sort_order` for skills
or cities. New options use the backend's default order, while editing an
existing option leaves its stored order unchanged because the PATCH omits the
field. Label, state code, aliases and the featured control are now laid out in
one vertical column.

Validated with workspace TypeScript diagnostics. Browser checks were omitted.

---

## 2026-09-25 — job edit actions follow the lifecycle

The employer job edit page now shows actions that match the job's current
state. Draft and paused jobs can be updated, published or closed; live jobs
can be paused or closed. Live and closed job fields are read-only, matching the
backend rule that a live job must be paused before its terms change and that a
closed job is terminal. Closing asks for confirmation.

A closed job now offers "Duplicate job". It opens the create route with the
closed job as its source, loads the previous details into an editable form, and
creates a separate job that the employer can save as a draft or publish. The
source id stays in the URL so refreshing the duplicate form preserves the
prefill.

Validated with workspace TypeScript diagnostics for every changed frontend
file. Browser checks were omitted.

---

## 2026-09-25 — jobs table controls are left-aligned

The employer Jobs table toolbar no longer shows the current-page job and live
job counts. Search and the status filter now start at the left edge of the
toolbar, and the route loading skeleton matches the revised layout.

Reviewed in source. Automated lint and TypeScript validation were blocked by
the sandbox policy for the frontend workspace path.

---

## 2026-09-25 — Disputes and Audit trail are separate admin tabs

The admin "Disputes & Audit" page was split into two sidebar items:
- **Disputes** (`/admin/disputes`, `Gavel`): the Open / Resolved / Rejected
  tabs, drawer and pagination, now full width instead of sharing space with a
  305px audit column. The header reads "Disputes".
- **Audit trail** (`/admin/audit`, `ScrollText`, new): the whole audit log,
  newest first, loading 20 events at a time as the page scrolls. It has its
  own `loading.tsx` timeline skeleton.

`AuditTrail` gained `variant: "panel" | "page"`:
- `panel` is the old fixed 480px scroll box with its own observer root.
- `page` grows with the page, observes the viewport, and drops its duplicate
  heading.

The audit query moved out of `useDisputes` into
`features/admin/audit/hooks/use-audit-trail.ts`. `AdminShell` and the
Disputes loading skeleton were updated to match. No backend change: both pages
call the same endpoints as before (`/admin/disputes`,
`/admin/audit-events`).

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — admin "Search Filters" renamed to "Attributes"

The admin page for curating the skills and cities employers pick from is now
called **Attributes** everywhere it is visible:
- the sidebar label (and the legacy `AdminShell` link)
- the page header
- every popup, e.g. "Attribute created." and "3 attributes imported."
- error and empty states, and the switch-off / reactivate dialog titles
- the CSV template file names (`attributes-skills-template.csv`,
  `attributes-cities-template.csv`)

Icons: the sidebar item uses `Tags` instead of `ListFilter`, and the page's
search box uses `Search` instead of the filter funnel.

Unchanged on purpose: the route `/admin/search-filters`, the nav key, the file
and component names, the API endpoints and the backend capability
`search_filters`. Bookmarks and links keep working and no backend change was
needed.

---

## 2026-09-25 — opening an application shows no popup

Opening an application on employer Applications no longer shows "Application
opened successfully." Opening something to read it is not an action worth
announcing, and the drawer appearing is the feedback. This matches the
candidate profile, whose popup was removed earlier. No "opened successfully"
popups remain anywhere; stage moves, hires and interviews still announce
themselves.

---

## 2026-09-25 — Applications breadcrumb loads without a placeholder title

Opening Applications for one job (e.g. from the employer dashboard's top-jobs
card, `?jobId=`) showed the breadcrumb as "Jobs › Job 1a2b3c4d ›
Applications" until data arrived. The title came only from loaded
applications or the job dropdown, which loads on open. Otherwise the hook
used the id's first eight characters. `useApplicationsPage` now fetches the
focused job itself (`GET /employer/jobs/{id}`, cached) and exposes
`isSelectedJobTitleLoading`. While that is true, the middle crumb is a
skeleton. `Breadcrumb` gained `isLoading`, rendered by `PortalHeader` as a
skeleton with a screen-reader label, so any page can use it. If the job cannot
be loaded, the filter shows "Selected job" rather than an id fragment.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — college analytics shows a skeleton while loading

Analytics & Outcomes used to render at once with placeholder values ("—"
metrics, empty charts and table) while its three queries loaded. The route's
`loading.tsx` covered only the page-code load. Both now render one shared
`AnalyticsSkeleton` (`features/college/analytics/components/`), which has
four metric cards, the two placement panels and the table, so route load and
data load look the same with no jump. The header seat counter shows its
loading state, and Export report is disabled until the data has arrived,
since it would otherwise download an empty CSV. The `#hires` deep link still
lands correctly because `useScrollToHash` waits for `!isLoading`.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — employer candidate list has bottom padding

On employer Candidates, the last card sat against the pagination bar. The
scroll area's inner column was `h-full`, fixed to the viewport height, so the
cards overflowed it and scrolled past the container's bottom padding. The
column is now `min-h-full`, which grows with its content, and the scroll area
uses `pt-3 pb-4`: 16px below the last card, the portal's standard gutter. An
empty or short list still fills the area as before.

---

## 2026-09-25 — live-job update reverted

Reverted at the client's request: the "a live job can be updated" change below
is undone. A published job's edit form is read-only again, with "This job is
live. Pause it before changing its details." and only Pause and Close.
Drafts and paused jobs keep Update job, Publish and Close. The pause →
save → republish flow, its KYB guard and messages are gone.
`pauseEmployerJob` is back to "Job paused." in `SUCCESS_MESSAGES`. The job form
now matches its state before that change exactly.

---

## 2026-09-25 — no native dropdowns left in the frontend

The last four browser-native `<select>`s now use the shared custom
`Dropdown`, so every dropdown looks and behaves alike:

| Where | Field |
|---|---|
| `ConfigurableForm` (employer create/edit job) | Employment type |
| College Settings → Users → Add user | Role |
| College Settings → Onboarding | SELECT-type questions |
| College Students filter bar | Link-state filter |

Form dropdowns match their neighbouring inputs (46px, `rounded-[10px]`, the
same focus colour) and turn red with the field's validation error.
`ConfigurableForm` keeps its blur-to-touch validation by wrapping the dropdown
in a `div` that receives the bubbling `onBlur`. Onboarding's select row is a
`div` rather than a `label`, so label clicks are not forwarded to the trigger.
`SelectDropdown` is now a thin wrapper around `Dropdown` at the filter-bar size
(40px, `rounded-xl`). Its `onChange` now receives the value rather than a
change event; its only caller was updated. No `<select>` or `<option>`
elements remain under `app`, `components` or `features`.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — profile drawers open from the right

Correction to the two left-drawer entries below: the employer candidate
profile and the college student details drawers now slide in from the
**right** edge, matching the Applications and admin drawers. The shared
animation is renamed `bp-drawer-right` (`bpSlideInRight`), and its shadow
now falls to the left. The width, backdrop, content and closing behaviour are
unchanged. No `bp-drawer-left` usages remain.

---

## 2026-09-25 — a live job can be updated from its edit page

A published job's edit form was read-only, offering only Pause and Close. The
backend refuses `PATCH` on a published job (`EDITABLE_STATES = {DRAFT,
PAUSED}`) as a bait-and-switch guard: nobody may apply on terms that then
change. The backend is unchanged. Instead the form is now editable for every
status except CLOSED, and "Update job" on a live job runs pause → save →
publish, so the job is off the board only while it changes. Each failure is
handled:
- Pause fails: nothing changed; an error is shown.
- Save fails: the job is republished unchanged, and the error says so.
- Republish fails (e.g. KYB no longer approved): the changes are kept, the job
  stays PAUSED, and the message says to publish again.

The update is disabled with an explanation when KYB is not approved, because
it would otherwise leave the job paused. Success reads "Job updated and
republished." `pauseEmployerJob` is now silent in `SUCCESS_MESSAGES`, so the
intermediate pause shows no popup; the standalone Pause button says "Job
paused." itself. Draft and paused updates are unchanged.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — college student details open as a left drawer

Opening a student on college Students showed a centred modal. It now uses
the same left drawer as the employer candidate profile: 520px, full height,
the `bp-drawer-left` slide and `bp-drawer-backdrop` fade, and a fixed header
and footer around a scrolling body. The content is unchanged: name, visible
since, score and band, application and interview counts, hires, the loading
skeleton, and the "no longer visible" state. The drawer also gained Escape to
close, a footer Close button and initial focus on the close control, none of
which the modal had.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — roster import rows open on their own page

"View rows" on a college roster import used to open a centred modal with a
55vh scroll box. It now navigates to
`/college/students/roster-imports/[importId]` (`RosterImportRowsPage`, with
its own `loading.tsx`). The table is the same shared `DataTable`: the same
columns (row, name, phone/email, student ref, state with issues), the same
All/Valid/Invalid/Duplicate filters, and the same server-side row-state filter
and 10-row cursor pagination with page-size choice.

The page adds:
- the header breadcrumb Students › file name › Rows, and a back link;
- the import's state and upload date;
- per-filter counts from `GET /college/roster-imports/{id}`;
- retryable errors for both the import and its rows.

The table now uses the full page width rather than a nested scroll. Students
stays highlighted in the sidebar on the new page.

`roster-rows-modal.tsx` is no longer imported or exported. The sandbox blocked
deleting it, so it (and `store/success-feedback-middleware.ts.new`) need
removing by hand.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — employer candidate profile opens as a left drawer

Opening a candidate on employer Candidates showed a centred modal and a
"Candidate profile opened successfully." popup. It now opens as a
full-height drawer that slides in from the left edge (520px, like the admin
drawers), over a lighter backdrop, and the popup is gone. The content is
unchanged: the header, profile summary, score, contact information, skills,
completed add-ons, and the loading, error and retry states. Escape, the
backdrop and both close buttons still close it. The drawer is 520px wide on
every screen size, so the summary and score stay side by side.

The slide and backdrop fade are shared classes in `globals.css`
(`bp-drawer-left`, `bp-drawer-backdrop`), turned off under
`prefers-reduced-motion`.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — search filter bulk import takes a CSV file

Admin → Search filters → Bulk import now accepts a `.csv` file instead of
pasted `Label | aliases` text. The dialog offers a downloadable template per
tab (`search-filter-skills-template.csv`, `search-filter-cities-template.csv`),
each with the header and three worked examples.

| Tab | Columns (label required; state_code required for cities) |
|---|---|
| Skills | `label, aliases, featured, sort_order` |
| Cities | `label, state_code, aliases, featured, sort_order` |

Aliases share one cell separated by `;`, since the comma is the CSV delimiter.
`featured` takes true/false/yes/no/1/0 and defaults to false. `sort_order`
defaults to 0. Headers are case-insensitive and may come in any order;
missing or unknown columns are named.

`features/admin/search-filters/csv.ts` parses in the browser. It follows
RFC 4180 (quoted commas, doubled quotes, embedded line breaks, CRLF, Excel's
BOM) and validates every row against the backend's rules: label 1–100
characters, at most 10 aliases, two-letter state code, the city-name
character rule, `sort_order` 0–10,000, no duplicate labels in the file, and
1–500 rows. Every problem is listed with its spreadsheet row number, and blank
rows are counted so the numbers match Excel. A clean file shows a preview and
an "Import N rows" button. The request body is unchanged: the parsed items are
sent as JSON to `POST /admin/search-filters/import`, which still validates and
accepts all rows or none. The backend is unchanged.

Validated with workspace TypeScript diagnostics. The sandbox would not run
Node, so the parser's edge cases were traced by hand. A check script for them
is kept in the session files (`csv-check.mjs`, run with
`node --experimental-strip-types`).

---

## 2026-09-25 — job threshold slider runs 0–990

The create and edit job forms' minimum-score slider now runs from 0 to 990 in
steps of 10 (it was 700–990 in steps of 1). The backend still requires
`min_score` to be null or 700–990 (request schema, `ck_jobs_min_score_range`,
preview query). Candidate scores start at 700, so any threshold below it
filters nobody. The form therefore sends such a value as `min_score: null`
(no threshold), and the backend is unchanged. Below 700 the form shows "No
minimum" and skips the threshold-preview request.

The rule lives in `features/employer/jobs/create/threshold.ts`, shared by the
slider, validation, request body and edit mapping. Two bugs fixed on the way:
- Validation still used the pre-v5 scale ("between 680 and 999").
- The slider's step of 1 let it request previews the endpoint rejects, since
  it accepts only multiples of 10.

Editing a job saved with no threshold now shows 0 rather than an invented 750.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — sidebar account section shows the signed-in person

The admin, employer and college sidebar footer showed an organisation name
read from the tenant slice, which sign-in never fills. So it always fell back
to hardcoded text: "BharatPath Employer", or "Sinhgad Institute of Technology"
for **both** college and admin. Admin was also labelled "Placement cell". No
portal showed who was actually signed in, and the logout button disappeared
when the sidebar was collapsed.

The footer now shows the signed-in email, then role and organisation: "Owner ·
<legal name>" from `GET /employer/organisation`, "College admin · <name>" from
`GET /college/organisation`, or "Platform admin · BharatPath operations" for
staff. Initials come from the email. A skeleton shows while the identity loads,
and logout stays available in the collapsed rail. The student sidebar keeps the
profile name and shows the email beneath it, falling back to the email when no
name has been entered yet.

`lib/auth/use-session-identity.ts` supplies the person. Sign-in already stores
them in the auth slice, now with `backendRole`. After a reload the slice is
empty, so the hook fills it once from `/api/auth/me`. The backend's `/auth/me`
returns no email, so that route used to answer with an empty one. It now reads
the `email` claim from the session token, but only after the backend has
accepted that same token; both the local and Cognito providers issue the
claim. `cognito_sub` is not read or exposed.

Validated with workspace TypeScript diagnostics. Browser checks omitted for
manual testing.

---

## 2026-09-25 — student portal hover states

Student dashboard cards, and most other clickable student surfaces, had only
a press effect (`active:scale`) and no hover. `features/student/components/
primitives.tsx` now exports `interactiveCardClass` (lift, warmer border,
shadow, keyboard focus ring), applied to job, application and notification
cards, profile stat tiles and the profile-visibility row. The purple score card
and the lilac add-on cards on the dashboard get the same lift in their own
tones.

The shared `PillButton` and `IconCircleButton` now have hover colours
matching the onboarding flow's existing palette (primary `#4A3E8F`, secondary
`#F7F4EC`). Pill hovers use `enabled:`, so disabled buttons do not react.
Because every non-onboarding student page uses these two primitives, this
covers the Jobs, Job detail, Board, Application detail, Score, Profile and
add-on pages at once. Job-feed and board filter chips, questionnaire choices,
the push-notification switch, the header avatar, the "All jobs" link and text
links also gained hover states. The only button left without one is the
mobile menu backdrop.

Validated with workspace TypeScript diagnostics and a script re-count of
clickable elements per file. Browser checks omitted for manual testing.

---

## 2026-09-25 — every success popup says what happened; sign-in shows none

The global popup no longer says "Action completed successfully." Each RTK
Query mutation has its own message in `store/success-messages.ts`, and a few
build it from the request ("Candidate shortlisted.", "Push notifications
turned off.", "Role changed to Admin."). All 64 mutation endpoints have an
entry. An entry of `null` stays silent for one of two reasons: the mutation is
one step of a larger action whose caller announces the whole thing (resume
upload ticket, job create-then-publish, name-then-location), or its page
already reports a more specific result (admin decisions, the import count).
An endpoint left out of the map shows nothing and logs a development warning.

Sign-in no longer shows a popup: the auth service announced every request,
login included. Sign-up now says "Your account is ready." explicitly, and
sign-out and session checks stay silent. The unused method-based
`showRequestSuccessFeedback` helper was removed.

Intermediate saves inside one action are marked `__suppressSuccessFeedback`
(the final KYB save before submit, the resume edit before confirm), so only
the final result is announced. The admin queue drawer now names the decision
(approved, rejected, more information requested, cleared, confirmed). Job
draft/publish success moved to the global popup; that page's local dark toast
now carries only errors. "Mark all as read" and dismissing a notification
also announce themselves.

Validated with workspace TypeScript diagnostics and a script check that every
`builder.mutation` has a map entry. Browser checks omitted for manual testing.

---

## 2026-09-25 — dashboard links land on the right section or tab

College dashboard quick actions now deep-link to their section rather than the
top of the Students page: "Issue a referral code" opens
`/college/students#referral-codes` and "Bulk upload a roster" opens
`#bulk-upload`. "Hired via platform" opens `/college/analytics#hires`.
`lib/hooks/use-scroll-to-hash.ts` scrolls to the hash only once the target
page's data has loaded; Next's own hash scroll runs before the skeletons above
the target are replaced, so it lands in the wrong place.

The admin dashboard's "Integrity flags" card opened the Queue on its default
KYB tab, because the tab lived only in Redux. The Queue page now honours
`?tab=kyb|integrity` and the Users page `?segment=candidates|employers|institutions`;
the dashboard links "KYB awaiting review", "Integrity flags" and "Active
employers" to the matching tab.

Validated with workspace TypeScript diagnostics. Browser checks were omitted
for manual testing.

---

## 2026-09-25 — consistent bottom padding on every table page

Admin Users, Queue and Settings tables ran flush to the bottom of the page:
`PortalShell` gave tabbed pages (settings, queue, users, disputes) `py-0` so
their tab bars could sit against the header, which also removed the bottom
gutter. Those pages now get `pb-4`, matching the `p-4` every other portal page
and every student page already has.

The per-page workarounds that would have stacked on top of it were removed:
Disputes' `pb-6`, the employer settings `py-4` (now `pt-4`), the college
settings `py-5` (now `pt-5`), and `pb-10` in the college Users and Billing
tabs. Candidates keeps its fixed pagination footer and Applications its own
`p-4`, as both already had a bottom gutter.

Validated with workspace TypeScript diagnostics. Browser checks were omitted
for manual testing.

---

## 2026-09-25 — employer and college dashboard cards are interactive

Employer and college dashboard cards now use the shared lift, border and shadow
hover treatment. Employer metric cards link to Jobs or Applications, and each
top-job row opens Applications filtered to that job. College metric cards link
to Students or Analytics, while the score-distribution and cohort-activity
cards open Analytics. Quick-action cards retain their existing destinations
and now use the same hover and keyboard-focus treatment.

Non-navigating dashboard panels also receive the visual hover treatment for
consistency. Copying the college dashboard referral code now uses the global
success popup.

Validated with workspace TypeScript diagnostics and focused source review.
Browser and Playwright checks were omitted for manual testing.

---

## 2026-09-25 — successful frontend actions use one global popup

The web frontend now mounts one accessible success popup at the application
root, using the existing green bottom-right presentation across the admin,
employer, college and candidate surfaces. Successful RTK Query mutations,
direct API-client mutations and authentication actions all feed that popup.
Existing admin and employer-specific success messages are bridged into the
same component instead of rendering separate notification styles.

Local successful actions that do not call a mutation are also covered:
save/unsave job, audited candidate and application opens, referral-code copies
and the roster-template download. Internal resume-upload steps and intermediate
saves inside compound submissions are suppressed so a partial operation cannot
produce a misleading success message.

Validated with workspace TypeScript diagnostics and focused source review.
Browser and Playwright checks were intentionally omitted at the request of the
manual tester.

---

## 2026-09-24 — admin filter tabs reset search

Switching between the Skills and Cities tabs in Admin Search Filters now clears
the search field and immediately restores the unfiltered query for the selected
tab. The internal catalogue-version placeholder beneath both table headings was
also removed.

Validated with targeted ESLint, `npx tsc --noEmit`, and `git diff --check`.

---

## 2026-09-24 — admin filter search uses readable entered text

The Admin Search Filters search field now applies the intended dark foreground
color to entered text while retaining the lighter placeholder treatment.

Validated with targeted ESLint, `npx tsc --noEmit`, and `git diff --check`.

---

## 2026-09-24 — admin filter search uses descriptive placeholders

The Admin Search Filters search field now uses explicit, tab-specific copy:
`Search by skill name or alias` for Skills and `Search by city name or alias`
for Cities. The same text is also the input's accessible label.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, and
browser checks of both tab states.

---

## 2026-09-24 — search-filter tables support selectable page sizes

The Skills and Cities tables in Admin Search Filters now expose the shared
rows-per-page dropdown with 10, 25, 50 and 100 options. Ten remains the initial
page size; changing it resets cursor navigation to page one and sends the
selected value as the API limit.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, a
production `npm run build` covering all 39 app routes, and a browser check that
all four options render and selecting 25 requests `limit=25`.

---

## 2026-09-24 — search-filter dialogs include field placeholders

The admin Search Filters Add/Edit dialog now gives every editable field an
example placeholder: label, city state code, aliases and sort order. Skill and
city examples are contextual, and a new option leaves sort order visually empty
with `0` as its placeholder while preserving zero as the default submitted
value. The Bulk Import dialog retains its existing format-specific placeholder.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, and a
production `npm run build` covering all 39 app routes.

---

## 2026-09-24 — cohort distribution displays proven zero counts

The college dashboard now displays `0` instead of a dash for a score band when
the scored-student total proves that all otherwise-null distribution cells are
zero. A null that could still represent a privacy-suppressed small cell remains
hidden, so the display improvement does not weaken the college analytics
privacy floor.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, and a
production `npm run build` covering all 39 app routes.

---

## 2026-09-24 — rejected disputes have a separate admin tab

The admin Disputes page now shows Open, Resolved and Rejected as three distinct
tabs. Resolved and Rejected each request their exact backend state with an
independent ten-row cursor paginator, loading/count state, retry path and empty
message; rejected cases are no longer grouped under the Resolved label.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, a
production `npm run build` covering all 39 app routes, and a browser check that
the Rejected tab renders and becomes active when selected.

---

## 2026-09-24 — audit trail uses animated loading indicators

The admin Disputes audit trail now shows the shared animated spinner instead of
list skeletons during both its initial request and cursor-based continuation
requests. Initial loading remains centred in the audit panel, while continuation
loading appears beneath the retained timeline entries.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, and a
browser check confirming the animated `Loading audit events...` status appears
without audit skeleton rows.

---

## 2026-09-24 — admin search filters use cursor pages and action dialogs

The admin Search Filters page now uses the shared `DataTable` and requests a
fixed ten options on its first page and every subsequent cursor page.
Previous/Next navigation retains the server cursor history and resets to page
one when the option kind, search text or inactive filter changes. Loading a
page renders ten structural table skeletons, and the table no longer displays
the internal sort-order column.

Add, edit and bulk-import forms now open in a reusable accessible modal instead
of expanding inside the page. Switching an option off or reactivating it uses
the existing confirmation dialog, and validation or request failures remain
visible in the active dialog without closing it. The reusable confirmation
dialog now also accepts in-dialog content and prevents Escape from closing it
while its action is running.

Validated with targeted ESLint, `npx tsc --noEmit`, `git diff --check`, and a
production `npm run build` covering all 39 app routes. Browser checks confirmed
the initial `limit=10` request, ten-row loading skeleton, shared table headers
without Order, and separate Add, Bulk Import and status-confirmation dialogs.

---

## 2026-09-24 — applications job filter loads options on open

Opening the employer Applications job filter now immediately requests the first
ten jobs without requiring search text. The custom select keeps those options
visible, requests the next cursor page when its menu reaches the bottom, and
appends the new jobs without replacing those already shown. Searching remains
server-backed: each debounced term starts a fresh ten-job cursor sequence.

The shared cursor accumulator now supports deferred first loads and invalidates
an in-flight continuation when its query changes. The shared searchable select
also exposes optional open-state and end-of-menu callbacks plus a separate
loading-more row, so other select users retain their current behavior.

Validated with targeted ESLint, `npx tsc --noEmit`, and a production
`npm run build` covering all 39 app routes. Browser network output confirmed
that opening the menu requests `/employer/jobs?limit=10`; the hosted API's CORS
response prevented completing the mocked continuation check in that session.

---

## 2026-09-24 — college institution type uses the shared dropdown

The Institution type field in College Settings now uses the shared custom
dropdown instead of the browser-native select. It preserves the empty
"Select a type" choice, the existing institution codes and profile save
behavior, while matching the height and full-width layout of the adjacent
institution-name field.

Validated with targeted ESLint, `npx tsc --noEmit`, and a production
`npm run build` covering all 39 app routes.

---

## 2026-09-24 — admin disputes and audit use cursor navigation

The admin disputes page now requests both active (`OPEN` + `IN_REVIEW`) and
closed (`RESOLVED` + `REJECTED`) queues as server-ordered cursor pages of ten.
The backend dispute endpoint accepts an explicit `state_group=ACTIVE|CLOSED`,
so the closed tab no longer merges two unrelated 100-row cursor streams in the
browser. Both tabs now use Previous/Next cursor navigation with a fixed
`limit=10`, and each tab has its own loading and error state.

The tab counters render compact skeletons while their current page is loading
instead of briefly displaying zero. The audit trail requests ten rows initially
and now observes a sentinel inside its own scroll container, appending
`cursor=...&limit=10` pages as the user approaches the bottom. Initial and
continuation failures are visible and retryable.

Validated with targeted frontend ESLint, `npx tsc --noEmit`, a production
`npm run build` covering all 39 routes, backend Ruff and mypy, and both legal
vocabulary checks. The focused database-backed admin tests were selected but
could not start because Docker Desktop (and therefore local Redis) was not
running; the new grouped-state cursor coverage remains in the integration
suite for CI.

---

## 2026-09-24 — candidate filter APIs use structural skeletons

The employer candidate filter sidebar no longer shows loading prose followed by
empty option groups while its catalogue request is in flight. Score bands,
skills, the state selector, locations, experience and add-on filters now render
row, pill and field skeletons in the same spaces as their loaded controls. A
background catalogue refresh keeps the current controls visible and shows a
small shimmer in the filter header.

Skill and city suggestion requests also render pill/row skeletons beneath their
search fields while preserving already selected values. This avoids flashing an
empty suggestion area during the search debounce/request transition.

The location state picker now uses the shared custom dropdown instead of the
browser-native select. Its compact trigger, constrained scrolling menu, selected
option check and accessible name are consistent with the other portal filters.

Validated with targeted ESLint, `npx tsc --noEmit`, and a production
`npm run build` covering all 39 app routes.

---

## 2026-09-24 — employer applications load ten at a time

Opening `/employer/applications` now immediately requests
`GET /employer/applications?limit=10`. Each pipeline column keeps its own
vertical scroll, and reaching the end requests the next organisation-wide
cursor with the same limit and appends the returned applications. A scroll
gesture also works when a column is not tall enough to overflow; if a fetched
page adds cards only to other stages, the interacted column continues through
the cursor until it moves away from the end or no page remains. The explicit
load-more button remains as a keyboard and sparse-column fallback.

Validated with targeted ESLint, `npx tsc --noEmit`, and a production
`npm run build` covering all 39 app routes. A browser test against mocked cursor
responses observed the initial `?limit=10` request and then
`?cursor=...&limit=10` after a downward wheel gesture; the board count changed
from one loaded application to two without replacing the first card.

---

## 2026-09-24 — route skeletons keep the final page position

Frontend route loading states now use the same left edge, width, tab height and
content grid as the pages they replace. This removes the visible jump where the
employer settings skeleton first appeared in a centred 720 px column and then
moved left when the page loaded. The same loading-only centring was removed
from college/admin settings, the admin queue/users/disputes pages, the employer
jobs list and the create/edit job forms.

The college dashboard and employer jobs list now live in pathless overview/list
route groups. Their parent loading boundaries previously covered every nested
route, so a dashboard or jobs-table skeleton could flash before a college
subpage or job form displayed its own fallback. Job create/edit also share one
form skeleton, including the edit page's client-side data wait, instead of
switching through a centred text loader.

Validated with targeted ESLint, regenerated Next route types,
`npx tsc --noEmit`, and a production `npm run build` covering all 39 app routes.
Browser verification at 1366 px showed the employer settings form skeleton at
the final content edge (`x=248`, previously `x=439`) and confirmed that job
create and college settings now paint their form skeleton first. Full frontend
lint remains blocked by five unrelated existing errors in college billing and
settings plus the student score ring and shell.

---

## 2026-09-24 — employer job and skill selectors search on demand

The Applications job filter no longer fills its dropdown from the currently
loaded application page. The menu now has a search field and requests matching
job names from `GET /employer/jobs?q=...`; without a search it keeps only
`All jobs` and the currently selected job. Requests use the shared debounce,
and loading, empty and API-error states are explicit.

The create/edit job form no longer carries a hard-coded skill list. Its
required-skills field searches
`GET /employer/discovery/filters/skills?q=...`, keeps chosen skills as
removable chips, and still permits a valid skill outside the curated catalogue,
as the backend contract requires.

Validated with targeted ESLint and an isolated `tsc --noEmit` program covering
the changed dependency graph. The full frontend type-check remains blocked by
the pre-existing `achievements`/`ResumeSectionKind` error in
`features/student/onboarding/components/review-step.tsx`. The shared browser
session could not complete an authenticated interaction check because its
employer API requests returned 401.

---

## 2026-09-24 — college students list uses a 10-row cursor

The college portal now sends `limit=10` and the current `cursor` to
`GET /college/students`. The student table renders the returned page directly
and provides Previous/Next controls backed by the API's `next_cursor`; it no
longer requests 100 students and paginates that partial result in the browser.
The page size is intentionally fixed at 10, so this table does not show a
rows-per-page selector.

Validated with `tsc --noEmit`, targeted ESLint, and an authenticated request
against the configured backend, which returned 200 for
`/college/students?limit=10`.

---

## 2026-09-24 — college roster rows use backend pagination and filters

The roster preview in the college portal now uses the cursor contract from
`GET /college/roster-imports/{import_id}/rows` instead of requesting the first
100 rows and paginating that partial result in the browser. The API adapter
preserves `next_cursor` and sends the selected `row_state`, current `cursor`
and chosen `limit`. The modal uses the shared cursor-pagination controls,
offers 10/25/50/100 rows per page, and resets to page 1 when the import or row
state changes.

Validated with `tsc --noEmit`, targeted ESLint, and the running college portal:
a 15-row import showed rows 1–10 and 11–15 on separate server-backed pages,
and selecting the empty INVALID state reset the table to page 1.

---

## 2026-09-24 — candidate sign-up on the web, from the app design

`/signup/student` is the candidate app's first-run flow (the design's "Try it",
"The score" and "Keep it" screens), rebuilt as a website that works on a
laptop. The step sits on the left and a sticky context panel on the right;
below `lg` it collapses to one column. The login page links to it. No backend
change.

Welcome → language → how it works → **account** → about you → resume
(upload, paste or form) → reading → check and correct → confirm → scoring →
the existing `/student/score` screen.

- **The account comes before the resume**, unlike the design. Every
  `/candidate/resume/*` route needs a candidate (the client reversed guest
  parsing on 2026-08-27), so "try it without an account" cannot exist.
- **Email, not phone OTP.** The design's phone screen predates the 2026-09-18
  decision. `app/api/auth/signup` now takes `pool: CANDIDATE`, with its own
  deterministic dev subject, so the same email resumes the same account. A
  signed-up candidate is not in `accounts.json`, so `/login` cannot sign them
  back in. They return through the sign-up page, and the login error says so.
- **Language** is saved as the notification locale (`PATCH
  /notifications/preferences`). The web UI itself is still English only.
- **Name and city** use `PUT /candidate/profile/name` and `/location`, with the
  backend's alphabet (letters, marks, `. ' -`). The 36 state codes are copied
  from `app/core/reference.py`.
- **Review** renders `sections` as cards. Unclear skills, languages and
  certificates open the "Fix this skill" sheet. Fixes replace the item inside
  the section's own text, matched between separators so "Java" never edits
  "JavaScript", so layout is kept. Any change is sent once as a `sections`
  edit (a new version), then that version is confirmed. A retry after a
  failed confirm reuses the version the edit already created. Structured
  (form) versions are corrected through the form, as a `structured` edit.
- **Scoring** polls `GET /candidate/score/me` and only counts a score computed
  after this confirmation. **Seeing the score is pay-first (R13)**: a new
  candidate with no subscription or college seat gets 402, and the screen then
  says the resume is saved and needs a subscription. By decision, no checkout
  was built into this flow.
- The design's images are not in the repo. The hero and step art are built
  from shapes and icons, and none of them is a dial or gauge.
- The screens up to the email step were checked in a browser at 1366×768.
  Everything after it needs a real account and was not run against a backend.

---

## 2026-09-24 — search boxes wait for the user to stop typing

Every search box that calls the API now waits until typing has stopped for
**2 seconds** (`SEARCH_DEBOUNCE_MS`, `frontend/lib/hooks/use-debounced-value.ts`)
before sending a request. Before this, `useDeferredValue` sent roughly one
request per keystroke. It covers the student job feed, employer jobs,
employer candidate search and its skill and city suggestions, admin users,
and admin search filters. Clearing a box applies at once.

- While a suggestion box is waiting, the list already on screen is narrowed
  locally and the "add this skill/city" option follows the typed text, so the
  panel still reacts to every keystroke without a request.
- Candidate search keeps the box's text locally and commits it to the store
  only once it settles. The store resets the cursor, so committing on every
  keystroke would refetch the old search's first page.
- `useCursorPagination` now resets during render instead of in an effect. The
  effect let one request go out with the new filters and the old page's
  cursor before the reset landed.
- Team and college roster search filter in the browser and call nothing, so
  they are unchanged.

---

## 2026-09-24 — employer sign-up with step-by-step KYB (frontend)

`/signup/employer` takes a new employer from nothing to a KYB submission, one
step at a time: account, organisation, then **one step per section of the
published KYB form** (`GET /employer/kyb/form`), a review, and submit. The
login page links to it. No backend change.

- **The form is rendered from the definition, not hard-coded.** Labels,
  types, required flags, patterns, max lengths, help text and option lists
  all come from the API, so a new `FORM_VERSION` renders unchanged. Fields
  marked `public` are badged "Shown to candidates".
- **Every step saves** (`PUT /employer/kyb/answers`, that section's fields
  only; blanks are sent as `null` to clear). Submit saves every section once
  more and then calls `POST /employer/kyb/submit`, because a section edited and
  then left through the step list was never saved on its own. Client checks
  mirror `app/core/forms.py`; the server stays the authority, and a
  `kyb_answers_invalid` refusal marks every listed field and jumps to the
  first failing step.
- **Documents** go ticket → raw PUT to the presigned URL → `complete`. Uploads
  are serialised and block navigation until they finish; a
  `kyb_document_rejected` reason becomes its own message.
- **Resuming.** A signed-in owner lands on the first incomplete step. A
  non-editable submission (SUBMITTED, UNDER_REVIEW, APPROVED) shows its status
  instead; MORE_INFO_REQUIRED shows the reviewer's note above the form;
  REJECTED offers a new submission with the old answers prefilled (documents
  must be uploaded again, because the next save starts a fresh draft).
- **Sign-up is local-dev only, like sign-in.** `app/api/auth/signup` mints a
  BUSINESS-pool token through `/auth/dev/token`, with a subject derived from
  the email, so signing up again with the same address resumes the same
  account. The deployed path is Cognito `SignUp` → code → MFA, which the web
  app does not implement yet; with local tokens off the route answers 503.
  A signed-up employer is not in `accounts.json`, so they return through
  `/signup/employer`, not `/login`.
- Not runtime-tested against a backend in this session; `tsc` and `eslint`
  pass.

---

## 2026-09-24 — frontend search filters use the curated catalogue

The employer Candidates screen no longer carries its own skill, city, band,
badge or experience lists. It reads `GET /employer/discovery/filters`, uses
the skill and location suggestion endpoints while the employer types, and
still offers the backend-supported free-text option when a spelling is not in
the catalogue. State, multi-city selection and the limits returned by the API
are enforced in the panel. Candidate pages now default to 10 rows.

The admin portal now has `/admin/search-filters`, visible in its navigation.
PLATFORM_ADMIN and SUPPORT_AGENT can list active or inactive skills and
cities, search them, create one, bulk-import up to 500, edit aliases/state/
featured/order, and switch an option off or reactivate it. The page calls the
existing `/admin/search-filters` APIs; it never deletes an option. Successful
mutations invalidate the employer filter catalogue cache.

The candidate list treats every in-flight search as loading, not just the
first request: changing a filter, page or page size replaces the cards with a
skeleton and announces "Updating candidates..." until the response arrives.
Unsupported stale page sizes are normalised to the 10-row default, and the API
adapter also defaults an omitted limit to 10.

Opening a candidate now shows a responsive profile dialog built from the
reveal response: name, display score and band, experience, location, contact
details, skills and completed add-ons. The dialog opens immediately with a
layout-matched skeleton, has an explicit retry state, closes from the backdrop,
button or Escape key, and keeps the score as text rather than a gauge.

---

## 2026-09-24 — employer dashboard uses its aggregate APIs

The "Top jobs by applicants" rows are summary metrics, not navigation. They
now render as non-interactive content instead of buttons and no longer open a
job when selected.

The frontend now reads `GET /employer/dashboard` for its job and pipeline
counts and top jobs, plus `GET /employer/dashboard/activity` for the recent
activity feed. It no longer loads or reconstructs dashboard data from
`GET /employer/jobs`. Subscription status remains a separate request because
the aggregate endpoints are paywalled and do not return the access-window end.
Unpaid employers do not call either paywalled dashboard endpoint.

Recent activity uses the endpoint's cursor as an infinite query. The first 10
events render immediately; scrolling within the feed fetches and appends each
next page, with an in-feed loading indicator and no duplicate jobs request.

---

## 2026-09-24 — the candidate search filters get a catalogue staff curate

Asked for by the frontend against the Candidates screen: the filter panel
(band, skills, location, experience) had nothing to load its options from,
and skills and locations needed a typeahead with "add your own".

**Employer side** (owner/recruiter, subscription, own rate limit
`discovery.filters` — 120/min per person, deliberately *not* the
organisation's `discovery:search` pages, which the panel used to burn):

- `GET /employer/discovery/filters` — bands, badges, experience steps
  (1/3/5/10), the 36 states, featured skills and cities, and the limits the
  search enforces. **No counts, anywhere** — a test walks every key.
- `GET /employer/discovery/filters/skills?q=` and `/filters/locations?q=&state=`
  — exact, then starts-with (label, then alias), then contains.
- `GET /employer/discovery/candidates` now takes **up to 5 `city` values**,
  any of which may match (skills are still all-of). A city filter is checked
  with the candidate's own city rule, so `Pune 411001` is 422
  `discovery_city_invalid` instead of silently matching nobody.

**Why aliases, not just a list.** Skills are whatever Layer 1 wrote and
match by exact key; cities are whatever the candidate typed. "Forklift
certified" never met "forklift operation", nor "Bengaluru" "Bangalore". A
value that names an option (label, key or alias) now searches every spelling
of it — per skill `skill_keys && group`, the same GIN index; for cities an OR
of trigram contains-matches. **Anything else searches exactly as before**,
including the trigger's un-collapsed inner spaces, so the catalogue only adds
reach.

**Staff side** — capability `search_filters`, PLATFORM_ADMIN **and
SUPPORT_AGENT** (client, 2026-09-24): list, create, import (`/import`, ≤500, all
or none), get, PATCH. Every change is an audit row
(`search_filter_option_created` / `_updated`); a no-op PATCH writes none.

**Decisions worth knowing:**

- **A table, `search_filter_options`, not a `config_values` row.** Per-item
  edits by two staff would clobber whole-document versions, and the list will
  grow. Owned by `discovery`; the admin service adds the audit row.
- **Switched off, never deleted** (the app role has no DELETE). An inactive
  option leaves the panel and typeahead and stops expanding, but its label
  still searches as plain text, and it keeps its spellings.
- **One spelling, one option per kind**, active or not: unique `(kind, key)`
  plus an alias check under a per-kind advisory lock. 409
  `search_filter_option_conflict` names the spelling.
- **Suggestions come from the catalogue, never from candidates' skills.** A
  rare skill in a dropdown tells an employer someone has it.
- **A city must name its state; a skill cannot.** CHECK-held.
- Starter lists (89 skills, 67 cities) are **ours** —
  `discovery/catalogue.py`, `FILTER_CATALOGUE_VERSION = placeholder-…`, a
  test holds the prefix. `scripts/seed_filter_options.py` writes only options
  none of whose spellings exist, so it never undoes console edits; it now
  runs in `reset_local_db.sh` and the prod `migrate` step. **The baseline
  gained the table, so the EC2 database needs a reset** (agreed).

Known limit: two same-named cities in different states (Aurangabad MH/BR)
cannot both be options, because the search filters by city name. Filter by
`state` alongside.

---

## 2026-09-23 — the pipeline list no longer needs a job

Raised by the frontend against the Applications board: "All jobs" was a
`GET /employer/applications?job_id=…` per job, merged on the client, about
fifteen requests for one screen. `job_id` is now **optional**. Without it the
list spans every job the organisation has, in one oldest-first order, and the
stage filter and cursor behave as before. The response item is now
`EmployerApplicationListItem`, which is the summary plus `job_title` and
`job_location`, so the cards need no second lookup. The change is additive:
existing callers passing `job_id` see two new fields and nothing else.

The frontend now uses that contract. It always makes one organisation-wide,
paginated applications request without `job_id`; selecting a job filters the
loaded rows locally and does not start another applications request. It no
longer walks the jobs list or merges a separate cursor per job, and each card
gets its job title/location from its own application row.

The Applications tab also no longer loads the jobs catalogue or automatically
reveals every candidate on the page. Its filter options are derived from the
application rows, and cards remain honestly masked because this response does
not contain a name or score. Opening an application still uses the
applications detail endpoint; no jobs or candidate-profile request is made on
page load.

Large application pipelines now follow the backend's single organisation-wide
keyset cursor in pages of 50. Reaching the end of any stage column or using the
visible "Load next 50" control sends the returned `next_cursor`, fetches
exactly one next page and re-buckets those rows into their stages; it does not
start a cursor per job or stage. The loaded count and remaining-page state are
visible. DECISION, WITHDRAWN and EXPIRED are represented explicitly so every
backend application stage remains visible rather than disappearing from, or
being mislabeled in, the board.

The application card no longer renders a "Masked" status pill when its list
row has no score. The header keeps its normal spacing and only shows a band
badge when genuine band data is present.

The employer sidebar's Applications badge now reads
`/employer/dashboard`'s authoritative `applications.open` aggregate instead of
counting whichever cursor pages happen to be loaded in Redux. It therefore
matches the full open pipeline across jobs and stages, and application
mutations refresh it through the shared `Application/EMPLOYER_LIST` tag.

The employer Subscription tab now uses a layout-matched loading skeleton for
the current-subscription panel and its three plan cards instead of collapsing
to a small spinner while the subscription and plan queries resolve.

The employer dashboard's fourth metric now shows the backend's live
`applications.new_last_7_days` value instead of repeating the subscription
expiry already shown in the portal header. The card is labelled "New
applications" with a "Last 7 days" qualifier.

The admin dashboard frontend contract now matches the backend `AdminDashboard`
schema. `oldest_waiting` uses `type` plus its organisation/candidate/party
identifiers instead of nonexistent `queue` and `label` fields; throughput uses
`intake`; platform totals use `jobs_published` and `hires`; and capability-
hidden queue sections are nullable. This fixes the `initialsOf(...).split`
runtime crash and the totals/chart values that were previously becoming
undefined or `NaN`.

The Admin Users drawer now opens candidates through
`GET /admin/candidates/{user_id}` instead of returning `null` for the entire
candidate segment. It presents the audited candidate drill-down's profile,
masked contacts, display score and band, resume counts, employer visibility,
application stages, integrity signals, college links and disputes. Tenant-only
suspension and seat-allocation controls remain limited to employer and college
drawers.

The admin dashboard now shows layout-matched skeletons for Platform totals and
Intake vs cleared during both route streaming and the client dashboard query.
The totals placeholder contains all six rows, and the throughput placeholder
preserves the chart header, fourteen paired bars and footer instead of briefly
showing empty-state production panels while data is loading.

The college dashboard header seat widget now receives the seat query's loading
and refetching state. Until `GET /college/seats` responds it renders a compact,
non-clickable skeleton matching the final widget instead of displaying
temporary `0 / 0` usage.

The College Students tab now applies the same request-aware loading treatment
to every API-backed section. The header seat widget, student table, link-state
counts, roster imports and referral codes show layout-matched skeletons during
initial requests and refetches; static filters, invitations and CSV upload
remain available without waiting for unrelated reads. Its route-level fallback
also covers the roster-import and referral-code panels.

The Link states loading treatment now replaces each complete state card rather
than only swapping its number for a small block beside a live icon and copy.
Three equal-height, colour-matched placeholders preserve the final card layout
and avoid the visually broken mixed loaded/loading state.

Every student portal route now shares one responsive, 1280px-capped content
container instead of narrowing selected detail, score, notification and add-on
pages to 768px or 1024px. At ordinary laptop widths, the job and application
detail screens now use the same 16px content gutter as the board and the rest
of the portal, without horizontal overflow on mobile.

The student board, application detail, job detail and profile now use
layout-matched skeletons while their client queries resolve. Application
detail, job detail and profile also have route-level loading fallbacks. The
board keeps its skeleton at the query boundary rather than a parent
`loading.tsx`, because a parent fallback would incorrectly replace the nested
application-detail skeleton on direct loads.

The student header now uses the same notification centre as the admin,
employer and college portals. The bell opens the shared paginated dropdown
with unread state, mark-all-read and dismissal behavior instead of navigating
to a duplicate full-page implementation. The old `/student/notifications`
URL redirects to the student home screen for existing bookmarks.

The student dashboard now uses layout-matched skeletons for every asynchronous
area: the greeting, resume-score card, both add-on cards and the eligible-jobs
grid. Loading no longer exposes temporary labels such as "Loading score",
"Loading jobs", "Unavailable" or zero sessions while those requests are still
in flight, and the skeleton layout has no horizontal overflow.

The student Jobs feed now requests cursor pages of 10 and automatically loads
the next page as its end sentinel approaches the viewport. The manual
"Load more" control is gone; next-page requests append to the existing cards
and show card-shaped skeletons. A failed next page keeps the jobs already
loaded and offers an explicit retry instead of replacing the feed with a
full-page error.

College Settings now fetches data on demand by active surface instead of
subscribing every mounted component to every settings query. The shared header
requests seat usage, College profile requests only the organisation, Users
requests only the team, Seats & payment requests seats, subscription and plans,
and the Onboarding form remains mounted and fetched only on its own tab.

The Admin Users college drawer now presents the complete audited college
drill-down in compact sections: institution and verification dates, subscription
period, connected and individually visible students, seat utilisation and plan
allowance, team roles, referral activity, roster imports, invitations, disputes
and suspension state. The seat editor is initialised from the returned
allocation instead of `0`, validates the live used-seat floor and plan ceiling,
and disables updates until the value is both valid and changed.

- **New index `ix_applications_tenant_created (tenant_id, created_at, id)`**,
  in the model and therefore in the baseline. `ix_applications_job_stage`
  starts with `job_id` and cannot serve a list across jobs. It is a hot path in
  `test_index_review.py`. **Existing databases (Render, EC2) need a rebuild or
  a hand-run `CREATE INDEX CONCURRENTLY`**, because there are no incremental
  migrations.
- The cross-tenant invariant now also lists without a job and asserts none of
  the other organisation's applications or jobs come back.
- **The 429 that prompted this was not a rate limit.** The Render deploy had
  no reachable Redis (`/api/v1/health/ready` → `redis: down`). The fail-closed
  limits (search, reveal, threshold preview, discount codes, analytics,
  privacy) answer `429 rate_limit_unavailable` in that state, and the global
  tier fails open, so nothing else looked broken. Fixing it means setting
  `REDIS_URL` on the service. No code change is needed.

## 2026-09-23 — `GET /employer/jobs` is paginated

Reported by the frontend: `?limit=10` returned every job. The route never
declared `limit`, so FastAPI dropped it, and the service always read up to a
fixed 100 (`MAX_JOB_LIST`, now gone). It was the only list in the API without
a cursor.

It now takes `limit` (1–100, default 50) and `cursor`, keyset on
`(created_at, id)`, and returns `Page[JobListItem]`. **That is a breaking
change to the response** — a bare array became `{ items, next_cursor, total }`
— made in the backend only, by decision; the frontend in `frontend/` still
reads an array (`store/employer/jobs/jobs.api.ts`) and is the frontend
developer's to move. The dashboard and applications screens that want every
job must follow `next_cursor`. The cursor's timestamp key is `c`, not the
board's `p`, so a `/candidate/jobs` cursor is refused here rather than
silently misread. No new index: jobs per tenant are few and
`ix_jobs_tenant_status` bounds the scan.

`main` paginated the same route independently, with the same shape and cursor
key, and added `q`, a server-side search over title and location. The merge
takes `main`'s implementation. This branch contributes the tests in
`test_jobs.py`, which pass against it.

## 2026-09-23 — the admin console can list candidates

Reported: `GET /admin/tenants?type=CANDIDATE` answers 422. That is correct,
since a candidate is not a tenant. The real gap was that the console had
no way to *find* a candidate at all: `GET /admin/candidates/{user_id}` needed
an id nobody could look up.

**`GET /admin/candidates`**: candidate accounts, newest first, filtered by
`status`, `q` (part of the full name) and `email` (the exact address).
Rows carry id, status, name, city, state, masked phone and email, created_at.
Documented in `backend-guide/13` §4.

### Decisions worth knowing

- **Same capability as the drill-down (`candidate_drilldown`)**: whoever
  may open a candidate may find one. Not a new capability, so the two cannot
  drift apart.
- **Audited, where `/admin/tenants` is not**: every row names a person. One
  `admin_bypass_session_opened` row per page, `view: candidates`. **The search
  terms are not in the metadata**, only `by_name` / `by_email` flags; a
  name or an address is personal data, and the audit log holds ids.
- **The row is for picking, not reading**: no score, band, CV, subscription
  or application counts. All of that stays behind the drill-down, which
  audits the one person opened.
- **`email` is exact, not partial**, so it cannot enumerate a domain. `q`
  escapes `%` and `_`, like `/admin/tenants`.
- **Index `ix_users_pool_created (pool, created_at, id)`** on `users`, and the
  query is in `test_index_review.py` `HOT_PATHS`. **It is on the model, so
  only a rebuilt database has it.** Locally it was created by hand
  (`CREATE INDEX IF NOT EXISTS ...`). The EC2 database was built from the
  baseline before this change and will not get it from `alembic upgrade`. It
  needs the same statement run once, or the list scans `users` there.

---

## 2026-09-23 — the admin console gets a dashboard endpoint

Asked by the frontend team: KYB awaiting review, integrity flags, open
disputes, active employers, oldest items waiting, platform totals. The page
was built from the queue endpoints: a hundred rows of each, counted, shown
as "100+" past that, with two audited bypass sessions per load, "Candidates"
hard-coded to "Unavailable" and the intake/cleared chart given `[]`.

**`GET /admin/dashboard`**, one request, one audit row. Sections: `kyb`
(the R15 switch, awaiting review, awaiting the employer, oldest), `integrity`
(open by severity, **candidates held back** — people with an OPEN HIGH signal,
already out of search before anyone looked), `disputes` (open, in review,
unassigned, by kind), `organisations` (employers and colleges by status),
`platform_totals` (candidates, employers, colleges, published jobs,
applications, confirmed hires), `oldest_waiting` (five, across the queues),
and `throughput` (14 IST days of intake vs cleared). Documented in
`backend-guide/13` §0.5.

### Decisions worth knowing

- **A new capability, `dashboard`, for every staff role, and each queue
  section is null unless the caller holds that queue's own capability**
  (`domain.dashboard_sections`, read from `CONSOLE_ROLES`). A KYB reviewer's
  landing page does not count integrity signals they cannot open. Platform
  totals are for everyone: counts, naming nobody. `oldest_waiting` and
  `throughput` are drawn only from the sections shown.
- **Audited, through `_reveal`, once per load**: `oldest_waiting` names
  organisations and candidate ids. Added to `test_no_audit_row_means_no_reveal`
  and to `ROUTE_CAPABILITY`.
- **Auto-approved KYB is neither intake nor cleared** on the chart: it never
  waited on anyone. While `review_required` is false the KYB tiles read zero,
  which is true.
- Tests assert **deltas around one action**, never absolute numbers: the
  console counts the whole shared test database.

### A cost to watch

`throughput` filters `integrity_signals` and `disputes` on `created_at` and
`resolved_at`, which no index leads with, so it scans both tables per load.
Both are small now (one row per flagged CV, one per complaint). If either
grows, an index on `(resolved_at)` and `(created_at)` is the fix, and the
query shapes belong in `test_index_review.py` `HOT_PATHS` then.

---

## 2026-09-23 — the employer dashboard gets its own endpoint

Asked by the frontend team: active jobs, total applicants, top-k jobs by
applicants, and "recent activity — to be discussed", with more metrics to
come. The dashboard page was assembling these itself: the jobs list, then
**every job's applications paged through in full just to count them** —
one request per job per hundred applications, on every load. Two cards
("Candidates unlocked", "Credit balance") were hard-coded to 0.

**`GET /employer/dashboard`** answers it in one request, every tile counted
from one snapshot: jobs by state, applications (total, open, distinct
candidates, new in 7 and 30 days, by stage), what needs attention (unreviewed,
interviews to schedule and coming up, hires awaiting the candidate or
disputed, applications that will expire within a week), candidates revealed,
the top k jobs (1–20, default 5), the next five interviews, and 30 IST days
of applications per day. **`GET /employer/dashboard/activity`** is the pipeline
history across every job, newest first, cursor-paged, filterable by who acted.
Both: any employer role, behind the subscription like the pipeline.
Documented for app teams in `backend-guide/06` §8.

### Decisions worth knowing

- **It lives in `applications`**, mounted by `get_extra_routers()`. That is
  where the data is, and `applications.service` already calls `jobs.service`
  and `discovery.service`. In `employer` it would have closed an import cycle
  (`jobs.service` imports `employer.service`).
- **`expiring_within_7_days` is the sweep's own rule moved forward**
  (`domain.expiry_horizon`), read against the live `applications.expiry` row,
  so the tile and the sweep cannot disagree. A unit test holds the boundary
  to `expires()` itself. A bad config row is a 500 here as in the sweep.
- **The activity feed reads `application_events`, which has no RLS**, only
  through a join to `applications` under the tenant policy. A test shows
  another organisation's events never appear. No `note` and no candidate id:
  a feed is read at a glance by the whole team.
- **`candidates_revealed` counts distinct people** from the organisation's
  own `candidate_view_events` (`discovery.repository.revealed_counts`, added
  to `READS_NO_CANDIDATE`), as the caps do. Re-opening is not counted twice.
- **`applications_per_day` counts in `Asia/Kolkata`**, not `+05:30`: Postgres
  reads a POSIX offset with the sign reversed.
- Two new query shapes in `test_index_review.py` `HOT_PATHS`.

### Not built, deliberately

- **"Credit balance"** has no backend counterpart. There are subscriptions,
  not credits, and "credit" beside a score is close to the framing invariant
  6 exists to keep out. The card needs a product decision, not an endpoint.
- **Job-posted, reveal, KYB and purchase events are not in the feed.** The
  mock-up shows them; the ask said the feed is still to be discussed. Each is
  a different table with its own visibility rules, so it is a union to agree
  first rather than guess at.

---

## 2026-09-23 — the review screen reads a CV as sections, and edits it that way

Raised by the frontend team against the review design (cards for education,
skills, experience, a pencil on each, skill chips flagged "unclear"). An
uploaded or pasted CV reached the client as one `raw_text` string, so none of
those cards could be filled.

**`GET /candidate/resume/versions/{id}` now carries `sections`**: the text split
at recognised headings (`CAREER OBJECTIVE`, `Academic Qualifications:`,
`Skills: a, b`, ...) into eleven kinds, with skills, languages and
certifications also broken into `items`. A near miss of a known spelling is
`unclear` with a `suggestion` (`MS-Ofice` → `MS Office`); **an unknown skill is
not unclear**. Null for a structured version, whose `parsed` already has fields.

**`POST .../edit` takes `sections`** as a third shape beside `text` and
`structured`: every section in order, edited or not (one left out is deleted).
It is assembled into text, normalised like a text edit, and stored as
`raw_text`. Same version chain, same unconfirmed-until-confirmed gate.

### Why the text stays the scored thing

The obvious build — parse the upload into `ManualResumeRequest` and let the
client edit fields — is lossy. The form has nowhere for most of a CV's prose,
and that prose is what Layer 1 reads for achievement specificity, progression
and scope. A candidate fixing a typo on the review screen would quietly lose
points. So sections are a **view computed on every read, never stored**, and an
edit goes back to text. `sections.py` is pure and holds two properties in tests:
no line is lost by splitting, and splitting what was assembled gives the same
sections back. A heading we do not recognise stays a line in the previous
section's body — visible and editable, not lost.

A heading sent back must name its kind, and `header` can only come first;
otherwise the section would merge into its neighbour on the next read. Both are
422s.

### No model call, deliberately

A pre-confirm LLM extraction would give fielded entries (institution, marks) but
doubles model spend per upload while E17 is open, and there is no model wired by
default. The splitter is deterministic and free. Entries inside a section are
the client's to split on blank lines; percentages and colleges stay in the text.

**`resume/vocabulary.py` is ours** (`VOCABULARY_VERSION = placeholder-…`, held
by a test). It only decides whether to *ask*; nothing in it reaches scoring.

Not changed: a text edit of an upload (either shape) still drops the hidden-text
analysis, as `text` edits always have.

---

## 2026-09-23 — frontend production type-check restored

The frontend production build had three stale wiring errors after the broader
student contract fixes landed: the shared recent-activity component imported a
type from the college dashboard even though only the employer dashboard defines
that data, the job create/edit page called the shared API error formatter without
importing it, and the completed college billing slice was never mounted in the
root Redux store.

The shared activity component now owns its small rendering contract instead of
depending on either portal, job mutations use the existing centralized API error
formatter, and `collegeBilling` is registered alongside the other portal state.
The missing student formatter and RTK Query API modules were also restored from
their backend-aligned contracts, reconnecting the existing student components
and store barrel exports.
The root request interceptor was migrated from Next.js's deprecated
`middleware.ts` convention to `proxy.ts`; only the file and exported handler
name changed, so the host-based portal routing and matcher remain identical.
`npm run build` completes successfully, including TypeScript checking and static
page generation.

---

## 2026-09-23 — the employer's jobs list carries its own funnel

Raised by the frontend team against the jobs screen: the table draws a column
per pipeline stage, and there was no way to fill any of them but
`GET /employer/applications?job_id=…` once per row. Thirteen jobs, thirteen
requests, and nothing on screen until the last returns — so the columns were
rendering as zeros instead.

`GET /employer/jobs` now answers `JobListItem`: `JobResponse` plus
`application_counts` (`total`, and `by_stage` with every stage present).
**One aggregate across the page, not one query per job** — that is the whole
point of the change, and a `stage_counts` call per row would have satisfied
the frontend's ask while leaving the cost exactly where it was.

`by_stage` is **where applications are now, not where they have been**, so it
sums to `total`. The funnel reading — "reached this stage at some point" —
needs `application_events` and does not sum to anything; if the client ever
wants it, that is a different endpoint and a much heavier query. Said plainly
in the response docstring and in `backend-guide/05`, because the two readings
differ only on rows that have moved, which is to say not at all on a fresh
test fixture.

**The counts are on the list and nowhere else.** Adding them to `JobResponse`
would put them on `create`, `publish`, `pause` and `close` as well, where they
are either a guaranteed zero or an extra query nobody asked for.

### The direction of the dependency, which is the only interesting part

`applications.service` already imports `jobs.service`. Reaching back the other
way — `jobs` calling `applications` for the counts — makes the two modules
mutually dependent, and that mutual import is exactly what `module-privacy`
exists to prevent: it is what would make either one unextractable later.

So `jobs.repository` reads the `applications` table as a `table()` construct
rather than through its ORM model, and takes the stage names from
`applications.domain`, which is pure and imports nothing. Same shape as
`discovery` reading `scores` because it may not import `scoring`. Nothing new
in the graph: `lint-imports` keeps all ten contracts.

---

---

## 2026-09-22 — Mock interviews follow the candidate subscription

Removed the second, one-off interview payment from the mobile flow. The
backend already treats interviews as subscription-included
(`0002_interviews_in_subscription`): an active candidate subscription plus a
fresh passed device check starts a session with `purchase_id = NULL`; the
legacy `/candidate/interview/checkout` route remains deprecated for old
clients and historical payment records only.

The mobile flow is now:

1. Interview intro (no price) → **Test before interview**.
2. Device check passes → `POST /candidate/interview/sessions` immediately.
3. The returned session opens directly; an existing open session is resumed.

The obsolete interview payment sheet and briefing route were removed. The
intro says the tool is included in the active subscription and never opens a
second payment. The live local database was upgraded from `0001_baseline` to
`0002_interviews_in_subscription`; without that migration the new
`purchase_id = NULL` insert hits the old guard.

The network check had been requesting `/openapi.json`, but this API mounts its
schema at `/api/v1/openapi.json`; the 404 body was small enough to be
misclassified as a slow transfer. It now requests the correct URL and rejects
non-2xx responses before calculating throughput. Verified over the LAN:
`200`, 268,443 bytes, well above the server's 16 kbps floor.

Backend interview and evaluation integration tests: **18 passed**. Mobile
TypeScript passes; lint has no errors (12 pre-existing unrelated warnings).
The live verification call created subscription-included session
`d72ac98a-e075-4c36-a02e-4dff6e39293b` (session 2, `CREATED`) for the local
candidate; the app should resume it rather than create another.

---

## 2026-09-22 — Interview audio upload failed: LocalStack had no buckets

A recorded answer uploaded from the phone was refused `404`. The presign call
succeeded — S3 signing happens without touching the bucket — so the failure
only appeared at the `PUT`. LocalStack held **no buckets at all**: its state
had been lost while the container stayed up, so `init_localstack.sh`
(mounted at `/etc/localstack/init/ready.d/init.sh`, run at container start)
never ran again.

Recovery, and the thing to try first when any presigned upload answers 404:

```bash
cd backend && docker compose exec -T localstack bash /etc/localstack/init/ready.d/init.sh
docker compose exec -T localstack awslocal s3 ls   # expect six buckets
```

The script is idempotent. Verified afterwards that a presigned PUT succeeds
both as signed (`localhost:4566`) and through the LAN host the phone uses —
LocalStack does not reject the rewritten `Host`, so
`reachableStorageUrl` remains correct.

The mobile client now reads the storage refusal body and names the code, so
`NoSuchBucket` says so instead of showing a bare HTTP 404.

**The native audio player has no nullable source.** `AudioPlayer.replace(null)`
is rejected on Android ("Cannot assign null to not nullable type"), and the
rejection surfaced inside the send path, where it read as a failed upload.
Clearing a finished answer is now a pause and a rewind; only a new recording
replaces the source. Every player call is wrapped: reviewing an answer is a
convenience, and it must never fail the recording or the upload around it.
The three answer rules the server enforces on the stored object
(`answer_too_small`, `answer_too_large`, `answer_not_audio`,
`answer_duration_out_of_range`) now have candidate-facing messages, and the
app refuses to send a recording under a second rather than have the server
delete it.

---

## 2026-09-22 — Interview API probed (mobile UI not changed)

Live-tested `/candidate/interview` on the subscribed candidate
(`onlyritik10@gmail.com`). Offer, failed and passed device checks, checkout
without a check (`409 interview_device_check_required`), start without a
purchase (`409 interview_purchase_required`), stub payment settle, session
start, upload ticket, complete-without-bytes (`409 interview_answer_not_uploaded`),
finish-early (`409 interview_answers_missing`), and report-on-open
(`409 interview_session_not_completed`) all matched the documented contract.

Residue on that local account: one SUCCEEDED `INTERVIEW_SESSION` payment
(₹349) and an **open** session `e1e167bd-b0c6-47f0-a12d-d269537827fc`
(`SET_1_FOUNDATIONS`, `IN_PROGRESS`, all six answers still `PENDING`). There
is no abandon route; the next interview integration must resume it via
`open_session_id`. Mobile mock interview screens were not wired.

---

## 2026-09-22 — Mobile questionnaire integrated

Replaced the mobile "Attribute check" personality mock-up with the backend
questionnaire at `/candidate/questionnaire`. The app now loads the versioned
bank and saved answers, renders the four sections and all five API question
types, merge-saves with `PUT .../answers`, submits with `POST .../submit`, and
reads the section report from `GET .../report`.

The UI is driven by the response rather than a local question bank:

- SINGLE and MULTI use the option codes returned by the API.
- BOOLEAN stores a real boolean; NUMBER follows the backend's 0–100,000
  bounds; TEXT follows its 1,000-character bound.
- `PREFERRED_LOCATIONS` has no API options, so the UI accepts up to five
  comma-separated place names using the same no-digit/no-`@` validation.
- Every question remains optional; clearing sends `null`, which is the
  backend's documented delete operation.
- The report is only a read-back of shared answers. The invented personality
  type, dimension meters, role recommendations, 24 Likert questions and local
  scoring engine were deleted. The questionnaire remains worth zero points.

The Home card no longer says `FREE` or "24 questions"; it says "About 12
questions", then "View your answers" after submission. The bank still reports
`placeholder-1-2026-09-11`, so its wording remains client-placeholder content.

Live API validation covered load, merge-save, report label rendering (`true`
became "Yes"), and clearing with `null`. The temporary empty submission was
removed afterwards, restoring the candidate's original not-started state.
Mobile TypeScript and IDE diagnostics pass; the web route renders the new
intro and correctly shows `Authentication required` when opened without a
session.

## 2026-09-22 — Home greeting uses the candidate's name

Home no longer greets "Priya" with initials "PD". The greeting first name and
avatar initials come from `GET /candidate/profile` (`full_name` asked at
sign-up). Sign-up and login write that name into `AuthContext` so the header
is not empty while the request is in flight. The header date is today's IST
date.

**`candidate_profiles` was empty for every account**, which is why the header
still read "Hi" with the name wired up: the sign-up `PUT
/candidate/profile/name` was best-effort inside a `catch` that only logged,
so a single failure left the account with no name anywhere and nothing
retried it. That call now retries once and, if it still fails, hands the name
to `services/profile/pendingName.ts`.

`services/profile/name.ts` resolves and repairs: stored profile name, else
this session's sign-up name, else the structured resume form's name — then
writes it back, so an account created before this fix gets a name on the next
Home visit. The form fallback is the one the backend already uses for an
employer reveal (`resume.service.declared_name`), and it is safe for the same
reason: only the structured form carries a name, so nothing guesses one from
an uploaded or pasted CV. With nothing to resolve, the header reads "Hi" and
the avatar `?`, never a stand-in person.

The jobs list, score-gain chip and add-on prices on Home are still design
placeholders.

Validation: mobile TypeScript.

## 2026-09-22 — Local ATS scoring enabled end to end

The gitignored `backend/.env` now enables OpenAI Layer 1 extraction with the
chosen pinned snapshot `gpt-5.4-mini-2026-03-17`. The supplied OpenAI and
Sarvam credentials are local-only; Sarvam's provider remains disabled because
it transcribes mock-interview audio and is not part of resume scoring. A live
OpenAI request returned schema-valid resume facts without exposing the key.

`backend/scripts/dev_workers.sh` now runs the local Celery worker and enqueues
the outbox relay every two seconds (production uses EventBridge Scheduler). It
uses Celery's solo pool on macOS to avoid prefork initialization failures.

The first real worker run exposed a backend lifecycle defect: every synchronous
task wrapper used `asyncio.run`, creating a new event loop while retaining
SQLAlchemy's async pool from the previous delivery. The next task failed with
`Future attached to a different loop`. All task wrappers now use
`app/tasks/async_runner.py`, which keeps one event loop per worker process,
matching the lifetime of its database pool. A regression test holds that loop
reuse.

The API and worker were restarted, an existing pending confirmation was
retried successfully, and the next resume confirmed through the app completed
normally with current score **795**. Both runs relayed
`scoring.score_computed` and completed integrity; each value came from stored
OpenAI extraction plus deterministic scoring code, not a frontend constant.
The mobile poll now allows one minute because observed model calls took
8–16 seconds, while retaining an immediate "Continue without score" action.

Validation: live OpenAI extraction; API health; 121 focused task, relay and
scoring tests; Ruff and mypy over all task modules; mobile TypeScript.

## 2026-09-22 — Mobile notification permission

The onboarding notification screen now requests the real iOS/Android system
permission through `expo-notifications`, creates Android's high-importance
default channel, opts foreground notifications into the banner and notification
list, and synchronises the result with `PATCH /notifications/preferences`
(`push_enabled`). A permanent denial links to device settings; web explains
that notification-bar permission must be tested in the native app.

**`expo-notifications` is required lazily, inside a try/catch, never imported
at module scope.** Expo Go dropped push support in SDK 53 and the module throws
at import time there — and because presentation is configured from
`app/_layout.tsx`, that import took down the whole app before any screen
rendered. `services/notifications/device.ts` now loads it on first use,
exports `isExpoGo` / `supportsRemotePush`, and the screen shows a note in Expo
Go saying permission works but a server-sent notification needs a development
build.

This is permission and presentation, not remote push delivery. The backend
currently has no device-token registration endpoint, PUSH templates, or
Expo/APNs/FCM provider (`notifications.service._provider_configured` permits
only EMAIL and IN_APP). Those three backend pieces plus EAS project credentials
are required before a server event can enter a phone's notification bar.

Validation: mobile TypeScript and focused IDE diagnostics pass.

---

## 2026-09-22 (later still) — E32, E35, E30, and a fuzzer that earned its keep

Four items asked for: schemathesis, E32, E30, E31/E35.

### E32 — the erasure destroys the sign-in

`AdminDeleteUser`, plus the IAM grant. **Called before the database cascade,
and that ordering is the whole design.** `erase_candidate` replaces
`cognito_sub` with its SHA-256, so once it has run there is no identifier
left to delete by — only a hash that addresses nothing in the pool. Putting
the call first means every step before the cascade is retryable, so a Cognito
outage releases the request back to RECEIVED with the person's data intact
and still erasable. The other order destroys the data and leaves a sign-in
nothing can ever name.

Idempotent on `UserNotFoundException`, because the sweep retries and a second
attempt must not fail on work the first one finished. An account nobody ever
signed in to has no Cognito user, and none is asked for.

### E35 — the college is told before it commits, not after

A phone-only roster row is valid, is committed, is invited, and is then
recorded SKIPPED `NO_CONTACT`. The college had no way of knowing that a third
of their students would hear nothing.

The preview now reports `unreachable_rows`. **The count is derived, not
hardcoded**: `notifications.domain.roster_invitation_contact_fields()` reads
`plan_for` and DLT readiness, so the day SMS returns it answers
`{email, phone}` by itself and the warning disappears without anyone
remembering to remove it. A constant would have to be remembered by whoever
turns SMS back on, which is exactly the sort of thing nobody remembers.
Recomputed on every read, because which channels work is a fact about the
deployment and not about the file.

Whether email should be *required* at import is left alone: it refuses data a
college has, so it is their decision.

### E31 — closed, and narrower than it read

No code. The sweep is scheduled and the numbers are rows now, and the
remaining clause — "the nudge SMS is SERVICE_EXPLICIT and needs recorded DND
consent" — is **moot**: `NUDGE_TEMPLATES` is IN_APP and EMAIL only and a test
holds it that way, so no nudge goes near a DND number. Recorded as closed
with the condition that it returns with SMS, rather than inventing work to
fill the item.

### E30 — two of three

**Orphaned PENDING rows**, swept hourly. A worker that dies between the
decision transaction and the send leaves committed PENDING rows nobody owns.
An event-sourced message gets another chance when the outbox redelivers it;
**a nudge never does**, because its sequence number is already claimed — so
those rows sat for ever, with no error anywhere saying so. The sweep
re-resolves the contact rather than reading it back, because nothing stores
it; that is also a correctness win, since a message for somebody since
deleted now resolves to nothing and is dropped rather than sent to a
stranger.

**Unsubscribe**, RFC 8058. Two decisions worth recording:

- *Headers, not a link in the body.* The body is a translated template, so a
  visible link would mean a new variable in nine locale bundles and a
  `TEMPLATES_VERSION` bump. `List-Unsubscribe` is what Gmail and Outlook
  actually read to draw their own button anyway.
- *POST, not GET.* Mail clients and scanners prefetch links in email. A GET
  would unsubscribe people who never clicked, and we would never know.

The endpoint is unauthenticated and is in the `PUBLIC` allowlist with the
argument for it: requiring a sign-in to stop reminders is what makes people
press the spam button instead, which costs the sending domain's reputation
and takes every other message with it. The token turns nudges *off* and can
do nothing else.

PyJWT *warned* that the signing key was under 32 bytes; `Settings` now
refuses to boot on one. A short HMAC key is a forgeable token, and the
damage being small is not a reason to ship it.

**Not done: bounce and complaint feedback.** `BOUNCED` and `COMPLAINED` exist
as reasons and nothing writes them. The safe transport is SES → SNS → SQS,
IAM-authenticated, rather than a public webhook needing SNS signature
verification that cannot be tested against real SNS here — and none of it can
be exercised until SES leaves the sandbox with a real domain (**E38**). It
belongs with that work, and pretending otherwise would put an untestable
pipeline in front of a service that is not sending.

### schemathesis — the gate that was never met, and what it found

The dependency had been declared since Day 15 with **no test using it**. 157
operations are now fuzzed with hostile input, authenticated as a real
candidate so the input reaches handlers rather than bouncing off
`current_user`.

Three real findings on the first runs:

1. **Every operation documented only its success code and 422.** Not one
   documented 401, 403, 404, 409 or 429, all of which this API returns
   constantly — the suite asserts them by the hundred. The four client teams
   generate their code from that document, and a generated client that treats
   an undocumented status as a transport error retries a 409 or shows a crash
   for a 403. Fixed in one place, over the finished schema.
2. **Fixing that surfaced a second thing.** Mutating `app.openapi_schema`
   once did nothing: FastAPI 0.141 regenerates the schema when the route set
   has changed since it last built one, so post-processing before the final
   route was registered is silently discarded and the served document is the
   unmodified one. It has to wrap `app.openapi`.
3. **A 500 on a pasted CV containing a NUL byte.** Postgres cannot store
   `\x00` in text or JSONB at all, so it passed validation, passed the
   service, and died in the asyncpg driver — on input any candidate can send,
   and trivially reachable by pasting out of a corrupted PDF, which is the
   exact population that endpoint serves. `normalise_pasted_text` now strips
   C0 controls and DEL, keeping tab, newline and carriage return. Three
   regression tests, including one holding normalisation idempotent, because
   invariant 1 means the stored text is what is scored.

**It also found something that is not a bug**, and the check is excluded with
the reason: `positive_data_acceptance` fails an operation that refuses
schema-compliant input, and this API refuses plenty, correctly. `city: ""` and
`state_code: "00"` satisfy everything JSON Schema can express and are still
not a city and not a state. Including that check would mean either permanent
failures or watering down the validators to satisfy a test.

**The suite is not green on the fuzzer yet** and it is marked `contract`
rather than reported as passing (**E43**). A full run is about fifteen
minutes.

## 2026-09-22 (later) — E5: the CV reads text the employer cannot see

`HIDDEN_TEXT` is one of only **two** rules allowed to reach HIGH, and HIGH is
what removes a candidate from employer search before anyone has looked at
them. It could not fire at any input: `ResumeClaims.hidden_text` defaulted to
`""` and nothing ever populated it. So white-on-white keyword stuffing — the
most widely documented way of gaming a CV screen — produced **no signal at
all**, and the candidate reached employers with it.

### What was actually broken, which was narrower than the blocker said

Worth writing down, because the register overstated it and the correction
changes how the risk reads.

`INJECTED_INSTRUCTIONS` **always fired.** pypdf's `extract_text()` returns
hidden and visible text in one string — it has no notion of the difference —
so an injection buried in white text was already in `raw_text` and the
pattern already matched. What was missing was *which*: the rule's
`in_hidden_text` evidence was hardcoded False by the empty default, so a
reviewer could not tell a deliberate injection from a candidate quoting the
phrase in a line about prompt engineering. **That distinction is the entire
basis for rating the rule HIGH**, so it mattered — but detection was not
absent, and E5 said it was.

What was genuinely absent is hidden text that is *not* an injection: a block
of invented seniority and keywords in white-on-white, which matches no
pattern and now raises `HIDDEN_TEXT` on length alone.

### How it reads the page

`app/modules/resume/hidden_text.py`. pypdf gives two callbacks on one pass:
`visitor_operand_before` sees every operator, so a small graphics state
tracks fill colour, text render mode and a `q`/`Q` stack; `visitor_text` then
delivers each chunk and the state is read as it stands.

**That ordering was verified, not assumed**, and it is the thing the design
rests on. pypdf flushes an accumulated chunk when the text position jumps,
*before* applying what comes next — so in `rg white / Tj / Tm / rg black /
Tj / ET` the first chunk arrives while the state is still white. The one case
it merges is two `Tj` with a colour change and no reposition between, which
is attributed to the later colour: a miss, never a false positive. For a rule
that hides people that is the right way round.

Four reasons are reported: invisible render mode (`3 Tr`, `7 Tr`), near-white
fill (`rg`/`g`/`k`/`scn`, luminance ≥ 0.92), sub-point type *after* the text
and current transformation matrices, and off-page beyond an inch outside the
MediaBox. .docx gets Word's own `w:vanish` and white runs.

### The scored text does not move

`raw_text` is still produced by the same plain `extract_text()` call, and the
hidden analysis is a **separate second pass**. Byte-identical output, so no
score changes and nothing needs re-scoring — which matters, because CLAUDE.md
is explicit that changing the parser is a re-score rather than an upgrade.
A test asserts it against pypdf's own output rather than a literal.

That the model still reads the hidden keywords is deliberate, not an
oversight: integrity signals never move a score (SRS 1.4.5). The remedy for a
gamed CV is a HIGH signal and a human, not a quietly different number.

`EXTRACTOR_REVISION` goes to 2 anyway. The text is unchanged, so this is not
a re-score; the bump records that the extractor now produces a field older
extractions do not have.

### Built to miss rather than to guess

A false positive here costs a real candidate real work, so two cases are
refused on purpose and are tested as carefully as the true positives:

- **An OCR text layer over a scan.** A candidate who scanned their CV and ran
  it through Acrobat has an invisible text layer over the page image — every
  character is mode 3. That is what a searchable scan *is*. Invisible-mode
  text is therefore reported only when it is a *minority* of the document.
  The discriminator is scoped to render mode alone: no scanner produces
  white-on-white, so a wholly white document is still reported.
- **Light-grey body text**, and white text on a coloured banner. The
  luminance floor is 0.92, and the rule's own 80-character threshold does the
  rest — a name and job title reversed out of a header are nowhere near it.

### Three things found while building

- **`analysed=False` is not "nothing found".** A stored `""` from a
  successful pass means the CV is clean; a failed pass means nobody knows.
  `HiddenTextReport` keeps them apart and `hidden_text_of` collapses them
  only when handing text to the rules — a rule firing on our own missing data
  would suppress candidates for a reason that has nothing to do with them.
  The same distinction `scanner.py` insists on with PENDING and CLEAN.
- **The detector never raises.** It is called outside the parser's `try`, so
  a bug in it cannot surface to a candidate as an unreadable CV.
- **The test payload was 79 characters** against a threshold of 80. Every
  detector test passed while the rule they exist for fired at nothing. There
  is now a test asserting the fixture clears the threshold.

### Owed

**CVs parsed before today carry no analysis** and are not re-checked.
`was_analysed` returns False for them, so nothing reads them as clean. A
re-run over existing versions is a decision, not a migration — it would raise
HIGH signals against candidates who are already live.

Not covered, and recorded rather than implied: text hidden by an `ExtGState`
fill alpha (`/ca 0`), which needs the named resource resolved; and white text
over a dark filled rectangle, which needs the rectangles tracked to rule out.

## 2026-09-22 — The scheduler, the AWS deployment, config as rows, six languages

A day of closing gaps that an audit surfaced rather than building features.
Four of them were the same shape: **something that looked done and drove
nothing.**

### The scheduler (blockers E4) — the one that mattered

`app/worker.py` said periodic work ran "via EventBridge Scheduler hitting a
trigger endpoint - NOT Celery Beat", because "SQS has no native ETA/countdown".
The premise is true and the conclusion does not follow. SQS cannot hold a
delayed message, so `apply_async(countdown=...)` and `eta=` are unusable on
this broker — but **Beat never asks the broker to delay anything**. It is a
clock in its own process that publishes a task when it is due, as an ordinary
immediate send.

The trigger endpoint that docstring described was never built. There is no such
path among the 141. So from Day 12 until today **nothing ran any of the seven
sweeps**: no payment settled, no notification was dispatched, no re-score fired,
and no accepted deletion request was ever carried out — the last of which is a
promise to a user, not a missing feature.

Built: `app/tasks/schedule.py`, one table like `routing.py`. Relay every 30s
(it is the latency between paying and being subscribed); five hourly sweeps
staggered across the hour because three take a lock; partitions daily at 00:00
IST. Every entry carries `expires`, so a worker that was down comes back to one
useful tick rather than sixty pointless ones.

`tests/unit/test_beat_schedule.py` — 29 tests. The failure it exists for is the
one that produced E4: a misspelt task name in a schedule is not an error at
import, at boot, or when beat publishes it. It is a message a worker discards in
silence, forever.

**Run exactly one beat process.** It is a clock, not a worker; two run every
sweep twice. The sweeps are idempotent, so that wastes work rather than
corrupting anything — but it is still a misconfiguration.

### Configuration is rows now, not invisible defaults

Eight documents steer things a customer feels — how many candidates an employer
may open in an hour, how long an application survives silence, when a college
cohort is too small to report. **None of them had a row anywhere**: not in the
baseline migration, not in `reset_local_db.sh`, not in any deploy step. Every
reader fell back to a default in code, so production ran on numbers invisible
unless you read the source, all of them ours rather than the client's.

`scripts/seed_config.py` writes all eight. Two properties worth keeping:

- **The values are not retyped.** Each document is built from the module's own
  default object and then parsed back through that module's own strict reader
  before anything is written. A default that changes in code changes here too.
- **Version 1 only, never an update.** A key that already has a row is left
  alone. A seed script that overwrites a deliberate number on every deploy is
  worse than no seed script.

**Running the script found three broken tests, which is the point.** Seeding
is not a no-op even when every value equals the code default:

- Two inserted their config row at a hardcoded `version = 1`, which the seed
  now occupies (`UniqueViolationError`). The rest of the suite already used
  `coalesce(max(version), 0) + 1`; `test_pipeline.py` was the outlier.
- The third asserted `expiry_rules=code-v1` on the expiry event. `code-v1` is
  the in-code default, stamped **only when no row exists** -- so that test was
  really asserting *"the platform runs on numbers that live only in source"*,
  which is the condition this work exists to end. It now reads the live row
  with independent raw SQL and compares, which is a stronger assertion than
  the literal was: it proves the sweep stamped the version of the row it
  actually used. Verified in **both** states -- 19 passed with the row present
  (`config-v1`) and 19 with it absent (`code-v1`), the latter being what CI
  sees, since CI runs migrations and never seeds.

`tests/unit/test_config_seed.py` runs every document through the real reader.
The dangerous failure is not a missing row but a bad one: the readers are
strict on purpose, so one misspelt key is a 500 on the college dashboard —
found in production, by a customer. The key-discovery test initially found
seven of eight (integrity declares its key without `: Final`), which is why it
now carries a guard against passing vacuously.

### The AWS deployment

One EC2 host, docker compose, default VPC. Deliberately not production — the
trade is written out in `aws-deployment.md` §1.3, and the one that matters is
**no database backups**. Roughly $20-25/month against $90-140 for the real
shape, and §7 is the migration to ECS Fargate + ALB + RDS + ElastiCache with a
note of what carries over unchanged (the Dockerfile, the IAM policy document,
the beat schedule, every setting).

Three things worth recording:

- **An instance role, not an access key.** The same policy document the IAM
  user gets, attached to a role the instance assumes. No `AWS_ACCESS_KEY_ID`
  anywhere on the box — and the `host_env_file` output says why, because adding
  one would *override* the role with a long-lived secret on a public host.
- **Remote state, at last.** `infra/bootstrap/` makes the S3 bucket and the
  DynamoDB lock table; the main module migrates into them. The old local state
  held the app IAM secret in plaintext on one laptop, and made drift invisible
  — the Cognito changes of 2026-09-18 were written, never applied, and nothing
  said so for four days (E7 looked closed and was not).
- **The prod compose file mounts `init_db_roles.sql`.** Missed on the first
  draft and caught before it shipped: without it Postgres starts with only the
  superuser, and the tempting fix — pointing `DATABASE_URL` at it — makes every
  RLS policy decoration while `\d+` still lists them.

### Six languages (E39)

The client named English, Hindi, Bengali, Kannada, Marathi and Punjabi.

**Punjabi had no bundle and was not in `SUPPORTED_LOCALES`**, so `load_bundle`
returned `{}` and every string fell back to English silently — a
supported-looking language that translated nothing.

Worse, and not specific to Punjabi: of 159 keys the product renders, **127 were
in no bundle at all**. Every form label, interview question, questionnaire
prompt and notification body carried a translation key and had no translation
anywhere, in any language, including English. `translate` falls back to the key
itself, so those render as `interview.q.about_you`.

Now: English carries all 159 as the source; the five other priority locales
carry all 159 translated; Gujarati, Tamil and Telugu keep their 32 and fall back
per key (they predate the client's list, and removing a language somebody may
have chosen is a product decision, not a tidy-up).

`tests/unit/test_locales.py` holds key parity, placeholder parity — a Hindi
pre-debit notice that lost `{amount}` tells somebody money will leave their
account without saying how much — and the `needs_native_speaker_pass` flag,
which is asserted so it cannot be dropped quietly. **We wrote these. They need
a speaker of each to read them.**

Two things the work turned up: `notifications/schemas.py` carries a hardcoded
`LocaleCode` literal with an assertion against `LOCALE_CODES`, and it caught
the missing `pa` immediately — a good pattern. And the pre-existing translation
tests in `test_content_placeholders.py` duplicated the new ones, so they were
moved into `test_locales.py`, with an `UNTRANSLATABLE` allowlist for GSTIN, TAN,
CIN and AISHE — statutory identifiers that must stay unrecognisable-free on an
Indian form.

### Also

- **`require_kyb_approved` deleted** from `app/core/deps.py`. A stub that
  raised unconditionally from Day 4, exported and called by nothing. It could
  never have been implemented there: deciding it means reading
  `employers.kyb_status`, and `app.core` may not import `app.modules`. The real
  gate was built in the services on Day 10, where it can read the row.
- **S3 lifecycle on export archives** (E34 closed). Seven days, plus
  non-current versions after one — versioning is on, so without the second line
  the archive is still one API call away. The rule is the backstop; the 48h
  sweep is the promise, and is now scheduled.
- **Interview audio has no rule, on purpose** (E22). The retention period is
  counsel's answer, not a number we pick because it looks reasonable. The
  resource is written and commented out rather than left as a decision somebody
  later mistakes for one.
- **SES can verify a single mailbox** while the client has no domain (E38
  narrowed). The catch that matters is not DKIM, it is the **sandbox**: until
  production access is granted you can send only to verified addresses, so no
  real candidate receives anything.
- **`blockers.md` E24 was stale** — it said no speech model or evaluator was
  chosen, four days after Sarvam and OpenAI were chosen and live-tested.

### Owed, and not started

- `terraform apply` — **the AWS access key in `~/.aws` is dead**
  (`InvalidClientTokenId`), so nothing in this entry has been applied. All of
  it is authored and statically validated only.
- The frontend and mobile app are another team's (see the audit above): the
  mobile app talks to **Supabase**, not this backend, and calls zero of the 53
  `/candidate` endpoints.

## 2026-09-22 — Dashboard empty-data fallbacks

Employer, college and admin dashboards now keep their full dashboard layouts
visible when one or more API requests fail, using the existing zero, empty-list
and unavailable values instead of replacing the page with an error panel. The
employer dashboard also stops loading correctly when there are no jobs or the
jobs request fails, and clears application counts when those requests fail.

Validation: focused ESLint passes for all changed dashboard files. Browser checks
against live 500 responses confirm that employer, college and admin each retain
their full dashboard UI with empty values and no blocking error panel.

---

## 2026-09-21 — Mobile score poll after confirm

The candidate scoring screen now polls `GET /candidate/score/me` after resume
confirm and the reveal shows that `value` and `band`, not a canned 680. PENDING
is treated as waiting, with a retry if it never flips. Locally the number still
needs `backend/scripts/dev_workers.sh` (outbox relay + Celery worker) and Layer
1 switched on (`SCORING_EXTRACTION_ENABLED=true` plus `OPENAI_API_KEY`); there
is no heuristic extractor.

**No stand-in number is drawn anywhere.** With no score, the reveal, the home
card and the share card show a dash and "not scored yet" rather than 706 or
680, and the defaults were removed from `HomeScreen` and `ShareResultScreen`
so a caller cannot get one by omission. Each of those files carries a comment
naming exactly what has to run to produce a real score.

Recorded in the same comments: the breakdown, suggestions and "recalculated"
screens are design mock-ups that **cannot** be integrated. Score explanation
was removed by the client (2026-08-27, re-confirmed 2026-09-11), so no
endpoint returns a category, a delta or an improvement list, and
`test_score_never_explained.py` fails the build on a schema that adds one.
They should be dropped from the flow rather than wired.

Measured state of the local stack while diagnosing this: 7 confirmed resume
versions, 7 unpublished `resume.version_confirmed` outbox rows, 0 rows in
`scores`, no worker process, and no `SCORING_*` or `OPENAI_API_KEY` in
`backend/.env`. Note `confirmed_at` is a latch — publishing those events with
no worker running consumes them for nothing, so start the worker first.

## 2026-09-21 — Frontend table page sizes

Added a shared rows-per-page selector to every frontend data table with 10 as
the default and 25, 50 and 100 as options. Page-size changes return to the first
page, filtered result sets clamp invalid page numbers, and tables with fewer
than ten records retain accurate counts and controls. The selector now uses the
reusable custom `AppSelect` menu and opens upward from table footers to avoid
clipping. College table queries request the backend's 100-row maximum so the
larger selections have data.

Validation: the changed pagination files pass TypeScript checking. Full
`npx tsc --noEmit` remains blocked by 19 pre-existing errors in recent activity,
job creation and college billing selector files.

## 2026-09-18 — Admin Portal API integration

Replaced the Admin Portal's operational fixtures with typed RTK Query calls to
the existing `/api/v1/admin` routes. Dashboard counts, KYB and integrity queues,
disputes and audit events, employer and college search/drill-down, suspension,
reinstatement and college seat allocation now use backend data. Mutations expose
loading, error and shared success feedback states.

Admin tabs currently open without a frontend login gate. For local integration,
the shared API client sends only `NEXT_PUBLIC_API_BEARER_TOKEN` from the frontend
environment; the Admin login route and Cognito session override were removed by
request. The backend still validates the token and resolves its staff membership.
Candidate listing, historical dashboard metrics and settings mutations are shown
as unavailable because the backend deliberately exposes no such APIs.

Validation: focused Admin TypeScript and ESLint checks pass. Browser checks verify
live loading/error/unsupported states and removal of mock records and demo header
controls. Full `tsc`/build are
still blocked by 17 pre-existing errors in `recent-activity.tsx` and college
billing selectors; repository-wide ESLint has four pre-existing portal/college
errors. The running backend is healthy, but the configured local bearer returns
`invalid_token` and Docker is unavailable, so authenticated success responses
were not exercised against the live backend.

## 2026-09-17 — Applicant API Redux integration

Connected the existing employer applications pipeline to the backend employer
application resource. The page now loads published jobs and their applications,
opens application details, moves stages, and proposes hires through RTK Query;
the API adapter lives under `fontend/store/employer/applications` and hydrates
the existing Redux slice. The separate applicant store module was removed.

Validation: `npx tsc --noEmit` and focused ESLint both pass.

## State at a glance

|               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch**    | `feat/mobile-app`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`main`**    | green on all five CI jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Tests**     | 2419 on 2026-09-18 (sign-up, accounts, discount codes), not yet pushed. 2324 on 2026-09-17 (Day 20). 2247 (Day 19). 2079 (Day 18), **all five CI jobs green on PR #11** (`e1f3a97`), first push. 2018 (Day 17), **all five CI jobs green on PR #11** (`f65fa3d`) — the first push failed one test that relied on the catalogue seed, which CI never runs. Day 16: 1898. Day 15: 1820. Day 14: 1714. Day 13: 1663 — first push failed CI on a flaky test of ours, fixed (see Day 13). Day 12 (`65ba18e`): 1591, **all five CI jobs green on PR #8**. |
| **Coverage**  | 84%                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Days done** | 1, 2, 5, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 complete · 3, 4, 6, 8, 9 partial                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Next**      | **The twenty days are done.** 2026-09-22 closed the scheduler gap (E4), seeded configuration as rows, added the six-language set and wrote the single-host AWS deployment. **Nothing is applied to AWS**: the access key in `~/.aws` is dead, so the immediate next step is a new admin key and `terraform plan`. Then: SES production access (E38), a payment gateway (D3), a native-speaker pass on eight bundles (E39, C5), AWS service activation for Textract and GuardDuty (E2), and the decisions in `blockers.md`. The mobile app is actively integrated against the backend APIs (auth, onboarding, scoring, questionnaire, interviews, applications). |

> **Run the suite as CI does**, and `source .test-env.sh` first. Without it the
> four RLS tests fail for an environmental reason that looks exactly like a
> regression: the app connects as a role that is not subject to RLS, so
> `test_scores_are_insert_only` reports `DID NOT RAISE` rather than a
> permissions error. Same family as the `.env`-masking bug below.

### Deferred by decision — revisit before launch

| Item | Decided | Why deferred | What it takes to land |
| ---- | ------- | ------------ | --------------------- |

> ⚠️ **Switching parser is not a drop-in.** Invariant 1 requires a score to be
> reproducible from the stored extraction chain. A different parser yields
> different text, so it yields a different score. `parser` and `parser_version`
> are stored per extraction precisely so a replay can tell which engine produced
> a score, and so a change is a **re-score**, not a silent drift.

**Full register: [`blockers.md`](blockers.md)** — 45 items by category.

### Blocked, and not on us

| Blocker                               | Blocks                                       | Lead time                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Textract account activation**       | OCR fallback for scanned CVs                 | `SubscriptionRequiredException` on a brand-new AWS account, with `AdministratorAccess` — so it is account activation, not IAM. Usually clears within hours. **Code is written and wired; run `backend/scripts/verify_ocr_fallback.py` once it clears.** |
| ~~TRAI DLT registration~~             | Every SMS                                    | ✅ **Started 2026-09-11.** Still 2–4 weeks to clear; SMS to Indian numbers fails silently until it does. **The bodies to register are now drafted** — `notifications/templates.py`, `sms_templates()`.                                                  |
| **Twilio account**                    | Phone OTP, the 3 Cognito custom-auth Lambdas | Days                                                                                                                                                                                                                                                    |
| **Google OAuth client**               | Google federation on the candidate pool      | Hours                                                                                                                                                                                                                                                   |
| **N7 — who makes the course?**        | **Launch, not the build**                    | Build unblocked 2026-09-11 with a placeholder course and a provisional, versioned completion rule. The product question is untouched: a completion still moves a real score by up to 30 points on criteria nobody has agreed. See `blockers.md` C1.     |
| ~~**N2 — can CV text leave India?**~~ | ~~Day 8~~                                    | ✅ **Closed 2026-09-11** (Round 7.2, _"can be"_) — this table was stale. Processing stays in `ap-south-1` anyway: it costs nothing and is the answer that stays right if the position changes.                                                          |

---

## 2026-09-18 (evening) — Sign-up, admin-created accounts, email only, discount codes

From the client's note `docs/Signup_Login_Discussion_Updates .pdf`, confirmed
in conversation: anyone signs up (candidate, employer, college) by email and
password; staff can create any of the three; no phone OTP and **no SMS of any
kind** until the organisation's registration exists; Cognito sends every code
by email through SES; discount codes applied at payment; scoring unchanged.
Reference for app teams: **`docs/signup-and-accounts.md`**.

### Built

- **Self-registration for businesses** (closes E7): `allow_admin_create_user_only
= false` in Terraform. No API change was needed — a business account with no
  organisation already got 403 `no_active_membership` and could create one.
- **Phone OTP off**: `/auth/otp/start` registered only behind
  `AUTH_PHONE_OTP_ENABLED` (default off); the throttle is kept and tested at
  the service. `ALLOW_CUSTOM_AUTH` and the Twilio secret removed from Terraform.
- **Email instead of SMS**: seven new EMAIL templates; `plan_for` routes every
  former SMS to email, and the UPI pre-debit notice is `EMAIL_MANDATE_PRE_DEBIT`
  (mandatory). The SMS nudge is dropped. `test_nothing_is_sent_by_sms` holds it.
- **Staff-created accounts**: `/admin/accounts/{candidates,employers,colleges}`,
  `/admin/tenants/{id}/members`, `/admin/accounts/{id}/resend-invitation`.
  `app/core/auth/directory.py` is the one Cognito write (`AdminCreateUser`,
  which emails a temporary password), with a local implementation that tests
  read. Employer and college team adds send the same email to anyone who has
  never signed in. New capabilities `accounts`, `resend_invitation`.
- **Discount codes**, in `billing`: `discount_codes` and `discount_redemptions`
  tables; `payments.discount_code_id` and `list_amount_minor`; checkout and a
  preview route per audience; the console routes for create, list, read,
  disable and the usage log. Guards: `guard_discount_redemption` (a use needs
  this code's verified payment), `guard_discount_code_write` (terms immutable,
  switch-off a latch); column grants; erasure plan (codes NOT_PERSONAL,
  redemptions RETAINED). Rate limit `billing.discount_code` (40/h per person).
  The policy is a placeholder (`DISCOUNT_POLICY_VERSION`, E36).
- **SES in Terraform** (`ses.tf`): domain identity, DKIM, MAIL FROM, DMARC,
  optional Route 53 records, `email_dns_records` output; Cognito
  `email_configuration` switches to SES when `email_domain` is set; invite and
  verification email templates; temporary passwords valid 7 days; IAM gains
  `AdminCreateUser` and (with a domain) `ses:SendEmail`.

### Decisions taken inside that work, worth knowing

- **A code is used when money moves, not at checkout.** A redemption row is
  written in the same transaction as the grant. A fresh PENDING checkout holds
  a use for 30 minutes, and checkouts against one code serialise on its row
  lock, so the last use cannot be sold twice.
- **No 100% code** until the client says otherwise: a zero payment has no
  gateway callback, and a verified callback is the only thing that grants.
- **Adoption at first sign-in now matches the pool too.** Staff can make
  candidate rows, and a business sign-in claiming one by email would carry a
  candidate into the wrong authentication model. A contact held by the other
  pool is now 403 `account_contact_in_use` — **it was a 500 before** (the
  INSERT hit the unique email index), found while writing these tests.
- **`phone_number` stays a candidate-pool username attribute**, because
  changing `username_attributes` replaces the pool.
- **Staff never link a student to a college**: the link is the student's
  consent (invariant 9), so they do it after signing in.

### Not done

- **`terraform apply`** — the plan is 4 in-place changes (both pools, the
  candidate client, the IAM policy) and 1 destroy (the unused Twilio secret);
  nothing is replaced. Not applied: it changes live AWS.
- **SES** waits on the client's domain and production access (E38).
- Roster contacts with a phone number only hear nothing while SMS is off (E35).

## 2026-09-18 — AI providers: OpenAI (CV reading, interview feedback) + Sarvam (speech)

Decision: **no Bedrock for AI**. `bedrock.py` stays selectable
(`SCORING_EXTRACTION_PROVIDER`) but the default is `openai`.

### Built

- `app/core/openai_responses.py` — one Responses API call, strict JSON schema
  built from our own types, `store: false`, no sampling params, plain `httpx`
  (no SDK dependency). Strict mode refuses `maxLength`/`default`, so they are
  stripped for the request and enforced by `model_validate` afterwards.
- `scoring/openai_extractor.py` — `ResumeExtractor` on OpenAI. Same prompt,
  schema, cache key and failure semantics as Bedrock. Reasoning effort
  `medium`; changing it is a `PROMPT_VERSION` bump (a re-score).
- `interview/sarvam.py` — Sarvam `saaras:v3`, mode `codemix`, language
  auto-detect. **Batch job API, not REST**: REST takes < 30 s of audio and an
  answer runs to 120 s. Our key never goes to the signed blob URLs.
- `interview/openai_evaluator.py` — rubric feedback; per-call strict schema
  (question codes as enum, every dimension required 0–4); instructions forbid
  judging accent, fluency, vocabulary, pace, filler words, and forbid numbers in
  comments.
- Settings: `OPENAI_API_KEY`, `SARVAM_API_KEY`, `INTERVIEW_TRANSCRIPTION_PROVIDER`,
  `INTERVIEW_EVALUATION_MODEL_ID`; boot refuses a selected provider without its
  key/model. `tests/conftest.py` now _forces_ every provider off, so a
  developer's `.env` can never make the suite call a model.
- `scripts/verify_ai_providers.py` — live check (costs a few rupees).
- 23 unit tests on a mock transport (`test_openai_sarvam_providers.py`).

### Model choice

`gpt-5.4-mini-2026-03-17` for both. $0.75 / $4.50 per 1M tokens; a CV is read
once ever (extraction cache), roughly ₹1–2 each. `gpt-5.4` is ~3× the price;
run the verify script with `--compare gpt-5.4` on real CVs before switching.

### Live-tested (same day, real keys)

- **The live run caught a bug the mocked tests could not**: stripping the
  `title` _keyword_ from the schema also deleted the role's `title` _field_,
  so the model was never asked for a job title and every real CV came back
  `schema_validation`. Fixed; regression test holds every model field in the
  strict schema.
- Sample CV: mini 13 s, ~₹0.78; `gpt-5.4` 22 s, ~₹2.55. Roles, dates,
  education, skills agree. Differences: mini put `total_experience_months` =
  the CV's own "7+ years" (84) where `gpt-5.4` computed 100 — **harmless for
  the score**, which sums the dated roles' months (`scoring/domain.py`).
- Sarvam batch (Hinglish, generated with `bulbul:v3` TTS): 4.9 s, `hi-IN`,
  accurate, rendered in Devanagari. OpenAI feedback fit the rubric exactly.
- Suite: 2348 passed. All CI checks green.

### Open

- **N2**: OpenAI processes in the US, so CV text and transcripts leave India.
  **Client approved this on 2026-09-18.** Sarvam stays in India.
- Evaluator must still be tested on real recordings in each supported
  language before launch (`interview/evaluation.py`).

---

## 2026-09-17 (night) — Day 20: privacy, rate limits, index review, handover · **Week 4 gate**

**2247 -> 2324 tests**, all passing locally as CI runs them. Local CI chain
green: age, vocabulary, ruff, format, mypy, 10 import contracts, modules. **Rebuild with
`reset_local_db.sh`** — `erase_candidate`, `guard_dsr_request_write`, a
relaxed `ck_users_has_identifier`, a new column on `scores`, and eight new
indexes.

### What landed

|                                       |                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The deletion policy, written down** | `privacy.domain.ERASURE_PLAN` classifies **every table in the schema**: ERASE, RETAIN under the carve-out, NOT_PERSONAL, or SELF_EXPIRING, each with the sentence justifying it. `tests/invariants/test_erasure_plan.py` reads the **live database**, so a table added next month without a decision fails the build rather than quietly surviving erasures. |
| **The cascade**                       | `erase_candidate(uuid, text)` — one SECURITY DEFINER function, one transaction, returning a manifest of rows destroyed per table, recorded on the request and in the audit row.                                                                                                                                                                              |
| **Export**                            | `POST /privacy/requests/export` → outbox → `privacy.build_export` → a zip of JSON per section in S3 (server-side encrypted), behind a 10-minute presigned link minted and **audited per call**. Expires after 48h, and an erasure destroys it at once whatever the sweep is doing.                                                                           |
| **Deletion**                          | `POST /privacy/requests/deletion`, a 24h cooling-off period, withdrawable, then `privacy.erase_due`. Objects first, rows second.                                                                                                                                                                                                                             |
| **Rate limits**                       | One table (`app/core/ratelimit.py`), three scopes, two tiers: global per IP / user / tenant (fail open), specific per route (fail closed). 429 now carries `Retry-After`. Includes the analytics limit Day 18 left owed.                                                                                                                                     |
| **Index review**                      | `tests/integration/test_index_review.py` — 39 hot query shapes planned with `enable_seqscan = off`, plus every foreign key on a growing table indexed or exempted in writing.                                                                                                                                                                                |
| **Invariant suite**                   | `test_all_ten_invariants_are_covered.py` names the file proving each of the ten and fails if one is renamed away or emptied.                                                                                                                                                                                                                                 |
| **Handover**                          | `openapi.json` (141 paths), a generated Postman collection (157 requests, 10 folders), [`integration-notes.md`](integration-notes.md), and a README that matches how the stack actually starts.                                                                                                                                                              |

### Decisions worth knowing

**The cascade is SQL because the app role must stay unable to delete a score.**
Invariant 3 is proved by `test_scores_are_insert_only` reading the grant, not
by trusting the code. An erasure task running as the app role would have needed
DELETE on `scores`, `course_completions`, `device_checks` and
`application_events` — trading one legal requirement for another. It runs as
its owner instead, and it is the only thing on the platform that may destroy a
score.

**`users` is emptied, not deleted, and `cognito_sub` is hashed rather than
cleared.** The row anchors every retained payment and audit row; emptied, its
id identifies nobody, which is the pseudonymisation of answers-log 7.4 done
once instead of rewritten across an append-only trail we are forbidden to
touch. The hash is the half that was nearly wrong: **the test asserting a 401
after erasure got a 200.** With `cognito_sub` NULL, a token issued before the
erasure matches no row, so sign-in treats it as a first sign-in and **creates a
fresh account from the erased person's credential**. Storing the subject's
SHA-256 lets `_by_subject` recognise it and return the DELETED row, which
`_authenticate` refuses. Deleting the Cognito user is still owed (**E32**), and
until it is, an erased person signing in again with the same phone is refused
rather than starting fresh.

**Deletion waits, and the account stays usable while it waits.** Erasure has no
undo, so there is a 24h window and a withdraw route. Locking the account during
the window was the first design and it was wrong — it would have locked the
person out of withdrawing. Nothing escapes by being written late: the cascade
runs in one transaction over whatever exists when it runs.

**The extraction cache needed a link to a person, and had none.**
`resume_extractions` is content-addressed on CV text and holds the model's
account of a career, with no user column by design. Without a handle, the
model's reading of an erased candidate's CV would survive them. `scores` now
stores `extraction_cache_key`, and the erasure deletes a cache row **only when
no other candidate's score still names it** — two people with identical CV text
share the entry, and one leaving must not take the other's with them.

**The seat is released, then deleted.** `seats_used` only ever moves through
`guard_college_seat_assignment`; deleting an assignment row directly would
leave a college one seat short forever. The erasure releases it the ordinary
way, so the college gets its seat back — which is also the fair answer.

**Two judgment calls flagged for counsel rather than taken quietly.** An
erasure deletes the candidate's `applications` and their stage history, which
removes something from an employer's workspace, and it deletes `disputes` they
raised, which is also our record of how a case was handled. Neither is a
financial record nor an audit row, so the carve-out does not reach them.
**`roster_entries` are not reached at all**: a college's own record of a
contact it supplied carries no link to an account — deliberately, because a
college must never learn who has one — so finding it would require exactly the
match the design forbids. All three are recorded in **B3**.

**The global rate limits fail open; the specific ones fail closed.** A Redis
blip that took the whole API down would be a worse outage than the runaway
client the global tier guards against. An unenforced throttle in front of a
paid SMS gateway is somebody else's bill. `test_rate_limit_policies.py` also
holds OTP and the threshold preview as the tightest limits on the platform —
which immediately caught the DSR route being set tighter than either, on no
reasoning at all. The real guard there is one open request of each kind per
person, held by a partial unique index.

**An export a person already took is destroyed by their erasure.** Found while
re-reading the cascade rather than by a test: the archive is that person's
whole record in one object, and it was being left to the 48-hour expiry sweep
— which has no schedule (**E4**), so in practice it would have been left
indefinitely, a complete copy of somebody we had just erased. The erasure now
collects those keys beside the CV and the interview audio, and clears the
pointers on the retained request rows afterwards. Done in Python rather than in
`erase_candidate` because `dsr_requests` is a retained table and the cascade
may not touch one — which the invariant test enforces.

### Found on the way

- **Four unindexed foreign keys the erasure would have scanned**:
  `integrity_signals.candidate_id`, `integrity_checks.candidate_id`,
  `college_seat_assignments.candidate_id` and `entitlements.user_id`. Each had
  only a _partial_ index — HIGH-and-open signals, the live seat, unconsumed
  entitlements — which an erasure's predicate cannot use. Four more were added
  where the erasure now deletes a parent (`resume_files`, `scores`,
  `device_checks`, `student_consents`, `roster_entries`).
- **One false alarm worth recording.** The review first flagged `subscriptions`
  as unindexed for `require_active_subscription`, the hottest read on the
  platform. It is not: `ix_subscription_active_window` is partial on
  `state IN ('ACTIVE','GRACE')`, and the test's query had omitted the state
  predicate the real query carries. The test was wrong, not the schema.
- **The blocker register's E count had been stale since Day 6** — it said 4
  while the section held 33 items. It is counted from the section now.

### Owed

|                                               |                                                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The retention period**                      | B3. Counsel's, never arrived. `RETENTION_POLICY_VERSION` starts `placeholder-`, a test asserts the prefix, and retained rows are kept indefinitely rather than on a guess.                                                          |
| **Both sweeps are unscheduled**               | E4. `privacy.erase_due` and `privacy.expire_exports` exist and nothing runs them. A deletion is accepted, tracked and shown with its due date, and **nothing is destroyed** — safe, but a promise not being kept. Hourly is enough. |
| **Cognito user deletion**                     | E32.                                                                                                                                                                                                                                |
| **Business accounts cannot erase themselves** | E33 — refused in the route _and_ in the function; what happens to an organisation whose last owner leaves is nobody's decision yet.                                                                                                 |
| **No S3 lifecycle rule on exports**           | E34, same family as E22.                                                                                                                                                                                                            |
| **Week 4 gate: schemathesis fuzzing**         | Still ☐, carried from the Week 3 gate.                                                                                                                                                                                              |

---

## 2026-09-17 (evening) — Day 19: admin console, suspension, disputes, notifications, nudges

**2079 -> 2247 tests**, all passing locally as CI runs them. Local CI chain
green: age, vocabulary, ruff, format, mypy, **10** import contracts, modules.
Not yet pushed. **Rebuild with `reset_local_db.sh`** — five new tables, four
triggers, three policies on `disputes`, `platform_tenant_bound()`, and a changed
job-board policy and `job_accepts_applications`.

### What landed

|                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Staff tenancy (E10 closed)** | One PLATFORM tenant (`uq_tenants_one_platform`). `guard_membership_tenant_type`, generated from `identity.domain.ROLE_TENANT_TYPE`, keeps staff roles in it and customer roles out of it, for every writer. `scripts/create_platform_staff.py`; no route.                                                                                                                                                                                                               |
| **Console** (`/admin`)         | KYB submissions (a record while approval is automatic; open with answers, decide), integrity queue (open with evidence, clear or confirm), organisations, suspend / reinstate / history, college seats (E23 closed), candidate / employer / college drill-downs, notification suppression, dispute queue (open, assign, resolve), audit search by actor, action, target, tenant and time. Permission table `admin.domain.CONSOLE_ROLES`.                                |
| **Every look recorded**        | `admin.service._reveal`: the audit row is written on the request's transaction, then the **read-only** bypass session is opened. A failed audit write opens nothing (tested). Drill-downs show the display score and band, masked contacts, and counts — never a CV.                                                                                                                                                                                                    |
| **Suspension**                 | A `tenant_suspensions` row, one open per tenant, lifted by latch, never deleted. `guard_tenant_suspension_write` mirrors it onto `tenants.status`; `guard_tenant_status` refuses the reverse. **Bites on the next request** despite the 60s membership cache (`membership.mark_tenant_changed`), answered 403 `tenant_suspended`. Jobs leave the board and refuse applications; a college's seats stop (E29). PLATFORM cannot be suspended.                             |
| **Disputes**                   | `POST/GET /disputes` for candidates, employers and colleges (HIRE needs a visible application; colleges cannot dispute a hire; 5/day). Staff work them in `/admin/disputes`, cross-linked to the application's two sides and the candidate's live integrity signals. `guard_dispute_write`: what was raised never changes, and only a PLATFORM-bound transaction moves state. A candidate's hire dispute is filed automatically (E12 now has a queue, still no remedy). |
| **Relay (E15, in code)**       | `_publish` enqueues every subscribed task with `routing.TASK_ARGUMENTS`, raising on a broker failure.                                                                                                                                                                                                                                                                                                                                                                   |
| **Notifications**              | `plan_for` (15 events), `delivery_decision` (account, opt-out, suppression, contact, DLT, provider — in that order), one row per message **including every skipped one**, deduplicated, decide-then-send in separate transactions. Inbox, read, preferences (language and channels). SMS via Twilio Messaging, email via SES, both `none` by default with a stub for tests. 17 new templates (13 in-app).                                                               |
| **Nudges (R9)**                | `notifications.nudge_incomplete_profiles`: candidates older than 24h with no upload, paste or form; every 72h, three at most, 09:00–21:00 IST; `nudges_enabled` stops them; config `notifications.nudges` (strict, cannot go daily or past six). The nudge number is the cap and the concurrency guard.                                                                                                                                                                 |

### One failure seen once and not reproduced

`test_with_approval_on_a_reviewer_opens_and_decides_a_submission` failed once,
in a full run that took 68 minutes instead of the usual 8 (the machine was
very likely asleep partway through), and the traceback was lost to a `tail`.
It passed in isolation, after `test_kyb.py`, twice alone, and in the next full
run. A likely cause is a one-hour local token expiring during the pause, but
that is a guess. **If it recurs in CI, capture the traceback before changing
anything.**

### Found and fixed on the way

- **The worker registered no tasks.** `include=["app.tasks"]` imports the
  package, whose `__init__` imports nothing, so a real worker would have
  received every event the relay sends and known none of them. Invisible until
  today because `_publish` only logged. The worker now includes
  `routing.TASK_MODULES`, and a test checks every routed task is registered and
  takes exactly the arguments it is sent.
- **KYB built its event names in an f-string expression**
  (`f"{MODULE}.{'approved' if approved else 'submitted'}"`), so no search for
  `kyb.approved` found the emitter. The new drift test (every notifying event
  must be emitted somewhere) caught it; KYB now has named constants.
- **FastAPI nests included routers in `app.routes`**, so enumerating console
  endpoints from it finds none. The console invariant reads operation ids from
  the schema instead.

### Decisions worth knowing

- **`/admin` left `TENANT_SURFACES`** in `test_cross_tenant_routes.py`, with the
  reason beside it. A console route crosses tenants by design; the replacement
  (`tests/invariants/test_admin_console.py`) asserts no candidate, employer or
  college reaches any console route and each staff role reaches exactly its
  capabilities.
- **Staff writes go through the owning module.** The bypass role stays
  SELECT-only, as `init_db_roles.sql` asked Day 19 to confirm.
- **A resolved dispute changes nothing else.** Confirming or voiding a hire,
  or refunding, is a rule in another module and a client decision (E12, E18).
- **The college revocation notice names nobody** (E28), and says only which
  scope ended.
- **The nudge SMS is registered as SERVICE_EXPLICIT**, which needs recorded
  consent at sign-up (E31).
- **VIEWED does not notify.** A message for every glance at an application
  teaches people to ignore the ones that matter.

### Owed

- Schedules for the relay and the nudge sweep (E4); an orphaned-PENDING sweep,
  bounce feeds, email unsubscribe links, translations of the new keys (E30).
- Client: seats during a college's suspension (E29); what a resolved hire
  dispute may do (E12).
- REVOKED state on roster rows (Day 18, still owed).
- DLT registration of the two new SMS bodies (D1).

---

## 2026-09-17 (later) — Day 18: consent scopes, cohort analytics, invariant 9

**2018 -> 2079 tests**, all passing locally as CI runs them. Local CI chain
green: age, vocabulary, ruff, format, mypy, 9 import contracts, modules.
Pushed to PR #11 as `e1f3a97`: **all five CI jobs green on the first push**.
**Rebuild with `reset_local_db.sh`** — a new CHECK on
`student_consents`, five policies, two triggers and seven functions.

### What landed

|                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **INDIVIDUAL consent**  | `POST /candidate/colleges/{college_id}/individual-visibility` with the INDIVIDUAL terms' version (`GET .../consent-terms?scope=INDIVIDUAL`, versioned apart from the roster words). Needs a live link (404 `college_link_not_found`); idempotent; audited; `college.individual_visibility_granted`. `granted_via = DIRECT`.                                                                                                                               |
| **Revocation**          | `POST /candidate/colleges/{college_id}/revoke {scope}`. INDIVIDUAL keeps the link and the seat. **ROSTER disconnects**: the seat is released and INDIVIDUAL revoked by trigger, in the same UPDATE, at the same instant. Never paywalled; idempotent; 404 for a college never linked. One audit row per scope ended and one `college.consent_revoked` event (consent id, tenant, scopes — no student id).                                                 |
| **The database's copy** | `ck_student_consents_scope_via` (INDIVIDUAL ⇔ DIRECT); `guard_student_consent_insert` (INDIVIDUAL needs a live ROSTER link, locked FOR SHARE against a racing disconnect; a consent starts live); `revoke_individual_with_roster`; a candidate UPDATE policy for revoking their own live rows; and **two RESTRICTIVE policies** so only the student a consent names can insert or revoke it.                                                              |
| **Analytics**           | `GET /college/analytics/overview`: connected and individually visible counts, score distribution by band, median, applicants, applications, interviews, platform hires. `GET /college/analytics/placements`: confirmed platform hires by IST month (12) and by job location, `source: PLATFORM`. Both for admin and staff, behind payment, never cached.                                                                                                  |
| **Floors**              | `analytics.domain`, config `analytics.privacy` (strict; bad row = 500 `analytics_floors_invalid`). Under 10 connected students only the counts show. A band or month under 5 is `null`, with a complementary cell withheld beside it. Median rounded to 10. Locations under 5 hires pooled as `OTHER`. A row may raise a floor, never set one below 5 / 3.                                                                                                |
| **Reads**               | Six SECURITY DEFINER functions (`COLLEGE_STUDENT_READS`) over two consent CTEs, keyed on `bound_college_tenant()` — the tenant bound from the membership, which must be an ACTIVE COLLEGE. No tenant parameter. The three aggregate functions return no identifier.                                                                                                                                                                                       |
| **Individual view**     | `GET /college/students` (keyset page) and `GET /college/students/{candidate_id}`: name (sign-up, else structured form), display score and band, application and interview counts, confirmed platform hires with job title and employer. **404 unless the INDIVIDUAL consent is live now.** Every page and every open writes an audit row in the transaction (`college_students_listed` with the ids shown; `college_student_viewed` with the consent id). |
| **Invariant 9**         | `tests/invariants/test_invariant_09_consent.py` — see _Guarantees_ below. Plus a cross-tenant case for `/college/students/{candidate_id}`.                                                                                                                                                                                                                                                                                                                |

### Guarantees and where they live

- **Analytics inner-joins consent in the query**: `pg_proc` is read back, and
  every `college_*` function must be listed with the consent CTE it joins,
  be SECURITY DEFINER, take no tenant and read the bound college. The college
  and analytics repositories are scanned for any student table.
- **Removing consent makes rows disappear on the next read** — from the
  overview (10 connected → 9, below the floor), from `college_cohort_scores()`,
  and from the individual view.
- **ROSTER never implies INDIVIDUAL**; a college cannot write or revoke a
  consent, one student cannot revoke another's, INDIVIDUAL cannot exist
  without a live link — for the migrator too.
- **Every reveal audited**; a failed audit write returns nothing.
- **Shapes**: `CollegeStudentResponse`'s field list is fixed, and the
  INDIVIDUAL words must name what it shows (content-placeholder test); no
  analytics schema has a field that could name a person.

### Decisions worth knowing

- **One Day 17 test was narrowed, by name.** `test_no_college_facing_schema_names_a_score`
  said no college schema may carry a score, which was true while ROSTER was the
  only scope. `CollegeStudentResponse` now does, deliberately, behind INDIVIDUAL
  consent; it alone is exempted, and invariant 9 fixes its field list.

- **Found and closed: a college could write a student's consent.** Permissive
  RLS policies OR together, so the tenant policy on `student_consents` let a
  college-bound transaction INSERT a consent naming any student (with the
  college's own code) or revoke one. Only the service stood in the way. SRS
  1.15.3 prohibits institution-side bypass, so it is now RESTRICTIVE policy.
- **Disconnecting ends individual visibility.** A college cannot see as a
  person someone it may not even count. Revoking only INDIVIDUAL keeps the link
  and the seat — the student's access is not the price of their privacy.
- **Cross-tenant reads by function, not by widened policy.** Applications live
  under each employer's tenant. Rather than teach the application policies
  about colleges, the college reads six narrow functions, each joining consent.
- **Aggregates are not audited; the individual view is, list included.** A
  masked card was not a reveal on Day 13 and an aggregate over the floor is
  not one now. A list of names is.
- **Suppression found its own bug.** The exhaustive test over every
  four-cell combination of 0–7 caught the case the first version missed: one
  small cell and every other cell zero, which had no partner to withhold. The
  partner is now a zero cell when nothing else is available. This remains the
  score-band rule; monthly placement suppression was removed on 2026-09-26.
- **Interviews** means applications that reached INTERVIEW (from
  `application_events`), not mock interviews. **Hires** means HIRED, both
  confirmations; a disputed hire counts as none (E12).
- **What the college sees of a named student is ours** (E27): no contact
  details — the college has the roster it uploaded, and contacts collected by
  us are not ours to pass on — no CV, no integrity signal, no employer notes.
- **Residual risk, recorded rather than hidden** (E28): reading the overview
  before and after one named student links shows their band unless the cell
  is suppressed. A daily snapshot for additions would close it at the cost of
  freshness; not built.

### Owed

- **Cohort filters** (course, branch, graduation year) — no data holds them,
  and each is a new subtraction surface (E26).
- **Counsel's INDIVIDUAL words; the client's field list and floors** (E27).
- **REVOKED state on roster rows** (SRS 2.10.3): an accepted invitation whose
  consent was later revoked still reads ACCEPTED.
- **The college-facing notice of a revocation** (Day 19) — without the
  student's name for ROSTER (E28).
- ~~A rate limit on analytics reads~~ ✅ **done Day 20** — `analytics.read`, 120/hour per organisation. Not a leak control (the aggregates are already floored and suppressed) but a cost one: an overview is several joins over every consenting student, and a dashboard left open in a tab should not run them continuously.

---

## 2026-09-17 — Day 17: interview evaluation, colleges, seats, referral codes, rosters

**1898 -> 2018 tests**, all passing locally as CI runs them. Local CI
chain green: age, vocabulary, ruff, format, mypy, 9 import contracts, modules.
Pushed as PR #11. The first CI run failed
`test_a_college_pays_as_its_organisation_and_only_its_admin_buys`: **CI never
runs `seed_catalogue.py`**, and the only thing syncing plans was
`test_payments.py`'s autouse fixture, which runs after `test_college.py`. A
test that reads catalogue plans must call `sync_plans` itself. **Rebuild with `reset_local_db.sh`** — new tables, four
candidate policies, nine functions and four triggers.

Both decisions this day needed were already in hand: the seat model (Round 7.7,
_"yes"_) and the typed referral code as consent (Round 7.9, _"do it"_). The
plan's §14 still listed Q10 and N6 as open; it no longer does.

### What landed

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evaluation interfaces** | `interview/evaluation.py`: `TranscriptionProvider` and `EvaluationProvider`, each with an **unconfigured default that raises** and a stub (`INTERVIEW_EVALUATION_PROVIDER=stub`, refused in staging/prod). The module docstring is the contract a real implementation must meet.                                                                                                                                                                                          |
| **Evaluation**            | `interview.evaluate_session` task on `interview.session_completed`, beside the re-score. Transcribes each stored answer once (`interview_transcripts`, idempotent by answer, own transaction because it is paid per minute), then rates spoken answers against the rubric (`interview_evaluations`: ratings, raw response, provider, model, prompt and rubric versions). Session → EVALUATED, or FAILED with `no_speech` / `evaluation_invalid`. Both tables insert-only. |
| **Report**                | `GET /candidate/interview/sessions/{id}/report`: PENDING / READY / FAILED. Per dimension a **level in words** (STRONG, DEVELOPING, FOCUS_AREA) and what good looks like; per question the transcript, `looking_for` and the evaluator's comment. Assembled from stored rows on every read.                                                                                                                                                                                |
| **College tenant**        | `POST /college/organisation` (business identity), `GET/PATCH` it, team under `/college/team` with COLLEGE_ADMIN / COLLEGE_STAFF (identity's team functions now take the role set). Onboarding against the versioned form: `GET /college/onboarding`, `PUT .../answers`, `POST .../submit`.                                                                                                                                                                                |
| **College subscription**  | `/college/subscription` (plans, current, checkout, cancel, mandate) — the same five routes as employers; the admin buys, staff read.                                                                                                                                                                                                                                                                                                                                      |
| **Seats**                 | `college_seat_assignments`, one live seat per student platform-wide. `guard_college_seat_assignment` holds the cap and **moves `seats_used` itself** (the app role cannot write it). `allocate_seats` (PLATFORM_ADMIN / SYSTEM, audited, **no route** — E10): never below seats in use, never above the live plan's allowance, and growing it seats waiting students, longest-linked first. `GET /college/seats` shows counts only.                                       |
| **The seat limb**         | `require_active_subscription` for a candidate is now **personal subscription OR `candidate_has_college_seat`**: a live seat, live ROSTER consent, ACTIVE college, college subscription in period — read live.                                                                                                                                                                                                                                                             |
| **Referral codes**        | `POST/GET /college/referral-codes`, `POST .../{id}/revoke`. 12 characters of Crockford base32 (60 bits, CSPRNG), always expiring (default 90 days, max 365), optional use cap, printed `ABCD-EFGH-JKMN`. The code never enters the audit log.                                                                                                                                                                                                                             |
| **Linking**               | `/candidate/colleges`: `GET /consent-terms`, `POST /link`, `GET` (links), invitations. **Entering the code is the consent, ROSTER scope only** (`student_consents`, `granted_via = REFERRAL_CODE`, the code named). Every bad code is one `referral_code_invalid`; 10 attempts an hour per student and 30 per address; a stale `consent_version` is refused. A free seat is taken at once.                                                                                |
| **Roster import**         | `POST /college/roster-imports` (CSV in the body, ≤1 MB / 5,000 rows) previews every row with its issues — malformed phone or email, no contact, duplicate in the file, already on the roster — and invites nobody. Same file again returns the same import. `GET .../{id}`, `.../rows` (keyset), `.../commit` (duplicates re-checked under a roster lock; rows that will never be invited are deleted), `.../discard` (rows deleted).                                     |
| **Invitations**           | `POST .../invitations/send` marks pending rows SENT and emits one `college.invitation_sent` per row, ids only. A student sees invitations **matched on their own verified phone or email** and accepts (INVITE consent, ROSTER only, seat taken) or declines; 30 days, expiry read from the clock. Tracking counts per import.                                                                                                                                            |

### Decisions worth knowing

- **Evaluation is feedback and cannot move a score.** The +20 was frozen at
  completion and the guard refuses any change to it; the guard now also refuses
  EVALUATED or FAILED without the evaluation row that records it. The report has
  **no number about the candidate** — ratings are stored for disputes and turned
  into words before they leave the service, because a 0–4 average beside a
  three-digit score is a second, unexplained score (R11).
- **No fallback evaluator**, for the reason there is no fallback CV extractor:
  invented feedback is feedback nobody gave. Unconfigured, a session stays
  COMPLETED and the report PENDING. Evaluator output that does not fit the
  rubric exactly — including a dimension the rubric forbids, such as accent — is
  recorded FAILED, never repaired. The evaluator is given the question, what a
  good answer contains and the transcript, and nothing about the person.
- **Silence is now visible (E19), and still earns its +20.** All-silent sessions
  are FAILED `no_speech` without calling the evaluator. Whether that should cost
  the points remains the client's decision.
- **A student never binds a college's tenant.** Codes and invitations name a
  tenant, and binding it would be a tenant id from a request body (SRS 2.24.7)
  that opens every row of that college to the transaction. Instead the candidate
  binds `app.user_id`, and nine narrow SECURITY DEFINER functions each answer
  one question. The consent INSERT policy re-checks that the code or invitation
  named is live and this college's, so a direct write cannot put a student on a
  roster, confer INDIVIDUAL scope, or use a revoked code.
- **A college never learns who has an account.** No roster column says whether a
  contact matched a user; a student finds their invitation from their own
  verified contact. A college sees counts: seats used, codes' uses, invitations
  by state.
- **Seats follow consent.** Revoking ROSTER consent releases the seat in the same
  statement (trigger), so Day 18's revocation route is correct the day it lands.
  A student linked while the college was full is seated when the allowance grows,
  or on retrying the link.
- **The 501st student is linked, not seated** — blocking, as recommended, is the
  only option that cannot surprise anyone with an invoice.
- **A college that stops paying locks its students out on the next request**,
  with seats and links kept. No grace period — that is Round 8's open question 2.
  A student who already paid keeps their own subscription alongside a seat
  (Round 8 question 1, built as "no money moves"). A seat covers the subscription
  gate only; courses and interviews are still bought (Round 8 question 3).
- **Two deviations from the plan's wording, deliberately.** The roster preview is
  synchronous rather than a 202 job: bounded at 5,000 rows it takes milliseconds,
  and a job with no broker (E15) would never run in a running API. Delivery is the
  asynchronous part. And the CSV is sent in the request body and never stored in
  S3: staged rows hold exactly what is needed, rows the college discards or will
  never invite are deleted, and there is no roster bucket to provision.
- **Revoking a code and discarding a preview are not paywalled.** Stopping
  something must never wait on a payment. Issuing, importing, committing and
  sending are.
- **A student's college routes are not paywalled**: linking is how a seated
  student gets access at all.

### Owed

- **A speech model and an evaluator** — the interfaces and the contract are in
  `interview/evaluation.py`; the choice, the prompt, and testing it on each
  supported language are not. Until then no feedback exists outside tests.
- **Seat allocation has no route** (E10, Day 19's console) — so in a running API
  no college has seats yet. Neither does releasing one student's seat by hand.
- **Consent revocation** (Day 18) — the database side is built; the route is not.
- **Invitation delivery**: SMS is DLT-gated (D1), email waits on SES production
  access, and the events need the relay's broker (E15). The evaluation task needs
  the broker too.
- **Round 8 follow-ons**: grace for students when a college lapses; confirming a
  seat excludes add-ons; what happens to a student who paid before being seated.
- Counsel's consent text (`college/domain.py`, flagged placeholder).

---

## 2026-09-16 — Day 16: questionnaire and mock interview

**1820 -> 1898 tests**, all passing locally as CI runs them. Local CI chain
green: age, vocabulary, ruff, format, mypy, 9 import contracts, modules. Not
yet pushed. **Rebuild with `reset_local_db.sh`** — new tables, guards, and the
interview price in the seeded catalogue.

### What landed

|                        |                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Questionnaire**      | `GET /candidate/questionnaire` (bank + saved answers), `PUT .../answers` (merge; `null` clears; one bad answer refuses the whole request with every issue listed), `POST .../submit`, `GET .../report` (by section, labels read back, 404 until submitted). `questionnaire_responses`, one row per candidate. Paywalled.        |
| **Device check**       | `POST /candidate/interview/device-checks`: the app reports readings, `interview.domain.evaluate_device_check` decides, every failure listed, `rule_version` stored. Valid for 60 minutes. No camera, no lighting.                                                                                                               |
| **Offer and checkout** | `GET .../offer` (price, `will_increase_score`, `requires_acknowledgement`, check status, unstarted purchases, open session). `POST .../checkout` → billing, purpose `INTERVIEW_SESSION`, refused **before a payment exists** without a fresh passed check or, from the fourth session, without `acknowledge_no_score_increase`. |
| **Purchase**           | Granted by `billing._grant` after a verified callback into `interview_purchases`; `guard_interview_purchase` refuses anything else. Versioned `interview_products` seeded from `INTERVIEW_SESSION_PRODUCT` (placeholder ₹349).                                                                                                  |
| **Sessions**           | `POST .../sessions` consumes the oldest purchase behind a fresh check, or returns the open session (recovery). Set 1, 2, 3 by session number. `GET .../sessions`, `GET .../sessions/{id}` — the answer manifest, one slot per question, `looking_for` only once that answer is stored.                                          |
| **Answers**            | `POST .../answers/{i}/upload` (presigned PUT, key derived server-side; the first starts the session), `POST .../answers/{i}/complete` (size from S3, format sniffed — Ogg/WebM Opus, ADTS/MP4 AAC — duration bounded; rejected objects deleted; idempotent).                                                                    |
| **Completion**         | `POST .../sessions/{id}/complete`: all six stored → COMPLETED, +20 and `contribution_version` frozen, audit `interview_completion_recorded`, outbox `interview.session_completed` → `rescore_for_addons`. Idempotent.                                                                                                           |
| **Scoring**            | `addons_for` lists every completed session as an `interview` event; the +60 cap stays in `scoring/domain.py`. The `MOCK_INTERVIEW_COMPLETED` badge now appears.                                                                                                                                                                 |

### Decisions worth knowing

- **Sessions are bought like the course, not through `entitlements`.** The plan's
  data model has `interview_sessions.entitlement_id`; Day 15 kept courses in
  their own module with their own guard, and interviews follow that, so the
  purchase, what the candidate was told, and the session sit together. The
  `entitlements` table is now written by nothing (its docstring says so).
- **The fourth-session warning is enforced, not just shown.** Checkout refuses
  with `interview_no_score_increase_unacknowledged` until the app sends the
  acknowledgement, and a CHECK refuses a notice row that is neither
  "will increase" nor acknowledged. Sessions "held" counts completed, open and
  unstarted purchases, so buying three at once warns on the fourth.
- **A fourth completion records +20 and scoring counts none of it.** Recording
  0 in the interview module would have put the cap in two places.
- **The candidate completes their own session**, unlike a course completion.
  What earns the points is finishing, and "finished" is decided from stored,
  validated audio — in the service and again in the database trigger. The
  weakness is that silence is valid audio (**E19**).
- **Every passed or failed device check is kept**, insert-only: it is the
  evidence when a candidate says they paid and could not record.
- **An abandoned session does not use a place under the cap** for the warning,
  but nothing can abandon one yet (**E20**).
- **The questionnaire has no employer surface and no badge** (**E21**). Submit
  shares nothing further today; it marks the answers as the candidate's to
  share once filters exist.

### Owed

- **Evaluation** (Day 17): transcription and rubric feedback; EVALUATED/FAILED
  are in the machine and unreachable.
- **E19** points on completion vs. evaluation, **E20** abandon policy, **E21**
  questionnaire filters, **E22** audio retention.
- The outbox relay still has no broker (E15): a completion re-scores in tests,
  not in a running API.

---

## 2026-09-15 — Day 15: payments, subscriptions, courses

**1732 -> 1820 tests** (62 unit, 26 integration), all passing locally as CI
runs them. Local CI chain green: age, vocabulary, ruff, format, mypy, 9 import
contracts, modules. Not yet pushed. **Rebuild with `reset_local_db.sh`** — it
now seeds the price list and the course too.

### What landed

|                       |                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway interface** | `billing/provider.py`: `PaymentProvider` for both renewal paths (order, mandate registration, pre-debit notice, debit, revocation). **Default `none` sells nothing** (checkout 503). `stub` signs callbacks with a real HMAC; `Settings` refuses it in staging and prod.                                                                                                   |
| **Checkout**          | `POST /candidate/subscription/checkout`, `POST /employer/subscription/checkout` (owner only), `POST /candidate/courses/{id}/checkout`. PENDING payment + gateway order; a second checkout for the same item within 30 min returns the first. `GET /billing/payments/{id}` to poll (someone else's is 404).                                                                 |
| **Signed callbacks**  | `POST /billing/callbacks/{provider}`, public. Signature over the raw body checked **before** parsing or writing — a forgery is a 401 and leaves no row. Verified payload stored verbatim in `payment_callbacks`, replay refused by `(provider, event_id)`, 200 at once, outbox `billing.callback_received` → task `billing.process_callback`.                              |
| **Subscriptions**     | Purchase, early renewal (extends from the end), cancel at period end, GRACE (mandate only), LAPSED, CANCELLED; every change in `subscription_events` + outbox. `GET .../subscription`, `/plans`, `/cancel`. Sweep task `subscriptions.renewals`.                                                                                                                           |
| **UPI AutoPay**       | `POST .../subscription/mandate` → PENDING until the gateway's `mandate.activated`. Sweep: notice → wait ≥24h → debit of the notified amount → callback renews from the paid end. Retries each get a fresh notice; exhausted, over-ceiling or `MANDATE_REVOKED`-style failures fall back to manual with `subscriptions.fell_back_to_manual`. `mandate_debit_notices` table. |
| **Courses**           | Catalogue and checkout behind the subscription; purchase recorded on a verified payment; `courses.service.record_completion` (SYSTEM / PLATFORM_ADMIN only, audited, outbox). **No completion route.**                                                                                                                                                                     |
| **Add-ons re-score**  | `scoring.service.addons_for` reads completions; `rescore_for_addons` runs Layers 2–3 over the stored extraction (no model call) and appends a score that replays exactly. Routed from `courses.completion_recorded`.                                                                                                                                                       |
| **Pay-first**         | `/candidate/score/me` now needs an active subscription (the Day 8 TODO).                                                                                                                                                                                                                                                                                                   |
| **Catalogue**         | `scripts/seed_catalogue.py` replaces `seed_placeholder_course.py`: 11 plans and the course, versioned — a changed price is a new row, never an edit. The course is written inactive while lessons have no media, so nothing is on sale.                                                                                                                                    |

### Decisions worth knowing

- **The database holds the gate, not only the service.** `guard_payment_write`
  refuses a payment inserted as anything but PENDING, any change to what was
  charged, an un-latched verification, and any status move off
  `billing.domain.PAYMENT_TRANSITIONS` (generated into the trigger).
  `ck_payments_settled_only_when_verified` refuses SUCCEEDED without
  `signature_verified_at`. `guard_course_purchase` refuses a purchase without
  that user's verified payment for that course, and a completion has a foreign
  key to its purchase. So a forged callback cannot produce a score change even
  through a direct repository call.
- **Callbacks are evidence.** The app role may insert them and update only
  `processed_at` and `outcome` (column grant); payments cannot be deleted.
- **A late success counts; a late failure does not.** FAILED → SUCCEEDED is
  allowed because UPI reports late successes; SUCCEEDED → FAILED is refused.
  A signed callback for the wrong amount grants nothing (`AMOUNT_MISMATCH`).
- **Grace exists only for auto-renew.** A manual subscriber has nothing
  outstanding at the end of a period, so they lapse and repurchase restores
  them at once. Entering GRACE moves `current_period_end` (access reads it) and
  keeps the paid end in `grace_from`, so a late debit renews from the paid end.
- **A LAPSED or CANCELLED row is never revived by a purchase** — buying again
  opens a new tenure, so each row's events are one run of payments. The one
  exception is a mandate debit that settles after grace ran out: it was paid.
- **Nothing debits a payer who was not told.** Every attempt has its own notice
  and waits the full period (≥24h, refused below that in config); the debit is
  for the amount in the notice, never a price changed since.
- **The mandate ceiling is the plan price at registration**, capped at
  ₹15,000 (RBI's limit for debits without per-debit approval). A price rise past
  it falls back to manual while days remain. **Employer annual and every college
  plan are over the cap, so they cannot auto-renew** — ours to verify with the
  gateway (blockers E16).
- **An organisation's money is its owner's.** Recruiters and viewers read the
  subscription; only the owner buys, cancels or registers a mandate.
- **A completion re-scores through a new task, not `score_resume`.** The Day 8
  routing sent completions to `scoring.score_resume`, which is idempotent by
  resume version — it would have found the version scored and done nothing, so
  a course would never have moved a score. Fixed and tested.
- **No schema says what a course is worth to the score** (R11, and the
  "points for sale" reading). Copy is the client's.
- **The dev simulate route is not a bypass**: it signs the stub's callback and
  runs the ordinary receive and process path, and exists only with the stub.
- **Resume intake stays open to non-payers**, by decision: uploading and
  confirming before paying is the conversion moment. It has a cost — confirming
  triggers a model call — so it is a client question (blockers E17).

### Owed

- **A real gateway** (D3) — nothing can be sold until one is chosen and its
  adapter written behind `PaymentProvider`.
- **The outbox relay has no broker** (Day 19). In a running API a callback is
  verified and stored and then **not processed**, and a completion does not
  re-score. Tests call the task's service directly; app teams can use
  `POST /billing/dev/payments/{id}/simulate` (blockers E15).
- **The renewal sweep's schedule** (E4). Access is unaffected: it is read
  from the clock.
- **A completion route** needs the assessment bank and the recorded lessons
  (C1). The Week 3 gate's schemathesis fuzzing is not run yet.
- **Refunds** — no flow; REFUNDED exists as a status only (E18). Pre-debit and
  lapse messages wait on notifications (Day 19) and DLT (D1).

---

## 2026-09-15 — Client answers after Day 14, and two changes they asked for

Recorded in `answers-log.md` Round 10.

- **E3 — legacy `.doc` is no longer accepted.** Removed from
  `resume_allowed_mime_types`; an OLE2 upload is refused as
  `upload_legacy_doc_unsupported`. Removed from _Deferred by decision_ above.
- **E13 — the candidate's name is asked at sign-up.** `PUT
/candidate/profile/name` → `candidate_profiles.full_name`; the reveal prefers
  it over the structured form's name. Never selected by masked search.
  **Rebuild with `reset_local_db.sh`.** The app's sign-up screen must ask for
  it; the API does not block anything without one.
- **Closed or confirmed:** N4/B7 acknowledged, C11 dropped, C13 30 days
  accepted, E11 not limited, discovery limits accepted as defaults. B3's
  carve-out confirmed (retention period still owed). D4 still not started.
- **E7 left as it is** pending a clearer answer on opening employer self
  sign-up.

---

## 2026-09-15 — Day 14: access windows, the reveal audit, abuse controls

**1663 -> 1714 tests**, all passing locally as CI runs them (bare `pytest --cov=app`), coverage 85%. Local CI chain green: age,
vocabulary, ruff, format, mypy, 9 import contracts, modules. **Invariants 7
and 7′ are green.** Not yet pushed, so not yet CI-verified.

### What landed

|                    |                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The reveal**     | `GET /employer/discovery/candidates/{candidate_id}` → `RevealedCandidate`: phone, email, the display score, band, experience, skills, badges, location, and `full_name` only from the structured form. Owners and recruiters; mounted by `candidate` (it needs `display_value`), decided by `discovery.service.open_candidate`. |
| **Access window**  | `require_active_access_window` is real: the tenant's subscription, read live, `402 access_window_expired`.                                                                                                                                                                                                                      |
| **Audit (7′)**     | One `audit_events` row (`candidate_profile_viewed`, ids only) and one `candidate_view_events` row per open, same transaction, re-opens included.                                                                                                                                                                                |
| **Abuse controls** | Per-organisation caps on distinct candidates per rolling hour and day (`429 view_cap_reached`), a per-person burst limit, search pages per hour, and two alerts (`ACTOR_VELOCITY`, `DAILY_CAP_REACHED`) as audit rows plus `discovery.view_anomaly_flagged`. All in `config_values` `discovery.limits`.                         |
| **R15**            | `require_active_subscription` on every employer jobs, pipeline and search route. Organisation, team and KYB stay open.                                                                                                                                                                                                          |
| **Schema**         | `candidate_view_events` partitioned by month (key `(id, viewed_at)`), 15 partitions + DEFAULT, `ensure_candidate_view_partitions()`; task `discovery.ensure_view_partitions`. **Rebuild with `reset_local_db.sh`.**                                                                                                             |

### Decisions worth knowing

- **The partitioning the docstrings promised did not exist.** The model and
  the migration both said "partitioned by month"; the table was an ordinary
  one. It is now, and a test reads `pg_partitioned_table` rather than a
  comment.
- **Partitions are closed to the app role.** Default privileges grant it DML
  on every new table, and RLS on a partitioned parent does not apply to a
  query that names a partition. So the app goes through the parent or
  nowhere, tested by trying.
- **The DEFAULT partition is a safety net.** An unscheduled month lands there
  rather than refusing a reveal and losing its audit row. Creating that month
  later refuses while DEFAULT holds its rows, which is loud on purpose.
- **Caps count distinct candidates and a re-open costs nothing**, but every
  re-open is still audited. Charging for re-reading one profile would push
  recruiters to copy details out of the product, which is worse.
- **Caps are checked before the lookup**, so a capped organisation cannot
  probe which ids exist. **Rolling windows, not calendar days**, so a cap
  cannot be doubled across midnight. **Under an advisory lock per
  organisation**, so fifty concurrent requests cannot each read the same
  count.
- **The view event is inserted from the visibility CTE**, so it cannot name a
  candidate the reveal would not show, and a candidate suppressed between
  search and click is a 404 with no trace.
- **Alerts fire on the crossing, not the level**, once per burst, and block
  nothing; the caps block. **No limit is the client's**: 60/hour, 300/day,
  20 opens/minute per person, 40 distinct in 10 minutes flags. A malformed
  row is a 500, never the defaults.
- **The reveal route lives in `candidate`, the decisions in `discovery`.**
  `discovery` may not import `scoring` (an invariant test), and the response
  needs `display_value`. Everything that decides the reveal happens before
  anything reads the candidate.
- **`test_discovery_suppression.py` was refined, not relaxed.** The rule "every
  discovery query uses the visibility CTE" now names four functions that read
  no candidate (config, a lock, the view log's own counts, partition upkeep),
  each with a reason, and **fails if any of them mentions a candidate table**.
  Worth a second look in review.
- **No name is guessed.** Only the structured form stores one; uploaded CVs
  reveal contact details and no name (blockers E13).
- **R15 landed here, not Day 15**, because Day 14 lists it and the employer's
  subscription is the access window anyway. Existing employer test helpers
  now seed one (`subscribe_tenant`).

### Owed

- **N4 / B7** — the client's written acknowledgement of the bulk-extraction
  risk is still not in. These controls are mitigation; verification is the fix.
- **Someone to read the alerts** (E14, blocked on E10), and the partition
  schedule (E4).
- **Per-organisation overrides of the limits**: one global row today.
- **Load**: caps and the reveal query are indexed, not measured (Week 5).

---

## 2026-09-15 — Day 13: masked candidate search

**1591 -> 1663 tests.** Local CI chain green: age, vocabulary, ruff, format,
mypy, 9 import contracts, modules. Coverage 85%.

**The first push (`c10f20f`) failed CI on a flaky test of ours**:
`test_a_newer_score_replaces_what_search_knows`, about one run in ten locally
too. The product was right: the test's random skill was hex, and a hex token
sometimes holds eight digits in a row, which `CONTACT_LIKE_PATTERN` drops as a
phone number. Test tokens are now letters only. The contact filter's cost is
the same for real data: a skill containing eight or more digits in a row is
not indexed.

- `test_pipeline.py::test_a_smuggled_field_is_refused` (Day 12) failed once in
  the long local run and passes alone and with its file. It passed in CI.
- **The full local run took 1h40m; the CI tests job takes about 2.5 minutes**,
  so the slowness is this machine, not Day 13.

### What landed

|                        |                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Employer search**    | `GET /employer/discovery/candidates`: filters `band` (repeatable), `skill` (up to 5, all must match, case-insensitive), `badge`, `min_experience_years`, `state`, `city` (contains), `q` (words in a skill); keyset `cursor`, `limit`. Owners and recruiters of a **KYB-approved** employer; 300 pages/hour per organisation. |
| **The card**           | `MaskedCandidate`: `candidate_id`, `band`, `experience_years`, `skills` (≤20), `badges`, `city`, `state_code`. Nothing else, and an invariant test holds the list.                                                                                                                                                            |
| **Candidate location** | `GET /candidate/profile`, `PUT /candidate/profile/location`. Not paywalled.                                                                                                                                                                                                                                                   |
| **Schema**             | `candidate_search_documents` (trigger-written), `candidate_profiles`, trigger `project_candidate_search_document` on `scores`, index `ix_scores_user_latest`. **Rebuild with `reset_local_db.sh`.**                                                                                                                           |

### Decisions worth knowing

- **The search document is a trigger's, not a task's.** An `AFTER INSERT` on
  `scores` writes it in the transaction that wrote the score; the app role has
  no INSERT/UPDATE/DELETE on it. So it cannot miss an event, lag a re-score, or
  carry something the score does not support. An older score arriving late
  never overwrites a newer document.
- **Generated, not hand-copied.** The trigger's band CASE comes from
  `scoring.domain.BANDS`, badges from `BADGE_FOR_ADDON_KIND`, the contact
  filter from `CONTACT_LIKE_PATTERN`, as the application guard comes from
  `allowed_transitions()`. `discovery` still imports nothing from `scoring`;
  the migration and the tests do the joining.
- **Experience is summed in SQL**, and a parametrised test holds it equal to
  `features_from_extraction` over malformed roles too (strings, floats,
  booleans, negatives, non-lists).
- **Visibility is still only the Day 9 CTE.** Search joins the document on
  `(user_id, resume_version_id)`, so a suppressed or unchecked candidate keeps a
  document and never appears, and a stale document matches nothing.
- **Band, never score, and ordering by band only.** Within a band the order is
  by id, which means nothing. No total: a count over a narrow filter says
  whether one person is in the pool.
- **Skills are CV text and can carry contact details.** Anything email- or
  phone-shaped is dropped from the document, so it can't be searched for
  either, and dropped again at the card. The pattern spares "ISO 9001:2015",
  "IEC 61131-3", "Python 3.12".
- **Location did not exist anywhere**, so it is new, and it is **ours, not the
  client's**: optional, declared by the candidate, city plus state, no address
  or PIN code (with a band and skills, a PIN narrows a card to a handful of
  people). A city refuses digits and `@`. Layer 1 was not asked to extract a
  location, since that changes the prompt version and so every score.
- **Viewers cannot search.** SRS 1.14.1 names recruiter and owner. Widening it
  is one dependency.
- **No audit row for a search.** A card holds nothing PRD rule 9 calls private.
  The audit belongs to the Day 14 reveal.
- **Only the filters asked for are in the SQL.** A single statement of
  `(:x IS NULL OR ...)` terms gets a generic plan that can use none of the GIN
  indexes. Every value is still a bind parameter.
- **Indexes:** GIN on `skill_keys`, `badges`, `search_vector` (`simple`
  config: skills are proper nouns); btree `(band_rank DESC, user_id)` for the
  keyset; trigram on `candidate_profiles.city`; and `ix_scores_user_latest`
  matching the CTE's `DISTINCT ON` order, which the old index could not serve.
  **Not verified under load**; that is Week 5 (plan §9, target < 600 ms).

### Owed

- **Questionnaire badges**: no questionnaire tables until Day 16.
- **Configurable caps, the access window, anomaly detection** (Day 14). The
  hourly page limit here is a constant floor.
- **The employer subscription gate** (Day 15).
- **N5**, the unlock-criteria rescission, is still unasked (blockers B6). It
  does not block the build.

---

## 2026-09-15 — Day 12: the pipeline, interviews, the two-sided hire, expiry

**1455 -> 1591 tests**, full local CI chain green (age, vocabulary, ruff,
mypy, 9 import contracts, modules, pytest at 85%).

### What landed

|                       |                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Employer pipeline** | `/employer/applications`: list a job's applications (oldest first, by stage, keyset), open one, `POST /{id}/stage`, `PUT /{id}/interview`, `POST /{id}/hire`. Owners and recruiters act; viewers read.            |
| **Candidate side**    | `GET /candidate/applications/{id}` now carries the history; `POST /{id}/hire/confirm` and `/hire/dispute`. Not paywalled.                                                                                         |
| **Expiry**            | `applications.service.expire_for_tenant` and the `applications.expire` task (`app/tasks/expire_applications.py`).                                                                                                 |
| **Schema**            | `applications.expires_at` replaced by `employer_active_at`; `hire_disputed_at`; five CHECKs; `application_events.kind` and `actor_type`; trigger `guard_application_write`. **Rebuild with `reset_local_db.sh`.** |

### Decisions worth knowing

- **One stage forward, or rejected.** SRS 1.9.2's "next permitted stage".
  Acting on a SUBMITTED application records VIEWED first, and opening one
  records VIEWED once, for any role — so a candidate's board never shows a
  decision about something nobody opened. Moving to the current stage is a
  no-op, not a 409, so a retried drag is harmless.
- **HIRED is nobody's alone.** The employer proposes (`employer_confirmed_at`);
  the candidate's confirmation is the transition, written in one statement with
  the stage because a CHECK refuses either without the other. Both are latches.
  `applications.hire_confirmed` is the final hire event; **nothing is billed on
  it** (client deferred, `answers-log.md` 0.8).
- **A dispute adjudicates nothing.** It is recorded and the hire stays
  unconfirmed; it closes by the candidate confirming, the employer rejecting,
  or the candidate withdrawing. Nobody can review it yet (blockers E12, E10).
- **The database holds the pipeline too**, as the publish trigger holds
  invariant 8. `guard_application_write` enforces the transition graph (built
  from `domain.allowed_transitions()`, so the two cannot drift), the latches,
  filing at SUBMITTED, and **which party may write which columns** — a tenant
  transaction cannot withdraw, confirm or dispute; a candidate transaction can
  do nothing else. Tested on app-role sessions with the service out of the way.
- **Expiry is measured, not stamped.** `employer_active_at` moves on every
  employer action and the sweep compares it with the configured period, so
  changing the period applies to every open application at once. A booked
  interview holds an application open; a proposed hire never expires.
  **The 30-day default is ours** (blockers C13). A malformed config row stops
  the sweep rather than defaulting.
- **The sweep binds each employer tenant from `tenants`** — the one place a
  tenant id does not come from a membership. It is the system acting, with no
  caller to supply one, and binding keeps it under the same RLS as a request,
  one transaction per tenant, `SKIP LOCKED` so it never waits on an employer.
- **The employer's notes, and which recruiter acted, never reach the
  candidate.** The board shows who moved it as a party. A unit test fails if a
  candidate schema grows `note` or `actor_id`.
- **The meeting link stays off the outbox.** The candidate reads it behind
  their own authentication. Links must be `https` with a real host and no
  credentials; **which host is not restricted** (blockers E11).
- **The pipeline is not a profile.** `candidate_id` and nothing about who they
  are — that is the Day 13–14 reveal, behind the access window and its audit.
- `application_events.occurred_at` is `clock_timestamp()`: VIEWED and
  SHORTLISTED written in one transaction sort in the order they happened.

### Owed

- **The EventBridge schedule** for the sweep (E4). Until then nothing expires
  on its own — the safe direction.
- **Notifications** for stage changes, interviews and hires (Day 19; SMS
  gated on DLT). The events are emitted with ids only.
- **The employer subscription gate** on these routes (Day 15, with the rest).
- **Whether a HIGH integrity signal raised after applying should hide the
  application from the pipeline.** Today it does not: the pipeline shows no CV
  content, and the Day 14 reveal is where the visibility rule should apply.

---

## 2026-09-15 — Day 11: the job board, eligibility, apply and withdraw

**1406 -> 1455 tests.** Before starting, Days 1–10 were re-verified
against a rebuilt database: 1406 passing, with the partial days (3, 4, 6, 8, 9)
still partial for the external reasons already recorded (Twilio, AWS service
activation, E10).

### What landed

|                     |                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Job board**       | `GET /candidate/jobs` (search: words, location, work mode, skill, salary, eligible-only; keyset cursor) and `GET /candidate/jobs/{id}`. Every employer's published jobs with the employer's name.                   |
| **Applications**    | `POST /candidate/applications`, `GET` list and one, `POST /{id}/withdraw`.                                                                                                                                          |
| **Pay-first (R13)** | `require_active_subscription` stops being an unconditional 402. It reads `subscriptions` on every request, never cached, and the clock decides: a period that ended a second ago grants nothing, sweep or no sweep. |

### Decisions worth knowing

- **A candidate has no tenant, so the board needed its own RLS identity.**
  Binding `app.tenant_id` to each employer in turn would take the tenant from
  somewhere other than a membership, which SRS 2.24.7 forbids. Candidate
  services bind `app.user_id` instead, and five new policies read it through
  `current_candidate_id()`, which is NULL unless **no tenant is bound** and the
  id is an **active candidate account**. So an employer transaction can never
  see another employer's jobs through them, a business user bound as a user
  sees nothing, and a transaction that binds nothing still reads no jobs.
  17 policies, up from 12.
- **The threshold is never shown to a candidate.** Beside their own score it is
  the gap, and the gap is the explanation R11 rules out. They get
  `ELIGIBLE / BELOW_THRESHOLD / SCORE_PENDING`, judged on the stored score. A
  score in the query string is ignored, and a test says so.
- **Applying follows the discovery rule.** Applying puts a candidate in front of
  an employer, so it uses the same `is_candidate_visible` CTE as search.
  Without it a CV held back by a HIGH integrity signal reaches employers
  through the apply button: the bypass Day 9 closed for search. The refusal
  (`application_unavailable`) does not say why, because naming an integrity
  review tells someone gaming a CV that they were caught.
- **Idempotent by the index, not by a read.** `ON CONFLICT DO NOTHING` against
  `uq_application_active`; three simultaneous applies give one 201 and two 200s
  with the same id. A retry is checked first, so it gets the same answer
  whatever changed in between.
- **An application's tenant is its job's tenant, by a key.** A candidate writes
  the row and has no tenant to bind, so a single-column key on `job_id` would
  let the row claim any tenant and land in the wrong employer's pipeline.
  `fk_applications_job_tenant` on `(job_id, tenant_id)` holds it even for the
  migrator.
- **The database refuses what the service refuses.** A candidate session cannot
  apply as someone else, apply to a job that is not live, read or withdraw
  another candidate's application, or change a job. Tested on an app-role
  session with the service out of the way.
- **Reading and withdrawing are not paywalled.** A lapsed subscriber keeps their
  applications and can withdraw them; they cannot search or apply. An
  application nobody can withdraw without paying is their data held in an
  employer's pipeline for a fee.
- **A job off the board is a 404 everywhere**, for the detail and for applying:
  draft, paused, closed and nonexistent look the same.
- **The Application Board still names a job that closed.** The board policy
  also shows jobs the candidate applied to, so board queries filter on status
  themselves.
- **`published_at` is stamped by a trigger** and held by a CHECK, because the
  cursor is `(published_at, id)` and fixtures insert PUBLISHED rows directly.

### Owed

- **The seat limb of the entitlement check** (Day 17). `college_seats` is one
  allowance row per college with no per-student assignment, so there is
  nothing to ask. A seated student is refused until then; no seat has been
  sold.
- **The gate on the score, resume and employer routes** (Day 15). The
  dependency works; nobody can buy a subscription yet, so adding it to routes
  that exist today would lock every account out of them.
- **GRACE semantics** (Day 15): a GRACE row grants access only while
  `current_period_end` is in the future, so entering GRACE must move that date.
- `IDEMPOTENT_OPERATIONS` lists `application_create`; apply is idempotent by
  the unique index and does not read an `Idempotency-Key` header.

---

## 2026-09-13 (evening) — Day 10: KYB and jobs; Bedrock connected; Week 1 gate closed

**1237 -> 1406 tests.** `59e9edc` carries the Bedrock connection, integrity
thresholds as config and the cross-tenant suite; `4115c6a` is Day 10. Both are
green on CI.

### Day 10 — KYB, jobs, invariant 8

- **R15 is one switch.** `config_values` key `kyb.require_approval`,
  `{"enabled": true|false}`, off when absent. Off: a complete submission is
  approved on arrival and marked `auto_approved`. On: it waits at SUBMITTED for
  a reviewer. A malformed row refuses with `kyb_config_invalid` rather than
  guessing: guessing "off" approves organisations nobody meant to approve.
- **Answers are validated on the server** against the published form, by a new
  `app.core.forms.validate_answers`. Every problem is returned at once, by field
  and code. Until now nothing checked a submitted form; the patterns in the
  definition were hints to the browser only.
- **Documents follow the CV intake rules.** The server derives the key, the
  type is sniffed from the bytes (PDF, JPEG or PNG), size is capped at 10 MB, a
  rejected object is deleted, and completing twice is a retry.
- **Each decision is mirrored onto `employers.kyb_status`**, the column the
  publish trigger reads, through `employer.service.set_kyb_status` only. A
  profile edit cannot set it.
- **Jobs.** DRAFT -> PUBLISHED -> PAUSED -> PUBLISHED -> CLOSED. CLOSED is
  terminal. A job is editable only as a draft or while paused, so nobody applies
  on terms that are then changed. A smuggled `status` is a 422.
- **Invariant 8 is held twice**: a service check that can say what to do, and
  the trigger that nothing can route around. The trigger re-checks on
  PAUSED -> PUBLISHED, so losing verification keeps a paused job off the board.
  Tested with the switch on, and through a direct repository call.
- **Threshold preview is treated as the leak vector the plan names.** Thresholds
  in steps of ten, counts floored to the nearest ten, anything under ten
  reported only as "fewer than ten", 30 previews an hour per organisation.
- **The Week 2 path works through the API alone**: sign up, complete KYB,
  publish a job. Tested end to end, with nothing set behind the API's back.

### Found while building

- **`reference.INDIAN_STATES` did not exist.** Both the KYB and college forms
  name it as an options source, so every state an employer chose would have been
  refused. Added in `app/core/reference.py`, where both modules can use it
  without importing each other.
- **KYB submissions had nowhere to store their answers.** Added `answers`,
  `form_version`, and a partial unique index allowing one open submission per
  organisation.
- **No reviewer can exist** (E10). A membership needs a tenant, and tenants are
  only EMPLOYER or COLLEGE. KYB and integrity review actions are built and tested
  in their services, with no routes until platform-staff tenancy is decided.

### Also today

- **Manual-form CVs now go through Layer 1**, rendered to text without the name
  or the graduation year (E6 closed in code). A correction to what I told the
  client: they cannot be scored without a model. Scoring the form directly would
  give zero for the three judgments only the model makes, so the same career
  would score lower through the form than through an upload.
- **Bedrock extractor built**, off by default, with no default model. Terraform
  grants invoke-only on the four offered models; planned, not applied.
- **Integrity thresholds are config.** Every number is in
  `integrity.thresholds`; `thresholds_version` is stored on every signal and
  check; a bad row stops the check.
- **Week 1 gate closed.** The cross-tenant suite enumerates every tenant route
  with an id from the running app, and a new route without a 404 case fails the
  build. It caught all six Day 10 routes the moment they existed.

### AWS, checked live on 2026-09-13

- **Bedrock:** "account being verified" has cleared, but every model, Amazon
  Nova included, returns `Operation not allowed`. Claude shows `NOT_AUTHORIZED`
  and the Anthropic use-case form has not been submitted.
- **Textract and GuardDuty:** `SubscriptionRequiredException`, in two regions.
  The Health dashboard does not show per-account service activation. Needs a
  support case.

### Owed

- The subscription gate on jobs and KYB (Day 15; pay-first, R13).
- Reviewer routes for KYB and integrity (E10).
- Model choice, the Terraform apply, and AWS service activation. Until then the
  Week 2 gate's "20 real resumes, upload to score" cannot run.

---

## 2026-09-13 — Day 9: integrity on real CVs, suppression inside discovery, employer tenancy

**+80 tests.** Built in the same working tree, at the same time, as the streak
work in the next entry, by a second session. Neither overwrote the other, the
combined suite passes, and **both are uncommitted**.

### What landed

|                                        |                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integrity runs on real CVs**         | `scoring.score_computed` routes to `integrity.detect`, which reads the stored Layer 1 extraction and the CV text, runs the eight rules, and persists signals. Idempotent by resume version. |
| **Suppression lives inside discovery** | One CTE, `VISIBLE_CANDIDATES_CTE`, that every discovery query is built on. `test_discovery_suppression.py` fails the build if a query skips it.                                             |
| **Employer tenancy**                   | Create an organisation, the three employer roles, and add, re-role and remove members by email. Eight endpoints; every team change audited without the address.                             |

### Four decisions worth knowing

- **Visibility fails closed.** Integrity runs asynchronously after scoring, so
  a candidate briefly has a score and no signals. Without a record that the
  check ran, _no signals_ cannot tell _clean_ from _not yet looked at_, and a CV
  carrying injected instructions would be searchable for exactly that window.
  A new `integrity_checks` row closes it: **unchecked means invisible**.
- **A confirmed dishonest CV stays hidden.** The existing partial index matched
  `state = 'OPEN'` alone, so a reviewer _confirming_ manipulation would have put
  the candidate straight back into search. OPEN and CONFIRMED now both suppress,
  and only CLEARED restores. The index and the CTE share one predicate, asserted
  character for character so the planner can use the index.
- **Suppression is candidate-wide, not per version.** Otherwise: inject, get
  flagged, upload a clean copy, and reach employers before anyone has looked.
- **Dates are dropped, never guessed.** Layer 1 captured only durations, so the
  timeline rules were unreachable from a real CV. Schema v2 adds role dates, with
  a month only where the CV states one. "2019–2021, 2021–2023" rounded to
  January starts and December ends becomes eleven months of two full-time jobs.
  The whole-career rules run only when every role is month-dated. Scoring reads
  none of the new fields — asserted.

### Employer onboarding

- **Creating an organisation was unreachable.** `current_user` refuses a
  business account with no membership, and an account cannot create its
  organisation if it must already belong to one. New `current_business_identity`
  returns a `BusinessIdentity`, deliberately not a `TenantContext`, and backs
  exactly two routes.
- **`get_db` never binds `app.tenant_id`.** The employer service binds it from
  the resolved membership before every read. Without that, RLS on `employers`
  returns nothing, which looks like a missing row rather than a bug.
- **One organisation per account, checked against raw `memberships`.**
  Authorisation hides a suspended tenant's membership, so a naive check would let
  the owner of a suspended employer start a fresh one. Tested.
- **Concurrency.** The last-owner rule holds under `FOR UPDATE`; one account,
  one organisation holds under an advisory lock.
- **No enumeration oracle.** Adding an address that belongs to a candidate or to
  another employer's member returns one identical refusal, so no employer can
  test whether a person is registered.

### Found while building

- **`module-privacy` had been wrong since Day 1.** Missing
  `allow_indirect_imports`, it forbade `employer.service -> identity.service ->
identity.repository`, the path it exists to funnel traffic into. Invisible
  until a module first called `identity.service`. The third time this exact bug
  has appeared in `.importlinter`; a direct import was re-verified to break it.
- **Manual-form resumes never score, so they never reach employers.** Day 8
  scoring refuses a version with no free text; Day 9 visibility requires a
  score. Recorded as `blockers.md` E6.
- Two test bugs, not code bugs: raw SQL used the ORM attribute
  `event_metadata` rather than the column `metadata`, and a resolve test passed
  a random reviewer id into a real foreign key.

### Owed before Day 9 is done

- **Rule thresholds in `config_values`.** Rules are versioned but the numbers
  are still named constants in `integrity/domain.py`.
- The reviewer-queue routes (Day 19). `resolve_signal` exists; no HTTP route yet.
- Hidden-text extraction (E5), so `HIDDEN_TEXT` stays inert.
- CI has not run on this tree.

---

## 2026-09-13 — Daily streaks and engagement points (client request)

**+111 tests, one new module (`engagement`, the 21st), three endpoints, two new
import-linter contracts.** Outside the twenty-day schedule. Full write-up:
[`streaks.md`](streaks.md).

### What was asked, and the contradiction in it

The client asked for LeetCode-style streaks: −10 points when a streak breaks,
and +10/+15/+20 at 30/90/365 days, all configurable. The request does not say
_which_ points. **Read as points on the candidate score, it breaks invariants
1, 2, 3 and 4′ at once:**

- a −10 takes a fresh 700 below its base, and milestones take 990 past the
  ceiling, so both writes would hit the CHECK constraints;
- "opened the app" is not an input `replay()` can reproduce;
- 700 + 200 + 30 + 60 = 990 has no room for another contributor.

**Built as a separate engagement-points balance**, and kept separate
structurally rather than by convention:

- an import-linter **independence** contract between `engagement` and
  `scoring`;
- a forbidden contract stopping employer, jobs, applications, discovery,
  college and analytics from importing `engagement`;
- `tests/invariants/test_streak_never_moves_the_score.py`, which guards both
  contracts and the task routing table (routing holds task _names_, so an
  import contract alone would not catch a subscription).

Confirming this with the client is **S1** in `streaks.md` §7, along with _what
the points are for_: nothing spends them yet.

### Decisions taken inside it (S2–S8, all cheap to reverse)

- **One deduction per break**, however many days were missed. The **balance is
  floored at 0**, and the ledger stores `requested_points` beside `points` so
  clipping stays visible.
- **Milestones once per streak run**, re-earnable after a break. Nothing past 365.
- **The day is IST, decided by the server.** A check-in carries no date,
  because one that did could keep a streak alive forever. Fixed offset, not
  `ZoneInfo`: IST has no DST, and `ZoneInfo` needs `tzdata` on Windows.
- **A break shows at once, and the deduction lands at the next check-in.**
  `GET` returns BROKEN with streak 0 immediately; no nightly sweep.
- **Candidates only, and not behind the subscription gate.** Behind the
  paywall, a lapsed subscriber would lose points for not paying rather than
  for not opening the app.

### How "configurable" is made true

- **Every number lives in `StreakRules`**, loaded from `config_values` key
  `engagement.streak_rules`: the highest version whose `effective_from` has
  passed. With no row, `DEFAULT_RULES` applies.
- **`check_in` names no number.** `test_without_a_milestone_at_thirty_nothing_is_awarded_at_thirty`
  proves it.
- **Parsing is strict.** An unknown key, a boolean, a negative value or a
  duplicate milestone raises `streak_rules_invalid`. Falling back to defaults
  would make a misspelt row look applied.
- **Every ledger row stores `rules_version`.**

### Guarantees and where they live

| Guarantee                                                  | Mechanism                                                     | Test                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Two devices checking in at once count once and deduct once | `SELECT … FOR UPDATE` after `INSERT … ON CONFLICT DO NOTHING` | `test_two_simultaneous_first_opens_count_once`, `test_simultaneous_opens_after_a_break_deduct_once` |
| The ledger cannot be rewritten                             | `REVOKE UPDATE, DELETE ON streak_point_events`                | `test_the_points_ledger_is_append_only` (as the app role)                                           |
| Balance never negative                                     | Domain floor + CHECK on both tables                           | 25-seed property test; `test_the_database_refuses_a_negative_balance`                               |
| A milestone once per run, a break once per day             | Partial unique indexes                                        | — (belt and braces behind the lock)                                                                 |
| Streaks never write a score                                | Independence contract                                         | `test_streak_points_never_write_a_score`                                                            |

### Found while building

- **A test simulating March 2026 cannot use a config row effective from the
  real `now()`.** The row is in the future relative to the injected clock, so
  the "config changes the numbers" test silently ran on the defaults. The
  fixture now defaults `effective_from` to 2000-01-01. Noted in `CLAUDE.md`,
  because the next time-injected test will hit the same thing.
- **Python-side `default=0` does not help a raw SQL insert.** The
  negative-balance test failed on NOT NULL before the CHECK was reached. The
  integer columns now carry server defaults too.
- **Parallel work in the same tree.** Day 9 integrity changes (`integrity/`,
  `discovery/`, `scoring/service.py`, `tasks/routing.py`, `integrity_checks`
  in the baseline) appeared uncommitted during this session. They were left
  untouched. `mypy app` currently reports 3 errors there, and `ruff` reports
  E501 in `discovery/repository.py`. **Both are outside `engagement`, and both
  will fail CI until that work is finished.**

### Schema

The baseline migration gains `user_streaks` and `streak_point_events`. As
always, **rebuild with `reset_local_db.sh`**: 43 tables and 12 RLS policies
with the Day 9 work included.

---

## 2026-09-12 — Day 8: the scoring pipeline, and invariants 1–4′

**958 -> 1046 tests.** The client accepted the calibration (35/35 "about
right"), which took the rubric from provisional to agreed, and the rest of Day
8 followed: Layer 2, the extraction cache, persistence, replay, the display
floor, the candidate route and the trigger.

### Invariants 1, 2, 3 and 4′ are green

| #      | What makes it true                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | `replay(score_id)` re-runs Layers 2 and 3 over the **stored** model response and never calls the model. Tested with add-on contributions, not only base scores — a replay that only reproduces base scores breaks the first time someone buys a course. A mismatch **raises**: a replay that quietly disagreed would be used to answer a dispute and would answer it wrongly. |
| **2**  | CHECK constraints hold 700–990 and `raw = base + addon`. `display_value` applies the floor at the serialization boundary **and nowhere else**, so what is stored is what was computed. Asserted across all 291 values in range.                                                                                                                                               |
| **3**  | `repository.insert_score` is the only write path; there is deliberately no update and no delete function, and the app role holds neither grant.                                                                                                                                                                                                                               |
| **4′** | Exercised end to end through the real write path: a caller asking for 500 + 500 add-on points gets 90, and the decomposition still sums.                                                                                                                                                                                                                                      |

### The design decision that carries the most weight

**The model's output is an input to scoring, captured once and stored — not a
step in the computation.** Everything else follows from that. Replay is
bit-identical in perpetuity because it re-reads a stored JSON blob rather than
re-asking a model that may have been retired, upgraded or simply moved on.

The cache key is `sha256(normalised_text + model_id + prompt_version +
schema_version)` — **not the resume id and not the user id**. So the model is
called once per distinct CV ever; two candidates with identical text get
identical extractions because it is literally the same row; and re-scoring
after a course purchase is Layer 3 only, costing nothing and unable to drift.

### Decisions taken inside that work

- **There is deliberately no heuristic fallback extractor.** With no model
  wired, `UnconfiguredResumeExtractor` raises and the score stays **PENDING**.
  A keyword-matching stand-in would produce a plausible wrong number, which
  `scoring-approach.md` §11 forbids: unfixable once the candidate has seen it,
  and a dispute we cannot win. A test asserts an unconfigured build yields
  pending rather than 700.
- **Experience is summed from the roles, not read from the model's own
  total.** The roles are checkable and the total is not; a model that
  miscounts its own arithmetic must not move a score by 55 points.
- **An unrecognised job title resolves to `unknown` and scores zero.**
  Guessing is how a scoring system starts rewarding inflated titles. Longest
  match wins, so "Senior Vice President" is an executive, not a senior.
- **Layer 2 is total, never raising.** It runs against extractions stored
  years earlier under a schema that has since moved on, and a replay that
  throws cannot answer a dispute — which is the one thing it exists to do. A
  malformed field degrades that dimension to zero.
- **Skill evidence is the mean, rounded down**, over _distinct_ skills. A CV
  with one well-evidenced skill and nine bare keywords is mostly a keyword
  list; rounding up would pay for the keywords.
- **STRONG runs to 990, not 900.** 900 is the resume-only ceiling. Stopping
  the top band there would leave every candidate who bought an add-on in no
  band at all — and the band is what an employer sees (R4).
- **`ALGORITHM_VERSION` is composed** from the taxonomy and rubric versions
  rather than being a number somebody has to remember to bump.
- **`prompt_hash` is stored beside `prompt_version`.** The version is a label
  a human maintains and can forget; the hash is computed and cannot be, so a
  replay comparing both can tell a deliberate change from a careless one.

### The Day 8 trap, closed at the place it would actually be sprung

Day 7 left a tripwire: scoring must consume `resume.version_confirmed`, never
`resume.version_created`. That test scanned `app/modules/scoring/` for the
wrong event name — which would not have caught anything, because **the
subscription does not live in that module**. It lives in the task wiring.

So `app/tasks/routing.py` now holds one table mapping event to task, and the
invariant test asserts against the table directly: the confirmed event routes
to scoring, the created event does not, and the routed task name is one a
worker actually registers. That last one was verified by renaming the task and
watching it fail — a routing table pointing at a name nobody registers is
wiring that reads as working and does nothing, and the symptom would have been
scores that never appear rather than an error anyone sees.

### Found while building

- **My own new import-linter contract was wrong.** `resume-internals-are-
private` (added yesterday) forbade the _indirect_ chain
  `scoring.service -> resume.service -> resume.repository`, which is the exact
  path the contract exists to funnel traffic into. Same failure the `layers`
  contract hit on Day 3, with the same fix (`allow_indirect_imports`). Re-
  verified that a **direct** import still breaks it.
- **The extraction cache made tests order-dependent, correctly.** Several
  tests shared one CV body, so the second to run saw zero model calls and
  failed an assertion about caching. That is the cache doing exactly what it
  promises — one call per distinct CV **ever**, across users and across time,
  with rows outliving the test that wrote them. Fixed by giving each test its
  own document, not by weakening the cache.
- **The invariant-5 checker caught my own test.** A test asserting the
  extraction schema has no date-of-birth field had to _name_ the field to do
  so, which trips `check_no_age_fields.py`. The script exempts exactly one
  file — invariant 5's own test — and diluting that for convenience would
  weaken a legal-requirement guard. Rewritten to assert on the prompt text
  instead; repo-wide field absence was already guaranteed by the existing
  test.

### Owed before Day 8 can be called done

- **The Layer 1 model client.** The seam is real, exercised and tested; the
  client lands when credentials do. Nothing else moves when it does — the
  cache, Layers 2 and 3, persistence and replay all sit behind
  `get_resume_extractor` and none of them knows which extractor produced a
  result.
- **The shareable card** (band by default, exact number on explicit opt-in,
  opaque revocable token). Not started.
- **The outbox -> broker hop** remains the pre-existing Day 19 TODO. The
  subscription table is declared and tested; `_publish` still logs rather than
  enqueuing.

---

## 2026-09-12 (later still) — C12 closed, and the college price list rebuilt

The client answered the one open question that moved a revenue number rather
than a date: **"No - Student does not pay if the college has paid for it."**

### What was wrong, and why nothing caught it

C12 had never been put to the client. Both price lists were built on the
unexamined assumption that a seat and a subscription were separate purchases —
a college deal earning its seat fee _on top of_ whatever those students paid
directly. On that reading, ₹12–17 per seat per month was a placement-cell tool
sold alongside real candidate revenue, and it looked entirely reasonable.

The answer is the opposite. The seat fee is the **entire** lifetime revenue
from that student, which put the old ladder at **13–18% of what the same
student was worth unsigned**. A thousand-seat annual deal would have displaced
roughly ₹10.2 lakh of candidate revenue to book ₹1.4 lakh — every college
signed would have made the business smaller.

**Nothing failed, and that is the part worth keeping.** Every price check in
the suite was structural: totals ascending with seat count, longer periods
never costing more per month, tax flags correct per audience. All of them
passed. A number can satisfy every structural invariant while being an order of
magnitude wrong about _what it is selling_, and the figure that would have
shown it — revenue per seat — was not computed anywhere in the codebase.

### What replaced it

A seat is now priced as what it is: a **bulk-rate candidate subscription**,
discounted for volume rather than invented independently. The discount is real
— one invoice, upfront, students at zero acquisition cost, onboarding carried
by the college — but it is a discount on a known number.

| Plan                    | Old       | New           | Per seat, ex-tax | Yield vs direct |
| ----------------------- | --------- | ------------- | ---------------- | --------------- |
| `COLLEGE_SEMESTER_250`  | ₹24,999   | **₹69,999**   | ₹279.99          | 17% → **47.3%** |
| `COLLEGE_SEMESTER_1000` | ₹79,999   | **₹2,19,999** | ₹219.99          | 13% → **37.1%** |
| `COLLEGE_ANNUAL_250`    | ₹44,999   | **₹1,19,999** | ₹479.99          | 18% → **47.2%** |
| `COLLEGE_ANNUAL_1000`   | ₹1,39,999 | **₹3,79,999** | ₹379.99          | 14% → **37.4%** |

~2.7x across the board. That is not a price rise; it is the first list being
wrong about what it was selling.

- **`PLACEHOLDER_PRICING` is still `True`.** These still need sign-off. They
  are now wrong in a direction that costs a deal rather than the business.
- **Ex-tax on both sides.** Candidate prices are inclusive, business prices
  exclusive, so the raw numbers are not comparable — comparing them directly
  flatters a seat by 18%. `GST_RATE` is now a constant in the catalogue rather
  than something applied only at the invoice, because that comparison became a
  revenue decision rather than a presentational one.
- **`MIN_SEAT_SHARE_OF_DIRECT = 0.35`** with
  `test_a_seat_never_undercuts_direct_candidate_revenue`, so this cannot drift
  back by increments. Verified against all four old prices: every one is
  caught. A companion test asserts every college period has a candidate plan of
  the same duration to price against — without it the floor silently skips.

### The engineering consequence, recorded before Day 15 builds it

A seated student pays us nothing and must still get in, so
**`require_active_subscription` is a check with two limbs**: a personal
subscription **OR** an active college seat. It is still a stub, which is why
this answer arriving now rather than on Day 15 is worth something.

`college_seats` is therefore an **entitlement row, not an allowance counter**.
Withdrawing a seat is an access change, not an administrative one, and
`seats_used` being off by one is either a student locked out of something
bought for them or a student we carry free. Both `deps.py` and
`college/models.py` now say so at the point someone will read them.

It also raises the stakes on an older open question — what happens at the 501st
student on a 500-seat plan. Over-allocating no longer over-serves a seat; it
gives away a full subscription.

### Three things the answer opens, none blocking

Consequences, not restatements. All three need answering before the first
college contract, and none of them stops the build:

1. **A student who already paid, then joins a roster.** Refund, credit, or
   their subscription simply runs alongside? We are building the third — no
   money moves without a human — but someone who paid ₹1,199 in June and is
   seated free in July will ask.
2. **Non-renewal.** Students lose access in batches of 250 or 1000, on a date
   known in advance. That wants a deliberate grace period, not a hard cutoff
   discovered live.
3. **Do add-ons ride along?** Our assumption: a seat covers the **subscription
   only**; the course (+30) and interview sessions (+60) stay the student's own
   purchase. Otherwise a 1000-seat deal silently includes ~₹8.5 lakh of add-on
   inventory. Flagged rather than assumed.

Full detail: `answers-log.md` Round 8.

---

## 2026-09-12 (later) — Day 7: versions, review, the confirm gate

**905 -> 954 tests.** Four endpoints, one new import-linter contract, and the
half of SRS 1.4.4 that had to be built before Day 8 could be trusted.

### The confirm gate is enforced three times, on purpose

SRS 1.4.4 says an unconfirmed version can never reach scoring. Scoring is Day
8, so a gate written as a service function and nothing else would be a
convention waiting to be forgotten by the first caller who did not know it
existed. So it is enforced at three levels, and each catches a different
mistake:

1. **A SQL predicate.** `latest_confirmed_version` filters
   `confirmed_at IS NOT NULL` in the query, so the unconfirmed row is never
   loaded at all. A Python check after the fetch can be skipped by the next
   caller; a row that was never selected cannot.
2. **A new import-linter contract**, `resume-internals-are-private`. This was
   a real gap: `module-privacy` only protected `identity`, so any module could
   have imported `resume.repository` and reached `list_versions`, which
   returns unconfirmed rows quite correctly for the review screen. Verified by
   adding a deliberate import to `scoring/service.py` and confirming it breaks.
3. **A build tripwire for the Day 8 mistake.**
   `test_scoring_is_not_wired_to_the_version_created_event`.

### The third one is the one worth reading

`resume.version_created` is the obvious event to recalculate a score from — it
fires whenever a resume changes, which sounds exactly right. It also fires on
every **unconfirmed** parse and every **unconfirmed** correction, so
subscribing to it bypasses the gate completely **while every other test in the
suite still passes**, because the gate function is intact and simply never
called.

Confirming therefore emits its own event, `resume.version_confirmed`, and that
is the one scoring consumes. The tripwire fails the build if anything under
`app/modules/scoring/` so much as mentions the creation event. Both tripwires
were verified by breaking them deliberately and watching them fire.

### Decisions taken inside that work

- **The chain cannot fork, and the database is what says so.** A unique index
  on `supersedes_id` (partial, `WHERE NOT NULL`, so the many chain heads are
  unaffected) means at most one version supersedes any parent. The service
  also returns a 409, but two concurrent edits would both read "not yet
  superseded" and both write — the service check is for the error message,
  the index is for the guarantee. `IntegrityError` is translated into the same
  409 so a client sees one behaviour rather than a 409 or a 500 depending on
  timing.
- **`confirmed_at` is a latch, not an assignment.** `confirmed_at IS NULL` in
  the WHERE clause of a conditional UPDATE. Confirming twice is a retry that
  returns the _original_ timestamp: when a candidate took responsibility for
  scored content is a fact about them, not about how many times their phone
  lost signal. It is also the one permitted mutation of a version — content
  stays immutable, and there is still no update path for `parsed`.
- **An edit never inherits confirmation.** This is the side door the gate
  exists to close: if a correction carried the confirmation forward, editing
  would be a way to change scored content with nobody reviewing it. A
  correction is unconfirmed and goes back through review.
- **A superseded version is closed to both editing and confirming.** One pure
  predicate, two callers, so they cannot drift. Confirming a replaced version
  would make content the candidate has moved on from scorable, because the
  gate asks whether a version is confirmed, not whether it is current.
- **The last confirmed version stays scorable while a correction is in
  progress.** A candidate who starts an edit and abandons it half way still
  has the resume they approved.
- **`EDIT` is a version source, not a flag.** "Did a human assert this
  content?" is the question integrity review and score provenance both ask,
  and as a source it is one column rather than a walk up `supersedes_id`.
- **Edit provenance keeps the origin flat.** The obvious implementation nests
  the previous extractor, so a candidate who tidies their CV thirty times
  stores thirty levels of JSON and a replay has to recurse to find which
  engine read the document. Instead `origin` holds the machine extraction the
  chain started from, copied forward unchanged, and `edit_generation` counts
  the corrections — so both questions a replay asks stay one lookup deep. A
  test runs thirty generations.
- **An edit is a whole replacement, not a patch.** The merge rule for a
  partial update — what happens to an employment row the candidate deleted, or
  one the parser invented — is exactly the thing nobody would agree on later.
  `extractor` is rebuilt rather than accepted, so a client cannot post an edit
  claiming its text came from the parser.

### Polling: the 202 now leads somewhere

`resume_files` gained `parse_status` and `parse_error_code`. Before this, the
only observable signal was whether a version existed, which **cannot tell
_waiting_ apart from _never going to work_** — a CV we cannot read left the
client polling an endpoint that would never change and never say why.

- **There is deliberately no RUNNING state**, and a test says so rather than
  leaving it to be added. A worker that claims a file and dies leaves RUNNING
  behind with nothing to sweep it, so the state that exists to reassure the
  candidate becomes the one that strands them. QUEUED means "not finished" and
  redelivery fixes it by itself.
- **BLOCKED and FAILED are different advice.** A file the scanner holds may be
  perfectly readable; telling the candidate to re-upload it sends them round a
  loop that ends the same way.
- **A missing object is a parse failure, not a scan one.** It used to be
  recorded on `scan_status`, which read later as "the scanner failed" — two
  different facts in one column, and the wrong one.
- A CHECK constraint holds `parse_status = FAILED` and `parse_error_code IS
NOT NULL` in step, so a FAILED that says nothing and a DONE still carrying
  the last attempt's error are both impossible.
- Completing an upload is idempotent, so it now reports the row's real parse
  state rather than a hardcoded QUEUED — a client retrying after the worker
  ran was being told to poll for work already finished.

### Found while building

- **A test that fed in an unreadable PDF was calling AWS.** Correct parser
  behaviour — an unreadable PDF is exactly what the OCR fallback is for — but
  it made the test depend on credentials, the network and Textract's account
  state, and it would bill per page if it ever succeeded. It "passed" only
  because this account still returns `SubscriptionRequiredException`. Pinned
  to the local parser with a fixture at the `get_resume_parser` seam. **Worth
  remembering for Day 8:** anything that feeds a deliberately bad document
  into the parse chain reaches for Textract unless it is pinned.
- **Every source still requires confirmation, including MANUAL.** The argument
  for exempting it is real — the candidate typed it themselves, so there is
  nothing extracted to review. It is not exempted anyway: one gate with no
  exceptions is testable, and the confirm step is also the moment the
  candidate accepts that a number will be attached to this.

---

## 2026-09-12 — Dishonest-CV rules, and the Round 7.10 content

Two client instructions, both of the form _"use your best knowledge"_:
Round 7.6 (integrity rules) and Round 7.10 (course, prices, question banks,
translations, SMS copy, design, form fields). **905 tests, up from 738.**

### Integrity — the rules that decide who gets hidden from search

`integrity/domain.py`, 40 tests. Eight rules, and the design is the _severity_
rather than the detection: HIGH suppresses a candidate from employer search
**before a human has looked**, so it is reserved for the two things that cannot
be an accident or a bad parse — instructions aimed at an automated reader, and
text deliberately hidden from a human one. Everything else is MEDIUM or LOW and
reaches a reviewer with the candidate still visible. A test pins that:
`test_only_the_two_deliberate_rules_can_ever_reach_high`.

**The prompt-injection patterns match imperatives, never nouns.** An AI
engineer's CV legitimately says "system prompt" and "prompt injection"; matching
those would suppress the best-qualified applicants for exactly the roles this
marketplace sells. `AI_ENGINEER_CV` in the tests is six real sentences that must
never fire.

Roughly half the tests assert a rule stays _quiet_ — notice-period overlaps, a
mistyped year, a forgotten early job, an employment gap. Deliberately no rule
for gaps, for work predating a qualification (age reasoning, invariant 5), or
for cross-candidate duplicates (dropped by the client, R6).

New contract in `.importlinter`: **integrity must not import scoring** (SRS
1.4.5). Signals never move a number.

### Content — all of it placeholder, all of it flagged as such

| Produced                                                                       | Where                                         | Marker                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------ |
| Price list — 4 candidate periods, 3 employer, 4 college seat tiers, 2 one-offs | `subscriptions/catalogue.py`                  | `PLACEHOLDER_PRICING = True`                     |
| Course syllabus — 6 modules, 18 lessons, ~2h20                                 | `courses/catalogue.py`                        | `HAS_MEDIA = False`, every `asset_key` is `None` |
| Questionnaire — 12 questions, 4 sections                                       | `questionnaire/bank.py`                       | `BANK_VERSION`                                   |
| Interview — 3 sets × 6 questions, 5-dimension rubric                           | `interview/bank.py`                           | `BANK_VERSION`                                   |
| Messages — 21 templates, 17 of them SMS                                        | `notifications/templates.py`                  | every `dlt_template_id` is `None`                |
| Translations — 8 locales × 32 keys                                             | `app/core/i18n/`                              | native review still owed                         |
| KYB and college forms — 27 and 20 fields                                       | `kyb/forms.py`, `college/forms.py`            | `FORM_VERSION`                                   |
| Design system + tokens                                                         | `docs/design-system.md`, `design-tokens.json` | no logo, C7 stays open                           |

Each marker is asserted by a test, so "this is still ours, not the client's"
survives a demo rather than living in a comment nobody reads.

### Decisions taken inside that work, worth knowing

- **The score is never drawn as a red-to-green gauge** (`design-system.md` §1).
  That picture is the visual language of an Indian bureau score, and it would
  undo in one screen what `check_vocabulary.py` protects in words. Recorded as
  data in `design-tokens.json → score.forbiddenForms` so a front-end can lint it.
- **Noto Sans per script.** Eight locales span six writing systems; a
  Latin-only typeface renders tofu on a user's first screen in their own
  language.
- **SMS is budgeted against 70 characters, not 160.** One non-GSM character
  switches the whole message to UCS-2 — which every Indian-language translation
  is. A test holds the English source under 130.
- **Interview feedback carries no points.** A completed session is +20 whether
  it went well or badly. Grading it would add a second unexplained hidden
  judgment underneath the first one.
- **The course syllabus never names a weight, band or cap** — tested. A course
  that taught the rubric would inflate every score without improving anyone.
- **The rubric never assesses accent, fluency, pace or pitch** — tested. In this
  market those measure schooling and region.
- **Consumer prices tax-inclusive, business prices exclusive.** Backwards, that
  is an 18% error found at the first GST filing.

### Found while building

- **E5 — hidden text is not extracted yet.** The rule is written and inert:
  `ResumeClaims.hidden_text` defaults to empty, so it never fires on a field
  nothing fills. Populating it needs a pypdf visitor reading font colour and
  size. Until then the most-documented CV gaming technique is undetected.
- **An open commercial question nobody has asked**: when a college buys seats,
  does the student still pay their own subscription? Both are priced as if the
  answer is yes, and if it is no the college price is far too low. See
  `blockers.md` C12.

---

## 2026-09-11 (later) — Day 5, Week 1 gate

### Built

- `tests/unit/test_permission_matrix.py` — role x guard matrix over all **10**
  roles (SRS 1.2; note the plan's prose says nine). Calls the dependency
  callables directly with a constructed `TenantContext`, so 10x10 coverage costs
  no database round trips. Also asserts `require_role` rejects an unknown role at
  _import_ time, so a typo fails the build rather than silently admitting nobody.
- `tests/invariants/test_route_authorisation.py` — drives every documented route
  with no `Authorization` header and asserts 401/403 unless explicitly
  allowlisted, with the reason recorded beside each exemption.

121 -> 160 tests.

### Two judgement calls worth knowing

**The route guard asks the app, it does not read its dependency tree.** The
structural version needs FastAPI internals (`_IncludedRouter`,
`_EffectiveRouteContext`) that changed in this version and will change again —
and it only proves a guard is _declared_. Driving the route proves the request is
actually refused. Verified by adding a deliberately unguarded route and
confirming the test names it.

**Known limit, stated rather than hidden:** routes with
`include_in_schema=False` are invisible to it. Today that is only `/`, asserted
separately.

### Day 5 is partial, not done

The gate has four parts. Permission matrix, no-anonymous-access and the
audit/revocation tests are green. **Cross-tenant is proven at the database layer
only** (`test_rls_and_grants.py`), because the plan's "every tenant-scoped
endpoint" cannot be tested against five endpoints — the rest are Week 2. The
harness is in place; the HTTP-layer suite lands with the endpoints.

---

## 2026-09-11 — Day 3/4 auth chain, and AWS

### Built

The identity spine (`PR #2`, `#3`, `#4`):

- `app/core/auth/` — pluggable `IdentityProvider`. `cognito.py` verifies RS256
  against pool JWKS **with the algorithm pinned**; `local.py` is a dev-only
  provider behind `AUTH_ALLOW_LOCAL_TOKENS`.
- `membership.py` — role and tenant from our `memberships` table, cached 60s in
  Redis. Never from token claims.
- `core/cache.py`, `core/ratelimit.py` — Redis lifecycle, fixed-window limiter.
- identity module router/service/repository/schemas; `test_auth_chain.py` (18 tests).

### AWS — applied and verified

Account `592033927084`, `ap-south-1`. 38 resources via `infra/terraform`.

| Resource               | ID                                                                            |
| ---------------------- | ----------------------------------------------------------------------------- |
| Cognito candidate pool | `ap-south-1_afBHHXfyH`                                                        |
| Cognito business pool  | `ap-south-1_w1u6W6fTP` (MFA required, admin-create only)                      |
| S3                     | 6 buckets, `bharatpath-<name>-dev-592033927084`, private + AES256 + versioned |
| SQS                    | `bharatpath-tasks-dev` + DLQ                                                  |
| IAM                    | `bharatpath-app-dev`, least-privilege                                         |

Verified rather than assumed: the **production** `cognito.py` path fetched live
JWKS from both pools and correctly rejected an `alg=none` forgery. App IAM
credentials were tested in both directions — S3/SQS succeed, bucket creation and
IAM listing are denied.

Deliberately **not** provisioned: RDS, ElastiCache, VPC/NAT, ECS. Those bill at
idle and are Day 20 concerns. Postgres and Redis stay in docker/CI.

### Four bugs CI caught that local checks had hidden

Worth reading before trusting a green local run:

1. **`pool: str` + hand-rolled validator** when `Pool` Literal existed, forcing a
   **malformed** `type: ignore`. mypy had never been run.
2. **`Routers never touch repositories`** forbade `router → service → repository`
   — the exact layering it exists to enforce. It could only pass on a module whose
   service does no persistence. Fixed with `allow_indirect_imports`, then verified
   it _still_ breaks on a direct import.
3. **CI died in the migrations step**: the new `Settings` validator demands an auth
   mechanism, and CI set none. Invisible locally because `backend/.env` sets it and
   CI has no `.env`.
4. **`ModuleNotFoundError: No module named 'tests'`** — CI runs `pytest`; running
   `python -m pytest` puts cwd on `sys.path` and hid it. Fixed by making `tests` a
   real package.

**Lesson worth keeping: run the CI command, not your habitual one.**

---

## Earlier

- **Day 2** (2026-08-30) — baseline schema, RLS, append-only audit grants,
  idempotency, outbox, OpenAPI stub publish. 40 tables, 12 RLS policies.
- **Day 1** (2026-08-30) — scaffold, CI, 20 module skeletons, invariants 5 and 6.
