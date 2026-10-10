# BharatPath — working context

A three-sided hiring marketplace for India (candidates, employers, colleges) built
around a proprietary resume-derived score. Python 3.12 / FastAPI / Postgres /
Redis / Celery, as a **modular monolith**.

**Read `docs/plan.md` first.** It is the build plan and the source of truth for
scope, the twenty-day schedule, and the progress tracker (§14). This file holds
only what that document does not: how to run things, and the operational state a
new session cannot infer from the code.

`docs/progress.md` is the running log of what has actually been done, and why.
**Update it at the end of any session that changes state.**

## The invariants are not style preferences

`docs/plan.md` §1 lists nine. Two are enforced by CI on every push and are legal
requirements, not preferences:

- **Invariant 5 — no age-gating.** `scripts/check_no_age_fields.py`
- **Invariant 6 — no financial framing.** `scripts/check_vocabulary.py`
  (no "credit score", "creditworthiness", "CIBIL", "loan", "underwriting")

The others are enforced by tests in `backend/tests/invariants/`. Do not weaken a
test to make a change pass — the tests encode client and regulatory commitments.

## Running it

```bash
cd backend
docker compose up -d postgres redis     # Docker Desktop must be running
PYTHON=.venv/Scripts/python.exe bash scripts/reset_local_db.sh
source .test-env.sh                     # NOT optional - see below
bash scripts/dev_api.sh                 # API on :8099
bash scripts/dev_all.sh                # API + Celery worker, together

# Periodic work (added 2026-09-22). Nothing settles a payment, sends a
# notification or carries out a deletion until the relay runs.
celery -A app.worker worker --loglevel=info
celery -A app.worker beat   --loglevel=info    # EXACTLY ONE of these
```

**The API alone is not enough for resume parsing.** The parse flow is
asynchronous: the upload endpoint writes a `resume_files` row and an outbox
event, and a **Celery worker** (`resume.parse`) must pick it up. If only the
API is running, uploads succeed but `parse_status` stays PENDING forever and
the mobile app times out after 60s with _"parsing has not started. The resume
parser worker may not be running."_ `scripts/dev_all.sh` starts both the API
(:8099) and the worker + outbox relay together, with shared Ctrl-C cleanup.
Logs: `/tmp/bp_api.log`, `/tmp/bp_workers.log`. Use it instead of
`dev_api.sh` for any flow that touches resumes or scoring.

**Deploying it: [`docs/aws-deployment.md`](docs/aws-deployment.md)** — §0 is
what runs now (2026-10-01): one EC2 host (API, worker, beat, Redis, Caddy) and
Postgres on RDS, at `https://bharatpath-api.duckdns.org/api/v1`. A deploy is
`BP_SSH_KEY=~/.ssh/bharatpath_ed25519 bash deploy/ship.sh 43.204.56.60`.
**Celery's broker on the host is Redis, not SQS** — the SQS path never worked
(`blockers.md` E44). §7 is the rest of the migration to ECS Fargate.

**Run tests as CI does — bare `pytest`, not `python -m pytest`.** The latter puts
the working directory on `sys.path`, which hides import errors that CI will catch.
That exact divergence produced a green local suite and a red CI for the same commit.

**`source .test-env.sh` first, or four RLS tests fail for a reason that looks
exactly like a regression.** Without it the app connects as a role that is not
subject to RLS, so `test_scores_are_insert_only` reports `DID NOT RAISE` instead
of a permissions error. The tests are right; the connection is wrong.

### Local CI equivalent

```bash
python scripts/check_no_age_fields.py && python scripts/check_vocabulary.py
ruff check app tests scripts && ruff format --check app tests scripts
mypy app && lint-imports && python scripts/gen_modules.py --check
pytest --cov=app
```

## Periodic work runs on Celery Beat, and there is exactly one

`app/tasks/schedule.py`, added 2026-09-22 closing half of `blockers.md` E4.

- **Beat, not EventBridge.** `worker.py` used to say Beat could not work on an
  SQS broker because SQS has no ETA/countdown. That is true of
  `apply_async(countdown=...)` and irrelevant to Beat, which never asks the
  broker to delay anything. The trigger endpoint that docstring described was
  never built, so **from Day 12 until 2026-09-22 nothing ran any sweep** -- no
  payment settled, no notification was dispatched, no accepted deletion was
  carried out.
- **One beat process.** It is a clock; two run every sweep twice. Scale
  `worker`, never `beat`. Its state file must persist across restarts
  (`CELERY_BEAT_SCHEDULE_PATH`).
- The relay runs **every 30 seconds** -- that interval is the delay a candidate
  feels between paying and being subscribed.
- A misspelt task name here fails nowhere: beat publishes it, no worker
  registers it, the message is discarded in silence.
  `tests/unit/test_beat_schedule.py` is the only thing that catches it.

## Configuration is rows, and `seed_config.py` writes them

Eight `config_values` keys steer things a customer feels, and until 2026-09-22
**none of them had a row anywhere** -- every reader fell back to a default in
code, so production ran on invisible numbers, all of them ours.

- `scripts/seed_config.py` builds each document **from the module's own default
  object** and parses it back through that module's own strict reader before
  writing. The values are never retyped, so they cannot drift from the code.
- **Version 1 only, never an update.** A key that already has a row is left
  alone; changing a number is inserting version 2.
- Readers are strict on purpose: a bad row is a 500, not a silent fallback. So
  a misspelt key in the seed is a customer-facing outage, which is why
  `tests/unit/test_config_seed.py` runs every document through the real reader.

## Nine locales, six of them the client's

`app/core/i18n/`, `PRIORITY_LOCALES` = en, hi, bn, kn, mr, **pa**.

- **Punjabi had no bundle at all** before 2026-09-22 and was not in
  `SUPPORTED_LOCALES`, so it returned `{}` and fell back to English silently --
  a supported-looking language that translated nothing.
- **127 of 159 keys were in no bundle**, in any language: every form label,
  interview question, questionnaire prompt and notification body. They rendered
  as the key itself.
- The six priority locales are held to **full key parity**; gu/ta/te keep the
  32 core strings and fall back per key.
- **Every non-English bundle is flagged `needs_native_speaker_pass: true`** in
  its `_meta`, and a test fails if that flag is dropped. We wrote them. Flipping
  the flag is a claim that a qualified person read the file (C5, E39).
- `notifications/schemas.py` carries a hardcoded `LocaleCode` literal with an
  assertion against `LOCALE_CODES` -- add a language in both places.

## Payments: the stub IS the bypass

No gateway is chosen (D3). `PAYMENTS_PROVIDER=stub` with `ENVIRONMENT=dev`, and
`POST /billing/dev/payments/{id}/simulate` completes a checkout end to end --
synchronously, so it works without the relay.

**It bypasses the bank, not the rules**: the stub signs its callbacks with a
real HMAC and they go through the ordinary verification path, so every guard,
transition and CHECK is genuinely exercised. `Settings` refuses the stub in
staging and prod, and the route is not registered without it.
[`docs/payments-bypass.md`](docs/payments-bypass.md) has the swap: one adapter
class, one `Literal`, no route or schema change.

## Architecture rules the linter enforces

`.importlinter`, run as `lint-imports`:

- Add-on modules (`questionnaire`, `interview`, `courses`) **never** import
  `scoring` — this is invariant 4′, stopping an add-on awarding itself points.
- Routers never _directly_ import repositories; `router → service → repository`
  is the intended path.
- `app.core` never imports `app.modules` (one documented exception:
  `app/core/metadata.py`, which exists only to populate `Base.metadata`).
- `domain.py` is pure — no I/O, no DB, no clock.
- Other modules **never** import `resume.repository` or `resume.models`. The
  confirm gate (SRS 1.4.4) lives in `resume.service.get_scorable_version`, and
  a rule in a service is only a rule while the service is the only way in —
  `repository.list_versions` returns unconfirmed versions quite correctly, for
  the review screen.

## Authentication — the part most likely to be got wrong

- **Cognito answers "who is this" and nothing else.** Role and tenant come from
  our `memberships` table on every request, cached 60s in Redis
  (`app/core/auth/membership.py`). Token claims and Cognito groups are _not_ the
  authority: a revoked membership that stayed valid until token expiry is the
  tenant-isolation failure SRS §2.24.7 forbids.
- `cognito_sub` is stored on `users` but **must never appear in an API response.**
- Two pools: candidates (email + password) and business (email + password,
  plus software-token MFA **only if the user turns it on** -- optional and off
  by default since 2026-10-07, closing E37; the API never checks it). **No phone OTP and no SMS** (client,
  2026-09-18) — see _Sign-up, accounts and discount codes_ below. A token from
  the wrong pool is rejected, not half-trusted.
- `AUTH_ALLOW_LOCAL_TOKENS=true` enables a dev-only provider that mints real
  RS256 tokens locally. `Settings` refuses to boot with it set outside local/CI.
  **CI needs it set** — with no Cognito pool configured, `Settings` otherwise
  refuses to construct and even Alembic fails.

## The confirm gate — and the Day 8 trap under it

SRS 1.4.4: an unconfirmed resume version can never reach scoring. Parsing is
not accurate, so the candidate has to see what was extracted before a number is
attached to it.

- **`resume.service.get_scorable_version` is the only door.** The filter is a
  SQL predicate (`confirmed_at IS NOT NULL`), so an unconfirmed row is never
  loaded rather than loaded and then checked.
- **Scoring must trigger on `resume.version_confirmed`, never on
  `resume.version_created`.** The creation event is the obvious choice and it
  is wrong: it fires on every unconfirmed parse and every unconfirmed
  correction, so consuming it bypasses the gate _while the whole suite still
  passes_ — the gate function stays intact and is simply never called.
  `tests/invariants/test_confirm_gate.py` fails the build on it.
- **Versions are append-only.** An edit creates a row chained by
  `supersedes_id`; the chain cannot fork (unique index) and `confirmed_at` is a
  latch (conditional UPDATE, `WHERE confirmed_at IS NULL`). An edit never
  inherits confirmation — that would be the gate reached through a side door.

- **Review-screen sections are a view of `raw_text`, never stored**
  (`resume/sections.py`, 2026-09-23). A `sections` edit is assembled back into
  text. Do not "upgrade" it to the structured form: that drops the prose Layer 1
  reads, so fixing a typo would lower a score.
- **`parsed.structured_resume` is a model's display view, never scored**
  (`resume/structuring.py`, 2026-10-06). Written at version creation beside
  `raw_text`, best effort (no key = `UNAVAILABLE`). Never make it a scoring
  input. It holds every contact and link on the CV, so it goes **only where
  the whole CV already goes**: the owner's screens, `SharedResumeView`
  (reveal, opened application), admin `/candidates/{id}/resume` and college
  `/students/{id}/resume` -- never a list, card or masked view. Not
  back-filled: older versions read `UNAVAILABLE`.

Anything that feeds a deliberately unreadable document into the parse chain
will call **Textract for real** unless it is pinned to `LocalResumeParser` —
see the `local_parser_only` fixture.

## Scoring — the model reads, code scores

Three layers (`docs/scoring-approach.md` §4). Layer 1 reads a CV into facts
and bounded 0–4 ratings; Layers 2 and 3 are ordinary, versioned, tested code.
**The model never sees the weights and never returns a total**, so it cannot
aim at a target score and neither can anyone writing instructions into a CV.

- **The model's output is an _input_ to scoring, captured once and stored.**
  `replay(score_id)` re-runs Layers 2 and 3 over the stored response and
  **never calls the model**, so a 2029 dispute about a 2026 score gets an
  exact answer. A mismatch raises rather than returning a different number.
- **The extraction cache is keyed on the CV text**, not the resume or the
  user: `sha256(normalised_text + model_id + prompt_version + schema_version)`.
  One model call per distinct CV ever. Two candidates with identical text
  share one row. **Tests that count model calls must use unique CV text** —
  cache rows outlive the test that wrote them.
- **There is no fallback extractor, deliberately.** With no model wired,
  `UnconfiguredResumeExtractor` raises and the score stays PENDING. A
  heuristic stand-in would produce a plausible wrong number, which is
  unfixable once a candidate has seen it (§11).
- **`scoring.repository.insert_score` is the only write path.** No update, no
  delete, and the app role holds neither grant.
- The display floor lives in `display_value`, applied at the serialization
  boundary and nowhere else — what is stored is what was computed.

## Resume parsing — local first, Textract as fallback

`pypdf` and `python-docx` read a normal CV for nothing. **Textract is called
only when they fail or return almost no text**, which is what a scanned CV — a
phone photo saved as a PDF — looks like: pypdf reports _success_ and returns an
empty string, so without OCR that candidate is scored as having no experience
and nothing errors. The trigger is therefore a length floor
(`MIN_USEFUL_CHARS`), not an exception.

Textract bills per page with no free tier, so _not_ calling it on the common
path is a requirement, not an optimisation. `resume_textract_fallback_enabled`
turns it off; scanned CVs then fail loudly rather than scoring as empty.
Textract runs in `ap-south-1`, so text stays in India while **N2** is open.

**A document longer than a CV is refused, not truncated** (2026-10-02):
over `MAX_PAGES` (10) pages or `MAX_TEXT_CHARS` (30,000) characters it fails
`resume_too_long`, before any model call and never through Textract, whose
page cap is held equal. It used to be cut to 40 pages and scored, so a book
reached employers as a 700.

Every extraction records `parser` and `parser_version`. This is not
bookkeeping: invariant 1 requires a score to be replayable from the stored
extraction chain, and a different parser produces different text and therefore
a different score. Changing parser is a **re-score**, not an upgrade. See
`docs/progress.md` → _Deferred by decision_.

## Placeholder content — ours, not the client's

Produced 2026-09-12 under Round 7.10. **Every one of these carries a flag that a
test asserts**, so a placeholder cannot quietly become the product:

| Where | Flag |
|---|---|
| `subscriptions/catalogue.py` | `PLACEHOLDER_PRICING` |
| `courses/catalogue.py` | `HAS_MEDIA`, every `asset_key is None` |
| `notifications/templates.py` | every `dlt_template_id is None` — **an SMS cannot be sent without one**, and an unregistered body is dropped silently by the operator. `delivery_decision` enforces it |
| `questionnaire/bank.py`, `interview/bank.py` | `BANK_VERSION` |
| `kyb/forms.py`, `college/forms.py` | `FORM_VERSION` |
| `app/core/i18n/locales/*.json` | non-English bundles still need a native-speaker pass |
| `college/domain.py` | `CONSENT_VERSION` starts `placeholder-` — the words a student agrees to when linking to a college are ours, not counsel's |
| `college/domain.py` | `INDIVIDUAL_CONSENT_VERSION` starts `placeholder-` — the words for letting a college see a student by name, and the field list they name (blockers E27). Version 2 (2026-09-29) names contact, CV, interviews, courses and application stages |
| `analytics/domain.py` | `DEFAULT_FLOORS` cohort 10 and median to 10 are ours. **Cell 1 (exact numbers) is the client's**, 2026-09-30. A config row may raise them, never lower them below 5 / 1 |
| `billing/domain.py` | `DISCOUNT_POLICY_VERSION` starts `placeholder-` — first checkout only, one use per payer (blockers E36). 100% codes are the client's (2026-10-09) |
| `resume/vocabulary.py` | `VOCABULARY_VERSION` starts `placeholder-` — the spellings the review screen flags near misses of |
| `discovery/catalogue.py` | `FILTER_CATALOGUE_VERSION` starts `placeholder-` — the starter skills and cities in the employer filter panel |

Flipping one of these is a client decision, not a tidy-up.

**The score is never drawn as a red-to-green gauge, dial or speedometer.**
`docs/design-system.md` §1, and machine-readable in `docs/design-tokens.json`.
That picture is the visual language of an Indian bureau score — invariant 6
forbids the words for the same reason, and a dial says it louder than any word.

## Integrity signals never move the score

SRS 1.4.5, enforced by the `integrity-never-imports-scoring` contract.
`integrity/domain.py` raises signals; a human resolves them.

**Hidden text is read as of 2026-09-22** (`resume/hidden_text.py`, closing
E5): invisible render mode, near-white fill, sub-point type and off-page
positioning, plus `w:vanish` and white runs in .docx.

- **`raw_text` is unchanged and must stay so.** pypdf returns hidden and
  visible text in one string; the detector is a **separate second pass** that
  identifies rather than subtracts. No score moves, nothing re-scores. That
  the model still reads hidden keywords is the design: the remedy is a HIGH
  signal, not a quietly different number.
- **Built to miss rather than guess**, because HIGH hides someone before a
  human looks. An OCR text layer over a scan is every-character-invisible and
  is *not* reported (invisible mode counts only as a minority of the
  document); light-grey text is not white.
- **`analysed=False` is not "nothing found".** `hidden_text_of` hands the
  rules `""` for never-analysed, failed and clean alike; `was_analysed` keeps
  the record. A rule firing on our own missing data would suppress candidates
  for a reason that is nothing to do with them.
- **Versions parsed before 2026-09-22 carry no analysis** and are not
  re-checked. Re-running over live candidates is a decision, not a migration.

**Severity is the design, not the rules.** HIGH removes a candidate from
employer search _before_ anyone has looked, so only two rules may reach it —
injected instructions and hidden text, the two things nobody does by accident.
Everything that could equally be a typo, an unusual career, or our own extractor
misreading is MEDIUM or LOW. `test_only_the_two_deliberate_rules_can_ever_reach_high`
is where a third one would have to be argued for.

## Employer tenancy and discovery — Day 9

- **`get_db` does not bind `app.tenant_id`.** A service reading an RLS table
  must call `set_transaction_tenant(session, ctx.tenant_id)` first, from the
  resolved membership and never from a path or body. Without it the policy
  matches nothing and reads come back empty, which looks like a missing row
  rather than a bug.
- **`current_business_identity` admits a business account with no
  membership.** It exists so an account can create its organisation, and it
  returns `BusinessIdentity`, not a `TenantContext`. Every route added to it is
  a way in that skips the membership check; keep it to the three it has
  (employer reference, employer organisation, college organisation — Day 17).
- **Who an employer can see is `VISIBLE_CANDIDATES_CTE`, and nothing else.**
  Every discovery query is built on it, and a test enforces that. It fails
  closed: a candidate needs a score, an `integrity_checks` row for that version,
  and no HIGH signal that is OPEN or CONFIRMED. Only CLEARED restores.
- **The integrity task reads a score and never writes one** (SRS 1.4.5). It
  lives in `app/tasks/` because `integrity` may not import `scoring`, and a test
  fails the build if it names a scoring write path.
- **Manual-form resumes score like uploads**: a structured version is
  rendered to text (without the name or graduation year) and goes through
  Layer 1 (E6, fixed).

## KYB and jobs — Day 10

- **R15 is one config row:** `kyb.require_approval`, `{"enabled": true|false}`,
  off when absent. A malformed row refuses (`kyb_config_invalid`) rather than
  defaulting, because defaulting to "off" approves employers nobody meant to.
- **Staff flip it from the console** (`PUT /admin/settings/kyb-approval`,
  capability `kyb_policy`, PLATFORM_ADMIN only; 2026-10-09).
  `kyb.service.set_require_approval` appends a version under an advisory
  lock and audits it. **It decides the next submission only**: switching to
  automatic never approves one already waiting. A reviewer can read the
  switch and cannot flip it. Tests that flip it delete the versions they
  wrote (`_drop_switch_versions_above` in `test_admin_console.py`).
- **`employers.kyb_status` is what the publish trigger reads.** Only
  `kyb.service` changes it, through `employer.service.set_kyb_status`. The
  profile PATCH must never be a way to set it.
- **The organisation's public profile is four `employers` columns**
  (`trade_name`, `employee_count_band`, `website`, `about`; 0013,
  2026-10-06), edited by `PATCH /employer/organisation` without reopening
  verification. **Statutory details (PAN, GSTIN, CIN, TAN, address,
  signatory) stay in the KYB submission** and change only through KYB: a
  reviewer approved those values. The settings page reads them, never writes
  them, and **keeps nothing in localStorage**. `EMPLOYEE_COUNT_BANDS` now
  lives in `app.core.reference`, shared by `kyb` and `employer`.
- **Forms are validated on the server** by `app.core.forms.validate_answers`;
  the patterns in a form definition are hints to the client. Option lists shared
  between modules live in `app/core/reference.py`.
- **The threshold preview is a leak vector.** Steps of ten, counts floored to
  ten, anything under ten reported only as "fewer than ten", rate-limited per
  organisation. Don't make it more precise.
- **Config rows are global in tests.** Insert with a past `effective_from`,
  **take `coalesce(max(version), 0) + 1` rather than `1`**, and delete the row
  in a `finally`. Version 1 now belongs to `seed_config.py` in any environment
  where it has run, which is every deployment and `reset_local_db.sh`.
- **Never assert a literal rules version** (`code-v1`, `config-v1`). That is
  really an assertion about whether a config row exists, and it silently
  encodes "this platform runs on defaults that live only in source". Read the
  live row and compare (`_live_expiry_version` in `test_pipeline.py`). Three
  tests failed this way the day the defaults became rows.
- **Review actions (KYB and integrity) are routed by the admin console**
  (Day 19), which calls these services.

## Candidate marketplace — Day 11

- **A candidate has no tenant, so `app.tenant_id` cannot serve them.** Candidate
  services call `jobs.service.bind_candidate`, which binds `app.user_id`
  (`set_transaction_user`). Five candidate policies in the baseline read it
  through `current_candidate_id()`, which yields NULL unless no tenant is bound
  and the id is an ACTIVE CANDIDATE account. Forget the binding and the board
  reads empty, the same look-alike failure as a forgotten tenant.
- **The board policy also shows jobs the candidate applied to**, whatever their
  status, so the Application Board can still name a closed job. Board queries
  filter `status = 'PUBLISHED'` themselves; do not drop that filter.
- **An application's tenant is its job's tenant**, held by the composite key
  `fk_applications_job_tenant`, not by a policy.
- **`require_active_subscription` is real now** and reads live. Put a role guard
  before it. Tests seed `plans` + `subscriptions` as the migrator
  (`_subscribe` in `test_candidate_marketplace.py`). Its seat limb is
  `has_active_college_seat` -- see _Colleges, seats_ below.
- **Never return `min_score` to a candidate.** Beside their own score it is the
  gap, which is the explanation R11 forbids. `eligibility` is the answer.
- **Applying follows the discovery rule** (`is_candidate_visible`), or a CV held
  back by a HIGH signal reaches employers through the apply button.
- **Reading and withdrawing your own applications are not paywalled**, by
  decision: a lapsed subscriber loses access, not their data.
- A module serving a second surface mounts it with `get_extra_routers()` in its
  `__init__.py` (`jobs` → `/candidate/jobs`).

## The hiring pipeline — Day 12

- **The stage machine lives twice, from one source.** `applications.domain`
  decides who may move what; `guard_application_write` (baseline migration)
  refuses anything else for every writer, the migrator included, and builds
  its transition list from `domain.allowed_transitions()`. **Seed a test
  application at SUBMITTED and walk it one UPDATE per stage** — an insert at
  another stage, or a jump, is refused, and that is the guard working.
- **Employers move one stage forward, or reject.** Acting on a SUBMITTED
  application records VIEWED first, and opening one records VIEWED (any role,
  once). HIRED is never the employer's to write: they propose
  (`employer_confirmed_at`), and the candidate's confirmation is the
  transition. A CHECK refuses HIRED without both; the confirmations and
  `hire_disputed_at` are latches.
- **The guard tells the parties apart by what is bound.** A tenant transaction
  cannot withdraw, confirm or dispute; a candidate transaction (`app.user_id`,
  no tenant) can do only those. Forget the binding and a candidate's confirm
  looks like a migrator write, which the guard still accepts — the RLS
  policies, not the guard, stop that session reading the row.
- **`application_events` is not under RLS.** Read it only by application id,
  after the row was loaded under the caller's policy. Notes and `actor_id` are
  employer-only; a test fails if a candidate schema grows either.
  `occurred_at` is `clock_timestamp()`, so two events in one transaction sort
  as written.
- **Expiry is measured, not stamped.** `employer_active_at` moves on every
  employer action; the sweep compares it (and any booked interview) with the
  period in `config_values` `applications.expiry` — a bad row raises rather
  than defaulting. A proposed hire never expires. The sweep binds each tenant
  from the `tenants` table (`identity.service.employer_tenant_ids`), **the one
  place a tenant id does not come from a membership**, and is system-only.
  Beat runs it hourly.
- **The application names nobody; its `candidate` block does** (narrowed
  2026-10-05). See _Applicants and the shortlist_ below.

## Job postings carry a `details` document — 2026-10-06

`jobs.details` (`jobs/details.py`). Columns stay for what is searched or
constrained; the rest of the posting is one validated JSONB document.
**It has no age and no gender field, and must never get one** (invariant 5,
C3). A candidate reads `CandidateJobDetails`, built from narrower models, so a
new employer field stays employer-only until added there on purpose. Only
PUBLIC jobs are listed on the board (`repository._listed`).

- **The external link and the application email are a way round `apply`**,
  so `get_board_job` sends them only to a candidate who is ELIGIBLE and
  `is_candidate_visible` -- the two rules `apply` checks -- and says so in
  `can_apply_externally`. Never send them to everyone again: an EXTERNAL job
  with a threshold would take anyone, and a HIGH signal would stop nothing.
- **A screening question is refused by its words** if it asks about age or
  gender (`_asks_about_age_or_gender`). Invariant 5 is otherwise checked by
  field name, and a knockout on "are you under 30?" is age-gating whatever
  the key is.
- `PRIVATE`/`INVITE_ONLY` are both *unlisted* -- anyone with the link can
  apply -- and are labelled so. `applicant_access`, `allow_referrals` and
  `publish_on` are stored and change nothing, so the composer hides them.

## Recommended jobs — 2026-10-09

The candidate home screen's two sections, `/candidate/recommended-jobs/
similar-to-applied` and `/matching-profile` (`backend-guide/05` §7).

- **One rule, two sources of terms.** `jobs.domain.match` ranks; the
  `candidate` module serves the routes because only it reads the career
  profile, and `jobs` may not import `candidate` (`candidate.service ->
  applications.service -> jobs.service` is already a chain).
- **`MatchTerms` is skills, title words, places, experience, and nothing
  else.** No gender, no salary. A unit test holds the field list. Never let
  `min_score` or eligibility order the list: jobs a score clears sorted
  above ones it does not is the gap R11 forbids, drawn as a list.
- The database only narrows: published, `_listed()`, shares a skill or a
  title word, not applied to, newest 300. The ranking is Python. No
  relevance number leaves the server.

## Profile photos and logos — 2026-10-09

`app/modules/profile_images` (`backend-guide/16`). Everyone's own photo
(`user_photos`, `/profile/photo`); employer and college logos
(`organisation_logos`, `/{employer,college}/organisation/logo`, owner /
college admin to change).

- **A student's photo reaches the student and staff, nobody else** (the
  backend lead's decision, 2026-10-09: a face says gender and age, and
  masked search exists so employers judge on band and skills).
  `tests/invariants/test_profile_photo_reach.py` fails on a photo-like field
  in any employer- or college-facing schema, and on a caller of
  `profile_images.service.photo_url` other than the admin console. Widening
  it is a client decision.
- **The server keeps only what it encoded.** Confirm sniffs the bytes,
  decodes, applies EXIF rotation, scales to 512px and re-encodes (JPEG, or
  PNG with transparency), which drops every byte of metadata -- a phone
  photo's GPS position included. The raw upload is deleted, accepted or not.
- **A replaced or removed image's object is deleted**, because the key on
  the row is the only record of it and erasure reads keys off rows.
  `user_photos` is ERASE (object first, via `erasable_object_keys`);
  `organisation_logos` is NOT_PERSONAL and RLS-exempt -- candidates read
  logos across tenants on the board, as `employer_logo_url`.
- Bucket `S3_BUCKET_PROFILE_IMAGES` (Terraform `profile_images`, LocalStack
  `bharatpath-profile-images`). Tests use the `images` fixture in
  `test_profile_images.py` (`FakeS3` plus `put_object` and `presign_get`).
- `erase_candidate` was replaced again in `0015_profile_images`, patched
  onto 0010's at the applications delete, as 0010 did onto 0007's.

## Masked search — Day 13

- **`MaskedCandidate` has no field for contact or the score**, and
  `tests/invariants/test_masked_candidate.py` holds its exact field list.
  Widening the card is a product decision, not a refactor. Employers get the
  **band**, never the number.
- **The card names the candidate since 2026-10-06** (product decision):
  `full_name` from `candidate_profiles` only, never the CV's, so it is null
  until the person gives one. It is the one identifying field allowed
  (`ALLOWED_IDENTIFYING` in that test). Contact, the CV and the score still
  cost a reveal, its caps and its audit row.
- **`candidate_search_documents` is written by a trigger on `scores` and
  nothing else** (`project_candidate_search_document`); the app role has no
  INSERT/UPDATE/DELETE on it. Bands, badges and the contact filter in that
  trigger are **generated** from `scoring.domain.BANDS`,
  `discovery.domain.BADGE_FOR_ADDON_KIND` and `CONTACT_LIKE_PATTERN` — change
  those and rebuild the database. Experience is summed in SQL and a test holds
  it equal to `features_from_extraction`.
- **The document never decides visibility.** Search joins it through
  `VISIBLE_CANDIDATES_CTE` on `(user_id, resume_version_id)`, so a suppressed
  candidate keeps a document and still never appears.
- **Location is candidate-declared** (`candidate_profiles`, `PUT
/candidate/profile/location`) — nothing else in the schema has one. A city
  refuses digits and `@` because every employer sees it; no address or PIN.
- **Skills come from a CV, so they can carry a phone number.** Contact-like
  skills are dropped from the document (unsearchable) and again at the card.
- Search needs owner/recruiter **and** approved KYB, is rate-limited per
  organisation, orders by band only, and returns **no total**. No audit row:
  a card is not a reveal. The reveal, access window and view caps are Day 14.
- Tests share one pool: give each test's candidates a unique skill and filter
  on it. **Make that skill letters only** — a hex token sometimes holds eight
  digits in a row, the contact filter drops it as a phone number, and the test
  fails about one run in ten.

## Applicants and the shortlist — 2026-10-05

- **Who applied rides in one `candidate` block, filled only by discovery.**
  List rows: `ApplicantCard` (name, band, experience, skills, city -- no
  contact, no score). The opened application: `ApplicantProfile` (plus
  phone, email, display score, CV). `discovery.applicant_cards` /
  `open_applicant` join the tenant's own application **and**
  `VISIBLE_CANDIDATES_CTE`, so a candidate a HIGH signal hides comes back
  `candidate: null`. Every list page is an `applicants_listed` audit row and
  every response carrying the profile an `applicant_profile_viewed` row --
  the moves too. No caps and no view event: they applied.
  `test_the_application_itself_names_nobody` holds the application's own fields.
- **A CV leaves only through `resume.service.shared_resume`**: confirmed
  versions only, sections computed, a presigned link that expires. The
  reveal and the opened application use it; nothing else should.
- **The shortlist is a question, not an application** (`employer_shortlists`,
  migration 0010). SAVED is private to the organisation; INVITED is the
  candidate's to answer. Accepting goes through
  `accept_shortlist_invitation` (SECURITY DEFINER), which files or finds the
  application and walks it to SHORTLISTED with VIEWED/SHORTLISTED recorded as
  the inviting employer's -- the application guard otherwise lets a
  candidate's transaction move no stage. **Never let a candidate UPDATE a row
  to ACCEPTED**; the guard refuses it. A DECLINED row is final for that job.
- **Shortlisting needs a prior reveal by the same organisation**
  (`discovery.require_shortlistable`). It was written so the shortlist
  could not leak names off masked cards; cards carry the name since
  2026-10-06, and what it still stops is inviting someone the organisation
  never spent a reveal on.
- **A candidate's `FOR UPDATE` on `employer_shortlists` sees only INVITED
  rows** (the UPDATE policy). Read unlocked first, lock only to answer, or an
  idempotent repeat reads as a 404.
- `guard_shortlist_write`'s moves and statuses are frozen in 0010 and held
  equal to `applications.domain.SHORTLIST_MOVES` by a test.

## The employer dashboard — 2026-09-23

`GET /employer/dashboard` and `/employer/dashboard/activity`, in the
`applications` module (`backend-guide/06` §8).

- **Counts and application ids only.** No name, contact, score or candidate
  id in any dashboard schema; who someone is stays behind the reveal.
- **The activity feed reaches `application_events` only through a join to
  `applications`**, which is what applies the tenant policy. Never query the
  events table by tenant any other way. It has no RLS of its own.
- `expiring_within_7_days` is `domain.expiry_horizon`, which is the sweep's rule
  moved forward. Change one and you change both.
- Tests move `now` forward (`service.dashboard(..., now=)`) rather than
  ageing `created_at`, which the application guard refuses to change.

## Search filter options — 2026-09-24

`search_filter_options` (owned by `discovery`), served at
`/employer/discovery/filters[/skills|/locations]` and curated at
`/admin/search-filters` (capability `search_filters`: PLATFORM_ADMIN and
SUPPORT_AGENT).

- **The catalogue suggests; it never restricts.** Search still takes any
  text. A value naming an option (label, key or alias) searches every
  spelling of it (`domain.filter_groups`); anything else searches itself,
  in the search document's own key form, exactly as before.
- **No count on any filter schema.** A test walks the panel's keys.
- **Suggestions come from the catalogue, never from candidates' skills.** A
  rare skill in a dropdown says somebody has it.
- **One spelling, one option per kind, switched off or not** — unique
  `(kind, key)`, and the aliases under a per-kind advisory lock. Options are
  switched off, never deleted (no DELETE grant).
- Its repository functions are in `READS_NO_CANDIDATE`; a new one must be too.
- Tests create options with letters-only tokens and delete them as the
  migrator (the `made` fixture in `test_search_filters.py`) — featured
  options left behind would crowd the panel's 40.

## Access windows, the reveal and abuse controls — Day 14

- **For an employer the subscription IS the access window** (R14).
  `require_active_access_window` and `require_active_subscription` read the
  same row, live, and refuse with different codes (`access_window_expired` on
  the reveal, `subscription_required` everywhere else). Never cache either.
- **Payment gates every employer action (R15)**: jobs, the pipeline, search
  and the reveal. Organisation, team and KYB stay open so an unpaid employer
  can onboard. **Tests seed one with `subscribe_tenant`** (`tests/conftest.py`);
  the shared `_employer` / `_organisation` helpers already do. An employer test
  answering 402 has forgotten it.
- **The reveal is `GET /employer/discovery/candidates/{id}`, mounted by the
  `candidate` module**, because the response needs `display_value` and
  `discovery` may not import `scoring`. `discovery.service.open_candidate`
  owns every decision: KYB, the per-person burst limit, the organisation's
  caps, visibility, the view event and the audit row. Nothing reads the
  candidate before it returns.
- **Every open writes an `audit_events` row and a `candidate_view_events` row
  in the same transaction**, re-opens included (invariant 7′). Metadata holds
  ids only. The view-event insert selects from the visibility CTE, so it cannot
  name someone the reveal would not show.
- **Caps count distinct candidates per organisation over a rolling hour and
  day**, under a per-tenant advisory lock, checked _before_ the lookup so a
  capped employer cannot probe ids. Re-opening costs nothing. Every number is
  `config_values` key `discovery.limits` (strict; a bad row is a 500, never
  the defaults), and the defaults are ours, not the client's.
- **Alerts are crossings, not levels**: one `candidate_view_anomaly_flagged`
  audit row plus an outbox event per threshold crossed. They block nothing;
  staff see them on the admin console's employer drill-down.
- **`candidate_view_events` is partitioned by month.** Its key is
  `(id, viewed_at)`. Partitions are revoked from the app role, because RLS on
  the parent does not cover a query naming a partition. The baseline creates
  fifteen months plus DEFAULT; `ensure_candidate_view_partitions` (SECURITY
  DEFINER) adds more, via `app/tasks/view_event_partitions.py`, daily on
  beat. Rows in DEFAULT block creating their month — move them first.
- **`RevealedCandidate` has `score` (display) and no raw field**, and
  `full_name` from `candidate_profiles` (asked at sign-up, `PUT
/candidate/profile/name`), else the structured form's; never guessed from a
  CV. The masked card carries the profile name only (2026-10-06). Its field list, "no employer schema has a raw field" and "export
  is not a feature" are invariant tests. No list endpoint may return it.
- Discovery repository functions that do not use the CTE must be named in
  `READS_NO_CANDIDATE` (`test_discovery_suppression.py`) and may not mention a
  candidate table.
- **The candidate reads the view log back only through
  `candidate_profile_views()`** (`GET /candidate/profile/views`, migration
  0009, 2026-10-02): organisation name and latest open, 90 days. **Never
  `actor_id` and never a count of opens.** It answers for
  `current_candidate_id()` alone, so the service must bind `app.user_id` or
  the list reads empty. Do not replace it with a candidate RLS policy on
  `candidate_view_events`: that would expose `actor_id` and still not reach
  the names of employers with no job on the board.

## Payments, subscriptions and courses — Day 15

- **An entitlement is granted only by `billing.service.process_callback`,
  after the callback's HMAC verified.** The database backs it:
  `guard_payment_write` (inserted PENDING, transitions from
  `billing.domain.PAYMENT_TRANSITIONS`, verification is a latch),
  `ck_payments_settled_only_when_verified`, `guard_course_purchase`, and a
  completion's foreign key to its purchase. **A test that needs a paid state
  either settles through a signed stub callback** (helpers in
  `tests/integration/test_payments.py`) **or seeds `subscriptions` as the
  migrator** (`subscribe_tenant`, `_subscribe`) — never an UPDATE of a payment.
- **`PAYMENTS_PROVIDER=stub` in tests** (conftest, `.test-env.sh`, CI). The
  default `none` answers checkout with 503; `Settings` refuses the stub in
  staging and prod.
- **Callbacks are verified and stored by the route, and settled by a task** via
  the outbox, so nothing is granted until the relay runs (worker + beat, or
  `dev_all.sh` locally). `POST /billing/dev/payments/{id}/simulate` settles
  synchronously and needs neither.
- **Access is the clock, the state machine is the record.** GRACE exists only
  for auto-renew and moves `current_period_end` to the end of grace
  (`grace_from` keeps the paid end). LAPSED and CANCELLED rows are never revived
  by a purchase — a new tenure row is. The renewal sweep
  (`app/tasks/subscription_renewals.py`) runs hourly on beat.
- **Nothing debits a payer who was not told**: a debit needs a NOTIFIED
  `mandate_debit_notices` row whose `debit_not_before` passed, for the notified
  amount. Config `subscriptions.renewal` refuses a notice period under 24h.
- **A course completion has no route** and is written only by
  `courses.service.record_completion` as SYSTEM or PLATFORM_ADMIN. It routes to
  `scoring.rescore_for_addons`, **not `score_resume`**, which is idempotent by
  resume version and would silently skip it.
- **Plans and courses are versioned, never edited** — `scripts/seed_catalogue.py`
  (run by `reset_local_db.sh`). Other tests seed `TEST_…` plans, so assert on a
  plan's audience, not on the catalogue being the only rows.

## Questionnaire and mock interview — Day 16

- **The questionnaire is worth zero points.** Its event routes to nothing,
  scoring never reads it, and `test_questionnaire_never_scores.py` fails on a
  score-like field in either add-on's schemas (`will_increase_score` and its acknowledgement are
  the allowed names). It has no badge on purpose (blockers E21).
- **Interview sessions are bought like the course**, not through `entitlements`:
  `interview_purchases` (guarded like `course_purchases`) and a session per
  purchase (`purchase_id` NOT NULL). Payment purpose `INTERVIEW_SESSION`; the
  payment CHECKs are generated from `billing.domain.PURPOSES` / `ONE_OFF_PURPOSES`.
- **Checkout is refused before any payment exists** without a device check
  passed in the last hour, or, once three sessions are held, without
  `acknowledge_no_score_increase`. What the candidate was told is an
  insert-only `interview_checkout_notices` row. Do not relax either.
- **Sessions are not included in the subscription.** The mobile branch made
  them so (`0002_interviews_in_subscription`, 2026-09-22) without a client
  decision: any subscriber got unlimited sessions and the whole +60 unpaid.
  `0006_interviews_are_bought` put the rule back, and **refuses to migrate a
  database holding a session with no purchase** -- what such a row is (test
  data, or a candidate owed something) is a decision, not a backfill.
- **Each completed session records +20, a fourth included; the +60 cap is
  scoring's alone** (`addons_for` lists every session, `total_score` clamps).
  Completion goes through `interview.session_completed` → `rescore_for_addons`.
- **The database holds the session machine**: `guard_interview_session_write`
  (transitions generated from `interview.domain.SESSION_TRANSITIONS`, completion
  latch, COMPLETED needs `QUESTIONS_PER_SESSION` STORED answers) and
  `guard_interview_answer_write` (a STORED answer never changes; nothing is
  written to a closed session). Tests that need a completed session record
  real answers through the routes with the `fake_s3` fixture in
  `tests/integration/test_interview.py`.
- **POST /candidate/interview/sessions returns the open session** if there is
  one. That is the recovery path, not a bug; there is no abandon (E20).

## Interview evaluation — Day 17

- **Evaluation is feedback and never moves a score.** It runs after
  completion (`interview.evaluate_session`, beside the re-score); the +20 was
  frozen before it, and the guard refuses EVALUATED/FAILED without an
  `interview_evaluations` row. **The report carries no number about the
  candidate** — ratings are stored, levels (STRONG / DEVELOPING / FOCUS_AREA)
  are shown. `test_questionnaire_never_scores.py` walks the interview schemas.
- **No provider by default, and no fallback.** `INTERVIEW_EVALUATION_PROVIDER`
  is `none` (session stays COMPLETED, report PENDING) or `stub` (refused in
  staging/prod). Tests pass providers to `transcribe_session` /
  `evaluate_session` explicitly rather than setting the env. The stub hears
  audio of ≤2 KB as silence — that is how tests reach `no_speech`.
- Evaluator output that does not fit the rubric exactly is FAILED
  `evaluation_invalid`, never repaired. The evaluator is given the question,
  `looking_for` and the transcript — nothing about the person.

## Colleges, seats, referral codes, rosters — Day 17

- **A student never binds a college's tenant.** A code or invitation names a
  tenant; binding it would be a tenant id from a request body. Student routes
  bind `app.user_id` and reach college tables through nine narrow SECURITY
  DEFINER functions (`referral_code_tenant`, `consume_referral_code`,
  `claim_college_seat`, `invitations_for_candidate`, `answer_invitation`, ...)
  and four candidate policies. **The consent INSERT policy re-checks** that the
  code or accepted invitation is live and this college's — keep it that way.
- **A code or an invitation confers ROSTER scope and nothing else** (R16).
  `INDIVIDUAL` is Day 18's separate grant. Every bad code is one
  `referral_code_invalid`; the code itself never enters the audit log.
- **`seats_used` is the seat guard's, not the app's.** The app role has no
  UPDATE on it; `guard_college_seat_assignment` counts on insert and release.
  **One live seat per student, platform-wide.** Revoking ROSTER consent
  releases the seat by trigger. The seat limb of `require_active_subscription`
  is `candidate_has_college_seat` — seat, consent, ACTIVE college, college
  subscription in period — read live.
- **`allocate_seats` is routed only by the admin console** and refuses above
  the live plan's `seat_allowance`. Tests call it as PLATFORM_ADMIN on the app role;
  seed a COLLEGE subscription with `_subscribe_college` (`test_college.py`).
- **A college never learns who has an account.** No roster column says a
  contact matched; a student finds invitations from their own verified phone
  or email. Don't add a "matched" field to anything college-facing.
- **Committed roster rows are held by `guard_roster_entry_write`**: contact
  immutable, transitions generated from `college.domain.INVITE_TRANSITIONS`,
  only uncommitted rows deletable, `sent_at` fixed. A test that ages an
  invitation disables that trigger as the migrator for the one UPDATE.
- Revoking a code and discarding a preview are **not paywalled**; issuing,
  importing, committing and sending are. A student's `/candidate/colleges`
  routes are never paywalled — linking is how a seated student gets access.

## Consent and college analytics — Day 18

- **Two scopes, two acts.** ROSTER (counted) comes only from a code or an
  accepted invitation; INDIVIDUAL (seen by name) only from the student's own
  `individual-visibility` grant, `granted_via = DIRECT`. A CHECK holds the
  pairing and `guard_student_consent_insert` requires a live ROSTER link, for
  every writer. **Trigger before CHECK**: a test of the CHECK must link first.
- **Only the student grants or revokes.** The permissive tenant policy would
  let a college's transaction INSERT or revoke a consent; the RESTRICTIVE
  policies `student_consents_only_the_student_*` stop it. Keep them.
- **Revoking ROSTER ends INDIVIDUAL and the seat in the same statement**
  (`revoke_individual_with_roster`, `release_seat_on_consent_revoke`).
  Revocation is never paywalled.
- **A college reads a student only through `COLLEGE_STUDENT_READS`** — six
  SECURITY DEFINER functions that INNER JOIN live consent for
  `bound_college_tenant()` and take no tenant id. A new `college_*` function
  must be added there with the CTE it joins, or invariant 9 fails; the college
  and analytics repositories may not name a student table.
- **Aggregates carry no identifier and are floored in `analytics.domain`**:
  under `min_cohort_size` only counts. **Above it every number is exact**
  (client, 2026-09-30, answers-log 12.1): `min_cell_size` defaults to 1, set
  on existing databases by `0008_exact_college_analytics` as config version 2.
  Raise it in a row and a cell under it is `null` with a partner (a zero cell
  if nothing else), so the total cannot give it back. A withheld figure is
  `null`, never `0`. The cohort floor is unchanged (10) and the code refuses
  a row below 5: under that a median or a band is one person. Config `analytics.privacy`, strict: a bad row is a 500. Not audited
  — an aggregate is not a reveal. Never cache it.
- **Every list page and every open of `/college/students` is audited in the
  transaction**, ids only; `CollegeStudentResponse`'s field list is an
  invariant, and it is named in the INDIVIDUAL consent words. Widening one
  means changing the other and bumping its version.
- A ROSTER revocation notice to a college (Day 19) **must not name the
  student**: beside a dashboard that just moved, it names their band (E28).

## Admin console, suspension, disputes — Day 19

- **Staff are members of the one PLATFORM tenant** (E10). Provision with
  `scripts/create_platform_staff.py` (or `identity.service.provision_platform_staff`
  as the migrator in tests -- `_staff` in `tests/integration/test_admin_console.py`);
  there is no route. `guard_membership_tenant_type` refuses a staff role in any
  other tenant and a customer role in ours, **generated from
  `identity.domain.ROLE_TENANT_TYPE`**.
- **Who may call what is `admin.domain.CONSOLE_ROLES`.** A new console route
  needs its endpoint in `ROUTE_CAPABILITY` in `tests/invariants/test_admin_console.py`,
  which drives every route with every staff role and every outsider. `/admin`
  is no longer a cross-tenant surface; that test replaces it.
- **Every cross-tenant read goes through `admin.service._reveal`**: audit row on
  the request's session first, then the read-only bypass session
  (`DATABASE_ADMIN_URL`, `SET TRANSACTION READ ONLY`). Writes stay in the owning
  module's service (`kyb.review`, `integrity.resolve_signal`,
  `college.allocate_seats`, `identity.suspend_tenant`).
- **A drill-down never shows the stored score**: display value and band.
  Since 2026-09-29 the client's full candidate page shows the whole contact
  (`/onboarding`, capability `candidate_contact`), the CV (`/resume`,
  `candidate_resume`) and interview recordings (`candidate_recordings`) --
  each its own endpoint, capability and audit row, never folded into the
  drill-down, which still masks and counts.
- **Suspension is a row and `tenants.status` follows it**, both ways, by trigger
  (`guard_tenant_suspension_write`, `guard_tenant_status`). Never set a tenant
  SUSPENDED by hand -- the guard refuses. It bites on the member's **next
  request** despite the 60s membership cache: `membership.mark_tenant_changed`
  flags the tenant so cached rows are distrusted. Jobs of a suspended employer
  leave the board and refuse applications; a suspended college's seats stop
  (E29). The PLATFORM tenant cannot be suspended.
- **Disputes** (`/disputes` to raise, `/admin/disputes` to work): RLS by tenant,
  candidate and `platform_tenant_bound()`; `guard_dispute_write` lets only a
  PLATFORM-bound transaction change state. Resolving records words and **moves
  nothing else**. A candidate's hire dispute is filed by `admin.open_hire_dispute`.

**The console dashboard** (`GET /admin/dashboard`, 2026-09-23) is capability
`dashboard`, held by every staff role. Each queue section inside is gated by
`domain.dashboard_sections`, which reads the queue's own capability, so a
new queue section means a new entry there and never a check written by
hand. It is one `_reveal` per load. Its tests assert deltas, because the
counts cover the whole shared database.

## Notifications and the relay — Day 19

- **The relay now enqueues** (`celery_app.send_task`) with arguments from
  `routing.TASK_ARGUMENTS`; a routed task needs an entry whose keys match its
  signature (`tests/unit/test_outbox_relay.py`). New task modules go in
  `routing.TASK_MODULES` -- the worker includes exactly those.
- **Which event tells whom is `notifications.domain.plan_for`**, and
  `NOTIFYING_EVENTS` is what routing subscribes. Payloads carry ids only; names
  and contacts are resolved at dispatch and **contacts are never stored**.
- **Every message decided is a row, sent or not**, with `skip_reason`, keyed by
  `dedupe_key` so a redelivered event writes nothing new. Decide in one
  transaction, send each in its own (`app/tasks/notify.py`).
- **No SMS at all since 2026-09-18**: `plan_for` names only EMAIL and IN_APP
  templates, and `test_nothing_is_sent_by_sms` fails the build otherwise. The
  SMS drafts stay, unregistered. Providers default to `none`; tests use the
  `stub_email` fixture (`test_notifications.py`). Only the UPI pre-debit
  notice (now `EMAIL_MANDATE_PRE_DEBIT`) ignores an opt-out.
- **No template may carry the score**: no variable for it, and
  `notifications-never-import-scoring` in `.importlinter`.
- **A message to a college about a revocation never names the student** (E28).
- **Nudges** (`notifications.nudge_page`): config `notifications.nudges`, strict,
  floors in `domain` (no more than daily, at most 6, IST sending hours). The
  nudge number is claimed first (`uq_profile_nudges_sequence`) -- that is the
  cap and the concurrency guard. Tests inject `now` and page with
  `after_id = uuid - 1, limit = 1` to examine one person in a shared database.

## The API has two error shapes, and the schema says so

Found by the fuzzer, 2026-09-22 (`blockers.md` E42).

- An `AppError` is answered by `app_error_handler` as RFC 9457
  **`application/problem+json`** with a stable `code`. **Match on `code`,
  never on `title`** -- the title is English prose and will be translated.
- An **unparseable body never reaches a handler**, so Starlette answers 400
  with its own `{"detail": ...}` as plain `application/json`, which is also
  what FastAPI uses for 422.

`openapi.json` documents both (`ProblemDetail`, `FrameworkError`) rather than
pretending they are one. **Normalising them is a breaking change** for
anyone parsing `detail`, so it is the client's decision.

**Error statuses are added to the schema in one place** --
`main._document_error_responses`, which **wraps `app.openapi`**. Mutating
`app.openapi_schema` once does not work: FastAPI 0.141 regenerates the schema
whenever the route set has changed since it last built one, so a post-process
that runs before the final route is registered is silently discarded and the
served document is the unmodified one.

## Fuzzing: `pytest -m contract`

`tests/integration/test_api_fuzz.py`. 157 operations against hostile input,
authenticated as a real candidate so the input reaches handlers rather than
bouncing off `current_user`.

- **Excluded from the default run** and not yet green (`blockers.md` E43). A
  full run is about fifteen minutes.
- **`positive_data_acceptance` is deliberately not one of the checks.** It
  fails an operation that refuses schema-compliant input, and this API
  refuses plenty, correctly -- `city: ""` satisfies every constraint JSON
  Schema can express and is still not a city. Including it would mean
  watering down the validators to satisfy a test.
- Requests go through the suite's own httpx client, not
  `case.call_and_validate`: schemathesis drives the ASGI app in its own event
  loop, and the shared Redis client is created and disposed in pytest's, so
  the two loops collide in teardown and it looks like a fuzzing finding.

## Privacy, erasure and rate limits — Day 20

- **The deletion policy is `privacy/domain.py`, and it names every table in
  the schema.** ERASE, RETAIN (the financial and audit carve-out the client
  confirmed), NOT_PERSONAL or SELF_EXPIRING, each with its reason.
  `tests/invariants/test_erasure_plan.py` reads the **live database**: a table
  added without a disposition fails the build, and the SQL must delete exactly
  the ERASE set and never touch a retained one.
- **`erase_candidate` is the cascade — one SECURITY DEFINER function, one
  transaction.** Not Python, because the app role holds no DELETE on `scores`,
  `course_completions`, `device_checks` or `application_events` and must not be
  given one; half an erasure is not a smaller erasure, it is a corrupt account.
- **`users` is emptied, never deleted.** It anchors every retained payment and
  audit row. `cognito_sub` is replaced by its **SHA-256, not nulled** — with
  NULL, a token issued before the erasure finds no row and sign-in _creates a
  new account from the erased person's credential_. `_by_subject` matches the
  hash and returns the DELETED row, so the answer is `account_inactive`. The
  Cognito user is deleted too (`directory.delete_user`), *before* the cascade,
  which destroys the subject it is deleted by.
- **Objects before rows.** The S3 keys live on the rows the cascade destroys,
  so deleting rows first orphans the CV. A failure leaves the request RECEIVED
  and the rows in place for the retry. **An export archive this person already
  took is one of those objects** -- it is their whole record in one file, and
  leaving it to the expiry sweep leaves a complete copy of somebody just
  erased. The pointers on the retained request rows are cleared afterwards, in
  Python, because the cascade may not touch a retained table.
- **The export carries the score and not the breakdown.** R11/Q12 — the score
  is never explained, and an export is another door to the same room.
  `EXPORT_FORBIDDEN_FIELDS` is stripped at any depth as a second lock.
- **Deletion has a 24h cooling-off period and can be withdrawn**; the account
  stays usable throughout, because locking it would lock the person out of
  withdrawing. The seat is **released through its guard** and then deleted —
  `seats_used` only ever moves through that guard.
- **`dsr_requests` is deliberately not under RLS**, like `application_events`:
  the sweep binds neither tenant nor user, and a policy loose enough to admit
  it would admit a forgotten binding. Every repository reader takes `user_id`,
  and a test asserts it.
- **Every rate limit is in `app/core/ratelimit.py`.** The global tier (per IP
  in middleware, per user and per tenant in `current_user`) **fails open**; the
  specific ones **fail closed**. OTP and the threshold preview must stay the
  tightest — `tests/unit/test_rate_limit_policies.py` fails on a new limit that
  is tighter, so it is a decision rather than an accident.
- **The index review is a test, not a one-off.** `test_index_review.py` plans
  every hot query with `enable_seqscan = off` and holds every FK on a growing
  table to an index or a written exemption. `users` is exempt as a parent
  _because_ an erasure empties rather than deletes it.

## Sign-up, accounts and discount codes — 2026-09-18

From the client's `docs/Signup_Login_Discussion_Updates .pdf`; the reference
for app teams is `docs/signup-and-accounts.md`.

- **Anyone signs up**, by email and password: candidates, and employers and
  colleges in the business pool (`allow_admin_create_user_only = false`,
  closing E7). A business account with no organisation gets 403
  `no_active_membership` from `/auth/me`, then creates one.
  `current_business_identity` therefore admits strangers now — keep its
  routes as narrow as they are.
- **Phone OTP is deferred, and there is no SMS.** `/auth/otp/start` exists
  only behind `AUTH_PHONE_OTP_ENABLED`; `start_otp_challenge` is kept and
  tested at the service. Cognito sends every code by email (through SES once
  the client's domain exists, `infra/terraform/ses.tf`, E38).
- **Staff create accounts** (`/admin/accounts/*`, PLATFORM_ADMIN): our row
  first, then `app/core/auth/directory.py` asks Cognito `AdminCreateUser`,
  which emails a temporary password. **Invite last**, so a refusal emails
  nobody and a Cognito failure (502) rolls the rows back. Tests read
  `LocalAccountDirectory.sent`. An owner adding a never-signed-in colleague
  sends the same email. Staff never link a student to a college: that link is
  the student's consent.
- **Staff may fill the onboarding, never finish it** (2026-10-03). The
  invites take `kyb_answers` / `onboarding_answers` / name and location,
  saved as an unsubmitted draft. `app.core.forms.validate_staff_answers`
  refuses every CHECKBOX (an undertaking) and FILE. Never let staff submit:
  with approval off, a KYB submit is an approval nobody at the employer gave.
- **First sign-in adopts a pre-made row by email _and pool_** (`_adopt_unlinked`).
  A contact already held by the other pool is 403 `account_contact_in_use`,
  not a 500.
- **Discount codes live in `billing`.** A code lowers the checkout's
  `amount_minor` and is recorded on the payment (`discount_code_id`,
  `list_amount_minor`, both held by `guard_payment_write`). **A use is a
  `discount_redemptions` row written in `_settle`, beside the
  grant** — never at checkout; `guard_discount_redemption` refuses a row
  without this code's verified payment. A code's terms never change
  (`guard_discount_code_write`); staff switch it off and make another. Checkouts
  against one code are serialised by locking its row, and a fresh PENDING
  checkout holds a use for `CHECKOUT_HOLD_MINUTES`. Status is computed, never
  stored. Only a checkout reads a code, so a mandate debit is never discounted.
- **A code may be 100% (client, 2026-10-09).** A checkout that comes to
  zero has no gateway and no callback, so `_settle_complimentary` inserts it
  PENDING with provider `complimentary` and settles it at once through
  `_settle`, the same function a verified callback uses. **This is the one
  grant no gateway signed**; what stands in is the code, locked and checked
  under that lock. `ck_payments_complimentary` holds that a zero payment is
  always `complimentary` with a code, and `complimentary` is always zero.
  Never add another way to reach `_settle`.

## Portal dashboards — 2026-09-29

Client requests for all four portals (answers-log Round 11); migration
`0005_portal_dashboards`.

- **Every interview question is written by the model -- no fixed questions**
  (client: "only ai"). `INTERVIEW_QUESTION_PROVIDER` is `openai` (the
  default) or `stub` (tests, CI, and keyless local work; refused in
  staging/prod), so **the API refuses to boot without `OPENAI_API_KEY`**.
  `interview/questions.py`. The first at session start,
  each next one at `POST …/next-question` after the previous answer is stored
  and **transcribed in-session** (best effort -- a failed transcription just
  means no follow-up). Every question is a row in `interview_session_questions`
  and **everything reads questions from there** (evaluation, report,
  playback), never from `set_for_session`, except sessions from before the
  table, which fall back to their bank set. `bank.py` is otherwise only the
  rubric now.
- **No repeats across sessions** is enforced twice: the model is shown every
  earlier prompt, and `parse_drafted_question` refuses a normalised repeat;
  a refused draft goes back to the model with the reason, up to
  `MAX_DRAFT_ATTEMPTS` (3), then **503** -- nothing written, and a failed
  start spends no purchase. `scripts/smoke_interview_live.py` exercises the
  real OpenAI + Sarvam loop (costs a few cents).
  The CV goes to the model through the confirm gate with contacts stripped
  (`redact_contacts`); the accessibility answer never goes.
- **Courses are built in the console** (`course_modules`, `course_lessons`:
  YouTube id or an S3 upload checked by magic bytes), keyed on course
  **code**, not the version row. A course is on sale only when staff publish it
  with a playable lesson; `sync_catalogue` no longer decides `active`.
  **Completion = every published lesson watched** (90% reached *and* half its
  length elapsed since first opened), recorded by `record_progress` as SYSTEM.
  Unlisted YouTube is not paywalled; uploads are.
- **Employer messages** (`application_messages`, not under RLS -- read only by
  application id after the application loaded under the caller's policy, like
  `application_events`). Pipeline stages only; 10 per application per day.
  The payload carries the message id; words, time and link are read at
  dispatch. A new template variable needs `notifications.domain.Variable`.
- **A college's widened view needs consent version 2**
  (`INDIVIDUAL_DETAILS_VERSIONS`, frozen in SQL as `DETAILS_CONSENT_VERSIONS`
  in 0005, and a test holds them equal). Re-granting under new words revokes
  and replaces the old INDIVIDUAL row. New `college_*` read functions live in
  migrations with their own `COLLEGE_STUDENT_READS`, which invariant 9 now
  gathers from every revision.
- `erase_candidate` was replaced whole in 0005 to erase the three new personal
  tables. The next table that holds a person's data replaces it again.

## Streak points are not the score

`app/modules/engagement` (added 2026-09-13, `docs/streaks.md`) keeps daily
app-open streaks: −10 per break, +10/+15/+20 at 30/90/365 days. **Those points
are a separate balance and must never reach the 700–990 score.** Applied to
the score they break invariants 1, 2, 3 and 4′ at once: below the 700 base,
past 990, and not replayable. `engagement` and `scoring` are independent under
import-linter, employer-facing modules may not import `engagement`, and
`tests/invariants/test_streak_never_moves_the_score.py` guards both contracts
and the event routing table.

- **The numbers are config, not code:** `config_values` key
  `engagement.streak_rules`. Bad config raises rather than falling back.
  Every ledger row stores `rules_version`.
- **The day is IST and decided by the server.** A check-in carries no date.
- Streak integration tests inject `now`, so a config row they insert must be
  `effective_from` before the simulated day, not the real `now()`.
- **The activity calendar** (`GET /candidate/streak/me/calendar`, 2026-09-29)
  reads `streak_activity_days`: the date only, **opened or not, never a count
  of opens**, kept **one year** (client). The app role cannot delete a day;
  `purge_streak_activity_days` does, and it clamps the cut-off to the
  database's IST day, so a wrong clock can only delete less. Its 365 is frozen
  in migration `0007`; a test holds it equal to `ACTIVITY_RETENTION_DAYS`.
  A day before `first_active_on` is `BEFORE_START`, never `MISSED`.

## Environment

- `backend/.env` — local development (gitignored)
- `backend/.env.aws` — real AWS values, written by Terraform (gitignored, holds a
  secret key). Regenerate: `terraform output -raw env_file`
- `backend/.test-env.sh` — test env for the docker stack

## AWS

Account `335345888157` since 2026-10-01 (the old `592033927084` expired; its
Cognito users did not move), region `ap-south-1` (Mumbai — data residency,
plan §13 N2 is still open). Terraform in `infra/terraform`, **state in S3**
(`backend.tf`, made by `infra/bootstrap`), this deployment's settings in the
gitignored `deploy.auto.tfvars`. See `infra/README.md` for what is
deliberately _not_ provisioned and why.

- **The account is on AWS's Free plan and closes when its credit runs out or
  on 2027-04-01** (`blockers.md` E45). It caps RDS backups at 1 day.
- **Always `terraform plan -out` and read it before applying.** `deploy_rds`
  and the RDS instance carry `prevent_destroy` and deletion protection; a plan
  that wants to destroy the database is refused, and that is the guard working.
- The host costs ~$43/month with RDS; the rest is ~free at idle. Locally,
  Postgres and Redis are still docker, and service containers in CI.

## Conventions

- Money is integer minor units, never a float, and columns are named `*_minor`.
- A tenant-scoped miss is **404, not 403** — a 403 confirms the row exists.
- The baseline migration is not reversible; rebuild with `reset_local_db.sh`.
- **Shared databases (Neon, EC2) move by incremental migrations** since
  2026-09-26 (`0002`…). The baseline builds tables from the *current* models,
  so a later revision that adds an index or column a model already declares
  must be idempotent (`if_not_exists`, `DROP … IF EXISTS`) or a fresh
  database fails -- `0002_college_student_search` and `0003` did until
  2026-09-29. **A brand-new table goes in both**: the baseline's
  `_create_from_metadata` lists (`test_schema_guards.py` requires every model
  there) and a migration that creates it only when missing
  (`0002_search_filter_options`, `0005_portal_dashboards`).
- Seeding uses the **migrator** role (write + BYPASSRLS); the app role is
  genuinely subject to RLS, which is what makes the RLS tests meaningful.
