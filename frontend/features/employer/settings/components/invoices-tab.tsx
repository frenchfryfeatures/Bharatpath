"use client";

import {
  useGetEmployerPlansQuery,
  useGetEmployerSubscriptionQuery,
} from "@/store/employer/billing/billing.api";

const rupees = (minor: number) =>
  `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

export function InvoicesTab() {
  const subscription = useGetEmployerSubscriptionQuery();
  const plans = useGetEmployerPlansQuery();
  const data = subscription.data;
  const plan = plans.data?.find((item) => item.code === data?.plan_code);
  const hasPlan = data && data.state !== "NONE" && data.plan_code;

  return (
    <>
      <div className="mb-2.5">
        <h2 className="m-0 text-[13px] font-bold leading-[18px]">Billing history</h2>
      </div>

      <section className="overflow-hidden rounded-xl border border-[#e0e4e9] bg-white shadow-[0_1px_2px_rgba(17,24,39,0.02)]">
        {subscription.isLoading ? (
          <p className="px-[18px] py-6 text-center text-xs text-[#718096]">Loading…</p>
        ) : !hasPlan ? (
          <p className="px-[18px] py-6 text-center text-xs leading-5 text-[#718096]">
            No payments yet. Your plan and its renewal dates will appear here once you subscribe.
          </p>
        ) : (
          <div className="grid gap-1 px-[18px] py-4">
            <strong className="text-xs">
              {plan ? `${plan.months}-month plan` : "Current plan"}
              {plan ? ` · ${rupees(plan.price_minor)}` : ""}
            </strong>
            <small className="text-[10px] text-[#718096]">
              {day(data.current_period_start)} to {day(data.current_period_end)} · {data.state.toLowerCase()}
            </small>
            <small className="text-[10px] text-[#718096]">
              Receipts for individual payments are not listed here yet.
            </small>
          </div>
        )}
      </section>
    </>
  );
}
