"use client";
import { useStudentHasAccess } from "@/features/student/onboarding/use-student-access";
import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mail, Phone, Plus, User, X } from "lucide-react";
import { StudentBackButton } from "@/features/student/components/student-back-button";
import { AppSelect } from "@/components/ui/app-select";
import { FormSkeleton } from "@/components/common/loading";
import {
  useGetStudentProfileQuery,
  useUpdateStudentNameMutation,
} from "@/store/student";
import { useAppSelector } from "@/store/hooks";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import {
  Field,
  fieldClass,
  fieldBorder,
  PillButton,
  StepHeader,
} from "@/features/student/onboarding/components/ui";
import {
  careerDetailsForSave,
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
  type CareerField,
  type CareerProfile,
} from "./career-api";

const sections = [
  { key: "basic", title: "Basic details" },
  { key: "employment", title: "Employment details" },
  { key: "education", title: "Education details" },
  { key: "preferences", title: "Headline and preferences" },
] as const;

function incompleteCareerFields(error: unknown): string[] {
  if (getApiErrorCode(error) !== "career_profile_incomplete") return [];
  if (typeof error !== "object" || error === null || !("data" in error))
    return [];
  const data = error.data;
  if (typeof data !== "object" || data === null || !("params" in data))
    return [];
  const params = data.params;
  if (typeof params !== "object" || params === null || !("fields" in params))
    return [];
  return Array.isArray(params.fields)
    ? params.fields.filter((field): field is string => typeof field === "string")
    : [];
}

export type CareerEditSection =
  | "all"
  | "headline"
  | (typeof sections)[number]["key"];

export function CareerForm({
  resumeVersionId,
  resumeFilename,
  onDone,
  onBack,
  editing = false,
  editSection = "all",
  initialSection = 0,
  onSectionChange,
}: {
  resumeVersionId?: string;
  resumeFilename?: string;
  onDone: (profile: CareerProfile) => void;
  onBack: () => void;
  editing?: boolean;
  editSection?: CareerEditSection;
  initialSection?: number;
  onSectionChange?: (section: number) => void;
}) {
  const fields = useGetCareerFieldsQuery();
  const { hasAccess } = useStudentHasAccess(editing);
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
  const [locationInput, setLocationInput] = useState("");
  const [serverRequiresSkills, setServerRequiresSkills] = useState(false);
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
      <div
        className={editing ? "min-h-72" : "min-h-[calc(100dvh-8rem)]"}
      >
        <FormSkeleton fields={5} />
      </div>
    );
  const section = sections[step];
  const editingAll = editing && editSection === "all";
  const updateEmploymentFields = !editing || editingAll || editSection === "employment";
  const showIdentityFields = section.key === "basic" && (!editing || editingAll);
  const modalFieldClass = editing ? "lg:py-3 lg:text-[15px] lg:leading-5" : "";
  const activeFields = fields.data.filter(
    (field) =>
      (editingAll ||
        (editing && editSection === "headline"
          ? field.key === "headline"
          : field.section === section.key &&
            (!editing || field.key !== "headline"))) &&
      (visibleCareerField(field, draft) ||
        (serverRequiresSkills && field.key === "key_skills")),
  );
  const fieldRequired = (field: CareerField, details: CareerDetails) =>
    careerFieldRequired(field, details) ||
    (serverRequiresSkills && field.key === "key_skills");
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
          notice_period: "",
          job_role: "",
        });
      if (updateEmploymentFields && key === "currently_employed" && value === "YES") {
        next.employment_end = "";
        if (next.work_status !== "EXPERIENCED") next.work_status = "EXPERIENCED";
      }
      if (updateEmploymentFields && key === "currently_employed" && value === "NO")
        Object.assign(next, {
          company_name: "",
          job_title: "",
          employment_start: "",
          employment_end: "",
          annual_salary: null,
          notice_period: "",
          job_role: "",
        });
      return next;
    });
    setErrors((current) =>
      key === "currently_employed"
        ? {
            ...current,
            [key]: "",
            company_name: "",
            job_title: "",
            employment_start: "",
            annual_salary: "",
            notice_period: "",
            employment_end: "",
            job_role: "",
          }
        : { ...current, [key]: "" },
    );
  };
  const addPreferredLocation = () => {
    const location = locationInput.trim();
    const locations = Array.isArray(draft.preferred_locations)
      ? draft.preferred_locations
      : [];
    if (
      !location ||
      locations.length >= 5 ||
      locations.some((saved) => saved.toLowerCase() === location.toLowerCase())
    ) return;
    update("preferred_locations", [...locations, location]);
    setLocationInput("");
  };
  const showMissingFields = (missing: string[]) => {
    if (editing && !editingAll) return false;
    const first = missing.find((key) =>
      key === "full_name" ||
      fields.data.some(
        (field) =>
          field.key === key &&
          (visibleCareerField(field, draft) || key === "key_skills"),
      ),
    );
    if (!first) return false;
    if (missing.includes("key_skills")) setServerRequiresSkills(true);
    setErrors(
      Object.fromEntries(missing.map((key) => [key, "This field is required."])),
    );
    setError("Complete the highlighted profile fields to continue.");
    const sectionKey =
      first === "full_name"
        ? "basic"
        : fields.data.find((field) => field.key === first)?.section;
    const targetStep = sections.findIndex((item) => item.key === sectionKey);
    if (targetStep >= 0) setStep(targetStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  };
  return (
    <form
      noValidate
      className={`flex flex-col gap-6 ${editing ? "font-sans text-[13px] leading-5 lg:text-[14px]" : ""}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const pendingLocation = locationInput.trim();
        const savedLocations = Array.isArray(draft.preferred_locations)
          ? draft.preferred_locations
          : [];
        const submittedDraft =
          pendingLocation &&
          savedLocations.length < 5 &&
          !savedLocations.some(
            (location) => location.toLowerCase() === pendingLocation.toLowerCase(),
          )
            ? { ...draft, preferred_locations: [...savedLocations, pendingLocation] }
            : draft;
        const employmentDetails = submittedDraft;
        const nextErrors: Record<string, string> = {};
        for (const field of activeFields)
          if (
            fieldRequired(field, employmentDetails) &&
            (!employmentDetails[field.key] ||
              (Array.isArray(employmentDetails[field.key]) &&
                !(employmentDetails[field.key] as string[]).length))
          )
            nextErrors[field.key] = "This field is required.";
        if (
          activeFields.some((field) => field.key === "phone") &&
          employmentDetails.phone &&
          !/^\+[1-9]\d{7,14}$/.test(String(employmentDetails.phone))
        )
          nextErrors.phone =
            "Use international format, for example +919876543210.";
        if (showIdentityFields && !fullName.trim())
          nextErrors.full_name = "Enter your full name.";
        if (
          activeFields.some((field) => field.key === "experience_years") &&
          employmentDetails.work_status === "EXPERIENCED" &&
          (typeof employmentDetails.experience_years !== "number" ||
            !Number.isInteger(employmentDetails.experience_years) ||
            employmentDetails.experience_years < 0 ||
            employmentDetails.experience_years > 60)
        )
          nextErrors.experience_years = "Enter a whole number from 0 to 60.";
        if (
          activeFields.some((field) => field.key === "experience_months") &&
          employmentDetails.work_status === "EXPERIENCED" &&
          (typeof employmentDetails.experience_months !== "number" ||
            !Number.isInteger(employmentDetails.experience_months) ||
            employmentDetails.experience_months < 0 ||
            employmentDetails.experience_months > 11)
        )
          nextErrors.experience_months = "Enter a whole number from 0 to 11.";
        if (
          activeFields.some((field) => field.key === "experience_years") &&
          employmentDetails.work_status === "EXPERIENCED" &&
          !Number(employmentDetails.experience_years) &&
          !Number(employmentDetails.experience_months) &&
          !nextErrors.experience_years &&
          !nextErrors.experience_months
        )
          nextErrors.experience_years =
            "Enter at least one month of experience, or choose fresher.";
        if (!editing && step === sections.length - 1) {
          for (const field of fields.data) {
            if (
              (visibleCareerField(field, employmentDetails) ||
                (serverRequiresSkills && field.key === "key_skills")) &&
              fieldRequired(field, employmentDetails) &&
              (!employmentDetails[field.key] ||
                (Array.isArray(employmentDetails[field.key]) &&
                  !(employmentDetails[field.key] as string[]).length))
            )
              nextErrors[field.key] = "This field is required.";
          }
          if (!fullName.trim())
            nextErrors.full_name = "Enter your full name.";
        }
        if (
          !editing && step === sections.length - 1 &&
          Object.keys(nextErrors).some((key) =>
            key === "full_name" ||
            fields.data.some((field) => field.key === key && field.section !== section.key),
          )
        ) {
          showMissingFields(Object.keys(nextErrors));
          return;
        }
        const validEmploymentMonth = (value: unknown) =>
          typeof value === "string" &&
          /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
        if (
          activeFields.some((field) => field.key === "employment_start") &&
          employmentDetails.employment_start &&
          !validEmploymentMonth(employmentDetails.employment_start)
        )
          nextErrors.employment_start = "Enter a valid month between 1900 and 2099.";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;
        setError("");
        setDraft(employmentDetails);
        setLocationInput("");
        try {
          if (showIdentityFields && fullName.trim() !== identity.data?.fullName)
            await saveName(fullName.trim()).unwrap();
          const detailsToSave =
            editing && !editingAll
              ? {
                  ...saved.data?.details,
                  ...Object.fromEntries(
                    fields.data
                      .filter((field) =>
                        editSection === "headline"
                          ? field.key === "headline"
                          : field.section === section.key &&
                            field.key !== "headline"
                      )
                      .map((field) => [field.key, employmentDetails[field.key]]),
                  ),
                }
              : employmentDetails;
          const cleanedDetails = careerDetailsForSave(detailsToSave);
          if (serverRequiresSkills)
            cleanedDetails.key_skills = detailsToSave.key_skills;
          const result = await save({
            details: cleanedDetails,
            resume_filename: selectedFilename ?? resumeFilename,
            resume_version_id:
              selectedVersionId ??
              resumeVersionId ??
              saved.data?.resume_version_id,
            complete: editing
              ? Boolean(saved.data?.completed)
              : step === sections.length - 1,
          }).unwrap();
          if (editing || step === sections.length - 1) onDone(result);
          else {
            setStep(step + 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        } catch (failure) {
          const missing = incompleteCareerFields(failure);
          if (missing.length && showMissingFields(missing)) return;
          setError(
            getApiErrorMessage(failure, "Check your details and try again."),
          );
        }
      }}
    >
      <div>
        {editing ? (
          <p className="text-[13px] leading-5 text-[#3A4761] lg:text-[14px]">
            Update your profile details below.
          </p>
        ) : (
          <StepHeader
            step={section.key === "basic" ? "account" : section.key}
            title={section.title}
            subtitle="We filled what we could read from your resume. Review it and add anything missing."
          />
        )}
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
                    details: careerDetailsForSave(filled),
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
        {editingAll && (
          <h3 className="text-[16px] font-semibold text-[#0A1931]">
            Basic details
          </h3>
        )}
        {showIdentityFields && (
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
                  className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors.full_name))} pl-12`}
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
                  className={`${fieldClass} ${modalFieldClass} border-[#E7E0D4] pl-12`}
                />
              </div>
            </Field>
          </>
        )}
        {activeFields.map((field, index) => {
          const value = draft[field.key];
          const id = `career-${field.key}`;
          return (
            <Fragment key={field.key}>
              {editingAll &&
                field.section !== "basic" &&
                field.section !== activeFields[index - 1]?.section && (
                  <h3 className="text-[16px] font-semibold text-[#0A1931]">
                    {sections.find((item) => item.key === field.section)?.title}
                  </h3>
                )}
              <Field
              id={id}
              label={`${field.label}${fieldRequired(field, draft) ? " *" : ""}`}
              error={errors[field.key]}
              optional={!fieldRequired(field, draft)}
              hint={
                field.type === "list"
                  ? field.key === "preferred_locations"
                    ? "Add up to five preferred work locations."
                    : "Separate skills with commas."
                  : field.type === "month"
                    ? "Month and year"
                    : undefined
              }
            >
              {field.type === "select" ? (
                <AppSelect
                  value={String(value || (field.key === "currently_employed" ? "NO" : ""))}
                  onChange={(v) => update(field.key, v)}
                  options={[{ value: "", label: "Select" }, ...field.options]}
                  ariaLabel={field.label}
                  menuPlacement="auto"
                  portal
                  variant="student"
                  className={`[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:px-4 [&>button>span]:font-medium ${editing ? "lg:[&>button]:h-[48px]" : ""}`}
                />
              ) : field.key === "preferred_locations" ? (
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      id={id}
                      type="text"
                      value={locationInput}
                      maxLength={100}
                      disabled={Array.isArray(value) && value.length >= 5}
                      placeholder="Enter a work location"
                      aria-invalid={Boolean(errors[field.key])}
                      aria-describedby={errors[field.key] ? `${id}-error` : `${id}-hint`}
                      className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors[field.key]))} pr-14`}
                      onChange={(event) => setLocationInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addPreferredLocation();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addPreferredLocation}
                      disabled={!locationInput.trim() || (Array.isArray(value) && value.length >= 5)}
                      aria-label="Add work location"
                      className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-[#5F4DB2] hover:bg-[#F1EAF7] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                  {Array.isArray(value) && value.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label="Selected work locations">
                      {value.map((location, index) => (
                        <li key={`${location}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#C9BEEB] bg-[#F1EAF7] px-3 py-1.5 text-[13px] font-medium text-[#4A3E8F]">
                          <span className="truncate">{location}</span>
                          <button
                            type="button"
                            onClick={() => update(field.key, value.filter((_, itemIndex) => itemIndex !== index))}
                            aria-label={`Remove ${location}`}
                            className="shrink-0 rounded-full p-0.5 hover:bg-[#E5DCF5]"
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
                    value={field.type === "list" ? (listText[field.key] ?? (Array.isArray(value) ? value.join(", ") : "")) : String(value ?? "")}
                    min={field.key === "experience_years" ? 0 : field.key.endsWith("year") ? 1950 : 0}
                    max={
                      field.key === "experience_months"
                        ? 11
                        : field.key === "experience_years"
                          ? 60
                        : field.key.endsWith("year")
                          ? 2100
                          : undefined
                    }
                    step={field.key.startsWith("experience_") ? 1 : undefined}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key] ? `${id}-error` : undefined
                    }
                    className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors[field.key]))} ${field.key === "phone" ? "pl-12" : ""}`}
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
            </Fragment>
          );
        })}
      </div>
      {(editingAll || activeFields.some((field) => field.key === "gender")) && (
        <p className="flex items-center gap-2 text-xs text-[#5F6B80]">
          <CheckCircle2 size={16} />
          Salary and gender are optional. Gender does not affect your score.
        </p>
      )}
      <div className="flex items-center gap-3">
        <StudentBackButton
          disabled={busy}
          className={editing ? "lg:h-12 lg:text-[14px]" : ""}
          label={editing ? "Close" : "Back"}
          onClick={() => {
            if (editing) onBack();
            else if (step > 0) setStep(step - 1);
            else onBack();
          }}
        />
        <PillButton type="submit" isLoading={busy} className={`flex-1 ${editing ? "lg:py-3 lg:text-[14px]" : ""}`}>
          {editing || step === sections.length - 1
            ? editing
              ? "Save profile"
              : hasAccess
                ? "Save and continue"
                : "Save and continue to membership"
            : "Save and continue"}
        </PillButton>
      </div>
    </form>
  );
}
