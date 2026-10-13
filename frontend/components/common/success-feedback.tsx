"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

import {
  ERROR_FEEDBACK_EVENT,
  type ErrorFeedbackDetail,
} from "@/lib/feedback/error-feedback";

import {
  SUCCESS_FEEDBACK_EVENT,
  type SuccessFeedbackDetail,
} from "@/lib/feedback/success-feedback";

const DISMISS_AFTER_MS = 4_000;

type Feedback = (SuccessFeedbackDetail | ErrorFeedbackDetail) & {
  kind: "success" | "error";
};

const ERROR_STYLES: Record<ErrorFeedbackDetail["portal"], string> = {
  student: "border-[#EBC7BA] bg-[#F8E6E0] text-[#993A22]",
  employer: "border-[#f3c7c4] bg-[#fff3f2] text-[#9d3030]",
  college: "border-[#f0d2bd] bg-[#fff6ee] text-[#974b22]",
  admin: "border-[#f5c6c6] bg-[#fff2f2] text-[#a5242e]",
  auth: "border-[#f3c7c4] bg-[#fff3f2] text-[#9d3030]",
};

export function SuccessFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const handleSuccess = (event: Event) => {
      setFeedback({ ...(event as CustomEvent<SuccessFeedbackDetail>).detail, kind: "success" });
    };
    const handleError = (event: Event) => {
      setFeedback({ ...(event as CustomEvent<ErrorFeedbackDetail>).detail, kind: "error" });
    };

    window.addEventListener(SUCCESS_FEEDBACK_EVENT, handleSuccess);
    window.addEventListener(ERROR_FEEDBACK_EVENT, handleError);
    return () => {
      window.removeEventListener(SUCCESS_FEEDBACK_EVENT, handleSuccess);
      window.removeEventListener(ERROR_FEEDBACK_EVENT, handleError);
    };
  }, []);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setFeedback((current) =>
        current?.id === feedback.id && current.kind === feedback.kind ? null : current,
      );
    }, DISMISS_AFTER_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [feedback]);

  if (!feedback) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-5 right-5 z-100 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-[13px] shadow-lg ${feedback.kind === "error" ? ERROR_STYLES[(feedback as ErrorFeedbackDetail).portal] : "border-[#b9dfc5] bg-[#eef7f1] text-[#245f3a]"}`}
      role={feedback.kind === "error" ? "alert" : "status"}
      aria-live={feedback.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {feedback.kind === "error" ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 font-semibold">{feedback.message}</span>
      <button
        type="button"
        onClick={() => setFeedback(null)}
        aria-label="Dismiss message"
        className={`grid h-7 w-7 place-items-center rounded-md ${feedback.kind === "error" ? "hover:bg-[#f1d6cc]" : "hover:bg-[#dceee2]"}`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
