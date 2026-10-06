"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import { getApiErrorMessage } from "@/lib/api/error-message";

export interface ErrorStateProps {
  /**
   * The raw error from RTK Query / a thrown request. When provided, a
   * consistent user-facing message is derived from it. Ignored when
   * `message` is passed.
   */
  error?: unknown;
  /** Explicit message, overriding whatever `error` would resolve to. */
  message?: string;
  /** Fallback copy when `error` cannot be mapped to something specific. */
  fallback?: string;
  /** Heading shown above the message in the `block` variant. */
  title?: string;
  /**
   * `inline` — a compact banner for in-context failures (default).
   * `block`  — a compact card with a heading for section load failures.
   */
  variant?: "inline" | "block";
  /** When provided, a "Try again" button is shown. */
  onRetry?: () => void;
  /** Extra call to action shown beside "Try again" in the `block` variant. */
  action?: ReactNode;
  className?: string;
}

/**
 * The single, consistent error surface for the app. Every API failure that is
 * shown to a user should render through this component so the styling, icon,
 * ARIA role and message derivation stay identical everywhere.
 */
export function ErrorState({
  error,
  message,
  fallback,
  title,
  variant = "inline",
  onRetry,
  action,
  className,
}: Readonly<ErrorStateProps>) {
  const text =
    message ?? getApiErrorMessage(error, fallback);

  if (variant === "block") {
    return (
      <div
        role="alert"
        className={[
          "flex items-start gap-3 rounded-xl",
          "border border-[#f2dadd] bg-[#fff9f9] px-4 py-3",
          className ?? "",
        ].join(" ")}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#fcebed] text-[#bc3545]">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          {title && (
            <p className="text-[12px] font-semibold leading-5 text-[#9f2432]">
              {title}
            </p>
          )}

          <p className="break-words text-[12px] leading-5 text-[#91555e]">
            {text}
          </p>

          {(onRetry || action) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="cursor-pointer rounded-md border border-[#efd3d8] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#9f2432] transition-colors hover:bg-[#fdeef0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bc3545]"
                >
                  Try again
                </button>
              )}
              {action}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={[
        "flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-lg border border-[#f2dadd]",
        "bg-[#fff9f9] px-3 py-2 text-[12px] leading-5 text-[#91555e]",
        className ?? "",
      ].join(" ")}
    >
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-[#bc3545]"
        aria-hidden="true"
      />

      <span className="min-w-0 flex-1 break-words">{text}</span>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 cursor-pointer font-semibold underline underline-offset-2 hover:text-[#7f1d2a]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
