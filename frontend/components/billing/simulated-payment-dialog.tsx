"use client";

import { Check, LockKeyhole, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { getApiErrorMessage } from "@/lib/api/error-message";
import { useSimulatePaymentMutation } from "@/store/api/payment.api";

type SimulatedPaymentDialogProps = {
  paymentId: string;
  amountMinor: number;
  currency?: string;
  title?: string;
  onComplete: () => unknown | Promise<unknown>;
  onClose: () => void;
  checkoutContent?: ReactNode;
};

const money = (amountMinor: number, currency: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amountMinor / 100);

export function SimulatedPaymentDialog({
  paymentId,
  amountMinor,
  currency = "INR",
  title = "BharatPath payment",
  onComplete,
  onClose,
  checkoutContent,
}: SimulatedPaymentDialogProps) {
  const [stage, setStage] = useState<"ready" | "processing" | "success" | "error">("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [simulate] = useSimulatePaymentMutation();
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (completionTimer.current) clearTimeout(completionTimer.current);
  }, []);

  async function pay() {
    setStage("processing");
    setMessage(null);

    try {
      // Keep the processing state visible briefly so the simulated checkout
      // behaves like a gateway round trip instead of flashing instantly.
      await new Promise((resolve) => setTimeout(resolve, 900));
      const payment = await simulate({ paymentId }).unwrap();
      if (payment.status !== "SUCCEEDED") throw new Error("Payment was not confirmed.");

      setStage("success");
      await onComplete();
      completionTimer.current = setTimeout(onClose, 1900);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "The payment could not be completed. Please try again."));
      setStage("error");
    }
  }

  const canClose = stage !== "processing";

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#071225]/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="simulated-payment-title">
      <div className="relative w-full max-w-[430px] overflow-hidden rounded-[24px] bg-white shadow-2xl">
        {canClose && stage !== "success" ? (
          <button type="button" onClick={onClose} aria-label="Close payment" className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            <X size={18} />
          </button>
        ) : null}

        {stage === "success" ? (
          <div className="flex min-h-[390px] flex-col items-center justify-center px-8 py-12 text-center">
            <div className="payment-success-ring grid h-24 w-24 place-items-center rounded-full bg-[#dcfce7] text-[#16845b]">
              <Check className="payment-success-check" size={50} strokeWidth={3} />
            </div>
            <h2 id="simulated-payment-title" className="mt-7 text-2xl font-bold text-[#0A1931]">Payment successful</h2>
            <p className="mt-2 text-sm text-[#5F6B80]">{money(amountMinor, currency)} paid successfully</p>
            <p className="mt-5 text-xs text-[#8490a3]">Payment ID · {paymentId.slice(0, 8).toUpperCase()}</p>
          </div>
        ) : (
          <div>
            <div className="bg-[#5F4DB2] px-6 pb-7 pt-6 text-white">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/80"><LockKeyhole size={14} /> Secure checkout</div>
              <h2 id="simulated-payment-title" className="mt-5 text-xl font-bold">{title}</h2>
              <p className="mt-2 text-3xl font-bold">{money(amountMinor, currency)}</p>
            </div>
            <div className="p-6">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#64748b]">Payment method</p>
              <div className="mt-3 flex items-center gap-3 rounded-xl border-2 border-[#5F4DB2] bg-[#f8f7ff] p-4">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-sm font-extrabold text-[#5F4DB2] shadow-sm">UPI</span>
                <div><p className="text-sm font-bold text-[#0A1931]">UPI payment</p><p className="mt-0.5 text-xs text-[#64748b]">Instant confirmation</p></div>
                <span className="ml-auto h-4 w-4 rounded-full border-[5px] border-[#5F4DB2]" />
              </div>

              {checkoutContent}

              {message ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{message}</p> : null}

              <button type="button" onClick={() => void pay()} disabled={stage === "processing"} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#16845b] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#116d4b] disabled:cursor-wait disabled:opacity-80">
                {stage === "processing" ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Processing securely…</> : stage === "error" ? "Try payment again" : `Pay ${money(amountMinor, currency)}`}
              </button>
              <p className="mt-4 text-center text-[11px] leading-4 text-[#8490a3]">Development payment simulation · No money will be charged</p>
            </div>
          </div>
        )}
      </div>
      <style jsx global>{`
        @keyframes payment-pop { 0% { transform: scale(.35); opacity: 0 } 70% { transform: scale(1.1); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes payment-check { 0% { stroke-dashoffset: 80 } 100% { stroke-dashoffset: 0 } }
        .payment-success-ring { animation: payment-pop .55s cubic-bezier(.16, 1, .3, 1) both; }
        .payment-success-check { stroke-dasharray: 80; animation: payment-check .5s .3s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .payment-success-ring, .payment-success-check { animation: none; } }
      `}</style>
    </div>
  );
}
