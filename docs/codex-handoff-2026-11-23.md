# Handoff prompt: finish the 2026-11-23 round (web parity, verification, docs)

You are working in the BharatPath monorepo at `D:\Bharatpath` (Windows; use Git
Bash or PowerShell). Three apps: `backend/` (Python 3.12/3.13, FastAPI,
Postgres, Redis, Celery), `mobile-app/` (Expo / React Native, TypeScript),
`frontend/` (Next.js web portals, RTK Query). Branch `Rishabh/BugResolution001`.
**Nothing from this round is committed. Do not commit, push or deploy unless
asked.**

Read first: `CLAUDE.md` (root) -- its invariants are legal/client commitments,
not style: no age fields (invariant 5, `scripts/check_no_age_fields.py`), no
financial framing (invariant 6, `scripts/check_vocabulary.py`), the score is
never explained (no points/numbers beside jobs), streak points never touch the
Bharatpath Score. Also read `frontend/AGENTS.md` (this Next.js version differs
from what you know; check `node_modules/next/dist/docs/` before using APIs).
The round's record: `docs/bugfix-round-2026-11-23.md` and the top entry of
`docs/progress.md`.

## Rule for this task

Every user-facing change made this round must exist on **both** mobile and the
web student portal, unless it is inherently mobile-only (pull-to-refresh
gesture, Android download folder, push notifications). Reuse existing web
components and styles; do not redesign.

## Already done on both platforms (do not redo)

Job engine + match reasons; job search over title/description/location/
skills/employer; skill filter options; city suggestions; job preferences
(own page: web `/student/profile/preferences`, mobile `/job-preferences`);
original-file resume preview/download for the candidate; recruiter/college/
staff views showing the original uploaded PDF (`frontend/components/resume/
original-resume-view.tsx`); resume details tiles read-only + "Edit resume"
(template warning, choose template first, then Bharatpath Builder); Add-ons
page (web `/student/profile/addons`, mobile `/addons`); "Resume review"
renamed "Bharatpath Builder"; full job description under the application's
actions; profile completion counts required fields only; streak "Login" copy.

## Remaining work

### 1. Web notifications should use the server's destination
`frontend/store/api/notification-api.ts` maps clicks by `template_code` only
(`notificationHref`). The inbox API now returns
`destination: {kind, id}` (`backend/app/modules/notifications/schemas.py`
`InboxDestination`). Map for the student portal:
APPLICATION -> `/student/board/{id}` (or `/student/board` without id),
APPLICATIONS -> `/student/board`, JOB -> `/student/jobs/{id}`,
INTERVIEW_REPORT -> `/student/interview/{id}/feedback`, SUBSCRIPTION ->
`/student/subscription`, PROFILE -> `/student/profile`, STREAK ->
`/student/streak`, INBOX -> no navigation. Keep the existing KYB/staff and
shortlist mappings as fallbacks for business users and old rows. Verify the
route paths exist under `frontend/app/(portal)/student/`. Mobile reference:
`mobile-app/services/notifications/destination.ts`.

### 2. Web jobs search must not reload the page on each search
`frontend/features/student/jobs/job-feed.tsx` uses
`frontend/lib/pagination/use-cursor-load-more.ts`, which resets to a loading
state (skeleton grid) on every new search/filter. Make it keep the previous
items on screen while the new first page loads (expose e.g. `isRefreshing`),
show the full skeleton only on the very first load, dim the list slightly and
show a small spinner in the search field while refreshing, and only show
"No results" after the request finishes. Keep the stale-response protection.
Check other callers of the hook still behave. Mobile reference:
`mobile-app/hooks/useJobs.ts` (`searching`) and
`mobile-app/screens/jobs/JobsFeedScreen.tsx`.

### 3. Web automatic refresh
Make student data refresh when the user returns to a page/tab: in
`frontend/store/api/base-api.ts` (and the other `createApi` slices that serve
students) enable `refetchOnFocus` and `refetchOnReconnect`, register
`setupListeners(store.dispatch)` where the store is created
(`frontend/store/index.ts` / `provider.tsx`), and consider
`refetchOnMountOrArgChange` (e.g. 30 s) for student lists (jobs, board,
courses, recommendations, profile, streak). Make sure refetches never blank a
page (no skeleton when data is already shown). Add a small "Refresh" icon
button to the Skill courses page header (mobile has one).

### 4. Web course completion must follow the server's "watched" rule
Mobile fix: `mobile-app/screens/courses/CourseDetailScreen.tsx`. The server
(`backend/app/modules/courses/service.py` `record_progress`) counts a lesson
only at >=90% reached AND half its length elapsed since first opened (a
completed course adds to the score -- do NOT loosen this). Check
`frontend/app/(portal)/student/courses/[courseId]/page.tsx` and
`frontend/store/student/learning.api.ts`: report progress when a lesson is
opened (starts the clock), send one completion request at a time, move to the
next lesson only when the response says `completed: true`, otherwise tell the
user to keep watching; refresh course progress after.

### 5. Web "Build resume" card should warn like Edit resume
`frontend/features/student/profile/student-profile.tsx` opens
`ResumeTemplateDialog` without `fromUpload`. Pass
`fromUpload={current resume source !== "BUILDER"}` (read the current version
the same way `features/student/profile/resume-details.tsx` does:
`versions.data.find(v => v.current)`), and remount the dialog on open
(`key`) so its first step reflects it.

### 6. Web sign-up resume pre-fill parity (mobile items 4, 8, 20)
Mobile reference: `mobile-app/screens/auth/SignUpScreen.tsx` (`readResume`,
`FieldSkeleton`, `autoFilled`, `identityNotice`) and `app/index.tsx`
(`signupDraft`). On web (`frontend/features/student/onboarding/components/
account-steps.tsx`, `student-signup.tsx`): while the CV is being read, lock
and skeleton the fields it fills; ignore a slower answer for an older file; a
new CV replaces only values the previous CV filled, never typed ones; show an
error with "Try again" on failure; warn when the CV's name differs from the
name typed; keep typed values (not passwords) when navigating back and forth.

### 7. Web logout must not leak the previous user's data
Check `frontend/features/student/shell/student-app-shell.tsx` `handleLogout`:
after sign-out, reset every RTK Query cache (`api.util.resetApiState()` for
each `createApi`), clear user-specific storage, and `router.replace` to the
login page so Back cannot return to portal pages.

### 8. Verify and document
- Backend CI equivalent (from `backend/`): `python scripts/check_no_age_fields.py`,
  `python scripts/check_vocabulary.py` (one pre-existing hit in
  `data/job_taxonomy.json`), `ruff check` / `ruff format --check` on changed
  files, `mypy app`, `lint-imports`, `python scripts/check_api_guide.py`,
  `pytest`. Test DB: `source .test-env.sh`, then replace `localhost:5432` with
  `127.0.0.1:5433` in DATABASE_URL, DATABASE_URL_MIGRATOR and
  DATABASE_ADMIN_URL (a native Postgres owns 5432 on this machine). Docker
  Desktop must be running (`docker compose up -d postgres redis`).
- Mobile: `npx tsc --noEmit`, eslint on changed files, `node tests/*.cjs`.
- Web: `npx tsc --noEmit -p .`, eslint on changed files.
- Pre-existing failures, unchanged by this round (do not "fix" by weakening
  tests): unit `test_app_wiring::test_all_modules_registered`,
  `test_career_prefill_draft::test_a_phone_with_spaces_is_left_blank`, two in
  `test_career_profile.py`, one in `test_hidden_text.py`; integration
  `test_jobs_that_fit_the_profile_best_first`, two in `test_resume_builder.py`;
  11 invariant tests; mobile `back-navigation`, `conversation-seeding`,
  `onboarding`, `signup-flow`, `validation-navigation` .cjs; import contract
  "add-on modules must not import scoring". Report any new failure.
- Update `docs/bugfix-round-2026-11-23.md` and the top entry of
  `docs/progress.md` with everything done this round that they do not yet
  mention: original-resume viewers, read-only resume tiles + Edit resume flow,
  Add-ons pages, profile label changes, application job description, Skill
  courses +30 banner rule, smooth search, refresh everywhere, resume preview
  500 fallback, `backend/scripts/seed_demo_jobs.py`, and your items 1-7.

## Local environment notes
- LocalStack (local S3) loses all objects on restart; re-upload CVs locally.
- Integration tests write random jobs into the local DB; afterwards run
  `python scripts/seed_demo_jobs.py` from `backend/` to restore realistic
  published jobs (local databases only).

## Open decisions to leave alone (report, do not implement)
Leaderboard (privacy/product decision); share-card "Save" as an image (needs
`react-native-view-shot` + `expo-media-library` and a new build); "+30
Bharatpath Score boost" text on the mobile course detail screen; deploying to
UAT/production (taxonomy seeding, new endpoints, interview provider keys
`INTERVIEW_TRANSCRIPTION_PROVIDER=sarvam`, `INTERVIEW_EVALUATION_PROVIDER=openai`).

## Done means
Items 1-7 work on web, every check in item 8 shows no new failures, the docs
are updated, and you give a short report: what changed (files), what you
verified and how, and anything you could not verify.
