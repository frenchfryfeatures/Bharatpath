"use client";

import { useState } from "react";
import { ArrowRight, GraduationCap } from "lucide-react";

import { Button } from "@/components/ui";
import { CollegeErrorState } from "@/features/college/components/college-error-state";
import { AppSelect } from "@/components/ui/app-select";
import { problemCode } from "@/features/employer/onboarding/kyb-form";
import {
  FieldError,
  inputBorder,
  kybInputClass,
  renderFieldLabel,
} from "@/features/employer/onboarding/components/kyb-field";
import { StepCard } from "@/features/employer/onboarding/components/signup-shell";
import { useCreateCollegeOrganisationMutation } from "@/store/college/settings/settings.api";

import { INSTITUTION_TYPES } from "../institution-types";

const selectClass =
  "[&>button]:h-11 [&>button]:rounded-[10px] [&>button]:px-3.5 [&>button>span]:text-sm [&>button>span]:font-normal [&>button>span]:text-[#17233a] [&_[role=option]]:text-[13px]";

interface InstitutionStepProps {
  /** Called once the account owns a college (new or existing). */
  onCreated: () => Promise<void>;
}

export function InstitutionStep({ onCreated }: Readonly<InstitutionStepProps>) {
  const [createCollege, { isLoading }] = useCreateCollegeOrganisationMutation();

  const [name, setName] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [errors, setErrors] = useState<{ name?: string; institutionType?: string }>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [finishing, setFinishing] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    const cleaned = name.split(/\s+/).join(" ").trim();
    const next = {
      name:
        cleaned.length < 2
          ? "Enter your institution's registered name."
          : cleaned.length > 255
            ? "Use 255 characters or fewer."
            : undefined,
      institutionType: institutionType ? undefined : "Choose what kind of institution this is.",
    };
    setErrors(next);
    if (next.name || next.institutionType) return;

    try {
      await createCollege({ name: cleaned, institutionType }).unwrap();
    } catch (error) {
      // Already admin of one (a retried request, another tab): carry on with it.
      if (problemCode(error) !== "identity_already_in_organisation") {
        setServerError(error);
        return;
      }
    }

    setFinishing(true);
    try {
      await onCreated();
    } catch (error) {
      setServerError(error);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <StepCard
      eyebrow="Step 2 · Your institution"
      title="Tell us about your institution"
      description="You become its administrator. You can add placement staff to your team after onboarding."
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError ? (
          <CollegeErrorState
            variant="inline"
            error={serverError}
            fallback="We could not create your institution. Please try again."
          />
        ) : null}

        <div>
          <label
            htmlFor="college-name"
            className="mb-1.5 block text-[13px] font-semibold text-[#303747]"
          >
            {renderFieldLabel("Registered name of the institution", true)}
          </label>
          <div className="relative">
            <GraduationCap
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]"
              aria-hidden="true"
            />
            <input
              id="college-name"
              autoComplete="organization"
              maxLength={255}
              placeholder="e.g. Government Polytechnic, Pune"
              value={name}
              aria-invalid={Boolean(errors.name)}
              aria-describedby="college-name-error"
              onChange={(event) => {
                setName(event.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
              className={`${kybInputClass} ${inputBorder(Boolean(errors.name))} pl-10`}
            />
          </div>
          <FieldError id="college-name-error" message={errors.name} />
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[#303747]">
            {renderFieldLabel("What kind of institution is this?", true)}
          </p>
          <div className={`rounded-[10px] ${errors.institutionType ? "ring-1 ring-[#e5484d]" : ""}`}>
            <AppSelect
              value={institutionType}
              onChange={(value) => {
                setInstitutionType(value);
                setErrors((current) => ({ ...current, institutionType: undefined }));
              }}
              options={INSTITUTION_TYPES}
              placeholder="Select a type"
              ariaLabel="Institution type"
              className={selectClass}
            />
          </div>
          <FieldError id="college-type-error" message={errors.institutionType} />
        </div>

        <div className="flex justify-end border-t border-[#eef1f5] pt-5">
          <Button
            type="submit"
            variant="dark"
            size="lg"
            isLoading={isLoading || finishing}
            loadingText="Creating institution…"
            icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
            iconPosition="right"
          >
            Create institution
          </Button>
        </div>
      </form>
    </StepCard>
  );
}
