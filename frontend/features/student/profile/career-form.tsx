"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mail, Phone, User } from "lucide-react";
import { OnboardingBackButton } from "@/components/common/onboarding-back-button";
import { AppSelect } from "@/components/ui/app-select";
import {
  useGetStudentProfileQuery,
  useUpdateStudentNameMutation,
} from "@/store/student";
import { useAppSelector } from "@/store/hooks";
import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  Field,
  fieldClass,
  fieldBorder,
  PillButton,
  StepHeader,
} from "@/features/student/onboarding/components/ui";
import {
  careerFieldRequired,
  visibleCareerField,
  useGetCareerIdentityQuery,
  useGetCareerFieldsQuery,
  useGetCareerProfileQuery,
  usePrefillCareerProfileMutation,
  useSaveCareerProfileMutation,
  usePreviewSignupResumeMutation,
  useIntakeCareerResumeMutation,
  type CareerDetails,
  type CareerProfile,
} from "./career-api";

const sections = [
  { key: "basic", title: "Basic details" },
  { key: "employment", title: "Employment details" },
  { key: "education", title: "Education details" },
  { key: "preferences", title: "Headline and preferences" },
] as const;

export function CareerForm({
  resumeVersionId,
  resumeFilename,
  onDone,
  onBack,
  editing = false,
  initialSection = 0,
  onSectionChange,
}: {
  resumeVersionId?: string;
  resumeFilename?: string;
  onDone: (profile: CareerProfile) => void;
  onBack: () => void;
  editing?: boolean;
  initialSection?: number;
  onSectionChange?: (section: number) => void;
}) {
  const fields = useGetCareerFieldsQuery();
  const identity = useGetStudentProfileQuery();
  const email = useAppSelector((state) => state.auth.user?.email ?? "");
  const account = useGetCareerIdentityQuery();
  const [saveName] = useUpdateStudentNameMutation();
  const [editedName, setFullName] = useState<string | null>(null);
  const fullName = editedName ?? identity.data?.fullName ?? "";
  const saved = useGetCareerProfileQuery();
  const [prefill, prefillState] = usePrefillCareerProfileMutation();
  const prefillRequest = useRef<{
    id: string;
    promise: Promise<CareerProfile>;
  } | null>(null);
  const [save, saveState] = useSaveCareerProfileMutation();
  const [previewSelectedResume, selectedPreviewState] =
    usePreviewSignupResumeMutation();
  const [intakeSelectedResume, selectedIntakeState] =
    useIntakeCareerResumeMutation();
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [selectedFilename, setSelectedFilename] = useState<string>();
  const [editedDraft, setDraft] = useState<CareerDetails | null>(null);
  const draft = editedDraft ?? saved.data?.details ?? null;
  const [step, setStep] = useState(initialSection);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [listText, setListText] = useState<Record<string, string>>({});
  useEffect(() => {
    onSectionChange?.(step);
  }, [step, onSectionChange]);

  useEffect(() => {
    if (!saved.data || editedDraft) return;
    let cancelled = false;
    if (
      !editing &&
      resumeVersionId &&
      saved.data.resume_version_id !== resumeVersionId
    ) {
      if (prefillRequest.current?.id !== resumeVersionId)
        prefillRequest.current = {
          id: resumeVersionId,
          promise: prefill(resumeVersionId).unwrap(),
        };
      prefillRequest.current.promise
        .then((result) => {
          if (!cancelled) setDraft(result.details);
        })
        .catch((failure) => {
          if (!cancelled) {
            setDraft(saved.data!.details);
            setError(
              getApiErrorMessage(
                failure,
                "Resume prefill could not finish. Enter or correct your details below.",
              ),
            );
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [saved.data, resumeVersionId, editing, prefill, editedDraft]);

  if (fields.isError || saved.isError)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-white p-6"
      >
        <p>
          Profile details could not be loaded. The updated backend must be
          available.
        </p>
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => {
            void fields.refetch();
            void saved.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  if (!draft || !fields.data || prefillState.isLoading)
    return (
      <p className="py-8 text-[#5F6B80]">
        {prefillState.isLoading
          ? "Reading your resume to prefill your profile. No scoring is taking place."
          : "Loading profile details…"}
      </p>
    );
  const section = sections[step];
  const activeFields = fields.data.filter(
    (field) =>
      field.key !== "job_role" &&
      field.section === section.key && visibleCareerField(field, draft),
  );
  const busy =
    saveState.isLoading ||
    selectedPreviewState.isLoading ||
    selectedIntakeState.isLoading;
  const update = (key: string, value: CareerDetails[string]) => {
    setDraft((current) => {
      const next = { ...(current ?? draft), [key]: value };
      if (key === "work_status" && value === "FRESHER")
        Object.assign(next, {
          experience_years: 0,
          experience_months: 0,
          currently_employed: "NO",
          company_name: "",
          job_title: "",
          employment_start: "",
          employment_end: "",
          annual_salary: null,
          notice_period: "NOT_WORKING",
        });
      if (key === "currently_employed" && value === "YES")
        next.employment_end = "";
      if (key === "currently_employed" && value === "NO")
        next.company_name = "NA";
      if (
        key === "currently_employed" &&
        value === "YES" &&
        next.company_name === "NA"
      )
        next.company_name = "";
      return next;
    });
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const nextErrors: Record<string, string> = {};
        for (const field of activeFields)
          if (
            careerFieldRequired(field, draft) &&
            (!draft[field.key] ||
              (Array.isArray(draft[field.key]) &&
                !(draft[field.key] as string[]).length))
          )
            nextErrors[field.key] = "This field is required.";
        if (
          section.key === "basic" &&
          draft.phone &&
          !/^\+[1-9]\d{7,14}$/.test(String(draft.phone))
        )
          nextErrors.phone =
            "Use international format, for example +919876543210.";
        if (section.key === "basic" && !fullName.trim())
          nextErrors.full_name = "Enter your full name.";
        if (
          section.key === "employment" &&
          draft.work_status === "EXPERIENCED" &&
          !Number(draft.experience_years) &&
          !Number(draft.experience_months)
        )
          nextErrors.experience_years =
            "Enter at least one month of experience, or choose fresher.";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;
        setError("");
        try {
          if (section.key === "basic") await saveName(fullName.trim()).unwrap();
          const detailsToSave =
            draft.work_status === "EXPERIENCED" &&
            draft.currently_employed === "NO"
              ? { ...draft, company_name: "NA" }
              : draft;
          const result = await save({
            details: detailsToSave,
            resume_filename: selectedFilename ?? resumeFilename,
            resume_version_id:
              selectedVersionId ??
              resumeVersionId ??
              saved.data?.resume_version_id,
            complete: step === sections.length - 1,
          }).unwrap();
          if (editing || step === sections.length - 1) onDone(result);
          else {
            setStep(step + 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        } catch (failure) {
          setError(
            getApiErrorMessage(failure, "Check your details and try again."),
          );
        }
      }}
    >
      <div>
        <StepHeader
          step={
            editing
              ? undefined
              : section.key === "basic"
                ? "account"
                : section.key
          }
          title={section.title}
          subtitle="We filled what we could read from your resume. Review it and add anything missing."
        />
      </div>
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle size={18} className="shrink-0" />
          {error}
        </p>
      )}
      <div className="grid gap-6">
        {!editing && section.key === "basic" && (
          <Field
            id="career-resume"
            label="Upload your resume"
            hint="Read your PDF or DOCX to fill the fields below, or enter your details yourself."
          >
            <input
              id="career-resume"
              type="file"
              accept=".pdf,.docx"
              disabled={busy}
              className={`${fieldClass} text-[13px]`}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setError("");
                try {
                  const preview = await previewSelectedResume(file).unwrap();
                  const version = await intakeSelectedResume(file).unwrap();
                  const filled = {
                    ...draft,
                    ...Object.fromEntries(
                      Object.entries(preview.details).filter(
                        ([, value]) =>
                          value !== "" &&
                          value !== null &&
                          (!Array.isArray(value) || value.length),
                      ),
                    ),
                  };
                  setDraft(filled);
                  setSelectedVersionId(version.resume_version_id);
                  setSelectedFilename(file.name);
                  if (!fullName && preview.full_name)
                    setFullName(preview.full_name);
                  setListText({});
                  await save({
                    details: filled,
                    resume_version_id: version.resume_version_id,
                    resume_filename: file.name,
                    complete: false,
                  }).unwrap();
                } catch (failure) {
                  setError(
                    getApiErrorMessage(
                      failure,
                      "Your resume could not be read. Try again or enter your details.",
                    ),
                  );
                }
              }}
            />
            {(selectedPreviewState.isLoading ||
              selectedIntakeState.isLoading) && (
              <p role="status" className="text-[13px] text-[#5F4DB2]">
                Reading your resume and filling your details…
              </p>
            )}
          </Field>
        )}
        {section.key === "basic" && (
          <>
            <Field
              id="career-full-name"
              label="Full name *"
              error={errors.full_name}
            >
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
                  aria-hidden="true"
                />
                <input
                  id="career-full-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className={`${fieldClass} ${fieldBorder(Boolean(errors.full_name))} pl-12`}
                />
              </div>
            </Field>
            <Field
              id="career-email"
              label="Email ID"
              hint="Your verified account email."
            >
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
                  aria-hidden="true"
                />
                <input
                  id="career-email"
                  type="email"
                  readOnly
                  value={email || account.data?.email || ""}
                  className={`${fieldClass} border-[#E7E0D4] pl-12`}
                />
              </div>
            </Field>
          </>
        )}
        {activeFields.map((field) => {
          const value = draft[field.key];
          const id = `career-${field.key}`;
          return (
            <Field
              key={field.key}
              id={id}
              label={`${field.label}${careerFieldRequired(field, draft) ? " *" : ""}`}
              error={errors[field.key]}
              optional={!careerFieldRequired(field, draft)}
              hint={
                field.type === "list"
                  ? field.key === "preferred_locations"
                    ? "Separate locations with commas, up to five."
                    : "Separate skills with commas."
                  : field.type === "month"
                    ? "Month and year"
                    : undefined
              }
            >
              {field.type === "select" ? (
                <AppSelect
                  value={String(value ?? "")}
                  onChange={(v) => update(field.key, v)}
                  options={[{ value: "", label: "Select" }, ...field.options]}
                  ariaLabel={field.label}
                  menuPlacement="auto"
                  portal
                  className="[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:border-[#E7E0D4] [&>button]:bg-white [&>button]:px-4 [&>button]:text-[16px] [&>button>span]:text-[16px] [&>button>span]:font-medium [&>button]:font-medium [&>button]:text-[#0A1931]"
                />
              ) : (
                <div className="relative">
                  {field.key === "phone" && (
                    <Phone
                      className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
                      aria-hidden="true"
                    />
                  )}
                  <input
                    id={id}
                    type={field.type === "list" ? "text" : field.type}
                    value={
                      field.type === "list"
                        ? (listText[field.key] ??
                          (Array.isArray(value) ? value.join(", ") : ""))
                        : String(value ?? "")
                    }
                    min={field.key.endsWith("year") ? 1950 : 0}
                    max={
                      field.key === "experience_months"
                        ? 11
                        : field.key.endsWith("year")
                          ? 2100
                          : undefined
                    }
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key] ? `${id}-error` : undefined
                    }
                    className={`${fieldClass} ${fieldBorder(Boolean(errors[field.key]))} ${field.key === "phone" ? "pl-12" : ""}`}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (field.type === "list") {
                        setListText((current) => ({
                          ...current,
                          [field.key]: raw,
                        }));
                        update(
                          field.key,
                          raw
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        );
                      } else
                        update(
                          field.key,
                          field.type === "number"
                            ? raw === ""
                              ? field.key.startsWith("experience_")
                                ? 0
                                : null
                              : Number(raw)
                            : raw,
                        );
                    }}
                  />
                </div>
              )}
            </Field>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-xs text-[#5F6B80]">
        <CheckCircle2 size={16} />
        Salary and gender are optional. Gender does not affect your score.
      </p>
      <div className="flex items-center gap-3">
        <OnboardingBackButton
          disabled={busy}
          onClick={() => {
            if (step > 0) setStep(step - 1);
            else onBack();
          }}
        />
        <PillButton type="submit" isLoading={busy} className="flex-1">
          {editing || step === sections.length - 1
            ? editing
              ? "Save profile"
              : "Save and continue to membership"
            : "Save and continue"}
        </PillButton>
      </div>
    </form>
  );
}
