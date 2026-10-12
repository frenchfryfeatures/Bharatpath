"use client";

import { History } from "lucide-react";

import type { KybForm, KybReviewEntry } from "@/store/employer/kyb";

import { flagLabel } from "../kyb-form";

const DECISION_LABEL: Record<string, { text: string; tone: string }> = {
  APPROVED: { text: "Approved", tone: "bg-[#e3f4ee] text-[#1f7a63]" },
  MORE_INFO_REQUIRED: {
    text: "Changes requested",
    tone: "bg-[#fff4e0] text-[#9a5b00]",
  },
  REJECTED: { text: "Not approved", tone: "bg-[#fdecee] text-[#b42318]" },
  UNDER_REVIEW: { text: "Under review", tone: "bg-[#eaf1fb] text-[#3566b8]" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

interface KybReviewHistoryProps {
  form?: KybForm;
  reviews: KybReviewEntry[];
  className?: string;
}

/** Past decisions with their reasons, newest first. Reviewer names never appear. */
export function KybReviewHistory({
  form,
  reviews,
  className = "",
}: Readonly<KybReviewHistoryProps>) {
  if (reviews.length === 0) {
    return null;
  }

  const newestFirst = [...reviews].reverse();

  return (
    <section className={className} aria-label="Review history">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8790a0]">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        Review history
      </h3>

      <ol className="space-y-2">
        {newestFirst.map((review) => {
          const label = DECISION_LABEL[review.decision] ?? {
            text: review.decision,
            tone: "bg-[#f0f2f5] text-[#687182]",
          };

          return (
            <li
              key={`${review.reviewedAt}-${review.decision}`}
              className="rounded-xl border border-[#e1e6ee] bg-white p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${label.tone}`}
                >
                  {label.text}
                </span>
                <time
                  dateTime={review.reviewedAt}
                  className="text-[11px] text-[#8790a0]"
                >
                  {formatDate(review.reviewedAt)}
                </time>
              </div>

              {review.reason && (
                <p className="mt-2 text-[13px] leading-5 text-[#303747]">
                  {review.reason}
                </p>
              )}

              {review.flags.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {review.flags.map((flag) => (
                    <li
                      key={flag.field}
                      className="text-xs leading-5 text-[#687386]"
                    >
                      <span className="font-semibold text-[#4f5666]">
                        {flagLabel(form, flag.field)}
                      </span>
                      {flag.note ? ` - ${flag.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
