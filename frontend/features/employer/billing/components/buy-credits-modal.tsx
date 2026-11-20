"use client";

import {
  Check,
  X,
} from "lucide-react";

import type { CreditPack } from "@/store/employer/billing/billing.slice";

interface BuyCreditsModalProps {
  open: boolean;
  packs: CreditPack[];
  selectedPackId: string;
  onSelectPack: (id: string) => void;
  onClose: () => void;
  onPay: () => void;
}

function formatPrice(price: number) {
  return `₹${price.toLocaleString("en-IN")}`;
}

export function BuyCreditsModal({
  open,
  packs,
  selectedPackId,
  onSelectPack,
  onClose,
  onPay,
}: BuyCreditsModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-center
        justify-center
        bg-black/45
        px-4
      "
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="buy-credits-title"
        className="
          w-full
          max-w-[600px]
          rounded-[14px]
          bg-white
          p-6
          shadow-[0_20px_60px_rgba(15,23,42,0.18)]
        "
      >
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <h2
            id="buy-credits-title"
            className="
              text-[16px]
              font-[600]
              leading-[22px]
              text-[#111827]
            "
          >
            Buy unlock credits
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="
              grid
              h-[30px]
              w-[30px]
              cursor-pointer
              place-items-center
              rounded-[8px]
              border
              border-[#e5e7eb]
              bg-white
              text-[#64748b]
              transition-colors
              hover:bg-[#f8fafc]
            "
          >
            <X size={16} />
          </button>
        </div>

        {/* PACKS */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {packs.map((pack) => {
            const selected =
              selectedPackId === pack.id;

            return (
              <button
                key={pack.id}
                type="button"
                onClick={() =>
                  onSelectPack(pack.id)
                }
                className={`
                  relative
                  min-h-[134px]
                  cursor-pointer
                  rounded-[10px]
                  border
                  p-4
                  text-left
                  transition-all
                  ${
                    selected
                      ? "border-[2px] border-[#3566b8] bg-[#edf3fc]"
                      : "border-[#e1e5eb] bg-white hover:border-[#cbd5e1]"
                  }
                `}
              >
                {pack.popular && (
                  <span
                    className="
                      absolute
                      left-4
                      top-4
                      text-[10px]
                      font-[700]
                      uppercase
                      tracking-[0.08em]
                      text-[#3566b8]
                    "
                  >
                    Most popular
                  </span>
                )}

                <div
                  className={
                    pack.popular
                      ? "pt-6"
                      : ""
                  }
                >
                  <p
                    className="
                      text-[14px]
                      font-[700]
                      text-[#111827]
                    "
                  >
                    {pack.credits} credits
                  </p>

                  <p
                    className="
                      mt-2
                      text-[20px]
                      font-[700]
                      leading-[24px]
                      text-[#111827]
                    "
                  >
                    {formatPrice(pack.price)}
                  </p>

                  <p
                    className="
                      mt-3
                      text-[11px]
                      font-[400]
                      text-[#777f90]
                    "
                  >
                    ₹{pack.perUnit}/ unlock
                  </p>
                </div>

                {selected && (
                  <span
                    className="
                      absolute
                      right-3
                      top-3
                      grid
                      h-5
                      w-5
                      place-items-center
                      rounded-full
                      bg-[#3566b8]
                      text-white
                    "
                  >
                    <Check size={12} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* PAY BUTTON */}
        <button
          type="button"
          onClick={onPay}
          className="
            mt-4
            h-[43px]
            w-full
            cursor-pointer
            rounded-[7px]
            border-0
            bg-[#5b4fcf]
            text-[14px]
            font-[700]
            text-white
            transition-opacity
            hover:opacity-90
          "
        >
          Pay with UPI
        </button>
      </div>
    </div>
  );
}