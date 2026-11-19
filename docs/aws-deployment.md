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

0. [What is running now: EC2 + RDS (2026-10-01)](#0-what-is-running-now)
1. [What gets built, and what you are trading away](#1-what-gets-built)
2. [Before you start](#2-before-you-start)
3. [Step by step](#3-step-by-step)
4. [What works, what does not, and why](#4-what-works-and-what-does-not)
5. [Day-to-day operation](#5-day-to-day)
6. [Changing AWS account later](#6-changing-aws-account)
7. [Migrating to ECS Fargate](#7-migrating-to-ecs-fargate)

---

## 0. What is running now

Added 2026-10-01. The sections below describe the single-host shape; this is
what is actually deployed, which is that shape **with Postgres moved to RDS**
— step 1 of §7, taken alone because the database is the only thing on the
host that cannot be rebuilt.

| | |
|---|---|
| **Two environments** (2026-11-19) | **This one is production** (tag `Environment=prod`); its resource names still end `-dev`, which cannot change. **UAT** is a full mirror — see [0.5](#05-production-and-uat) |
| Account | `335345888157`, `ap-south-1`. **AWS Free plan** (see 0.3) |
| API | `https://bharatpath-api.duckdns.org/api/v1` (DuckDNS, free; swap for the client's domain with one variable) |
| Host | EC2 `t3.small`, Elastic IP `43.204.56.60`, 2 GiB swap, CPU credits `standard` |
| Database | RDS PostgreSQL 16, `db.t4g.micro`, 20 GB gp3 (grows to 50), Single-AZ, private |
| On the host | caddy, api, worker, beat, redis — `deploy/docker-compose.prod.yml` with no `local-db` profile |
| State | `s3://bharatpath-tfstate-335345888157`, locked by DynamoDB (`infra/terraform/backend.tf`) |
| Settings | `infra/terraform/deploy.auto.tfvars` (gitignored; `example.tfvars` is the template) |
| Email | App notifications through SES **from `bharatpath63@gmail.com`** (an address identity, E38's stop-gap). SES is still in the **sandbox**: it delivers only to verified addresses, 200/day. Cognito keeps its own sender (`cognito_email_via_ses = false`) so sign-up codes reach anyone, ~50/day |

### 0.1 Storage — what survives what

| Data | Lives on | Survives a container restart | Survives the instance being replaced | Backed up |
|---|---|---|---|---|
| Everything in Postgres | **RDS** | yes | yes | daily snapshot + point-in-time restore |
| CVs, audio, exports, KYB documents | **S3**, versioned | yes | yes | versioning |
| Users and passwords | **Cognito** | yes | yes | AWS-managed |
| Redis (membership cache, rate counters) | EBS data volume `/mnt/data` | yes | yes | no — it refills |
| Beat's schedule state, TLS certificates | EBS data volume `/mnt/data` | yes | yes | no — re-created |
| The image, the code, `.env` | EBS root volume | yes | **no** — re-run `ship.sh`, re-write `.env` | no |

Containers are disposable; nothing in them is the only copy of anything.

### 0.2 Network

`infra/terraform/network.tf` has the picture. In short: the default VPC; the
host's security group admits 80 and 443 from anywhere and 22 from
`ssh_allowed_cidrs` only; the database has **no public IP** and its security
group admits 5432 **from the host's security group and nothing else**. No NAT
gateway (~$32/month) and no load balancer. TLS to the client is Caddy's Let's
Encrypt certificate; TLS to the database is forced by RDS and verified by the
app against Amazon's CA (`DATABASE_SSL_ROOT_CERT`, set in the image).

**If your IP changes, SSH stops working** (Indian ISPs reassign often). Update
`ssh_allowed_cidrs` in `deploy.auto.tfvars` and apply, or use Session Manager,
which needs no open port.

### 0.3 The Free plan, and what it costs

About **$43/month**, measured from the Price List API on 2026-10-01: EC2
$16.35, RDS $15.33 + storage $2.62, EBS $3.19, public IPv4 $3.65, Secrets
Manager ~$1.20, the rest cents.

The account is on AWS's **Free plan**: $100 of credit (up to $100 more from
the console's "Explore AWS" activities), and **the account closes when the
credits run out or on 2027-04-01**, whichever is first — resources stop and
are deleted 90 days later. **Upgrade to the Paid plan before either**
(Billing → Upgrade plan; unused credit carries over). Until then the plan
imposes limits, two of which we hit:

- **RDS backup retention is capped at 1 day** (`FreeTierRestrictionError`).
  `rds_backup_retention_days = 1` in the tfvars; set 7 after upgrading.
- **Textract** is unavailable, as on the old account (E2).

`budgets.tf` emails `budget_alert_email` at a third, two thirds and all of
`budget_monthly_usd` of **gross** monthly spend, and when the forecast
passes it. Gross matters: a budget that nets credits off reads $0 and never
fires. **Since UAT (2026-11-19) the account costs about $86/month** and the
budget is $90: it measures the whole account, so only production's state
creates one. On 2026-11-19 $73.89 of credit was left, which at that rate
lasts until roughly mid-December 2026 -- **upgrade before then** or the
account closes with production in it.

### 0.4 How it was built — and how to rebuild it

```bash
# once per account: the state bucket
terraform -chdir=infra/bootstrap init && terraform -chdir=infra/bootstrap apply
terraform -chdir=infra/bootstrap output -raw backend_configuration   # -> infra/terraform/backend.tf

# everything else; read the plan before applying it
cd infra/terraform
cp example.tfvars deploy.auto.tfvars      # fill in
terraform init
terraform plan -out=main.tfplan && terraform apply main.tfplan

# point the DuckDNS name (or the A record) at: terraform output -raw app_public_ip

# code to the host, image built there (ships the working tree; see the script)
BP_SSH_KEY=~/.ssh/bharatpath_ed25519 bash deploy/ship.sh 43.204.56.60

# the host's .env: generate, fill in the model keys and PAYMENTS_WEBHOOK_SECRET
terraform output -raw host_env_file > /tmp/bp.env    # then scp to /opt/bharatpath/.env, chmod 600

# the three database roles on RDS, passwords written into that .env
aws secretsmanager get-secret-value --query SecretString --output text \
    --secret-id "$(terraform output -raw rds_master_secret_arn)" \
  | ssh -i ~/.ssh/bharatpath_ed25519 ec2-user@43.204.56.60 'bash /opt/bharatpath/init_rds.sh'

# start: migrations, then the stack
ssh -i ~/.ssh/bharatpath_ed25519 ec2-user@43.204.56.60 \
  'cd /opt/bharatpath && docker compose -f docker-compose.prod.yml up -d'
```

**`init_rds.sh` replaces the two `init_db_*.sql` mounts** used with the
container. RDS has no superuser; the master user has CREATEROLE and
`rds_superuser`, which is enough, given two grants a real superuser would not need
(membership of `bharatpath_migrator`, and CREATE on the database for the new
schema owner). It prints the role attributes as a check — `bharatpath_app`
must show `bypassrls=f`. **The app never connects as the master user**,
which owns the database and is therefore not subject to RLS.

Every later deploy is just `deploy/ship.sh`. Restoring the database is the
RDS console (Automated backups → Restore to point in time), which makes a
*new* instance — point the three URLs in `.env` at it.

### 0.5 Production and UAT

Added 2026-11-19. **One Terraform configuration, two workspaces, two
complete copies** in the same account and region, the same size (EC2
`t3.small` + RDS `db.t4g.micro`) and nothing shared but the SES sender
identity and the state bucket.

| | Production | UAT |
|---|---|---|
| Terraform workspace | `default` | `uat` |
| Variables | `deploy.auto.tfvars` | `deploy.auto.tfvars`, then `-var-file=uat.tfvars` over it |
| `environment` (name suffix) | `dev` -- historical, immutable | `uat` |
| `stage` (tags only) | `prod` | `uat` |
| Elastic IP | `43.204.56.60` | `13.235.1.169` |
| API | `https://bharatpath-api.duckdns.org/api/v1` | `https://bharatpath-uat.duckdns.org/api/v1` |
| Deploy | `ship.sh 43.204.56.60` | `ship.sh 13.235.1.169` |
| Cognito, S3, SQS, Secrets, RDS | `bharatpath-*-dev` | `bharatpath-*-uat` -- **separate users and files** |
| State | `bharatpath/terraform.tfstate` | `env:/uat/bharatpath/terraform.tfstate` |

**Why production is still called `dev`.** Renaming means changing
`environment`, and a Cognito user pool, S3 bucket or SQS queue cannot be
renamed -- Terraform would destroy and recreate them, with every account and
CV in them. So `environment` stays the physical suffix and `stage` is the
label: the `Environment` and `Name` tags, and `force_destroy` (off for
`prod`). The app's own `ENVIRONMENT=dev` in both hosts' `.env` is a separate
setting and deliberately unchanged: `staging`/`prod` there refuse the
payments stub (D3), which is how checkout works until a gateway is chosen.

**The workspace and `environment` cannot be crossed.** A validation on
`environment` refuses any plan where it does not match the workspace
(`default` -> `dev`, `uat` -> `uat`). Forgetting `-var-file=uat.tfvars` in
`uat`, or passing it in `default`, fails before anything is planned -- which
matters, because the second would otherwise plan to replace production's
Cognito pools.

```bash
cd infra/terraform
terraform workspace show                       # always check first

# production
terraform workspace select default
terraform plan -out=prod.plan && terraform apply prod.plan

# UAT
terraform workspace select uat
terraform plan -var-file=uat.tfvars -out=uat.plan && terraform apply uat.plan
terraform output -raw host_env_file            # UAT's .env template
```

`deploy.auto.tfvars` is shared, so the SSH CIDR, key, RDS retention and
email sender change both environments -- plan each workspace after editing
it. Deploying code is the same `deploy/ship.sh`, given the UAT address.

**UAT's `.env`** (built 2026-11-19) is `terraform output -raw host_env_file`
from the `uat` workspace, with the model and speech keys
(`OPENAI_API_KEY`, `SARVAM_API_KEY`) and the provider switches copied from
production's, and its **own** `PAYMENTS_WEBHOOK_SECRET`. Both environments
spend on the same OpenAI and Sarvam accounts. UAT starts with no staff and
no users: `create_platform_staff.py` (§3.8) against UAT's host.

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
