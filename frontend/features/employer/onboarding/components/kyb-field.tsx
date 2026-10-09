"use client";

import { Eye } from "lucide-react";

import { AppSelect } from "@/components/ui/app-select";
import type { KybField, KybOption } from "@/store/employer/kyb";

import { inputValue } from "../kyb-form";

export const kybInputClass =
  "h-11 w-full rounded-[10px] border bg-white px-3.5 text-sm text-[#17233a] outline-none transition placeholder:text-[#a0a6b1] focus:ring-2 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]";

export function inputBorder(invalid: boolean): string {
  return invalid
    ? "border-[#e5484d] focus:border-[#e5484d] focus:ring-[#e5484d]/10"
    : "border-[#dfe2e8] focus:border-[#3566b8] focus:ring-[#3566b8]/10";
}

// Match the native inputs: 44px tall, same radius, border and text size.
const selectClass =
  "[&>button]:h-11 [&>button]:rounded-[10px] [&>button]:px-3.5 [&>button>span]:text-sm [&>button>span]:font-normal [&>button>span]:text-[#17233a] [&_[role=option]]:text-[13px]";

const PLACEHOLDERS: Record<string, string> = {
  pan: "ABCDE1234F",
  gstin: "29ABCDE1234F1Z5",
  cin: "U72900KA2020PTC123456",
  tan: "BLRB12345C",
  pincode: "560038",
  website: "https://yourcompany.in",
  work_email: "you@yourcompany.in",
  work_phone: "+91 98765 43210",
};

const AUTOCOMPLETE: Record<string, string> = {
  legal_name: "organization",
  trade_name: "organization",
  website: "url",
  address_line1: "address-line1",
  address_line2: "address-line2",
  city: "address-level2",
  pincode: "postal-code",
  signatory_name: "name",
  signatory_designation: "organization-title",
  work_email: "email",
  work_phone: "tel",
};

interface KybFieldInputProps {
  field: KybField;
  value: unknown;
  error?: string;
  options: KybOption[];
  disabled?: boolean;
  menuPlacement?: "top" | "bottom";
  onChange: (value: unknown) => void;
}

export function isWideField(field: KybField): boolean {
  return (
    field.type === "TEXTAREA" ||
    field.type === "CHECKBOX" ||
    field.type === "MULTISELECT" ||
    ((field.type === "TEXT" || field.type === "EMAIL") &&
      (field.max_length ?? 0) >= 255)
  );
}

export interface RenderFieldLabelOptions {
  showOptional?: boolean;
  optionalText?: string;
  asteriskColor?: string;
}

export function renderFieldLabel(
  label: string,
  required?: boolean,
  options?: RenderFieldLabelOptions,
) {
  const {
    showOptional = false,
    optionalText = "Optional",
    asteriskColor = "text-[#b42318]",
  } = options ?? {};

  const trimmed = label.trim();
  const lastSpaceIndex = trimmed.lastIndexOf(" ");

  if (required) {
    if (lastSpaceIndex !== -1) {
      const mainPart = trimmed.slice(0, lastSpaceIndex);
      const lastWord = trimmed.slice(lastSpaceIndex + 1);
      return (
        <>
          {mainPart}{" "}
          <span>
            {lastWord}
            <span className={`ml-0.5 ${asteriskColor}`} aria-hidden="true">
              *
            </span>
          </span>
        </>
      );
    }
    return (
      <span>
        {trimmed}
        <span className={`ml-0.5 ${asteriskColor}`} aria-hidden="true">
          *
        </span>
      </span>
    );
  }

  if (showOptional) {
    if (lastSpaceIndex !== -1) {
      const mainPart = trimmed.slice(0, lastSpaceIndex);
      const lastWord = trimmed.slice(lastSpaceIndex + 1);
      return (
        <>
          {mainPart}{" "}
          <span>
            {lastWord}
            <span className="ml-1 text-[11px] font-normal text-[#8790a0]">
              {optionalText}
            </span>
          </span>
        </>
      );
    }
    return (
      <span>
        {trimmed}
        <span className="ml-1 text-[11px] font-normal text-[#8790a0]">
          {optionalText}
        </span>
      </span>
    );
  }

  return trimmed;
}


export function KybFieldInput({
  field,
  value,
  error,
  options,
  disabled = false,
  menuPlacement = "bottom",
  onChange,
}: Readonly<KybFieldInputProps>) {
  const id = `kyb-${field.code}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const invalid = Boolean(error);
  const describedBy =
    [field.help_text ? helpId : null, invalid ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  if (field.type === "CHECKBOX") {
    return (
      <div>
        <label
          htmlFor={id}
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
            value === true
              ? "border-[#3566b8] bg-[#f3f7fd]"
              : invalid
                ? "border-[#e5484d] bg-[#fff7f7]"
                : "border-[#dfe2e8] bg-white hover:border-[#c5ccd8]"
          }`}
        >
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#3566b8]"
          />
          <span className="text-sm leading-6 text-[#303747]">
            {renderFieldLabel(field.label, field.required)}
          </span>
        </label>
        <FieldError id={errorId} message={error} />
      </div>
    );
  }

  const selectOptions = options.map((option) => ({
    value: option.code,
    label: option.label,
  }));

  let control: React.ReactNode;

  if (field.type === "SELECT") {
    control = (
      <div
        className={`rounded-[10px] ${invalid ? "ring-1 ring-[#e5484d]" : ""}`}
        aria-describedby={describedBy}
      >
        <AppSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          options={selectOptions}
          placeholder="Select an option"
          ariaLabel={field.label}
          className={selectClass}
          menuPlacement={menuPlacement}
          searchable={selectOptions.length > 8}
          searchPlaceholder={`Search ${field.label.toLowerCase()}`}
        />
      </div>
    );
  } else if (field.type === "MULTISELECT") {
    const selected = Array.isArray(value) ? (value as string[]) : [];

    control = (
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-label`}>
        {selectOptions.map((option) => {
          const checked = selected.includes(option.value);

          return (
            <label
              key={option.value}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                checked
                  ? "border-[#3566b8] bg-[#f3f7fd] text-[#254f96]"
                  : "border-[#dfe2e8] text-[#4f5666] hover:bg-[#f8f9fb]"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              {option.label}
            </label>
          );
        })}
      </div>
    );
  } else if (field.type === "TEXTAREA") {
    const text = typeof value === "string" ? value : "";

    control = (
      <div>
        <textarea
          id={id}
          rows={4}
          value={text}
          maxLength={field.max_length ?? undefined}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={`${kybInputClass} ${inputBorder(invalid)} h-auto resize-y py-3 leading-6`}
        />
        {field.max_length && (
          <p className="mt-1 text-right text-[11px] text-[#8790a0]">
            {text.length} / {field.max_length}
          </p>
        )}
      </div>
    );
  } else {
    const type =
      field.type === "EMAIL"
        ? "email"
        : field.type === "PHONE"
          ? "tel"
          : field.type === "NUMBER"
            ? "number"
            : field.type === "DATE"
              ? "date"
              : "text";

    control = (
      <input
        id={id}
        type={type}
        inputMode={
          field.code === "pincode" ? "numeric" : field.type === "PHONE" ? "tel" : undefined
        }
        autoComplete={AUTOCOMPLETE[field.code]}
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={PLACEHOLDERS[field.code]}
        // Patterned fields are normalised before checking (spaces dropped),
        // so a hard cap here would cut off a correctly grouped value.
        maxLength={field.pattern ? undefined : (field.max_length ?? undefined)}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(inputValue(field, event.target.value))}
        className={`${kybInputClass} ${inputBorder(invalid)}`}
      />
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <label
          id={`${id}-label`}
          htmlFor={field.type === "SELECT" || field.type === "MULTISELECT" ? undefined : id}
          className="text-[13px] font-semibold text-[#303747]"
        >
          {renderFieldLabel(field.label, field.required, { showOptional: true })}
        </label>
        {field.public && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef6f3] px-2 py-0.5 text-[10px] font-semibold text-[#1f7a63]"
            title="Candidates can see this on your job listings"
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            Shown to candidates
          </span>
        )}
      </div>

      {control}

      {field.help_text && (
        <p id={helpId} className="mt-1.5 text-xs leading-5 text-[#7b8493]">
          {field.help_text}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className="mt-1.5 text-xs font-medium text-[#b42318]">
      {message}
    </p>
  );
}
