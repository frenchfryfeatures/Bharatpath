# Bug-fix and enhancement round — 2026-11-23

Branch `Rishabh/BugResolution001`. Nothing committed or deployed. Numbering
follows the 31-item list (the earlier 33-item list's "Indigo blocks" and
"BharatPath avatar" were skipped by instruction).

**Verification.** The full backend suite completed against local Docker
Postgres on 5433 with a temporary Windows selector-loop runner: **3,612 pass,
22 inherited failures, 3 contract cases deselected**. Both client TypeScript
checks pass. Web: **72 pass / 2 inherited failures**, including all **9 new
regression tests passing**; eslint has no errors. Mobile: **25 script files
pass / 5 inherited failures**. Exact commands, static-check failures and
baseline comparisons are in sections H and I.

No device/emulator/UAT/production verification or deployment. The local
browser was checked, but the available account redirects to incomplete
onboarding; authenticated resume viewers, Edit resume, Add-ons and application
detail still need visual QA. No account details were changed to bypass it.

The 22 backend failures comprise **5 unit, 11 invariant and 6 integration**
cases. The earlier handoff omitted three integration failures; those three
and the five unit failures were reproduced on clean HEAD. The other failures
match the supplied baseline list. No failures were introduced by the web
follow-up. The existing vocabulary hit, selected-file ruff/format failures,
89 mypy errors, add-on/scoring import contract and API-guide gaps remain
explicitly recorded below rather than being hidden or weakened.

## Status by task

| # | Task | Status | Root cause | What changed | Tested |
|---|---|---|---|---|---|
| 1 | App opens on Notifications | Done (device test pending) | `PushNotificationBridge` pushed `/notifications` for *any* "last notification response". Android replays the last tap on cold start and `clearLastNotificationResponseAsync` does not reliably clear it; the bridge also re-ran on every sign-in | Each tap handled once (identifier remembered), only real body taps, launch response checked once per process, stale (>24h) ignored; taps open the message's destination (see 19) | tsc; push-registration test. Needs a device |
| 2 | "Number" → Bharatpath Score | Done | Score screens said "the number" | Score reveal, scoring wait screen, share-card toggle. Kept the existing spelling **"Bharatpath Score"** (167 uses) rather than introduce "BharatPath Score" — say if you want the whole product respelt | tsc |
| 3 | Job apply | Done | Double-submit guard read React state captured in the closure, so two fast taps both sent; nothing told other mounted screens | Ref-based guard; every apply/withdraw/confirm/dispute publishes the server's response on an app-wide bus | tsc; job-application-flow test |
| 4 | Resume pre-fill loading | Done (sign-up) | Fields stayed editable while the CV was read; no request token (CV A's late answer could overwrite CV B's); a failed read was silently logged | The five CV-filled fields lock and show a pulsing skeleton; only the newest CV's answer lands; a new CV replaces only values the previous CV filled, never typed ones; failure shows an error with **Try again** | tsc; cjs suite. Needs a device |
| 5 | Mobile responsiveness | Partial | Password-rule rows had no `flexShrink`, so long rules ran past the card; auth inputs had a fixed 52 px height, clipping at large font sizes | Wrapping fixed on sign-up and change-password; auth inputs use `minHeight`. Suggestion lists render inline (never a floating dropdown under the keyboard/nav bar). **A full audit of every screen on real devices was not possible here** | tsc |
| 6 | City dropdown | Done | No city source for candidates; a curated Indian city catalogue existed but only for employers | New public `GET /reference/cities` over the same staff-curated catalogue (old names match: "Bombay" → Mumbai). Suggestions under city fields: mobile sign-up, profile form and conversational step; web sign-up and career form. Free text still allowed | Integration test; tsc both apps |
| 7 | Notifications after email verification | Done (device test pending) | Same as 1: the bridge re-ran when the user became signed in | Same fix as 1 | Needs a device |
| 8 | Mobile number lost on Back | Done | Sign Up kept typed values in its own state and only reported them on submit; Back unmounted it | Sign Up reports its draft (never passwords) to the flow, which restores it; cleared on log-out/log-in | tsc; cjs suite |
| 9 | Courses/specializations missing on UAT | Code done; **UAT/PROD run needs your approval** | Migration `0025` only creates the tables; the data comes from `seed_education_taxonomy.py`, which nothing ran automatically and which refuses remote DBs; `backend/data/` (the CSV) was shipped by neither `ship.sh` nor the Dockerfile. Same gap for the job taxonomy | `--seed-only` flag (catalogue rows only, never profiles); `data/` shipped and copied into the image; both seeders run in the deploy's `migrate` step and in `reset_local_db.sh`. Idempotent, never deletes, never resurrects a staff-deleted row | Scripts parse; compose validates. **Not run against UAT/PROD** |
| 10 | "Choose a Length" | Done | — | → "Choose Your Path" (web) / "CHOOSE YOUR PATH" (mobile eyebrow) | tsc |
| 11 | Save on cards | Partial | **No "save job" feature exists in any layer.** The only card Save — the score share card — showed "Result Saved" and saved nothing; Share also ignored the "show exact score" toggle and always shared the exact number | Share and Save now respect the toggle; Save hands the result to the phone's own sheet instead of claiming a save. **Saving the card as an image needs `react-native-view-shot` + `expo-media-library` and a new build — your call.** If "Save" meant bookmarking jobs, that is a new feature (table, API, UI) to scope | tsc |
| 12 | Personalized job engine | Done | The old matcher added flat points (skill 3, title 4, place 2, experience 1) | Weighted 9-dimension engine — see the section below | 14 unit + 15 integration tests |
| 13 | Uploaded resume changes format | Done | Preview and download used `/render`, which re-typesets the CV into one of our templates | Preview uses the original PDF's own pages (`/preview`); download uses the original file in its own format (`/document`, now also returning `mime` and `filename`). The rendered layout is used only for typed/pasted/built versions or a Word file we cannot draw. Mobile and web | tsc both apps |
| 14 | Download opens Share | Done (device test pending) | Download always called `Sharing.shareAsync` | Android saves into a folder the user picks once (Downloads offered, remembered); iOS opens "Save to Files" titled as a save. Builder download uses the same helper | tsc; resume-resilience test |
| 15 | Score ↔ resume details sync | Done | Resume Details loaded once on mount, so after a re-score or an edit elsewhere it kept the old version | Reloads on every visit and after each scoring run, without flashing the loader | tsc |
| 16 | Resume Builder cancel | Done (mobile) | Back walked through every section; no way to abandon a session's edits | Header Cancel: no changes → leave; changes → Keep editing / Save and exit / Discard. Discard restores the draft as the session found it; a pushed resume is a separate version and is never touched. Web keeps its existing save-and-back | tsc |
| 17 | Job search | Done | `q` read only title and description | Every word must appear in title, description, location, a skill, or the employer's name (read under the candidate's own policy) | Integration tests |
| 18 | Skills dropdown in filters | Done | Candidate filter had no skill source at all | `GET /candidate/jobs/skills`: skills live jobs ask for, most asked-for first, labels only. Mobile pills / web datalist | Integration tests; tsc |
| 19 | Notification navigation | Done | Routing by template guessed, sent employer interview invites to *mock* interviews and profile reminders to the quiz; push carried no destination | Server decides `destination` `{kind, id}` from the template and the source event's ids; on inbox items and push data. App opens the application, job, interview report, subscription, profile or streak; old rows fall back by template. Ids validated as UUIDs | 9 unit tests; tsc |
| 20 | Someone else's resume | Done | Logged-in prefill saved the CV's name as the account name (shown to employers) and its phone as the contact | The automatic prefill never supplies name or phone. Sign-up warns when the CV names someone else and changes nothing the person typed | Unit suite; tsc |
| 21 | "Opened" wording | Done, narrowly | The only job-status "opened" means the **employer** opened the profile; renaming it "Opened by You" would be false | Short label clarified to "Opened by employer". Nothing in the app labels a job the candidate opened | tsc |
| 22 | End-of-day push | Done (live push untested) | — | `notifications.daily_reminder` on Beat, 20:00–22:30 IST every 30 min; candidates with an active push device who have not opened the app on today's IST day; respects push and reminder opt-outs and suppressions; one per person per day by dedupe key; reuses the in-app → push pipeline; opens the streak screen. Six-language copy (flagged for native review like the rest) | Unit tests; beat schedule test |
| 23 | Profile completion % | Done | Mobile strength counted optional `headline` and `photo`; web divided by every field, optional and inapplicable ones included | Both count required, applicable items only; optional ones remain suggestions marked "(optional)" | Unit tests; tsc |
| 24 | Courses refresh | Done | — | Refresh button; pull-to-refresh spinner fixed (it never showed); silent refetch on every visit | tsc |
| 25 | Auto refresh / state sync | Done on both clients; browser QA pending | Screens under the job detail only learned of an application on next focus; focus refetches flashed full loaders | App-wide application bus patched into Jobs, Board, Home carousel, assistant; silent focus refetches; server response is the only source. Web: both API slices refetch on focus/reconnect and after a 30-second stale mount; accumulated student feeds explicitly refresh their first page while retaining visible results | tsc; cjs suite |
| 26 | Mock interview | Code fixed; **config needs your action** | (a) Hosts default to `INTERVIEW_TRANSCRIPTION_PROVIDER=none` and `INTERVIEW_EVALUATION_PROVIDER=none`, so reports stay PENDING forever; (b) meanwhile the app **invented** a report on the device with fixed STRONG/DEVELOPING levels | Fabricated report removed; honest "being prepared" state that checks for ~10 min and on demand. Set `INTERVIEW_TRANSCRIPTION_PROVIDER=sarvam` (+`SARVAM_API_KEY`) and `INTERVIEW_EVALUATION_PROVIDER=openai` on UAT then PROD | tsc |
| 27 | Consecutive course completion | Done | Server marks a lesson watched only at 90% reached **and** half its length since first opened (it adds to the score). The detail screen never reported opening a lesson, so the first Complete press could never count, and it skipped ahead regardless | Opening a lesson starts the clock; Complete moves on only when the server agrees, otherwise "Keep watching"; one request at a time. The server rule is unchanged | tsc |
| 28 | Page loaders | Partial | — | Skeletons/loaders added where this round touched (sign-up fields, skill options, courses, interview report, recommendations); focus refetches no longer flash. No blanket app-wide pass | tsc |
| 29 | Leaderboard | **Blocked** | No leaderboard exists anywhere. Ranking people by Bharatpath Score publicly is a privacy and product decision (scores are masked even from employers) | Nothing built | — |
| 30 | Streak "Check In" → "Login" | Done | — | Button and nearby copy on mobile; web status label. Streak logic untouched | tsc |
| 31 | Logout | Done | Offline push-unregister could hang logout forever; a failed sign-out could leave state; `replace` left authenticated screens under the sign-in screen; three sign-out buttons never navigated | 4 s cap on unregister; local state always cleared; stack dismissed then login; one `useLogout` used everywhere; app context resets on account change | tsc; cjs suite |

## A. Files

**Backend** — `jobs/{domain,service,repository,router,schemas}.py`,
`candidate/{career,career_service,router}.py`,
`notifications/{domain,service,repository,schemas,push,templates}.py`,
`engagement/{service,repository}.py`, `profile_insights/domain.py`,
`discovery/{__init__,router}.py`, `resume/{service,router}.py`,
`applications/service.py` (`application_id` on event payloads),
`core/i18n/locales/{en,hi,bn,kn,mr,pa}.json`, new `tasks/daily_reminders.py`,
`tasks/{schedule,routing}.py`.
**Scripts / deploy** — `scripts/seed_{education,job}_taxonomy.py`,
`scripts/seed_config.py`, `scripts/reset_local_db.sh`,
`scripts/check_api_guide.py`, `backend/Dockerfile`, `deploy/ship.sh`,
`deploy/docker-compose.prod.yml`.
**Tests** — new `tests/unit/test_notification_destinations.py`,
`tests/integration/test_board_search_and_reference.py`; updated
`test_job_recommendations.py` (unit + integration), `test_profile_insights.py`,
`tests/invariants/test_route_authorisation.py` (one PUBLIC entry).
**Mobile** — new `services/{applicationEvents,notifications/destination,files/saveToDevice}.ts`,
`hooks/useLogout.ts`, `components/inputs/CitySuggestions.tsx`,
`components/feedback/FieldSkeleton.tsx`, `utils/matchReasons.ts`; changes in
the push bridge, auth/app contexts, sign-up, profile, jobs, board, courses,
interview report, resume, builder, share, streak and subscription screens;
three `.cjs` test stubs.
**Web** — `store/student/{student,resume}.api.ts`, job feed, job card,
recommended jobs, career overview/form, sign-up steps, subscription step,
streak utils; new `features/student/components/city-datalist.tsx`,
`features/student/jobs/match-reasons.ts`.
**Docs** — `docs/backend-guide/05-jobs-and-discovery-apis.md`, this file,
`docs/progress.md`.

## B. Database

No migration. One new config key, `jobs.match_weights`, seeded as version 1
by `seed_config.py`. One new notification template, `IN_APP_DAILY_REMINDER`.
Education and job taxonomy rows will be written on the next deploy's
`migrate` step (task 9). The profile **backfill** (linking old free-text
answers to the catalogue) is deliberately not automatic; run it on a host
only with approval: `python scripts/seed_education_taxonomy.py --allow-remote`
(and the job one) without `--seed-only`.

## C. API

New: `GET /candidate/jobs/skills`; `GET /reference/cities` (**public**, on the
allowlist with its reason). Changed, all additive: `GET /candidate/jobs` `q`
searches more fields; `GET /candidate/recommended-jobs/matching-profile`
takes `offset`, returns `next_offset` and per-item `match_reasons` (also on
similar-to-applied); inbox items carry `destination`; push data carries
`destination`; `GET /candidate/resume/versions/{id}/document` adds `mime`
and `filename`. `POST /candidate/profile/prefill/{id}` no longer sets the
account name or phone from the CV. Older clients ignore the new fields.

## D. The job engine

- **Where**: `jobs/domain.py` `score_job` (pure), called by
  `jobs/service.py` `_ranked` for both home sections, "see more" paging and
  the chat assistant's search.
- **Candidate side** (`candidate/career.py` `match_terms`): skills (synonyms
  folded: JS = JavaScript…), chosen role words, role words implied by two or
  more skills of a family (Python + FastAPI + PostgreSQL → backend, at half
  weight), places, experience, **preferred** salary (INR only, never
  converted), industry, education level, fresher. Never gender, age,
  college or current pay; never the threshold.
- **Job side** (`job_facts`): required and nice-to-have skills, title,
  description and responsibilities, location and work mode, experience
  range, salary max and period, industry, minimum education, job type.
- **Scoring**: each dimension 0–1; relevance = weighted mean over the
  dimensions **both sides fill** × a coverage factor ((used/total)^0.25), so
  empty optional fields neither penalise nor inflate. Weights (config):
  skills 25, role 15, experience 15, responsibilities 10, location 10,
  salary 10, education 5, industry 5, job type 5.
- **Eligibility and exclusions**: published, listed, not already applied to,
  sharing a skill or (chosen or implied) role word; inactive/closed jobs are
  never in the pool. One entry per job.
- **Explanations**: reason codes, worded on the client; no number leaves
  the server.
- **Performance**: the DB narrows to the newest 300 matching jobs on an
  index-friendly predicate; ranking 300 rows in Python is milliseconds. No
  cache: rankings are recomputed per request, so a profile or job change
  shows immediately and there is nothing to invalidate. Add a Redis cache
  keyed on (user, profile `updated_at`, newest job change) when job volume
  makes it worth it.
- **Not yet**: the main job feed is still newest-first (personal ranking is
  on the home sections and their "see more"). Work-mode and job-type
  preferences are now implemented (section G); company type is not recorded
  on jobs and remains outside the form.
- **Field-list decision**: `MatchTerms` gained preference fields. The repo
  calls that a product decision; this list made it. Gender, age and current
  pay stay out and remain tested.

## E. Remaining

1. Device testing on Android (several sizes) and iOS for 1, 4, 5, 7, 8, 14, 16, 22.
2. Task 9 on UAT then PROD (deploy), and the optional backfill.
3. Task 26 provider keys on UAT then PROD.
4. Task 11: decide image capture for the share card; scope "saved jobs" if that was meant.
5. Task 29: decide whether a leaderboard should exist and what it may show.
6. Task 5/28: a full responsive and loader pass with real devices.
7. Pre-existing failing tests and the broken import contract listed at the top.

## F. Deploying

Local: `cd backend && bash scripts/reset_local_db.sh` (destroys local data)
or just `python scripts/seed_education_taxonomy.py --seed-only` and the job
one. Then `bash scripts/dev_all.sh`.

UAT (approval first): `cd infra/terraform && terraform workspace show`
(expect `uat`), then from the repo root
`BP_SSH_KEY=~/.ssh/bharatpath_ed25519 bash deploy/ship.sh 13.235.1.169`.
The `migrate` service runs alembic, the config seed (adds
`jobs.match_weights`) and both taxonomy seeds. Check the education and
role dropdowns, then set the interview providers in the host `.env` and
re-`up`.

Production: the same with `43.204.56.60`, after UAT sign-off. Mobile changes
need a new EAS build; web deploys with the frontend's usual pipeline.

## G. Follow-up: the Job preferences screen

A **Job preferences** entry in the profile opens its own screen: on web an
action card on the profile page leading to `/student/profile/preferences`
(with "Back to profile"); on mobile a "Job preferences" row under MY
INFORMATION on the You screen leading to `/job-preferences`. Open once the
profile is complete. (A Profile | Job preferences toggle was tried first and
removed at your request.)

**Why it failed to load**: both apps were pointed at the deployed servers
(mobile `.env` = production, `.env.local` = UAT), where
`/candidate/profile/preferences` answers 404 -- the endpoints exist only on
this branch. Mobile now offers a retry for a 404 instead of claiming the feature requires
an app update. Its `.env.local` now points to the local API at
`http://192.168.1.10:8099/api/v1` for testing. UAT/production still need a
backend deployment; none was performed.

- **Asks**: preferred roles and industries (searchable dropdowns of the full
  job taxonomy), work mode, job type, preferred work locations (with the city
  suggestions), open to relocating, preferred annual salary and currency.
  Multi-answer fields add each dropdown pick as a removable chip, as
  onboarding's locations field does. Built from onboarding's own components
  (`Field`, `fieldClass`, `AppSelect`, `PillButton` on web; `DropdownSelect`
  and CareerDetailsScreen's field styles on mobile).
- **Backend**: `GET`/`PUT /candidate/profile/preferences`,
  `GET /candidate/profile/preferences/options`. Stored in
  `career.preferences`, carried through every save of the onboarding form;
  locations and salary stay in the details (one copy). No migration.
- **Engine**: preferred roles and industries lead the terms; work mode joins
  the location-and-work-mode dimension, job type the job-type dimension,
  relocation softens a non-preferred place to half. New reasons
  `WORK_MODE_MATCH`, `JOB_TYPE_MATCH`. No new dimension, so the weights row
  keeps its shape. An empty tab ranks exactly as before (tested).
- **Not asked**: company type (jobs do not record one) and anything about
  who someone is.
- **Tests**: 9 unit, 4 integration. **Not checked in a browser or on a
  device** -- the web portal signs in through Cognito.


## H. Web parity follow-up (2026-11-23)

No commit, push, infrastructure change, or deployment. The existing styles and
components were retained.

1. **Notifications**: `features/notifications/types/notification.types.ts` and
   `store/api/notification-api.ts` consume the server destination. APPLICATION
   opens `/student/board/{id}` (board without an id); APPLICATIONS opens board;
   JOB opens `/student/jobs/{id}`; INTERVIEW_REPORT opens
   `/student/interview/{id}/feedback`; SUBSCRIPTION, PROFILE and STREAK open
   their student routes; INBOX does not navigate. Old shortlist rows retain
   `/student/invites`; KYB/staff rows retain their business routes. Checked
   against the actual route files. Destination ids are URL-encoded.
2. **Search and background refresh**: `lib/pagination/use-cursor-load-more.ts`
   exposes `isRefreshing` and `refresh`, with opt-in retention of prior data.
   Jobs show a small search spinner and dim the existing grid. Jobs, board
   and invitations reload the first page on focus/reconnect/visibility return.
   A response from an obsolete search or pagination request cannot replace or
   append to the newer result. Pagination is blocked while the first page is
   refreshing; failed refreshes retain old cards and offer retry. Other hook
   callers retain their default loading behavior.
3. **Refresh on return**: both `createApi` slices (`baseApi`, `notificationApi`)
   enable focus/reconnect refresh and refetch after a mount when data is at
   least 30 seconds old. `store/provider.tsx` already registered and cleaned
   up `setupListeners`; it was verified rather than duplicated. The Skill
   courses header has a disabled/spinning Refresh button. Background errors
   retain course and recommendation data instead of replacing it with an
   error screen. Existing student loading checks use `isLoading`, not
   `isFetching`, so a refetch keeps content visible.
4. **Course completion**: `app/(portal)/student/courses/[courseId]/page.tsx`
   reports the initial position when a lesson opens, then serializes opening,
   periodic progress and Complete requests. Repeated Complete clicks cannot
   enqueue duplicates. The automatic next lesson is selected only after
   `completed: true`; otherwise the page asks the candidate to keep watching.
   Progress is refetched after a completion attempt. The YouTube player no
   longer remounts on each progress refetch. The server still requires at
   least 90% reached and half the lesson duration elapsed since first open;
   no backend completion or score rule was changed.
5. **Build resume**: `features/student/profile/student-profile.tsx` reads the
   current version, passes `fromUpload` just like Edit resume, and keys the
   dialog by open state/current version. Uploaded CVs receive the template
   warning before the Builder flow.
6. **Sign-up prefill**: `onboarding/components/{account-steps,student-signup,ui}.tsx`
   lock and skeleton the five CV-filled fields while parsing. Success,
   failure and loading cleanup all check the selected file's request id.
   Replacing or removing a CV changes only fields the candidate has never
   typed into; blank answers from a replacement CV clear its old automatic
   values. A failed read offers Try again. A different name produces a
   visible notice without changing typed identity. The parent keeps a draft
   across flow/route remounts: text and field provenance in session storage,
   the selected file only in memory. An explicit allowlist excludes password
   and confirmation password from both. Logout clears the draft.
7. **Logout**: `student-app-shell.tsx`, `store/student/student.slice.ts`,
   `lib/auth/{token,refresh-session}.ts` and `profile/onboarding-draft.ts`
   clear both RTK caches, student UI state, auth/tenant, student browser
   storage and in-memory onboarding drafts. Remote sign-out is bounded to
   four seconds. A document `location.replace('/login')` also discards the
   Next client-router cache. Browser Back entries cannot be erased by a
   website: a restored portal document reloads/rechecks identity rather
   than reusing its previous store. An in-flight Cognito refresh cannot
   restore the token after logout or replace another account's token.

### Previously implemented surfaces included in verification

- Original-file viewers: `components/resume/original-resume-view.tsx`,
  employer resume showcase, college student detail and admin user detail.
  Uploaded PDFs use their original bytes; Word/missing/unreadable files use
  the structured fallback. The viewer now resets when the document identity or MIME changes. A new
  S3 signature for the same file keeps the displayed PDF alive while its
  refreshed bytes load; only replacing/unmounting it revokes its blob URL.
  This prevents showing a revoked/previous file after changing CVs without
  flashing the loader on a signature refresh.
- Candidate resume tiles stay read-only; **Edit resume** warns about uploaded
  formatting, selects a template, then opens the **Bharatpath Builder**.
- Web `/student/profile/addons` and mobile `/addons`; profile labels and
  application detail's complete job description under its action controls.
- **Skill courses banner rule**: the list's score-advantage / up-to-+30
  banner is shown only after successful loading and only while no course
  is purchased, on both clients. A later course must not appear to award
  another first-course reward. The separate mobile course-detail +30 copy
  remains an open decision and was not changed.
- Resume preview 500 fallback: mobile `previewResumeVersion` tries original
  pages, catches unavailable/500 previews, then requests the rendered pages.
  The fallback explicitly reports `original: false`.
- `backend/scripts/seed_demo_jobs.py` is local-only and replaces test-created
  published job text with realistic demo content, without changing job
  status, employer, thresholds or applications. Run after integration tests.

### Browser verification limit

The local Next server was opened at `http://localhost:3000`. The available
signed-in account was redirected from `/student/profile` to unfinished
`/signup/student` onboarding. No personal account details were altered to
bypass it. Original viewers, Edit resume, Add-ons and application descriptions
therefore remain **not visually verified in an authenticated browser**.
TypeScript, lint and deterministic behavior tests are recorded separately;
these are not claims of browser/device coverage.

### Decisions deliberately untouched

Leaderboard/privacy; saving the share card as an image (new native modules
and build); mobile course-detail +30 wording; UAT/production deployment,
taxonomy seeding there, and interview provider keys. Local verification
neither deploys nor resolves these decisions.


### Exact verification commands (Windows / local Docker database)

Run from `D:\Bharatpath` in PowerShell. The native PostgreSQL service owns
5432; Docker publishes **5433**. These URLs are the repository's local test
roles, not production credentials. Do not reset the database to run checks.

```powershell
$changed = @(git diff --name-only HEAD; git ls-files --others --exclude-standard) | Sort-Object -Unique
$pyChanged = @($changed | Where-Object { $_ -match '^backend/.*\.py$' } | ForEach-Object { $_.Substring(8) })
$webChanged = @($changed | Where-Object { $_ -match '^frontend/.*\.(ts|tsx|js|jsx|mjs|cjs)$' } | ForEach-Object { $_.Substring(9) })
$mobileChanged = @($changed | Where-Object { $_ -match '^mobile-app/.*\.(ts|tsx|js|jsx|mjs|cjs)$' } | ForEach-Object { $_.Substring(11) })

Push-Location backend
docker compose up -d postgres redis
$env:DATABASE_URL = 'postgresql+asyncpg://bharatpath_app:bharatpath_app@127.0.0.1:5433/bharatpath'
$env:DATABASE_URL_MIGRATOR = 'postgresql+asyncpg://bharatpath_migrator:bharatpath_migrator@127.0.0.1:5433/bharatpath'
$env:DATABASE_ADMIN_URL = 'postgresql+asyncpg://bharatpath_admin:bharatpath_admin@127.0.0.1:5433/bharatpath'
$env:REDIS_URL = 'redis://localhost:6379/0'
$env:ENVIRONMENT = 'local'
$env:AUTH_ALLOW_LOCAL_TOKENS = 'true'
$env:PAYMENTS_PROVIDER = 'stub'
$env:RATE_LIMIT_GLOBAL_ENABLED = 'false'
python scripts/check_no_age_fields.py
python scripts/check_vocabulary.py
ruff check @pyChanged
ruff format --check @pyChanged
mypy app
lint-imports
python scripts/check_api_guide.py
pytest -q
# After integration tests finish, restore realistic local published job text:
python scripts/seed_demo_jobs.py
Pop-Location

Push-Location mobile-app
npx tsc --noEmit
npx eslint @mobileChanged
Get-ChildItem tests/*.cjs | ForEach-Object { node $_.FullName }
Pop-Location

Push-Location frontend
npx tsc --noEmit -p .
npx eslint @webChanged
node --test tests/*.test.mjs
Pop-Location
```

For Git Bash, source the test environment first and explicitly fix **all
three** connection URLs before running the same backend checks:

```bash
cd backend
source .test-env.sh
export DATABASE_URL="${DATABASE_URL/localhost:5432/127.0.0.1:5433}"
export DATABASE_URL_MIGRATOR="${DATABASE_URL_MIGRATOR/localhost:5432/127.0.0.1:5433}"
export DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL/localhost:5432/127.0.0.1:5433}"
pytest -q
```

The first full pytest attempt stopped at collection because `schemathesis`
was not installed. Installed the existing dev dependency with
`python -m pip install 'schemathesis>=3.38'` (resolved to 4.34.0), then reran
bare `pytest -q`. The default `not contract` marker remains unchanged; the
contract module is still imported during collection.

Check logs are in `%TEMP%/bharatpath-20261123-checks/`, with full pytest output
in `%TEMP%/bharatpath-20261123-pytest.log`. The clean comparison snapshot is
`%TEMP%/bharatpath-20261123-checks/clean-head/`, exported from `git archive HEAD`
without changing the checkout. Its pytest subprocess used that backend as
`PYTHONPATH` solely to isolate imports for the baseline comparison; the real
working-tree checks above used ordinary bare pytest.

On this Windows/Python 3.13 host, the full `pytest -q` run stalled while
tearing down the asyncio Proactor loop after at least 648 cases. A process
stack from `py-spy dump --pid <pytest-pid>` showed the main thread in
`IocpProactor.close` / `Runner.close` / pytest-asyncio fixture teardown.
That process was stopped after it stopped making progress. The full retry
uses a temporary runner plugin, with no repository test or application
changes and no altered assertions:

```powershell
$checkDir = Join-Path $env:TEMP 'bharatpath-20261123-checks'
New-Item -ItemType Directory -Force -Path $checkDir | Out-Null
@'
import asyncio
import sys
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
'@ | Set-Content -LiteralPath (Join-Path $checkDir 'bp_selector_policy.py') -Encoding utf8
$env:PYTHONPATH = $checkDir
# From backend/, with the same test role/environment variables as above:
pytest -p bp_selector_policy -q
Remove-Item Env:PYTHONPATH
```

The policy override selects the selector event loop for the runner; it does
not relax the server's watched rule, RLS or any test. The retry's output is
`%TEMP%/bharatpath-20261123-pytest-selector.log`.


## I. Follow-up verification results and inherited failures

These results describe this checkout, not an all-green CI claim. No test was
weakened or deleted. All nine new web regression tests pass; their harness
controls asynchronous responses and tests component/hook behavior, not browser
layout or actual video playback.

| Check | Result |
| --- | --- |
| Web `tsc --noEmit -p .` | Pass |
| Web eslint over all changed/untracked source and test files | No errors; two inherited unused-code warnings (`hasAccess`, `ProfileViewsCard`) |
| Web `node --test tests/*.test.mjs` | 72 pass, 2 inherited failures; 9 new regression tests pass |
| Mobile `tsc --noEmit` | Pass |
| Mobile eslint over changed files | 6 inherited errors, 47 warnings: 3 unescaped JSX apostrophes and 3 CJS `__dirname` globals |
| Mobile `node tests/*.cjs`, each script run separately | 25 scripts pass, the same 5 fail |
| Backend no-age-fields check | Pass |
| Backend vocabulary check | One inherited `Loan Officer` taxonomy hit |
| Backend ruff on changed Python files | 18 inherited diagnostics in the selected files (the earlier report's 21 was a different scope) |
| Backend format check on changed Python files | 6 files would be reformatted; 36 already formatted |
| Backend `mypy app` | 89 inherited errors in 11 files, 305 files checked |
| Backend `lint-imports` | 11 contracts kept; inherited add-on/scoring contract broken |
| Backend API guide check | 50 inherited diagnostics: 11 missing checklist mappings and 39 undocumented routes, covering insights/taxonomy/education taxonomy and two resume routes |
| Full backend pytest | 3,612 pass, 22 inherited failures (6 integration / 11 invariant / 5 unit), 3 contract cases deselected; 19m32s |

### Exact failures to keep separate from this follow-up

- **Backend unit (confirmed on clean HEAD)**:
  `test_app_wiring::test_all_modules_registered`;
  `test_career_prefill_draft::test_a_phone_with_spaces_is_left_blank`;
  `test_career_profile::test_unemployed_experienced_candidate_completes_with_previous_job`;
  `test_career_profile::test_owner_scoped_resume_and_revision_without_scoring`;
  `test_hidden_text::test_hidden_text_is_found_and_says_why` for the
  `parked far to the right / OFF_PAGE` case. The clean snapshot run of these
  four files produced **77 pass, 5 fail**.
- **Previously reported integration**:
  `test_job_recommendations::test_jobs_that_fit_the_profile_best_first` and
  `test_resume_builder::test_a_built_resume_is_edited_in_the_builder_and_confirmed_after_paying`
  and `test_resume_builder::test_the_sql_stage_is_the_domain_rule`. The final full-run list below is
  authoritative for which ones reproduced in this environment.
- **Additional integration failures discovered by the complete run, also
  confirmed on clean HEAD**:
  `test_admin_candidate_page::test_saved_career_is_revealed_only_to_staff_and_the_read_is_audited[False]`
  and `[True]`, and
  `test_masked_search::test_a_visible_candidate_comes_back_as_a_masked_card`.
  All three fail on the unmodified snapshot as well as this checkout; they
  were missing from the handoff's shorter failure list.
- **Previously reported invariant families** (11 failures): admin console,
  erasure plan, vocabulary, access window, masked candidate,
  route authorisation (taxonomy/education-taxonomy unauthenticated routes),
  and schema guards. See the full-run list for exact case ids.
- **Mobile scripts**: `back-navigation.cjs`, `conversation-seeding.cjs`,
  `onboarding.cjs`, `signup-flow.cjs`, `validation-navigation.cjs`.
- **Additional inherited web tests**:
  `career-contract.test.mjs`'s web and mobile
  `preserves previous employment, currency and immediate joining` cases.
  Both expect `notice_period` to be hidden for an unemployed experienced
  candidate; both clients' **clean HEAD** implementations return visible.
  The direct clean-source comparison reproduces that exact failed assertion.
- **Mobile lint inheritance**: the same JSX errors reproduce using the clean
  HEAD versions of ForgotPasswordScreen, LoginScreen and StreakDetailScreen.
  `__dirname` is a valid Node CJS global in the three changed test scripts,
  but the existing eslint configuration does not declare it for CJS tests.
- **Import contract**: `courses -> billing -> interview -> resume -> scoring`
  and `interview -> resume -> scoring`; no new scoring import was added by
  this follow-up.

Detailed logs remain in the temporary check directory described above. Any
additional failure that cannot be reproduced on HEAD is called out explicitly
in the full-run result, rather than silently counted as inherited.


### Completed full-suite run

`pytest -p bp_selector_policy -q` exited 1 with:

```text
22 failed, 3612 passed, 3 deselected in 1172.38s (0:19:32)
```

No additional failure beyond the supplied baseline and the three clean-HEAD
integration reproductions was found. Exact failed case ids:

```text
tests/integration/test_admin_candidate_page.py::test_saved_career_is_revealed_only_to_staff_and_the_read_is_audited[False]
tests/integration/test_admin_candidate_page.py::test_saved_career_is_revealed_only_to_staff_and_the_read_is_audited[True]
tests/integration/test_job_recommendations.py::test_jobs_that_fit_the_profile_best_first
tests/integration/test_masked_search.py::test_a_visible_candidate_comes_back_as_a_masked_card
tests/integration/test_resume_builder.py::test_a_built_resume_is_edited_in_the_builder_and_confirmed_after_paying
tests/integration/test_resume_builder.py::test_the_sql_stage_is_the_domain_rule
tests/invariants/test_admin_console.py::test_each_console_route_admits_exactly_its_staff_roles
tests/invariants/test_admin_console.py::test_every_console_endpoint_names_its_capability
tests/invariants/test_erasure_plan.py::test_every_table_in_the_schema_has_a_decided_disposition
tests/invariants/test_invariant_06_no_financial_framing.py::test_no_banned_vocabulary_anywhere
tests/invariants/test_invariant_07_access_window.py::test_export_is_not_a_feature
tests/invariants/test_masked_candidate.py::test_the_card_carries_exactly_the_agreed_fields
tests/invariants/test_masked_candidate.py::test_the_search_route_answers_with_masked_cards
tests/invariants/test_route_authorisation.py::test_every_route_refuses_an_unauthenticated_caller
tests/invariants/test_schema_guards.py::test_every_tenant_scoped_table_has_rls_or_a_documented_exemption
tests/invariants/test_schema_guards.py::test_migration_creates_every_table
tests/invariants/test_schema_guards.py::test_migration_batches_have_no_forward_foreign_keys
tests/unit/test_app_wiring.py::test_all_modules_registered
tests/unit/test_career_prefill_draft.py::test_a_phone_with_spaces_is_left_blank
tests/unit/test_career_profile.py::test_unemployed_experienced_candidate_completes_with_previous_job
tests/unit/test_career_profile.py::test_owner_scoped_resume_and_revision_without_scoring
tests/unit/test_hidden_text.py::test_hidden_text_is_found_and_says_why[parked far to the right-BT /F1 12 Tf 1 0 0 1 72 700 Tm (Priya Deshmukh Microbiology Pune) Tj ET\nBT /F1 12 Tf 1 0 0 1 4000 700 Tm (Senior Architect Kubernetes Terraform Machine Learning PhD Ten Years Experience Leadership) Tj ET\n-OFF_PAGE]
```

After the suite, `python scripts/seed_demo_jobs.py` restored **600 published
jobs from 27 realistic roles** in the local database. Its first direct launch
exposed a missing `app` import path. The script now bootstraps backend's path
at its command-line entry point and imports application code lazily. This
utility-only fix was checked by the successful real local run plus ruff and
format checks; application code and test assertions were unchanged after the
full-suite run. Its local-host refusal remains intact. No local CV files or
candidate profiles were rewritten by the seeder. LocalStack loses CV objects
on restart: re-upload missing local files rather than assuming they survived.
