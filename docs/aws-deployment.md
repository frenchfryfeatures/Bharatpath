# Deploying BharatPath on AWS

Written for: whoever runs the deploy, and whoever later migrates it to a real
production shape. Assumes you can read Terraform and have used a terminal;
assumes nothing about AWS.

Written 2026-09-22.

> **This describes a test deployment, chosen deliberately.** One EC2 host
> running everything in `docker compose`. It is not production, and §7 is the
> migration to what production should be. The shape was chosen on 2026-09-22
> knowing the trade — see §1.3 for what you are giving up, stated plainly, so
> that nobody discovers it during an incident.

---

## Contents

1. [What gets built, and what you are trading away](#1-what-gets-built)
2. [Before you start](#2-before-you-start)
3. [Step by step](#3-step-by-step)
4. [What works, what does not, and why](#4-what-works-and-what-does-not)
5. [Day-to-day operation](#5-day-to-day)
6. [Changing AWS account later](#6-changing-aws-account)
7. [Migrating to ECS Fargate](#7-migrating-to-ecs-fargate)

---

## 1. What gets built

### 1.1 The picture

```
                     Internet
                        │
                   ┌────┴─────┐
                   │ Elastic  │   a stable IP; without it the address
                   │   IP     │   changes on every stop/start
                   └────┬─────┘
                        │ :80 :443
        ┌───────────────┴──────────────────────────┐
        │  EC2 t3.small, DEFAULT VPC, public       │
        │  Amazon Linux 2023 + docker compose      │
        │                                          │
        │   caddy ──► api (uvicorn)                │
        │             worker (celery)              │
        │             beat   (celery beat) ◄── the │
        │             postgres ─┐         schedule │
        │             redis ────┤                  │
        └───────────────────────┼──────────────────┘
                                │
                        /mnt/data  (EBS, survives
                                    instance replacement)

  Outside the box, and already built:
     Cognito (2 pools)   S3 (6 buckets)   SQS (queue + DLQ)
     SES (optional)      Secrets Manager  IAM instance role
```

### 1.2 Why an instance role and not an access key

The host carries an **IAM instance role**. boto3 finds it through the instance
metadata service with no configuration, so there is no `AWS_ACCESS_KEY_ID` and
no `AWS_SECRET_ACCESS_KEY` anywhere on the machine.

This matters more than it sounds. A long-lived access key in an env file on a
public box is the credential most likely to leak and the hardest to notice
leaking. Instance-role credentials are short-lived and rotated by AWS. The
policy is byte-for-byte the same document the `bharatpath-app-dev` IAM user
gets (`data.aws_iam_policy_document.app`), so a permission added for local
development cannot be silently missing here.

**If you put AWS keys in the host's `.env`, you have made it worse, not
better** — they override the role.

### 1.3 What you are trading away

Stated plainly, because these are the things that hurt at the wrong moment:

| | Test deployment (this) | What production needs |
|---|---|---|
| **Database backups** | **None.** Postgres is a container on an EBS volume. | RDS with automated backups and PITR |
| **If the instance dies** | Down until you rebuild it | Multi-AZ, health-checked, replaced automatically |
| **Deploys** | `docker compose up -d` — a few seconds of 502 | Rolling, zero downtime |
| **Scale** | One box. `--scale worker=N` and that is the ceiling | Independent API and worker autoscaling |
| **TLS** | Caddy on the box, Let's Encrypt | ACM certificate on an ALB |
| **Database exposure** | Not in the security group, on the compose network only | Private subnet, no internet route |
| **Secrets** | A file on the box | Secrets Manager, injected by the task definition |
| **Cost** | ~$20–25/month | ~$90–140/month |

**Do not put data in this you would mind losing.** There is no backup. Taking
one is §5.4 and it is manual.

---

## 2. Before you start

### 2.1 Credentials

Terraform needs an **admin** key, not the app user's key — the app policy
deliberately cannot create EC2, IAM or RDS.

```bash
aws configure
aws sts get-caller-identity     # must print the right Account
```

`InvalidClientTokenId` means the key ID does not exist or is deactivated.
(A wrong secret says `SignatureDoesNotMatch` instead.) Make a new one:
**IAM → Users → (your admin user) → Security credentials → Create access key
→ CLI**.

### 2.2 Decide two things

- **A hostname.** Something resolvable pointing at the instance's IP, e.g.
  `api.example.com`. Without it Caddy serves a self-signed certificate that
  browsers refuse, and the client teams cannot use the API from a browser at
  all. It does *not* have to be the client's production domain.
- **Your IP**, for SSH. `curl -s ifconfig.me`.

---

## 3. Step by step

### 3.1 Remote state (once per account)

State records what exists. Until 2026-09-22 it was a local file on one laptop
holding the app IAM secret in plaintext, which meant one machine was the source
of truth and drift was invisible — the Cognito changes of 2026-09-18 were
written, never applied, and nothing said so for four days (`blockers.md` E7).

```bash
cd infra/bootstrap
terraform init
terraform apply                     # S3 bucket + DynamoDB lock table
terraform output backend_configuration
```

Put that output in `infra/terraform/backend.tf`, then:

```bash
cd ../terraform
terraform init -migrate-state       # answer "yes" to copy existing state up
```

### 3.2 Check what already exists

```bash
terraform plan
```

**Read this output before applying.** If the account has been untouched since
2026-09-11 you will see changes to the Cognito business pool
(`allow_admin_create_user_only` → `false`, closing E7) that were written on
2026-09-18 and never applied. That is expected and is the drift being fixed.

### 3.3 Email (optional but strongly recommended)

Two options, and a domain beats a single address whenever you have one:

```bash
# No domain yet - verify ONE mailbox (blockers E38)
terraform apply -var 'email_sender_address=ops@yourcompany.com'
```

**Applying this does not make email work.** SES sends a confirmation link to
that address and the identity stays unverified until somebody clicks it.

**Then the bigger catch: the SES sandbox.** Every new AWS account starts in it,
and in the sandbox you can send only **to** addresses that are themselves
verified. So a verified sender plus the sandbox means email works between your
own verified addresses and reaches no real candidate — sign-up codes included.

Getting out is a support request: **SES console → Account dashboard → Request
production access**. AWS reviews it by hand, takes 3–7 days, and rejects vague
requests. Say what you send (transactional only: sign-in codes, application
updates, receipts), how recipients opted in, and how you handle bounces.

When the client's domain exists, switch:

```bash
terraform apply -var 'email_domain=bharatpath.in'
terraform output email_dns_records    # five records to add at the registrar
```

A domain identity carries DKIM and aligns SPF, so mail is far less likely to
be filtered. `email_domain` wins if both are set.

### 3.4 The host

```bash
terraform apply \
  -var deploy_ec2=true \
  -var 'api_domain=api.example.com' \
  -var 'ssh_allowed_cidrs=["YOUR.IP.HERE/32"]' \
  -var "ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"

terraform output app_public_ip
```

Point your hostname's **A record** at that IP now — Caddy cannot get a
certificate until DNS resolves.

`deploy_ec2` defaults to **false** on purpose: everything else in this module
is free at idle, and an instance is not. Turning it on is a deliberate act.

### 3.5 Build and ship the image

No ECR yet — the image is built on the host. Simplest, and it avoids a registry
for a single box.

```bash
HOST=$(cd infra/terraform && terraform output -raw app_public_ip)

ssh ec2-user@$HOST 'mkdir -p /opt/bharatpath/init'

# The stack, the edge config, and the two SQL files that create the DB roles
scp deploy/docker-compose.prod.yml  ec2-user@$HOST:/opt/bharatpath/
scp deploy/Caddyfile                ec2-user@$HOST:/opt/bharatpath/
scp backend/scripts/init_db_roles.sql      ec2-user@$HOST:/opt/bharatpath/init/
scp backend/scripts/init_db_extensions.sql ec2-user@$HOST:/opt/bharatpath/init/

# The backend source, to build the image on the host
rsync -az --exclude .venv --exclude __pycache__ --exclude '.pytest_cache' \
      backend/ ec2-user@$HOST:/opt/bharatpath/backend/

ssh ec2-user@$HOST 'cd /opt/bharatpath/backend && docker build -t bharatpath-backend:latest .'
```

> **The two SQL files are not optional.** They create `bharatpath_app` (no
> ownership, no BYPASSRLS), `bharatpath_migrator` and `bharatpath_admin`. RLS
> is the second line of tenant isolation and it does **nothing** against a
> table's owner — so if the app connects as the superuser, every policy becomes
> decoration while `\d+` still lists them. They run only on an empty data
> directory, i.e. once.

### 3.6 The environment file

```bash
cd infra/terraform
terraform output -raw host_env_file > /tmp/bharatpath.env
# edit /tmp/bharatpath.env: fill in every <SET_ME>
scp /tmp/bharatpath.env ec2-user@$HOST:/opt/bharatpath/.env
shred -u /tmp/bharatpath.env
```

**Database passwords.** `init_db_roles.sql` creates the three roles with
passwords equal to their names — fine locally, poor on a public box even
though 5432 is not exposed. Rotate them once, on first boot:

```bash
ssh ec2-user@$HOST
cd /opt/bharatpath
docker compose -f docker-compose.prod.yml up -d postgres

for role in app migrator admin; do
  pw=$(openssl rand -base64 24 | tr -d '/+=')
  echo "bharatpath_$role : $pw"        # copy these into .env
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U bharatpath -d bharatpath \
    -c "ALTER ROLE bharatpath_$role PASSWORD '$pw';"
done
```

Put each into the matching `DATABASE_URL*` line in `.env`.

### 3.7 Start it

```bash
ssh ec2-user@$HOST 'cd /opt/bharatpath && docker compose -f docker-compose.prod.yml up -d'
ssh ec2-user@$HOST 'cd /opt/bharatpath && docker compose -f docker-compose.prod.yml ps'
```

`migrate` runs to completion first (Alembic, then `seed_config.py`, then
`seed_filter_options.py`), then the
API, worker and beat start. Then:

```bash
curl https://api.example.com/api/v1/health
curl https://api.example.com/api/v1/openapi.json | head
```

### 3.8 Platform staff

There is no route that creates staff, by design.

```bash
ssh ec2-user@$HOST
cd /opt/bharatpath
docker compose -f docker-compose.prod.yml exec api \
  python scripts/create_platform_staff.py --email you@example.com --role PLATFORM_ADMIN
```

Then create the matching Cognito user in the **business** pool (console, or
`aws cognito-idp admin-create-user`). Our row and the Cognito user are separate
on purpose: first sign-in adopts the pre-made row by email *and pool*.

---

## 4. What works and what does not

### 4.1 Works immediately

Authentication (both Cognito pools), every one of the 141 API paths, S3 uploads,
the whole employer/college/admin surface, RLS and tenant isolation, the audit
trail, rate limits, and **the seven periodic sweeps** — which had no scheduler
at all until 2026-09-22.

### 4.2 Payments — the bypass

**No gateway is chosen** (`blockers.md` D3), so the host runs
`PAYMENTS_PROVIDER=stub` with `ENVIRONMENT=dev`.

The stub is not a mock of the app's logic. It signs its callbacks with a real
HMAC and they go through the ordinary verification path, so the entitlement
rules, the database guards and the state machine are all genuinely exercised:

```
POST /api/v1/candidate/subscription/checkout   -> a PENDING payment
POST /api/v1/billing/dev/payments/{id}/simulate {"outcome": "SUCCEEDED"}
     -> signs the callback, verifies it, settles it, grants the entitlement
```

Settlement here is **synchronous**, so this works without waiting for the relay.

Three guardrails, all deliberate:
- `Settings` **refuses to boot** with `PAYMENTS_PROVIDER=stub` when
  `ENVIRONMENT` is `staging` or `prod`. The simulate route lets a caller mark
  their own payment paid.
- The route is registered **only** when the stub is configured, so it is absent
  from `openapi.json` otherwise.
- The default (`none`) answers checkout with **503** and sells nothing.

See [`payments-bypass.md`](payments-bypass.md) for what changes when a real
gateway arrives. Short version: one adapter class and one `Literal`; no route,
schema or database change.

### 4.3 Email — works between verified addresses only

See §3.3. Until SES production access is granted, notifications to anyone else
are recorded with `skip_reason` and not sent. Every message decided is a row
either way, which is how you tell "not sent" from "lost".

### 4.4 Scoring — off until you paste a key

`SCORING_EXTRACTION_ENABLED=false` by default. With it off, a confirmed CV
produces **no score** and the row stays PENDING.

That is deliberate and worth understanding before you "fix" it: there is no
fallback extractor. A heuristic stand-in would produce a plausible wrong
number, and a wrong score is unfixable once a candidate has seen it. To turn it
on, set `OPENAI_API_KEY` and `SCORING_EXTRACTION_ENABLED=true`. Cost is roughly
₹1–2 per distinct CV, once ever — the extraction cache is keyed on CV text.

### 4.5 Does not work, and is not blocking

| | Why | Workaround |
|---|---|---|
| **Textract OCR** | `SubscriptionRequiredException` on this account (E2) | Nothing. Digital CVs parse locally for free; only **scanned** CVs need it, and they fail loudly rather than scoring as empty |
| **Malware scanning** | No scanner exists behind the seam (E1) | Off. Records `PENDING`, which is what an unscanned file honestly is. See [`malware-scanning.md`](malware-scanning.md) |
| **SMS** | No DLT registration (D1), deferred by the client | Nothing routes to an SMS template anyway; a test fails the build if one does |
| **Interview evaluation** | Provider `none` by default | Set `SARVAM_API_KEY` + `OPENAI_API_KEY` and switch both providers |

**Neither Textract nor GuardDuty blocks any API flow.** Uploading, parsing,
confirming and scoring a normal CV all work without them.

---

## 5. Day-to-day

### 5.1 Logs

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f beat     # the schedule ticking
docker compose -f docker-compose.prod.yml logs -f worker
```

### 5.2 Deploying a change

```bash
rsync -az --exclude .venv backend/ ec2-user@$HOST:/opt/bharatpath/backend/
ssh ec2-user@$HOST 'cd /opt/bharatpath && \
  docker build -t bharatpath-backend:latest backend/ && \
  docker compose -f docker-compose.prod.yml up -d'
```

A few seconds of 502 while the API restarts. Migrations run automatically.

### 5.3 Is the schedule actually running?

The failure that produced `blockers.md` E4 was a schedule that looked right and
drove nothing, so check rather than assume:

```sql
-- should be near zero; if it climbs, the relay is not running
SELECT count(*) FROM outbox WHERE published_at IS NULL;
```

```bash
docker compose -f docker-compose.prod.yml logs beat | grep Scheduler
```

**Run exactly one beat container.** It is a clock, not a worker: two of them
run every sweep twice. Scale `worker`, never `beat`.

### 5.4 Backups — manual, and there is nothing else

```bash
ssh ec2-user@$HOST 'cd /opt/bharatpath && \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U bharatpath bharatpath | gzip' > backup-$(date +%F).sql.gz
```

Also worth taking an EBS snapshot of the data volume before anything risky:

```bash
aws ec2 create-snapshot --volume-id vol-xxx --description "before upgrade"
```

### 5.5 Stopping the bill

```bash
terraform apply -var deploy_ec2=false
```

The EBS data volume has `prevent_destroy`, so the database survives. Everything
else in the module is free at idle.

---

## 6. Changing AWS account

This account is for testing and will be replaced. Three things make that
straightforward, and one makes it awkward.

**Straightforward:**
1. Every resource is Terraform. `terraform apply` in the new account builds all
   of it.
2. Nothing is hardcoded to an account id. Bucket names are *suffixed* with it
   and computed (`local.bucket_names`), so they are correct automatically.
3. Region is a variable.

**Awkward: Cognito user pools cannot be migrated.** A new account means new
pool ids and **every user signs up again**. There is no export that preserves
passwords — this is a Cognito limitation, not ours.

So: move **before** real users exist, or plan a migration where people reset
their passwords. Our `users` table keys on `cognito_sub`, which will differ, so
a migration also needs the rows re-linked by email.

The sequence:

```bash
# 1. In the NEW account
cd infra/bootstrap && terraform init && terraform apply
cd ../terraform
#    point backend.tf at the new bucket
terraform init -reconfigure
terraform apply                      # everything except the host
terraform apply -var deploy_ec2=true

# 2. Move the data
#    pg_dump from the old host, psql into the new one (5.4)
#    aws s3 sync s3://old-bucket s3://new-bucket   for each of the six

# 3. Re-point DNS, regenerate .env, redeploy
```

**Before you destroy the old account**, take: a `pg_dump`, the six buckets, and
a note of the Cognito pool ids (they appear in `users.cognito_sub` values and
in audit rows).

---

## 7. Migrating to ECS Fargate

The target: ECS Fargate + ALB + RDS + ElastiCache. Roughly $90–140/month in
`ap-south-1`.

### 7.1 What already survives the move

Deliberately arranged so that most of the work is not rework:

| Piece | Status |
|---|---|
| `backend/Dockerfile` | **Unchanged.** One image, `command:` picks the role |
| The IAM policy | **Unchanged.** `data.aws_iam_policy_document.app` attaches to a task role instead of an instance role — same document, different principal |
| S3, SQS, Cognito, SES, Secrets Manager | **Unchanged** |
| `app/tasks/schedule.py` | **Unchanged.** Beat becomes its own service |
| Database roles and RLS | **Unchanged.** `init_db_roles.sql` runs once against RDS |
| Every application setting | **Unchanged.** Only the URLs differ |

### 7.2 What is new

1. **A VPC** — 2 AZs, public and private subnets, one NAT gateway (~$32/mo,
   the single largest line).
2. **RDS PostgreSQL 16**, private subnet, automated backups. *This is the
   reason to migrate*: managed backups and point-in-time recovery.
3. **ElastiCache Redis**, private subnet.
4. **ECR**, and CI builds the image instead of the host.
5. **ALB + ACM**, replacing Caddy. Certificate renewal stops being a container
   you have to keep running.
6. **Three ECS services** from one task family: `api` (behind the ALB,
   autoscaled), `worker` (autoscaled on queue depth), `beat` (**desired count
   exactly 1**).
7. **Secrets Manager** instead of a file. The container already exists
   (`secrets.tf`).

### 7.3 Two things that will bite

**Beat's state file.** It lives on the mounted volume today
(`CELERY_BEAT_SCHEDULE_PATH`). Fargate tasks have no persistent local disk, so
mount **EFS** for it, or accept that a restarting beat re-runs the sweeps it
had done. They are idempotent, so the second is survivable — but decide, do not
discover.

**`desired_count = 1` on beat is a correctness requirement, not a cost
setting.** ECS will happily run two during a deploy. Set the deployment
configuration to `maximum_percent = 100`, `minimum_healthy_percent = 0` so it
stops the old task before starting the new one.

### 7.4 Suggested order

Each step is independently reversible:

1. VPC + RDS. Migrate the database (`pg_dump` | `psql`), repoint `DATABASE_URL`
   on the EC2 host. **Now you have backups**, still on one box.
2. ElastiCache, repoint `REDIS_URL`.
3. ECR + CI build.
4. ECS services + ALB. Run in parallel with the EC2 host, compare, then move
   DNS.
5. `terraform apply -var deploy_ec2=false`.

---

## Related

- [`blockers.md`](blockers.md) — D3, E1, E2, E4, E38 and the rest
- [`payments-bypass.md`](payments-bypass.md) — the stub, and swapping in a gateway
- [`malware-scanning.md`](malware-scanning.md) — the seam, and turning it on
- [`deployment-and-local-dev.md`](deployment-and-local-dev.md) — Azure→AWS vocabulary
- `infra/README.md` — what is not provisioned, and why
