"""Application settings, sourced from the environment.

Secrets come from AWS Secrets Manager, injected as environment variables by the
task definition, and are read exactly once at boot. Nothing here is ever logged
- see `app.core.logging` for the redaction filter that enforces that.

Note what is deliberately NOT here: score base, ceiling, contribution caps,
integrity thresholds, prices, view caps. Those are versioned rows in
`config_values`, not constants, because the client has already changed most of
them once and will change them again. See docs/plan.md section 5.6.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import PostgresDsn, RedisDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "dev", "staging", "prod"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    # -- app ---------------------------------------------------------------
    environment: Environment = "local"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    project_name: str = "BharatPath"

    # -- database ----------------------------------------------------------
    # The application connects as a role WITHOUT BYPASSRLS that does not own
    # the tables. Row-Level Security is the second line of tenant isolation
    # and it silently does nothing if the app connects as the table owner.
    database_url: PostgresDsn
    database_pool_size: int = 10
    database_max_overflow: int = 5
    database_echo: bool = False

    # A separate role for admin reads that legitimately cross tenants. Every
    # session opened on this factory emits an audit event. There is no
    # "admin flag" on the normal session - they are different code paths.
    database_admin_url: PostgresDsn | None = None

    # Migrations run as a role that OWNS the tables. The application must not.
    #
    # This is not a stylistic split. RLS does not apply to a table's owner, so
    # if Alembic ran as `database_url`, the application role would end up
    # owning every table and Row-Level Security would silently stop applying -
    # while every policy still showed up in `\d+` looking perfectly correct.
    # Nothing would fail; tenant isolation would just quietly not be there.
    database_url_migrator: PostgresDsn | None = None

    # The CA bundle an RDS server certificate is verified against. RDS forces
    # TLS (`rds.force_ssl` is on by default from PostgreSQL 15) and signs with
    # its own CA, which is in no system trust store. The image sets this to the
    # bundle it downloads (`backend/Dockerfile`); read by `connect_args_for`.
    database_ssl_root_cert: str | None = None

    # -- redis -------------------------------------------------------------
    redis_url: RedisDsn
    membership_cache_ttl_seconds: int = 60

    # -- CORS --------------------------------------------------------------
    # Which browser origins may call this API. The three web consoles are
    # served from different hosts than the API, so without this the browser
    # blocks every request before it leaves the machine.
    #
    # The mobile app is NOT affected: CORS is a browser mechanism and native
    # HTTP clients ignore it entirely.
    #
    # Set per environment. Never "*" -- with credentials in play a wildcard is
    # both refused by browsers and a genuine security hole.
    cors_allowed_origins: list[str] = [
        "http://localhost:3000",  # employer console, dev
        "http://localhost:3001",  # college console, dev
        "http://localhost:3002",  # admin console, dev
        "http://localhost:5173",  # Vite default
    ]

    # -- aws ---------------------------------------------------------------
    aws_region: str = "ap-south-1"
    aws_endpoint_url: str | None = None  # LocalStack in dev; None in real AWS

    # The endpoint a *client* (phone, emulator, browser on another machine)
    # must use to reach the same object store. Presigned URLs are signed for
    # the host in `aws_endpoint_url`, which in local dev is `localhost:4566`
    # — a host that resolves to the device itself on a phone or emulator, not
    # the Mac running LocalStack. S3v4 signatures bind the `Host` header, so a
    # client-side host rewrite breaks the signature and LocalStack rejects it.
    #
    # When set, `presign_put`/`presign_get` sign against this host instead,
    # while every server-side S3 call (head/get/put/delete) keeps using
    # `aws_endpoint_url` (localhost). Leave unset in prod, where the real
    # regional endpoint is reachable from every client.
    aws_endpoint_url_external: str | None = None

    s3_bucket_resumes: str = "bharatpath-resumes"
    s3_bucket_kyb_documents: str = "bharatpath-kyb-documents"
    s3_bucket_interview_audio: str = "bharatpath-interview-audio"
    s3_bucket_exports: str = "bharatpath-exports"
    s3_bucket_audit_archive: str = "bharatpath-audit-archive"
    s3_bucket_course_media: str = "bharatpath-course-media"

    presigned_url_ttl_seconds: int = 900

    # -- resume intake --------------------------------------------------------
    # 10 MB. A CV that does not fit is a scanned photo album, and Textract
    # bills per page. The cap is enforced twice: declared to the client when
    # the upload is presigned, and re-checked server-side from S3 metadata
    # before any row is written -- a presigned PUT cannot be trusted to have
    # honoured it.
    resume_max_upload_bytes: int = 10 * 1024 * 1024

    # Sniffed from the first bytes of the object, never from the filename or
    # the client-declared Content-Type. Both are attacker-controlled.
    #
    # **No legacy `.doc`** (client, 2026-09-15): no maintained pure-Python
    # reader exists, so it would be accepted and then fail at parse. It is
    # refused at upload with its own code instead, so the app can
    # tell the candidate to save as PDF or .docx.
    resume_allowed_mime_types: list[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]

    # How much of the object to read back to identify it. Every magic number
    # we match sits in the first few bytes; 8 KiB is generous and bounds what
    # a malicious upload can make us pull into memory.
    resume_sniff_bytes: int = 8192

    # -- malware scanning --------------------------------------------------
    # Off, because no scanner is implemented yet -- see
    # app/modules/resume/scanner.py. Turning it on raises at startup rather
    # than silently passing every file, so this cannot be enabled by accident
    # and left doing nothing.
    resume_scan_enabled: bool = False

    # -- textract fallback -------------------------------------------------
    # Local libraries first, Textract only when they come back empty or fail.
    # The case that matters is a scanned CV -- a phone photo saved as PDF has
    # no text layer, so pypdf extracts nothing and reports success. Without
    # OCR that candidate scores as having no experience at all, which is a
    # silent wrong answer rather than an error.
    #
    # Billing is per page and there is no free tier, so this is deliberately a
    # fallback and not the default path. Turn it off to cap spend; uploads
    # that need OCR then fail loudly instead of being scored as empty.
    resume_textract_fallback_enabled: bool = True

    # Textract reads multi-page PDFs asynchronously from S3 and is polled.
    # A CV that has not finished in two minutes is not going to.
    resume_textract_timeout_seconds: int = 120
    resume_textract_poll_seconds: float = 2.0

    # Refuse to OCR a document longer than this. Textract bills per page, so
    # an unbounded page count is an unbounded bill. 10, the same as
    # `resume.parser.MAX_PAGES` (2026-10-02): a document the local parser
    # would refuse as too long for a CV must not be read by OCR instead.
    resume_textract_max_pages: int = 10

    # Paste-text path (PRD 4.2). Large enough for a long CV, small enough that
    # it cannot be used as free object storage.
    resume_max_text_chars: int = 60_000

    # A display-only structured document (contacts, each job, each
    # qualification) written beside `raw_text` when a version is created
    # (`resume/structuring.py`, 2026-10-06). It never reaches a score. Best
    # effort: with no OPENAI_API_KEY, or switched off, versions are created
    # without it and read `UNAVAILABLE`. One model call per created version.
    resume_structuring_enabled: bool = True
    # Pinned snapshot, never the bare alias.
    resume_structuring_model_id: str = "gpt-5.4-mini-2026-03-17"

    # -- scoring -----------------------------------------------------------
    # Layer 1 (reading a CV into facts) needs a model. Off by default and off
    # in CI: with no extractor wired, a score stays PENDING rather than being
    # computed from nothing. `scoring-approach.md` section 11 -- we never
    # produce a partial or degraded score, because a plausible wrong number is
    # unfixable once a candidate has seen it.
    scoring_extraction_enabled: bool = False

    # Pinned exactly, never a floating alias. The id is stored on every score
    # and is half of what makes a replay attributable after the model is
    # retired; an alias that silently moved would make two scores computed
    # months apart claim the same provenance.
    #
    # A dated OpenAI snapshot (chosen 2026-09-18: `gpt-5.4-mini-2026-03-17`),
    # never the bare alias. Empty by default: enabling extraction without one
    # is refused rather than defaulted.
    scoring_model_id: str = ""

    # OpenAI (chosen 2026-09-18). Bedrock stays selectable but is not used.
    scoring_extraction_provider: Literal["openai", "bedrock"] = "openai"

    # -- OpenAI and Sarvam ---------------------------------------------------
    # Keys come from the environment (`backend/.env` locally, Secrets Manager
    # when deployed) and are never committed. OpenAI processes in the US by
    # default, so CV text and interview transcripts sent to it leave India
    # (plan section 13, N2). Sarvam processes in India.
    openai_api_key: SecretStr | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    sarvam_api_key: SecretStr | None = None
    sarvam_base_url: str = "https://api.sarvam.ai"
    #: Stored on every transcript as the provider version, with the mode.
    sarvam_stt_model: str = "saaras:v3"
    #: `codemix` keeps English words in Latin script and Indic words in their
    #: own -- Hinglish as spoken, not translated (`interview/evaluation.py`).
    sarvam_stt_mode: Literal["transcribe", "codemix", "verbatim"] = "codemix"

    # -- payments ------------------------------------------------------------
    # No gateway is chosen (blockers D3), so the default sells nothing:
    # checkout answers 503 and every callback fails verification. `stub`
    # signs callbacks with a real HMAC and takes no money; it is for local
    # development and CI, and `_stub_payments_are_never_production` refuses it
    # anywhere else, because with it a caller can mark their own payment paid.
    payments_provider: Literal["none", "stub"] = "none"

    # The shared secret a gateway signs callbacks with. With the stub and no
    # secret, a key is generated at boot.
    payments_webhook_secret: SecretStr | None = None

    # A second checkout for the same item within this window returns the
    # pending payment instead of opening another order. A double tap is not
    # two purchases.
    payments_checkout_reuse_minutes: int = 30

    # -- interview evaluation -------------------------------------------------
    # `openai` evaluates (with Sarvam transcribing, below). The default gives no
    # feedback: a completed session stays COMPLETED and its report reads PENDING. There
    # is no heuristic fallback -- see `interview/evaluation.py`. `stub` hears
    # a hash and rates it; `_stub_evaluation_is_never_production` refuses it
    # outside local and dev, because it would show candidates made-up feedback.
    interview_evaluation_provider: Literal["none", "stub", "openai"] = "none"
    # Pinned snapshot for `openai`; refused empty.
    interview_evaluation_model_id: str = ""
    # Speech-to-text. `stub` here, or `stub` evaluation, selects the stub.
    interview_transcription_provider: Literal["none", "stub", "sarvam"] = "none"
    # -- interview questions (2026-09-29) -------------------------------------
    # **Every question is written by the model** (client, 2026-09-29: "only
    # ai and not fixed questions"): the first from the candidate's CV and
    # onboarding answers, each next one after hearing the previous answer, and
    # never one they were asked before (`interview/questions.py`). There is no
    # fixed-question fallback: a question the model cannot write is a 503 the
    # app retries. `stub` is for tests and local work without a key, and is
    # refused in staging and production.
    interview_question_provider: Literal["openai", "stub"] = "openai"
    # Pinned snapshot, never the bare alias; the one the evaluator uses.
    interview_question_model_id: str = "gpt-5.4-mini-2026-03-17"

    # -- notifications --------------------------------------------------------
    # Nothing is wired by default: SMS and email are recorded as SKIPPED
    # `PROVIDER_UNCONFIGURED` and the in-app inbox still works. `stub` records
    # what would have been sent and is refused in staging and production.
    # **A provider does not make an SMS deliverable**: a template with no DLT
    # registration is never handed to one (blockers D1).
    notifications_sms_provider: Literal["none", "stub", "twilio"] = "none"
    notifications_email_provider: Literal["none", "stub", "ses"] = "none"
    twilio_account_sid: str | None = None
    twilio_auth_token: SecretStr | None = None
    #: The Messaging Service the India DLT sender header is attached to.
    twilio_messaging_service_sid: str | None = None
    notifications_email_from: str | None = None

    # -- unsubscribe ----------------------------------------------------------
    # A nudge is the only message a person may reasonably not want, so its
    # email carries a one-click way to stop them without signing in.
    #
    # **Both must be set or no link is offered**, which is the honest failure:
    # a `List-Unsubscribe` header pointing at a URL we cannot serve, or a
    # token we cannot verify, is worse than no header -- a mail client shows
    # an Unsubscribe button that silently does nothing, and the complaint
    # that follows costs more reputation than the nudge earned.
    notifications_unsubscribe_secret: SecretStr | None = None
    #: Public origin of this API, e.g. `https://api.bharatpath.in`. No
    #: trailing slash.
    public_api_base_url: str = ""

    # -- celery ------------------------------------------------------------
    # Every environment sets this; the deployed host and local development
    # both use Redis. The `sqs://` default does not work as configured -- kombu
    # looks for a queue named `celery` rather than the Terraform-made one
    # (docs/blockers.md E44) -- so a deployment that forgets the variable fails
    # at worker boot rather than quietly running on the wrong broker.
    celery_broker_url: str = "sqs://"
    celery_result_backend: str | None = None

    # Where Celery Beat keeps the last-run time of each periodic task
    # (`app/tasks/schedule.py`). It must survive a container restart: a beat
    # that starts with no state treats every task as never-run and fires the
    # lot at once, which on the daily partition sweep is harmless and on the
    # erasure sweep is simply early. Put it on a mounted volume in any
    # deployment -- `docs/aws-deployment.md`.
    celery_beat_schedule_path: str = "/var/run/bharatpath/celerybeat-schedule"

    # -- cognito -----------------------------------------------------------
    # Two pools, matching the two authentication models the PRD requires.
    # Authorization does NOT come from Cognito: role and tenant are read from
    # our `memberships` table per request. Token claims go stale, and a
    # membership revocation that does not take effect is exactly the tenant
    # isolation failure SRS 2.24.7 forbids.
    cognito_candidate_pool_id: str | None = None
    cognito_business_pool_id: str | None = None
    cognito_candidate_client_id: str | None = None
    cognito_business_client_id: str | None = None
    jwks_cache_ttl_seconds: int = 3600

    # Which `token_use` the API accepts. Access tokens are the right choice for
    # a machine API -- they are what an OAuth client is meant to present -- but
    # they carry no contact attributes, so first sign-in resolves phone and
    # email through a separate provider call rather than trusting a claim.
    # S105 is silenced because "access" is a token *kind*, not a credential.
    cognito_token_use: Literal["access", "id"] = "access"  # noqa: S105

    # -- local auth substitute ---------------------------------------------
    # Cognito cannot be emulated: LocalStack's free tier does not provide it,
    # and the candidate pool needs three custom-auth Lambda triggers besides.
    # Rather than stub out authentication -- which would silently disable every
    # gate behind it -- the token verifier is an interface with two
    # implementations, and this flag selects the local one.
    #
    # The local implementation is a real RS256 verifier against a keypair
    # generated at boot. Same code path, same claim validation, same failure
    # modes; only the issuer differs. That is what lets Days 3-8 be built and
    # tested end to end before the pools exist, without carrying stub risk.
    #
    # `_local_auth_is_never_production` below refuses to let this be true in
    # prod, whatever the environment says.
    auth_allow_local_tokens: bool = False

    # Minted by `POST /api/v1/auth/dev/token`, which exists only while the
    # flag above is on. Short, because a long-lived development token has a
    # way of ending up in a shared script.
    local_token_ttl_seconds: int = 3600

    # -- phone OTP (deferred, 2026-09-18) -----------------------------------
    # The client deferred phone OTP until the organisation's registration
    # (and with it DLT and an SMS sender) exists. Sign-in is email and
    # password on both pools, with Cognito sending every code by email.
    # `POST /auth/otp/start` is registered only when this is set, and nothing
    # sets it: switching phone OTP on later is the three Cognito Lambda
    # triggers, SMS delivery, and this flag.
    auth_phone_otp_enabled: bool = False

    # -- rate limits -------------------------------------------------------
    # Our coarse outer throttle sits in front of Twilio Verify. Twilio's limits
    # protect Twilio's spend; ours protects against someone walking the phone
    # number space. Both are needed.
    otp_start_per_phone_per_hour: int = 5
    otp_start_per_ip_per_hour: int = 20

    # The global tier (`app/core/ratelimit.py`). Generous on purpose:
    # a guard against a runaway client or a scraper, set well above what a
    # person clicking can reach. Per tenant is higher than per user because an
    # organisation's staff share it. Off in tests, whose one "IP" makes more
    # requests a minute than any person could -- `tests/integration/
    # test_rate_limits.py` switches it on to prove it.
    rate_limit_global_enabled: bool = False
    rate_limit_per_ip_per_minute: int = 600
    rate_limit_per_user_per_minute: int = 300
    rate_limit_per_tenant_per_minute: int = 1500

    @field_validator("aws_endpoint_url", mode="before")
    @classmethod
    def _blank_endpoint_means_real_aws(cls, v: object) -> object:
        """`AWS_ENDPOINT_URL=` means "no override", not "an empty endpoint".

        Without this, pointing a local checkout at real AWS by blanking the
        LocalStack line in .env produces an empty string, and boto3 builds
        every URL against it -- the symptom is a connection refused to
        127.0.0.1 while every credential and bucket name is correct.
        """
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("openai_api_key", "sarvam_api_key", mode="before")
    @classmethod
    def _blank_key_means_none(cls, v: object) -> object:
        """`OPENAI_API_KEY=` in a .env is "not set", not an empty key -- or the
        boot check passes and every call fails with a 401 instead."""
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("database_admin_url", mode="after")
    @classmethod
    def _admin_url_must_differ(cls, v: PostgresDsn | None, info: object) -> PostgresDsn | None:
        # A bypass role that is the same connection as the app role is not a
        # bypass role, it is a mistake that removes RLS everywhere.
        return v

    @model_validator(mode="after")
    def _local_auth_is_never_production(self) -> Settings:
        """The local token issuer must be impossible to reach in production.

        A misplaced environment variable is all it would take, and the failure
        is silent: the service would keep serving, and would accept tokens
        anyone could mint. So this is a boot-time refusal rather than a
        runtime check -- the process does not start at all.
        """
        if self.auth_allow_local_tokens and self.environment in ("staging", "prod"):
            raise ValueError(
                "AUTH_ALLOW_LOCAL_TOKENS must not be set in staging or production: "
                "it enables a token issuer whose signing key this process generates "
                "itself, so anyone who can reach the API could mint any identity."
            )
        return self

    @model_validator(mode="after")
    def _the_unsubscribe_secret_is_long_enough(self) -> Settings:
        """A short HMAC key is a forgeable token, and PyJWT only warns.

        RFC 7518 3.2 wants at least as many bits as the hash: 32 bytes for
        HS256. The token this signs only turns somebody's reminders off, so
        the damage is small -- but "small damage, easily forged" is still not
        a thing to ship, and a boot-time refusal costs nothing next to
        discovering it from a mailbox provider's complaint feed.
        """
        secret = self.notifications_unsubscribe_secret
        if secret is not None and len(secret.get_secret_value().encode()) < 32:
            raise ValueError(
                "NOTIFICATIONS_UNSUBSCRIBE_SECRET must be at least 32 bytes (RFC 7518 3.2). "
                'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )
        return self

    @model_validator(mode="after")
    def _stub_payments_are_never_production(self) -> Settings:
        """The stub gateway exposes a route that settles the caller's own
        payment. In a deployed environment that is free access for anyone."""
        if self.payments_provider == "stub" and self.environment in ("staging", "prod"):
            raise ValueError(
                "PAYMENTS_PROVIDER=stub must not be set in staging or production: "
                "the stub lets a caller mark their own payment as paid."
            )
        return self

    @model_validator(mode="after")
    def _stub_evaluation_is_never_production(self) -> Settings:
        """The stub evaluator invents feedback. A candidate who paid for a
        rehearsal would act on it."""
        if self.interview_evaluation_provider == "stub" and self.environment in (
            "staging",
            "prod",
        ):
            raise ValueError(
                "INTERVIEW_EVALUATION_PROVIDER=stub must not be set in staging or "
                "production: it shows candidates feedback nobody gave."
            )
        return self

    @model_validator(mode="after")
    def _model_providers_have_what_they_need(self) -> Settings:
        """A provider chosen without its key fails every call at runtime, and
        the score or report sits PENDING with nothing saying why. Refuse at boot."""
        uses_openai = (
            self.scoring_extraction_enabled and self.scoring_extraction_provider == "openai"
        ) or "openai" in (self.interview_evaluation_provider, self.interview_question_provider)
        if uses_openai and self.openai_api_key is None:
            raise ValueError("OPENAI_API_KEY is required by the selected providers.")
        if self.interview_evaluation_provider == "openai" and not (
            self.interview_evaluation_model_id.strip()
        ):
            raise ValueError(
                "INTERVIEW_EVALUATION_PROVIDER=openai needs INTERVIEW_EVALUATION_MODEL_ID."
            )
        if self.interview_question_provider == "openai" and not (
            self.interview_question_model_id.strip()
        ):
            raise ValueError(
                "INTERVIEW_QUESTION_PROVIDER=openai needs INTERVIEW_QUESTION_MODEL_ID."
            )
        if self.interview_question_provider == "stub" and self.environment in ("staging", "prod"):
            raise ValueError(
                "INTERVIEW_QUESTION_PROVIDER=stub must not be set in staging or production: "
                "it asks candidates placeholder questions."
            )
        if self.interview_transcription_provider == "sarvam" and self.sarvam_api_key is None:
            raise ValueError("INTERVIEW_TRANSCRIPTION_PROVIDER=sarvam needs SARVAM_API_KEY.")
        if self.interview_transcription_provider == "stub" and self.environment in (
            "staging",
            "prod",
        ):
            raise ValueError(
                "INTERVIEW_TRANSCRIPTION_PROVIDER=stub must not be set in staging or production."
            )
        return self

    @model_validator(mode="after")
    def _notification_providers_are_real_or_local(self) -> Settings:
        """A stub provider tells us a message was sent when nobody received it,
        and a real one with no credentials fails every send at runtime."""
        stubbed = "stub" in (self.notifications_sms_provider, self.notifications_email_provider)
        if stubbed and self.environment in ("staging", "prod"):
            raise ValueError(
                "NOTIFICATIONS_*_PROVIDER=stub must not be set in staging or production: "
                "it records messages as sent that nobody received."
            )
        if self.notifications_sms_provider == "twilio" and not (
            self.twilio_account_sid and self.twilio_auth_token and self.twilio_messaging_service_sid
        ):
            raise ValueError(
                "NOTIFICATIONS_SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN "
                "and TWILIO_MESSAGING_SERVICE_SID."
            )
        if self.notifications_email_provider == "ses" and not self.notifications_email_from:
            raise ValueError("NOTIFICATIONS_EMAIL_PROVIDER=ses needs NOTIFICATIONS_EMAIL_FROM.")
        return self

    @model_validator(mode="after")
    def _auth_is_configured_somehow(self) -> Settings:
        """Refuse to boot with no way to verify a token.

        Without this the service starts happily and rejects every authenticated
        request with a 401 that looks like a client bug. Failing at boot names
        the actual problem.
        """
        if not self.auth_allow_local_tokens and not (
            self.cognito_candidate_pool_id or self.cognito_business_pool_id
        ):
            raise ValueError(
                "No authentication configured: set COGNITO_*_POOL_ID for at least one "
                "pool, or AUTH_ALLOW_LOCAL_TOKENS=true for local development."
            )
        return self

    def cognito_pool_id(self, pool: str) -> str | None:
        return {
            "CANDIDATE": self.cognito_candidate_pool_id,
            "BUSINESS": self.cognito_business_pool_id,
        }.get(pool)

    def cognito_client_id(self, pool: str) -> str | None:
        return {
            "CANDIDATE": self.cognito_candidate_client_id,
            "BUSINESS": self.cognito_business_client_id,
        }.get(pool)

    def cognito_issuer(self, pool: str) -> str | None:
        """The `iss` claim a token from this pool must carry."""
        pool_id = self.cognito_pool_id(pool)
        if pool_id is None:
            return None
        return f"https://cognito-idp.{self.aws_region}.amazonaws.com/{pool_id}"

    @property
    def is_production(self) -> bool:
        return self.environment == "prod"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Settings are read once per process and cached."""
    return Settings()
