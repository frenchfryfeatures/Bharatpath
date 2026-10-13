import { showErrorFeedback, type ErrorFeedbackDetail } from "./error-feedback";

type Portal = ErrorFeedbackDetail["portal"];

interface FormErrorOptions {
  portal: Portal;
  /** Limit the search to the form or modal that was just submitted. */
  container?: HTMLElement | null;
  /** Use when the invalid control is not marked with aria-invalid. */
  fieldId?: string;
}

/** Announce a validation failure, then reveal its first marked field after React renders. */
export function showFormError(message: string, options: FormErrorOptions) {
  showErrorFeedback(message, options.portal);

  if (!options.container && !options.fieldId) return;
  window.requestAnimationFrame(() => {
    const root = options.container ?? document;
    const field = options.fieldId
      ? document.getElementById(options.fieldId)
      : root.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-invalid="true"]');
    if (!field) return;

    const target = field.closest<HTMLElement>("[data-form-field]") ?? field;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget = field.matches("input, textarea, select, button, [tabindex]")
      ? field
      : field.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]");
    focusTarget?.focus({ preventScroll: true });
  });
}
