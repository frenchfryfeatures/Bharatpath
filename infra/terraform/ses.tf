# Email: every message the product sends, and every code Cognito sends.
#
# Added 2026-09-18, when the client dropped SMS and phone OTP until the
# organisation's registration (and with it TRAI DLT) exists. From then on:
#
#   * Cognito sends sign-up verification codes, password-reset codes and the
#     temporary password of an account staff created -- through SES, not
#     Cognito's built-in sender, which is capped at about 50 emails a day and
#     sends from a no-reply@verificationemail.com address nobody trusts.
#   * The backend sends notifications (`NOTIFICATIONS_EMAIL_PROVIDER=ses`).
#
# **Two ways to be able to send** (the second added 2026-09-22):
#
#   `email_domain`         -- the destination. Verified by DNS, carries DKIM.
#   `email_sender_address` -- one mailbox, while the client has no domain
#                             (blockers E38). Verified by a link SES emails to
#                             it. No DKIM, so worse deliverability.
#
# Set neither and nothing here is created; the backend records every email as
# SKIPPED `PROVIDER_UNCONFIGURED` and Cognito falls back to its own sender
# (about 50/day, from an address nobody trusts).
#
# **Either way, SES production access is a separate support request**, and
# until it is granted the account is in the sandbox and can send only *to*
# addresses that are themselves verified. See infra/README.md, "Email", and
# `docs/aws-deployment.md`.

locals {
  # Two ways to be able to send, and a domain always wins (2026-09-22).
  #
  #   domain_enabled  -- the destination. Covers every address at the domain,
  #                      carries DKIM, aligns SPF, passes DMARC.
  #   address_enabled -- the stop-gap while the client has no domain (E38).
  #                      One mailbox, verified by clicking a link SES emails
  #                      to it. No DKIM alignment is possible, so deliverability
  #                      is materially worse; good enough for staff, an admin
  #                      account and a test environment, not for sign-up codes
  #                      at volume.
  #
  # Both set is not an error and not a mix: the domain is used and the address
  # variable is ignored, because a domain identity already covers it.
  domain_enabled  = var.email_domain != ""
  address_enabled = !local.domain_enabled && var.email_sender_address != ""

  # `email_enabled` keeps its old meaning for every other file: "the backend
  # can send email". It is now true for either identity.
  email_enabled = local.domain_enabled || local.address_enabled

  email_from = (
    local.domain_enabled ? "${var.email_from_local_part}@${var.email_domain}" :
    local.address_enabled ? var.email_sender_address : ""
  )

  # The ARN of whichever identity exists, for the IAM grant and for Cognito.
  email_identity_arn = (
    local.domain_enabled ? try(aws_sesv2_email_identity.domain[0].arn, "") :
    local.address_enabled ? (
      var.manage_email_sender_identity
      ? try(aws_sesv2_email_identity.sender[0].arn, "")
      : "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/${var.email_sender_address}"
    ) : ""
  )

  # Cognito wants `Name <address>`.
  email_from_display = local.email_enabled ? "BharatPath <${local.email_from}>" : ""
}

# ---------------------------------------------------------------------------
# The single-address identity (blockers E38, stop-gap)
# ---------------------------------------------------------------------------
# **Applying this does not make email work.** SES sends a confirmation link to
# the address and the identity stays unverified until somebody opens that
# mailbox and clicks it. Terraform reports success either way, because
# creating the identity is all it can do.
#
# The second, larger catch is the SES **sandbox**, which is where every new
# account starts and which is not visible in this file at all: in the sandbox
# you may send only *to* addresses that are themselves verified. So a verified
# sender plus the sandbox means email works between your own verified
# addresses and reaches no real candidate. Production access is a support
# request -- see infra/README.md, and `docs/aws-deployment.md`.
resource "aws_sesv2_email_identity" "sender" {
  count          = local.address_enabled && var.manage_email_sender_identity ? 1 : 0
  email_identity = var.email_sender_address
}

resource "aws_sesv2_email_identity" "domain" {
  count          = local.domain_enabled ? 1 : 0
  email_identity = var.email_domain

  # Easy DKIM: SES generates the keys and publishes three CNAME targets.
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Bounces come back to a subdomain we own rather than amazonses.com, which is
# what lets SPF align for DMARC.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count                  = local.domain_enabled ? 1 : 0
  email_identity         = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain       = "mail.${var.email_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# ---------------------------------------------------------------------------
# DNS -- written for you only if the domain's DNS is a Route 53 zone in this
# account. Otherwise `terraform output email_dns_records` lists what to add
# at the registrar, once.
# ---------------------------------------------------------------------------
locals {
  # DNS records belong to a domain identity. An address identity has none:
  # it is verified by a link in an email, not by DNS.
  manage_dns = local.domain_enabled && var.route53_zone_id != ""
}

resource "aws_route53_record" "dkim" {
  count   = local.manage_dns ? 3 : 0
  zone_id = var.route53_zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.email_domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mail_from_mx" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "mail.${var.email_domain}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "mail.${var.email_domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.email_domain}"
  type    = "TXT"
  ttl     = 1800
  # `p=none` first: report, do not reject, until the reports show every
  # legitimate sender aligned. Tighten to quarantine after that.
  records = ["v=DMARC1; p=none; rua=mailto:${var.dmarc_report_address != "" ? var.dmarc_report_address : "dmarc@${var.email_domain}"}"]
}
