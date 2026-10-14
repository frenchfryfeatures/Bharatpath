"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

import {
  SUCCESS_FEEDBACK_EVENT,
  type SuccessFeedbackDetail,
} from "@/lib/feedback/success-feedback";

const DISMISS_AFTER_MS = 4_000;

export function SuccessFeedback() {
  const [feedback, setFeedback] = useState<SuccessFeedbackDetail | null>(null);

  useEffect(() => {
    const handleSuccess = (event: Event) => {
      setFeedback((event as CustomEvent<SuccessFeedbackDetail>).detail);
    };

    window.addEventListener(SUCCESS_FEEDBACK_EVENT, handleSuccess);
    return () => {
      window.removeEventListener(SUCCESS_FEEDBACK_EVENT, handleSuccess);
    };
  }, []);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setFeedback((current) =>
        current?.id === feedback.id ? null : current,
      );
    }, DISMISS_AFTER_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [feedback]);

  if (!feedback) {
    return null;
  }

  const isError = feedback.kind === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      className={`fixed bottom-5 right-5 z-100 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-[13px] shadow-lg ${isError ? "border-[#f0c4c4] bg-[#fdf0f0] text-[#9a2f2f]" : "border-[#b9dfc5] bg-[#eef7f1] text-[#245f3a]"}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 font-semibold">{feedback.message}</span>
      <button
        type="button"
        onClick={() => setFeedback(null)}
        aria-label="Dismiss message"
        className={`grid h-7 w-7 place-items-center rounded-md ${isError ? "hover:bg-[#f7dcdc]" : "hover:bg-[#dceee2]"}`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
