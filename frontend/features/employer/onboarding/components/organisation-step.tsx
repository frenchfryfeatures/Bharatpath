"use client";

import { useState } from "react";
import { ArrowRight, Building2 } from "lucide-react";

import { Button, ErrorState } from "@/components/ui";
import { AppSelect } from "@/components/ui/app-select";
import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  useCreateEmployerOrganisationMutation,
  useGetEmployerReferenceQuery,
} from "@/store/employer/settings";

import { problemCode } from "../kyb-form";
import { FieldError, inputBorder, kybInputClass } from "./kyb-field";
import { StepCard } from "./signup-shell";

const selectClass =
  "[&>button]:h-11 [&>button]:rounded-[10px] [&>button]:px-3.5 [&>button>span]:text-sm [&>button>span]:font-normal [&>button>span]:text-[#17233a] [&_[role=option]]:text-[13px]";

interface OrganisationValues {
  legalName: string;
  businessType: string;
  industry: string;
}

type OrganisationErrors = Partial<Record<keyof OrganisationValues, string>>;

function validate(values: OrganisationValues): OrganisationErrors {
  const errors: OrganisationErrors = {};
  const name = values.legalName.split(/\s+/).join(" ").trim();

  if (name.length < 2) {
    errors.legalName = "Enter your organisation's registered name.";
  } else if (name.length > 255) {
    errors.legalName = "Use 255 characters or fewer.";
  }

  if (!values.businessType) {
    errors.businessType = "Choose what kind of organisation this is.";
  }

  if (!values.industry) {
    errors.industry = "Choose your sector.";
  }

  return errors;
}

interface OrganisationStepProps {
  /** Called once the account owns an organisation (new or existing). */
  onCreated: () => Promise<void>;
}

export function OrganisationStep({ onCreated }: Readonly<OrganisationStepProps>) {
  const reference = useGetEmployerReferenceQuery();
  const [createOrganisation, { isLoading }] = useCreateEmployerOrganisationMutation();

  const [values, setValues] = useState<OrganisationValues>({
    legalName: "",
    businessType: "",
    industry: "",
  });
  const [errors, setErrors] = useState<OrganisationErrors>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [finishing, setFinishing] = useState(false);

  const set = (field: keyof OrganisationValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      await createOrganisation({
        legalName: values.legalName.trim(),
        businessType: values.businessType,
        industry: values.industry,
      }).unwrap();
    } catch (error) {
      // Already owns one (a retried request, another tab): carry on with it.
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

  const typeOptions = (reference.data?.employer_types ?? []).map((item) => ({
    value: item.code,
    label: item.label,
  }));
  const industryOptions = (reference.data?.industries ?? []).map((item) => ({
    value: item.code,
    label: item.label,
  }));

  return (
    <StepCard
      eyebrow="Step 2 · Your organisation"
      title="Tell us about your organisation"
      description="You become its owner. You can invite recruiters and colleagues after verification."
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError ? (
          <ErrorState
            error={serverError}
            fallback="We could not create your organisation. Please try again."
            message={
              serverError instanceof Error ? serverError.message : undefined
            }
          />
        ) : null}

        {reference.isError && (
          <ErrorState
            message={getApiErrorMessage(
              reference.error,
              "We could not load the organisation types.",
            )}
            onRetry={() => void reference.refetch()}
          />
        )}

        <div>
          <label
            htmlFor="org-legal-name"
            className="mb-1.5 block text-[13px] font-semibold text-[#303747]"
          >
            Registered name of the organisation
            <span className="ml-1 text-[#b42318]" aria-hidden="true">
              *
            </span>
          </label>
          <div className="relative">
            <Building2
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]"
              aria-hidden="true"
            />
            <input
              id="org-legal-name"
              autoComplete="organization"
              maxLength={255}
              placeholder="e.g. Brightline Technologies Private Limited"
              value={values.legalName}
              aria-invalid={Boolean(errors.legalName)}
              aria-describedby="org-legal-name-help org-legal-name-error"
              onChange={(event) => set("legalName")(event.target.value)}
              className={`${kybInputClass} ${inputBorder(Boolean(errors.legalName))} pl-10`}
            />
          </div>
          <p id="org-legal-name-help" className="mt-1.5 text-xs text-[#7b8493]">
            Exactly as it appears on your PAN or registration certificate.
          </p>
          <FieldError id="org-legal-name-error" message={errors.legalName} />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-[#303747]">
              What kind of organisation is this?
              <span className="ml-1 text-[#b42318]" aria-hidden="true">
                *
              </span>
            </p>
            <div className={`rounded-[10px] ${errors.businessType ? "ring-1 ring-[#e5484d]" : ""}`}>
              <AppSelect
                value={values.businessType}
                onChange={set("businessType")}
                options={typeOptions}
                placeholder={reference.isLoading ? "Loading…" : "Select a type"}
                ariaLabel="Organisation type"
                className={selectClass}
              />
            </div>
            <FieldError id="org-type-error" message={errors.businessType} />
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-[#303747]">
              Which sector do you work in?
              <span className="ml-1 text-[#b42318]" aria-hidden="true">
                *
              </span>
            </p>
            <div className={`rounded-[10px] ${errors.industry ? "ring-1 ring-[#e5484d]" : ""}`}>
              <AppSelect
                value={values.industry}
                onChange={set("industry")}
                options={industryOptions}
                placeholder={reference.isLoading ? "Loading…" : "Select a sector"}
                ariaLabel="Industry"
                className={selectClass}
                searchable
                searchPlaceholder="Search sectors"
              />
            </div>
            <FieldError id="org-industry-error" message={errors.industry} />
          </div>
        </div>

        <div className="flex justify-end border-t border-[#eef1f5] pt-5">
          <Button
            type="submit"
            variant="dark"
            size="lg"
            isLoading={isLoading || finishing}
            loadingText="Creating organisation…"
            icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
            iconPosition="right"
          >
            Create organisation
          </Button>
        </div>
      </form>
    </StepCard>
  );
}
