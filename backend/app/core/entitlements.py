"""Is this caller paying right now? Read live, never cached.

Pay-first applies to all three audiences (R13): sign-up grants an account, and
everything else needs an active subscription. `require_active_subscription` in
`app.core.deps` is the only caller, and for a candidate it asks both questions
here: a personal subscription, or a college seat.

Raw SQL rather than `subscriptions.service`, for the same reason `app/core/auth`
reads memberships with SQL: core may not import modules
(`core-depends-on-nothing`), and this check sits in front of routes in every
module.

**No cache, deliberately.** A subscription lapsing mid-session must refuse the
very next request. The query is one index hit on `ix_subscription_active_window`,
whose predicate the WHERE clause below repeats so the planner can use it.
"""

from __future__ import annotations

from typing import Final, Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SubscriberType = Literal["USER", "TENANT"]

#: Active means inside a started, unfinished period, in a state that grants
#: access. **The clock decides, not a sweep**: a period that ended a second ago
#: grants nothing even if no job has moved the row to LAPSED yet.
#:
#: GRACE grants access only while `current_period_end` is in the future:
#: entering GRACE moves that column to the end of grace (`grace_from` keeps the
#: paid end). A GRACE row that did not would grant nothing -- the safe
#: direction to be wrong.
_ACTIVE_SUBSCRIPTION: Final = text(
    """
    SELECT EXISTS (
      SELECT 1
        FROM subscriptions
       WHERE subscriber_type = :kind
         AND subscriber_id = :subscriber
         AND state IN ('ACTIVE', 'GRACE')
         AND current_period_start <= now()
         AND current_period_end > now()
    )
    """
)


async def has_active_subscription(
    session: AsyncSession, *, subscriber_type: SubscriberType, subscriber_id: UUID
) -> bool:
    result = await session.execute(
        _ACTIVE_SUBSCRIPTION, {"kind": subscriber_type, "subscriber": str(subscriber_id)}
    )
    return bool(result.scalar_one())


_ACTIVE_COLLEGE_SEAT: Final = text("SELECT candidate_has_college_seat(:user)")


async def has_active_college_seat(session: AsyncSession, *, user_id: UUID) -> bool:
    """A live seat at an ACTIVE college whose own subscription is in period,
    held on a live ROSTER consent (C12). One SECURITY DEFINER function in the
    baseline, because the seat tables are under the colleges' Row-Level
    Security and this runs before anything is bound. Read live, like the
    subscription: a college lapsing must lock its students out on the next
    request, not the next cache expiry."""
    result = await session.execute(_ACTIVE_COLLEGE_SEAT, {"user": str(user_id)})
    return bool(result.scalar_one())
