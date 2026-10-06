"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Dropdown } from "@/components/ui/dropdown";

/*
 * The composer's building blocks, in the employer portal's existing form
 * styling: 12px semibold labels, 10px-radius inputs, red asterisks and
 * errors. Nothing here knows about jobs.
 */

export const inputClasses =
  "w-full rounded-[10px] border border-[#e1e5ea] bg-white px-4 py-3 text-[14px] font-medium leading-5 text-[#151b2b] outline-none transition placeholder:text-[#7b8493] focus:border-[#2f5da8] focus:ring-2 focus:ring-[#2f5da8]/10 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]";

const invalidClasses = "border-[#e02424] focus:border-[#e02424] focus:ring-[#e02424]/10";

export function SectionCard({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`${number === 1 ? "" : "mt-5 "}rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)] sm:p-6`}
    >
      <SectionTitle>
        {number}. {title}
      </SectionTitle>
      {description ? (
        <p className="-mt-2 mb-4 text-xs leading-[17px] text-[#7b8493]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.06em] text-[#687386]">
      {children}
    </h2>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</div>;
}

export function Field({
  label,
  required = false,
  hint,
  reserveHintSpace = false,
  error,
  trailing,
  wide = false,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  reserveHintSpace?: boolean;
  error?: string;
  trailing?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <span className="mb-1.5 flex items-center justify-between text-[12px] font-semibold leading-4 text-[#687386]">
        <span>
          {label}
          {required ? <span className="ml-1 text-[#b42318]">*</span> : null}
        </span>
        {trailing}
      </span>
      {hint ? (
        <span className="mb-2 block text-xs text-[#7b8493]">{hint}</span>
      ) : reserveHintSpace ? (
        <span aria-hidden="true" className="mb-2 hidden text-xs sm:block">&nbsp;</span>
      ) : null}
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs font-medium text-[#b42318]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  type = "text",
  maxLength = 200,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  type?: "text" | "email" | "url" | "date";
  maxLength?: number;
  ariaLabel?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      className={`${inputClasses} ${invalid ? invalidClasses : ""}`}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  min = 0,
  max,
  step,
  ariaLabel,
}: {
  value: number | "" | null;
  onChange: (value: number | "") => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) =>
        onChange(event.target.value === "" ? "" : Number(event.target.value))
      }
      className={`${inputClasses} ${invalid ? invalidClasses : ""}`}
    />
  );
}

export function SelectInput<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled,
  invalid,
  ariaLabel,
}: {
  value: T | "";
  options: Array<{ value: T | ""; label: string }>;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel: string;
}) {
  return (
    <Dropdown
      value={value as string}
      options={options as Array<{ value: string; label: string }>}
      onChange={(next) => onChange(next as T)}
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      width="w-full"
      buttonClassName={`h-[46px] rounded-[10px] px-4 text-[14px] font-medium leading-5 ${
        invalid
          ? invalidClasses
          : "border-[#e1e5ea] focus:border-[#2f5da8] focus:ring-[#2f5da8]/10"
      }`}
    />
  );
}

/** A textarea where each line is one item of a list. */
export function LinesInput({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  rows = 4,
  ariaLabel,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  rows?: number;
  ariaLabel?: string;
}) {
  return (
    <textarea
      rows={rows}
      value={value.join("\n")}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value.split("\n"))}
      className={`${inputClasses} resize-y ${invalid ? invalidClasses : ""}`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  rows = 5,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  rows?: number;
  ariaLabel?: string;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      maxLength={20_000}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      className={`${inputClasses} resize-y ${invalid ? invalidClasses : ""}`}
    />
  );
}

/** Free-typed chips: type, then Enter or comma, to add one. */
export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
  disabled,
  max = 50,
  maxLength = 80,
  ariaLabel,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  max?: number;
  maxLength?: number;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const next = draft.trim().replace(/,$/, "").trim();
    if (
      !next ||
      value.length >= max ||
      value.some((item) => item.toLocaleLowerCase() === next.toLocaleLowerCase())
    ) {
      setDraft("");
      return;
    }
    onChange([...value, next.slice(0, maxLength)]);
    setDraft("");
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          maxLength={maxLength}
          disabled={disabled || value.length >= max}
          aria-label={ariaLabel}
          placeholder={value.length >= max ? `Maximum ${max} added` : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
          className={inputClasses}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !draft.trim()}
          aria-label={`Add to ${ariaLabel}`}
          className="grid w-12 shrink-0 cursor-pointer place-items-center rounded-[10px] border border-[#e1e5ea] bg-white text-[#151b2b] transition hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {value.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#edf2fa] px-3 py-2 text-xs font-semibold text-[#28578f] ring-1 ring-[#2f5da8]/20"
            >
              {item}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((other) => other !== item))}
                  aria-label={`Remove ${item}`}
                  className="cursor-pointer rounded-full text-[#687386] hover:text-[#b42318]"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A yes/no setting drawn as a checkbox row. */
export function CheckboxRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[#e1e5ea] bg-white px-4 py-3 transition hover:bg-[#f7f8fa] has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-[#f7f8fa]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#2f5da8] disabled:cursor-not-allowed"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold leading-5 text-[#151b2b]">
          {label}
        </span>
        {hint ? (
          <span className="text-xs leading-[17px] text-[#7b8493]">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Two to four mutually exclusive choices as segmented buttons. */
export function ChoiceGroup<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`cursor-pointer rounded-[8px] border px-4 py-2.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-[#151b2b] bg-[#151b2b] text-white"
                : "border-[#e1e5ea] bg-white text-[#283247] hover:bg-[#f7f8fa]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
