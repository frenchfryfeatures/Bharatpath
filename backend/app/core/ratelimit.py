"""Fixed-window throttles in Redis, and the one table that names them all.

Deliberately coarse. This is not the primary abuse control for OTP -- Twilio
Verify owns code generation, expiry, resend limits and carrier-level fraud
detection, and it is much better at that than we would be. Ours is the outer
throttle: Twilio's limits protect Twilio's spend, and this protects against
someone walking the phone-number space at our expense (docs/plan.md 5.8).

A fixed window, not a sliding one, on purpose. A sliding window costs a sorted
set per subject and a cleanup pass; a fixed window costs one INCR. The
worst-case leak -- twice the limit across a window boundary -- is irrelevant at
"5 OTP starts per phone per hour" and would matter only if this were the real
control, which it is not.

**Day 20: every limit on the platform is in `policies()`.** Three scopes, as
the plan asks -- per user, per tenant, per IP -- in two tiers:

  * **Global limits** apply to every request. Per IP in middleware, before
    authentication, so an unauthenticated flood never reaches a token check;
    per user and per tenant in `current_user`, once identity is resolved, so a
    whole organisation's staff share one budget and cannot multiply it by
    signing in more recruiters. These **fail open**: they are a guard against
    a runaway client, and a Redis blip that took the whole API down with it
    would be a worse outage than the one it guards against.
  * **Specific limits** sit on the routes where a request costs money or
    leaks something. These **fail closed**, because an unenforced throttle in
    front of a paid SMS gateway degrades to somebody else's bill, and an
    unenforced threshold preview degrades to an employer learning a score.

**The tightest limits are OTP and the threshold preview**, as the plan
requires, and `tests/unit/test_rate_limit_policies.py` holds them there: no
other policy may be as tight per hour. A new limit that is tighter than either
is either a mistake or a decision, and the test makes somebody say which.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.core.cache import get_redis
from app.core.errors import RateLimitedError
from app.core.logging import get_logger
from app.settings import Settings, get_settings

logger = get_logger(__name__)


class Scope(StrEnum):
    USER = "user"
    TENANT = "tenant"
    IP = "ip"
    #: A phone number, before there is a user to attach it to.
    PHONE = "phone"


@dataclass(frozen=True, slots=True)
class Policy:
    bucket: str
    scope: Scope
    limit: int
    window_seconds: int
    #: Global limits only. See the module docstring for why the two tiers
    #: fail in opposite directions.
    fail_open: bool = False

    @property
    def per_hour(self) -> float:
        return self.limit * 3600 / self.window_seconds


#: Limits whose numbers are fixed in code. The threshold preview's is here
#: rather than in `jobs` because a limit is only comparable with the others --
#: and only testable as "the tightest" -- if they all live in one table.
STATIC_POLICIES: Final[Mapping[str, Policy]] = {
    # Shared across the organisation: the risk is the organisation learning a
    # score by bisection, not one person asking too often (Day 10).
    "jobs.threshold_preview": Policy("jobs:threshold_preview", Scope.TENANT, 30, 3600),
    # An export is the most expensive read on the platform, and a deletion the
    # most consequential write. The real guard is one open request of each
    # kind per person (`uq_dsr_one_open_per_type`); this bounds polling the
    # download link and hammering the 409. Deliberately looser than OTP and
    # the threshold preview, which must stay the tightest limits we have.
    "privacy.request": Policy("privacy:request", Scope.USER, 60, 3600),
    # A college aggregate is already floored and suppressed, so this is not a
    # leak control -- it is the cost control the Day 18 notes left owed: an
    # overview is several joins over every consenting student, and a dashboard
    # left open in a tab should not run them continuously. Per organisation,
    # because a college's staff share the dashboard.
    "analytics.read": Policy("analytics:read", Scope.TENANT, 120, 3600),
    # Trying a discount code, at preview or checkout (2026-09-18). Per person,
    # because the risk is one account walking the code space; a real payer
    # types a code a handful of times. Looser than OTP and the threshold
    # preview, which must stay the tightest.
    "billing.discount_code": Policy("billing:discount_code", Scope.USER, 40, 3600),
    # The search filter panel and its typeahead (2026-09-24). A cost control,
    # not a leak control: the catalogue is the same for every employer and
    # holds nobody. Per person, per minute, generous enough for typing with a
    # debounce -- and kept off `discovery:search`, so filling in the panel
    # never spends the organisation's search pages.
    "discovery.filters": Policy("discovery:filters", Scope.USER, 120, 60),
    # An employer writing to applicants (2026-09-29). Per organisation, and a
    # spam control rather than a leak control: each message is an email in a
    # candidate's inbox. One candidate is protected separately, by a daily
    # cap per application (`applications.domain`).
    "applications.message": Policy("applications:message", Scope.TENANT, 300, 3600),
    # An employer inviting candidates from search to a job (2026-10-05). Per
    # organisation, a spam control: each invitation is an email to a person
    # who never applied. The number is ours, not the client's.
    "applications.shortlist_invite": Policy(
        "applications:shortlist_invite", Scope.TENANT, 60, 3600
    ),
}


def policies(settings: Settings | None = None) -> dict[str, Policy]:
    """Every rate limit on the platform, by name."""
    settings = settings or get_settings()
    return {
        **STATIC_POLICIES,
        "otp.phone": Policy("otp:phone", Scope.PHONE, settings.otp_start_per_phone_per_hour, 3600),
        "otp.ip": Policy("otp:ip", Scope.IP, settings.otp_start_per_ip_per_hour, 3600),
        "global.ip": Policy(
            "global:ip", Scope.IP, settings.rate_limit_per_ip_per_minute, 60, fail_open=True
        ),
        "global.user": Policy(
            "global:user", Scope.USER, settings.rate_limit_per_user_per_minute, 60, fail_open=True
        ),
        "global.tenant": Policy(
            "global:tenant",
            Scope.TENANT,
            settings.rate_limit_per_tenant_per_minute,
            60,
            fail_open=True,
        ),
    }


async def hit(
    *,
    bucket: str,
    subject: str,
    limit: int,
    window_seconds: int,
    fail_open: bool = False,
) -> int:
    """Count one request against `subject`, or raise `RateLimitedError`.

    Returns the count after this request, so a caller can log how close to the
    limit a client is running.

    **Fails closed by default.** If Redis is unreachable this raises rather
    than allowing the request. That is the opposite of the membership cache,
    and the asymmetry is deliberate: a missing membership entry degrades to a
    slower correct answer, whereas an unenforced throttle in front of a paid
    SMS gateway degrades to somebody else's bill. `fail_open` exists for the
    global tier only.
    """
    key = f"ratelimit:{bucket}:{subject}"
    try:
        redis = get_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)  # only on the first hit of a window
        count = int((await pipe.execute())[0])
    except RateLimitedError:
        raise
    except Exception as exc:
        logger.error("ratelimit_backend_unavailable", bucket=bucket, fail_open=fail_open)
        if fail_open:
            return 0
        raise RateLimitedError(code="rate_limit_unavailable") from exc

    if count > limit:
        logger.warning("rate_limited", bucket=bucket, count=count, limit=limit)
        raise RateLimitedError(params={"retry_after_seconds": window_seconds})
    return count


async def enforce(name: str, *, subject: str, settings: Settings | None = None) -> int:
    """Apply the named policy to one subject."""
    policy = policies(settings)[name]
    return await hit(
        bucket=policy.bucket,
        subject=subject,
        limit=policy.limit,
        window_seconds=policy.window_seconds,
        fail_open=policy.fail_open,
    )
