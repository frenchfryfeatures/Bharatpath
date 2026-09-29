"use client";

import { useCancelEmployerSubscriptionMutation, useCheckoutEmployerSubscriptionMutation, useCreateEmployerMandateMutation, useGetEmployerPlansQuery, useGetEmployerSubscriptionQuery } from "@/store/employer/billing";
import { ErrorState } from "@/components/ui";
import { Skeleton } from "@/components/common/loading";

function SubscriptionTabSkeleton() {
  return (
    <div
      className="max-w-[760px] space-y-4"
      aria-label="Loading subscription"
      aria-busy="true"
    >
      <span className="sr-only">Loading subscription…</span>

      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5">
        <Skeleton width={132} height={16} radius={6} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Skeleton width={54} height={14} radius={6} />
          <Skeleton width={142} height={14} radius={6} />
          <Skeleton width={94} height={14} radius={6} />
        </div>
        <Skeleton className="mt-4" width={120} height={36} radius={8} />
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <section
            key={index}
            className="rounded-xl border border-[#e0e4e9] bg-white p-5"
          >
            <Skeleton width={90} height={17} radius={6} />
            <Skeleton className="mt-3" width={120} height={29} radius={7} />
            <Skeleton className="mt-2" width={72} height={13} radius={6} />
            <Skeleton className="mt-4" height={34} radius={8} />
          </section>
        ))}
      </div>
    </div>
  );
}

export function SubscriptionTab() {
  const { data: subscription, isLoading } = useGetEmployerSubscriptionQuery();
  const { data: plans = [], isLoading: plansLoading } = useGetEmployerPlansQuery();
  const [checkout, checkoutState] = useCheckoutEmployerSubscriptionMutation();
  const [cancel, cancelState] = useCancelEmployerSubscriptionMutation();
  const [createMandate, mandateState] = useCreateEmployerMandateMutation();

  const buy = async (planCode: string) => {
    try {
      const result = await checkout(planCode).unwrap();
      if (result.redirect_url) window.location.assign(result.redirect_url);
    } catch {
      // Surfaced through the billing error banner below.
    }
  };
  const mandate = async () => {
    try {
      const result = await createMandate().unwrap();
      window.location.assign(result.authorisation_url);
    } catch {
      // Surfaced through the billing error banner below.
    }
  };

  if (isLoading || plansLoading) {
    return <SubscriptionTabSkeleton />;
  }

  return (
    <div className="max-w-[760px] space-y-4">
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5">
        <h2 className="text-[13px] font-bold">Current subscription</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <strong>{subscription?.state ?? "NONE"}</strong>
          <span className={subscription?.has_access ? "text-[#13875e]" : "text-[#b42318]"}>{subscription?.has_access ? "Employer access active" : "Employer access inactive"}</span>
          {subscription?.current_period_end && <span className="text-[#718096]">Until {new Date(subscription.current_period_end).toLocaleDateString("en-IN")}</span>}
        </div>
        <div className="mt-4 flex gap-2">
          {subscription?.has_access && !subscription.cancel_at && <button disabled={cancelState.isLoading} onClick={() => void cancel()} className="rounded-lg border px-3 py-2 text-xs font-semibold">Cancel renewal</button>}
          {subscription?.has_access && !subscription.renews_automatically && <button disabled={mandateState.isLoading} onClick={() => void mandate()} className="rounded-lg bg-[#151b2b] px-3 py-2 text-xs font-semibold text-white">Enable UPI AutoPay</button>}
        </div>
      </section>
      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#dfe3e9] bg-white px-5 py-8 text-center text-xs leading-5 text-[#718096]">
          No subscription plans are available right now. Please try again later.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => <section key={plan.code} className="rounded-xl border border-[#e0e4e9] bg-white p-5">
          <h3 className="text-sm font-bold">{plan.period}</h3>
          <p className="mt-2 text-2xl font-bold">₹{(plan.price_minor / 100).toLocaleString("en-IN")}</p>
          <p className="mt-1 text-xs text-[#718096]">{plan.months} month{plan.months === 1 ? "" : "s"}{plan.seat_allowance ? ` · ${plan.seat_allowance} seats` : ""}</p>
          <button disabled={checkoutState.isLoading} onClick={() => void buy(plan.code)} className="mt-4 w-full rounded-lg bg-[#5b4ed0] px-3 py-2 text-xs font-bold text-white">Choose plan</button>
          </section>)}
        </div>
      )}
      {(checkoutState.isError || cancelState.isError || mandateState.isError) && <ErrorState error={checkoutState.error || cancelState.error || mandateState.error} fallback="The billing request could not be completed." />}
    </div>
  );
}
