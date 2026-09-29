"use client";

import React, { useState } from "react";
import { KeyRound, Ban, Copy, Check } from "lucide-react";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Skeleton } from "@/components/common/loading";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";

import type {
  ReferralCode,
  ReferralCodeState,
} from "@/store/college/referral-codes";
import { InfiniteScrollArea } from "../shared";

export interface ReferralCodesCardProps {
  codes: ReferralCode[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onRevoke: (codeId: string) => Promise<unknown>;
  isRevoking: boolean;
}

const STATE_STYLES: Record<ReferralCodeState, string> = {
  ACTIVE: "bg-[#eaf5ef] text-[#23805d]",
  EXPIRED: "bg-[#f0f2f5] text-[#717a8a]",
  REVOKED: "bg-[#fdf2f2] text-[#e02424]",
  EXHAUSTED: "bg-[#fff5df] text-[#9a6b18]",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StateBadge({ state }: { state: ReferralCodeState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATE_STYLES[state]}`}
    >
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  );
}

export function ReferralCodesCard({
  codes,
  isLoading,
  isError,
  hasMore,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  onRetry,
  onRevoke,
  isRevoking,
}: ReferralCodesCardProps) {
  const [pendingRevoke, setPendingRevoke] = useState<ReferralCode | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (code: ReferralCode) => {
    await navigator.clipboard.writeText(code.code);
    setCopiedId(code.id);
    showSuccessFeedback("Referral code copied successfully.");
    setTimeout(() => setCopiedId(null), 1500);
  };

  const confirmRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await onRevoke(pendingRevoke.id);
    } finally {
      setPendingRevoke(null);
    }
  };

  return (
    <div
      id="referral-codes"
      className="scroll-mt-4 rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-2xs"
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf2fa] text-[#5b4fcf]">
          <KeyRound size={18} strokeWidth={2.2} />
        </div>
        <div>
          <h3 className="text-[16px] font-bold text-[#151b2b] tracking-[-0.01em]">
            Referral codes
          </h3>
          <p className="text-[12px] text-[#777f90]">
            Codes you hand out for students to link themselves
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-14 w-full" radius={12} />
          <Skeleton className="h-14 w-full" radius={12} />
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-xl border border-[#f3d6d6] bg-[#fdf2f2] px-4 py-5 text-center"
        >
          <p className="text-[13px] text-[#9d2d2d]">
            Referral codes could not be loaded.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-[12px] font-semibold text-[#3566b8] hover:underline"
          >
            Retry
          </button>
        </div>
      ) : codes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#dfe2e8] bg-[#fcfdfe] px-4 py-6 text-center text-[13px] text-[#777f90]">
          No referral codes yet. Use “Invite students” to issue one.
        </p>
      ) : (
        <InfiniteScrollArea
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          loadError={loadMoreError}
          onLoadMore={onLoadMore}
          ariaLabel="Referral codes"
        >
          <ul className="space-y-2.5">
            {codes.map((code) => (
              <li
                key={code.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#e7e9ee] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[14px] font-bold tracking-wider text-[#151b2b]">
                      {code.code}
                    </span>
                    <StateBadge state={code.state} />
                  </div>
                  <p className="mt-0.5 text-[12px] text-[#777f90]">
                    {code.uses}
                    {code.maxUses !== null ? ` / ${code.maxUses}` : ""} uses •
                    expires {formatDate(code.expiresAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(code)}
                    aria-label="Copy code"
                    title="Copy code"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[#e2e5eb] bg-white text-[#6c7482] transition-colors hover:bg-[#f8f9fb] hover:text-[#151b2b]"
                  >
                    {copiedId === code.id ? (
                      <Check size={14} strokeWidth={2} />
                    ) : (
                      <Copy size={14} strokeWidth={2} />
                    )}
                  </button>

                  {code.state === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() => setPendingRevoke(code)}
                      aria-label="Revoke code"
                      title="Revoke code"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-[#f3d6d6] bg-white text-[#e02424] transition-colors hover:bg-[#fdf2f2]"
                    >
                      <Ban size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </InfiniteScrollArea>
      )}

      <ConfirmModal
        open={pendingRevoke !== null}
        title="Revoke this code?"
        description="New links through this code stop immediately. Students already linked through it stay linked."
        confirmLabel="Revoke code"
        confirmLoading={isRevoking}
        onClose={() => setPendingRevoke(null)}
        onConfirm={confirmRevoke}
      />
    </div>
  );
}
