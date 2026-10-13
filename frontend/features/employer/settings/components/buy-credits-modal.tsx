"use client";

import { useState } from "react";
import { showFormError } from "@/lib/feedback/form-error";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  closeCheckoutModal,
  completeCreditPurchase,
  selectEmployerCreditPacks,
  selectSelectedCreditPack,
  setSelectedCreditPack,
} from "@/store/employer/settings";

export function BuyCreditsModal() {
  const dispatch = useAppDispatch();
  const packs = useAppSelector(selectEmployerCreditPacks);
  const selected = useAppSelector(selectSelectedCreditPack);
  const [selectionError, setSelectionError] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/35 p-5">
      <div className="w-full max-w-[650px] rounded-[13px] border border-[#dfe4ea] bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
        <div className="mb-[18px] flex items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-bold">Buy credits</h3>
            <p className="mt-0.5 text-xs leading-4 text-[#718096]">
              Credits never expire and are used when you unlock candidates.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close"
            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[7px] border border-[#dfe4ea] bg-white text-lg"
            onClick={() => dispatch(closeCheckoutModal())}
          >
            ×
          </button>
        </div>

        <div id="credit-pack-options" tabIndex={-1} data-form-invalid={selectionError} className={`grid grid-cols-1 gap-2.5 sm:grid-cols-3 ${selectionError ? "rounded-lg outline outline-1 outline-[#d92d20]" : ""}`}>
          {packs.map((pack) => {
            const isSelected = selected?.id === pack.id;

            return (
              <button
                key={pack.id}
                type="button"
                className={[
                  "relative cursor-pointer rounded-[10px] border bg-white p-[15px] text-left",
                  isSelected
                    ? "border-[#5a4bd1] shadow-[0_0_0_2px_rgba(90,75,209,0.12)]"
                    : "border-[#dfe4ea]",
                ].join(" ")}
                onClick={() => { setSelectionError(false); dispatch(setSelectedCreditPack(pack.id)); }}
              >
                {pack.popular && (
                  <span className="absolute right-2 top-2 rounded-full bg-[#edf1fb] px-1.5 py-1 text-[8px] font-extrabold text-[#3b5596]">
                    POPULAR
                  </span>
                )}

                <strong className="block text-[26px]">{pack.credits}</strong>
                <span className="block text-[11px] text-[#718096]">
                  credits
                </span>

                <b className="mt-2.5 block text-[15px]">
                  ₹{pack.price.toLocaleString("en-IN")}
                </b>

                <small className="mt-0.5 block text-[10px] text-[#718096]">
                  ₹{pack.perUnit}/credit
                </small>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-between border-t border-[#e7eaee] pt-3.5 text-xs">
          <span>{selected?.credits ?? 0} credits</span>
          <strong>
            ₹{(selected?.price ?? 0).toLocaleString("en-IN")}
          </strong>
        </div>

        <div className="mt-[18px] flex justify-end gap-2">
          <button
            type="button"
            className="min-h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033]"
            onClick={() => dispatch(closeCheckoutModal())}
          >
            Cancel
          </button>

          <button
            type="button"
            className="min-h-9 cursor-pointer rounded-lg border border-[#5a4bd1] bg-[#5b4ed0] px-3.5 text-xs font-bold text-white hover:bg-[#4f43bd] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (!selected) {
                setSelectionError(true);
                showFormError("Choose a credit pack.", { portal: "employer", fieldId: "credit-pack-options" });
                return;
              }
              dispatch(completeCreditPurchase());
            }}
          >
            Pay &amp; buy credits
          </button>
        </div>
      </div>
    </div>
  );
}
