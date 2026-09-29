export const SUCCESS_FEEDBACK_EVENT = "bharatpath:success-feedback";

export interface SuccessFeedbackDetail {
  id: number;
  message: string;
}

let feedbackId = 0;

export function showSuccessFeedback(message: string) {
  const trimmedMessage = message.trim();

  if (typeof window === "undefined" || !trimmedMessage) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SuccessFeedbackDetail>(SUCCESS_FEEDBACK_EVENT, {
      detail: {
        id: ++feedbackId,
        message: trimmedMessage,
      },
    }),
  );
}
