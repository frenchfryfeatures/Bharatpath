"use client";

import {
  ArrowLeft,
  Copy,
  Eye,
  Loader2,
  LockKeyhole,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useState,
  useSyncExternalStore,
} from "react";

import { usePageHeader } from "@/components/layout/header-context";
import { DatePicker } from "@/components/ui/date-time-picker";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/features/employer/components/use-confirm-dialog";
import {
  EDUCATION_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  JobDescriptionView,
  JOB_TYPE_LABELS,
  NOTICE_PERIOD_LABELS,
  optionsOf,
  RELOCATION_LABELS,
  SALARY_PERIOD_LABELS,
  SALARY_TYPE_LABELS,
  TIMELINE_LABELS,
  VISIBILITY_LABELS,
  WORK_MODE_LABELS,
  type ApplicationMethod,
  type EmploymentKind,
  type HiringTimeline,
  type JobType,
  type MinimumEducation,
  type NoticePeriod,
  type Priority,
  type Relocation,
  type SalaryPeriod,
  type SalaryType,
  type Visibility,
} from "@/features/jobs";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

import { useJobCreateForm } from "../hooks/use-job-create-form";
import {
  hasThreshold,
  previewThreshold,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  THRESHOLD_STEP,
} from "../threshold";
import type { CreateJobFormValues } from "../types";
import { jobViewFromForm } from "../../job-view-data";
import {
  CheckboxRow,
  ChoiceGroup,
  Field,
  FieldGrid,
  inputClasses,
  LinesInput,
  NumberInput,
  SectionCard,
  SectionTitle,
  SelectInput,
  TagInput,
  TextArea,
  TextInput,
} from "./job-form-fields";
import { JobSkillsField } from "./job-skills-field";
import { ScreeningQuestionsField } from "./screening-questions-field";
import {
  useCloseEmployerJobMutation,
  useCreateEmployerJobMutation,
  usePauseEmployerJobMutation,
  usePublishEmployerJobMutation,
  usePreviewEmployerJobThresholdQuery,
  useUpdateEmployerJobMutation,
} from "@/store/employer/jobs";
import { useGetEmployerOrganisationQuery } from "@/store/employer/settings";
import type { ApiJobStatus, JobWorkMode } from "../../types";

const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const MAX_SKILL_YEARS_ROWS = 50;

export interface JobCreatePageProps {
  initialValues?: CreateJobFormValues;
  heading?: string;
  jobId?: string;
  jobStatus?: ApiJobStatus;
}

export function JobCreatePage({
  initialValues,
  heading = "Create job",
  jobId,
  jobStatus,
}: JobCreatePageProps) {
  const router = useRouter();
  // Cached query data can be available before this server-rendered tree hydrates.
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [statusOverride, setStatusOverride] =
    useState<ApiJobStatus | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const currentStatus = statusOverride ?? jobStatus;
  const { confirm, dialog } = useConfirmDialog();
  const isEditing = Boolean(jobId);
  const isDraft = currentStatus === "DRAFT";
  const isPublished = currentStatus === "PUBLISHED";
  const isPaused = currentStatus === "PAUSED";
  const isClosed = currentStatus === "CLOSED";
  const isFormEditable = !isEditing || isDraft || isPaused;
  const canChangeToPublished = !isEditing || isDraft || isPaused;
  const disabled = !isFormEditable;

  const {
    values,
    errors,
    setValue,
    setDetail,
    setScreeningQuestions,
    validate,
  } = useJobCreateForm(initialValues);
  const { details } = values;
  const { data: organisation } = useGetEmployerOrganisationQuery();
  const canPublish = hasHydrated && organisation?.kybStatus === "APPROVED";
  // Keep the slider responsive, but wait for one second of inactivity before
  // changing the query argument. An unchanged score keeps the same query.
  const debouncedMinScore = useDebouncedValue(values.minScore, 1_000);
  const { currentData: thresholdPreviewData } = usePreviewEmployerJobThresholdQuery(
    previewThreshold(debouncedMinScore),
    {
      skip:
        !isFormEditable ||
        !hasThreshold(values.minScore) ||
        !hasThreshold(debouncedMinScore),
    },
  );
  const thresholdPreview =
    hasHydrated && values.minScore === debouncedMinScore
      ? thresholdPreviewData
      : undefined;
  const isThresholdPreviewLoading =
    !thresholdPreview &&
    isFormEditable &&
    hasThreshold(values.minScore);
  const thresholdSet = hasThreshold(values.minScore);
  const [createJob, { isLoading: isCreating }] = useCreateEmployerJobMutation();
  const [updateJob, { isLoading: isUpdating }] = useUpdateEmployerJobMutation();
  const [publish, { isLoading: isPublishing }] = usePublishEmployerJobMutation();
  const [pauseJob, { isLoading: isPausing }] = usePauseEmployerJobMutation();
  const [closeJob, { isLoading: isClosing }] = useCloseEmployerJobMutation();
  const isSaving =
    isCreating ||
    isUpdating ||
    isPublishing ||
    isPausing ||
    isClosing;

  const [toast, setToast] =
    useState<string | null>(null);

  usePageHeader(
    heading,
    isClosed
      ? "Closed jobs cannot reopen. Duplicate this job to create a new posting"
      : "Set requirements once. Every applicant is matched against them",
  );

  const showToast = (message: string) => {
    setToast(message);

    window.setTimeout(
      () => setToast(null),
      2200,
    );
  };

  /** Validate, and if anything is wrong, say so and show the first one. */
  const checkForm = () => {
    if (validate()) return true;
    showToast("Some required details are missing. Check the fields in red.");
    window.requestAnimationFrame(() => {
      document
        .querySelector('[role="alert"], [aria-invalid="true"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return false;
  };

  const saveJob = async () => {
    if (!checkForm()) return;
    try {
      if (jobId) {
        const updated = await updateJob({ id: jobId, values }).unwrap();
        setStatusOverride(updated.status);
        showSuccessFeedback("Job updated.");
        return;
      }

      await createJob(values).unwrap();
      showSuccessFeedback("Job saved as a draft.");
      window.setTimeout(() => router.push("/employer/jobs"), 450);
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not save the job"));
    }
  };

  const publishJob = async () => {
    if (!canPublish) {
      return;
    }

    if (!validate()) {
      return;
    }

    try {
      const saved = jobId
        ? await updateJob({ id: jobId, values }).unwrap()
        : await createJob(values).unwrap();
      const published = await publish(saved.id).unwrap();
      setStatusOverride(published.status);
      showSuccessFeedback("Job published.");
      if (!jobId) {
        window.setTimeout(() => router.push("/employer/jobs"), 650);
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not publish the job"));
    }
  };

  const pauseCurrentJob = async () => {
    if (!jobId) return;

    try {
      const paused = await pauseJob(jobId).unwrap();
      setStatusOverride(paused.status);
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not pause the job"));
    }
  };

  const closeCurrentJob = async () => {
    if (!jobId) return;

    try {
      const closed = await closeJob(jobId).unwrap();
      setStatusOverride(closed.status);
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not close the job"));
    }
  };

  const askPublish = () => {
    // Validate first so the dialog is never shown for a form that cannot go live.
    if (!canPublish || !checkForm()) return;

    confirm({
      title: "Publish this job?",
      description:
        details.settings.visibility === "PUBLIC"
          ? "Matching candidates will be able to see and apply to this job straight away."
          : "The job goes live but stays off the job board. Candidates reach it only through a link you share or an invitation.",
      confirmLabel: "Publish job",
      onConfirm: publishJob,
    });
  };

  const askPause = () =>
    confirm({
      title: "Pause this job?",
      description:
        "Candidates will no longer see the job or be able to apply while it is paused. Applications you already have are kept.",
      confirmLabel: "Pause job",
      onConfirm: pauseCurrentJob,
    });

  const askClose = () =>
    confirm({
      title: "Close this job?",
      description:
        "Closing is permanent. Candidates will no longer see the job, and it cannot be reopened. You can duplicate it later to create a new posting.",
      confirmLabel: "Close job",
      tone: "danger",
      onConfirm: closeCurrentJob,
    });

  const askDuplicate = () =>
    confirm({
      title: "Duplicate this job?",
      description:
        "A new draft will be created with the same details. The closed job stays as it is.",
      confirmLabel: "Duplicate job",
      onConfirm: duplicateJob,
    });

  const askDiscard = () =>
    confirm({
      title: isEditing ? "Discard your changes?" : "Discard this job?",
      description: isEditing
        ? "Anything you changed since the last save will be lost."
        : "Nothing you entered will be saved.",
      confirmLabel: "Discard",
      tone: "danger",
      onConfirm: () => router.push(jobId ? `/employer/jobs/${jobId}` : "/employer/jobs"),
    });

  const duplicateJob = () => {
    if (!jobId) return;
    router.push(
      `/employer/jobs/create?duplicateFrom=${encodeURIComponent(jobId)}`,
    );
  };

  const skillYears = details.skills.experience;
  const setSkillYears = (rows: typeof skillYears) =>
    setDetail("skills", "experience", rows);

  return (
    <main className="min-h-full bg-[#f7f8fa]">
      <div className="w-full max-w-[860px]">
        <button
          type="button"
          onClick={() =>
            router.push(jobId ? `/employer/jobs/${jobId}` : "/employer/jobs")
          }
          className="mb-5 inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-[#283247] hover:text-[#151b2b]"
        >
          <ArrowLeft
            size={16}
            strokeWidth={2}
          />

          {jobId ? "Back to job" : "Back to jobs"}
        </button>

        {/* 1. BASIC JOB DETAILS */}
        <SectionCard number={1} title="Basic job details">
          <FieldGrid>
            <Field label="Job title" required wide error={errors.title}>
              <TextInput
                value={values.title}
                maxLength={255}
                disabled={disabled}
                invalid={Boolean(errors.title)}
                ariaLabel="Job title"
                placeholder="Lab Analyst Trainee"
                onChange={(title) => setValue("title", title)}
              />
            </Field>

            <Field label="Job type" required wide error={errors["basics.job_type"]}>
              <ChoiceGroup<JobType>
                value={details.basics.job_type}
                options={optionsOf(JOB_TYPE_LABELS) as Array<{ value: JobType; label: string }>}
                disabled={disabled}
                ariaLabel="Job type"
                onChange={(jobType) => setDetail("basics", "job_type", jobType)}
              />
            </Field>

            <Field label="Employment type" required error={errors["basics.employment_type"]}>
              <SelectInput<EmploymentKind>
                value={details.basics.employment_type}
                options={optionsOf(EMPLOYMENT_TYPE_LABELS)}
                disabled={disabled}
                invalid={Boolean(errors["basics.employment_type"])}
                ariaLabel="Employment type"
                onChange={(kind) => setDetail("basics", "employment_type", kind)}
              />
            </Field>

            <Field label="Number of openings" required error={errors["basics.openings"]}>
              <NumberInput
                value={details.basics.openings}
                min={1}
                max={10_000}
                step={1}
                disabled={disabled}
                invalid={Boolean(errors["basics.openings"])}
                ariaLabel="Number of openings"
                placeholder="1"
                onChange={(openings) =>
                  setDetail("basics", "openings", openings === "" ? null : Math.trunc(openings))
                }
              />
            </Field>

            <Field label="Department" required error={errors["basics.department"]}>
              <TextInput
                value={details.basics.department}
                disabled={disabled}
                invalid={Boolean(errors["basics.department"])}
                ariaLabel="Department"
                placeholder="Quality Control"
                onChange={(department) => setDetail("basics", "department", department)}
              />
            </Field>

            <Field label="Job category" required error={errors["basics.category"]}>
              <TextInput
                value={details.basics.category}
                disabled={disabled}
                invalid={Boolean(errors["basics.category"])}
                ariaLabel="Job category"
                placeholder="Laboratory & Testing"
                onChange={(category) => setDetail("basics", "category", category)}
              />
            </Field>

            <Field label="Industry type" wide>
              <TextInput
                value={details.basics.industry}
                disabled={disabled}
                ariaLabel="Industry type"
                placeholder={organisation?.industry || "Pharmaceuticals"}
                onChange={(industry) => setDetail("basics", "industry", industry)}
              />
            </Field>
          </FieldGrid>
        </SectionCard>

        {/* 2. JOB LOCATION */}
        <SectionCard number={2} title="Job location">
          <FieldGrid>
            <Field label="Work mode" required wide error={errors.workMode}>
              <ChoiceGroup<JobWorkMode>
                value={values.workMode as JobWorkMode}
                options={optionsOf(WORK_MODE_LABELS) as Array<{ value: JobWorkMode; label: string }>}
                disabled={disabled}
                ariaLabel="Work mode"
                onChange={(mode) => setValue("workMode", mode)}
              />
            </Field>

            <Field label="Job location" required reserveHintSpace error={errors.location}>
              <TextInput
                value={values.location}
                maxLength={255}
                disabled={disabled}
                invalid={Boolean(errors.location)}
                ariaLabel="Job location"
                placeholder="Kothrud, Pune"
                onChange={(location) => setValue("location", location)}
              />
            </Field>

            <Field label="Multiple locations" hint="Other cities this role can be based in.">
              <TagInput
                value={details.location.additional_locations}
                max={20}
                disabled={disabled}
                ariaLabel="Additional locations"
                placeholder="Add a city"
                onChange={(places) => setDetail("location", "additional_locations", places)}
              />
            </Field>

            <div className="sm:col-span-2">
              <CheckboxRow
                label="Relocation assistance"
                hint="You help a hire move to the job location."
                checked={details.location.relocation_assistance}
                disabled={disabled}
                onChange={(checked) =>
                  setDetail("location", "relocation_assistance", checked)
                }
              />
            </div>
          </FieldGrid>
        </SectionCard>

        {/* 3. EXPERIENCE & COMPENSATION */}
        <SectionCard number={3} title="Experience & compensation">
          <FieldGrid>
            <Field label="Minimum experience (years)" required error={errors.experienceMin}>
              <NumberInput
                value={values.experienceMin}
                min={0}
                max={50}
                step={0.5}
                disabled={disabled}
                invalid={Boolean(errors.experienceMin)}
                ariaLabel="Minimum experience in years"
                placeholder="0"
                onChange={(years) => setValue("experienceMin", years)}
              />
            </Field>

            <Field label="Maximum experience (years)" required error={errors.experienceMax}>
              <NumberInput
                value={values.experienceMax}
                min={0}
                max={50}
                step={0.5}
                disabled={disabled}
                invalid={Boolean(errors.experienceMax)}
                ariaLabel="Maximum experience in years"
                placeholder="3"
                onChange={(years) => setValue("experienceMax", years)}
              />
            </Field>

            <Field
              label="Minimum salary (₹)"
              hint="Always entered, even when not shown."
              error={errors.salaryMin}
            >
              <NumberInput
                value={values.salaryMin}
                disabled={disabled}
                invalid={Boolean(errors.salaryMin)}
                ariaLabel="Minimum salary in rupees"
                placeholder="20000"
                onChange={(amount) => setValue("salaryMin", amount)}
              />
            </Field>

            <Field label="Maximum salary (₹)" error={errors.salaryMax}>
              <NumberInput
                value={values.salaryMax}
                disabled={disabled}
                invalid={Boolean(errors.salaryMax)}
                ariaLabel="Maximum salary in rupees"
                placeholder="35000"
                onChange={(amount) => setValue("salaryMax", amount)}
              />
            </Field>

            <Field label="Salary period" required error={errors["compensation.period"]}>
              <SelectInput<SalaryPeriod>
                value={details.compensation.period}
                options={optionsOf(SALARY_PERIOD_LABELS)}
                disabled={disabled}
                invalid={Boolean(errors["compensation.period"])}
                ariaLabel="Salary period"
                onChange={(period) => setDetail("compensation", "period", period)}
              />
            </Field>

            <Field label="Salary type">
              <SelectInput<SalaryType>
                value={details.compensation.salary_type}
                options={optionsOf(SALARY_TYPE_LABELS, "Not specified")}
                disabled={disabled}
                ariaLabel="Salary type"
                onChange={(kind) => setDetail("compensation", "salary_type", kind)}
              />
            </Field>

            <CheckboxRow
              label="Show salary to candidates"
              hint="Off shows “Not disclosed” on the listing. The range is still sent to the candidate app and used by the salary filter, so this changes how it is shown, not who can see it."
              checked={details.compensation.disclosed}
              disabled={disabled}
              onChange={(checked) => setDetail("compensation", "disclosed", checked)}
            />

            <CheckboxRow
              label="Salary is negotiable"
              checked={details.compensation.negotiable}
              disabled={disabled}
              onChange={(checked) => setDetail("compensation", "negotiable", checked)}
            />
          </FieldGrid>
        </SectionCard>

        {/* 4. JOB DESCRIPTION */}
        <SectionCard number={4} title="Job description">
          <FieldGrid>
            <Field label="Job description" required wide error={errors.description}>
              <TextArea
                value={values.description}
                disabled={disabled}
                invalid={Boolean(errors.description)}
                ariaLabel="Job description"
                placeholder="What will this person do day to day?"
                onChange={(description) => setValue("description", description)}
              />
            </Field>

            <Field
              label="Key responsibilities"
              required
              wide
              hint="One per line."
              error={errors["content.responsibilities"]}
            >
              <LinesInput
                value={details.content.responsibilities}
                disabled={disabled}
                invalid={Boolean(errors["content.responsibilities"])}
                ariaLabel="Key responsibilities"
                placeholder={"Run daily quality checks on incoming samples\nMaintain lab records"}
                onChange={(items) => setDetail("content", "responsibilities", items)}
              />
            </Field>

            <Field
              label="Required qualifications"
              required
              wide
              hint="One per line."
              error={errors["content.required_qualifications"]}
            >
              <LinesInput
                value={details.content.required_qualifications}
                disabled={disabled}
                invalid={Boolean(errors["content.required_qualifications"])}
                ariaLabel="Required qualifications"
                placeholder="B.Sc. in Chemistry or a related field"
                onChange={(items) => setDetail("content", "required_qualifications", items)}
              />
            </Field>

            <Field label="Preferred qualifications" wide hint="One per line.">
              <LinesInput
                rows={3}
                value={details.content.preferred_qualifications}
                disabled={disabled}
                ariaLabel="Preferred qualifications"
                onChange={(items) => setDetail("content", "preferred_qualifications", items)}
              />
            </Field>

            <Field label="Benefits & perks" wide hint="One per line.">
              <LinesInput
                rows={3}
                value={details.content.benefits}
                disabled={disabled}
                ariaLabel="Benefits and perks"
                placeholder={"Health insurance\nCanteen and transport"}
                onChange={(items) => setDetail("content", "benefits", items)}
              />
            </Field>
          </FieldGrid>
        </SectionCard>

        {/* 5. SKILLS & TECHNOLOGIES */}
        <SectionCard number={5} title="Skills & technologies">
          <div className="space-y-5">
            <JobSkillsField
              value={values.skills}
              error={errors.skills}
              disabled={disabled}
              onChange={(skills) => setValue("skills", skills)}
            />

            <FieldGrid>
              <Field label="Primary skill" hint="The one skill this role needs most.">
                <SelectInput<string>
                  value={details.skills.primary}
                  options={[
                    { value: "", label: "None" },
                    ...values.skills.map((skill) => ({ value: skill, label: skill })),
                  ]}
                  placeholder={values.skills.length ? "Select" : "Add required skills first"}
                  disabled={disabled || !values.skills.length}
                  ariaLabel="Primary skill"
                  onChange={(skill) => setDetail("skills", "primary", skill)}
                />
              </Field>

              <Field label="Technologies / tools" reserveHintSpace>
                <TagInput
                  value={details.skills.tools}
                  disabled={disabled}
                  ariaLabel="Technologies and tools"
                  placeholder="e.g. HPLC, Excel"
                  onChange={(tools) => setDetail("skills", "tools", tools)}
                />
              </Field>
            </FieldGrid>

            <JobSkillsField
              label="Preferred skills"
              required={false}
              value={details.skills.preferred}
              disabled={disabled}
              onChange={(skills) => setDetail("skills", "preferred", skills)}
            />

            <JobSkillsField
              label="Nice-to-have skills"
              required={false}
              value={details.content.nice_to_have_skills}
              disabled={disabled}
              onChange={(skills) => setDetail("content", "nice_to_have_skills", skills)}
            />

            <Field
              label="Years of experience per skill"
              hint="Optional. Only for required skills."
            >
              <div className="flex flex-col gap-2">
                {skillYears.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <div className="flex-1">
                      <SelectInput<string>
                        value={row.skill}
                        options={values.skills
                          .filter(
                            (skill) =>
                              skill === row.skill ||
                              !skillYears.some((item, at) => at !== index && item.skill === skill),
                          )
                          .map((skill) => ({ value: skill, label: skill }))}
                        disabled={disabled}
                        ariaLabel={`Skill ${index + 1}`}
                        onChange={(skill) =>
                          setSkillYears(
                            skillYears.map((item, at) =>
                              at === index ? { ...item, skill } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="w-32">
                      <NumberInput
                        value={row.years}
                        min={0}
                        max={50}
                        step={1}
                        disabled={disabled}
                        ariaLabel={`Years of ${row.skill || "skill"}`}
                        placeholder="Years"
                        onChange={(years) =>
                          setSkillYears(
                            skillYears.map((item, at) =>
                              at === index
                                ? { ...item, years: years === "" ? 0 : Math.trunc(years) }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                    {!disabled ? (
                      <button
                        type="button"
                        aria-label={`Remove skill experience ${index + 1}`}
                        onClick={() => setSkillYears(skillYears.filter((_, at) => at !== index))}
                        className="cursor-pointer rounded-[10px] border border-[#e1e5ea] bg-white px-3 text-[13px] font-semibold text-[#b42318] hover:bg-[#fff4f2]"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                {(() => {
                  const firstUnused = values.skills.find(
                    (skill) => !skillYears.some((row) => row.skill === skill),
                  );
                  return !disabled && firstUnused !== undefined && skillYears.length < MAX_SKILL_YEARS_ROWS ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSkillYears([...skillYears, { skill: firstUnused, years: 1 }])
                      }
                      className="w-fit cursor-pointer rounded-[8px] border border-[#e1e5ea] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#151b2b] transition hover:bg-[#f7f8fa]"
                    >
                      Add years for a skill
                    </button>
                  ) : null;
                })()}
              </div>
            </Field>
          </div>
        </SectionCard>

        {/* 6. EDUCATION REQUIREMENTS */}
        <SectionCard number={6} title="Education requirements">
          <FieldGrid>
            <Field label="Minimum education" wide>
              <SelectInput<MinimumEducation>
                value={details.education.minimum}
                options={optionsOf(EDUCATION_LABELS, "Not specified")}
                disabled={disabled}
                ariaLabel="Minimum education"
                onChange={(level) => setDetail("education", "minimum", level)}
              />
            </Field>
            <Field label="UG qualification">
              <TextInput
                value={details.education.ug_qualification}
                disabled={disabled}
                ariaLabel="UG qualification"
                placeholder="B.Sc"
                onChange={(text) => setDetail("education", "ug_qualification", text)}
              />
            </Field>
            <Field label="UG specialization">
              <TextInput
                value={details.education.ug_specialization}
                disabled={disabled}
                ariaLabel="UG specialization"
                placeholder="Chemistry"
                onChange={(text) => setDetail("education", "ug_specialization", text)}
              />
            </Field>
            <Field label="PG qualification">
              <TextInput
                value={details.education.pg_qualification}
                disabled={disabled}
                ariaLabel="PG qualification"
                placeholder="M.Sc"
                onChange={(text) => setDetail("education", "pg_qualification", text)}
              />
            </Field>
            <Field label="PG specialization">
              <TextInput
                value={details.education.pg_specialization}
                disabled={disabled}
                ariaLabel="PG specialization"
                placeholder="Analytical Chemistry"
                onChange={(text) => setDetail("education", "pg_specialization", text)}
              />
            </Field>
            <Field label="Certifications" wide>
              <TagInput
                value={details.education.certifications}
                disabled={disabled}
                ariaLabel="Certifications"
                placeholder="e.g. GLP certification"
                onChange={(items) => setDetail("education", "certifications", items)}
              />
            </Field>
          </FieldGrid>
        </SectionCard>

        {/* 7. CANDIDATE REQUIREMENTS */}
        <SectionCard
          number={7}
          title="Candidate requirements"
          description="Ask about what the work needs. Age, date of birth and gender cannot be job requirements on BharatPath."
        >
          <FieldGrid>
            <Field label="Required languages" wide>
              <TagInput
                value={details.requirements.languages}
                max={20}
                disabled={disabled}
                ariaLabel="Required languages"
                placeholder="e.g. Hindi, Marathi"
                onChange={(items) => setDetail("requirements", "languages", items)}
              />
            </Field>
            <Field label="Notice period">
              <SelectInput<NoticePeriod>
                value={details.requirements.notice_period}
                options={optionsOf(NOTICE_PERIOD_LABELS, "Not specified")}
                disabled={disabled}
                ariaLabel="Notice period"
                onChange={(period) => setDetail("requirements", "notice_period", period)}
              />
            </Field>
            <Field label="Willingness to relocate">
              <SelectInput<Relocation>
                value={details.requirements.relocation}
                options={optionsOf(RELOCATION_LABELS, "Not specified")}
                disabled={disabled}
                ariaLabel="Willingness to relocate"
                onChange={(choice) => setDetail("requirements", "relocation", choice)}
              />
            </Field>
            <Field label="Work authorization" wide>
              <TextInput
                value={details.requirements.work_authorization}
                disabled={disabled}
                ariaLabel="Work authorization"
                placeholder="Authorised to work in India"
                onChange={(text) => setDetail("requirements", "work_authorization", text)}
              />
            </Field>
          </FieldGrid>
        </SectionCard>

        {/* 8. APPLICATION SETTINGS */}
        <SectionCard number={8} title="Application settings">
          <FieldGrid>
            <Field label="Application method" wide>
              <ChoiceGroup<ApplicationMethod>
                value={details.application.method}
                options={[
                  { value: "BHARATPATH", label: "Apply on BharatPath" },
                  { value: "EXTERNAL", label: "External application" },
                ]}
                disabled={disabled}
                ariaLabel="Application method"
                onChange={(method) => setDetail("application", "method", method)}
              />
            </Field>
            {details.application.method === "EXTERNAL" ? (
              <Field
                label="External application URL"
                required
                wide
                error={errors["application.external_url"]}
              >
                <TextInput
                  type="url"
                  maxLength={500}
                  value={details.application.external_url}
                  disabled={disabled}
                  invalid={Boolean(errors["application.external_url"])}
                  ariaLabel="External application URL"
                  placeholder="https://careers.example.com/apply"
                  onChange={(url) => setDetail("application", "external_url", url)}
                />
              </Field>
            ) : null}
            <Field label="Application deadline">
              <DatePicker
                value={details.application.deadline ?? ""}
                disabled={disabled}
                ariaLabel="Application deadline"
                className={inputClasses}
                onChange={(date) => setDetail("application", "deadline", date || null)}
              />
            </Field>
            <Field label="Application email" error={errors["application.email"]}>
              <TextInput
                type="email"
                maxLength={254}
                value={details.application.email}
                disabled={disabled}
                invalid={Boolean(errors["application.email"])}
                ariaLabel="Application email"
                placeholder="careers@example.com"
                onChange={(email) => setDetail("application", "email", email)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-3">
              <CheckboxRow
                label="Resume required"
                checked={details.application.resume_required}
                disabled={disabled}
                onChange={(checked) => setDetail("application", "resume_required", checked)}
              />
              <CheckboxRow
                label="Cover letter required"
                checked={details.application.cover_letter_required}
                disabled={disabled}
                onChange={(checked) =>
                  setDetail("application", "cover_letter_required", checked)
                }
              />
              <CheckboxRow
                label="Portfolio required"
                checked={details.application.portfolio_required}
                disabled={disabled}
                onChange={(checked) => setDetail("application", "portfolio_required", checked)}
              />
            </div>
          </FieldGrid>
        </SectionCard>

        {/* 9. SCREENING QUESTIONS */}
        <SectionCard number={9} title="Screening questions">
          <ScreeningQuestionsField
            value={details.screening_questions}
            errors={errors}
            disabled={disabled}
            onChange={setScreeningQuestions}
          />
        </SectionCard>

        {/* 10. HIRING PROCESS */}
        <SectionCard number={10} title="Hiring process">
          <FieldGrid>
            <Field
              label="Hiring manager / recruiter"
              required
              hint="Seen by your team only."
              error={errors["hiring.hiring_manager"]}
            >
              <TextInput
                value={details.hiring.hiring_manager}
                disabled={disabled}
                invalid={Boolean(errors["hiring.hiring_manager"])}
                ariaLabel="Hiring manager or recruiter"
                placeholder="Priya Sharma"
                onChange={(name) => setDetail("hiring", "hiring_manager", name)}
              />
            </Field>
            <Field label="Priority" reserveHintSpace>
              <ChoiceGroup<Priority>
                value={details.hiring.priority}
                options={[
                  { value: "NORMAL", label: "Normal" },
                  { value: "URGENT", label: "Urgent" },
                ]}
                disabled={disabled}
                ariaLabel="Priority"
                onChange={(priority) => setDetail("hiring", "priority", priority)}
              />
            </Field>
            <Field label="Interview rounds" wide hint="In order, e.g. Technical, HR.">
              <TagInput
                value={details.hiring.interview_rounds}
                max={10}
                disabled={disabled}
                ariaLabel="Interview rounds"
                placeholder="Add a round"
                onChange={(rounds) => setDetail("hiring", "interview_rounds", rounds)}
              />
            </Field>
            <Field label="Expected hiring timeline">
              <SelectInput<HiringTimeline>
                value={details.hiring.timeline}
                options={optionsOf(TIMELINE_LABELS, "Not specified")}
                disabled={disabled}
                ariaLabel="Expected hiring timeline"
                onChange={(timeline) => setDetail("hiring", "timeline", timeline)}
              />
            </Field>
            <Field label="Expected joining date">
              <DatePicker
                value={details.hiring.expected_joining_date ?? ""}
                disabled={disabled}
                ariaLabel="Expected joining date"
                className={inputClasses}
                onChange={(date) =>
                  setDetail("hiring", "expected_joining_date", date || null)
                }
              />
            </Field>
          </FieldGrid>
        </SectionCard>

        {/* 11. EMPLOYER / VISIBILITY SETTINGS */}
        <SectionCard number={11} title="Employer & visibility settings">
          <div className="space-y-5">
            <Field
              label="Job visibility"
              required
              hint={
                details.settings.visibility === "PUBLIC"
                  ? "Listed on the job board for every candidate."
                  : "Live but unlisted: candidates reach it only by a link you share or an invitation."
              }
            >
              <ChoiceGroup<Visibility>
                value={details.settings.visibility}
                options={optionsOf(VISIBILITY_LABELS) as Array<{ value: Visibility; label: string }>}
                disabled={disabled}
                ariaLabel="Job visibility"
                onChange={(visibility) => setDetail("settings", "visibility", visibility)}
              />
            </Field>

            <FieldGrid>
              <CheckboxRow
                label="Featured job"
                hint="Shows a Featured badge on the listing."
                checked={details.settings.featured}
                disabled={disabled}
                onChange={(checked) => setDetail("settings", "featured", checked)}
              />
              {/* Referrals, applicant access and scheduled publishing are
                  stored by the backend but change nothing yet, so they are
                  not offered here. Their values round-trip untouched. */}
            </FieldGrid>

            {/* MINIMUM SCORE - unchanged from the original composer */}
            <Field
              label="Minimum score threshold"
              trailing={
                <span className="text-[15px] font-bold text-[#151b2b]">
                  {values.minScore}
                </span>
              }
              error={errors.minScore}
            >
              <input
                type="range"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={THRESHOLD_STEP}
                value={values.minScore}
                disabled={disabled}
                aria-label="Minimum score threshold"
                aria-valuetext={`Selected score ${values.minScore}`}
                onChange={(event) =>
                  setValue(
                    "minScore",
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="w-full cursor-pointer accent-[#2f5da8] disabled:cursor-not-allowed disabled:opacity-60"
              />

              <div className="mt-1.5 flex justify-between text-[11px] text-[#7b8493]">
                <span>{THRESHOLD_MIN}</span>
                <span>{THRESHOLD_MAX}</span>
              </div>
            </Field>

            {isFormEditable && thresholdSet ? (
              <div className="flex min-h-12 items-center gap-2.5 rounded-[10px] bg-[#edf2fa] px-3.5 py-3" role="status" aria-live="polite">
                <UsersRound
                  size={17}
                  strokeWidth={2}
                  className="shrink-0 text-[#28578f]"
                />

                {isThresholdPreviewLoading ? (
                  <span className="flex items-center gap-2 text-[13px] font-medium leading-[17px] text-[#28578f]">
                    <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
                    Fetching candidates that meet this score…
                  </span>
                ) : (
                  <span className="text-[13px] font-medium leading-[17px] text-[#28578f]">
                    {`${thresholdPreview?.fewer_than_ten
                          ? "Fewer than 10 candidates"
                          : `${thresholdPreview?.approximate_count ?? 0} candidates`} in your pool currently meet this bar`}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* 12. PREVIEW & PUBLISH */}
        <section className="mt-5 rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)] sm:p-6">
          <SectionTitle>
            {isEditing ? "12. Job actions" : "12. Preview & publish"}
          </SectionTitle>

          {isPublished ? (
            <div className="mb-4 rounded-[10px] bg-[#edf2fa] px-4 py-3.5 text-xs leading-[17px] text-[#28578f]">
              This job is live. Pause it before changing its details.
            </div>
          ) : null}

          {isPaused ? (
            <div className="mb-4 rounded-[10px] bg-[#fff7e8] px-4 py-3.5 text-xs leading-[17px] text-[#8a5a00]">
              This job is paused and hidden from candidates. You can update
              its details, publish it again, or close it.
            </div>
          ) : null}

          {isClosed ? (
            <div className="mb-4 rounded-[10px] bg-[#f4f5f7] px-4 py-3.5 text-xs leading-[17px] text-[#5d6673]">
              This job is permanently closed. Duplicate it to create a new
              draft with the same details.
            </div>
          ) : null}

          {canChangeToPublished && hasHydrated && organisation && !canPublish ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-[10px] bg-[#fff7e8] px-4 py-3.5">
              <LockKeyhole
                size={17}
                strokeWidth={2}
                className="mt-0.5 shrink-0 text-[#8a5a00]"
              />

              <p className="text-xs leading-[17px] text-[#8a5a00]">
                Publishing is locked until your
                business verification is approved.
                You can save this as a draft now
                and publish the moment you&apos;re
                cleared.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex min-w-[150px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-[#e1e5ea] bg-white px-4 py-3 text-sm font-semibold text-[#151b2b] transition hover:bg-[#f7f8fa]"
            >
              <Eye aria-hidden="true" size={16} />
              Preview job
            </button>

            {!isEditing ? (
              <>
                <button
                  type="button"
                  onClick={saveJob}
                  disabled={isSaving}
                  className="flex-1 cursor-pointer rounded-[8px] border border-[#e1e5ea] bg-white px-4 py-3 text-sm font-semibold text-[#151b2b] transition hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Save as draft
                </button>

                <button
                  type="button"
                  onClick={askPublish}
                  disabled={!canPublish || isSaving}
                  className="flex-[1.5] cursor-pointer rounded-[8px] bg-[#151b2b] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#222b3e] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Publish job
                </button>
              </>
            ) : null}

            {isEditing && isFormEditable ? (
              <button
                type="button"
                onClick={saveJob}
                disabled={isSaving}
                className="min-w-[150px] flex-1 cursor-pointer rounded-[8px] border border-[#e1e5ea] bg-white px-4 py-3 text-sm font-semibold text-[#151b2b] transition hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Update job
              </button>
            ) : null}

            {isEditing && canChangeToPublished ? (
              <button
                type="button"
                onClick={askPublish}
                disabled={!canPublish || isSaving}
                className="min-w-[150px] flex-1 cursor-pointer rounded-[8px] bg-[#151b2b] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#222b3e] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Publish job
              </button>
            ) : null}

            {isEditing && isPublished ? (
              <button
                type="button"
                onClick={askPause}
                disabled={isSaving}
                className="min-w-[150px] flex-1 cursor-pointer rounded-[8px] border border-[#e8d7b5] bg-[#fffaf0] px-4 py-3 text-sm font-semibold text-[#8a5a00] transition hover:bg-[#fff4dc] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isPausing ? "Pausing…" : "Pause job"}
              </button>
            ) : null}

            {isEditing && !isClosed ? (
              <button
                type="button"
                onClick={askClose}
                disabled={isSaving}
                className="min-w-[150px] flex-1 cursor-pointer rounded-[8px] border border-[#efc8c4] bg-white px-4 py-3 text-sm font-semibold text-[#b42318] transition hover:bg-[#fff4f2] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Close job
              </button>
            ) : null}

            {isEditing && isClosed ? (
              <button
                type="button"
                onClick={askDuplicate}
                className="inline-flex min-w-[180px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#151b2b] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#222b3e]"
              >
                <Copy aria-hidden="true" size={16} />
                Duplicate job
              </button>
            ) : null}
          </div>

          {isFormEditable ? (
            <button
              type="button"
              onClick={askDiscard}
              disabled={isSaving}
              className="mt-3 cursor-pointer text-[13px] font-semibold text-[#687386] transition hover:text-[#b42318] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isEditing ? "Cancel and discard changes" : "Cancel and discard"}
            </button>
          ) : null}
        </section>

        <Modal
          open={previewOpen}
          title="Job preview"
          description="This is how candidates will see the job. Your team-only details are not shown."
          onClose={() => setPreviewOpen(false)}
          panelClassName="max-w-[980px]"
        >
          <div className="rounded-[12px] bg-[#f7f8fa] p-1">
            <JobDescriptionView
              tone="employer"
              job={jobViewFromForm(values, organisation?.legalName ?? null)}
            />
          </div>
        </Modal>

        {toast ? (
          <div
            role="status"
            className="fixed bottom-5 right-5 rounded-[10px] bg-[#151b2b] px-4 py-3 text-sm font-semibold text-white shadow-lg"
          >
            {toast}
          </div>
        ) : null}

        {dialog}
      </div>
    </main>
  );
}
