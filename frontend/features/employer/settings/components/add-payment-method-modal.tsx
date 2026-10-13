"use client";

import { useState } from "react";
import { showFormError } from "@/lib/feedback/form-error";
import { useAppDispatch } from "@/store/hooks";
import {
  addPaymentMethod,
  closePaymentModal,
} from "@/store/employer/settings";

const inputClass =
  "min-h-[43px] w-full rounded-[9px] border border-[#dfe4ea] bg-white px-3.5 text-[13px] text-[#111827] outline-none transition focus:border-[#526cc8] focus:ring-4 focus:ring-[#526cc8]/10";

export function AddPaymentMethodModal() {
  const dispatch = useAppDispatch();
  const [upiId, setUpiId] = useState("");
  const [upiError, setUpiError] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!upiId.trim()) {
      setUpiError("Enter a UPI ID.");
      showFormError("Check the highlighted UPI ID.", { portal: "employer", container: event.currentTarget });
      return;
    }
    setUpiError("");
    dispatch(addPaymentMethod({ upiId }));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/35 p-5">
      <form
        className="w-full max-w-[440px] rounded-[13px] border border-[#dfe4ea] bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]"
        onSubmit={submit}
      >
        <div className="mb-[18px] flex items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-bold">
              Add payment method
            </h3>
            <p className="mt-0.5 text-xs leading-4 text-[#718096]">
              Add a UPI ID for future credit purchases.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close"
            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[7px] border border-[#dfe4ea] bg-white text-lg"
            onClick={() => dispatch(closePaymentModal())}
          >
            ×
          </button>
        </div>

        <label className="mb-3 flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold leading-[15px] text-[#526074]">
            UPI ID
          </span>

          <input
            id="payment-upi-id"
            autoFocus
            placeholder="yourname@upi"
            value={upiId}
            aria-invalid={Boolean(upiError)}
            aria-describedby={upiError ? "payment-upi-error" : undefined}
            onChange={(event) => { setUpiId(event.target.value); setUpiError(""); }}
            className={`${inputClass} ${upiError ? "!border-[#d92d20]" : ""}`}
          />
          {upiError && <span id="payment-upi-error" className="text-xs text-[#c0392b]">{upiError}</span>}
        </label>

        <div className="mt-[18px] flex justify-end gap-2">
          <button
            type="button"
            className="min-h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033]"
            onClick={() => dispatch(closePaymentModal())}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="min-h-9 cursor-pointer rounded-lg border border-[#5a4bd1] bg-[#5b4ed0] px-3.5 text-xs font-bold text-white hover:bg-[#4f43bd]"
          >
            Add payment method
          </button>
        </div>
      </form>
    </div>
  );
}
