# BharatPath — Backend

One FastAPI service consumed by all four surfaces — the candidate mobile app,
and the employer, college and admin web consoles — plus Celery workers and one
Celery Beat scheduler running from the same image.

Product rules, client decisions and open questions live in
[`../docs/`](../docs/). [`../docs/plan.md`](../docs/plan.md) §1 lists the
invariants this code exists to hold; [`../docs/blockers.md`](../docs/blockers.md)
lists what is still waiting on a decision.

---

## Run it

Nothing but Docker and Python 3.12 is required.

```bash
cd backend
cp .env.example .env
docker compose up -d postgres redis      # localstack and mailhog are optional

python -m venv .venv && source .venv/bin/activate   # Windows: .venv/Scripts/activate
pip install -e ".[dev]"

bash scripts/reset_local_db.sh    # roles, schema, config and catalogue seeds. Idempotent
source .test-env.sh               # NOT optional -- see below
pytest                            # the whole suite, against that database
bash scripts/dev_all.sh           # API on http://localhost:8099 (docs at /docs) + worker + relay
```

**Use `dev_all.sh`, not `dev_api.sh`, for anything that touches resumes,
scoring or payments.** Those flows are asynchronous: the API writes an outbox
row and a Celery worker acts on it. With only the API running, an upload
succeeds and its parse never starts. `dev_all.sh` runs the API, a worker and a
two-second outbox relay together (logs in `/tmp/bp_api.log` and
`/tmp/bp_workers.log`). The hourly and daily sweeps — expiry, renewals,
erasure, nudges — need beat as well:

```bash
celery -A app.worker beat --loglevel=info      # exactly one, ever
```

**Front-end teams: [`../docs/local-backend-setup.md`](../docs/local-backend-setup.md)**
is the same thing written for someone who only wants the API running — tokens
without Cognito, checkouts without a gateway, and what is switched off locally.

`reset_local_db.sh` runs Alembic as the **migrator** role, which owns the
tables; the application connects as a role that is genuinely subject to
row-level security, which is what makes the RLS tests mean anything. On
Windows, pass the interpreter explicitly:
`PYTHON=.venv/Scripts/python.exe bash scripts/reset_local_db.sh`.

Container startup runs Uvicorn only. Schema changes are applied separately
with `python -m alembic upgrade head` as `DATABASE_URL_MIGRATOR`, before the
new application image starts; the production Compose file does this in its
`migrate` service.

**`source .test-env.sh` before running the tests**, or four RLS tests fail in
a way that looks exactly like a regression: without it the app connects as a
role that bypasses RLS, and a test asserting "this write is refused" reports
`DID NOT RAISE`. The tests are right; the connection is wrong.

**Run `pytest`, not `python -m pytest`.** The latter puts the working
directory on `sys.path` and hides import errors that CI will catch.

**Mint a token** for a local client: `POST /api/v1/auth/dev/token`. The route
does not exist unless `AUTH_ALLOW_LOCAL_TOKENS=true`, and `Settings` refuses
to boot with that flag set outside local and CI.

## How developers test

**Almost everything runs locally against `docker compose`.** You do not point a
local process at a deployed database, and you never point one at production.

| Dependency | Locally | Why |
|---|---|---|
| **Postgres** | Real Postgres 16 in Docker | RLS, JSONB, partial indexes and `SET LOCAL` all behave differently on SQLite — testing against it would prove nothing |
| **Redis** | Real Redis in Docker | Cache, rate limits and the Celery broker |
| **S3** | **LocalStack** — `AWS_ENDPOINT_URL` points boto3 at the container | Presigned URLs and multipart uploads are close enough to be worth exercising |
| **Email** | `NOTIFICATIONS_EMAIL_PROVIDER=stub`, or **Mailhog** at :8025 | |
| **Cognito** | ⚠️ **Cannot be emulated.** `AUTH_ALLOW_LOCAL_TOKENS=true` mints real RS256 tokens locally | Never point a local process at a production pool |
| **OpenAI / Sarvam / Textract** | Behind provider interfaces with `stub` implementations, refused in staging and production | Real calls only with your own key; `scripts/smoke_interview_live.py` exercises the live interview loop |
| **Payment gateway** | `PAYMENTS_PROVIDER=stub` — signs callbacks with a real HMAC, takes no money ([`../docs/payments-bypass.md`](../docs/payments-bypass.md)) | No gateway is chosen yet (blockers D3) |

**Nobody connects a local process to production.** Not to debug, not "just to
read". Production holds real candidates' CVs, phone numbers and email
addresses; under the DPDP Act, a developer laptop with a production connection
string is an unmanaged copy of that data.

## Where configuration comes from

| | Local | Deployed host |
|---|---|---|
| Source | `.env` (from `.env.example`) | `.env` on the host, written from `terraform output -raw env_file` |
| DB credentials | Fake, matching `scripts/init_db_roles.sql` | Real, never in the repo |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` (LocalStack) | **Unset** — boto3 talks to real AWS |
| AWS credentials | The literal string `test` | **None.** The host's IAM instance role supplies temporary credentials |

**Long-lived AWS access keys should not exist in a deployed environment.**
They cannot be rotated without a deploy, they leak through logs and backups,
and they never expire. If you find yourself pasting an `AKIA…` key into a
config, the answer is an IAM role.

`app/settings.py` reads all of this once at boot and never logs it;
`app/core/logging.py` redacts it if it ever reaches a log line anyway.

Deploying, and what runs where: [`../docs/aws-deployment.md`](../docs/aws-deployment.md).

## Checks

The same as CI:

```bash
python scripts/check_no_age_fields.py   # invariant 5
python scripts/check_vocabulary.py      # invariant 6
ruff check app tests scripts && ruff format --check app tests scripts
mypy app                                # strict on every domain.py
lint-imports                            # module boundaries (.importlinter)
python scripts/gen_modules.py --check   # every module registered
pytest --cov=app
pytest -m contract                      # schema fuzzing; slow, not in the default run
```

Invariants 5 and 6 are legal requirements rather than style preferences; the
rest of the invariants are tests under `tests/invariants/`. **Never weaken one
to make a change pass**: they encode client and regulatory commitments, and
`test_all_ten_invariants_are_covered.py` fails if one is quietly renamed away.

`scripts/export_openapi.py` writes `openapi.json` and
`scripts/export_postman.py` the Postman collection from it. Neither is
committed: CI publishes both as artifacts, so a copy in the repo can never be
the stale one somebody imports.

---

## Layout

```
backend/
├── app/
│   ├── main.py             FastAPI factory, middleware, error handlers
│   ├── worker.py           Celery factory
│   ├── settings.py         env-driven; NOT where product numbers live
│   ├── api/                root router + health
│   ├── core/               db, tenant, deps, errors, audit, outbox,
│   │                       pagination, rate limits, logging, i18n
│   ├── modules/            21 modules, one layered shape
│   └── tasks/              Celery tasks — thin wrappers over services;
│                           routing.py (events) and schedule.py (beat)
├── alembic/versions/       baseline + incremental revisions
├── scripts/                invariant guards, seeds, module scaffold, exports
└── tests/
    ├── unit/               pure domain logic, no I/O
    ├── integration/        real Postgres from docker compose, never SQLite
    └── invariants/         one file per rule — never delete these
```

A module is made of these layers, each present only where the module needs it:

| File | Rule |
|---|---|
| `router.py` | HTTP only. Never touches a repository. |
| `schemas.py` | Pydantic DTOs. The API contract. ORM models are never exposed. |
| `models.py` | SQLAlchemy ORM. |
| `repository.py` | All DB access. **Private to the module.** |
| `service.py` | Business rules, transaction boundaries. Never touches `Request`. |
| `domain.py` | Pure functions and state machines. No I/O. mypy strict. |
| `events.py` | Event names emitted through the outbox. |

**A module may import another module's `service`, never its `repository` or
`models`.** That single rule is what makes later service extraction mechanical
rather than archaeological, and `lint-imports` checks it in CI.

Adding a module: append to `MODULES` in `scripts/gen_modules.py` and run it.

**Migrations.** Shared databases move by incremental revisions (`0002`…). The
baseline builds tables from the *current* models, so a later revision that adds
something a model already declares must be idempotent (`if_not_exists`,
`DROP … IF EXISTS`), and a brand-new table goes in both the baseline's
`_create_from_metadata` lists and a revision that creates it only when
missing. The baseline is not reversible; rebuild locally with
`reset_local_db.sh`.

---

## The ten invariants

`docs/plan.md` §1 calls these architectural invariants, not features. Each is
pushed to the lowest layer that can enforce it — **database constraint >
repository query shape > domain service > API schema > UI** — and each has a
test that proves it.

| # | Rule | Enforced by | Proved by |
|---|---|---|---|
| 1 | Score reproducible (never explained) | Full extraction chain stored; `replay()` never re-invokes the model | `test_invariant_01_02_03_scoring.py`, `test_score_never_explained.py` |
| 2 | Scale 700–990; 700 is a base, not a floor | Arithmetic, not a clamp — stored == displayed | `test_invariant_01_02_03_scoring.py` |
| 3 | Score never human-editable | No route accepts a score; app role has no `UPDATE` on `scores` | `test_rls_and_grants.py::test_scores_are_insert_only` |
| 4′ | Add-on contributions bounded and versioned | Caps as pure functions; `lint-imports` contract | `test_invariant_01_02_03_scoring.py`, `.importlinter` |
| 5 | No age-gating | `scripts/check_no_age_fields.py` | `test_invariant_05_no_age_gating.py` |
| 6 | No financial framing | `scripts/check_vocabulary.py` | `test_invariant_06_no_financial_framing.py` |
| 7 | Masked without an active access window | `require_active_access_window`; the card's schema has no contact or score field | `test_invariant_07_access_window.py`, `test_masked_candidate.py` |
| 7′ | Every PII reveal audited | Audit row in the same transaction as the reveal | `test_invariant_07_prime_reveal_audit.py` |
| 8 | No job publish before KYB approval | Domain service + Postgres trigger | `test_jobs.py::test_the_database_refuses_a_publish_that_skips_the_service` |
| 9 | College consent required, every reveal audited | Consent joined by the query itself, not a Python `if` | `test_invariant_09_consent.py` |

Three that are easy to get wrong:

- **Invariant 8's test runs with `kyb.require_approval` ON**, even though
  production defaults it off (R15). A gate only ever exercised in the config
  where it does nothing is not a tested gate.
- **Invariant 4′'s contract is inverted, not deleted.** The client reversed the
  original rule ("paid add-ons never change the score") on 2026-08-24. So
  `scoring` *reads* add-on completion events, and the add-on modules still
  import nothing from `scoring` — which is what stops one awarding itself points.
- **Invariant 7′ audits the read.** Blanket employer access (R14) removed the
  natural one-row-per-unlock audit trail, but PRD rule 9 still applies, so
  every reveal writes its own audit row.

---

## Conventions

- **Base path** `/api/v1`. Version in the path, never a header.
- **Surface prefixes are namespacing, not authorisation.** A candidate hitting
  `/employer/*` is rejected by the role dependency, not by routing.
- **Cursor pagination**, never offset. `total` only where it is cheap and safe.
- **Async operations** (resume upload, data-subject requests) return `202`.
- **Errors**: an `AppError` is RFC 9457 `application/problem+json` with a
  stable `code` — match on `code`, never on `title`. An unparseable body is
  answered by the framework as `{"detail": ...}`; `openapi.json` documents
  both shapes.
- **A foreign tenant's resource returns 404, never 403.** 403 confirms it exists.
- **Timestamps** are UTC ISO-8601. Clients render IST; the server never does.
- **Enums** are `SCREAMING_SNAKE` matching the SRS state names exactly.
- **Money** is integer minor units (paise), in columns named `*_minor`. Never a
  float, never `Decimal` at the API boundary.
- **Tenant IDs come from server-side membership.** Never from a path, query,
  body or header (SRS §2.24.7).
- **Product numbers are data, not scattered constants.** Tunables (view caps,
  expiry, nudges, analytics floors, integrity thresholds, renewal policy) are
  `config_values` rows seeded by `scripts/seed_config.py` from the code's own
  defaults; plans and prices are versioned `plans` rows seeded by
  `scripts/seed_catalogue.py`. Changing one is inserting a new version, not an
  update.

---

## Where things are

| | |
|---|---|
| Integration notes for the client teams | [`../docs/integration-notes.md`](../docs/integration-notes.md) |
| Every route, in detail | [`../docs/APIs.md`](../docs/APIs.md) |
| Sign-up, accounts and discount codes | [`../docs/signup-and-accounts.md`](../docs/signup-and-accounts.md) |
| What is stubbed or waiting, and on whom | [`../docs/blockers.md`](../docs/blockers.md) |
| Deployment | [`../docs/aws-deployment.md`](../docs/aws-deployment.md) |

**Data-subject requests** live in `app/modules/privacy`. The policy is
`privacy/domain.py` — every table in the schema classified as erased,
retained under the financial and audit carve-out, or not personal — and the
cascade that executes it is `erase_candidate`, one SECURITY DEFINER function.
It is a database function and not Python because the application role holds
no DELETE on `scores` (invariant 3) and must not be given one. The retention
*periods* on what survives are still counsel's, so `RETENTION_POLICY_VERSION`
starts `placeholder-` and a test says so.

**Rate limits** are all in one table, `app/core/ratelimit.py`: a generous
global tier per IP, per user and per tenant, and tight specific limits on OTP
and the employer threshold preview. The global tier fails *open* on a Redis
outage and the specific ones fail *closed*.

**The index review** is `tests/integration/test_index_review.py`, and it is a
test rather than a one-off: it plans every hot query shape with sequential
scans priced out, and holds every foreign key on a growing table to an index
or a written exemption.

**Placeholder content** — prices, the course syllabus, question banks, form
versions, consent wording, notification templates, non-English locale bundles
— is ours, not the client's, and each piece carries a flag a test asserts
(`tests/unit/test_content_placeholders.py`). Flipping one is a client
decision, not a tidy-up.
