import type { ReactNode } from "react";

/*
 * Shared pieces for admin forms. Validation is ours, not the browser's: forms
 * set `noValidate`, check on submit (and again on each edit once a field has
 * been touched), and show the message under the field. The limits mirror the
 * backend schemas in `app/modules/admin/schemas.py`; the server stays the
 * authority, and `fieldForServerCode` puts its refusals back on the right field.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const BASE_INPUT =
  "w-full rounded-lg border bg-white px-3 text-[13px] text-[#172033] outline-none transition-colors placeholder:text-[#98a0ae]";

export function inputClass(invalid: boolean, extra = "") {
  return `${BASE_INPUT} ${extra} ${
    invalid
      ? "border-[#d92d20] focus:border-[#d92d20]"
      : "border-[#dfe2e8] focus:border-[#315c9f]"
  }`;
}

export const INPUT_HEIGHT = "h-10";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[12px] font-medium text-[#b42318]">
      {message}
    </p>
  );
}

/** Label, control and message. `id` ties the message to the control via `aria-describedby`. */
export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div data-form-field>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold text-[#344054]">
        {label}
      </label>
      {children}
      {error ? <FieldError id={`${id}-error`} message={error} /> : hint ? (
        <p className="mt-1.5 text-[11px] text-[#7b8494]">{hint}</p>
      ) : null}
    </div>
  );
}

/** Props that wire a control to its message. */
export function a11y(id: string, error?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  } as const;
}

// Same shape the backend accepts (`_EMAIL_PATTERN`).
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateEmail(value: string, label = "Email address") {
  const email = value.trim();
  if (!email) return `Enter the ${label.toLowerCase()}.`;
  if (email.length > 320) return "Use 320 characters or fewer.";
  if (!EMAIL.test(email)) return "Enter a valid email address, like name@example.com.";
  return undefined;
}

export function validateName(value: string, label: string) {
  const name = value.split(/\s+/).join(" ").trim();
  if (!name) return `Enter the ${label.toLowerCase()}.`;
  if (name.length < 2) return `The ${label.toLowerCase()} needs at least 2 characters.`;
  if (name.length > 255) return "Use 255 characters or fewer.";
  return undefined;
}

export function validateRequiredText(value: string, label: string, min: number, max: number) {
  const text = value.trim();
  if (!text) return `Enter ${label}.`;
  if (text.length < min) return `Use at least ${min} characters.`;
  if (text.length > max) return `Use ${max} characters or fewer. This is ${text.length}.`;
  return undefined;
}

export function validateOptionalText(value: string, max: number) {
  if (value.trim().length > max) return `Use ${max} characters or fewer. This is ${value.trim().length}.`;
  return undefined;
}

export function hasErrors(errors: object) {
  return Object.values(errors).some(Boolean);
}
