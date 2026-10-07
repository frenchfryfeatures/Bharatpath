"use client";

import { useState } from "react";
import { StudentBackButton } from "@/features/student/components/student-back-button";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  GraduationCap,
  Mic,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { DiscountCodeField } from "@/components/billing/discount-code-field";
import { SimulatedPaymentDialog } from "@/components/billing/simulated-payment-dialog";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { isStubPaymentUrl } from "@/store/api/payment.api";
import {
  useCheckoutCandidateSubscriptionMutation,
  useGetCandidatePlansQuery,
  useGetCandidateSubscriptionQuery,
  usePreviewCandidateDiscountMutation,
  type CandidateCheckout,
} from "@/store/student";
import { PillButton, StepHeader } from "./ui";

const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount / 100);

export function SubscriptionStep({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack?: () => void;
}) {
  const {
    data: plans = [],
    isLoading,
    isError,
    refetch: refetchPlans,
  } = useGetCandidatePlansQuery(undefined, { refetchOnMountOrArgChange: true });
  const subscription = useGetCandidateSubscriptionQuery();
  const [preview] = usePreviewCandidateDiscountMutation();
  const [checkout, checkoutState] = useCheckoutCandidateSubscriptionMutation();
  const [selected, setSelected] = useState("");
  const [payment, setPayment] = useState<CandidateCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPlan = plans.find((plan) => plan.code === selected) ?? plans[0];

  if (subscription.data?.has_access) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader
          step="subscription"
          title="You’re a member"
          subtitle="Your membership is active. Choose how to add the resume you want scored."
        />
        <section className="flex items-start gap-3 rounded-[20px] border border-[#B8D9C8] bg-[#EEF7F1] p-5">
          <ShieldCheck
            className="mt-0.5 shrink-0 text-[#1F6B45]"
            size={22}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-[15px] font-bold text-[#174C33]">
              Membership active
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[#35624A]">
              Your subscription is ready. Choose a file, paste your resume, or
              fill in a form before scoring.
            </p>
          </div>
        </section>
        <div className="flex items-center gap-3">
          {onBack ? <StudentBackButton onClick={onBack} /> : null}
          <PillButton onClick={onContinue} className="min-w-0 flex-1">
            Choose how to add your resume <ArrowRight size={17} />
          </PillButton>
        </div>
      </div>
    );
  }

  async function createCheckout(planCode: string, discountCode?: string) {
    setError(null);
    const result = await checkout({
      planCode,
      ...(discountCode ? { discountCode } : {}),
    }).unwrap();
    if (isStubPaymentUrl(result.redirect_url)) setPayment(result);
    else if (result.redirect_url) window.location.assign(result.redirect_url);
    else
      throw new Error(
        "Checkout was created, but no payment page was returned.",
      );
  }

  async function continueToPayment() {
    if (!selectedPlan) return;
    try {
      await createCheckout(selectedPlan.code);
    } catch (checkoutError) {
      setError(
        getApiErrorMessage(checkoutError, "Checkout could not be started."),
      );
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        step="subscription"
        title="Choose your membership"
        subtitle="Membership opens your score, job matches and member pricing. Pick a length and pay once for it."
      />

      <section
        className="rounded-[20px] border border-[#E7E0D4] bg-white p-4 sm:p-5"
        aria-label="Membership includes"
      >
        {[
          {
            icon: Sparkles,
            title: "Your score",
            detail: "Read as soon as your resume is confirmed",
          },
          {
            icon: BriefcaseBusiness,
            title: "Jobs and applying",
            detail: "Roles you qualify for, and one board",
          },
          {
            icon: Mic,
            title: "Mock interviews",
            detail: "Bought per session, at member prices",
          },
          {
            icon: GraduationCap,
            title: "Courses",
            detail: "The catalogue, and what each one adds",
          },
        ].map(({ icon: Icon, title, detail }) => (
          <div key={title} className="flex items-center gap-3 py-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5F4DB2] text-white">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-[#0A1931]">
                {title}
              </span>
              <span className="mt-0.5 block text-[12px] text-[#5F6B80]">
                {detail}
              </span>
            </span>
          </div>
        ))}
      </section>

      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#5F6B80]">
        Choose a length
      </h2>
      {isLoading ? (
        <p className="text-sm text-[#5F6B80]">Loading membership plans…</p>
      ) : null}
      {isError ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          Membership plans could not be loaded. Please try again later.
        </p>
      ) : null}
      {!isLoading && !isError && plans.length === 0 && (
        <div
          role="status"
          className="rounded-[16px] border border-[#E7E0D4] bg-[#F7F4EC] p-4 text-[13px] leading-5 text-[#5F6B80]"
        >
          <p>No membership plans are available right now.</p>
          <button
            type="button"
            onClick={() => void refetchPlans()}
            className="mt-2 font-semibold text-[#5F4DB2]"
          >
            Try again
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {plans.map((plan) => {
          const active = (selected || plans[0]?.code) === plan.code;
          return (
            <button
              key={plan.code}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(plan.code)}
              className={`flex items-center gap-3 rounded-[18px] border-2 px-4 py-3 text-left transition ${active ? "border-[#5F4DB2] bg-[#F7F4FC]" : "border-[#E7E0D4] bg-white hover:border-[#C9C0E4]"}`}
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${active ? "border-[#5F4DB2] bg-[#5F4DB2] text-white" : "border-[#DDD6C7] text-transparent"}`}
              >
                {active ? <Check size={15} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-[#0A1931]">
                  {plan.months === 1 ? "Monthly" : `${plan.months} months`}
                </span>
                <span className="mt-0.5 block text-[12px] text-[#5F6B80]">
                  {money(plan.price_minor / plan.months)} a month
                  {plan.months > 1 ? ` · ${plan.months} months up front` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[16px] font-bold text-[#0A1931]">
                {money(plan.price_minor)}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        {onBack ? (
          <StudentBackButton
            disabled={checkoutState.isLoading}
            onClick={onBack}
          />
        ) : null}
        <PillButton
          disabled={!selectedPlan || checkoutState.isLoading || isLoading}
          onClick={() => void continueToPayment()}
          className="min-w-0 flex-1"
        >
          {checkoutState.isLoading ? (
            "Opening checkout…"
          ) : selectedPlan ? (
            <>
              Continue · {money(selectedPlan.price_minor)}{" "}
              <ArrowRight size={17} />
            </>
          ) : (
            "Select a membership plan"
          )}
        </PillButton>
      </div>

      {payment && selectedPlan ? (
        <SimulatedPaymentDialog
          paymentId={payment.payment_id}
          amountMinor={payment.amount_minor}
          currency={payment.currency}
          title="BharatPath membership"
          checkoutContent={
            <DiscountCodeField
              key={selectedPlan.code}
              tone="student"
              planCode={selectedPlan.code}
              preview={(args) => preview(args).unwrap()}
              onChange={(code) =>
                createCheckout(selectedPlan.code, code ?? undefined)
              }
            />
          }
          onComplete={async () => {
            for (let attempt = 0; attempt < 6; attempt++) {
              const current = await subscription.refetch().unwrap();
              if (current.has_access) return;
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
            throw new Error(
              "Payment was confirmed but membership access could not be refreshed. Please try again.",
            );
          }}
          onClose={() => setPayment(null)}
        />
      ) : null}
    </div>
  );
}
