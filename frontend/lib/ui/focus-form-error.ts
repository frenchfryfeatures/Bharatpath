/** Reveal validation errors after React has committed inline messages/step changes. */
export function focusFormError(root?: ParentNode | null, ids?: readonly string[]) {
  requestAnimationFrame(() => {
    const scope = root ?? document;
    const wanted = ids ? new Set(ids) : null;
    const target = Array.from(scope.querySelectorAll<HTMLElement>(
      wanted ? "[id]" : '[aria-invalid="true"], [data-field-invalid="true"]',
    )).find((element) => (!wanted || wanted.has(element.id)) &&
      element.getClientRects().length > 0 && !element.hasAttribute("disabled"));
    if (!target) return;
    const control = target.matches('input, select, textarea, button, [tabindex]')
      ? target
      : target.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')
        ?? target.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]');
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (control) control.focus({ preventScroll: true });
    else {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  });
}
