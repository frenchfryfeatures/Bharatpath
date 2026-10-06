"use client";

import { useState } from "react";
import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";

import { DiscountCodeField } from "@/components/billing/discount-code-field";
import { SimulatedPaymentDialog } from "@/components/billing/simulated-payment-dialog";
import { Skeleton } from "@/components/common/loading";
import { StudentPage } from "@/features/student/shell";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { isStubPaymentUrl } from "@/store/api/payment.api";
import { type CandidateCheckout, useCancelCandidateSubscriptionMutation, useCheckoutCandidateSubscriptionMutation, useGetCandidatePlansQuery, useGetCandidateSubscriptionQuery, usePreviewCandidateDiscountMutation } from "@/store/student";

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount / 100);

export default function CandidateSubscriptionPage() {
  const { data: subscription, isLoading: subscriptionLoading, refetch: refetchSubscription } = useGetCandidateSubscriptionQuery();
  const { data: plans = [], isLoading: plansLoading } = useGetCandidatePlansQuery();
  const [preview] = usePreviewCandidateDiscountMutation();
  const [checkout, checkoutState] = useCheckoutCandidateSubscriptionMutation();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancel, cancelState] = useCancelCandidateSubscriptionMutation();
  const [error, setError] = useState<string | null>(null);
  const [simulatedCheckout, setSimulatedCheckout] = useState<CandidateCheckout | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);

  async function createCheckout(planCode: string, discountCode?: string) {
    setError(null);
    const result = await checkout({ planCode, discountCode }).unwrap();
    if (isStubPaymentUrl(result.redirect_url)) setSimulatedCheckout(result);
    else if (result.redirect_url) window.location.assign(result.redirect_url);
    else throw new Error("Checkout was created, but no payment page was returned.");
  }

  async function buy(planCode: string) {
    setSelectedPlanCode(planCode);
    try { await createCheckout(planCode); }
    catch (checkoutError) { setError(getApiErrorMessage(checkoutError, "Checkout could not be started.")); }
  }

  return <StudentPage><div className="flex flex-col gap-5">
    <section className="rounded-[20px] border border-[#E7E0D4] bg-white p-4 sm:p-5">
      <h2 className="text-[16px] font-bold text-[#0A1931]">Current subscription</h2>
      {subscriptionLoading ? <div role="status" aria-label="Loading subscription" className="mt-4 flex flex-wrap items-center gap-3"><Skeleton width={86} height={18} radius={6} /><Skeleton width={102} height={16} radius={6} /><Skeleton width={120} height={16} radius={6} /></div> : <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <strong className="text-[#0A1931]">{subscription?.state ?? "NONE"}</strong>
        <span className={subscription?.has_access ? "font-semibold text-[#23805d]" : "text-[#5F6B80]"}>{subscription?.has_access ? "Access active" : "No active paid access"}</span>
        {subscription?.current_period_end ? <span className="text-[#5F6B80]">Until {new Date(subscription.current_period_end).toLocaleDateString("en-IN")}</span> : null}
        {subscription?.has_access && !subscription.cancel_at ? <button type="button" disabled={cancelState.isLoading} onClick={() => setCancelOpen(true)} className="ml-auto rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50">{cancelState.isLoading ? "Cancelling…" : "Cancel renewal"}</button> : null}
      </div>}
      {subscription?.cancel_at ? <p role="status" className="mt-3 text-sm text-[#5F6B80]">Renewal cancelled. Access continues until {new Date(subscription.cancel_at).toLocaleDateString("en-IN")}.</p> : null}
    </section>
    <CancelSubscriptionDialog open={cancelOpen} planCode={subscription?.plan_code} periodEnd={subscription?.current_period_end} onCancel={() => cancel().unwrap()} onClose={() => setCancelOpen(false)} />

    {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

    {plansLoading ? <div role="status" aria-label="Loading subscription plans" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 4 }).map((_, index) => <section key={index} className="rounded-[20px] border border-[#E7E0D4] bg-white p-4 sm:p-5"><Skeleton width={92} height={14} radius={6} /><Skeleton className="mt-4" width={130} height={34} radius={8} /><Skeleton className="mt-2" width={76} height={16} radius={6} /><Skeleton className="mt-5" width="100%" height={42} radius={9} /></section>)}</div> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {plans.map((plan) => <section key={plan.code} className="rounded-[20px] border border-[#E7E0D4] bg-white p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase text-[#5F6B80]">{plan.period}</p>
        <p className="mt-2 text-3xl font-bold text-[#0A1931]">{money(plan.price_minor)}</p>
        <p className="mt-1 text-sm text-[#5F6B80]">{plan.months} month{plan.months === 1 ? "" : "s"}</p>
        <button type="button" disabled={checkoutState.isLoading} onClick={() => void buy(plan.code)} className="mt-4 w-full rounded-lg bg-[#5F4DB2] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#4A3E8F] disabled:opacity-50">{checkoutState.isLoading ? "Starting checkout…" : `Continue · ${money(plan.price_minor)}`}</button>
      </section>)}
    </div>}
    {simulatedCheckout && selectedPlanCode ? <SimulatedPaymentDialog paymentId={simulatedCheckout.payment_id} amountMinor={simulatedCheckout.amount_minor} currency={simulatedCheckout.currency} title="BharatPath membership" checkoutContent={<DiscountCodeField tone="student" planCode={selectedPlanCode} preview={(args) => preview(args).unwrap()} onChange={(code) => createCheckout(selectedPlanCode, code ?? undefined)} />} onComplete={() => refetchSubscription()} onClose={() => { setSimulatedCheckout(null); setSelectedPlanCode(null); }} /> : null}
  </div></StudentPage>;
}
