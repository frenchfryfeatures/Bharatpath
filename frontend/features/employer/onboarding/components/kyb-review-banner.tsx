"use client";

import { AlertTriangle, CheckCircle2, Info, MoveRight } from "lucide-react";

import type { KybForm, KybReviewFlag } from "@/store/employer/kyb";

import { flagLabel } from "../kyb-form";

interface KybReviewBannerProps {
  form: KybForm;
  /** "sent_back": the reviewer reopened this submission. "restarted": a new draft after a rejection. */
  variant: "sent_back" | "restarted";
  reason: string | null;
  /** Everything the reviewer flagged, whether or not it has been fixed yet. */
  flags: readonly KybReviewFlag[];
  /** Codes already corrected in this session. */
  resolved: ReadonlySet<string>;
  disabled?: boolean;
  onJump: (code: string) => void;
}

/** The reviewer's reason and a checklist of what to fix, shown above the form. */
export function KybReviewBanner({
  form,
  variant,
  reason,
  flags,
  resolved,
  disabled,
  onJump,
}: Readonly<KybReviewBannerProps>) {
  const sentBack = variant === "sent_back";
  const open = flags.filter((flag) => !resolved.has(flag.field));

  return (
    <div
      role="region"
      aria-label={sentBack ? "Changes needed" : "Started from your previous submission"}
      className="mb-5 rounded-xl border border-[#f2cf93] bg-[#fffaf0] p-4"
    >
      <div className="flex gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#b26a00]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#7a4a00]">
            {sentBack
              ? reason
                ? `Changes needed: ${reason}`
                : "Changes needed"
              : "Started from your previous submission"}
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-[#7a4a00]">
            {sentBack
              ? "Fix what is listed below, then review and submit again. Your other answers stay as they are."
              : `Your earlier answers and documents are filled in. ${reason ? `The reviewer said: ${reason}` : "Fix what was raised, then submit."}`}
          </p>
        </div>
      </div>

      {flags.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-[#f2cf93] pt-3">
          {flags.map((flag) => {
            const done = resolved.has(flag.field);

            return (
              <li key={flag.field} className="flex items-start gap-2">
                {done ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#1f8a70]"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#b26a00]"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1 text-[13px] leading-5">
                  <span
                    className={`font-semibold ${done ? "text-[#4f5666] line-through decoration-[#9aa3b2]" : "text-[#7a4a00]"}`}
                  >
                    {flagLabel(form, flag.field)}
                  </span>
                  {flag.note && (
                    <span className={done ? "text-[#8790a0]" : "text-[#7a4a00]"}>
                      {" "}- {flag.note}
                    </span>
                  )}
                </div>
                {!done && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onJump(flag.field)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-[#8a5300] transition hover:bg-[#fdebc8] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Fix
                    <MoveRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {flags.length > 0 && (
        <p className="mt-3 text-xs font-medium text-[#8a5300]" aria-live="polite">
          {open.length === 0
            ? "Everything raised has been updated. Review and submit when you are ready."
            : `${open.length} of ${flags.length} still to update.`}
        </p>
      )}
    </div>
  );
}
