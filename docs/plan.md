# BharatPath — Backend Build Plan

> **Version 6.1** · 2026-08-30 · Consistency pass over v6. **No scope changed.**
> Four rounds of client changes were applied to this file in place over four days, and v3/v4-era
> text survived in places the changes should have removed. Corrected: the repository layout and
> the config list still named `unlocks` and `wallet_ledger`; §5.3 still counted six idempotent
> operations; the monolith rationale in §2 still rested on "unlock must bill, reveal and audit
> atomically"; §8.0's *honest risk* paragraph still named Day 4 and Day 14's deleted work as the
> days to protect; and — worst of the set, because it was an instruction rather than a
> description — **"Never cut … the unlock transaction"** told a developer to protect something
> deleted 400 lines above. Counts fixed (invariants are **ten**, not nine; `questions.txt` holds
> **seven** items, not thirteen), and **a numbering warning added to [§1](#1-the-invariants)**
> because this file's invariant numbers and the PRD's rule numbers differ by one.
>
> **Four asks were also missing from `questions.txt` and are now in it** — see
> [§13 Still open](#still-open): the **unlock rescission** (R14 voids five graded acceptance
> criteria and had never been raised, while a one-sentence score issue was chased twice), the
> **referral-code consent** wording against PRD rule 8, **course content** (our own documents call
> it the largest unlisted dependency in the project and it had never been put to the client), and
> **plans and prices**.
>
> **Version 6** · 2026-08-27 (late) · Supersedes v5 (same day).
> **The commercial model is now fully answered, and one answer restructures the marketplace.**
> **Employers no longer unlock candidates individually** — they pay once for a period and the
> entire candidate database is visible for its duration (R14). That deletes the unlock
> transaction, the wallet ledger, and the sprint's second high-judgment day — and replaces them
> with an access-window check, a view-audit obligation, and a **bulk-extraction risk that needs
> raising in writing** ([§13 R14](#resolved-in-v6--client-answers-2026-08-27-late)).
> Also: **pay-first for all three audiences** (R13), **KYB form stays with a config-switchable
> approval gate** (R15), and **colleges link existing students by referral code** (R16).
>
> **Version 5** · 2026-08-27 (evening) · Superseded v4 (same day).
> **Client answered the scoring questions.** The arithmetic now closes exactly: base 700 +
> resume 0–200 + course 30 + interviews 60 = **990, precisely**. No clamp needed, no display
> floor reachable, and "employers never see the raw score" is satisfied for free because raw and
> displayed values are now always the same number. **The score is never explained to the
> candidate.** Our answer to the client's question about reproducible AI scoring is in
> **`scoring-approach.md`** — awaiting their approval.
>
> **Version 4** · 2026-08-27 · Superseded v3 (2026-08-24).
> Changes in this revision, all from the client's document comments (2026-08-24) and the
> note of 2026-08-27 — see [§13](#13-decisions-and-open-questions):
> **paid add-ons now raise the score** (invariant 4 rescinded, replaced);
> **scale is 700–990**, not 680–999;
> **the anonymous-first flow is deleted** — sign-up gates everything;
> **employers never see the raw score** (Q2 closed);
> **revenue model replaced** with subscriptions, courses, employer tiers, college seats;
> **duplicate-resume detection dropped**; **KYB provisionally auto-approved**.
> Carried forward from v3: 4-week / 20-working-day sprint; Twilio for OTP and SMS.
>
> **Re-baselining warning.** The removals in this revision are worth roughly a day and a half;
> the additions are worth four to six, and they land on days already flagged as uncompressible.
> **The 20-day schedule below has not yet been re-cut to absorb them** — see [§8.0](#80-what-four-weeks-buys--and-what-it-does-not).
>
> **Unanswered questions live in `questions.txt`.** Seven items, in plain language, ready to
> put to the client. Several block days in this plan; they are cross-referenced in [§13](#13-decisions-and-open-questions).
>
> **Scope of this document.** The backend only: one shared FastAPI service plus async workers,
> consumed by all four surfaces (Candidate mobile, Employer console, College console, Admin
> console). Infrastructure is provisioned by someone else — see [§12](#12-external-dependencies).
>
> **How to use it.** [§8](#8-the-four-week-build) is a day-by-day schedule. Each day has a
> deliverable; each week has a gate that must be green before the next week starts. Tick boxes in
> [§14](#14-progress-tracker). Amend this file when reality disagrees with it.
>
> **Source of truth.** `Docs/Product Requirements Document.pdf` (PRD) and
> `Docs/BharatPath_SRS_User_Flows_Interface_Specifications_v3_Phone_Interview.docx.pdf` (SRS).

---

## Table of contents

1. [The invariants — and how code enforces each](#1-the-invariants)
2. [Architecture decision: modular monolith](#2-architecture-decision-modular-monolith)
3. [Stack](#3-stack)
4. [Repository layout](#4-repository-layout)
5. [Cross-cutting foundations](#5-cross-cutting-foundations)
6. [Data model — the spine](#6-data-model--the-spine)
7. [API conventions](#7-api-conventions)
8. [The four-week build](#8-the-four-week-build)
9. [Testing strategy](#9-testing-strategy)
10. [Security and privacy checklist](#10-security-and-privacy-checklist)
11. [Performance budget](#11-performance-budget)
12. [External dependencies](#12-external-dependencies)
13. [Decisions and open questions](#13-decisions-and-open-questions)
14. [Progress tracker](#14-progress-tracker)

**Companion files.** Still-open questions are in **`questions.txt`** (plain language, ready to
send). The complete record of every question asked and answered, with the client's words verbatim,
is in **`answers-log.md`**. The scoring design awaiting client approval is
**`scoring-approach.md`**. Everything the build depends on but cannot produce itself — AWS,
vendors, registrations, content — is in **`resources-needed.md`**.

---

## 1. The invariants

The PRD calls these "non-negotiable product rules" (PRD §3). Treat them as **architectural
invariants, not features**.

> **Changed in v4, amended in v6.** The client rescinded rule 4 — paid add-ons *do* now change the
> score. It is replaced below by a new invariant (**4′**) that bounds and versions what an add-on
> may contribute; without it the score is unbounded through purchases. Rule 1 lost its
> "explainable" half (v5, R11) and gained the model-extraction chain; rule 2's constants moved to
> 700–990; **rule 7 was restructured in v6** — the gate is an access window, not a per-candidate
> unlock — and **7′ was added** to carry the audit obligation that blanket access would otherwise
> destroy; **rule 8's gate is intact but auto-approves by config default** (R15 — settled, no
> longer provisional). Rules 3, 5, 6 and 9 are untouched. **Nothing was deleted from
> `tests/invariants/` — rule 4's tests were replaced, not removed, and rule 7's were rewritten
> around window expiry rather than around billing.**

> **⚠️ Numbering warning — read before citing this table to the client.** The numbers in the first
> column are **this plan's invariant numbers, not the PRD's rule numbers.** PRD §3 lists nine
> rules; we split its rule 1 (which bundles "explainable and reproducible" with the display floor)
> into invariants **1** and **2**, so everything after shifts by one. The mapping:
>
> | Plan invariant | 1 | 2 | 3 | 4 / 4′ | 5 | 6 | 7 / 7′ | 8 | 9 |
> |---|---|---|---|---|---|---|---|---|---|
> | PRD §3 rule | 1 (first half) | 1 (floor half) | 2 | **3** | 4 | 5 | 6 | 7 | 8 + 9 |
>
> So "the rescinded rule 4" below means **PRD rule 3**. `answers-log.md` cites the PRD numbering
> and this file cites its own; both are correct and they disagree by one. When writing to the
> client, quote the PRD number.

Each is paired below with the mechanism that makes violating it hard, and the test that proves it.
If a rule is only enforced by "the developer remembered," it is not enforced.

Under a compressed schedule these matter *more*, not less — they are the part of the codebase that
cannot be fixed in a follow-up sprint, because getting them wrong means rewriting everything built
on top.

| # | Rule (PRD §3) | Enforcement mechanism | Proving test |
|---|---|---|---|
| 1 | Score reproducible — **not explained** *(client, 2026-08-27)* | Every `scores` row stores `resume_version_id`, `algorithm_version`, `contributing_events`, **and the full model-extraction chain** (`model_id`, `prompt_version`, `raw_model_response`) — see `scoring-approach.md` §5. `replay(score_id)` recomputes from stored inputs and **never re-invokes the model**, so replay is identical in perpetuity. The breakdown is stored for disputes and admin, and **never returned to a candidate**. | Golden-file test: replay every score in a fixture corpus, assert identical breakdown — including scores carrying add-on contributions. **Plus a schema test asserting no candidate-facing response model exposes a breakdown, category, or suggestion field.** |
| 2 | Scale is **700–990**; 700 is a base, not a floor *(client, 2026-08-27)* | 700 is added to every score, so the minimum possible value **is** 700 and **stored value == displayed value, always**. The floor machinery stays in the serializer because it is config-driven and free, but it is currently a **no-op** — nothing can fall below it. Ceiling 990 is arithmetic (700+200+30+60), not a clamp. | Property test: no combination of resume points and add-ons produces a value outside 700–990. **An assertion that fires on the ceiling is a bug, not a business rule** — test that it never fires across the corpus. |
| 3 | Score never human-editable — **directly or indirectly** | No route accepts a score value. DB grant: application role has no `UPDATE` on `scores`. Writes go through `scoring.persist()` only. **New:** writing a `course_completions` or `interview_sessions` row now moves a score, so those writes are role-restricted and audited like a reveal. | Route-table test asserting no endpoint exposes a writable score field; DB permission test; **permission test on every add-on-completion write path**. |
| **4′** | **Add-on contributions are bounded, typed and versioned** *(replaces rescinded rule 4)* | `scoring` accepts add-on contributions **only** as typed completion events with a `contribution_version`. Caps live in `scoring/domain.py` as pure functions: **one course exists on the platform, purchasable once, +30 total**; interviews **+20 per session to a maximum of +60** (sessions beyond the third may be purchased but earn nothing). `questionnaire` and `interview` still import nothing from `scoring` — the dependency runs the other way, `scoring` reads their events. | Property test: no sequence of add-on completions, in any order or quantity, can push a score past its cap or past 990. `import-linter` contract inverted, still enforced in CI. **Re-verified end to end 2026-09-16**: four mock interview sessions bought, recorded and completed through the real routes give `addon_value` 20, 40, 60, 60; every session is a stored contributing event and the score replays exactly. |
| 5 | No age-gating | No `date_of_birth` / `age` column anywhere. No validator referencing 18. | Schema scan test failing on any column matching `dob\|date_of_birth\|age`. |
| 6 | No financial or lending framing | Banned-vocabulary check across source, migrations, schemas, locale files: "credit score", "loan", "creditworth", "eligibility score", "CIBIL". | `scripts/check_vocabulary.py` as a CI gate. |
| 7 | Employers see masked data **without an active access window** — and never the raw score at all | Discovery returns a `MaskedCandidate` schema that **structurally cannot** hold name, phone, email, or raw score. Revealed reads use a different schema and a different repository method. **Restructured in v6 (R14):** the gate is no longer a per-candidate `unlocks` row but **an active employer access window**. One check, one place: `require_active_access_window` on every revealing route. The revealed schema still carries the display score, never `raw_value`. | Contract test fuzzing discovery responses, asserting no PII field present; JSON shape snapshot; schema test asserting no employer response model has a `raw_value` field; **an expiry test — the window lapses mid-session and the very next read returns masked data**. |
| **7′** | **Every reveal of candidate PII is audited, even under blanket access** *(new in v6)* | Blanket access removes the natural one-row-per-unlock audit trail, but **PRD §3.9 does not stop applying** — every action revealing private data must be logged. So the audit moves to the read: each candidate profile an employer opens writes an `audit_events` row in the same transaction as the reveal. | Audit-count assertion on every revealing endpoint. **Volume test** — the audit path must survive an employer paging through thousands of profiles without becoming the bottleneck. |
| 8 | No job publish before KYB approval | `publish()` domain service raises unless `kyb_status == APPROVED`, backed by a Postgres trigger blocking `status='PUBLISHED'` for unverified employers. **v4:** with `kyb.auto_approve = true` in config, submissions are approved on arrival, so the gate passes trivially. **The gate, the trigger and this test all stay** — the config flag is the only thing that changed. | Integration test that bypasses the API and calls the repository directly — must still fail. Runs with `auto_approve = false` so the gate is genuinely exercised regardless of the production setting. |
| 9 | College consent required; every reveal audited | `student_consents` is joined by the query itself (inner join, not a Python `if`). Audit writes happen in the same transaction as the reveal. | Test that removing consent makes rows disappear from analytics; audit-count assertion on every reveal endpoint. |

**The pattern to internalise:** push each rule to the lowest layer that can enforce it —
database constraint > repository query shape > domain service > API schema > UI. The SRS is
explicit that clients must not carry business rules (SRS §2.24.1) and that tenant IDs come from
server context, never client input (SRS §2.24.7).

---

## 2. Architecture decision: modular monolith

**Build one deployable FastAPI application with hard internal module boundaries, plus a separate
worker deployable running the same codebase.** Not microservices.

Why:

- The PRD forbids per-surface backends (PRD §1.1) but says nothing about internal decomposition.
- Every high-risk invariant above is a *cross-entity transactional* concern — a PII reveal must
  check the access window and write its audit row atomically (7′); scoring must version-link to a
  resume *and* to the add-on completions folded into it (1, 4′); consent must join to analytics
  (9). Distributed transactions would make exactly the things the client will audit you on harder
  to get right. **v6 note:** the original form of this argument was "unlock must bill, reveal and
  audit atomically." R14 deleted that transaction, but the argument survives intact — the reveal
  still has to be atomic with its audit write, and there are now more of them, not fewer.
- One developer, four weeks. A service mesh buys nothing and costs days.

Boundaries are enforced by `import-linter` in CI, so extracting services later is mechanical
rather than archaeological. The two modules most likely to be extracted first — `scoring` and
`resume` parsing — sit behind explicit interfaces from day one.

**One contract inverted in v4.** The old rule was "`questionnaire` and `interview` must not import
`scoring`" — it existed to enforce invariant 4. Now that add-ons *do* move the score, the
dependency runs the other way: **`scoring` reads add-on completion events; the add-on modules
still import nothing from `scoring`.** The contract is not deleted, it is reversed and kept, so
the add-on modules can never reach in and write a score themselves.

```
                    ┌─────────────────────────────────────────┐
   4 clients ──────▶│  FastAPI app        (service: api)      │
   (mobile, 3 web)  │  routers → services → repositories      │
                    └──────────────┬──────────────────────────┘
                                   │ enqueue
                    ┌──────────────▼──────────────────────────┐
                    │  Celery workers     (service: worker)   │
                    │  parse · score · integrity · evaluate   │
                    │  notify · roster-import · expiry        │
                    └──────────────┬──────────────────────────┘
                                   │
       ┌───────────────┬───────────┴──────────┬────────────────┐
       ▼               ▼                      ▼                ▼
   PostgreSQL       Redis                   SQS               S3
   (RLS, audit)  (cache, locks)          (broker)     (resumes, audio)
                                                              ▲
                                              Cognito ────────┘
                                          (2 user pools, JWKS)
```

**Two deployables, one image.** `uvicorn app.main:app` and `celery -A app.worker worker` from the
same container image, so worker and API can never drift on model definitions.

---

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **FastAPI**, Python 3.12 | Async throughout. Pydantic v2 schemas double as the API contract. |
| ORM | **SQLAlchemy 2.0** async with `asyncpg` | 2.0 style only — `select()`, no legacy `Query`. |
| Migrations | **Alembic** | One migration per PR, never edited after merge. |
| DTOs | **Pydantic v2** | Separate `Create` / `Update` / `Read` schemas. Never expose ORM models directly. |
| **Identity** | **AWS Cognito** — two user pools *(decided, Q4)* | See [§5.7](#57-cognito-integration-decided). API verifies JWTs against pool JWKS; **role and tenant come from our DB, not from token claims.** |
| TOTP | **Cognito software-token MFA** (native) | Business and admin pool only (PRD §8). No `pyotp` needed. |
| **OTP + SMS delivery** | **Twilio Verify** (OTP) and **Twilio Messaging** (notifications) *(decided)* | Verify is called from the Cognito custom-auth Lambdas. Cognito's built-in SMS goes via SNS and is **not** used. See [§5.8](#58-otp-delivery-via-twilio-decided). |
| Background jobs | **Celery** with SQS broker, Redis result backend | SQS has no native ETA/countdown. Use **EventBridge Scheduler hitting a trigger endpoint** for periodic work (application expiry, DSR sweeps), not Celery Beat. |
| Cache, locks, rate limits | **Redis** via `redis.asyncio` | Also caches the membership lookup (60 s TTL) and holds OTP throttles. |
| Object storage | **boto3** with presigned URLs | Resumes and interview audio never public (SRS §1.4.2). |
| Audio | **Opus or AAC, mono, 16 kHz** *(audio-only, Q3)* | ~15–25 KB per 30 s answer. Sized for low-end Android on 2G. |
| **Scoring engine** | **Claude (extraction) + deterministic code (scoring)** | **Design settled — see `scoring-approach.md`, awaiting client approval.** The model reads the CV and returns schema-validated facts and bounded ordinal ratings; it **never emits a score or a total**. Points come from versioned weights in `scoring/domain.py`. The model's response is stored verbatim and `replay()` recomputes from storage, never re-invoking. ⚠️ **Note:** `temperature` has been removed from current Claude models — a request setting it is rejected — so determinism cannot come from sampling parameters. It comes from content-addressed caching plus stored responses instead. |
| **Structured outputs** | `client.messages.parse()` with Pydantic | The extraction schema is enforced by the API, not by the model's cooperation. Supported on Bedrock. This is also the prompt-injection defence — a schema with no score field cannot be talked into awarding one. |
| **Subscription billing** | Payment-provider subscription APIs behind our `BillingProvider` interface | Recurring charges are not one-off charges. If renewals are automatic, **UPI needs a per-subscriber e-mandate**, which is its own registration flow with its own limits. If renewal is manual repurchase, this collapses to the one-off path we already have. [Q11 in `questions.txt`](questions.txt). |
| Testing | **pytest**, `pytest-asyncio`, `httpx.AsyncClient`, `testcontainers-python` | Real Postgres in tests. Never SQLite — RLS and JSONB behave differently, and those are what you are testing. |
| Fixtures | **polyfactory** | Typed factories off the Pydantic and SQLAlchemy models. |
| Contract testing | **schemathesis** | Fuzzes the generated OpenAPI schema. Catches masking leaks well. |
| Lint and format | **ruff**, **mypy** strict on every `domain.py` | |
| Boundaries | **import-linter** | Enforces invariant 4 and the module layering. |
| Secrets | Env vars sourced from Secrets Manager, read once at boot | Never in code, never in the repo, never logged. |
| Observability | `structlog` JSON logs, OpenTelemetry traces | Correlation ID on every request and every job. |

**Deliberately deferred:** OpenSearch (use Postgres `pg_trgm` + `tsvector`), GraphQL, event
sourcing, a standalone scoring microservice.

---

## 4. Repository layout

```
bharatpath-backend/
├── app/
│   ├── main.py                    # FastAPI app factory, router registration
│   ├── worker.py                  # Celery app factory
│   ├── settings.py                # Pydantic Settings, env-driven
│   │
│   ├── core/
│   │   ├── db.py                  # async engine, session factory, RLS session dep
│   │   ├── tenant.py              # TenantContext — from DB membership, never request body
│   │   ├── cognito.py             # JWKS cache, token verification, admin API client
│   │   ├── deps.py                # current_user, require_role, require_tenant
│   │   ├── idempotency.py         # idempotency-key dependency and store
│   │   ├── pagination.py          # cursor pagination primitives
│   │   ├── errors.py              # AppError hierarchy → RFC 7807 responses
│   │   ├── audit.py               # audit_event() — the ONLY way to write audit rows
│   │   ├── outbox.py              # transactional outbox writer and relay
│   │   └── logging.py             # structlog config, PII redaction filter
│   │
│   ├── modules/
│   │   ├── identity/              # users, sessions, anonymous subjects, claim flow
│   │   ├── candidate/             # candidate profile, settings, language preference
│   │   ├── resume/                # upload, parse jobs, versions, review and confirm
│   │   ├── scoring/               # engine interface, versions, history, breakdown
│   │   ├── integrity/             # signals, severity policy, search suppression
│   │   ├── questionnaire/         # optional attribute questionnaire — no scoring import
│   │   ├── interview/             # audio sessions, chunk upload, evaluation, +20/session
│   │   ├── courses/               # NEW v4: catalogue, purchase, completion, +30 contribution
│   │   ├── employer/              # employer tenant, team members, roles
│   │   ├── kyb/                   # submissions, documents, review state machine
│   │   ├── jobs/                  # composer, validation, publish gate, lifecycle
│   │   ├── applications/          # apply, stages, withdraw, expiry, hire confirm
│   │   ├── discovery/             # masked search, access-window checks, reveal audit
│   │   ├── billing/               # payments, entitlements, signed callbacks
│   │   ├── subscriptions/         # NEW v4: plans, periods, renewal, cancellation, seats
│   │   ├── college/               # institution tenant, roster, invites, consent
│   │   ├── analytics/             # cohort aggregates, placement tracking
│   │   ├── admin/                 # queues, drill-downs, disputes
│   │   ├── notifications/         # event → channel fan-out, templates
│   │   ├── privacy/               # export and deletion requests, DSR tracking
│   │   └── engagement/            # ADDED 2026-09-13: daily streaks + engagement points — never the score (docs/streaks.md)
│   │
│   └── tasks/                     # Celery task definitions, thin wrappers over services
│
├── alembic/versions/
├── tests/
│   ├── unit/                      # pure domain logic, no DB
│   ├── integration/               # real Postgres via testcontainers
│   ├── contract/                  # schemathesis plus masking and leak assertions
│   └── invariants/                # one file per rule in §1 — never delete these
├── scripts/
│   ├── check_vocabulary.py        # invariant 6
│   ├── check_no_age_fields.py     # invariant 5
│   └── seed_dev.py
├── .importlinter                  # module boundary contracts
├── docker-compose.yml             # postgres, redis, localstack, mailhog, cognito-local
├── pyproject.toml
└── plan.md                        # this file
```

**Every module has the same internal shape:**

```
modules/<name>/
├── router.py        # FastAPI routes — HTTP concerns only, no business logic
├── schemas.py       # Pydantic request/response DTOs
├── models.py        # SQLAlchemy ORM models
├── repository.py    # all DB access for this module
├── service.py       # business rules, transaction boundaries
├── domain.py        # pure functions, state machines, no I/O  (mypy strict)
└── events.py        # domain events this module emits
```

Rule: **routers never touch repositories; services never touch `Request`.** A module may import
another module's `service`, never its `repository` or `models`. That one rule is what makes later
extraction possible, and `import-linter` checks it so it does not depend on discipline.

**This layout is also what makes AI-assisted generation fast.** Twenty modules with an
identical seven-file shape is a template you fill, not nineteen designs. Generate the skeleton
for all of them on Day 1 and the rest of the sprint is filling in `domain.py` and `service.py`,
which is where the actual thinking lives.

---

## 5. Cross-cutting foundations

These exist before feature work (Week 1) because retrofitting any of them is a rewrite.

### 5.1 Tenant isolation — the highest-risk requirement

SRS §2.24.7 is blunt: Employer A must never query Employer B's data, and tenant IDs must come from
server context. Defence in depth, three layers:

1. **Postgres Row-Level Security.** Every tenant-scoped table carries `tenant_id`. Policy:
   `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. The application connects as a
   role that is not the table owner and does **not** have `BYPASSRLS`.
2. **Session-scoped setting.** The DB session dependency issues `SET LOCAL app.tenant_id = :tid`
   at the start of every transaction, with `tid` resolved from the authenticated user's
   membership. `SET LOCAL` dies with the transaction, so a pooled connection cannot carry tenancy
   across requests.
3. **Repository-level filter** as belt and braces, plus an integration suite that, for every
   tenant-scoped endpoint, authenticates as tenant A and requests tenant B's resource ID —
   expecting **404, not 403**, since 403 confirms the resource exists.

Admin roles use a **separate session factory** that assumes a bypass role, and every such session
emits an audit event. There is no "admin flag" on the normal session — the two are different code
paths.

### 5.2 Audit trail — append-only, in-transaction

PRD §3.9 and SRS §2.24.5. Must be append-only from the application path and searchable by actor,
action, target, and time (SRS §2.25.4).

- Table `audit_events(id, actor_id, actor_role, action, target_type, target_id, tenant_id, metadata jsonb, occurred_at, request_id)`.
- Application DB role is granted `INSERT` and `SELECT` only. `REVOKE UPDATE, DELETE`.
- Written **inside the same transaction as the reveal it records**. If the audit write fails, the
  reveal rolls back. That is the entire point — do not make it async.
- Archived nightly to S3 with Object Lock in compliance mode for tamper-evidence.
- **Do not use QLDB** — AWS has deprecated it. Append-only Postgres plus Object Lock archival is
  the current-correct answer when someone asks why not a ledger database.

### 5.3 Idempotency

SRS §2.24.4 names six operations: payment, **unlock**, application creation, publishing, hire
confirmation, roster import. **Five of the six survive in v6** — R14 deleted the unlock
transaction, so there is no unlock request to make idempotent. Subscription purchase and renewal
take its place and are added to the list, because a double-charged renewal is the same failure
in a different coat. So: payment, subscription purchase/renewal, application creation, publishing,
hire confirmation, roster import. Implement once as a FastAPI dependency:

```
POST with header  Idempotency-Key: <client uuid>
  → table idempotency_keys(key, endpoint, request_hash, response_status,
                           response_body jsonb, state, created_at, expires_at)
  → INSERT ... ON CONFLICT DO NOTHING        (the row is the lock)
  → exists, COMPLETED, request_hash matches  → replay stored response
  → exists, request_hash differs             → 422 idempotency key reuse
  → exists, IN_PROGRESS                      → 409 with Retry-After
```

24-hour retention. Applied by decorating the route, and a test asserts all six operations above
carry the dependency, so it cannot be silently forgotten.

### 5.4 Transactional outbox

Notifications, analytics rollups, and search reindexing must not fire on a transaction that later
rolls back. Domain events append to an `outbox` table inside the business transaction; a relay task
polls and publishes to SQS/EventBridge with at-least-once delivery. Consumers are idempotent by
event ID.

### 5.5 Error contract

RFC 7807 `application/problem+json` for every error, with a stable machine-readable `code`. All
four clients must localise error messages (PRD §8: no hardcoded user-facing strings), so the API
returns codes and parameters and clients own the copy. **The backend never returns a user-facing
English sentence as the display string.**

### 5.6 Configuration and feature flags

Score base (**700**), score ceiling (**990**), resume judgment band (**0–200**), add-on
contribution caps (**course +30, once, one course**; **interview +20/session to +60**),
`scoring.model_id`, `scoring.prompt_version`, `scoring.rubric_version`, **`kyb.auto_approve`**, integrity
severity thresholds, application expiry window, subscription and course pricing, **per-tenant view
caps (hourly and daily, R14)**, and the pipeline stage set are all **configuration versioned in the
database**, not constants.

**This is what made the v4 rewrite survivable.** Every number the client changed on 27 August was
already a config row, so the floor moving from 680 to 700 and the ceiling from 999 to 990 is a
seed-data change, not a migration and not a code change. Keep it that way — the numbers in
`questions.txt` will move again. The SRS says integrity rules are "configuration-driven and versioned" (SRS §1.4.5), and
the scoring specification arrives later under NDA. Assume every number in the spec will change at
least once.

### 5.7 Cognito integration *(decided, Q4)*

**Two user pools**, matching the two authentication models the PRD requires:

| Pool | Users | Mechanism |
|---|---|---|
| `bharatpath-candidates` | Candidates / students | Custom auth flow (phone OTP) via three Lambda triggers; Google as a federated IdP; email as a standard flow |
| `bharatpath-business` | Employer, college, admin users | Username + password, software-token MFA **optional, off by default** (client 2026-10-07, was required under SRS §1.3.4) |

**How the API uses it:**

- Verify the RS256 JWT against the issuing pool's JWKS, cached in memory with periodic refresh.
  Validate `iss`, `token_use`, `client_id`, and expiry. Reject tokens from the wrong pool for the
  route's surface.
- **Authorization does not come from Cognito.** Role and tenant are read from our `memberships`
  table on every request, cached in Redis for 60 seconds. Cognito groups and custom claims are
  *not* the authority.

  This is a deliberate decision worth defending: token claims go stale. If an employer removes a
  recruiter, that recruiter's existing access token would remain valid until expiry — a
  membership revocation that does not take effect is exactly the tenant-isolation failure SRS
  §2.24.7 forbids. A 60-second Redis cache on a DB read costs microseconds and revokes in
  seconds.
- `cognito_sub` is stored on `users` as the external identity link. Our `users.id` remains the
  internal primary key — never expose `cognito_sub` in an API response.

**The anonymous-to-account flow is deleted.** *(Client, 2026-08-27 — see [§13](#resolved))*

v3 carried a guest-session design because PRD §4.1 and SRS §2.25.1 required a candidate to reach
their first score before creating an account. The client has reversed that:

> "Without login the user cannot parse the resume / cannot get a score."
> "Only Sign Up is allowed, nothing else, not even the resume upload."

So there is no `anonymous_subjects` table, no `POST /api/v1/public/session`, no opaque guest
token, and no claim transaction. **Every candidate route requires a verified Cognito JWT**, resume
upload included. `/api/v1/public/*` shrinks to genuinely public reads only.

**This is a net simplification and a net risk reduction.** It removes the sprint's
highest-design-risk half-day (the claim transaction re-parenting resume versions and scores
between two different subject types), collapses `subject_id` polymorphism to a plain
`user_id` foreign key, and removes the DPDP exposure of holding a complete resume — full name,
phone, employment history — for an unauthenticated user we cannot contact.

> **Still needs paper.** SRS §2.25.1 lists "Candidate can reach the first score before mandatory
> account creation" as an acceptance criterion, and the build is graded against §2.25. A margin
> comment does not amend an acceptance criterion. [Q12 in `questions.txt`](questions.txt).

**What Cognito does not solve.** Custom auth for phone OTP requires three Lambda triggers
(`DefineAuthChallenge`, `CreateAuthChallenge`, `VerifyAuthChallenge`) that are **infrastructure**,
not application code — they are on the dependency list in [§12](#12-external-dependencies). And
Cognito's built-in SMS routes through SNS, which we are not using — OTP delivery is Twilio's job.
See [§5.8](#58-otp-delivery-via-twilio-decided).

### 5.8 OTP delivery via Twilio *(decided)*

**Twilio Verify**, called from inside the Cognito custom-auth Lambdas. Cognito owns the session and
issues the tokens; Twilio owns code generation, delivery, expiry, retry, and abuse controls.

```
Candidate enters phone
   │
   ▼
POST /api/v1/auth/otp/start          ← our app: outer throttle + audit only
   │
   ▼
Cognito InitiateAuth (CUSTOM_AUTH)
   │
   ├─ DefineAuthChallenge   → issue CUSTOM_CHALLENGE
   └─ CreateAuthChallenge   → Twilio Verify: verifications.create(to, channel="sms")
                              (Twilio generates and sends the code — we never see it)
   ▼
Candidate enters code
   │
   ▼
Cognito RespondToAuthChallenge
   │
   └─ VerifyAuthChallenge   → Twilio Verify: verificationChecks.create(to, code)
                              → approved? issue tokens : fail the challenge
```

**Why Verify rather than raw Twilio Messaging.** Verify handles code generation, single-use
enforcement, expiry, resend throttling, and carrier-level fraud controls — all of which SRS §1.3.1
requires ("OTP attempts must be rate limited", "expired OTPs cannot be reused") and all of which
would otherwise be code we write and test. It also means **no OTP value ever touches our database
or logs**, which removes a real class of leak. The `otp_challenges` table from the original design
is gone.

We keep one thing on our side: a **coarse outer throttle** in Redis keyed by phone and by IP, in
front of the Cognito call. Twilio's limits protect Twilio's spend; ours protects against someone
walking the phone-number space. Both are needed.

**Two call sites, one Twilio account:**

| Purpose | Product | Lives in |
|---|---|---|
| Candidate login OTP | Twilio **Verify** | Cognito Lambda triggers (**infra scope**) |
| Notification SMS (application status, invites) | Twilio **Messaging** | Our `SmsProvider` interface (**our scope**, Day 19) |

That split matters for the engagement boundary: **the Twilio credentials for OTP live in a Lambda
you do not own.** Whoever provisions the Lambdas needs the Twilio Account SID, Auth Token, and
Verify Service SID in Secrets Manager. Flag it early — it is the kind of handoff that surfaces on
Day 3 and costs a day.

**Twilio test credentials unblock Day 3.** Twilio provides test credentials and magic numbers that
exercise the full API without sending real messages or incurring cost. The OTP path can therefore be
built and integration-tested **for real** during the sprint rather than against a stub — a genuine
improvement to the plan's risk profile, since authentication is no longer carrying stub risk into
Week 2.

**DLT is still required — Twilio does not remove it.** This is the most common misconception about
using an international provider for Indian SMS. TRAI's DLT regime binds the *sender*, not the
gateway: you still register a Principal Entity, a sender ID (header), and message templates on a
DLT platform, and link the resulting entity and template IDs to your Twilio account. Twilio has a
documented onboarding process for exactly this. Undelivered-to-India traffic without it is the
default outcome, not an edge case.

> **Ask Twilio directly, early:** whether Verify's India SMS templates are pre-registered under
> Twilio's own entity or must be registered under the client's. The answer changes the lead time
> materially, and it is not something to assume in either direction.

**Cost note.** Verify is priced per verification rather than per message — roughly an order of
magnitude above raw SMS. Immaterial in dev (a few dollars across the sprint on test credentials),
but at production volume the difference between per-verification and per-message pricing is a real
number. Worth modelling before launch, not after — and worth knowing that Design B below exists as
the cheaper fallback.

**Fallback design, if the client wants message branding or cheaper unit economics:** generate the
code in `CreateAuthChallenge`, send it with Twilio **Messaging** against a DLT-registered template,
and compare in `VerifyAuthChallenge`. More code, full control of the message body, per-SMS pricing.
The interface boundary is identical, so this is a swap inside the Lambdas — it does not touch our
application code.

---

## 6. Data model — the spine

Not exhaustive. These are the tables the invariants hang off. The full schema arrives with the
NDA'd API contracts (PRD §10) — expect to reconcile.

**Identity and tenancy**

```
users(id, cognito_sub, pool, phone, email, status, locale, created_at)
tenants(id, type[EMPLOYER|COLLEGE], name, status)
memberships(id, user_id, tenant_id, role, status)      -- 9 roles, SRS §1.2
otp_throttles                                          -- Redis, not Postgres
```

**`anonymous_subjects` is gone in v4.** Sign-up gates every candidate action, so there is no
subject that is not a user. Everything that pointed at `subject_id` now points at `user_id`.

Sessions and refresh tokens are Cognito's concern, not ours. We store no password hashes and no
TOTP secrets — that removes an entire class of liability from the codebase. **There is no
`otp_challenges` table**: Twilio Verify generates and checks the code, so no OTP value is ever
persisted or logged on our side ([§5.8](#58-otp-delivery-via-twilio-decided)). `otp_throttles` in
Redis is our outer rate limit only, not code storage.

**Resume and score — the reproducibility chain**

```
resume_files(id, user_id, s3_key, mime, bytes, scan_status, uploaded_at)
resume_versions(id, user_id, source[UPLOAD|PASTE|MANUAL], parsed jsonb,
                confirmed_at, supersedes_id, created_at)
scores(id, user_id, resume_version_id, algorithm_version,
       raw_value int, base_value int, addon_value int,
       contributing_events jsonb, contribution_version,
       model_id, prompt_version, prompt_hash,          -- extraction chain
       raw_model_response jsonb, extracted_features jsonb,
       taxonomy_version, rubric_version,
       breakdown jsonb, computed_at)

resume_extractions(cache_key, model_id, prompt_version, schema_version,
                   raw_response jsonb, extracted_features jsonb, created_at)
                   -- cache_key = sha256(normalised_text + model + prompt + schema)
```

`scores` is INSERT-only with no UPDATE grant. The displayed value is derived at serialization,
never stored. "Score history" is simply all rows of `scores` — never deleted, never mutated.

**`suggestions` is gone in v5** — the client confirmed the score is never explained to the
candidate, so there is nothing to suggest. `breakdown` stays: admin drill-down and dispute
handling need it, and no candidate-facing schema may expose it.

**`resume_extractions` is the reproducibility spine** (`scoring-approach.md` §6). Content-addressed
on the normalised CV text, so the model is called exactly once per distinct CV and two identical
CVs share one entry — which is what makes cross-candidate consistency exact rather than
probabilistic. Re-scoring after a course purchase reads this table and never calls the model.

**Three columns are new in v4, and invariant 1 depends on all three.** Now that a course or an
interview moves the score, `resume_version_id` alone no longer reproduces it. `base_value` is the
resume-derived part, `addon_value` is the bounded sum of contributions, and
`contributing_events` records exactly which completions were folded in, with their IDs. Without
that, `replay(score_id)` recomputes a base score and disagrees with the stored total the first
time anyone buys a course. **Write the replay test for an add-on-carrying score on Day 8, not
Day 16.**

**Integrity**

```
integrity_signals(id, candidate_id, resume_version_id, rule_id, rule_version,
                  severity, evidence jsonb, state, resolved_by, resolved_at)
```

**Duplicate and templated-resume detection is dropped** *(client comment, 2026-08-24:
"Don't flag for duplicates")*. Timeline-inconsistency checking and the severity/suppression
machinery stay. The table and the rule engine are unchanged — one rule simply is not registered.

> **Do not confuse this with duplicate *application* prevention** — one candidate applying twice
> to the same job. That is a different mechanism entirely (a partial unique index on
> `applications`), it is untouched, and it stays.

**Employer side**

```
employers(tenant_id, legal_name, employer_type, industry, kyb_status, verified_at)
kyb_submissions(id, tenant_id, state, submitted_at, reviewed_by, decision_reason)
kyb_documents(id, submission_id, doc_type, s3_key)
jobs(id, tenant_id, title, description, skills, salary_min, salary_max,
     min_score int, status, published_at, closed_at)
applications(id, job_id, candidate_id, stage, created_at, expires_at)
application_events(id, application_id, from_stage, to_stage, actor_id, occurred_at)
```

`salary_min` and `salary_max` are `NOT NULL` — PRD §5.2 makes salary range mandatory.
`applications` carries a partial unique index on `(job_id, candidate_id)` where stage is
non-terminal, which makes the duplicate-application rule a database guarantee rather than a race
condition.

`employer_type` and `industry` are new in v4 *(client note, 2026-08-27: "Employer — MNC,
Industry")*. Both must be **enumerated**, not free text, or they cannot back a filter or a pricing
tier — the client owes us the two lists ([Q9 in `questions.txt`](questions.txt)). Ship the columns
as constrained enums seeded from config so the values can be extended without a migration.

`kyb_status` stays, and so does the publish gate. `kyb.auto_approve` defaults to **true** in v4,
which moves a submission straight to `APPROVED` on arrival. See [§13](#resolved) — this one is
provisional, the client has said both things.

**Discovery and billing**

```
payments(id, user_id, provider, provider_ref, amount_minor, status,
         signature_verified_at, raw_callback jsonb)
entitlements(id, user_id, product, granted_by_payment_id, consumed_at, expires_at)

candidate_view_events(id, tenant_id, actor_id, candidate_id, viewed_at)
                      -- the audit spine for invariant 7'; partitioned by month
```

> **`unlocks` and `wallet_ledger` are deleted in v6.** *(Client, 2026-08-27: the employer "pays
> once, and for that time frame every student is unlocked automatically ... they can view anyone
> in the whole database.")* There is no per-candidate purchase, so there is nothing to bill per
> candidate, nothing to debit, and no unlock row to make unique. **The entitlement is the
> subscription window itself.**
>
> This is the single largest simplification in the project — and it moves the risk rather than
> removing it. See [§13 R14](#resolved-in-v6--client-answers-2026-08-27-late).

**Subscriptions, courses and seats** *(new in v4 — client comment, 2026-08-24)*

The revenue model in v3 was a prepaid employer wallet plus one-off candidate purchases. The client
has replaced it: **candidates pay a subscription (monthly / quarterly / semester / annual, nothing
free), plus courses, plus the mock interview; employers pay a flat fee or tier; colleges are a
B2B deal with a seat count assigned by our admin.**

```
plans(id, audience[CANDIDATE|EMPLOYER|COLLEGE], code, period,
      price_minor, entitlements jsonb, seat_allowance int, active, version)
subscriptions(id, subscriber_type, subscriber_id, plan_id, state,
              current_period_start, current_period_end, cancel_at,
              renews_automatically bool, mandate_id, created_at)
subscription_events(id, subscription_id, from_state, to_state, reason, occurred_at)
upi_mandates(id, subscription_id, provider_mandate_ref, state, max_amount_minor,
             valid_until, revoked_at)          -- only for the auto-renew path

courses(id, code, title, price_minor, contribution_points, active, version)
course_purchases(id, user_id, course_id, payment_id, purchased_at)
course_completions(id, user_id, course_id, completed_at, contribution_version)

college_seats(tenant_id, seats_allocated int, seats_used int, allocated_by, updated_at)
```

Four things to hold on to:

- **`course_completions` is a score-moving write.** It belongs to invariant 3's blast radius:
  role-restricted, audited, and never writable by the candidate directly.
- **`contribution_points` lives on the course row and is versioned**, not hardcoded to 30. The
  client will change it.
- **Recurring billing is a different system to one-off charges** — renewal, dunning, proration,
  cancellation, grace periods, and reinstatement are all state this schema has to carry. Whether
  renewal is automatic (UPI e-mandate, a per-subscriber registration flow) or a manual repurchase
  changes the integration substantially and is [Q11 in `questions.txt`](questions.txt).
- **Employer access is a time window, not a quota** *(R14)*. One payment, one period, unlimited
  visibility. `subscriptions` **is** the employer entitlement — there is no separate unlock
  record, no counter, and nothing to decrement. Access checks reduce to: *is there an active,
  non-lapsed subscription for this tenant right now?*
- **College seats:** `plans.seat_allowance` carries the student count. We have recommended a
  single payment per period covering up to N students, mirroring the employer model rather than
  introducing tiers the employer side just rejected — awaiting confirmation
  ([`questions.txt`](questions.txt)).
- **Both renewal paths are in scope** *(R17)*: manual repurchase and UPI AutoPay e-mandate, with
  the candidate choosing. `upi_mandates` exists only for the second. **Note this is two billing
  flows, not one** — see [§13 R17](#resolved-in-v6--client-answers-2026-08-27-late) for what that
  costs and why we suggest sequencing them.

**Interview** *(audio-only, in-app — Q1 and Q3)*

```
interview_sessions(id, user_id, entitlement_id, state, question_set_version,
                   device_check_id, contribution_version, started_at, completed_at)
interview_answers(id, session_id, question_index, s3_key, duration_ms,
                  upload_state, uploaded_at)
device_checks(id, user_id, mic_ok, audio_out_ok, network_kbps, storage_mb,
              quiet_env_ok, passed, checked_at)
```

No camera field, no video field, no lighting field. See [§13](#resolved).

**A completed session now contributes +20 to the score, to a maximum of +60 across all
sessions.** The cap is enforced in `scoring/domain.py`, not here — this table only records that a
session finished. Counting completed sessions and clamping the total is the scoring module's job,
and invariant 4′'s property test is what proves the clamp holds.

**College side**

```
colleges(tenant_id, name, verified_at)
roster_imports(id, tenant_id, file_s3_key, total_rows, valid_rows, state)
roster_entries(id, import_id, tenant_id, phone, email, match_user_id, invite_state)
student_consents(id, tenant_id, candidate_id, scope[ROSTER|INDIVIDUAL],
                 granted_at, revoked_at, granted_via[INVITE|REFERRAL_CODE])
referral_codes(id, tenant_id, code, created_by, max_uses, uses, expires_at,
               revoked_at, created_at)         -- college → existing student linking
```

Analytics INNER JOINs `student_consents`. Revocation sets a timestamp; it never deletes a row.

**Referral codes are new in v6** *(client, 2026-08-27)*: where a student already has an account,
the college generates a code, the student enters it in the app, and the two records link. Three
things this needs that a naive implementation misses:

- **Entering a code is a consent act**, so it writes a `student_consents` row with
  `granted_via = REFERRAL_CODE`. It is arguably *better* consent than invite-accept, because the
  student takes a deliberate action rather than clicking a link in a message.
- **It grants `ROSTER` scope only.** Individual visibility stays a separate, explicit grant —
  PRD §3.8 requires the two to be distinct and a code cannot silently confer both. Confirm with
  the client, but do not implement it any other way in the meantime.
- **Codes are credentials.** Non-guessable (not sequential, not short), rate-limited on entry,
  revocable, and expiring. A guessable code lets anyone attach themselves to a college roster, or
  lets a college harvest students who never agreed to anything.

**Cross-cutting**

```
audit_events(...)             -- §5.2
idempotency_keys(...)         -- §5.3
outbox(...)                   -- §5.4
config_values(key, value jsonb, version, effective_from)
dsr_requests(id, user_id, type[EXPORT|DELETE], state, due_at, completed_at)
tenant_suspensions(id, tenant_id, reason, suspended_by, suspended_at, lifted_at)
```

`tenant_suspensions` is new in v4 — the client asked for "stop operations in backend admin" on
the college side. Model it as a tenant-level suspension rather than a college-only feature; the
same control is what you will want for a fraudulent employer, and auto-approved KYB makes that
more likely, not less.

Two modelling decisions worth defending in review:

- **Money is `*_minor` integers** (paise). Never floats, never `Decimal` at the API boundary.
- **Consent revocation is a timestamp, not a deletion** — you must be able to prove what was
  visible to whom on a given date.

---

## 7. API conventions

Fix these on Day 1. Changing them later means changing four clients.

- **Base path** `/api/v1`. Version in the path, never in a header.
- **Surface-scoped routers** for readability, one app:
  `/api/v1/candidate/*`, `/api/v1/employer/*`, `/api/v1/college/*`, `/api/v1/admin/*`,
  plus `/api/v1/auth/*` and `/api/v1/public/*`.
  This is namespacing for clarity — **authorisation is by role and tenant, never by path
  prefix**. A candidate hitting an `/employer/*` route is rejected by the role dependency, not by
  routing.
- **Cursor pagination**, not offset. `?cursor=<opaque>&limit=50`, response
  `{ items, next_cursor, total? }`. `total` appears only where it is cheap and safe
  (SRS §2.24.2 explicitly says show totals only where the API can safely provide them).
- **Async operations** return `202` with `{ job_id, status_url }`. Clients poll `status_url`.
  Applies to parsing, scoring, integrity, interview evaluation, roster import (SRS §2.24.3).
- **Errors** are RFC 7807 with a stable `code`. Never leak internal identifiers or SQL.
- **Timestamps** are UTC ISO-8601 with `Z`. The client renders IST; the server never does.
- **Enums are SCREAMING_SNAKE strings** matching the SRS state names exactly
  (`SUBMITTED`, `VIEWED`, `SHORTLISTED`, `INTERVIEW`, `HIRED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`).
- **OpenAPI is the deliverable.** Export `openapi.json` on every merge to `main` and publish it —
  the mobile and web developers generate clients from it. In a 4-week sprint with parallel client
  teams, publish it from **Day 2** with stub endpoints, so they are never blocked on you.

---

## 8. The four-week build

### 8.0 What four weeks buys — and what it does not

The compression from the original 21-week estimate is real but conditional. State these
assumptions to the client in writing, because the schedule only holds if they are true:

> **v4 has not been re-cut into the twenty days below.** The client's 27 August changes remove
> roughly a day and a half of work and add four to six. The day plan that follows reflects the new
> *scope*; it does not yet reflect a new *schedule*. Re-baseline before committing to a date.
>
> | Comes out | Goes in |
> |---|---|
> | Anonymous subject + claim transaction (Day 4, ~0.5 d) | Composite scoring: contributions, caps, rescore triggers, extended replay (Days 8 + 16, ~1.5 d) |
> | KYB document review + admin queue (Days 10, 19, ~1 d) | Subscription billing: plans, periods, renewal, cancellation (Week 3, ~2 d, more with UPI mandates) |
> | Duplicate-resume rule (Day 9, hours) | Courses module: catalogue, purchase, completion (~1 d) |
> | KYB vendor integration (off the dependency list entirely) | College seats + tenant stop-operations (~0.5 d) |
> | | Employer taxonomy, nudge campaign (~0.5 d) |
>
> The additions concentrate on Days 8, 14 and 15 — the three days [§8.0](#80-what-four-weeks-buys--and-what-it-does-not)
> already named as the ones that will not compress. That is the schedule risk in one sentence.

**Assumed, and the plan depends on it:**

1. **AI-assisted generation across the whole codebase** — 20 modules with an identical seven-file
   shape, CRUD layers, Pydantic schemas, Alembic migrations, and the first draft of every test
   suite. This is where the multiple genuinely comes from: boilerplate goes from days to hours.
2. **Most external vendors stay stubbed** behind interfaces. Payments, KYB, and speech-to-text are
   not integrated inside the four weeks — their lead times ([§12](#12-external-dependencies))
   exceed the sprint on their own. **Twilio is the exception**: its test credentials let the OTP
   path be built for real on Day 3, so authentication carries no stub risk into Week 2. Only the
   switch to live delivery is DLT-gated.
3. **The scoring engine stays `v0-placeholder`.** The real algorithm is NDA-gated and has not
   arrived. v4 adds shape to it — base 700, ceiling 990, a 200-point judged band, +30 courses,
   +60 interviews — but **the arithmetic the client sent does not close** (700 + 200 = 900, not
   990) and the judged band may or may not be an LLM. See [Q1–Q5 in `questions.txt`](questions.txt).
   The placeholder implements the *structure* — base plus bounded contributions, clamped to the
   ceiling — so that only the numbers change when the real spec arrives.
4. **Infrastructure is provisioned and ready by Day 1** — including the Cognito pools and their
   three Lambda triggers. A day lost waiting on infra is a day lost from the sprint, and there is
   no slack in it.
5. **The blocking questions in `questions.txt` answered by Day 8.** Q1 and Q2 (score arithmetic
   and whether it is LLM-judged) block Day 8. Q8 (what an employer tier includes) blocks Day 14.
   Q6 (deletion vs. audit) has a legal review cycle attached, so ask by Day 8 to have it by Day 20.
6. Full-time, uninterrupted work. No parallel client meetings eating build days.

**What is delivered at the end of Week 4:** a code-complete backend — every endpoint, the full
schema, all state machines, all ten invariants enforced and tested, OpenAPI published, running
against stubs. That is a real, demonstrable, integration-ready system.

**What is not delivered, and needs Week 5+:** vendor swap-ins as credentials arrive, load testing
and performance tuning, penetration testing, localisation content for 6–8 languages, real
algorithm integration, and operational runbooks. **The backend is code-complete in four weeks; it
is launchable when the external dependencies land.** Those are two different dates, and the
client should be told both.

**The honest risk:** AI accelerates writing code far more than it accelerates *deciding* what the
code should do. The days below that are dense with judgment — Day 8 (score reproducibility and the
extraction chain), Day 14 (access-window expiry and reveal audit at volume), Day 15 (two billing
flows, one of them a UPI e-mandate), Day 18 (consent-gated analytics) — will not compress the way
the CRUD days will. If the schedule slips, it slips there. Protect those
days.

---

### Week 1 — The security spine · Days 1–5

The one week where speed must not win over care. Everything after this rests on it.

**Day 1 — Scaffold and CI**
- Repo per [§4](#4-repository-layout); `pyproject.toml`, ruff, mypy, pre-commit, `.importlinter`.
- `docker-compose.yml`: Postgres 16, Redis, LocalStack (S3/SQS), Mailhog.
- Settings via Pydantic Settings. `GET /api/v1/health` with DB and Redis liveness.
- **Generate all 20 module skeletons** — seven files each, empty but wired and registered.
  (§4 lists twenty: v4 added `courses` and `subscriptions` to the original eighteen.
  Earlier revisions said "19" against a list of twenty — corrected in v6.1.)
- CI: lint, type-check, test against a real Postgres service, build image, export `openapi.json`.
- `scripts/check_vocabulary.py` and `check_no_age_fields.py` green in CI (invariants 5 and 6 done
  on Day 1 — they cost an hour and run forever).

**Day 2 — Schema and the transactional foundations**
- All core tables from [§6](#6-data-model--the-spine) in one Alembic baseline migration.
- RLS policies on every tenant-scoped table; app role created without `BYPASSRLS`.
- Session dependency issuing `SET LOCAL app.tenant_id`. Separate admin session factory.
- `audit_events` with `UPDATE`/`DELETE` revoked; `audit_event()` helper.
- `idempotency_keys` table and dependency; `outbox` table and relay task.
- **Publish `openapi.json` with stub endpoints** so the client teams can start.

**Day 3 — Cognito and Twilio wiring**
- JWKS fetch and cache; token verification for both pools; pool-to-surface enforcement.
- Candidate phone OTP through the custom auth flow, **Twilio Verify against test credentials**
  ([§5.8](#58-otp-delivery-via-twilio-decided)) — a real integration, not a stub.
- Redis outer throttle on OTP start, keyed by phone and by IP.
- Google federation; email flow.
- `cognito_sub` linkage, user resolve-or-create on first sign-in.

> Confirm on Day 1, not Day 3: who deploys the Lambda triggers, and that they will hold the Twilio
> credentials. This is the sprint's most likely cross-team stall.

**Day 4 — Authorisation** *(lighter in v4 — the anonymous flow is gone)*
- Business pool: password + software-token MFA enrolment, verification, recovery.
- `memberships`, the 9 roles from SRS §1.2, `require_role` / `require_tenant` dependencies,
  Redis-cached membership lookup.
- **Every candidate route now requires a verified JWT, resume upload included**
  ([§5.7](#57-cognito-integration-decided)). Assert it: a route-table test that fails if any
  `/candidate/*` route is missing the auth dependency.
- **Removed in v4:** anonymous subject creation, the opaque guest token, and the claim
  transaction. This was the sprint's highest-design-risk half-day. Spend the recovered time on
  Day 8, which just got harder.

**Day 5 — Prove the spine, then gate**
- Cross-tenant test suite: every tenant-scoped endpoint, tenant A asking for tenant B's ID → 404.
- Role × endpoint permission matrix test across all 9 roles.
- Audit-table permission test; membership revocation propagation test (≤ 60 s).
- **No-anonymous-access test:** every `/candidate/*` route rejects an unauthenticated request.

> **Week 1 gate.** Cross-tenant suite green. Permission matrix green. Audit rejects UPDATE and
> DELETE as the app role. No candidate route is reachable without a verified JWT. **Do not start
> Week 2 until all four hold** — every later day assumes them.

---

### Week 2 — Candidate pipeline and employer core · Days 6–10

**Day 6 — Resume intake**
- **Authenticated only** — there is no guest upload path in v4.
- Presigned-URL upload, type sniffed from content, size cap, private bucket, no public URLs.
- Security-scan hook before processing. A failed upload must not create a partial resume record —
  enforce with a transaction boundary, not cleanup logic.
- Paste-text and manual structured-form paths (PRD §4.2).
- `ResumeParser` interface + Textract implementation; `parse_resume` Celery task.

**Day 7 — Versions, review, confirm**
- `resume_versions` with `supersedes_id`; edits create versions, never update.
- Review and edit endpoints; **mandatory confirm gate** — an unconfirmed version can never reach
  scoring (SRS §1.4.4).
- `202` + status polling across the intake flow.

**Day 8 — Scoring** *(high-judgment day — protect it; v4 made it harder)*
- `ScoringEngine` interface:
  `score(structured_resume, version, addon_events) -> ScoreResult`.
  The second argument is new — the engine is now a pure function of *resume plus completions*.
- `v0-placeholder` implementation with documented, obviously-provisional weights, structured as
  **base + bounded contributions, clamped to the ceiling**, so the real spec changes numbers only.
- `scores` table, `scoring.persist()` as the sole write path, INSERT-only grants.
- **Display floor (700) at the serialization boundary only.** Write this test first.
- **Contribution caps as pure functions in `domain.py`** — course +30, interview +20/session
  to +60, total clamped at 990. Property-test them: no ordering or quantity of completions can
  exceed a cap. **Invariant 4′ green.**
- `replay(score_id)` + golden corpus — **including a score that carries add-on contributions.**
  A replay that only reproduces base scores is a replay that breaks the first time someone buys
  a course.
- Recalculation triggers: on resume change **and** on course completion **and** on interview
  completion, all via the outbox so a rolled-back purchase never moves a score.
- **No candidate-facing explanation.** *(Client, 2026-08-27: "The score is never explained to the
  user.")* No breakdown screen, no category detail, no improvement suggestions. The breakdown is
  still **computed and stored** — admin drill-down and dispute handling need it — but no
  candidate-facing schema may expose it. Enforced by a schema test, not by remembering.
  **Contradicts PRD §4.2**, which promises a category-by-category breakdown and top improvement
  suggestions; needs written rescission (`questions.txt` Q12).
- **Knock-on:** PRD §4.5 says a job listing shows the candidate "what would need to improve" if
  they miss a threshold. That is an explanation. Either it goes too, or eligibility messaging stays
  generic ("your score does not meet this employer's threshold") with no reasoning. We are building
  the generic version — flag it.
- Shareable card: band by default, exact number on explicit opt-in, opaque revocable token.
- **Invariants 1, 2, 3, 4′ green.**

> **The arithmetic is settled** *(client, 2026-08-27)*: 700 base + 0–200 resume + 30 course +
> 60 interviews = 990 exactly. **The approach for the 200-point band is designed** and written up
> in `scoring-approach.md` — model extracts facts, code assigns points, response stored for
> replay. **Do not start building it until the client approves that document**, and until the
> data-residency question in its §13 is answered, because that determines which client library
> the module is built against.

**Day 8 additions from `scoring-approach.md`:**
- Extraction layer behind a `ResumeExtractor` interface: strict Pydantic schema, `messages.parse()`,
  pinned `model_id`, no sampling parameters (they are rejected on current models).
- **Content-addressed extraction cache** keyed on `sha256(normalised_text + model_id +
  prompt_version + schema_version)`. One model call per distinct CV, ever. Identical CVs are
  guaranteed identical scores because they share a cache entry.
- Store `model_id`, `prompt_version`, `prompt_hash`, `raw_model_response`, `extracted_features`,
  `taxonomy_version`, `rubric_version` on every score row.
- **Band the rubric.** Score on bands wide enough that extraction variance never crosses a
  boundary. Any field that cannot be extracted stably is coarsened or dropped — never scored on.
- CV text passed as clearly delimited data with an explicit never-follow-instructions directive.
  The schema is the real defence; this is belt and braces.
- Failure path: pending and retry. **Never a partial or degraded score.**

**Day 9 — Integrity and employer tenancy**
- Config-driven rule engine reading `config_values`, plus **one** illustrative rule
  (timeline inconsistency). Rules are versioned; changes ship as config.
  **The duplicate-content-hash rule is dropped in v4** — "Don't flag for duplicates". The engine
  still supports it; it simply is not registered. Duplicate *application* prevention is a
  different mechanism and is untouched.
- Employer profile fields `employer_type` and `industry` — enumerated, seeded from config,
  values still owed by the client ([Q9](questions.txt)).
- Severity classification; **high severity suppresses from discovery pre-review** (PRD §7.2) as a
  filter inside the discovery query, not a separate code path.
- Employer tenant creation, team members, the three employer roles.

**Day 10 — KYB and jobs** *(KYB reduced in v4 — but not removed)*
- KYB state machine `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | MORE_INFO_REQUIRED`
  (SRS §1.20.7) and document upload — **built in full**, then short-circuited by
  `kyb.auto_approve = true`, which moves a submission to `APPROVED` on arrival.
  Admin review actions are still wired but unused while the flag is on.
- **Settled in v6 (R15).** The client has confirmed the shape: the KYB onboarding form **does**
  exist, approval **is** automatic, and we **build the approval mechanism plus a setting to enable
  or disable it** — disabling it means automatic approval. That is exactly the design already in
  place, now confirmed rather than provisional. The invariant-8 test runs with the flag *on* so
  the gate stays genuinely exercised whatever production is set to.
- **Employers get the portal on signup but can do nothing in it until they pay** *(R15)*. Two
  independent gates, not one: `kyb.require_approval` (config, default off) and an active paid
  subscription (the real gate). Do not conflate them — they fail differently and return different
  error codes.
- Job composer, validation, lifecycle `DRAFT → PUBLISHED → PAUSED → PUBLISHED → CLOSED`.
- Salary range `NOT NULL`; minimum-score threshold field.
- **Threshold preview returns a count only** — rate-limited and coarse enough that binary-searching
  the threshold cannot fingerprint an individual. This endpoint is a genuine leak vector.
- **Publish gate at service *and* database level. Invariant 8 green.**

> **Week 2 gate.** Invariants 1, 2, 3, **4′**, 8 green. Upload → parse → review → confirm → score
> works end to end on a corpus of 20 real resumes, **for an authenticated user only**. A score
> carrying add-on contributions replays identically. No sequence of add-on completions breaks a
> cap. With `kyb.auto_approve = false`, an unverified employer cannot publish through the API, the
> service, or a direct repository call.

---

### Week 3 — Marketplace and money · Days 11–15

**Day 11 — Discovery and application**
- **Pay-first applies to candidates too** *(R13)*. Sign-up grants an account; scoring, tools, jobs
  and applications all require an active subscription. Same dependency as the employer gate,
  different audience. A candidate whose subscription lapses keeps their account and their score
  history — they lose access, not data.
- Candidate job search over published jobs, filters, cursor pagination.
- Eligibility against the **server's authoritative score**, never a client-supplied value.
- Apply: idempotent, duplicate-prevented by the partial unique index. Withdraw.

**Day 12 — Pipeline**
- Stage machine in `domain.py`, fixed set (PRD §9): `SUBMITTED → VIEWED → SHORTLISTED →
  INTERVIEW → DECISION → HIRED | REJECTED`, terminal `WITHDRAWN` / `EXPIRED`.
- `application_events` on every transition — the candidate's Application Board renders from this.
- External meeting-link attachment; two-sided hire confirmation, idempotent.
- Expiry sweep via EventBridge Scheduler.

**Day 13 — Masked search** *(the mask now lifts on a time window, not a purchase)*
- `MaskedCandidate` schema — structurally incapable of holding name, phone, email, or raw score.
- Filters: score band, location, skills, add-on badges only — never raw add-on content.
- `pg_trgm` + `tsvector` indexes. Index deliberately; this is the query that gets slow first.

**Day 14 — Access windows, reveal audit, and abuse controls** *(restructured in v6)*

> **The unlock transaction is gone.** *(Client, 2026-08-27: the employer pays once and "every
> student is unlocked automatically for the employer, they can view anyone in the whole
> database.")* No per-candidate purchase, no wallet debit, no `unlocks` row, no unlock
> idempotency, no concurrent-double-charge race. **This was the sprint's second high-judgment day
> and most of it has evaporated.**
>
> What replaces it is smaller to build but must not be skipped, because blanket access moves the
> risk rather than removing it.

- `require_active_access_window` dependency — one check, one place, on every revealing route.
  Reads the tenant's subscription state; no per-candidate lookup exists any more.
- **Expiry is the new correctness case.** Test that a window lapsing mid-session masks the very
  next read. There is no cached entitlement to go stale, and there must not be one.
- **Reveal audit at volume (invariant 7′).** Every profile an employer opens writes an
  `audit_events` row in the same transaction as the reveal. Blanket access removed the natural
  one-row-per-unlock trail, but **PRD §3.9 still requires every reveal of private data to be
  logged.** Partition `candidate_view_events` by month; this table grows faster than anything
  else in the schema.
- **Abuse controls — this is the day's real work.** One payment now buys the entire candidate
  database, so the throttle *is* the protection:
  - per-tenant daily and hourly view caps, configurable
  - rate limits on the discovery and reveal endpoints
  - anomaly detection on view velocity, alerting to the admin console
  - **export is not a feature.** No bulk download, no CSV of candidates, no API pagination that
    trivially walks the whole pool.
- Post-reveal read: different endpoint, different schema, different repository method. The
  revealed schema carries the display score, never `raw_value`.
- **Employer actions are gated on payment, not just on KYB** *(R15)*. An employer may create an
  account and see the portal, but every meaningful action requires an active subscription. Same
  dependency, applied broadly.

> **Raise in writing before this day.** Auto-approved KYB (R15) plus blanket database access
> (R14) plus a single monthly payment means **anyone who can pay can obtain every candidate's
> name, phone number and email** — candidates who themselves paid to be there. The controls above
> are mitigation, not a fix; the fix is verification, and the client has switched it off. This
> belongs in the client conversation now, not in a post-incident review.
> See [§13 R14](#resolved-in-v6--client-answers-2026-08-27-late).

**Day 15 — Payments and subscriptions** *(materially larger in v4)*
- **Subscriptions**: `plans` seeded for the four candidate periods (monthly, quarterly, semester,
  annual), employer tiers, and college B2B; `subscriptions` state machine with cancellation and
  grace; `subscription_events` on every transition.
- **Both renewal paths are in scope** *(R17 — client: "keep choice for the user, manual or UPI
  Mandate")*. Build **manual repurchase first** — it reuses the one-off payment path and is nearly
  free once that exists — then add the mandate path behind the same `BillingProvider` interface.
  Sequencing them this way means a slip in mandate work does not block launch.
- **UPI AutoPay carries obligations beyond "charge them again"**, and they are the part that
  overruns: per-subscriber mandate registration, an amount ceiling fixed at registration,
  **pre-debit notification to the payer ahead of each charge**, debit failure and retry handling,
  and mandates the user can revoke **inside their own UPI app** — where we are never told. Treat a
  silently dead mandate as a first-class state, not an error: detect it on failed debit, fall the
  subscriber back to manual, and notify them before access lapses.
- **Courses**: catalogue, purchase, and completion. `course_completions` is a score-moving write —
  role-restricted and audited, per invariant 3.
- Pending transaction, provider redirect, **verified server-to-server signed callback**.
- Entitlement granted only after signature verification — never from a client callback (PRD §8).
- Raw callback payload stored for dispute forensics. Replay protection. Fast 200, async processing.
- `PaymentProvider` interface with a stub that can simulate success, failure, and replay.

> **Week 3 gate.** Invariants 7 and 7′ green under schemathesis fuzzing — including the assertion
> that no employer response can carry a raw score. **A lapsed access window masks the next read
> immediately.** Every candidate profile view writes exactly one audit row, and the audit path
> holds up under paging volume. View caps and rate limits are enforced server-side. A forged
> payment callback grants nothing. A subscription that lapses stops granting access without
> deleting history.

---

### Week 4 — Add-ons, colleges, admin, handover · Days 16–20

The densest week. If anything slips, it slips here — see [§8.0](#80-what-four-weeks-buys--and-what-it-does-not).

**Day 16 — Questionnaire and interview** *(audio-only per Q1/Q3; now score-affecting per v4)*
- Questionnaire: save-progress, submit, supplementary report. **Still no import from `scoring`** —
  and note the questionnaire was never given a point value by the client, so it remains a sibling
  signal. Only courses and interviews move the score.
- **Interview completion emits a contribution event worth +20**, capped at +60 across sessions,
  consumed by `scoring` through the outbox. The cap lives in `scoring/domain.py` (Day 8), not
  here. **Invariant 4′ re-verified end to end on this day.**
- Device check **before payment** (SRS §1.10.1): microphone, audio output, network, storage, quiet
  environment. **No camera check, no lighting check** — audio-only, decided.
- Session creation gated on a passed device check and a valid entitlement — **which now means an
  active subscription or a discrete purchase**, depending on [Q6](questions.txt).
- **Fourth and later sessions earn no points.** The client confirmed a candidate may buy unlimited
  sessions but the interview contribution is capped at +60. **Show an explicit confirmation at
  purchase — "this session will not increase your score" — before taking payment.** Without it
  this is a refund request and a payment dispute, and disputes cost more than the sale.
- **Per-question presigned upload**, Opus/AAC mono 16 kHz. Progressive, never one large file at the
  end (PRD §4.4).
- Interrupted-session recovery from the answer manifest (SRS §1.10.5).

**Day 17 — Evaluation and college onboarding**
- `TranscriptionProvider` and `EvaluationProvider` interfaces with stubs; rubric report assembly.
- College tenant and staff roles, plus **`college_seats`**: an admin-assigned seat count with
  CRUD from the admin console. Seat model recommended as one payment per period covering up to N
  students — mirroring the employer model rather than adding tiers the employer side rejected —
  and awaiting client confirmation ([`questions.txt`](questions.txt)).
- **Referral-code linking** *(R16, new in v6)*: a college generates a code; a student who already
  has an account enters it to link the two. Entering the code **is** the consent act and writes a
  `student_consents` row with `granted_via = REFERRAL_CODE`, **scope `ROSTER` only** — individual
  visibility stays a separate explicit grant (PRD §3.8). Codes are credentials: non-guessable,
  rate-limited on entry, revocable, expiring. This runs **alongside** the invite flow, not instead
  of it — invites still cover students with no account yet.
- Bulk roster import: async, with a **preview identifying malformed and duplicate rows before
  commit** (SRS §2.25.3), idempotent.
- Invitation dispatch and tracking.

**Day 18 — Consent and analytics** *(high-judgment day — protect it)*
- **Two distinct consent scopes** — `ROSTER` (counted in aggregates) and `INDIVIDUAL` (visible as
  a person). Separate grants; roster consent never implies individual visibility (PRD §3.8).
- Cohort analytics: queries **inner join consent**, plus a minimum-cohort-size floor so a small
  cohort cannot be de-anonymised by subtraction. Above the floor every figure is exact (client,
  2026-09-30, answers-log 12.1): small-cell suppression is off by default (`min_cell_size` 1)
  and can be switched back on by a config row. A withheld figure is `null`, never `0`.
- Individual view gated on `INDIVIDUAL` consent, audited on every access.
- Revocation effective immediately. Placement tracking labelled **platform-sourced**.
- **Invariant 9 green.**

**Day 19 — Admin console and notifications**
- **KYB queue is dropped from the console in v4** while `kyb.auto_approve` is on — the submissions
  list stays as a read-only record. Integrity queue (clear / confirm) is unchanged.
- **Seat management and stop-operations:** allocate and adjust `college_seats`; suspend a tenant
  via `tenant_suspensions`, which must immediately block sign-in and API access for that tenant's
  members without deleting anything. Audited like any other privileged action.
- Candidate, employer, and college drill-downs — role-restricted, **audited on every access**.
- Dispute queue across all three external groups, cross-linked to integrity and user records.
- Audit log search by actor, action, target, time; server-paginated.
- Notification fan-out off the outbox; externalised templates; per-user locale and preferences.
- **Incomplete-profile nudges** *(client note, 2026-08-27)*: a scheduled sweep for users who
  signed up but uploaded no resume. Needs a cadence cap and a suppression list — nudging the same
  person daily forever is the failure mode here, and unsubscribes are expensive. Live SMS delivery
  stays DLT-gated like everything else on that path.
- `SmsProvider` → **Twilio Messaging** implementation for notification SMS (separate from the OTP
  path, which lives in the Cognito Lambdas). Live sends stay DLT-gated; test credentials cover the
  sprint.

**Day 20 — Privacy and handover**
- `dsr_requests` with tracked due dates; async export to an encrypted archive behind a short-lived
  presigned URL; deletion cascade across S3 and Postgres.
- Rate limits: per user, per tenant, per IP. Tightest on OTP and threshold-preview.
- Index review — every endpoint's query plan checked for a sequential scan on a growing table.
- **Full invariant suite pass, all ten** — the eight carried forward plus 4′ and 7′.
- Final OpenAPI export, Postman collection, integration notes for the four client teams, README.

> **Week 4 gate.** All invariants green — the eight carried forward plus 4′. OpenAPI published and
> complete. Every stub interface documented with what a real implementation must satisfy. A new
> developer can run the stack from the README in under ten minutes.

---

### If the schedule slips

Cut in this order. The first three lose no invariant coverage:

1. **Interview evaluation quality** — ship transcription + a basic rubric; refine post-sprint.
2. **Admin drill-down breadth** — queues and audit search are essential; rich cross-linking is not.
3. **Notification channel breadth** — in-app + email only; SMS and push are DLT-blocked anyway.
4. **Analytics depth** — distribution and median only; defer richer cohort metrics.

**Never cut:** anything in Week 1, any invariant test, the audit trail, or the Day 14 access-window
and reveal-audit work (invariants 7 and 7′) together with the abuse controls that ride on it.
*(Until v6 this line read "or the unlock transaction." R14 deleted that transaction — the
protection it named now lives in the access-window check and the per-reveal audit row.)*
Those are the parts a client security review will find, and the parts that cannot be retrofitted.

---

## 9. Testing strategy

Under compression, test *depth* is where the temptation to cut lives. The resolution: the
invariants layer is non-negotiable and written first; breadth elsewhere can be thinner and
backfilled in Week 5.

**`tests/invariants/`** — one file per rule in [§1](#1-the-invariants). Written *before* the
feature they guard, on the day that feature lands. These are the tests you show the client; they
are documentation as much as verification. Never delete one to make a build pass.

**`tests/unit/`** — pure `domain.py` logic, no I/O. State machines, score bands, display floor,
consent evaluation, transition validity. Use `hypothesis` for state machines: generate every
from-state/to-state pair and assert only the legal ones succeed. This is the cheapest coverage
per hour available and AI generates it well — lean on it.

**`tests/integration/`** — real Postgres via `testcontainers`. Never SQLite: RLS, JSONB, partial
indexes, and `SET LOCAL` all behave differently, and those are exactly what you are testing. Each
test runs in a transaction that rolls back.

**`tests/contract/`** — `schemathesis` against the generated OpenAPI schema. This is where masking
leaks get caught: fuzz discovery endpoints and assert no response ever contains a key matching
`name|phone|email|raw_score`.

**Concurrency tests deserve explicit mention.** Application creation, payment and renewal
callbacks, and **the access-window expiry boundary** all have races that only appear under real
concurrent transactions. The window case is the v6 replacement for the deleted unlock-billing race
and is more subtle, not less: a subscription lapsing *between* the discovery query and the reveal
read must mask the reveal, with no cached entitlement anywhere to go stale. Test with actual
parallel sessions against real Postgres, not mocks. Days 14 and 15 budget for this specifically.

**Fixtures:** `polyfactory`, plus a scenario builder — "employer with approved KYB, published job,
three applicants at different stages" — which pays for itself by Day 12.

---

## 10. Security and privacy checklist

Review at each week gate, not once at the end.

- [ ] Tenant ID derived from server-side membership. Never from path, query, body, or header.
- [ ] Every new table: does it need `tenant_id` and an RLS policy?
- [ ] Every new endpoint: role dependency present and tested for all 9 roles?
- [ ] Every reveal of private data: audit event in the same transaction?
- [ ] Every new S3 object: private bucket, SSE-KMS, presigned access only?
- [ ] Every retriable mutation: idempotency key required?
- [ ] Foreign resource IDs return 404, never 403.
- [ ] No PII in logs — `structlog` redaction covers phone, email, name, resume text.
- [ ] No secrets in code, environment dumps, or error responses.
- [ ] `cognito_sub` never appears in an API response.
- [ ] No employer-facing response schema can hold a raw score — "No real score ever".
- [ ] Every add-on-completion write path is role-restricted and audited (it moves a score).
- [ ] Add-on contribution caps hold under any ordering or quantity of completions.
- [ ] Tenant suspension blocks access immediately, without deleting data.
- [ ] Token verification checks `iss`, `token_use`, `client_id`, expiry, and correct pool.
- [ ] Membership revocation takes effect within the cache TTL — tested.
- [ ] OTP: Twilio Verify owns single-use and expiry; our Redis outer throttle covers phone and IP.
- [ ] No OTP value is ever persisted or written to a log — verified by the redaction filter test.
- [ ] File uploads: type sniffed from content, size capped, scanned.
- [ ] Payment callbacks: signature verified, replay-protected, idempotent.
- [ ] DPDP Act 2023 alignment — consent records, purpose limitation, data-principal rights.
- [ ] Data residency: everything in `ap-south-1` unless the client says otherwise in writing.

---

## 11. Performance budget

PRD §8 requires the core scoring flow to feel near-instant and the candidate app to work on
low-end Android over slow networks. That is a **backend payload and latency** requirement, not
only a mobile one.

Targets are designed for on Day 13 and Day 20 (index review); *verified under load* in Week 5.

| Path | Target (p95) | Notes |
|---|---|---|
| Auth token verify | < 50 ms | JWKS cached; membership from Redis. |
| Score read | < 150 ms | Cache aggressively; changes only on rescore. |
| Job search | < 400 ms | With filters, at 100k jobs. |
| Candidate discovery | < 600 ms | The hardest one — masked search over the full pool. |
| Application list | < 300 ms | Cursor-paginated. |
| Resume parse (async) | < 30 s | User sees a processing state throughout. |
| Score compute (async) | < 5 s | From confirmed resume. |
| Interview answer upload | < 3 s per answer | ~20 KB at 16 kHz mono — sized for 2G. |

**Payload discipline:** list responses stay under 50 KB. On a 2G connection, payload size dominates
server latency — a 300 KB JSON response is a worse bug than a 300 ms query.

---

## 12. External dependencies

You are writing application code against infrastructure someone else provisions. Several of these
have lead times longer than the entire sprint, which is why the four weeks deliver a
stub-integrated system.

**From whoever owns infrastructure — needed by Day 1 unless noted**

| Need | Why it blocks | Day |
|---|---|---|
| Postgres endpoint + two roles (app without `BYPASSRLS`, admin-bypass) | RLS design | 2 |
| **Cognito: two user pools + app clients** | All authentication | 3 |
| **Cognito custom-auth Lambda triggers** (Define / Create / Verify) | Candidate phone OTP | 3 |
| **Twilio credentials in Secrets Manager, readable by those Lambdas** (Account SID, Auth Token, Verify Service SID) | The Lambdas call Twilio Verify — credentials sit outside our codebase | 3 |
| **Google IdP configured on the candidate pool** | Google Sign-In | 3 |
| Redis endpoint | Membership cache, rate limits, locks | 1 |
| S3 buckets: resumes, interview audio, exports, audit archive | Separate lifecycle per bucket | 2 |
| SQS queues + IAM for Celery | Broker | 1 |
| Secrets Manager paths and read policy | Config at boot | 1 |
| EventBridge Scheduler → trigger endpoint | Expiry, DSR sweeps | 12 |
| CI/CD pipeline and image registry | Deploys | 1 |
| Log aggregation and trace collector endpoints | Observability | 1 |

> **Any of these arriving late costs a day of a twenty-day sprint.** There is no slack. Confirm
> all of them are ready before Day 1 starts.

**From the client (contract or NDA-gated, PRD §10)**

| Need | Blocks | Lead time |
|---|---|---|
| **Twilio account** (Verify service + Messaging sender) | Live OTP and notification delivery | Days. Test credentials available immediately — development is not blocked. |
| **TRAI DLT registration, linked to Twilio** | Live delivery to Indian numbers | **2–4 weeks — start today.** Longer than the sprint. **Twilio does not remove this** — DLT binds the sender, not the gateway. Register the Principal Entity, sender ID, and templates, then link the entity and template IDs to Twilio. Ask Twilio whether Verify's India templates sit under their entity or the client's; the answer moves the lead time. |
| **Scoring algorithm, weights, category definitions** — *and the arithmetic reconciled*: 700 base, 990 ceiling, and a 200-point band written as 790–990 do not add up | Replaces `v0-placeholder`; blocks Day 8 | **Immediate ask — blocking** |
| **Whether the 200-point band is model-judged**, and if so which model | Reproducibility design for invariant 1; blocks Day 8 | **Immediate ask — blocking** |
| **Integrity-detection rules** | Replaces the one remaining illustrative rule (duplicates dropped) | Immediate ask |
| **Production API contracts and data schemas** | Reconciliation against [§6](#6-data-model--the-spine) | Immediate ask |
| **Payment gateway** account + credentials | Real payments **and subscriptions** — confirm the account supports recurring billing and, if renewal is automatic, UPI e-mandates | KYC, 1–2 weeks |
| ~~KYB/GSTIN verification provider~~ | **Dropped in v4** — no vendor, approval is automatic. Removes a 1–2 week lead time from the critical path. Re-instate if [Q7](questions.txt) reverses. | — |
| **Plan and price list** — subscription tiers and periods, course prices, mock-interview price, employer tier definitions, college seat pricing | Seeding `plans` and `courses`; Day 15 | Immediate ask |
| **Employer type and industry lists** | `employers.employer_type`, `employers.industry`; Day 9 | Immediate ask |
| **Speech-to-text + evaluation vendor** | Interview evaluation | 1–2 weeks |
| Localised copy, 6–8 languages | Notification templates | Rolling |
| Legal sign-off on the deletion/retention boundary | Day 20 deletion logic | Ask by Day 8 |

**On stubs:** every external provider sits behind an interface with a logging stub from the day it
is first needed, so development never blocks on a vendor. But a stub that never gets replaced is a
launch blocker in disguise. Track a swap-in date for each — that work is Week 5+, and it belongs
in the client conversation now, not later.

**Twilio is the one vendor that does not follow that pattern.** Its test credentials exercise the
real API, so Day 3 ships a real integration and only the switch to live delivery is DLT-gated.
That is worth stating to the client explicitly: authentication — the highest-risk surface in the
system — will not be carrying stub risk at the end of the sprint.

---

## 13. Decisions and open questions

### Resolved

**Q1 — In-app recording, not a real phone call.** *(Client, 2026-08-24)*
The mock interview records answers in the app and uploads them per question. No PSTN telephony, no
call orchestration, no carrier integration, no voice DLT. This removes the largest single unknown
from the estimate and is a substantial part of why four weeks is arguable at all. SRS §1.10.4's
"live spoken answers over the phone" should be read as "spoken into the phone," consistent with
§1.10.5's local storage and retry queue. **Applied:** Day 16; `interview_sessions` /
`interview_answers` in [§6](#6-data-model--the-spine).

**Q3 — Audio only. No video.** *(Client, 2026-08-24)*
Confirms SRS §2.7 over PRD §4.4's "audio/video." Consequences: no camera permission, **the device
check drops camera and lighting** (SRS §1.10.2's "Lighting" row is dead — flag it to whoever
maintains the SRS), storage and bandwidth drop by roughly an order of magnitude, and the S3 bill
and evaluation pipeline shrink accordingly. Opus/AAC mono at 16 kHz puts a 30-second answer at
~20 KB, which is what makes progressive upload viable on 2G. **Applied:** Day 16; [§3](#3-stack),
[§6](#6-data-model--the-spine), [§11](#11-performance-budget).

**D1 — Twilio for OTP and SMS delivery.** *(Client, 2026-08-24)*
Twilio **Verify** for candidate login OTP, called from the Cognito custom-auth Lambdas; Twilio
**Messaging** for notification SMS from our own `SmsProvider`. Cognito's SNS-backed SMS is not
used. Consequences: the `otp_challenges` table is gone (Twilio generates and checks the code, so
no OTP value is ever persisted or logged), rate limiting and expiry come from Verify with a coarse
Redis throttle of ours in front, and **Day 3 builds a real integration against test credentials
rather than a stub.** Two things to carry into the client conversation: the OTP credentials live
in a Lambda outside our scope, and **DLT registration is still required** — Twilio does not remove
it. Full design in [§5.8](#58-otp-delivery-via-twilio-decided). **Applied:** Days 3 and 19.

**Q4 — Cognito, two user pools.** *(Client, 2026-08-24)*
Candidates in one pool (custom-auth phone OTP, Google federation, email); business and admin users
in another (password + software-token MFA). We store no password hashes and no TOTP secrets.
**The one design constraint that follows:** role and tenant authorisation is read from our
`memberships` table per request, not from Cognito groups or token claims, because claims go stale
and a membership revocation that does not take effect is precisely the tenant-isolation failure
SRS §2.24.7 forbids. Full design in [§5.7](#57-cognito-integration-decided). **Applied:** Days 3–4.


---

### Resolved in v4 — client document comments (2026-08-24) and note (2026-08-27)

**R1 — Paid add-ons DO change the score. Rule 4 rescinded.** *(Comment on hard rule 4: "It will
change it"; note: course/video +30, mock interview +20 per session up to +60.)*
Invariant 4 is replaced by **4'** ([§1](#1-the-invariants)): contributions are typed, versioned
and capped. The `import-linter` contract is inverted, not deleted — `scoring` reads add-on
events, the add-on modules still cannot write a score. `scores` gains `base_value`,
`addon_value` and `contributing_events`, without which `replay()` breaks the first time a
candidate buys a course.
**Applied:** [§1](#1-the-invariants), [§2](#2-architecture-decision-modular-monolith),
[§6](#6-data-model--the-spine), Days 8 and 16.

**R2 — Scale is 700–990.** *(Note: "Base -700, max - 990".)*
Display floor 680 → **700**; ceiling 999 → **990**. Both were already versioned config
([§5.6](#56-configuration-and-feature-flags)), so this is seed data, not a migration.
**What is not resolved** is how the pieces compose — 700 plus a 200-point band is 900, not 990,
and the band is written as spanning 790–990. See `questions.txt` Q1.
**Applied:** invariant 2, Day 8.

**R3 — No anonymous flow. Sign-up gates everything.** *(Comment: "Without login the user cannot
parse the resume / cannot get a score"; note: "Only Sign Up is allowed, nothing else, not even the
resume upload.")* `anonymous_subjects`, `/api/v1/public/session` and the claim transaction are
deleted; `subject_id` collapses to `user_id`. This closes v3's Q7 and removes the DPDP exposure of
holding a full resume for an unauthenticated user. **Contradicts SRS §2.25.1**, an acceptance
criterion the build is graded against — needs written rescission (`questions.txt` Q12).
**Applied:** [§5.7](#57-cognito-integration-decided), [§6](#6-data-model--the-spine), Days 4, 5, 6.

**R4 — Employers never see the raw score. Closes v3's Q2.** *(Comment on open question 3: "No real
score ever".)* "Exact score" in PRD §3.6 and SRS §2.9.7 means the exact *displayed* score. The raw
value is still computed and stored for reproducibility — it is simply never serialized to anyone.
Invariant 7 is strengthened accordingly. Knock-on: a job threshold below the floor is
meaningless, so threshold input is constrained to at least the floor.
**Applied:** invariant 7, Days 10 and 14.

**R5 — Revenue model replaced.** *(Comment: "Student → Subscription (Nothing free (Per
month/quarterly/semester/annually)) + Course + Audio Mock Interview. Employers → Flat Fee/Tier.
College → B2B Deal, No of Seats will be assigned from the admin. (CRUD Operations and stop
operations in backend admin)".)* New tables `plans`, `subscriptions`, `subscription_events`,
`courses`, `course_purchases`, `course_completions`, `college_seats`, `tenant_suspensions`; new
`subscriptions` and `courses` modules. **"Nothing free" retires the PRD §2 objective of a credible
score at no cost** — the free acquisition hook is gone, which is a product decision worth
confirming out loud (`questions.txt` Q6). Prices, renewal mechanics and what an employer tier
includes are all still open (`questions.txt` Q8, Q11, Q13).
**Applied:** [§4](#4-repository-layout), [§6](#6-data-model--the-spine), Days 15, 17, 19.

**R6 — Duplicate-resume detection dropped.** *(Comment: "Don't flag for duplicates".)*
Timeline-inconsistency checking and the severity and suppression machinery stay; the rule engine
still supports duplicate detection, it is simply not registered. Contradicts PRD §7.2, which names
it as the primary example — worth one line of written confirmation. **Does not touch duplicate
application prevention**, which is a database constraint and stays. **Applied:** Day 9.

**R7 — Interview is recorded, not a live call — confirmed again.** *(Comment: "Recorded, not real
time conversation".)* Re-confirms Q1 from 24 August. No change to the plan; noted only so it can
be treated as settled rather than re-litigated.

**R8 — Employer classification added.** *(Note: "Employer - MNC, Industry".)* `employer_type` and
`industry` on `employers`, enumerated and config-seeded. Values still owed (`questions.txt` Q9).
**Applied:** [§6](#6-data-model--the-spine), Day 9.

**R9 — Incomplete-profile nudges.** *(Note: "Nothing uploaded, then also send notifications for
that".)* Scheduled sweep, cadence cap, suppression list. **Applied:** Day 19.

**P1 — KYB provisionally auto-approved. PROVISIONAL — the client has said both things.**
The 24 August comment on the KYB provider row reads "Manual, uploading will be there but manual".
The 27 August note reads "KYB won't be there, automatic approval." Three days apart, opposite
answers. **Decision taken, and it is ours, not theirs:** build the state machine, the publish gate
and the Postgres trigger in full, and default `kyb.auto_approve = true` in config. Invariant 8's
test runs with the flag off so the gate stays genuinely exercised. Switching verification back on
then costs a config change instead of re-introducing a gate into a live marketplace.
**Flag in writing:** auto-approval means an unverified business can publish jobs and pay to unlock
candidate phone numbers and emails. PRD rule 7 and SRS §2.25.2 both still require the gate.
**Applied:** invariant 8, [§6](#6-data-model--the-spine), Days 10, 19,
[§12](#12-external-dependencies). Confirm via `questions.txt` Q7.

---

---

### Resolved in v5 — client answers (2026-08-27, evening)

**R10 — The scoring arithmetic closes exactly.** *(Answers v4 Q1, Q4, Q5.)*

```
base                                    700
resume judgment      0 – 200      →   700 – 900
course (one, once)        +30      →   730 – 930
interviews (3 × 20)       +60      →   790 – 990
                       ───────
maximum                                 990   = 700 + 200 + 30 + 60, exactly
minimum                                 700
```

Three consequences, all simplifications:

- **No clamp is needed at the ceiling.** 990 is arithmetic, not a rule. We still assert it — but
  an assertion that fires is a bug, not a business rule.
- **The display floor is unreachable.** 700 is a *base* every score receives, so the minimum
  possible value is 700 and **stored value == displayed value, always**. The floor machinery stays
  (config-driven, free) but is a no-op.
- **R4 is satisfied for free.** "Employers never see the raw score" needs no enforcement when
  there is no hidden raw score. The invariant-7 schema test stays anyway.

Also settled: **one course exists on the platform, purchasable once, +30 total.** Interviews may be
purchased without limit but contribute +20 each only to a ceiling of +60 — a fourth session earns
nothing, which needs an explicit pre-payment confirmation (Day 16).
**Applied:** invariants 1, 2, 4′, [§5.6](#56-configuration-and-feature-flags),
[§6](#6-data-model--the-spine), Days 8 and 16.

**R11 — The score is never explained to the candidate.** *(Client: "The score is never explained
to the user." Answers v4 Q3, which had contradictory inputs.)*
No breakdown screen, no category detail, no improvement suggestions. `suggestions` is dropped from
`scores`; `breakdown` is still computed and stored for admin drill-down and disputes, and no
candidate-facing schema may expose it — enforced by a schema test. Invariant 1 is now purely
*reproducible*; the "explainable" half is formally dead.
**Contradicts PRD §4.2** (category breakdown + top suggestions) and has a knock-on into PRD §4.5
(job eligibility telling a candidate "what would need to improve"). We are building generic
eligibility messaging with no reasoning. Both need written rescission — `questions.txt` Q12.
**Applied:** invariant 1, [§6](#6-data-model--the-spine), Day 8.

**R12 — Reproducible AI scoring: approach designed, awaiting approval.** *(Client asked us to
propose the approach. Answers v4 Q2.)*
Full design in **`scoring-approach.md`**. In one line: **the model never emits a score.** It reads
the CV — the part a fixed formula genuinely cannot do across industries — and returns
schema-validated facts plus bounded ordinal ratings; deterministic versioned code turns those into
points. The model response is stored verbatim and `replay()` recomputes from storage, never
re-invoking the model.

Three properties fall out of that division:

- **Replay** is bit-identical in perpetuity, even after the model is retired or upgraded.
- **Consistency** is exact for identical CVs, via a content-addressed extraction cache.
- **CV prompt-injection stops working**, because a schema with no score field cannot be talked
  into awarding one. The worst an attacker achieves is exaggerating a fact — which is ordinary
  resume fraud, and the integrity module already owns that.

⚠️ **Technical note that changes the usual advice:** `temperature` has been removed from current
Claude models and a request setting it is rejected. Determinism cannot be bought from sampling
parameters. This design never depended on it.

**Two things block the build:** client approval of the document, and the **data-residency
decision in its §13** — Bedrock does not support the `inference_geo` parameter, so if CV text must
provably stay in India we need either a verified in-region model with no cross-region fallback, or
a platform that supports explicit geography pinning. That decision determines which client library
the scoring module is built against, so it is needed **before Day 8**.
**Applied:** [§3](#3-stack), [§6](#6-data-model--the-spine), Day 8.

---

### Resolved in v6 — client answers (2026-08-27, late)

**R13 — Pay-first for all three audiences.** *(Answers v5 Q6: "the application for
students/employers/colleges is pay first only.")*
Sign-up creates an account; everything else requires payment. Candidates get no score, no tools,
no jobs until they subscribe. The free-score acquisition hook the PRD was built around is
formally gone. A lapsed subscriber **keeps their account and score history and loses access** —
never their data. **Applied:** Days 6, 11, 14.

**R14 — Employers pay once per period and see the entire database. The unlock is deleted.**
*(Answers v5 Q8: "no tiers ... the employer pays once (monthly/quarterly/semi-annual/annual) and
for that time frame, every student is unlocked automatically ... they can view anyone in the whole
database.")*

**What this removes** — and it is a lot:

| Deleted | Was |
|---|---|
| `unlocks` table | Unique per (tenant, candidate), unlock-once-bill-once |
| `wallet_ledger` | Append-only employer balance |
| Unlock quote / price / balance display | SRS §2.25.2 |
| Unlock idempotency key | One of the six named idempotent operations |
| Concurrent-double-charge test | Day 14's hardest correctness case |
| Employer tiers | Explicitly rejected — "no tiers" |

**What replaces it:** a single `require_active_access_window` check. The subscription *is* the
entitlement. Day 14 was one of four days flagged as uncompressible and most of it is now gone —
**roughly a day recovered, on the critical path.**

**What it does not remove, and this is the part to carry into the client conversation:**

1. **The audit obligation survives.** PRD §3.9 requires every reveal of private data to be logged.
   Blanket access destroys the natural one-row-per-unlock trail, so the audit moves to the read —
   every profile opened writes a row. That table will be the fastest-growing in the schema.
   Invariant **7′** is new for exactly this.
2. **⚠️ One payment now buys the entire candidate database.** Every candidate's name, phone and
   email, available in bulk, to anyone who can pay for a month — **and R15 means nobody has
   checked that the payer is a real business.** These candidates *paid to be there*.
   Under the DPDP Act this is a purpose-limitation and security question, not a product-design
   preference.
   Mitigations are in place on Day 14 — view caps, rate limits, velocity anomaly detection, no
   bulk export — but **they are mitigation, not a fix.** The fix is business verification, and the
   client has switched it off. **Put this in writing to the client; do not let it ride on a
   config default.**

**Applied:** invariants 7 and 7′, [§6](#6-data-model--the-spine), Days 13, 14, 15.

**R15 — KYB form stays; approval is automatic behind a switch; payment is the real gate.**
*(Answers v5 Q7: "KYB Onboarding form will be there, but it would be automatic ... they have
access to portal, but nothing they can do inside the portal, unless they pay ... Build the
approval mechanism as well, and provide a setting to enable and disable it.")*
This confirms the provisional decision taken in v4 (P1) — build the gate, default it open — and
adds the form. **P1 is now settled, not provisional.** Two independent gates that must not be
conflated: `kyb.require_approval` (config, default off) and an active paid subscription (the real
gate on employer actions). They fail differently and return different error codes.
**Applied:** invariant 8, Days 10, 14.

**R16 — Colleges link existing students by referral code.** *(Answers half of v5 Q10: "there would
be a referral type autogenerated code from the college side to the student, that the student has to
enter in their applications to connect their id's with their colleges.")*
Runs **alongside** the invite flow, not instead of it — invites still cover students with no
account. Three design decisions we have taken, all needing a nod rather than a debate: entering a
code **is** the consent act (`granted_via = REFERRAL_CODE`); it grants **`ROSTER` scope only**,
because PRD §3.8 requires individual visibility to be separately consented and a code must not
silently confer both; and codes are treated as **credentials** — non-guessable, rate-limited,
revocable, expiring. **Applied:** [§6](#6-data-model--the-spine), Day 17.

**R17 — Both renewal paths, candidate's choice.** *(Answers v5 Q11: "Keep choice for the user,
manual or UPI Mandate, if there are issues in it please let me know.")*
No blocking issues — but it is **two billing flows to build and maintain, not one**, and the
mandate path carries obligations that are the usual source of overrun: per-subscriber
registration, a ceiling fixed at registration, **pre-debit notification before every charge**,
failure and retry handling, and revocation that happens **inside the user's UPI app where we are
never told**. A silently dead mandate is a first-class state, not an error.
**Our sequencing:** manual first (nearly free once one-off payments exist), mandate second behind
the same interface — so a slip there does not block launch. **Applied:** [§6](#6-data-model--the-spine), Day 15.

**R18 — Three of the four written confirmations received.** *(Answers v5 Q12.)*
Paid add-ons increase the score ✅. Sign-up then payment before anything ✅. Duplicate CV detection
dropped — **client marked this one for re-confirmation, so treat as provisional**. The fourth item
added in v5 — *the score is never explained*, which contradicts PRD §4.2 — **was not addressed and
is still outstanding.**

---

### Legal — raise before Day 8

Invariant 6 exists because a three-digit score shown to Indian consumers resembles a credit bureau
score, and the brief already asks for written counsel sign-off on that basis.

**R1 changes the shape of that risk, and R11 sharpens it further.** The product now sells an item
that demonstrably increases the number, R5 puts the score itself behind a paywall, and R11 means
the candidate is **never told how the number was reached**. An unexplained three-digit score that
rises when you pay is close to the worst possible shape for the concern rule 6 exists to prevent.
There is also a fairness dimension: an AI-influenced hiring signal that the subject cannot query is
a live area of regulatory attention. "Pay us and your score goes up" is a
materially different thing to defend than "here is your score, free." Any sign-off given against
the old design was given against a different product.

**Ask counsel to re-review before the scoring engine is built**, not after. It costs a day now and
a rewrite later. This is not an engineering judgment and the build team should not absorb it
silently.

---

### Still open

Full plain-language versions, ready to send to the client, are in **`questions.txt`**. Summarised
here with what each one blocks.

**Blocking Day 8 — approval of `scoring-approach.md`, and the residency decision**
The scoring questions Q1–Q5 are **closed** (R10, R11, R12). Two things replace them: the client
must approve the extraction-plus-deterministic-scoring design, and answer the data-residency
question in its §13 — Bedrock cannot pin inference geography, so this determines which client
library Day 8 is built against.

**Blocking Day 8 — the calibration corpus**
`scoring-approach.md` §10. We need **50–100 real CVs** with a rough sense of what each should
score, plus the relative importance of the dimensions. Without it the weights are invented rather
than calibrated, and the golden-corpus CI gate has nothing to gate against. Realistically this is
one working session with whoever owns the product judgment.

**Day 14 is unblocked.** R14 answered it: no tiers, one payment per period, whole database
visible. The unlock transaction is deleted. What remains open on that day is not a build
question but a **risk acceptance** — see R14 point 2 and the item below.

**⚠️ Bulk-extraction risk · NEEDS WRITTEN ACKNOWLEDGEMENT · before Day 14**
Auto-approved KYB (R15) plus whole-database access (R14) plus one monthly payment means anyone
who can pay can obtain every candidate's contact details, unverified. We are building the
mitigations; the client needs to acknowledge the residual risk in writing, because the real fix
is verification and they have turned it off.

**College seat model · needed by Day 17**
The client asked *us* to recommend. We have: one payment per period covering up to N students,
mirroring the employer model. Needs a yes.

**Score-explanation rescission · still outstanding · needed by Day 8**
R18 delivered three of four written confirmations. "The score is never explained" contradicts
PRD §4.2 and was not addressed. Re-asked.

**⚠️ The unlock rescission was never asked for · NEW · needed before Day 13**

A gap in our own process, found on review. We have chased written rescission hard for the
*score-explanation* change — a one-sentence issue — and never asked for it on **R14, which is the
largest reversal in the project.** Deleting the per-candidate unlock does not contradict one line;
it voids a documented flow, a lifecycle, two interface specs and **five acceptance criteria the
build is graded against**:

| Document | What it requires | Status under R14 |
|---|---|---|
| PRD §2, objective 2 | Employers "pay only to unlock contact details of candidates they're interested in" | Reversed |
| PRD §3 rule 6 | Masked "until they explicitly *unlock* that candidate, which is a billed, audited action" | Mechanism gone; masking survives via the access window |
| PRD §5.3 | Unlock shows "the cost and remaining quota/balance" before completing | Cannot happen — nothing is billed per candidate |
| SRS §1.14.2 / §1.14.3 | Unlock and unlock-failure flows | Deleted |
| SRS §1.20.8 | The whole Candidate Unlock Lifecycle | Deleted |
| SRS §2.9.6 / §2.9.7 | "Price and remaining quota/balance before unlock"; the Unlocked Candidate interface | Deleted |
| **SRS §2.25.2** | *"Unlock displays price and remaining balance/quota before confirmation"*, *"Successful unlock reveals only authorized data"*, *"Unlock creates an audit event"* | **Three criteria that cannot pass as written** |

**The build is right and the criteria are stale** — but that is exactly the situation a written
rescission exists to record. Note the third criterion is satisfied *in substance* by invariant 7′
(every reveal is audited) and is worth saying so explicitly, because it is the one a security
reviewer will look for. Asked in `questions.txt` §3H1.

**⚠️ Referral-code consent needs the same treatment · NEW · needed by Day 17**

PRD §3 rule 8 does not merely require consent — it names the mechanism: *"given via an
invite-and-accept flow."* R16 adds a second mechanism, a referral code the student types in. We
believe a typed code is *better* consent than a clicked link and have built it that way, but
**"student typed our code" is not "invite-and-accept"** and the difference is exactly the kind of
thing a DPDP review will ask about. One sentence from the client closes it. Asked in
`questions.txt` §3H2.

**Duplicate-detection confirmation · provisional**
R18 carried a client note to re-confirm. Treat as provisional until it lands.

**Onboarding form fields · soft, but with a real deadline** · answered in `questions.txt`
The client asked what this blocks. Nothing hard — the schema takes them as config-seeded enums.
Rework starts if they arrive after Day 9, and grows after Day 17.

**Deletion vs. audit retention · DECISION NEEDED · needed by Day 20** · `questions.txt` Q13
Unchanged from v3, and now slightly larger — subscription and course purchase records are
financial records too. PRD §8 requires deletion; PRD §3.9 requires an immutable audit trail;
financial records carry statutory retention. Needs a written policy on which fields are
hard-deleted, which are anonymised, and what retention applies to audit and ledger rows.
**Ask legal by Day 8** — this one has a review cycle attached.

**Languages · NOTED · needed by Day 19**
Which 6–8 vernacular languages, and who supplies translations. Unchanged from v3. Affects template
and locale structure, and font and layout work on the clients.

**🔴 Course content · NOT PREVIOUSLY ASKED · scoping answer needed now, content by Day 15**

`resources-needed.md` §8 calls this *"the largest unlisted dependency in the project"* and it has
been sitting in that file, unasked, since v4. **The client sells a course that adds 30 points to a
candidate's score, and nobody has said who produces it.** Not how many courses (they have since
said one), not how long, not what format, not who films it, and — the part that touches our code
directly — **not how "completion" is determined.** That last one is not a content question: it
decides what a `course_completions` row actually means, and that row moves a score.

Producing course video is a content-production project with its own budget and timeline, entirely
outside the software build and **not in any estimate we have given.** It also drags infrastructure
behind it: a second CloudFront distribution, a `course-media` bucket, signed URLs so paid content
is not freely shareable, and — if it has to play on a low-end Android on 2G, which is the stated
primary segment — adaptive bitrate encoding that nobody has scoped either.

Asked in `questions.txt` §3I1.

**Plans, prices and the course catalogue · NOT PREVIOUSLY ASKED · needed by Day 15**
Four candidate subscription periods, the employer access-period prices, college seat pricing, the
course price and the mock-interview price. These seed `plans` and `courses`. Day 15 builds the
machinery either way, but it ships with placeholder numbers unless these land. Asked in
`questions.txt` §3I2.

**Superseded and closed**

| v3 question | Status |
|---|---|
| Q1 — in-app recording, not a phone call | Resolved 2026-08-24, **re-confirmed** by R7 |
| Q2 — which score an employer sees | **Closed** by R4 — the floored one, always |
| Q3 — audio only, no video | Resolved 2026-08-24, unchanged |
| Q4 — Cognito, two user pools | Resolved 2026-08-24, unchanged |
| Q5 — wallet vs. per-unlock billing | **Superseded** by R5; the employer half survives as `questions.txt` Q8 |
| Q7 — anonymous session lifetime | **Moot** — R3 deleted the anonymous session |

## 14. Progress tracker

### Days

| Day | Focus | Status |
|---|---|---|
| 1 | Scaffold, CI, module skeletons, invariants 5 & 6 | ☑ **done 2026-08-30** |
| 2 | Schema, RLS, audit, idempotency, outbox, OpenAPI stub publish | ☑ **done 2026-08-30** |
| 3 | Cognito: pools, JWKS, phone OTP, Google, email | ◐ **partial 2026-09-11** — JWKS verification, local provider and the identity surface are in and CI-green (PR #2). Pools are **applied and verified** (`infra/terraform`). Phone OTP and Google are blocked — see below. |
| 4 | MFA, memberships, role/tenant deps (anonymous flow removed in v4) | ◐ **partial 2026-09-11** — memberships and role/tenant deps done, cached 60s in Redis. Business-pool MFA is applied (software-token, required). |
| 5 | Cross-tenant suite, permission matrix — **Week 1 gate** | ☑ **done 2026-09-13** — permission matrix across all 10 roles, no-anonymous-access, audit append-only and revocation tests, and a cross-tenant suite that enumerates every tenant route with an id from the running app: tenant A asking for tenant B's resource must be a 404, and a new route without a case fails the build. |
| 6 | Resume upload, scan, parse task | ◐ **partial 2026-09-11, extended 09-12** — 5 endpoints, presigned upload, local parsers (pypdf/python-docx) with **Textract as an OCR fallback behind a length floor**, parse task idempotent by file id, `parser`/`parser_version` stored per extraction. Day 7 added the terminal `parse_status` the parse task now writes on every exit. **Malware scanning is a seam with nothing behind it** (E1) and Textract is waiting on AWS account activation (E2). |
| 7 | Versions, review, confirm gate, status polling | ☑ **done 2026-09-12** — 4 endpoints (history, review, edit, confirm). Edits create versions and never update one; the chain **cannot fork** (unique index on `supersedes_id`) and `confirmed_at` is a **latch** (conditional UPDATE), so confirming twice is a retry and no path can move the timestamp. `parse_status` makes the 202 pollable to a terminal state. **SRS 1.4.4 is enforced on three levels**: a SQL predicate, a new import-linter contract making resume's internals private, and a tripwire that fails the build if Day 8 wires scoring to `version_created` instead of `version_confirmed`. |
| 8 | **Scoring: extraction + rubric, caps, replay-from-storage — invariants 1, 2, 3, 4′** | ◐ **substantially done** — Layer 2, the extraction cache, persistence, replay, the display floor and the confirm-gated trigger (2026-09-12). **Bedrock extractor built 2026-09-13**, off by default; manual-form CVs go through it as rendered text. Owed: a model choice, the Terraform apply, AWS service activation, and the shareable card. |
| 9 | Integrity engine (no duplicate rule), suppression, employer tenancy + type/industry | ◐ **substantially done 2026-09-13** — integrity wired to scoring, HIGH suppression inside the one discovery CTE (fail-closed, candidate-wide, CONFIRMED keeps suppressing), employer tenancy with the three roles, and **rule thresholds now versioned config** (`integrity.thresholds`). Owed: reviewer-queue routes, blocked on platform-staff tenancy (blockers E10). |
| 10 | KYB (auto-approve default), jobs, publish gate — **invariant 8, Week 2 gate** | ☑ **done 2026-09-13** — KYB state machine with the `kyb.require_approval` switch (off: approved on arrival; on: waits for review), server-side form validation, document upload, and the decision mirrored onto `employers.kyb_status`. Jobs lifecycle, editable only as draft or paused, publish gated in service and trigger, and a coarse, rate-limited threshold preview. Sign up → KYB → publish works through the API. **Week 2 gate partly met:** invariants 1, 2, 3, 4′ and 8 are green, but the 20-real-resume run waits on a working model. |
| 11 | Job search, eligibility, apply, withdraw | ☑ **done 2026-09-15** — candidate job board (`/candidate/jobs`: search, filters, keyset cursor, detail) and the candidate's applications (`/candidate/applications`: apply, list, read, withdraw). **Pay-first is live**: `require_active_subscription` reads `subscriptions` on every request, never cached, and gates search and apply. Eligibility is judged on the stored score and returned as ELIGIBLE / BELOW_THRESHOLD / SCORE_PENDING, **the threshold itself never shown**. Apply is idempotent by the partial unique index, follows the discovery visibility rule, and is held in the database by five candidate RLS policies and a `(job_id, tenant_id)` foreign key. Owed: the seat limb (Day 17), and the gate on score and resume routes (Day 15, when a subscription can be bought). |
| 12 | Stage machine, events, hire confirm, expiry | ☑ **done 2026-09-15** — the employer's pipeline (`/employer/applications`: list by job and stage, open, move, interview, hire) and the candidate's side of it (history on the board, confirm or dispute a hire). **One stage forward or rejected**; opening a submitted application records VIEWED. `application_events` gains `kind` and `actor_type`, and the candidate never sees an employer's notes or which recruiter acted. **The two-sided hire is a database guarantee**: a CHECK refuses HIRED without both confirmations, and a trigger (`guard_application_write`) holds the transition graph, makes the confirmations latches, and lets each party write only its own side. Expiry measures the employer's silence from `employer_active_at`, period in `config_values` (`applications.expiry`, default 30 days — ours, not the client's), swept one tenant per transaction. Owed: the EventBridge schedule (E4), notifications (Day 19), hire billing (deferred by the client, 0.8). |
| 13 | Masked discovery, filters, search indexes | ☑ **done 2026-09-15** — `GET /employer/discovery/candidates` returns `MaskedCandidate` cards (band, whole years of experience, skills, city/state, add-on badges) with **no field that could hold a name, contact or score**, held by an invariant test on the field list. Filters: band, skills (all must match), badges, minimum experience, state, city, keyword; keyset by band then id, no total, owners and recruiters of a KYB-approved employer, rate-limited per organisation. **The search document is written only by a trigger on `scores`**, generated from the scoring bands and the badge map, so it cannot disagree with the score; visibility stays the Day 9 CTE's. GIN on skill keys, badges and a `simple` tsvector, trigram on city, and a `scores` index matching the CTE's latest-score order. Location is new and candidate-declared (`candidate_profiles`). Owed: questionnaire badges (Day 16), configurable caps and the access window (Day 14), plans verified under load (Week 5). |
| 14 | **Access windows, reveal audit, abuse controls — invariants 7, 7′** | ☑ **done 2026-09-15** — `GET /employer/discovery/candidates/{id}` opens one profile (`RevealedCandidate`: contact details, the **display** score, band, card facts; a name only when typed on the form, blockers E13) behind `require_active_access_window`, which reads the tenant's subscription live. **Every open writes an audit row and a view event in the same transaction**, re-opens included, ids only. Abuse controls: per-organisation hourly and daily caps on distinct candidates (under an advisory lock, checked before the lookup), a per-person burst limit, velocity and cap-reached alerts (audit row + outbox, blocking nothing), all in `config_values` `discovery.limits`, strict. **Export is not a feature**, held by an invariant test. `candidate_view_events` is now actually partitioned by month, partitions closed to the app role. **R15 applied**: jobs, pipeline and search need an active subscription; organisation, team and KYB stay open. Owed: alert readers (E10/E14), the partition schedule (E4), N4 still unacknowledged (B7). |
| 15 | Payments, **subscriptions, courses**, signed callbacks, entitlements — **Week 3 gate** | ☑ **done 2026-09-15** — `PaymentProvider` with a stub that signs callbacks for real (refused in staging/prod; the default sells nothing). Checkout for candidate and employer plans and the course; `POST /billing/callbacks/{provider}` verifies the HMAC **before** reading or writing, stores the raw payload, refuses replays by event id, answers 200 and settles out of band. **No entitlement without a verified callback, held in the database**: payments start PENDING, SUCCEEDED needs `signature_verified_at`, transitions are generated from the domain, and a course purchase needs its verified payment. Subscriptions: purchase, early renewal from the end, cancel at period end, grace (mandate only), lapse, every change evented. **Both renewal paths (R17)**: manual repurchase, and UPI AutoPay with a ≥24h pre-debit notice per attempt, retries, and fall-back to manual when a mandate dies silently. Courses: catalogue, purchase, audited service-only completion that re-scores from the stored extraction. `/candidate/score/me` is paywalled. **Week 3 gate:** forged callback grants nothing ☑, lapse keeps history ☑; schemathesis fuzzing ☐. Owed: a real gateway (D3), the relay's broker (Day 19), the sweep schedule (E4), a completion route (C1), the seat limb (Day 17). |
| 16 | Questionnaire, device check, audio session, chunk upload | ☑ **done 2026-09-16** — **Questionnaire** (`/candidate/questionnaire`): save progress (merging, all-or-nothing validation against the bank), submit, supplementary report; worth zero points, routed to nothing, no score-like field (invariant test). **Interview** (`/candidate/interview`): device check judged server-side and versioned (mic, audio out, network, storage, quiet — no camera, no lighting); checkout refused without a fresh passed check, and **a session that cannot move the score is refused unless the candidate acknowledges "this session will not increase your score"**, kept as `interview_checkout_notices`; purchase only by verified callback (`guard_interview_purchase`); sessions consume one purchase, rotate the three question sets, and resume instead of duplicating; per-question presigned upload judged on the stored bytes (Opus/AAC, size, duration), rejected audio deleted; completion needs every answer stored, audited, outboxed, and **held in the database** (`guard_interview_session_write`, generated from the domain). **Invariant 4′ re-verified end to end**: four sessions through the routes fold in +60 and replay exactly. Owed: evaluation (Day 17), points-on-completion decision (E19), abandon policy (E20), questionnaire reaching employers (E21), audio retention (E22). |
| 17 | Evaluation stubs, college tenant + **seats + referral codes**, roster import | ☑ **done 2026-09-17** — **Evaluation**: `TranscriptionProvider` and `EvaluationProvider` (unconfigured default raises; stub refused in staging/prod), a task on `interview.session_completed` that transcribes each answer once and rates spoken answers against the rubric, insert-only transcripts and evaluations, and a candidate report **in words, with no number about the candidate**. FAILED `no_speech` / `evaluation_invalid`, never repaired; the +20 cannot move and EVALUATED needs its evaluation row (guard). **Colleges**: organisation, admin/staff team, versioned onboarding, `/college/subscription`. **Seats**: per-student `college_seat_assignments`, the cap and `seats_used` held by `guard_college_seat_assignment`, allocation capped by the live plan (service only, E10), and **the seat limb of `require_active_subscription`** — a live seat at a paying, active college. **Referral codes**: 60-bit, expiring, revocable, rate-limited, one refusal for every bad code; **entering one is ROSTER consent only**, re-checked by the INSERT policy. **Rosters**: CSV preview with malformed and duplicate rows before commit, idempotent by content, commit re-checks and deletes what will not be invited; invitations sent as outbox events and **accepted by the student from their own verified contact**. A student never binds a college's tenant: nine narrow SECURITY DEFINER functions. Owed: a real speech model and evaluator, the allocation route (E10), revocation route (Day 18), delivery (D1, SES, E15), Round 8 follow-ons. |
| 18 | **Consent scopes, cohort analytics — invariant 9** | ☑ **done 2026-09-17** — **Two scopes, two acts**: ROSTER comes only from a code or an accepted invitation, INDIVIDUAL only from the student's separate grant against its own versioned words (`POST /candidate/colleges/{id}/individual-visibility`), held by a CHECK (`scope = INDIVIDUAL` ⇔ `granted_via = DIRECT`) and a trigger requiring a live link. **Revocation is the student's and immediate** (`POST .../revoke`): INDIVIDUAL keeps the link; ROSTER disconnects and ends the seat and INDIVIDUAL in the same statement; never paywalled. **A college can no longer write or revoke a consent**: RESTRICTIVE policies close what the permissive tenant policy allowed (SRS 1.15.3). **Analytics** (`/college/analytics/overview`, `/placements`) read only through six SECURITY DEFINER functions that INNER JOIN live consent for the bound college and return no identifiers; floors in `config_values` `analytics.privacy` (cohort 10, cell 5 with complementary suppression, median to 10 — ours). Placements are confirmed platform hires by IST month and job location, labelled `PLATFORM`. **Individual view** (`/college/students`, `/{id}`): live INDIVIDUAL consent read on every request, every list page and every open audited in the transaction. Owed: cohort filters (E26), counsel's words and the client's field list and floors (E27), the before/after residual (E28), REVOKED state on roster rows, the college-facing revocation notice (Day 19). |
| 19 | Admin queues, drill-downs, disputes, **seats + suspension**, notifications + **nudges** | ☑ **done 2026-09-17** — **Staff tenancy** (E10): one PLATFORM tenant, a trigger holding every role to its kind of tenant, staff provisioned by script. **Console** (`/admin`): KYB submissions as a record (open, decide when approval is on), integrity queue (open with evidence, clear or confirm), organisations, candidate / employer / college drill-downs, dispute queue, audit search by actor, action, target and time, keyset-paged. **Every cross-tenant read audits first**, then opens the read-only bypass session; a failed audit reads nothing. **Seats** (E23) and **suspension**: a row mirrored onto `tenants.status` by trigger, refused on the member's very next request despite the membership cache, jobs off the board, nothing deleted, audited. **Disputes** from all three groups (`/disputes`), cross-linked to the application and the candidate's integrity record; a candidate's hire dispute is filed automatically; only staff move a dispute's state (guard). **Notifications**: the relay enqueues to the broker (E15 in code), 15 events fanned out by `plan_for`, every message recorded with its skip reason, deduplicated, inbox and preferences; Twilio Messaging and SES adapters, default off; **no SMS without a DLT id**. **Nudges**: capped, spaced, IST hours, stoppable, config-driven. Owed: schedules (E4), live delivery (D1, D2, SES, E30), seats under a suspended college (E29), a remedy for hire disputes (E12). |
| 20 | Privacy, rate limits, index review, handover — **Week 4 gate** | ☑ **done 2026-09-17** — **The erasure is a policy and a cascade, held together by a test.** `privacy.domain.ERASURE_PLAN` classifies **every table in the schema** as erased, retained under the carve-out the client confirmed (*"B3 correct"*), not personal, or self-expiring, each with its reason; `tests/invariants/test_erasure_plan.py` reads the **live database** and fails on a table nobody classified, and asserts the SQL deletes exactly what the plan says and never touches a retained one. The cascade is `erase_candidate`, one SECURITY DEFINER function in one transaction, because the app role holds no DELETE on `scores` (invariant 3) and giving it one to erase people would trade one legal requirement for another. `users` is **emptied, not dropped** — it anchors every retained payment and audit row, and `cognito_sub` is replaced by its SHA-256 so a token issued before the erasure is refused rather than signing the person up again (found by the test that asserted 401; it was answering 200). Deletion has a 24h cooling-off period and can be withdrawn; the seat is released through its guard so the college gets it back; a shared extraction-cache row survives if another candidate's score still names it (`scores.extraction_cache_key`, new). **Export** is a zip of JSON behind a 10-minute link, audited per mint, carrying the score and not the breakdown — the score is never explained, and an export is not a way round that. **Rate limits**: one table, three scopes, two tiers — global per IP (middleware, pre-auth), per user and per tenant (in `current_user`), failing *open*; specific limits on OTP and the threshold preview failing *closed*, and a test holds those two as the tightest on the platform. **Index review**: a test, not a one-off — every hot query shape planned with `enable_seqscan = off`, plus every FK on a growing table indexed or exempted in writing; found and fixed four real gaps under the new erasure. **Handover**: OpenAPI (141 paths), a generated Postman collection (157 requests), [`integration-notes.md`](integration-notes.md) for the four client teams, and a README a new developer can run in ten minutes. Owed: the retention *period* (B3), the schedules for both sweeps (E4), Cognito user deletion (E32), business-account erasure (E33), an S3 lifecycle rule on exports (E34). |

**Added outside the twenty days**

| Added | Feature | Status |
|---|---|---|
| 2026-09-13 | **Daily streaks and engagement points** (client request) — `engagement` module, 3 endpoints | ☑ **built 2026-09-13** — current/longest streak, last active date, −10 per break, +10/+15/+20 at 30/90/365 days, all numbers in `config_values`. **Built as a separate balance, not the score:** applied to the score the request breaks invariants 1, 2, 3 and 4′, so `engagement` and `scoring` are made independent by an import-linter contract and an invariant test. Eight decisions (S1–S8) await client confirmation. See [`streaks.md`](streaks.md). |

### Invariant coverage

| # | Invariant | Lands | Status |
|---|---|---|---|
| 5 | No age-gating | Day 1 | ☑ **green** |
| 6 | No financial framing | Day 1 | ☑ **green** |
| 1 | Score reproducible — **incl. add-ons and the stored extraction chain** | Day 8 | ☑ **green 2026-09-12** — `replay(score_id)` re-runs Layers 2 and 3 over the stored model response and **never calls the model**; a mismatch raises rather than returning a different number. Tested with add-on contributions, not only base scores. The 35-profile golden corpus still gates the rubric half. |
| 2 | Scale **700–990**; base not floor; stored == displayed | Day 8 | ☑ **green 2026-09-12** — CHECK constraints hold the range and the component sum; `display_value` applies the floor at the serialization boundary **and nowhere else**, so what is stored is what was computed. Asserted across all 291 values in range. |
| 3 | Score not human-editable, **directly or indirectly** | Day 8 | ☑ **green 2026-09-12** — `repository.insert_score` is the only write path and there is deliberately no update or delete function; the app role holds no UPDATE or DELETE grant on `scores`, proven by `test_scores_are_insert_only` rather than assumed. |
| **4′** | **Add-on contributions bounded and versioned** | Day 8, re-verified Day 16 | ☑ **green 2026-09-12** — now exercised end to end through the real write path: a caller asking for 500 course points and 500 interview points gets 90, and `base + addon = raw` still holds. `contribution_version` is stored on every row. |
| 8 | No publish before KYB *(gate built, flag defaults open)* | Day 10 | ☑ **green 2026-09-13** — service check plus the Postgres trigger, re-checked on PAUSED → PUBLISHED, and tested with `kyb.require_approval` on, and through a direct repository call. |
| 7 | Masked without an active access window, **raw score never revealed** | Day 14 | ☑ **green 2026-09-15** — the one revealing route carries `require_active_access_window`, read live; **a window ended one request earlier refuses the very next read**, tested on the same token. No employer, college or admin response schema has a raw-score field (walked through OpenAPI), `RevealedCandidate`'s field list is fixed and refuses `raw_value`, and no route exports, downloads or lists revealed profiles. |
| **7′** | **Every PII reveal audited, under blanket access** | Day 14 | ☑ **green 2026-09-15** — one `audit_events` row and one `candidate_view_events` row per open, re-opens included; metadata holds ids and no personal data; **an audit write that fails rolls the view event and the reveal back**, tested by failing it. The view log is monthly-partitioned, append-only, closed to direct partition access, and tenant-isolated. |
| 9 | Consent and audit | Day 18 | ☑ **green 2026-09-17** — every function a college reads a student through is checked in `pg_proc` to join live consent of the right scope, and the college-facing repositories name no student table; **revoking consent removes the student from the aggregates and the individual view on the next read**; ROSTER never implies INDIVIDUAL; only the student grants or revokes (RESTRICTIVE policies); every open and list page is audited in the transaction, and a failed audit returns nothing; the individual view's field list is fixed and no aggregate schema has a field for a person. |

> ~~4 — Paid add-ons never change the core score~~ · **rescinded by the client 2026-08-24**,
> replaced by 4′ above. Its test file is rewritten, not deleted.

**All ten green at the Week 4 gate (2026-09-17).** Day 20 added
`tests/invariants/test_all_ten_invariants_are_covered.py`, which names the file
proving each one and fails if it is renamed away, emptied, or stops mentioning
what it proves. Two of those files live in `tests/integration/` and always
will: invariants 3 and 8 are proved by going *round* the service and into the
database's own grants and triggers, which is an integration test by
construction. The table above is maintained by a human and the new test is the
machine's copy of it — the failure this guards against is this table reading
green while a file it names no longer runs.

### Questions

Resolved by the client's comments and note. Full detail in [§13](#13-decisions-and-open-questions).

| Ref | Subject | Status |
|---|---|---|
| Q1 | In-app recording, not phone call | ☑ Resolved 2026-08-24, re-confirmed 08-24 comment |
| Q3 | Audio only, no video | ☑ Resolved 2026-08-24 |
| Q4 | Cognito, two user pools | ☑ Resolved 2026-08-24 |
| D1 | Twilio Verify for OTP, Messaging for SMS | ☑ Resolved 2026-08-24 |
| R1 | Paid add-ons DO change the score | ☑ **Resolved 2026-08-27** |
| R2 | Scale 700–990 | ☑ **Resolved 2026-08-27** (composition still open) |
| R3 | No anonymous flow, sign-up gates all | ☑ **Resolved 2026-08-27** |
| R4 | Employers never see the raw score *(closes Q2)* | ☑ **Resolved 2026-08-24** |
| R5 | Subscriptions, courses, tiers, seats | ☑ **Resolved 2026-08-24** (pricing open) |
| R6 | Duplicate detection dropped | ☑ **Resolved 2026-08-24** |
| R8 | Employer type and industry | ☑ **Resolved 2026-08-27** (values owed) |
| R9 | Incomplete-profile nudges | ☑ **Resolved 2026-08-27** |
| R10 | Scoring arithmetic closes exactly at 990 | ☑ **Resolved 2026-08-27** |
| R11 | Score never explained to the candidate | ☑ **Resolved 2026-08-27** |
| R12 | Reproducible AI scoring approach | ☑ **APPROVED 2026-08-30** |
| R13 | Pay-first for all three audiences | ☑ **Resolved 2026-08-27** |
| R14 | No unlocks — whole database per paid period | ☑ **Resolved 2026-08-27** ⚠ risk open |
| R15 | KYB form + switchable auto-approval; payment is the gate | ☑ **Resolved 2026-08-27** |
| R16 | College referral-code linking | ☑ **Resolved 2026-08-27** |
| R17 | Manual and UPI-mandate renewal, user's choice | ☑ **Resolved 2026-08-27** |
| R18 | Written confirmations | ◐ 3 of 4; duplicates provisional |
| P1 | KYB auto-approve | ⚠ **Provisional — client said both. Ours to confirm.** |
| Q7 | Anonymous session lifetime | ☑ Moot — flow deleted |
| Q5 | Wallet vs. per-unlock | □ Superseded by R5; employer half open |

**Open — see `questions.txt` for the plain-language versions to send.**

| # | Subject | Severity | Needed by | Status |
|---|---|---|---|---|
| Q1 | Score arithmetic: 700 / 990 / 200-point band | — | — | ☑ **Answered 08-27** (R10) |
| Q2 | Is the 200-point band judged by an AI model? | — | — | ☑ **Answered 08-27** — yes; our approach in `scoring-approach.md` (R12) |
| Q3 | Explainable, or not? | — | — | ☑ **Answered 08-27** — never explained (R11) |
| Q4 | Add-on points: per item or lifetime? | — | — | ☑ **Answered 08-27** (R10) |
| Q5 | Do add-on points clip at 990? | — | — | ☑ **Answered 08-27** — cannot exceed it (R10) |
| **N1** | **Approve `scoring-approach.md`** | ~~Blocker~~ | Day 8 | ☑ **APPROVED 2026-08-30** |
| **N2** | **Data residency: can CV text leave India?** | **Blocker** | Day 8 | ☐ Open |
| **N3** | **Calibration corpus — 50–100 real CVs + expected bands** | **Blocker** | Day 8 | ☐ Open |
| **N4** | **Written acknowledgement of the bulk-extraction risk** | **Risk** | Day 14 | ☐ Open |
| Q6 | Is the score itself behind the subscription? | — | — | ☑ **Answered 08-27** — yes, all three audiences (R13) |
| Q7 | KYB: automatic or manual? | — | — | ☑ **Answered 08-27** — form stays, auto-approve, switchable (R15) |
| Q8 | What does an employer tier include? | — | — | ☑ **Answered 08-27** — no tiers, whole database (R14) |
| Q9 | Employer type and industry lists | Soft | Day 9 | ⏳ Deferred by client — impact answered |
| Q10 | College seats: model and limit behaviour | Decision | Day 17 | ☑ **Answered 2026-09-11** (Round 7.7, *"yes"*) — one payment per period for up to N students; built 2026-09-17 with the N+1th student linked but not seated |
| Q11 | Subscriptions: auto-renew or manual? | — | — | ☑ **Answered 08-27** — both, user's choice (R17) |
| Q12 | Written rescission of PRD/SRS criteria | Decision | Day 8 | ◐ 3 of 4 received (R18); score-explanation outstanding |
| Q13 | Deletion vs. audit retention *(legal)* | Decision | Day 20 | ☐ Open |
| **N5** | **Rescission of the unlock criteria — PRD §2/§3.6/§5.3, SRS §1.14, §1.20.8, §2.9.6–7, §2.25.2 ×3** | **Decision** | Day 13 | ☐ **Open — never asked** |
| **N6** | **Referral-code consent vs. PRD rule 8's "invite-and-accept"** | Decision | Day 17 | ☑ **Answered 2026-09-11** (Round 7.9, *"do it"*) — built 2026-09-17 alongside invite-and-accept |
| **N7** | **🔴 Course content — who produces it, what format, how completion is determined** | **Scope** | Now / Day 15 | ☐ **Open — never asked** |
| **N8** | **Plans, prices, course catalogue** | Decision | Day 15 | ☐ **Open — never asked** |
| **N9** | **Language list (6–8) and who funds translation** | Soft | Day 19 | ☐ Open |
| **S1** | **Streak points: separate from the score (as built), and what are they for?** Plus S2–S8 on the rules — [`streaks.md`](streaks.md) §7 | Decision | Before launch | ☐ **Open — never asked** |

### Infrastructure readiness — confirm before Day 1

| Item | Status |
|---|---|
| Postgres + two roles | ☑ local (docker-compose, 40 tables / 12 RLS policies) and CI. Not provisioned in AWS — deliberate, see `infra/README.md`. |
| Cognito pools + app clients | ☑ **applied 2026-09-11** — account 592033927084, ap-south-1. Both pools live; JWKS fetched through `app/core/auth/cognito.py` itself, and an `alg=none` forgery correctly rejected. |
| Cognito custom-auth Lambda triggers | ☐ Blocked on Twilio — the triggers call Verify. |
| **Twilio account + Verify service created** | ☐ |
| **Payment gateway that supports recurring billing** (subscriptions, R5) | ☐ |
| **Twilio test credentials in hand (unblocks Day 3)** | ☐ |
| **Twilio live credentials in Secrets Manager, readable by the Lambdas** | ☐ |
| Google IdP on candidate pool | ☐ |
| Redis | ☑ local (docker-compose) and CI. ElastiCache deferred to Day 20. |
| S3 buckets (4) | ☑ **applied 2026-09-11** — six buckets, all private, AES256-encrypted and versioned (versioning is what makes invariant 1 replayable). |
| SQS + IAM | ☑ **applied 2026-09-11** — queue + dead-letter queue. Least-privilege policy verified both ways: object and queue access work, bucket creation and IAM listing are denied. |
| Secrets Manager | ◐ Containers created; **values not set** — the Twilio secret stays empty until an account exists. |
| CI/CD + registry | ☑ backend-ci green on all five jobs (2026-09-11). Registry push not yet configured. |

---

## Where to start tomorrow

1. **Send `scoring-approach.md` for approval, and `questions.txt` for the rest.** The scoring
   questions are answered; three new blockers replace them, all on Day 8: approve the scoring
   design, answer the data-residency question in its §13, and book the calibration session to
   produce the CV corpus. Q13 has a legal review cycle attached, so it needs asking today to land
   by Day 20. **New in v6.1 and in the same send:** the bulk-extraction acknowledgement (N4), the
   unlock rescission (N5), the referral-code confirmation (N6), and prices (N8).
2. **🔴 Ask who is making the course — today, separately, and to a human rather than in a
   document.** N7. The client sells a course that moves the score by 30 points, and nobody has
   said who produces it, what format it is, or **what counts as completing it** — that last one is
   a rule we have to write, and it moves a score. Producing course video is a content project with
   its own budget and timeline that **is not in any estimate we have given.** This has been in
   `resources-needed.md` since v4 without ever reaching the client. It has the longest uncontrolled
   lead time of anything still open and it is the item most likely to be discovered late.
3. **Ask counsel to re-review the scoring model** before Day 8. Selling an item that raises a
   three-digit consumer score is a different proposition to giving that score away free, and any
   sign-off obtained against the old design no longer covers it. See
   [§13 Legal](#legal--raise-before-day-8).
4. **Re-baseline the twenty days.** The v4 changes remove about a day and a half of work and add
   four to six, concentrated on Days 8, 14 and 15 — the three days already flagged as
   uncompressible. The scope in [§8](#8-the-four-week-build) is current; the *schedule* is not.
   Do not quote a date off the old one.
5. **Start TRAI DLT registration today, and open the Twilio account alongside it.** DLT is 2–4
   weeks, longer than the entire sprint, and **neither Cognito nor Twilio removes it** — it binds
   the sender, not the gateway. Ask Twilio in the same thread whether Verify's India templates sit
   under their Principal Entity or the client's; that answer moves the lead time. Grab the test
   credentials immediately — they unblock Day 3 regardless of where DLT stands.
6. **Confirm the payment gateway supports recurring billing**, and find out whether renewal is
   automatic (UPI e-mandate, its own registration flow) or manual repurchase. This is
   `questions.txt` Q11 and it changes the size of Day 15 substantially.
7. **Confirm every row of the infrastructure readiness table before Day 1.** A twenty-day sprint
   has no slack for waiting on a Cognito pool.
8. Then Day 1: scaffold, CI, all 20 module skeletons, and the two invariant tests that cost an
   hour and run forever.

*Derived from `Docs/Product Requirements Document.pdf` and
`Docs/BharatPath_SRS_User_Flows_Interface_Specifications_v3_Phone_Interview.docx.pdf`.
Companion to `BharatPath_Build_Brief_new.docx` — whose body text is identical to the 24 August
version; all client updates in it are carried in comments. Client decisions of 2026-08-24
(document comments) and 2026-08-27 (note) incorporated. Open items in `questions.txt`.*
