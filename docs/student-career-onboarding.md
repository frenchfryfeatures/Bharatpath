# Resume-first candidate onboarding

Web and mobile now use the same backend-owned career field definitions and
validation rules. Career data belongs to the authenticated candidate ID. Passwords
and confirmation passwords remain in Cognito/client memory and are never saved in
the career profile.

## Flow

1. **Basic details:** read the selected PDF/DOCX immediately to fill contact,
   employment and education facts before signup. This transient reading stores
   no file or account and does not score. The person reviews contact details,
   sets a password and verifies email within this same first step. After
   verification, the original file is saved under their candidate ID.
2. **Employment** is step 2, **Education** step 3, and **Headline and preferences**
   step 4. All four share one progress indicator and form style, with no second
   four-step wizard after account creation. Each step saves a draft. Without a
   file, entered facts create a manual resume version.
3. Complete the profile. A reviewed resume revision is created without emitting
   `resume.version_confirmed`, so the scoring worker cannot run yet.
4. Purchase membership (or use an existing active personal/college entitlement).
   Only then confirm the reviewed version and start scoring. The confirmation API
   checks access on the server, independent of the client.

Parsing does not guess salary, gender or preferences. Unknown values stay blank.
Existing candidate-entered values take precedence when a replacement resume is
read. OpenAI extraction uses the existing server model/key configuration; without
a model key the structured/manual resume facts can still be reused, and missing
facts are entered manually. No credentials are included in this document.

## Required and optional fields

| Section | Required | Optional / conditional |
| --- | --- | --- |
| Account | Full name, email verification, password and matching confirmation | Resume upload has paste/manual alternatives; college referral code optional |
| Basic profile | Mobile in international format, experienced/fresher | Email is displayed read-only; collecting a phone does not claim SMS verification |
| Employment | Current city, key skills | Freshers skip employment history. Experienced candidates supply current employment status, at least one month of experience, company, title and starting month. Ending month is required if no longer employed. Salary, notice period and role classifications are optional. |
| Education | Highest qualification, course, course type, institution, starting year, passing/expected passing year | Both specialization fields are optional |
| Preferences | None | Headline, up to five preferred locations, preferred annual salary and gender |

Employment uses `YYYY-MM`. Experience months range from 0 to 11. Education end
cannot precede start. Salaries are non-negative whole annual INR amounts, not
transactional payment amounts. Gender remains candidate-owned and is not appended
to the scoring input or added to employer filters. Mobile numbers appear only in
the existing permission-controlled employer reveal, never on masked search cards.

## APIs and storage

- `GET /api/v1/candidate/profile/form`: field definitions/options shared by clients.
- `POST /api/v1/auth/resume-preview`: rate-limited transient pre-signup reading;
  no file storage, identity lookup or scoring.
- `POST /api/v1/candidate/resume/intake`: authenticated multipart original-file
  storage and immediate parsing; the created version remains unconfirmed.
- `GET/PUT /api/v1/candidate/profile/details`: read/save draft or completed details.
- `POST /api/v1/candidate/profile/prefill/{resume_version_id}`: owner-scoped prefill.
- `GET /api/v1/candidate/resume/versions/{id}/document`: expiring original-file URL.
- `GET /api/v1/candidate/resume/versions/{id}/preview`: private in-app PDF pages or
  readable text for DOCX/pasted/manual content. PDF rendering stays on the backend,
  capped at 20 pages, with no third-party viewer receiving the resume or its URL.
- Existing `POST .../versions/{id}/confirm`: now enforces paid/college access.

Migration `0011_candidate_career_details` adds a JSONB career document to the
existing candidate profile. Old name/location APIs and clients remain valid.
Privacy exports include the career data; existing profile erasure removes it.
Profile save/prefill refuses another candidate's or superseded resume version.

The web profile has a summary, quick links, resume, headline, skills, employment,
education and preferences cards. Reports and existing account/privacy controls
follow these sections. The mobile You screen retains its layout; its Profile
details entry displays the same saved data and opens the resume in an app modal.

The admin candidate page now shows all saved career fields in Basic details,
Employment, Education, and Headline/preferences sections, with draft/completed
status and the profile update date. Its existing audited onboarding endpoint
returns the career document and the same field labels/options used by candidates.
Only platform admins and support agents can read this unmasked view; integrity
reviewers, candidates, and unauthenticated callers retain their existing refusal.
The declared career phone takes precedence over an older account phone. Older
accounts without career data retain their contact details and show empty career
fields. Passwords are never returned. This addition needs no further migration.

## Rollout

Deploy the backend first, then the clients. The currently hosted backend does not
gain these APIs merely by running the frontend development server.

1. Install updated backend dependencies, including `pypdfium2` and Pillow.
2. Run `python -m alembic upgrade head` with the deployment's migrator connection.
3. Restart the API and workers using their existing database, Redis, S3, Cognito
   and extraction-provider environment configuration.
4. Publish the frontend and ship the mobile update against that API.
5. Verify a fresh account/upload, profile draft/resume, payment, scoring, document
   opening and profile edits using a deployment test account.

No production migration or remote deployment was performed. The local preview
is now activated: an isolated PostgreSQL cluster on port 5433, Redis on port
6379, the API on port 8099, and the frontend on port 3000. Migration 0010 has
been applied locally, readiness reports both database and Redis up, and a real
database profile write/read check passed. Existing PostgreSQL on port 5432 was
preserved; hosted account data was not copied into this fresh local database.

Local configuration and portable service files are git-ignored in `backend/.env`
and `backend/.local-services`. The API uses the same Cognito candidate/business
pools as the frontend and keeps token verification enabled. The local S3-compatible
development service now runs on loopback port 4566. Original-file storage/read
was checked using a disposable document and database transaction. Direct intake
parses immediately, so onboarding no longer waits for the parser worker. Scoring
still requires background workers after payment; preview and intake never score.

Local payment simulation uses `PAYMENTS_PROVIDER=stub` in the ignored backend
environment. Restart the API after changing this setting. The existing checkout
opens the development payment dialog, and its simulated callback processes the
membership grant immediately without a payment worker or real charge. A local
database check verified successful activation and duplicate callback handling;
retries do not grant the same payment twice.

## Checks

- Backend: isolated unit/ASGI tests cover required/optional fields, invalid dates,
  salary/phone validation, profile ownership, revision creation, absent password
  storage, unpaid scoring refusal, authentication and bounded PDF previews.
- Browser: `npx playwright test` exercises the four profile sections, required
  education validation, persistence before payment, absence of scoring calls and
  profile section/report ordering using mocked API responses.
- Web: TypeScript, changed-file ESLint and production Next.js build.
- Mobile: TypeScript, changed-file ESLint and Expo bundle export. A physical-device
  run and a real payment/provider integration are separate deployment checks.

Pure backend tests can run without the root Redis-cleanup fixture:
`python -m pytest --confcutdir=tests/unit tests/unit/test_career_profile.py`.
Use the normal integration suite when PostgreSQL/Redis/LocalStack are available.
