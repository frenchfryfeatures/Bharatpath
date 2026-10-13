export const ERROR_FEEDBACK_EVENT = "bharatpath:error-feedback";

export interface ErrorFeedbackDetail {
  id: number;
  message: string;
  portal: "student" | "employer" | "college" | "admin" | "auth";
}

let feedbackId = 0;

export function showErrorFeedback(
  message: string,
  portal: ErrorFeedbackDetail["portal"] = "student",
) {
  const trimmedMessage = message.trim();

  if (typeof window === "undefined" || !trimmedMessage) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ErrorFeedbackDetail>(ERROR_FEEDBACK_EVENT, {
      detail: {
        id: ++feedbackId,
        message: trimmedMessage,
        portal,
      },
    }),
  );
}
