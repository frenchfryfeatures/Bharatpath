"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import { getApiErrorMessage } from "@/lib/api/error-message";

export interface StudentErrorStateProps {
  /** The raw error from RTK Query / a thrown request. Ignored if `message` is set. */
  error?: unknown;
  message?: string;
  /** Copy used when `error` has nothing more specific to say. */
  fallback?: string;
  /** Heading for the `block` variant, e.g. "Jobs unavailable". */
  title?: string;
  /**
   * `block`  - a page or section that failed to load (default).
   * `inline` - a failed action, shown under the button that caused it.
   */
  variant?: "block" | "inline";
  icon?: ReactNode;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}

/**
 * The one error surface for the candidate portal. It uses the candidate
 * palette (cream, navy, violet, the brick red `#993A22`), pill buttons and
 * soft 16–20px radii rather than the employer/admin banner, so a failure
 * reads as part of the same app. Every API failure shown to a candidate
 * should render through it.
 */
export function StudentErrorState({
  error,
  message,
  fallback,
  title,
  variant = "block",
  icon,
  onRetry,
  action,
  className = "",
}: Readonly<StudentErrorStateProps>) {
  const text = message ?? getApiErrorMessage(error, fallback);

  if (variant === "inline") {
    return (
      <div
        role="alert"
        className={`flex items-start gap-2.5 rounded-[16px] border border-[#EBC7BA] bg-[#F8E6E0] px-4 py-3 text-[14px] leading-5 text-[#993A22] ${className}`}
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span>{text}</span>
          {action}
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 cursor-pointer font-semibold underline underline-offset-2 hover:text-[#7A2E1A]"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 rounded-[20px] border border-[#EBC7BA] bg-[#F8E6E0] px-6 py-10 text-center ${className}`}
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-[#993A22]">
        {icon ?? <AlertCircle size={22} aria-hidden="true" />}
      </span>
      {title ? (
        <span className="text-[16px] font-bold tracking-[-0.02em] text-[#993A22]">{title}</span>
      ) : null}
      <span className="max-w-[320px] text-[13px] leading-[19px] text-[#3A4761]">{text}</span>
      {onRetry || action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer rounded-full border border-[#DDD6C7] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0A1931] transition-colors hover:bg-[#F7F4EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
            >
              Try again
            </button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
