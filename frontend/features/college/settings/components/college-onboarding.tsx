"use client";

import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { CollegeErrorState } from "@/features/college/components/college-error-state";
import { FormSkeleton } from "@/components/common/loading";
import type {
  OnboardingField,
  OnboardingOption,
} from "@/store/college/types";

import { renderFieldLabel } from "@/features/employer/onboarding/components/kyb-field";
import { useCollegeOnboarding } from "../hooks/use-onboarding";

const inputClass =
  "w-full rounded-[10px] border border-[#e1e5eb] bg-white px-4 py-3 text-[14px] font-medium leading-5 text-[#131A26] outline-none transition placeholder:text-[#64748b] focus:border-[#3566b8] focus:ring-2 focus:ring-[#3566b8]/10";

const errorInputClass =
  "border-[#e02424] focus:border-[#e02424] focus:ring-[#e02424]/10";

/** Turn a server field code into a short, human sentence. */
function describeIssue(code: string): string {
  switch (code) {
    case "required":
      return "This field is required.";
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_phone":
      return "Enter a valid phone number.";
    case "too_long":
      return "This answer is too long.";
    case "pattern":
    case "invalid":
      return "This answer is not in the expected format.";
    case "not_an_option":
      return "Choose one of the listed options.";
    default:
      return "Please check this answer.";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Answers are primitives; render anything non-string as an empty control. */
function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** Map a field's declared type onto an HTML input type. */
function htmlInputType(type: OnboardingField["type"]): string {
  switch (type) {
    case "EMAIL":
      return "email";
    case "PHONE":
      return "tel";
    case "NUMBER":
      return "number";
    case "DATE":
      return "date";
    default:
      return "text";
  }
}

interface FieldProps {
  field: OnboardingField;
  value: unknown;
  options: OnboardingOption[];
  error: string | undefined;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

function Field({
  field,
  value,
  options,
  error,
  disabled,
  onChange,
}: Readonly<FieldProps>) {
  const stringValue = toStringValue(value);
  const controlClass = error ? `${inputClass} ${errorInputClass}` : inputClass;

  if (field.type === "CHECKBOX") {
    return (
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-[2px] h-4 w-4 rounded border-[#e1e5eb] text-[#3566b8] focus:ring-[#3566b8]/30"
        />
        <span className="flex flex-col gap-1">
          <span className="text-[13px] font-medium leading-[17px] text-[#131A26]">
            {renderFieldLabel(field.label, field.required, { asteriskColor: "text-[#e02424]" })}
          </span>
          {field.help_text && (
            <span className="text-[12px] font-normal leading-[16px] text-[#64748b]">
              {field.help_text}
            </span>
          )}
          {error && (
            <span className="text-[12px] font-medium leading-[16px] text-[#e02424]">
              {describeIssue(error)}
            </span>
          )}
        </span>
      </label>
    );
  }

  // A dropdown is a button with its own menu; a <label> around it would
  // forward label clicks to the trigger, so the select row uses a <div>.
  const Wrapper = field.type === "SELECT" ? "div" : "label";

  return (
    <Wrapper className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
        {renderFieldLabel(field.label, field.required, { asteriskColor: "text-[#e02424]" })}
      </span>

      {field.type === "TEXTAREA" ? (
        <textarea
          value={stringValue}
          disabled={disabled}
          rows={3}
          aria-label={field.label}
          maxLength={field.max_length ?? undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`${controlClass} resize-y`}
        />
      ) : field.type === "SELECT" ? (
        <Dropdown
          value={stringValue}
          options={[
            { value: "", label: "Select…" },
            ...options.map((option) => ({
              value: option.code,
              label: option.label,
            })),
          ]}
          onChange={(next) => onChange(next)}
          disabled={disabled}
          ariaLabel={field.label}
          placeholder="Select…"
          width="w-full"
          buttonClassName={`h-[46px] rounded-[10px] px-4 text-[14px] font-medium leading-5 text-[#131A26] ${
            error
              ? "border-[#e02424] focus:border-[#e02424] focus:ring-[#e02424]/10"
              : "border-[#e1e5eb] focus:border-[#3566b8] focus:ring-[#3566b8]/10"
          }`}
        />
      ) : (
        <input
          type={htmlInputType(field.type)}
          value={stringValue}
          disabled={disabled}
          aria-label={field.label}
          maxLength={field.max_length ?? undefined}
          onChange={(event) => onChange(event.target.value)}
          className={controlClass}
        />
      )}

      {field.help_text && (
        <span className="text-[12px] font-normal leading-[16px] text-[#64748b]">
          {field.help_text}
        </span>
      )}
      {error && (
        <span className="text-[12px] font-medium leading-[16px] text-[#e02424]">
          {describeIssue(error)}
        </span>
      )}
    </Wrapper>
  );
}

export function CollegeOnboarding() {
  const {
    form,
    options,
    answers,
    setAnswer,
    isLoading,
    isError,
    submittedAt,
    fieldErrors,
    formError,
    savedAt,
    saveDraft,
    isSaving,
    submit,
    isSubmitting,
  } = useCollegeOnboarding();

  if (isLoading) {
    return (
      <div className="w-full max-w-[640px]">
        <FormSkeleton />
      </div>
    );
  }

  if (isError || !form) {
    return (
      <div className="w-full max-w-[640px]">
        <CollegeErrorState
          variant="block"
          title="Could not load the onboarding form"
          message="Please refresh and try again."
        />
      </div>
    );
  }

  const isSubmitted = submittedAt !== null;

  return (
    <section
      className="flex w-full max-w-[640px] flex-col gap-5"
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {isSubmitted && (
        <div className="flex items-start gap-3 rounded-[12px] border border-[#bfe3d2] bg-[#eefaf3] p-4">
          <CheckCircle2 className="mt-[1px] h-5 w-5 shrink-0 text-[#23805d]" />
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
              Onboarding submitted
            </p>
            <p className="text-[12px] font-normal leading-[17px] text-[#64748b]">
              Submitted on {formatDate(submittedAt)}. Your details are under
              review; they can no longer be edited here.
            </p>
          </div>
        </div>
      )}

      {form.sections.map((section) => (
        <div
          key={section.code}
          className="flex flex-col gap-4 rounded-[12px] border border-[#e1e5eb] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.024)]"
        >
          <div className="flex flex-col gap-[2px]">
            <h2 className="text-[14px] font-semibold leading-[18px] text-[#131A26]">
              {section.title}
            </h2>
            {section.help_text && (
              <p className="text-[12px] font-normal leading-[17px] text-[#64748b]">
                {section.help_text}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {section.fields.map((field) => (
              <Field
                key={field.code}
                field={field}
                value={answers[field.code]}
                options={
                  field.options_source
                    ? (options[field.options_source] ?? [])
                    : []
                }
                error={fieldErrors[field.code]}
                disabled={isSubmitted}
                onChange={(value) => setAnswer(field.code, value)}
              />
            ))}
          </div>
        </div>
      ))}

      {!isSubmitted && (
        <div className="flex flex-col gap-3">
          {formError && (
            <CollegeErrorState variant="inline" message={formError} />
          )}
          {savedAt !== null && !formError && (
            <p className="text-[13px] font-medium leading-[17px] text-[#23805d]">
              Draft saved.
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="md"
              isLoading={isSaving}
              loadingText="Saving…"
              onClick={saveDraft}
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              loadingText="Submitting…"
              onClick={submit}
            >
              Submit for review
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
