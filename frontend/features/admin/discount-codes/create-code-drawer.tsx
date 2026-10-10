"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button, DateTimePicker, SelectDropdown } from "@/components/ui";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import { showAdminFeedback } from "@/store/admin";
import {
  type CreateDiscountCodeRequest,
  type DiscountAudience,
  useCreateAdminDiscountCodeMutation,
} from "@/store/api/admin-api";
import { useAppDispatch } from "@/store/hooks";

import {
  FormField,
  INPUT_HEIGHT,
  a11y,
  hasErrors,
  inputClass,
  validateOptionalText,
} from "../shared/form";

const AUDIENCES = [
  { value: "CANDIDATE", label: "Candidate" },
  { value: "EMPLOYER", label: "Employer" },
  { value: "COLLEGE", label: "College" },
];

const KINDS = [
  { value: "percent", label: "Percentage" },
  { value: "amount", label: "Fixed amount" },
];

const DROPDOWN_CLASS = "rounded-lg focus:border-[#315c9f] focus:ring-[#315c9f]/20";

// The characters the backend accepts in a code (`billing.domain`), after upper-casing.
const CODE_PATTERN = /^[A-Z0-9-]+$/;

type Field = "code" | "value" | "usageLimit" | "label" | "validFrom" | "validUntil";

export function CreateCodeDrawer({ onClose }: { onClose: () => void }) {
  useScrollLock(true);
  const dispatch = useAppDispatch();
  const [create, { isLoading }] = useCreateAdminDiscountCodeMutation();
  const [audience, setAudience] = useState<DiscountAudience>("CANDIDATE");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [code, setCode] = useState("");
  const [value, setValue] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [label, setLabel] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});

  const errors = useMemo(() => {
    const found: Partial<Record<Field, string>> = {};

    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode) {
      if (trimmedCode.length < 4 || trimmedCode.length > 32) found.code = "A code is 4 to 32 characters.";
      else if (!CODE_PATTERN.test(trimmedCode)) found.code = "Use letters, numbers and hyphens only.";
    }

    const amount = Number(value);
    if (!value.trim()) {
      found.value = kind === "percent" ? "Enter the percentage off." : "Enter the amount off.";
    } else if (!Number.isFinite(amount)) {
      found.value = "Enter a number.";
    } else if (kind === "percent") {
      if (!Number.isInteger(amount)) found.value = "Use a whole percentage, like 20.";
      else if (amount < 1 || amount > 100) found.value = "A percentage must be between 1 and 100.";
    } else if (amount <= 0) {
      found.value = "The amount must be more than ₹0.";
    } else if (Math.round(amount * 100) / 100 !== amount) {
      found.value = "Use at most two decimal places.";
    }

    if (usageLimit.trim()) {
      const limit = Number(usageLimit);
      if (!Number.isInteger(limit) || limit < 1) found.usageLimit = "Enter a whole number of 1 or more, or leave blank for unlimited.";
    }

    found.label = validateOptionalText(label, 120);

    const from = validFrom ? new Date(validFrom).getTime() : null;
    const until = validUntil ? new Date(validUntil).getTime() : null;
    if (until !== null) {
      if (Number.isNaN(until)) found.validUntil = "Enter a valid date and time.";
      else if (from !== null && !Number.isNaN(from) && until <= from) found.validUntil = "The end must be after the start.";
    }
    if (from !== null && Number.isNaN(from)) found.validFrom = "Enter a valid date and time.";

    return found;
  }, [code, value, kind, usageLimit, label, validFrom, validUntil]);

  const shown = (key: Field) => serverErrors[key] ?? (submitted || touched.has(key) ? errors[key] : undefined);
  const touch = (key: Field) => setTouched((current) => new Set(current).add(key));
  const edited = (key: Field) =>
    setServerErrors((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLoading, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitted(true);

    if (hasErrors(errors)) {
      setError("Fix the highlighted fields to continue.");
      return;
    }
    // Checked here rather than while typing: it depends on the clock.
    if (validUntil && new Date(validUntil).getTime() <= Date.now()) {
      setServerErrors((current) => ({ ...current, validUntil: "The end is already in the past, so no one could use this code." }));
      setError("Fix the highlighted fields to continue.");
      return;
    }

    const amount = Number(value);
    const payload: CreateDiscountCodeRequest = { audience };
    if (code.trim()) payload.code = code.trim().toUpperCase();
    if (label.trim()) payload.label = label.trim();
    if (usageLimit.trim()) payload.usage_limit = Number(usageLimit);
    if (validFrom) payload.valid_from = new Date(validFrom).toISOString();
    if (validUntil) payload.valid_until = new Date(validUntil).toISOString();
    if (kind === "percent") payload.percent_off = amount;
    else payload.amount_off_minor = Math.round(amount * 100);

    try {
      const created = await create(payload).unwrap();
      dispatch(showAdminFeedback(`Discount code ${created.code} created.`));
      onClose();
    } catch (mutationError) {
      const message = getApiErrorMessage(mutationError, "The discount code could not be created.");
      if (getApiErrorCode(mutationError) === "discount_code_taken") {
        setServerErrors((current) => ({ ...current, code: message }));
        return;
      }
      setError(message);
    }
  }

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close"
        disabled={isLoading}
        onClick={onClose}
        className="absolute inset-0 bg-[#172033]/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create discount code"
        className="absolute right-0 top-0 flex h-full w-[480px] max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-bold text-[#172033]">Create discount code</h2>
            <p className="mt-1 text-[12px] text-[#7b8494]">
              A code&apos;s terms can&apos;t be edited afterwards. To change one, disable it and make another.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#7b8494] hover:bg-[#f5f6f8]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div>
              <span className="mb-1.5 block text-[12px] font-semibold text-[#344054]">Audience</span>
              <SelectDropdown
                value={audience}
                onChange={(next) => setAudience(next as DiscountAudience)}
                options={AUDIENCES}
                ariaLabel="Audience"
                className={DROPDOWN_CLASS}
              />
            </div>

            <FormField
              id="discount-code"
              label="Code (optional)"
              error={shown("code")}
              hint="Letters, numbers and hyphens, 4 to 32 characters. Leave blank to generate one."
            >
              <input
                {...a11y("discount-code", shown("code"))}
                value={code}
                onChange={(event) => { setCode(event.target.value); edited("code"); }}
                onBlur={() => touch("code")}
                maxLength={32}
                autoComplete="off"
                placeholder="Auto-generate"
                className={inputClass(Boolean(shown("code")), `${INPUT_HEIGHT} uppercase`)}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="mb-1.5 block text-[12px] font-semibold text-[#344054]">Discount type</span>
                <SelectDropdown
                  value={kind}
                  onChange={(next) => {
                    setKind(next as "percent" | "amount");
                    setValue("");
                    edited("value");
                  }}
                  options={KINDS}
                  ariaLabel="Discount type"
                  className={DROPDOWN_CLASS}
                />
              </div>
              <FormField
                id="discount-value"
                label={kind === "percent" ? "Percent off (1–100)" : "Amount off (₹)"}
                error={shown("value")}
              >
                <input
                  {...a11y("discount-value", shown("value"))}
                  type="number"
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => { setValue(event.target.value); edited("value"); }}
                  onBlur={() => touch("value")}
                  step={kind === "percent" ? 1 : 0.01}
                  placeholder={kind === "percent" ? "e.g. 20" : "e.g. 100"}
                  className={inputClass(Boolean(shown("value")), INPUT_HEIGHT)}
                />
              </FormField>
            </div>

            <FormField id="discount-limit" label="Usage limit (optional)" error={shown("usageLimit")}>
              <input
                {...a11y("discount-limit", shown("usageLimit"))}
                type="number"
                inputMode="numeric"
                value={usageLimit}
                onChange={(event) => { setUsageLimit(event.target.value); edited("usageLimit"); }}
                onBlur={() => touch("usageLimit")}
                placeholder="Unlimited"
                className={inputClass(Boolean(shown("usageLimit")), INPUT_HEIGHT)}
              />
            </FormField>

            <FormField id="discount-label" label="Label (optional)" error={shown("label")}>
              <input
                {...a11y("discount-label", shown("label"))}
                value={label}
                onChange={(event) => { setLabel(event.target.value); edited("label"); }}
                onBlur={() => touch("label")}
                placeholder="e.g. Launch promo"
                className={inputClass(Boolean(shown("label")), INPUT_HEIGHT)}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField id="discount-from" label="Valid from" error={shown("validFrom")}>
                <DateTimePicker
                  id="discount-from"
                  value={validFrom}
                  onChange={(next) => { setValidFrom(next); edited("validFrom"); edited("validUntil"); }}
                  onBlur={() => touch("validFrom")}
                  invalid={Boolean(shown("validFrom"))}
                  ariaDescribedBy={shown("validFrom") ? "discount-from-error" : undefined}
                  className={inputClass(Boolean(shown("validFrom")), INPUT_HEIGHT)}
                />
              </FormField>
              <FormField id="discount-until" label="Valid until" error={shown("validUntil")}>
                <DateTimePicker
                  id="discount-until"
                  value={validUntil}
                  onChange={(next) => { setValidUntil(next); edited("validUntil"); }}
                  onBlur={() => touch("validUntil")}
                  invalid={Boolean(shown("validUntil"))}
                  ariaDescribedBy={shown("validUntil") ? "discount-until-error" : undefined}
                  className={inputClass(Boolean(shown("validUntil")), INPUT_HEIGHT)}
                />
              </FormField>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-[#f1c0c0] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#9f2d2d]"
              >
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex justify-end gap-2 border-t border-[#e5e7eb] p-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" variant="dark" isLoading={isLoading} loadingText="Creating…">
              Create code
            </Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
