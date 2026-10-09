"use client";

import { useGetEmployerSubscriptionQuery } from "@/store/employer/billing/billing.api";

export function PaymentTab() {
  const { data, isLoading } = useGetEmployerSubscriptionQuery();
  const mandate = data?.mandate_state;

  return (
    <section className="max-w-[488px] rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-[0_1px_2px_rgba(17,24,39,0.02)]">
      <div className="mb-3">
        <h2 className="m-0 text-[13px] font-bold leading-[18px]">Payment methods</h2>
      </div>

      {isLoading ? (
        <p className="text-xs text-[#718096]">Loading…</p>
      ) : mandate ? (
        <div className="flex min-h-[59px] items-center gap-2.5 rounded-[10px] bg-[#f2f4f6] px-3">
          <div className="w-[22px] text-[19px] font-bold">₹</div>
          <strong className="flex-1 text-xs">UPI AutoPay</strong>
          <span className="w-fit rounded-full bg-[#e9f6f0] px-2 py-1 text-[10px] font-bold text-[#13875e]">
            {mandate.replace(/_/g, " ").toUpperCase()}
          </span>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[#dfe3e9] bg-[#f8f9fb] px-3 py-4 text-center text-xs leading-5 text-[#718096]">
          No payment method is saved. You pay at checkout each time you subscribe.
        </p>
      )}
    </section>
  );
}
