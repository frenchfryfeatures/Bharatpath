"""subscriptions - HTTP layer

Plans, periods, renewal, cancellation, seats.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Mounted on each audience's surface, not under `/subscriptions`.** A
subscription is always somebody's: a candidate's own (`/candidate/subscription`)
or their organisation's (`/employer/subscription`, `/college/subscription`).

**None of these routes need a subscription**, obviously: they are how one is
bought. Everyone in an employer organisation can see its subscription; only
the owner can buy, cancel or set up auto-renew.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status

from app.core.deps import (
    CANDIDATE,
    COLLEGE_ADMIN,
    COLLEGE_STAFF,
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    EMPLOYER_VIEWER,
    CurrentUser,
    DbSession,
    require_role,
)
from app.modules.billing import service as billing_service
from app.modules.billing.schemas import CheckoutResponse
from app.modules.subscriptions import service
from app.modules.subscriptions.catalogue import PERIOD_MONTHS
from app.modules.subscriptions.schemas import (
    DiscountPreviewRequest,
    DiscountPreviewResponse,
    MandateResponse,
    PlanResponse,
    SubscriptionCheckoutRequest,
    SubscriptionResponse,
)

candidate_router = APIRouter()
employer_router = APIRouter()
college_router = APIRouter()


def _plan_response(plan: Any) -> PlanResponse:
    return PlanResponse(
        code=plan.code,
        audience=plan.audience,
        period=plan.period,
        months=PERIOD_MONTHS[plan.period],
        price_minor=plan.price_minor,
        seat_allowance=plan.seat_allowance,
    )


def _subscription_response(current: service.SubscriptionStatus) -> SubscriptionResponse:
    row = current.subscription
    if row is None:
        return SubscriptionResponse(state="NONE", has_access=current.has_access)
    return SubscriptionResponse(
        state=row.state,
        has_access=current.has_access,
        plan_code=current.plan.code if current.plan else None,
        period=current.plan.period if current.plan else None,
        current_period_start=row.current_period_start,
        current_period_end=row.current_period_end,
        cancel_at=row.cancel_at,
        renews_automatically=row.renews_automatically,
        mandate_state=current.mandate.state if current.mandate else None,
    )


def _mount(router: APIRouter, *, audience: str, readers: Any, buyers: Any) -> None:
    """The same six routes for each audience, guarded per audience."""

    @router.get(
        "/plans",
        response_model=list[PlanResponse],
        dependencies=[readers],
        summary="Plans on sale",
    )
    async def list_plans(session: DbSession) -> list[PlanResponse]:
        return [_plan_response(p) for p in await service.list_plans(session, audience=audience)]

    @router.get(
        "",
        response_model=SubscriptionResponse,
        dependencies=[readers],
        summary="The current subscription",
    )
    async def current_subscription(user: CurrentUser, session: DbSession) -> SubscriptionResponse:
        current = await service.status_for(session, subscriber=service.subscriber_for(user))
        return _subscription_response(current)

    @router.post(
        "/checkout",
        response_model=CheckoutResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[buyers],
        summary="Buy a period of a plan (a first purchase or a manual renewal)",
    )
    async def checkout(
        payload: SubscriptionCheckoutRequest, user: CurrentUser, session: DbSession
    ) -> CheckoutResponse:
        """Nothing is granted here. The period starts when the gateway's signed
        callback has been processed; poll `GET /billing/payments/{payment_id}`.

        With `discount_code`, `amount_minor` in the response is the discounted
        amount; the code counts as used only once that payment succeeds.

        **A code that makes the plan free settles here.** The response is
        `status: SUCCEEDED`, `amount_minor: 0` and `redirect_url: null`: there
        is no gateway to send anyone to, and the period has already started.
        Works with no payment gateway configured."""
        payment = await billing_service.checkout_subscription(
            session, ctx=user, plan_code=payload.plan_code, discount_code=payload.discount_code
        )
        return CheckoutResponse.of(payment)

    @router.post(
        "/checkout/discount-preview",
        response_model=DiscountPreviewResponse,
        dependencies=[buyers],
        summary="What a plan would cost with a discount code",
    )
    async def discount_preview(
        payload: DiscountPreviewRequest, user: CurrentUser, session: DbSession
    ) -> DiscountPreviewResponse:
        """Writes nothing. Refused with the same 422 codes as checkout, and
        limited per person (40 tries an hour, shared with checkout)."""
        price = await billing_service.preview_discount(
            session, ctx=user, plan_code=payload.plan_code, discount_code=payload.discount_code
        )
        return DiscountPreviewResponse(
            list_amount_minor=price.list_amount_minor,
            discount_minor=price.discount_minor,
            amount_minor=price.amount_minor,
        )

    @router.post(
        "/cancel",
        response_model=SubscriptionResponse,
        dependencies=[buyers],
        summary="Stop renewing at the end of the current period",
    )
    async def cancel(user: CurrentUser, session: DbSession) -> SubscriptionResponse:
        """Access continues to the end of what was paid for. Idempotent."""
        await billing_service.cancel_subscription(session, ctx=user)
        current = await service.status_for(session, subscriber=service.subscriber_for(user))
        return _subscription_response(current)

    @router.post(
        "/mandate",
        response_model=MandateResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[buyers],
        summary="Set up automatic renewal by UPI AutoPay",
    )
    async def register_mandate(user: CurrentUser, session: DbSession) -> MandateResponse:
        """Renewal stays manual until the payer approves the mandate in their UPI app."""
        registration = await billing_service.register_mandate(session, ctx=user)
        return MandateResponse(
            state=registration.mandate.state,
            max_amount_minor=registration.mandate.max_amount_minor,
            valid_until=registration.mandate.valid_until,
            authorisation_url=registration.authorisation_url,
        )


_candidates = Depends(require_role(CANDIDATE))
_mount(candidate_router, audience="CANDIDATE", readers=_candidates, buyers=_candidates)
_mount(
    employer_router,
    audience="EMPLOYER",
    readers=Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER, EMPLOYER_VIEWER)),
    buyers=Depends(require_role(EMPLOYER_OWNER)),
)
_mount(
    college_router,
    audience="COLLEGE",
    readers=Depends(require_role(COLLEGE_ADMIN, COLLEGE_STAFF)),
    buyers=Depends(require_role(COLLEGE_ADMIN)),
)
