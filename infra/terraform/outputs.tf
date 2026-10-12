# These map one-to-one onto the settings in backend/app/settings.py.
# `terraform output -raw env_file > ../../backend/.env.aws` writes a file
# the app can source directly.

output "cognito_candidate_pool_id" {
  value = aws_cognito_user_pool.candidates.id
}

output "cognito_business_pool_id" {
  value = aws_cognito_user_pool.business.id
}

output "cognito_candidate_client_id" {
  value = aws_cognito_user_pool_client.candidates.id
}

output "cognito_business_client_id" {
  value = aws_cognito_user_pool_client.business.id
}

output "bucket_names" {
  value = local.bucket_names
}

output "sqs_queue_url" {
  value = aws_sqs_queue.tasks.url
}

output "app_access_key_id" {
  value = aws_iam_access_key.app.id
}

# Marked sensitive so it is not echoed in logs or CI output.
# Read deliberately with: terraform output -raw app_secret_access_key
output "app_secret_access_key" {
  value     = aws_iam_access_key.app.secret
  sensitive = true
}

output "env_file" {
  description = "Paste-ready environment block for backend/.env"
  sensitive   = true
  value       = <<-EOT
    AWS_REGION=${var.aws_region}
    # Explicitly blank: .env sets the LocalStack endpoint, and without this
    # line that value survives and every S3 call goes to 127.0.0.1:4566.
    AWS_ENDPOINT_URL=
    AWS_ACCESS_KEY_ID=${aws_iam_access_key.app.id}
    AWS_SECRET_ACCESS_KEY=${aws_iam_access_key.app.secret}

    COGNITO_CANDIDATE_POOL_ID=${aws_cognito_user_pool.candidates.id}
    COGNITO_BUSINESS_POOL_ID=${aws_cognito_user_pool.business.id}
    COGNITO_CANDIDATE_CLIENT_ID=${aws_cognito_user_pool_client.candidates.id}
    COGNITO_BUSINESS_CLIENT_ID=${aws_cognito_user_pool_client.business.id}

    S3_BUCKET_RESUMES=${local.bucket_names["resumes"]}
    S3_BUCKET_KYB_DOCUMENTS=${local.bucket_names["kyb_documents"]}
    S3_BUCKET_INTERVIEW_AUDIO=${local.bucket_names["interview_audio"]}
    S3_BUCKET_EXPORTS=${local.bucket_names["exports"]}
    S3_BUCKET_AUDIT_ARCHIVE=${local.bucket_names["audit_archive"]}
    S3_BUCKET_COURSE_MEDIA=${local.bucket_names["course_media"]}
    S3_BUCKET_PROFILE_IMAGES=${local.bucket_names["profile_images"]}

    CELERY_BROKER_URL=sqs://
    SQS_QUEUE_URL=${aws_sqs_queue.tasks.url}

    # Email by SES once the client's domain is verified; none until then.
    NOTIFICATIONS_EMAIL_PROVIDER=${local.email_enabled ? "ses" : "none"}
    NOTIFICATIONS_EMAIL_FROM=${local.email_from}

    # Local tokens must be OFF once real Cognito pools exist.
    AUTH_ALLOW_LOCAL_TOKENS=false
  EOT
}

# What to add at the registrar when the domain's DNS is not a Route 53 zone in
# this account. Empty until `email_domain` is set.
output "email_dns_records" {
  description = "DNS records SES needs. Add them once where the domain's DNS is managed."
  value = local.domain_enabled ? concat(
    [for token in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : {
      type  = "CNAME"
      name  = "${token}._domainkey.${var.email_domain}"
      value = "${token}.dkim.amazonses.com"
    }],
    [
      { type = "MX", name = "mail.${var.email_domain}", value = "10 feedback-smtp.${var.aws_region}.amazonses.com" },
      { type = "TXT", name = "mail.${var.email_domain}", value = "v=spf1 include:amazonses.com ~all" },
      { type = "TXT", name = "_dmarc.${var.email_domain}", value = "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_address != "" ? var.dmarc_report_address : "dmarc@${var.email_domain}"}" },
    ],
  ) : []
}

# ---------------------------------------------------------------------------
# The test host (2026-09-22). Empty unless `deploy_ec2=true`.
# ---------------------------------------------------------------------------
output "app_public_ip" {
  description = "Elastic IP of the test host. Point `api_domain` at this with an A record."
  value       = var.deploy_ec2 ? aws_eip.app[0].public_ip : ""
}

output "app_url" {
  description = "Where the API answers once the stack is up."
  value = var.deploy_ec2 ? (
    var.api_domain != "" ? "https://${var.api_domain}/api/v1" : "https://${aws_eip.app[0].public_ip}/api/v1 (self-signed certificate)"
  ) : ""
}

output "ssh_command" {
  description = "How to reach the host. Session Manager works without a key: aws ssm start-session --target <id>"
  value = var.deploy_ec2 ? (
    var.ssh_public_key != "" ? "ssh ec2-user@${aws_eip.app[0].public_ip}" : "aws ssm start-session --target ${aws_instance.app[0].id}"
  ) : ""
}

locals {
  # Which database the host's stack talks to. With RDS the passwords stay
  # `<SET_BY_INIT_RDS>`: deploy/init_rds.sh generates them, sets them on the
  # roles and writes them here, so they never pass through Terraform. The
  # container profile is switched off by leaving COMPOSE_PROFILES empty.
  host_env_database = var.deploy_rds ? trimspace(<<-EOT
    # ---- database: RDS (rds.tf) ----
    COMPOSE_PROFILES=
    DATABASE_URL=postgresql+asyncpg://bharatpath_app:<SET_BY_INIT_RDS>@${aws_db_instance.main[0].address}:5432/bharatpath
    DATABASE_URL_MIGRATOR=postgresql+asyncpg://bharatpath_migrator:<SET_BY_INIT_RDS>@${aws_db_instance.main[0].address}:5432/bharatpath
    DATABASE_ADMIN_URL=postgresql+asyncpg://bharatpath_admin:<SET_BY_INIT_RDS>@${aws_db_instance.main[0].address}:5432/bharatpath
  EOT
    ) : trimspace(<<-EOT
    # ---- database (container on this host) ----
    COMPOSE_PROFILES=local-db
    POSTGRES_USER=bharatpath
    POSTGRES_PASSWORD=<SET_ME>
    POSTGRES_DB=bharatpath
    DATABASE_URL=postgresql+asyncpg://bharatpath_app:<SET_ME>@postgres:5432/bharatpath
    DATABASE_URL_MIGRATOR=postgresql+asyncpg://bharatpath_migrator:<SET_ME>@postgres:5432/bharatpath
    DATABASE_ADMIN_URL=postgresql+asyncpg://bharatpath_admin:<SET_ME>@postgres:5432/bharatpath
  EOT
  )
}

# The environment file for the HOST, which differs from `env_file` above in
# two ways that matter:
#
#   * **No AWS keys.** The instance carries an IAM role; a static key in this
#     file would override it with a long-lived secret on a public box.
#   * **Postgres is RDS or the compose service, and Redis the compose
#     service**, never localhost. Database passwords are never filled in
#     here -- passing one through a Terraform variable would write it into
#     state in plaintext, which is the habit `secrets.tf` exists to avoid.
output "host_env_file" {
  description = "Paste-ready /opt/bharatpath/.env for the test host. Fill in the model keys; the database passwords are written by deploy/init_rds.sh (RDS) or by hand (container)."
  sensitive   = true
  value       = <<-EOT
    # ---- generated by terraform output -raw host_env_file ----
    # Fill in every <SET_ME> before starting the stack.

    ENVIRONMENT=dev
    # `dev`, not `staging`/`prod`, and that is load-bearing. It is what lets
    # PAYMENTS_PROVIDER=stub boot (Settings refuses the stub in staging and
    # prod) so the app teams can complete a checkout with no gateway.
    # Changing this to `prod` without a real gateway configured makes every
    # checkout answer 503. See docs/payments-bypass.md.

    ${local.host_env_database}
    REDIS_URL=redis://redis:6379/0

    # Browser origins allowed to call the API (var.cors_allowed_origins).
    CORS_ALLOWED_ORIGINS='${jsonencode(var.cors_allowed_origins)}'

    # ---- AWS ----
    AWS_REGION=${var.aws_region}
    AWS_ENDPOINT_URL=
    # NO AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY here, on purpose: the
    # instance role supplies credentials and setting these would override it.

    COGNITO_CANDIDATE_POOL_ID=${aws_cognito_user_pool.candidates.id}
    COGNITO_BUSINESS_POOL_ID=${aws_cognito_user_pool.business.id}
    COGNITO_CANDIDATE_CLIENT_ID=${aws_cognito_user_pool_client.candidates.id}
    COGNITO_BUSINESS_CLIENT_ID=${aws_cognito_user_pool_client.business.id}
    AUTH_ALLOW_LOCAL_TOKENS=false

    S3_BUCKET_RESUMES=${local.bucket_names["resumes"]}
    S3_BUCKET_KYB_DOCUMENTS=${local.bucket_names["kyb_documents"]}
    S3_BUCKET_INTERVIEW_AUDIO=${local.bucket_names["interview_audio"]}
    S3_BUCKET_EXPORTS=${local.bucket_names["exports"]}
    S3_BUCKET_AUDIT_ARCHIVE=${local.bucket_names["audit_archive"]}
    S3_BUCKET_COURSE_MEDIA=${local.bucket_names["course_media"]}
    S3_BUCKET_PROFILE_IMAGES=${local.bucket_names["profile_images"]}

    # Redis on this host, not SQS (2026-10-01). The SQS broker never reached
    # the queue Terraform makes: nothing reads SQS_QUEUE_URL, so kombu looks
    # for a queue named `celery` (ListQueues, then CreateQueue) and the app
    # policy grants neither -- the worker died at boot. Database 1, apart from
    # the app's cache. The outbox stays the record either way. blockers E44.
    CELERY_BROKER_URL=redis://redis:6379/1
    SQS_QUEUE_URL=${aws_sqs_queue.tasks.url}
    CELERY_BEAT_SCHEDULE_PATH=/var/run/bharatpath/celerybeat-schedule

    # ---- payments: the bypass (docs/payments-bypass.md, blockers D3) ----
    # No gateway is chosen. `stub` signs its own callbacks with a real HMAC,
    # takes no money, and exposes POST /billing/dev/payments/{id}/simulate so
    # a checkout can be completed end to end. Swap to the real provider name
    # when the gateway exists; nothing else in the app changes.
    PAYMENTS_PROVIDER=stub
    PAYMENTS_WEBHOOK_SECRET=<SET_ME_ANY_RANDOM_STRING>

    # ---- email ----
    NOTIFICATIONS_EMAIL_PROVIDER=${local.email_enabled ? "ses" : "none"}
    NOTIFICATIONS_EMAIL_FROM=${local.email_from}
    # SMS stays off: no DLT registration (blockers D1), and nothing routes to
    # an SMS template regardless (test_nothing_is_sent_by_sms).
    NOTIFICATIONS_SMS_PROVIDER=none

    # ---- models ----
    # Off until you paste a key. With extraction disabled a confirmed CV
    # produces no score and stays PENDING, which is deliberate: there is no
    # fallback extractor, because a plausible wrong number is unfixable once
    # a candidate has seen it.
    SCORING_EXTRACTION_ENABLED=false
    SCORING_EXTRACTION_PROVIDER=openai
    SCORING_MODEL_ID=gpt-5.4-mini-2026-03-17
    OPENAI_API_KEY=<SET_ME_OR_LEAVE_EXTRACTION_DISABLED>

    INTERVIEW_TRANSCRIPTION_PROVIDER=none
    INTERVIEW_EVALUATION_PROVIDER=none
    INTERVIEW_EVALUATION_MODEL_ID=gpt-5.4-mini-2026-03-17
    SARVAM_API_KEY=<SET_ME_OR_LEAVE_TRANSCRIPTION_DISABLED>
    # Interview questions are always written by OpenAI (2026-09-29): there is
    # no fixed-question fallback, so a real OPENAI_API_KEY is required for
    # anyone to start an interview. Set Sarvam above too, or questions cannot
    # follow up what the candidate said.
    INTERVIEW_QUESTION_PROVIDER=openai
    INTERVIEW_QUESTION_MODEL_ID=gpt-5.4-mini-2026-03-17

    # ---- malware scanning: off (blockers E1) ----
    # There is no scanner behind the seam. Off records PENDING, which is what
    # an unscanned file honestly is; it does NOT block parsing. See
    # docs/malware-scanning.md.
    RESUME_SCAN_ENABLED=false

    # ---- OCR: on, and harmless while Textract is not activated (E2) ----
    # Local parsers read a normal CV for nothing. Textract is called only when
    # they return almost no text, which is what a scanned CV looks like.
    RESUME_TEXTRACT_FALLBACK_ENABLED=true

    API_DOMAIN=${var.api_domain}
  EOT
}

output "rds_address" {
  description = "The database's private hostname. Reachable from the host only."
  value       = var.deploy_rds ? aws_db_instance.main[0].address : ""
}

output "rds_master_secret_arn" {
  description = "The RDS-managed secret holding the master password. Read once by deploy/init_rds.sh; the app never uses it."
  value       = var.deploy_rds ? aws_db_instance.main[0].master_user_secret[0].secret_arn : ""
}
