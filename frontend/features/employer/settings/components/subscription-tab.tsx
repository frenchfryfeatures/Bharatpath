"use client";

import { useState } from "react";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";

import { useCancelEmployerSubscriptionMutation, useCheckoutEmployerSubscriptionMutation, useCreateEmployerMandateMutation, useGetEmployerPlansQuery, useGetEmployerSubscriptionQuery, usePreviewEmployerDiscountMutation } from "@/store/employer/billing";
import { DiscountCodeField } from "@/components/billing/discount-code-field";
import { SimulatedPaymentDialog } from "@/components/billing/simulated-payment-dialog";
import { isStubPaymentUrl } from "@/store/api/payment.api";
import type { CheckoutResponse } from "@/store/employer/billing/billing.api";
import { useConfirmDialog } from "@/features/employer/components/use-confirm-dialog";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
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
  const isOwner = useSessionIdentity().user?.backendRole === "EMPLOYER_OWNER";
  const { data: subscription, isLoading, refetch: refetchSubscription } = useGetEmployerSubscriptionQuery();
  const { data: plans = [], isLoading: plansLoading } = useGetEmployerPlansQuery();
  const [checkout, checkoutState] = useCheckoutEmployerSubscriptionMutation();
  const [previewDiscount] = usePreviewEmployerDiscountMutation();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancel, cancelState] = useCancelEmployerSubscriptionMutation();
  const [createMandate, mandateState] = useCreateEmployerMandateMutation();
  const { confirm, dialog } = useConfirmDialog();
  const [simulatedCheckout, setSimulatedCheckout] = useState<CheckoutResponse | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);

  const createCheckout = async (planCode: string, discountCode?: string) => {
    const result = await checkout({ planCode, discountCode }).unwrap();
    if (isStubPaymentUrl(result.redirect_url)) setSimulatedCheckout(result);
    else if (result.redirect_url) window.location.assign(result.redirect_url);
  };

  const buy = async (planCode: string) => {
    setSelectedPlanCode(planCode);
    try {
      await createCheckout(planCode);
    } catch {
      // Surfaced through the billing error banner below.
    }
  };
  const [mandateNotice, setMandateNotice] = useState<string | null>(null);
  const mandate = async () => {
    try {
      const result = await createMandate().unwrap();
      if (isStubPaymentUrl(result.authorisation_url)) {
        setMandateNotice("UPI AutoPay is not available yet. Your plan stays as it is.");
        return;
      }
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
          {subscription?.current_period_end && <span className="text-[#718096]">Until {new Date(subscription.current_period_end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
        </div>
        {subscription?.cancel_at && <p role="status" className="mt-3 text-xs text-[#718096]">Renewal cancelled. Access continues until {new Date(subscription.cancel_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.</p>}
        {mandateNotice ? <p role="status" className="mt-3 text-xs text-[#718096]">{mandateNotice}</p> : null}
        {!isOwner ? <p className="mt-3 text-xs text-[#718096]">Only the organisation owner can change the plan.</p> : null}
        <div className="mt-4 flex gap-2">
          {isOwner && subscription?.has_access && subscription.renews_automatically && !subscription.cancel_at && <button disabled={cancelState.isLoading} onClick={() => setCancelOpen(true)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Cancel renewal</button>}
          {isOwner && subscription?.has_access && !subscription.cancel_at && !subscription.renews_automatically && <button disabled={mandateState.isLoading} onClick={() => confirm({
            title: "Enable UPI AutoPay?",
            description: "You will be taken to your UPI app to authorise recurring payments. You are notified before every debit.",
            confirmLabel: "Continue",
            onConfirm: mandate,
          })} className="rounded-lg bg-[#151b2b] px-3 py-2 text-xs font-semibold text-white">Enable UPI AutoPay</button>}
        </div>
      </section>
      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#dfe3e9] bg-white px-5 py-8 text-center text-xs leading-5 text-[#718096]">
          No subscription plans are available right now. Please try again later.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => { const current = Boolean(subscription?.has_access) && subscription?.plan_code === plan.code; return <section key={plan.code} className={`rounded-xl border bg-white p-5 ${current ? "border-[#5b4ed0] ring-2 ring-[#5b4ed0]/20" : "border-[#e0e4e9]"}`}>
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">{plan.period}</h3>{current ? <span className="rounded-full bg-[#5b4ed0] px-2 py-0.5 text-[10px] font-bold uppercase text-white">Current plan</span> : null}</div>
          <p className="mt-2 text-2xl font-bold">₹{(plan.price_minor / 100).toLocaleString("en-IN")}</p>
          <p className="mt-1 text-xs text-[#718096]">{plan.months} month{plan.months === 1 ? "" : "s"}{plan.seat_allowance ? ` · ${plan.seat_allowance} seats` : ""}</p>
          {isOwner ? <button disabled={checkoutState.isLoading} onClick={() => confirm({
            title: `Choose the ${plan.period} plan?`,
            description: `You will be taken to checkout to pay ₹${(plan.price_minor / 100).toLocaleString("en-IN")} for ${plan.months} month${plan.months === 1 ? "" : "s"} of employer access. You can apply a discount code at payment.`,
            confirmLabel: "Go to checkout",
            onConfirm: () => buy(plan.code),
          })} className="mt-4 w-full rounded-lg bg-[#5b4ed0] px-3 py-2 text-xs font-bold text-white">{current ? "Extend plan" : "Choose plan"}</button> : null}
          </section>; })}
        </div>
      )}
      {(checkoutState.isError || cancelState.isError || mandateState.isError) && <EmployerErrorState variant="inline" error={checkoutState.error || cancelState.error || mandateState.error} fallback="The billing request could not be completed." />}
      <CancelSubscriptionDialog open={cancelOpen} planCode={subscription?.plan_code} periodEnd={subscription?.current_period_end} onCancel={() => cancel().unwrap()} onClose={() => setCancelOpen(false)} />
      {dialog}
      {simulatedCheckout && selectedPlanCode ? <SimulatedPaymentDialog paymentId={simulatedCheckout.payment_id} amountMinor={simulatedCheckout.amount_minor} currency={simulatedCheckout.currency} title="Employer subscription" checkoutContent={<DiscountCodeField planCode={selectedPlanCode} preview={(args) => previewDiscount(args).unwrap()} onChange={(code) => createCheckout(selectedPlanCode, code ?? undefined)} />} onComplete={() => refetchSubscription()} onClose={() => { setSimulatedCheckout(null); setSelectedPlanCode(null); }} /> : null}
    </div>
  );
}
