# The identity the backend runs as. During the sprint the API runs on a
# laptop, so this is an IAM user with keys. When the app moves to ECS or
# App Runner (plan.md Day 20) the policy below attaches to a task role
# instead and the user is deleted -- the permissions do not change, only
# what assumes them.

resource "aws_iam_user" "app" {
  name = "${var.project}-app-${var.environment}"
}

data "aws_iam_policy_document" "app" {
  # Objects only, not buckets. The app never needs to create, delete or
  # reconfigure a bucket, and a credential that leaks off a developer
  # laptop should not be able to.
  statement {
    sid    = "ObjectAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = [for b in aws_s3_bucket.this : "${b.arn}/*"]
  }

  # Needed to presign and to list a prefix; scoped to these buckets only.
  statement {
    sid       = "BucketListing"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [for b in aws_s3_bucket.this : b.arn]
  }

  statement {
    sid    = "TaskQueue"
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.tasks.arn, aws_sqs_queue.dlq.arn]
  }

  # OCR fallback for scanned CVs. Textract reads the object from S3 itself,
  # which is why the S3 grant above is what makes this work -- there is no
  # separate "let Textract read the bucket" permission for the async API when
  # the caller and the bucket share an account.
  #
  # Detection only. AnalyzeDocument (forms and tables) costs roughly ten times
  # as much per page and is not used: a CV is prose, not a form.
  statement {
    sid    = "DocumentOcr"
    effect = "Allow"
    actions = [
      "textract:StartDocumentTextDetection",
      "textract:GetDocumentTextDetection",
      "textract:DetectDocumentText",
    ]
    # Textract exposes no resource ARNs for these operations.
    resources = ["*"]
  }

  # Layer 1 of scoring (docs/scoring-approach.md s4): read a CV into facts.
  # Invoke only, and only the models in var.scoring_model_ids -- never
  # bedrock:*, so a key that leaks off a laptop cannot run arbitrary models on
  # the account's bill. Converse is authorised by bedrock:InvokeModel.
  #
  # Both resource kinds are required. The call names an inference profile in
  # this region; a cross-Region profile then runs the underlying foundation
  # model in whichever region serves it, and that is authorised separately --
  # hence any region, including none, on the foundation-model ARNs.
  statement {
    sid     = "ScoringModelInvoke"
    effect  = "Allow"
    actions = ["bedrock:InvokeModel"]
    resources = concat(
      [for id in var.scoring_model_ids : "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${id}"],
      [for id in var.scoring_model_ids : "arn:aws:bedrock:*::foundation-model/${join(".", slice(split(".", id), 1, length(split(".", id))))}"],
    )
  }

  statement {
    sid       = "ReadSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }

  # Against Cognito. The API verifies tokens against the public JWKS, which
  # needs no credentials at all; the reads look a user up by sub.
  #
  # Two writes, both in `app/core/auth/directory.py`:
  #
  #   AdminCreateUser (2026-09-18) -- staff creating an account for someone,
  #   and an owner adding a colleague. Cognito emails the temporary password;
  #   we never see it.
  #
  #   AdminDeleteUser (2026-09-22, blockers E32) -- the erasure destroying the
  #   sign-in itself. Without it an erased person's Cognito user survived, so
  #   signing in again with the same address was refused forever rather than
  #   starting fresh.
  #
  #   AdminUserGlobalSignOut (2026-11-19) -- suspending a member of staff ends
  #   every session they hold. AdminGetUser, already granted, is also how the
  #   staff step-up reads whether an authenticator app is enrolled.
  #
  # Nothing here can set or read a password, or confirm a user.
  statement {
    sid    = "CognitoAccounts"
    effect = "Allow"
    actions = [
      "cognito-idp:GetUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:ListUsers",
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminUserGlobalSignOut",
    ]
    resources = [
      aws_cognito_user_pool.candidates.arn,
      aws_cognito_user_pool.business.arn,
    ]
  }

  # Notifications by email (`NOTIFICATIONS_EMAIL_PROVIDER=ses`). Scoped to the
  # one identity that exists -- the client's domain, or the single verified
  # mailbox standing in for it (E38). Absent until one of them is set, so a
  # leaked key cannot send mail as anybody.
  dynamic "statement" {
    for_each = local.email_enabled ? [1] : []
    content {
      sid       = "SendEmail"
      effect    = "Allow"
      actions   = ["ses:SendEmail"]
      resources = [local.email_identity_arn]
    }
  }
}

# A managed policy, not an inline one: an inline USER policy is capped at
# 2,048 bytes and this document outgrew it (a fresh account refused it,
# 2026-10-01). A managed policy allows 6,144 characters. The instance role
# keeps its inline copy -- role policies are allowed 10,240.
resource "aws_iam_policy" "app" {
  name   = "${var.project}-app-${var.environment}"
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_user_policy_attachment" "app" {
  user       = aws_iam_user.app.name
  policy_arn = aws_iam_policy.app.arn
}

resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}
