export const SUCCESS_FEEDBACK_EVENT = "bharatpath:success-feedback";

export interface SuccessFeedbackDetail {
  id: number;
  message: string;
  kind?: "success" | "error";
}

let feedbackId = 0;

export function showSuccessFeedback(message: string, kind: "success" | "error" = "success") {
  const trimmedMessage = message.trim();

  if (typeof window === "undefined" || !trimmedMessage) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SuccessFeedbackDetail>(SUCCESS_FEEDBACK_EVENT, {
      detail: {
        id: ++feedbackId,
        message: trimmedMessage,
        kind,
      },
    }),
  );
}

/** The same toast, in the error colours. */
export function showErrorFeedback(message: string) {
  showSuccessFeedback(message, "error");
}
