"use client";

import { useState } from "react";

import { Dropdown } from "@/components/ui/dropdown";

import type {
  ConfigurableFormProps,
  FormFieldConfig,
  FormValues,
} from "./configurable-form.types";

const inputClasses =
  "w-full rounded-[10px] border border-[#e1e5ea] bg-white px-4 py-3 text-[14px] font-medium leading-5 text-[#151b2b] outline-none transition placeholder:text-[#7b8493] focus:border-[#2f5da8] focus:ring-2 focus:ring-[#2f5da8]/10 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]";

export function ConfigurableForm<TValues extends FormValues>({
  values,
  fields,
  errors = {},
  onChange,
  onSubmit,
  validate,
  onBlur,
  submitLabel,
  children,
  disabled = false,
  className = "",
}: ConfigurableFormProps<TValues>) {
  const [submitted, setSubmitted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Partial<Record<keyof TValues & string, string>>
  >({});

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const fieldErrors = Object.fromEntries(
      fields
        .map((field) => [
          field.name,
          field.validate?.(values[field.name], values),
        ])
        .filter(([, message]) => Boolean(message)),
    ) as Partial<Record<keyof TValues & string, string>>;

    const nextErrors = {
      ...fieldErrors,
      ...(validate?.(values) ?? {}),
    };

    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className={className} noValidate>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.name}
            className={field.colSpan === 2 ? "sm:col-span-2" : ""}
          >
            <ConfigurableField
              field={field}
              value={values[field.name]}
              error={validationErrors[field.name] ?? errors[field.name]}
              showError={submitted || Boolean(errors[field.name])}
              disabled={disabled}
              onChange={(value) => {
                setValidationErrors((current) => {
                  if (!current[field.name]) return current;
                  const next = { ...current };
                  delete next[field.name];
                  return next;
                });
                onChange(field.name, value);
              }}
              onBlur={() => onBlur?.(field.name)}
            />
          </div>
        ))}
      </div>

      {children}

      {submitLabel ? (
        <button
          type="submit"
          disabled={disabled}
          className="mt-5 rounded-[8px] bg-[#151b2b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#222b3e] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
      ) : null}
    </form>
  );
}

function ConfigurableField<TValues extends FormValues>({
  field,
  value,
  error,
  showError,
  disabled,
  onChange,
  onBlur,
}: {
  field: FormFieldConfig<TValues>;
  value: unknown;
  error?: string;
  showError: boolean;
  disabled: boolean;
  onChange: (value: unknown) => void;
  onBlur: () => void;
}) {
  const inputId = `field-${field.name}`;
  const describedBy = error ? `${inputId}-error` : undefined;

  if (field.render) {
    return (
      <div className={field.className}>
        {field.render({ value, error, setValue: onChange })}
        {showError && error ? (
          <p id={describedBy} className="mt-1.5 text-xs font-medium text-[#b42318]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <label htmlFor={inputId} className={`block ${field.className ?? ""}`}>
      <span className="mb-1.5 block text-[12px] font-semibold leading-4 text-[#687386]">
        {field.label}
        {field.required ? <span className="ml-1 text-[#b42318]">*</span> : null}
      </span>

      {field.description ? (
        <span className="mb-2 block text-xs text-[#7b8493]">
          {field.description}
        </span>
      ) : null}

      {field.type === "textarea" ? (
        <textarea
          id={inputId}
          rows={4}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={showError && Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`${inputClasses} resize-y`}
        />
      ) : field.type === "select" ? (
        <div
          id={inputId}
          aria-invalid={showError && Boolean(error)}
          aria-describedby={describedBy}
          onBlur={onBlur}
        >
          <Dropdown
            value={String(value ?? "")}
            options={field.options ?? []}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            ariaLabel={field.label}
            placeholder={field.placeholder ?? "Select"}
            width="w-full"
            buttonClassName={`h-[46px] rounded-[10px] px-4 text-[14px] font-medium leading-5 ${
              showError && error
                ? "border-[#e02424] focus:border-[#e02424] focus:ring-[#e02424]/10"
                : "border-[#e1e5ea] focus:border-[#2f5da8] focus:ring-[#2f5da8]/10"
            }`}
          />
        </div>
      ) : field.type === "range" ? (
        <div>
          <input
            id={inputId}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number(value ?? field.min ?? 0)}
            disabled={disabled}
            aria-invalid={showError && Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => onChange(Number(event.target.value))}
            onBlur={onBlur}
            className="w-full cursor-pointer accent-[#2f5da8]"
          />
          <div className="mt-1 flex justify-between text-[11px] text-[#7b8493]">
            <span>{field.min}</span>
            <span>{field.max}</span>
          </div>
        </div>
      ) : (
        <input
          id={inputId}
          type={field.type}
          min={field.min}
          max={field.max}
          step={field.step}
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={showError && Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) =>
            onChange(
              field.type === "number"
                ? event.target.value === ""
                  ? ""
                  : Number(event.target.value)
                : event.target.value,
            )
          }
          onBlur={onBlur}
          className={inputClasses}
        />
      )}

      {showError && error ? (
        <p id={describedBy} className="mt-1.5 text-xs font-medium text-[#b42318]">
          {error}
        </p>
      ) : null}
    </label>
  );
}
