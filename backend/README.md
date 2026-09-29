# BharatPath — Backend

One shared FastAPI service consumed by all four surfaces: the candidate mobile
app, and the employer, college and admin web consoles. Plus Celery workers
running from the same image.

The build plan, the client decision history, and the open questions live in
[`../docs/`](../docs/). **[`../docs/plan.md`](../docs/plan.md) is the working
document** — start there.

---

## Run it

Ten minutes from a clean checkout, and nothing but Docker is required.

```bash
cd backend
cp .env.example .env
docker compose up -d postgres redis      # localstack and mailhog are optional

python -m venv .venv && source .venv/bin/activate   # Windows: .venv/Scripts/activate
pip install -e ".[dev]"

bash scripts/reset_local_db.sh    # roles, schema, seed catalogue. Idempotent
source .test-env.sh               # NOT optional -- see below
pytest                            # the whole suite, against that database
bash scripts/dev_api.sh           # http://localhost:8099, docs at /docs
```

**Front-end teams: [`../docs/local-backend-setup.md`](../docs/local-backend-setup.md)**
is the same thing written for someone who only wants the API running -- tokens
without Cognito, checkouts without a gateway, and what is switched off locally.

`reset_local_db.sh` runs Alembic as the **migrator** role, which owns the
tables; the application connects as a role that is genuinely subject to
row-level security, which is what makes the RLS tests mean anything. On
Windows, pass the interpreter explicitly:
`PYTHON=.venv/Scripts/python.exe bash scripts/reset_local_db.sh`.

Container startup runs Uvicorn only. Apply schema changes separately with
`python -m alembic upgrade head` using `DATABASE_URL_MIGRATOR` before
deploying the new application image. The official production Compose
deployment does this through its dedicated `migrate` service.

**`source .test-env.sh` before running the tests**, or four RLS tests fail in
a way that looks exactly like a regression: without it the app connects as a
role that bypasses RLS, and a test asserting "this write is refused" reports
`DID NOT RAISE`. The tests are right; the connection is wrong.

**Run `pytest`, not `python -m pytest`.** The latter puts the working
directory on `sys.path` and hides import errors that CI will catch -- that
exact divergence has produced a green local suite and a red CI for one commit.

**Mint a token** for a local client: `POST /api/v1/auth/dev/token`. The route
does not exist unless `AUTH_ALLOW_LOCAL_TOKENS=true`, and `Settings` refuses
to boot with that flag set outside local and CI.

**Everything above runs on your machine.** No AWS account, no credentials, no
network. `.env.example` is a local-only template — deployed environments have
no `.env` file at all and get the same variable names injected from AWS Secrets
Manager by the ECS task definition.

## How developers actually test

The short version: **almost everything runs locally against `docker compose`.**
You do not point a local process at a deployed database, and you never point
one at production.

| Dependency | Locally | Why |
|---|---|---|
| **Postgres** | Real Postgres 16 in Docker | RLS, JSONB, partial indexes and `SET LOCAL` all behave differently on SQLite — testing against it would prove nothing |
| **Redis** | Real Redis in Docker | |
| **S3 / SQS / Secrets Manager** | **LocalStack** — `AWS_ENDPOINT_URL` points boto3 at the container | Presigned URLs, multipart uploads and queue semantics are close enough to be worth exercising |
| **Email** | **Mailhog** at :8025 — catches mail, sends nothing | |
| **Twilio OTP** | **Test credentials against the real API.** Exercises the genuine flow; sends no messages, costs nothing | The one vendor that needs no stub, which is why auth carries no stub risk into Week 2 |
| **Cognito** | ⚠️ **Cannot be emulated.** LocalStack's free tier has no Cognito | Use a shared **dev** pool, or a fake JWT issuer in tests. Never a production pool |
| **Bedrock / Textract / Transcribe** | ⚠️ **No local emulation.** Behind `ResumeExtractor` / `TranscriptionProvider` interfaces with stubs | Real calls go to a shared **dev** AWS account when you need them |
| **Payment gateway** | Provider sandbox mode + our simulating stub | Sandbox gives real webhook signatures to verify against |

**The three-tier rule most teams follow, and the one worth following here:**

1. **Local** — everything containerised. Fast, offline, free, and you can wipe
   the database without asking anyone.
2. **Shared dev AWS account** — for the handful of things with no local
   emulator (Cognito, Bedrock, Transcribe). Real services, disposable data.
3. **Staging** — a full mirror of production. This is where you test the
   deploy, not the code.

**Nobody connects a local process to production.** Not to debug, not "just to
read". Production holds real candidates' resumes, phone numbers and email
addresses; under the DPDP Act, a developer laptop with a production connection
string is an unmanaged copy of that data. If you need production-shaped data,
use an anonymised dump.

## Where configuration comes from, per environment

| | Local | dev / staging / prod |
|---|---|---|
| Source | `.env` file (from `.env.example`) | Env vars injected from **AWS Secrets Manager** by the ECS task definition |
| DB credentials | Fake, matching `scripts/init_db_roles.sql` | Real, rotated, never in the repo |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` (LocalStack) | **Unset** — boto3 talks to real AWS |
| `AWS_ACCESS_KEY_ID` | The literal string `test` | **Not set at all.** ECS tasks get temporary credentials from their **IAM task role** |

That last row matters. **Long-lived AWS access keys should not exist in a
deployed environment.** They cannot be rotated without a deploy, they leak
through logs and backups, and they never expire. If you find yourself pasting
an `AKIA…` key into a config, something has gone wrong upstream — the answer
is an IAM role.

`app/settings.py` reads all of this once at boot and never logs it;
`app/core/logging.py` redacts it if it ever reaches a log line anyway.

- API — <http://localhost:8000/api/v1>
- Interactive docs — <http://localhost:8000/docs>
- Health — <http://localhost:8000/api/v1/health>
- Mail catcher — <http://localhost:8025>

Workers:

```bash
celery -A app.worker.celery_app worker --loglevel=info
```

## Checks

```bash
pytest                                  # tests
ruff check app tests scripts            # lint
mypy app                                # types — strict on every domain.py
lint-imports                            # module boundaries (invariant 4′)
python scripts/check_no_age_fields.py   # invariant 5
python scripts/check_vocabulary.py      # invariant 6
python scripts/gen_modules.py --check   # every module skeleton present
python scripts/export_openapi.py        # write openapi.json
python scripts/export_postman.py        # write the Postman collection from it
```

CI runs all of these on every push. Two -- invariants 5 and 6 -- are legal
requirements rather than style preferences; the rest of the invariants are
tests under `tests/invariants/`. **Never weaken one to make a change pass**:
they encode client and regulatory commitments, and
`test_all_ten_invariants_are_covered.py` fails if one is quietly renamed away.

---

## Layout

```
backend/
├── app/
│   ├── main.py             FastAPI factory, middleware, error handlers
│   ├── worker.py           Celery factory
│   ├── settings.py         env-driven; NOT where product numbers live
│   ├── api/                root router + health
│   ├── core/               db, tenant, deps, errors, audit, idempotency,
│   │                       outbox, pagination, logging, models
│   ├── modules/            21 modules, identical 7-file shape
│   └── tasks/              Celery tasks — thin wrappers over services
├── alembic/versions/       the baseline, extended in place (not reversible)
├── scripts/                invariant guards, module generator, openapi export
└── tests/
    ├── unit/               pure domain logic, no I/O
    ├── integration/        real Postgres from docker compose, never SQLite
    ├── contract/           schemathesis + masking-leak assertions
    └── invariants/         one file per rule — never delete these
```

Every module has the same seven files:

| File | Rule |
|---|---|
| `router.py` | HTTP only. Never touches a repository. |
| `schemas.py` | Pydantic DTOs. The API contract. ORM models are never exposed. |
| `models.py` | SQLAlchemy ORM. |
| `repository.py` | All DB access. **Private to the module.** |
| `service.py` | Business rules, transaction boundaries. Never touches `Request`. |
| `domain.py` | Pure functions and state machines. No I/O. mypy strict. |
| `events.py` | Domain events, emitted through the outbox. |

**A module may import another module's `service`, never its `repository` or
`models`.** That single rule is what makes later service extraction mechanical
rather than archaeological, and `lint-imports` checks it in CI so it does not
depend on discipline.

Adding a module: append to `MODULES` in `scripts/gen_modules.py`, run it, done.

---

## The ten invariants

`docs/plan.md` §1 calls these architectural invariants, not features. Each is
pushed to the lowest layer that can enforce it — **database constraint >
repository query shape > domain service > API schema > UI** — and each has a
test in `tests/invariants/` that proves it.

| # | Rule | Enforced by | Status |
|---|---|---|---|
| 1 | Score reproducible (never explained) | Full extraction chain stored; `replay()` never re-invokes the model | Day 8 |
| 2 | Scale 700–990; 700 is a base, not a floor | Arithmetic, not a clamp — stored == displayed, always | Day 8 |
| 3 | Score never human-editable | No route accepts a score; app role has no `UPDATE` on `scores` | Day 8 |
| 4′ | Add-on contributions bounded and versioned | Caps as pure functions; `lint-imports` contract | Day 8 |
| 5 | No age-gating | `scripts/check_no_age_fields.py` | ✅ **green** |
| 6 | No financial framing | `scripts/check_vocabulary.py` | ✅ **green** |
| 7 | Masked without an active access window | `require_active_access_window`; schema cannot hold PII | Day 14 |
| 7′ | Every PII reveal audited | Audit row in the same transaction as the reveal | Day 14 |
| 8 | No job publish before KYB approval | Domain service + Postgres trigger | Day 10 |
| 9 | College consent required, every reveal audited | Consent joined by the query itself, not a Python `if` | Day 18 |

**Never delete an invariant test to make a build pass.** These are the tests you
show the client.

Three that are easy to get wrong:

- **Invariant 8's test runs with `kyb.require_approval` ON**, even though
  production defaults it off (R15). A gate only ever exercised in the config
  where it does nothing is not a tested gate.
- **Invariant 4′'s contract is inverted, not deleted.** The client reversed the
  original rule ("paid add-ons never change the score") on 2026-08-24. So
  `scoring` now *reads* add-on completion events, and the add-on modules still
  import nothing from `scoring` — which is what stops one awarding itself points.
- **Invariant 7′ is new.** Blanket employer access (R14) destroyed the natural
  one-row-per-unlock audit trail, but PRD rule 9 did not stop applying, so the
  audit moved to the read.

---

## Conventions

- **Base path** `/api/v1`. Version in the path, never a header.
- **Surface prefixes are namespacing, not authorisation.** A candidate hitting
  `/employer/*` is rejected by the role dependency, not by routing.
- **Cursor pagination**, never offset. `total` only where it is cheap and safe.
- **Async operations** return `202` with `{ job_id, status_url }`.
- **Errors** are RFC 7807 with a stable `code`. The backend never returns a
  user-facing English sentence — four clients localise into 6–8 languages.
- **A foreign tenant's resource returns 404, never 403.** 403 confirms it exists.
- **Timestamps** are UTC ISO-8601 with `Z`. Clients render IST; the server never does.
- **Enums** are `SCREAMING_SNAKE` matching the SRS state names exactly.
- **Money** is integer minor units (paise). Never a float, never `Decimal` at
  the API boundary.
- **Tenant IDs come from server-side membership.** Never from a path, query,
  body or header (SRS §2.24.7).
- **Product numbers are config rows, not constants.** Score base and ceiling,
  contribution caps, prices, view caps, expiry windows — all in `config_values`.
  Every number the client changed on 27 August was already a row, which is what
  made that rewrite seed data rather than a migration. Keep it that way.

---

## Handover (Day 20)

| Deliverable | Where |
|---|---|
| OpenAPI schema | `openapi.json`, regenerated by `scripts/export_openapi.py` |
| Postman collection | `bharatpath.postman_collection.json`, generated from that schema by `scripts/export_postman.py`. Neither file is committed: both are published as CI artifacts, so a copy in the repo can never be the stale one somebody imports |
| Integration notes for the four client teams | [`../docs/integration-notes.md`](../docs/integration-notes.md) |
| Every route, in detail | [`../docs/APIs.md`](../docs/APIs.md) |
| What is stubbed, and on whom it is blocked | [`../docs/blockers.md`](../docs/blockers.md) |

**Data-subject requests** live in `app/modules/privacy`. The policy is
`privacy/domain.py` -- every table in the schema classified as erased,
retained under the financial and audit carve-out, or not personal -- and the
cascade that executes it is `erase_candidate`, one SECURITY DEFINER function
in the baseline migration. It is a database function and not Python because
the application role holds no DELETE on `scores` (invariant 3) and must not be
given one. The retention *periods* on what survives are still counsel's, so
`RETENTION_POLICY_VERSION` starts `placeholder-` and a test says so.

**Rate limits** are all in one table, `app/core/ratelimit.py`: a generous
global tier per IP, per user and per tenant, and tight specific limits on OTP
and the employer threshold preview. The global tier fails *open* on a Redis
outage and the specific ones fail *closed* -- an unenforced throttle in front
of a paid SMS gateway is somebody else's bill.

**The index review** is `tests/integration/test_index_review.py`, and it is a
test rather than a one-off: it plans every hot query shape with sequential
scans priced out and fails on a scan of a growing table, and it holds every
foreign key on a growing table to having an index or a written exemption.

---

## Where the schedule risk is

`docs/plan.md` §8 is a 20-day plan. The days dense with *judgment* rather than
typing are **8** (score reproducibility and the extraction chain), **14**
(access-window expiry, reveal audit at volume), **15** (two billing flows, one
a UPI e-mandate) and **18** (consent-gated analytics). AI accelerates writing
code far more than it accelerates deciding what the code should do. If the
schedule slips, it slips there.

**Blocked before Day 8:** client approval of `docs/scoring-approach.md`, the
data-residency decision, and the 50–100 CV calibration corpus. See
`docs/questions.txt`.
