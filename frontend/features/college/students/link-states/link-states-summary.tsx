"use client";

import React from "react";
import { Hourglass, Link as LinkIcon, Send } from "lucide-react";

import { Skeleton } from "@/components/common/loading";

const LINK_STATE_SKELETON_STYLES = [
  "border-[#e0f1e7]/60 bg-[#eef7f2]",
  "border-[#dfeaf8]/60 bg-[#edf3fc]",
  "border-[#f9edd8]/60 bg-[#fdf5e8]",
];

export interface LinkStatesSummaryProps {
  linkedCount?: number;
  invitedCount?: number;
  consentPendingCount?: number;
  isLoading?: boolean;
}

export function LinkStatesSummary({
  linkedCount = 3,
  invitedCount = 2,
  consentPendingCount = 2,
  isLoading = false,
}: Readonly<LinkStatesSummaryProps>) {
  return (
    <div
      aria-busy={isLoading}
      className="flex flex-col justify-between rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-2xs"
    >
      <div>
        {/* TITLE & DESCRIPTION */}
        <h3 className="text-[16px] font-bold text-[#151b2b] tracking-[-0.01em]">
          Link states
        </h3>
        <p className="mt-1 text-[13px] text-[#777f90] leading-relaxed">
          Where your imported roster stands right now. Students who joined with a referral code are counted on your dashboard but are not listed here, because they never appear on a roster.
        </p>

        {/* 3 STAT CARDS */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {isLoading ? (
            LINK_STATE_SKELETON_STYLES.map((className, index) => (
              <div
                key={className}
                className={`flex min-h-45.75 flex-col rounded-xl border p-4 ${className}`}
              >
                <div className="flex items-center gap-2">
                  <Skeleton circle width={18} height={18} />
                  <Skeleton width={44} height={26} radius={7} />
                </div>
                <Skeleton
                  className="mt-4"
                  width={index === 2 ? 118 : 68}
                  height={14}
                  radius={6}
                />
                <div className="mt-auto space-y-2 pt-3">
                  <Skeleton width="100%" height={11} radius={6} />
                  <Skeleton width="78%" height={11} radius={6} />
                </div>
              </div>
            ))
          ) : (
            <>
              {/* LINKED */}
              <div className="rounded-xl bg-[#eef7f2] p-4 flex flex-col justify-between border border-[#e0f1e7]/60">
                <div>
                  <div className="flex items-center gap-2">
                    <LinkIcon
                      size={16}
                      strokeWidth={2.4}
                      className="text-[#23805d]"
                    />
                    <span className="text-[26px] font-bold text-[#151b2b] leading-none">
                      {linkedCount}
                    </span>
                  </div>
                  <h4 className="mt-3 text-[14px] font-bold text-[#23805d]">
                    Linked
                  </h4>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-[#5d6673]">
                  Confirmed by the student. Counts towards your cohort.
                </p>
              </div>

              {/* INVITED */}
              <div className="rounded-xl bg-[#edf3fc] p-4 flex flex-col justify-between border border-[#dfeaf8]/60">
                <div>
                  <div className="flex items-center gap-2">
                    <Send
                      size={16}
                      strokeWidth={2.4}
                      className="text-[#3566b8]"
                    />
                    <span className="text-[26px] font-bold text-[#151b2b] leading-none">
                      {invitedCount}
                    </span>
                  </div>
                  <h4 className="mt-3 text-[14px] font-bold text-[#3566b8]">
                    Invited
                  </h4>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-[#5d6673]">
                  Invite sent. Nothing shared until they join.
                </p>
              </div>

              {/* CONSENT PENDING */}
              <div className="rounded-xl bg-[#fdf5e8] p-4 flex flex-col justify-between border border-[#f9edd8]/60">
                <div>
                  <div className="flex items-center gap-2">
                    <Hourglass
                      size={16}
                      strokeWidth={2.4}
                      className="text-[#8c681d]"
                    />
                    <span className="text-[26px] font-bold text-[#151b2b] leading-none">
                      {consentPendingCount}
                    </span>
                  </div>
                  <h4 className="mt-3 text-[14px] font-bold text-[#8c681d]">
                    Consent pending
                  </h4>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-[#5d6673]">
                  Roster link accepted; profile visibility not yet granted.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
