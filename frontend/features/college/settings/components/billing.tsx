"use client";

import { humanizeCode } from "@/lib/format/labels";
import { useState } from "react";
import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";

import type {
  CheckoutResult,
  CollegePlan,
  CollegeSeats,
  CollegeSubscription,
} from "@/store/college/types";

import { useSettings } from "../hooks/use-settings";
import { DiscountCodeField } from "@/components/billing/discount-code-field";
import { SimulatedPaymentDialog } from "@/components/billing/simulated-payment-dialog";
import { isStubPaymentUrl } from "@/store/api/payment.api";
import { usePreviewCollegeDiscountMutation } from "@/store/college/billing/billing.api";

function formatCurrency(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return "-";
  }

  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SUBSCRIPTION_LABELS: Record<CollegeSubscription["state"], string> = {
  NONE: "No subscription",
  PENDING: "Payment pending",
  ACTIVE: "Active",
  GRACE: "In grace period",
  LAPSED: "Lapsed",
  CANCELLED: "Cancelled",
};

export function Billing() {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [previewDiscount] = usePreviewCollegeDiscountMutation();
  const [simulatedCheckout, setSimulatedCheckout] = useState<CheckoutResult | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null);
  const {
    seats,
    subscription,
    plans,
    isLoadingBilling,
    refetchBilling,
    checkout,
    isCheckingOut,
    cancelSubscription,
    isCancelling,
  } = useSettings("billing");

  const collegePlans = plans.filter((plan) => plan.audience === "COLLEGE");

  const createCheckout = async (planCode: string, discountCode?: string) => {
    const result = await checkout(planCode, discountCode);
    if (isStubPaymentUrl(result.redirectUrl)) {
      setSimulatedCheckout(result);
    } else if (result.redirectUrl) {
      window.location.assign(result.redirectUrl);
    }
  };

  const handleCheckout = async (planCode: string) => {
    setSelectedPlanCode(planCode);
    await createCheckout(planCode);
  };

  return (
    <div
      className="flex w-full flex-col gap-4"
      style={{
        fontFamily: "'General Sans', sans-serif",
      }}
    >
      <div className="grid w-full grid-cols-1 gap-4 min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <SeatBlock seats={seats} />
        <SubscriptionBlock
          subscription={subscription}
          isLoading={isLoadingBilling}
          isCancelling={isCancelling}
          onCancel={() => setCancelOpen(true)}
        />
      </div>

      <CancelSubscriptionDialog open={cancelOpen} planCode={subscription?.planCode} periodEnd={subscription?.currentPeriodEnd} onCancel={cancelSubscription} onClose={() => setCancelOpen(false)} />
      {/* Plans */}
      <section className="overflow-hidden rounded-[12px] border border-[#e1e5eb] bg-white shadow-[0_4px_12px_rgba(19,26,38,0.024)]">
        <div className="border-b border-[#e1e5eb] px-5 py-4 text-[14px] font-semibold leading-[18px] text-[#131A26]">
          Available plans
        </div>

        {collegePlans.length === 0 && (
          <p className="px-5 py-6 text-[13px] text-[#64748b]">
            {isLoadingBilling
              ? "Loading plans..."
              : "No plans are available right now."}
          </p>
        )}

        {collegePlans.map((plan, index) => (
          <PlanRow
            key={plan.code}
            plan={plan}
            isCurrent={subscription?.planCode === plan.code}
            isCheckingOut={isCheckingOut}
            onSubscribe={() => handleCheckout(plan.code)}
            divided={index > 0}
          />
        ))}
      </section>
      {simulatedCheckout && selectedPlanCode ? <SimulatedPaymentDialog paymentId={simulatedCheckout.paymentId} amountMinor={simulatedCheckout.amountMinor} currency={simulatedCheckout.currency} title="College subscription" checkoutContent={<DiscountCodeField planCode={selectedPlanCode} preview={(args) => previewDiscount(args).unwrap()} onChange={(code) => createCheckout(selectedPlanCode, code ?? undefined)} />} onComplete={refetchBilling} onClose={() => { setSimulatedCheckout(null); setSelectedPlanCode(null); }} /> : null}
    </div>
  );
}

function SeatBlock({ seats }: Readonly<{ seats: CollegeSeats | null }>) {
  // No plan means no seats: say so rather than "0 / 0" and an empty bar.
  if (seats && !seats.subscriptionActive) {
    return (
      <section className="flex flex-col gap-[14px] rounded-[12px] border border-[#f2d3a0] bg-[#fff8ec] p-5 shadow-[0_4px_12px_rgba(19,26,38,0.024)]">
        <div className="flex items-center gap-[10px]">
          <span className="flex-1 text-[14px] font-semibold leading-[18px] text-[#131A26]">
            Seat block
          </span>
          <span className="whitespace-nowrap rounded-full bg-[#ffecc8] px-[10px] py-1 text-[11px] font-semibold leading-[14px] text-[#8a5a00]">
            No subscription
          </span>
        </div>

        <span className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-[#8a5a00]">
          No subscription bought
        </span>

        <p className="text-[12px] font-normal leading-[17px] text-[#131A26]">
          Seats come with a plan. Choose one below to give your students access;
          until then no seats can be used or assigned.
        </p>
      </section>
    );
  }

  const used = seats?.used ?? 0;
  const allocated = seats?.allocated ?? 0;
  const percentage =
    allocated > 0 ? Math.min((used / allocated) * 100, 100) : 0;

  return (
    <section className="flex flex-col gap-[14px] rounded-[12px] border border-[#e1e5eb] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.024)]">
      <div className="flex items-center gap-[10px]">
        <span className="flex-1 text-[14px] font-semibold leading-[18px] text-[#131A26]">
          Seat block
        </span>

        <span
          className={[
            "whitespace-nowrap rounded-full px-[10px] py-1",
            "text-[11px] font-semibold leading-[14px]",
            seats?.subscriptionActive
              ? "bg-[#eaf6f0] text-[#00845a]"
              : "bg-[#fdecec] text-[#c43d3d]",
          ].join(" ")}
        >
          {seats?.subscriptionActive ? "Active" : "Inactive"}
        </span>
      </div>

      <span className="text-[28px] font-bold leading-8 tracking-[-0.02em] text-[#131A26]">
        {used} / {allocated}
      </span>

      <span className="block h-2 overflow-hidden rounded-full bg-[#eef0f3]">
        <span
          className="block h-full rounded-full bg-[#3566b8] transition-all"
          style={{ width: `${percentage}%` }}
        />
      </span>

      <p className="text-[12px] font-normal leading-[17px] text-[#131A26]">
        {seats?.available ?? 0} seats available. Seat pricing is confirmed on
        your invoice; contact your BharatPath partner manager to change the
        block mid-term.
      </p>
    </section>
  );
}

function SubscriptionBlock({
  subscription,
  isLoading,
  isCancelling,
  onCancel,
}: Readonly<{
  subscription: CollegeSubscription | null;
  isLoading: boolean;
  isCancelling: boolean;
  onCancel: () => void;
}>) {
  const state = subscription?.state ?? "NONE";
  const isActive = state === "ACTIVE" || state === "GRACE";

  return (
    <section className="flex flex-col gap-[14px] rounded-[12px] border border-[#e1e5eb] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.024)]">
      <div className="flex items-center gap-[10px]">
        <span className="flex-1 text-[14px] font-semibold leading-[18px] text-[#131A26]">
          Subscription
        </span>

        <span
          className={[
            "whitespace-nowrap rounded-full px-[10px] py-1",
            "text-[11px] font-semibold leading-[14px]",
            isActive
              ? "bg-[#eaf6f0] text-[#00845a]"
              : "bg-[#f3f5f7] text-[#64748b]",
          ].join(" ")}
        >
          {SUBSCRIPTION_LABELS[state]}
        </span>
      </div>

      <dl className="flex flex-col gap-2 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-[#64748b]">Current plan</dt>
          <dd className="font-semibold text-[#131A26]">
            {subscription?.planCode ? humanizeCode(subscription.planCode) : "-"}
          </dd>
        </div>

        <div className="flex items-center justify-between">
          <dt className="text-[#64748b]">{subscription?.cancelAt || !subscription?.renewsAutomatically ? "Access until" : "Renews on"}</dt>
          <dd className="font-semibold text-[#131A26]">
            {formatDate(subscription?.currentPeriodEnd ?? null)}
          </dd>
        </div>

        <div className="flex items-center justify-between">
          <dt className="text-[#64748b]">Auto-renewal</dt>
          <dd className="font-semibold text-[#131A26]">
            {subscription?.renewsAutomatically ? "On" : "Off"}
          </dd>
        </div>
      </dl>

      {subscription?.cancelAt && <p role="status" className="text-[13px] text-[#64748b]">Renewal cancelled. Access continues until {formatDate(subscription.cancelAt)}.</p>}
      {isActive && !subscription?.cancelAt && (
        <button
          type="button"
          disabled={isCancelling || isLoading}
          onClick={() => onCancel()}
          className="self-start rounded-[8px] border border-[#e1e5eb] bg-white px-4 py-[10px] text-[13px] font-semibold leading-[17px] text-[#c43d3d] transition hover:bg-[#fdf2f2] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCancelling ? "Cancelling..." : "Cancel subscription"}
        </button>
      )}
    </section>
  );
}

function PlanRow({
  plan,
  isCurrent,
  isCheckingOut,
  onSubscribe,
  divided,
}: Readonly<{
  plan: CollegePlan;
  isCurrent: boolean;
  isCheckingOut: boolean;
  onSubscribe: () => void;
  divided: boolean;
}>) {
  return (
    <div
      className={[
        "grid items-center gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto]",
        divided ? "border-t border-[#eef0f3]" : "",
        isCurrent ? "bg-[#f4f2ff] shadow-[inset_3px_0_0_#5a4bd6]" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
          {humanizeCode(plan.code)}
          {isCurrent ? (
            <span className="ml-2 rounded-full bg-[#5a4bd6] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Current plan
            </span>
          ) : null}
        </span>
        <span className="text-[11px] font-normal leading-[14px] text-[#64748b]">
          {plan.period.toLowerCase()} ·{" "}
          {plan.seatAllowance === null
            ? "seats by arrangement"
            : `${plan.seatAllowance} seats`}
        </span>
      </div>

      <span className="whitespace-nowrap text-[13px] font-semibold text-[#131A26]">
        {formatCurrency(plan.priceMinor, plan.currency)}
      </span>

      <button
        type="button"
        disabled={isCurrent || isCheckingOut}
        onClick={onSubscribe}
        className="shrink-0 rounded-[8px] border-0 bg-[#5a4bd6] px-4 py-[8px] text-[12px] font-semibold leading-[16px] text-white transition hover:bg-[#4f41c8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isCurrent ? "Current" : "Choose"}
      </button>
    </div>
  );
}
