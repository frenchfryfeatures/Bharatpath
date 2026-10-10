"use client";

import type { KybForm, KybReviewFlag, KybSection } from "@/store/employer/kyb";

import type { KybAnswers, KybFieldErrors } from "../kyb-form";
import {
  flaggedFrameClass,
  FlagNote,
  isWideField,
  KybFieldInput,
} from "./kyb-field";

interface KybSectionFieldsProps {
  form: KybForm;
  section: KybSection;
  answers: KybAnswers;
  errors: KybFieldErrors;
  /** Fields the reviewer asked to be corrected and that are not yet changed. */
  flags?: ReadonlyMap<string, KybReviewFlag>;
  disabled?: boolean;
  onChange: (code: string, value: unknown) => void;
}

/** Every answerable field of one form section, laid out in a grid. */
export function KybSectionFields({
  form,
  section,
  answers,
  errors,
  flags,
  disabled,
  onChange,
}: Readonly<KybSectionFieldsProps>) {
  const onlyCheckboxes = section.fields.every(
    (field) => field.type === "CHECKBOX",
  );

  return (
    <div
      className={
        onlyCheckboxes
          ? "space-y-3"
          : "grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2"
      }
    >
      {section.fields.map((field) => {
        const flag = flags?.get(field.code);

        return (
          <div
            key={field.code}
            id={`kyb-field-${field.code}`}
            className={[
              isWideField(field) && !onlyCheckboxes ? "sm:col-span-2" : "",
              flag ? flaggedFrameClass : "",
            ].join(" ")}
          >
            <KybFieldInput
              field={field}
              value={answers[field.code]}
              error={errors[field.code]}
              options={
                field.options_source
                  ? (form.options[field.options_source] ?? [])
                  : []
              }
              disabled={disabled}
              onChange={(value) => onChange(field.code, value)}
            />
            {flag && <FlagNote note={flag.note} />}
          </div>
        );
      })}
    </div>
  );
}
