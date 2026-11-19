variable "aws_region" {
  description = "Mumbai. The data-residency question (plan.md N2) is still open, so the default keeps everything in India until the client answers."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = <<-DESC
    The suffix on every resource's physical name. **Not the stage label** --
    see `stage`. Production carries "dev" for historical reasons (it was
    built as the dev host on 2026-10-01 and became production on
    2026-11-19), and that cannot change: a Cognito pool, an S3 bucket or a
    queue cannot be renamed, only destroyed and recreated, taking every
    account and file with it.

    Bound to the Terraform workspace, so the two can never be crossed:
    `default` -> "dev" (production), `uat` -> "uat". A plan run in the
    wrong workspace, or without `-var-file=uat.tfvars` in `uat`, refuses.
  DESC
  type        = string
  default     = "dev"

  validation {
    condition     = var.environment == (terraform.workspace == "default" ? "dev" : terraform.workspace)
    error_message = "environment does not match the Terraform workspace. In workspace 'default' (production) it must be \"dev\"; in 'uat' pass -var-file=uat.tfvars. See docs/aws-deployment.md §0.5."
  }
}

variable "stage" {
  description = "What this environment is: \"prod\" or \"uat\". Tags only (the Environment tag and the Name tags), so changing it never replaces a resource. Empty means `environment`."
  type        = string
  default     = ""
}

variable "manage_email_sender_identity" {
  description = <<-DESC
    Whether this state owns the SES identity for `email_sender_address`. An
    SES identity is account-wide, so only one environment can create it;
    production does. UAT sets false and uses the same verified identity.
  DESC
  type        = bool
  default     = true
}

variable "project" {
  description = "Prefix for every resource name."
  type        = string
  default     = "bharatpath"
}

variable "callback_urls" {
  description = "OAuth redirect targets for the hosted UI. Expo dev client and localhost during the sprint."
  type        = list(string)
  default = [
    "http://localhost:8099/api/v1/auth/callback",
    "http://localhost:19006/",
    "bharatpath://auth/callback",
  ]
}

variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:19006/", "bharatpath://auth/logout"]
}

variable "cors_allowed_origins" {
  description = "Browser origins the API answers CORS for: scheme and host, no trailing slash. Written into the host's .env as CORS_ALLOWED_ORIGINS. Never \"*\"."
  type        = list(string)
  default = [
    "https://bharatpath-chi.vercel.app", # web app on Vercel (2026-10-03)
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
  ]

  validation {
    condition = alltrue([
      for o in var.cors_allowed_origins : can(regex("^https?://[^/*]+$", o))
    ])
    error_message = "Each origin is scheme://host[:port] with no path, no trailing slash and no wildcard."
  }
}

variable "scoring_model_ids" {
  description = "Bedrock inference-profile ids the backend may invoke to read CVs. The four offered to the client on 2026-09-13; narrow to the one chosen."
  type        = list(string)
  default = [
    "global.anthropic.claude-sonnet-4-6",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    "global.anthropic.claude-sonnet-5",
    "in.openai.gpt-5.6-luna",
  ]
}

# -- email (2026-09-18) ------------------------------------------------------
variable "email_domain" {
  description = "The domain BharatPath sends email from, e.g. bharatpath.in. Empty until the client names it: no SES identity is created and both Cognito pools keep Cognito's built-in sender (about 50 emails a day -- development only)."
  type        = string
  default     = ""
}

variable "email_from_local_part" {
  description = "The sender's mailbox name. It need not be a real mailbox; replies go to support."
  type        = string
  default     = "no-reply"
}

variable "route53_zone_id" {
  description = "Set if the domain's DNS is a Route 53 hosted zone in this account; Terraform then writes the DKIM, MAIL FROM and DMARC records itself. Empty: add them at the registrar from `terraform output email_dns_records`."
  type        = string
  default     = ""
}

variable "dmarc_report_address" {
  description = "Where DMARC aggregate reports go. Defaults to dmarc@<email_domain>."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Email without a domain (2026-09-22)
# ---------------------------------------------------------------------------
variable "email_sender_address" {
  description = <<-DESC
    A single mailbox to send from while the client has no domain (blockers
    E38). SES verifies ONE address rather than a whole domain: it emails a
    confirmation link to this address, and once somebody clicks it the
    account may send `From:` that address and nothing else.

    This is the stop-gap, not the destination. Set `email_domain` instead as
    soon as the domain and its DNS exist -- an address identity cannot carry
    DKIM alignment, so mail sent this way is markedly more likely to be
    filtered as spam, and every message is From: a personal-looking mailbox.

    Ignored when `email_domain` is set: a domain identity covers every
    address at that domain, so both would be redundant.
  DESC
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# The single-host test deployment (2026-09-22) -- see ec2.tf
# ---------------------------------------------------------------------------
variable "deploy_ec2" {
  description = <<-DESC
    Create the EC2 test host. **Default false, and that matters:** everything
    else in this module is free at idle, so the standing assumption has been
    that nothing bills between sessions. An instance breaks that assumption,
    so switching it on is a deliberate act.

      terraform apply -var deploy_ec2=true
      terraform apply -var deploy_ec2=false   # tears the host down again

    The EBS data volume has `prevent_destroy`, so switching it off stops the
    instance bill and keeps the database.
  DESC
  type        = bool
  default     = false
}

variable "instance_type" {
  description = <<-DESC
    t3.small (2 vCPU, 2 GiB, ~$15/month in ap-south-1) runs the API, worker,
    beat, Postgres and Redis together for a test environment.

    x86_64 rather than Graviton on purpose -- `backend/Dockerfile` is built
    wherever it is run, and an image built on an x86 machine will not start
    on ARM. Move to t4g when images are built in CI for a pinned arch.

    2 GiB is enough and not generous: Postgres and Redis take their share.
    If the worker is OOM-killed under a real CV load, t3.medium is the step.
  DESC
  type        = string
  default     = "t3.small"
}

variable "data_volume_size_gb" {
  description = "Postgres's data directory (or, with `deploy_rds`, only Redis, beat's state and Caddy's certificates -- a few GB is plenty). Separate from the root volume so replacing the instance does not destroy it."
  type        = number
  default     = 20
}

variable "ssh_allowed_cidrs" {
  description = <<-DESC
    Who may reach port 22. **Narrow this.** The default is open because an
    empty default locks the first person out of the host they just created,
    but an internet-facing SSH port is the one rule here worth changing
    before the instance has been up a day.

      terraform apply -var 'ssh_allowed_cidrs=["203.0.113.4/32"]'

    Session Manager works with no SSH at all (the instance role carries
    AmazonSSMManagedInstanceCore), so `[]` is a real option.
  DESC
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "ssh_public_key" {
  description = "An OpenSSH public key for the host. Leave empty to use Session Manager only, which needs no key and no open port."
  type        = string
  default     = ""
}

variable "api_domain" {
  description = <<-DESC
    A hostname pointing at this instance's elastic IP. When set, Caddy gets a
    real Let's Encrypt certificate for it automatically; when empty it serves
    the IP over a self-signed certificate, which browsers and most HTTP
    clients will refuse until told otherwise.

    Anything resolvable works for a test environment -- it does not have to be
    the client's production domain, and it is unrelated to `email_domain`.
  DESC
  type        = string
  default     = ""
}

variable "primary_availability_zone" {
  description = "The one zone the host and the database share (network.tf says why one)."
  type        = string
  default     = "ap-south-1a"
}

# ---------------------------------------------------------------------------
# Managed Postgres (2026-10-01) -- see rds.tf
# ---------------------------------------------------------------------------
variable "deploy_rds" {
  description = <<-DESC
    Run Postgres on RDS instead of in a container on the host. The reason is
    backups: RDS takes a daily snapshot and keeps the write-ahead log, so the
    database can be restored to any second in the retention window. The
    container on EBS has neither.

    Unlike `deploy_ec2`, switching this off does NOT quietly stop a bill:
    the instance has deletion protection and `prevent_destroy`, so the plan
    refuses. Deleting the database is a deliberate, two-step act.
  DESC
  type        = bool
  default     = false
}

variable "rds_instance_class" {
  description = "db.t4g.micro: 2 vCPU (burstable), 1 GiB, ~$15/month in ap-south-1. Graviton is fine here -- nothing we build runs on it."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage_gb" {
  description = "Starting size. Storage autoscaling grows it up to `rds_max_allocated_storage_gb` rather than letting a full disk stop the database."
  type        = number
  default     = 20
}

variable "rds_max_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "rds_backup_retention_days" {
  description = "Days of automated snapshots and point-in-time recovery. Backup storage up to the size of the database is free. **AWS's Free plan allows at most 1** (FreeTierRestrictionError); raise it to 7 once the account is on the Paid plan."
  type        = number
  default     = 7
}

# ---------------------------------------------------------------------------
# Spend alerts (2026-10-01) -- see budgets.tf
# ---------------------------------------------------------------------------
variable "budget_alert_email" {
  description = "Who hears about spend. Empty: no budget is created."
  type        = string
  default     = ""
}

variable "budget_monthly_usd" {
  description = "The month's expected spend. Alerts fire at a third, two thirds and all of it, and when the forecast passes it."
  type        = number
  default     = 45
}

variable "cognito_email_via_ses" {
  description = <<-DESC
    Send Cognito's own email (sign-up codes, password resets, invitations)
    through the SES identity above instead of Cognito's built-in sender.

    **Leave false until SES has production access** (2026-10-01). A new SES
    account is in the sandbox and delivers only to verified addresses, so
    turning this on there means nobody but us receives a sign-up code --
    while Cognito's built-in sender reaches anyone, about 50 a day. Separate
    from `email_sender_address` so the app's notifications can use SES before
    sign-up does.
  DESC
  type        = bool
  default     = false
}
