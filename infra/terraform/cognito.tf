# Two user pools, matching the two authentication models the PRD requires
# (plan.md 5.7). They are separate pools rather than one pool with groups
# because the mechanisms differ: candidates authenticate by phone OTP
# through a custom flow, business users by password with optional MFA.
#
# Neither pool is an authorisation authority. Role and tenant come from
# our `memberships` table on every request (app/core/auth/membership.py).
# Cognito answers "who is this" and nothing else -- so no groups are
# defined here, deliberately.

# --------------------------------------------------------------------------
# Candidate pool -- students and job seekers.
# --------------------------------------------------------------------------
resource "aws_cognito_user_pool" "candidates" {
  name = "${var.project}-candidates-${var.environment}"

  # Email and password only (2026-09-18): the client deferred phone OTP
  # until the organisation's registration and DLT exist, and every code goes
  # by email. Phone is never an auto-verified attribute -- that would make
  # Cognito send its own SMS.
  #
  # `phone_number` stays a username attribute ON PURPOSE: changing
  # username_attributes forces Terraform to REPLACE the pool (new pool id,
  # every user gone), and bringing phone sign-in back later would force it
  # again. The app offers email only; a phone-number sign-up cannot be
  # verified and so can never sign in.
  auto_verified_attributes = ["email"]
  username_attributes      = ["email", "phone_number"]

  # Do not leak which phone numbers and emails are registered.
  # Cognito returns a generic failure instead of "user not found".
  # Enumerating the candidate base is exactly the bulk-extraction risk
  # flagged as N4 in the plan.
  lifecycle {
    ignore_changes = [schema]
  }

  # temporary_password_validity_days: a staff-created account's emailed
  # password (2026-09-18). A day was too short for someone who reads work
  # email weekly; staff can resend.
  # minimum_length 8 (2026-10-05, was 12): candidates, students among them,
  # sign in on a phone. The business pool keeps the stricter bar below.
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }


  # The email an account created on someone's behalf receives (2026-09-18:
  # staff create candidates, employers and colleges from the console, and an
  # owner adds colleagues). Cognito fills in {username} and the temporary
  # password {####}; both placeholders are required.
  admin_create_user_config {
    allow_admin_create_user_only = false

    invite_message_template {
      email_subject = "Your BharatPath account is ready"
      email_message = "An account has been created for you on BharatPath.<br><br>Sign in with<br>Email: {username}<br>Temporary password: {####}<br><br>You will be asked to choose your own password. This temporary password expires in 7 days; if it has, ask us to send a new one."
      # Never sent -- the pool has no SMS configuration (no SMS since
      # 2026-09-18). It must still be set: left out, the provider sends "",
      # and CreateUserPool refuses anything under 6 characters, so a fresh
      # account cannot create the pool at all (found 2026-10-01).
      sms_message = "BharatPath: user {username}, temporary password {####}"
    }
  }

  # Sign-up and password-reset codes go by email -- there is no SMS.
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your BharatPath verification code"
    email_message        = "Your BharatPath verification code is {####}. Do not share it with anyone."
  }

  # Through SES once the client's domain is verified (ses.tf); Cognito's own
  # sender until then, which is capped at about 50 emails a day.
  # Only with `cognito_email_via_ses` (2026-10-01) -- see variables.tf. A
  # sandboxed SES delivers only to verified addresses, so switching Cognito
  # to it before production access stops every sign-up code but our own.
  dynamic "email_configuration" {
    for_each = local.email_enabled && var.cognito_email_via_ses ? [1] : []
    content {
      email_sending_account = "DEVELOPER"
      source_arn            = local.email_identity_arn
      from_email_address    = local.email_from_display
    }
  }

  # MFA is not forced on candidates: requiring a second factor on a consumer
  # sign-up in this market would cost more conversions than it buys security.
  mfa_configuration = "OFF"

  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_client" "candidates" {
  name         = "${var.project}-candidates-app-${var.environment}"
  user_pool_id = aws_cognito_user_pool.candidates.id

  # Public mobile client: no secret, because a secret shipped inside an
  # app binary is not a secret.
  generate_secret = false

  # ALLOW_CUSTOM_AUTH (phone OTP) removed 2026-09-18: deferred, and its
  # Lambda triggers were never written. Add it back with them.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH", # email + password
    # The mobile app signs candidates in with InitiateAuth USER_PASSWORD_AUTH
    # (mobile-app/services/api/auth.ts). It was enabled in the console and
    # recorded here on 2026-10-03; without it an apply breaks mobile sign-in.
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  supported_identity_providers = ["COGNITO"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  read_attributes  = ["email", "email_verified", "phone_number", "name"]
  write_attributes = ["email", "phone_number", "name"]
}

# --------------------------------------------------------------------------
# Business pool -- employer, college and admin users.
# --------------------------------------------------------------------------
resource "aws_cognito_user_pool" "business" {
  name = "${var.project}-business-${var.environment}"

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  # minimum_length 12 (2026-10-05, was 14). Symbols stay: these accounts
  # reach candidate PII in bulk, and since 2026-10-07 the password is the
  # only factor for anyone who has not turned MFA on.
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Software-token MFA is OPTIONAL, off until the user turns it on
  # (client, 2026-10-07, closing blockers E37; was "ON" under SRS 1.3.4).
  # Each business user enrols or removes an authenticator app from their
  # own settings, calling Cognito directly -- the API never checks MFA.
  # OPTIONAL is what makes the toggle possible: under ON a user cannot turn
  # it off, and with OFF they cannot turn it on. Users who enrolled while it
  # was mandatory keep it until they turn it off.
  #
  # Changing this is an in-place update. A plan that REPLACES this pool
  # would delete every business user -- do not apply it.
  mfa_configuration = "OPTIONAL"

  # Must stay enabled: it is the only factor a user can turn on (no SMS).
  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Employers and colleges sign themselves up (2026-09-18, closing blocker
  # E7): R15 made KYB automatic and payment the gate, so self-registration no
  # longer bypasses anything. Staff can still create accounts for them.
  # The email an account created on someone's behalf receives (2026-09-18:
  # staff create candidates, employers and colleges from the console, and an
  # owner adds colleagues). Cognito fills in {username} and the temporary
  # password {####}; both placeholders are required.
  admin_create_user_config {
    allow_admin_create_user_only = false

    invite_message_template {
      email_subject = "Your BharatPath account is ready"
      email_message = "An account has been created for you on BharatPath.<br><br>Sign in with<br>Email: {username}<br>Temporary password: {####}<br><br>You will be asked to choose your own password. This temporary password expires in 7 days; if it has, ask us to send a new one."
      # Never sent -- the pool has no SMS configuration (no SMS since
      # 2026-09-18). It must still be set: left out, the provider sends "",
      # and CreateUserPool refuses anything under 6 characters, so a fresh
      # account cannot create the pool at all (found 2026-10-01).
      sms_message = "BharatPath: user {username}, temporary password {####}"
    }
  }

  # Sign-up and password-reset codes go by email -- there is no SMS.
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your BharatPath verification code"
    email_message        = "Your BharatPath verification code is {####}. Do not share it with anyone."
  }

  # Through SES once the client's domain is verified (ses.tf); Cognito's own
  # sender until then, which is capped at about 50 emails a day.
  # Only with `cognito_email_via_ses` (2026-10-01) -- see variables.tf. A
  # sandboxed SES delivers only to verified addresses, so switching Cognito
  # to it before production access stops every sign-up code but our own.
  dynamic "email_configuration" {
    for_each = local.email_enabled && var.cognito_email_via_ses ? [1] : []
    content {
      email_sending_account = "DEVELOPER"
      source_arn            = local.email_identity_arn
      from_email_address    = local.email_from_display
    }
  }

  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_client" "business" {
  name         = "${var.project}-business-app-${var.environment}"
  user_pool_id = aws_cognito_user_pool.business.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Shorter than the candidate pool. These sessions see candidate PII.
  access_token_validity  = 30
  id_token_validity      = 30
  refresh_token_validity = 7

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  supported_identity_providers = ["COGNITO"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls
}
