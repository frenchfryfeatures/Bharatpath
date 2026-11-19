"use client";

import { AppSelect } from "@/components/ui/app-select";
import { Field } from "@/features/student/onboarding/components/ui";
import type { CareerDetails } from "./career-api";

const keys = ["experience_years", "experience_months"] as const;

export function ExperienceFields({ details, errors, onChange, compact = false }: {
  details: CareerDetails;
  errors: Record<string, string>;
  onChange: (key: typeof keys[number], value: number) => void;
  compact?: boolean;
}) {
  return <fieldset className="min-w-0 space-y-2">
    <legend className="text-[16px] font-medium text-[#0A1931]">Total work experience</legend>
    <div className="grid min-w-0 grid-cols-2 gap-3">
      {keys.map((key) => {
        const years = key === "experience_years";
        const id = `career-${key}`;
        return <Field key={key} id={id} label={years ? "Years" : "Months"} error={errors[key]}>
          <AppSelect id={id} value={String(Math.min(years ? 50 : 11, Number(details[key] ?? 0)))}
            ariaLabel={years ? "Total work experience in years" : "Additional months of experience"}
            ariaInvalid={Boolean(errors[key])} ariaDescribedBy={errors[key] ? `${id}-error` : undefined}
            onChange={(value) => onChange(key, Number(value))}
            options={Array.from({length: years ? 51 : 12}, (_, value) => ({
              value: String(value),
              label: years && value === 50 ? "50+ years" : `${value} ${years ? (value === 1 ? "year" : "years") : (value === 1 ? "month" : "months")}`,
            }))}
            searchable={years} variant={compact ? "student-compact" : "student"} menuPlacement="auto" portal
            className={`[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:px-4 [&>button>span]:font-medium ${compact ? "[&>button]:!h-10 [&>button]:!rounded-lg [&>button]:!border [&>button]:!px-3" : ""}`} />
        </Field>;
      })}
    </div>
  </fieldset>;
}
