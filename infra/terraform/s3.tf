data "aws_caller_identity" "current" {}

# The seven buckets app/settings.py expects. Names are suffixed with the
# account id because S3 bucket names are globally unique across all of
# AWS -- "bharatpath-resumes" was almost certainly taken years ago.
locals {
  buckets = {
    resumes         = "Uploaded CVs and their parsed versions."
    kyb_documents   = "Employer verification documents."
    interview_audio = "Voice interview recordings and chunks."
    exports         = "Generated CSV/PDF exports."
    audit_archive   = "Cold copies of the append-only audit trail."
    course_media    = "Course video and materials (producer still unknown -- plan.md N7)."
    profile_images  = "Profile photos and organisation logos, re-encoded by the API."
  }

  bucket_names = {
    for k, v in local.buckets :
    k => "${var.project}-${replace(k, "_", "-")}-${var.environment}-${data.aws_caller_identity.current.account_id}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets

  bucket        = local.bucket_names[each.key]
  force_destroy = var.environment == "dev"
}

# Every one of these buckets holds personal data under DPDP. None of them
# is ever public -- objects reach users through presigned URLs with short
# expiry, never through a public read.
resource "aws_s3_bucket_public_access_block" "this" {
  for_each = aws_s3_bucket.this

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning is not for convenience. Invariant 1 requires a score to be
# reproducible from the stored extraction chain, which means the exact
# bytes that were scored must still be retrievable after any later
# overwrite (plan.md 8, Day 8).
resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Presigned uploads come straight from the mobile client, so the browser
# and RN fetch layer need CORS. Kept wide for development -- tighten to
# the real origins before launch.
#
# **Every bucket the backend issues a presigned PUT for belongs here**
# (`storage.presign_put` callers). `profile_images` and `course_media` were
# left out when they were added, so S3 answered the browser's preflight with
# a 403 and every photo, logo and lesson upload from the web failed as a
# "CORS error" (2026-10-10). The mobile app, which sends no preflight, never
# saw it.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  for_each = toset(["resumes", "kyb_documents", "interview_audio", "profile_images", "course_media"])

  bucket = aws_s3_bucket.this[each.key].id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# ---------------------------------------------------------------------------
# Lifecycle -- the two buckets that must forget things
# ---------------------------------------------------------------------------
# Added 2026-09-22, closing the infrastructure half of blockers E34 and E22.
#
# **A bucket rule and a sweep are not the same guarantee, and both are
# wanted.** `privacy.expire_exports` deletes an archive after 48 hours and
# clears the pointer on the request row, which the bucket cannot do -- the row
# would otherwise name an object that is gone. But the sweep runs in our
# worker, and a worker that is down, misconfigured or unscheduled (which it
# was, from Day 20 until Beat existed) keeps nothing to its word. The rule
# below is the floor underneath that: it holds even when nothing of ours runs.
#
# So the sweep is the product behaviour and the rule is the backstop. Neither
# replaces the other, and the rule is deliberately the more generous of the
# two so that it never deletes an object the sweep still expects to find.

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.this["exports"].id

  # An export is a whole person's record in one object -- every field we hold
  # about them, zipped, behind a 10-minute link. `EXPORT_RETENTION_HOURS` is
  # 48 in `privacy/domain.py`; 7 days here is the backstop, not the promise,
  # and it is longer on purpose. A rule that fired at 48h would race the sweep
  # and delete archives it was about to account for.
  rule {
    id     = "expire-export-archives"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    # Versioning is on for every bucket (invariant 1), so deleting an object
    # leaves the old version behind. Without this the archive is still there,
    # one API call away, and the rule would be theatre.
    noncurrent_version_expiration {
      noncurrent_days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Interview audio: blockers E22. **This rule is commented out, deliberately.**
#
# Recordings of a candidate's voice are kept with no lifecycle rule today.
# The retention period is a question for the client and their counsel -- how
# long after evaluation may we keep somebody's voice? -- and it is not ours to
# answer by picking a number that looks reasonable. A recording is also needed
# for as long as a dispute about the session could be raised, which is the
# same unanswered question as B3's retention period.
#
# Uncomment and set `interview_audio_retention_days` once that lands. Until
# then the honest state is "kept indefinitely, and recorded as such", not a
# rule somebody will later mistake for a decision.
#
# resource "aws_s3_bucket_lifecycle_configuration" "interview_audio" {
#   bucket = aws_s3_bucket.this["interview_audio"].id
#
#   rule {
#     id     = "expire-interview-audio"
#     status = "Enabled"
#     filter {}
#     expiration { days = var.interview_audio_retention_days }
#     noncurrent_version_expiration { noncurrent_days = 7 }
#   }
# }
