"use client";

import { CircleAlert } from "lucide-react";

import type {
  KybMode,
} from "../types";

interface KybApprovalTabProps {
  kybMode: KybMode;
  isLoading?: boolean;
  hasError?: boolean;
  isSaving?: boolean;
  saveError?: boolean;
  onModeChange: (mode: KybMode) => void;
}

const approvalOptions: Array<{
  key: KybMode;
  label: string;
  description: string;
}> = [
  {
    key: "manual",
    label: "Manual approval",
    description:
      "Currently unavailable. Employers cannot be switched to manual approval.",
  },
  {
    key: "auto",
    label: "Automatic approval",
    description:
      "Employers clear automatically once the enabled verification checks pass. Only exceptions reach the queue.",
  },
];

export function KybApprovalTab({
  kybMode,
  isLoading,
  hasError,
  isSaving,
  saveError,
  onModeChange,
}: KybApprovalTabProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,348px)]">
      {/* ============================================================
          APPROVAL MODE
          ============================================================ */}

      <section className="min-w-0 rounded-[12px] border border-[#e5e8ee] bg-white p-5">
        <h2 className="text-[14px] font-semibold leading-[18px] text-[#172033]">
          Employer KYB approval mode
        </h2>

        <p className="mt-1 max-w-[530px] text-[12px] leading-[17px] text-[#7b8494]">
          Controls whether an employer needs an
          operator decision before becoming fully
          active. Employers can always enter the
          portal after onboarding - this gates
          operational functionality.
        </p>

        {/* Approval options */}

        <div className="mt-4 space-y-2.5">
          {approvalOptions.map((option) => {
            const active =
              !hasError && kybMode === option.key;

            return (
              <button
                key={option.key}
                type="button"
                disabled={Boolean(option.key === "manual" || hasError || isLoading || isSaving || kybMode === option.key)}
                onClick={() => onModeChange(option.key)}
                className={[
                  "flex w-full items-start gap-3 rounded-[12px] border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
                  active
                    ? "border-[#6557e5] bg-[#f7f5ff]"
                    : "border-[#e5e8ee] bg-white hover:bg-[#fafbfc]",
                ].join(" ")}
              >
                {/* Radio */}

                <span
                  className={[
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                    active
                      ? "border-[#6557e5]"
                      : "border-[#d9dee6]",
                  ].join(" ")}
                >
                  {active && (
                    <span className="h-2.5 w-2.5 rounded-full bg-[#6557e5]" />
                  )}
                </span>

                {/* Content */}

                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-semibold text-[#172033]">
                      {option.label}
                    </span>

                    {option.key === "manual" && !active && (
                      <span className="shrink-0 text-[11px] font-medium text-[#7b8494]">
                        Unavailable
                      </span>
                    )}

                    {active && !isLoading && (
                      <span className="shrink-0 rounded-full bg-[#6255d8] px-2.5 py-1 text-[10px] font-bold uppercase text-white">
                        Current
                      </span>
                    )}
                  </span>

                  <span className="mt-1 block max-w-[440px] text-[11px] leading-[17px] text-[#7b8494]">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Warning */}

        <div className="mt-4 flex gap-2.5 rounded-[10px] bg-[#fff5df] p-3.5">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b17a19]" />

          <p className="text-[11px] leading-[17px] text-[#9a6c19]">
            {hasError ? "The effective approval mode is unavailable." : saveError ? "Could not save the approval mode. Try again." : isSaving ? "Saving the approval mode..." : isLoading ? "Reading the current mode..." : kybMode === "auto"
              ? "Automatic approval is live. Spot-check the audit trail weekly."
              : "Manual approval is live. New employer submissions will wait for an operator decision."}
          </p>
        </div>
      </section>

      <section className="min-w-0 rounded-[12px] border border-[#e5e8ee] bg-white p-5">
        <h2 className="text-[14px] font-semibold text-[#172033]">Configuration access</h2>
        <p className="mt-2 text-[12px] leading-[18px] text-[#7b8494]">Changing the mode applies to new KYB submissions. Existing submissions keep their current review state.</p>
      </section>
    </div>
  );
}
