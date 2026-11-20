"use client";

import { LockKeyhole } from "lucide-react";

import type { Candidate } from "./types";

interface CandidateUnlockDialogProps {
  candidate: Candidate | null;
  credits: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CandidateUnlockDialog({
  candidate,
  credits,
  onCancel,
  onConfirm,
}: CandidateUnlockDialogProps) {
  if (!candidate) {
    return null;
  }

  const balanceAfter = Math.max(0, credits - 1);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(25,32,45,0.42)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-candidate-title"
    >
      {/* Modal */}
      <div className="w-full max-w-[356px] rounded-[12px] bg-white p-6 shadow-[0_20px_50px_rgba(19,26,38,0.18)]">

        {/* Icon */}
        <div className="mb-4 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-[#edf3fb]">
          <LockKeyhole
            size={17}
            strokeWidth={2.2}
            className="text-[#28548a]"
          />
        </div>

        {/* Title */}
        <h2
          id="unlock-candidate-title"
          className="text-[15px] font-semibold leading-[20px] text-[#111827]"
        >
          Unlock this candidate?
        </h2>

        {/* Description */}
        <p className="mt-4 text-[12px] leading-[17px] text-[#647083]">
          This reveals their name, phone, email and exact Bharatpath Score,
          and is logged to your audit trail.
        </p>

        {/* Cost */}
        <div className="mt-4 flex h-[40px] items-center justify-between rounded-[10px] bg-[#f3f5f7] px-3.5">
          <span className="text-[12px] text-[#334155]">
            Cost
          </span>

          <span className="text-[12px] font-bold text-[#111827]">
            1 credit
          </span>
        </div>

        {/* Balance */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-[#758093]">
            Balance after
          </span>

          <span className="text-[11px] font-bold text-[#334155]">
            {balanceAfter} credits
          </span>
        </div>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-2 gap-2">

          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="h-[44px] rounded-[8px] border border-[#e1e5ea] bg-white text-[13px] font-bold text-[#111827] transition hover:bg-[#f7f8fa]"
          >
            Cancel
          </button>

          {/* Confirm */}
          <button
            type="button"
            onClick={onConfirm}
            disabled={credits <= 0}
            className="h-[44px] rounded-[8px] bg-[#5b4fcf] text-[13px] font-bold text-white transition hover:bg-[#5145c3] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirm unlock
          </button>

        </div>
      </div>
    </div>
  );
}