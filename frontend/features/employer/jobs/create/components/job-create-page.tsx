"use client";

import {
  ArrowLeft,
  Copy,
  Loader2,
  LockKeyhole,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ConfigurableForm } from "@/components/forms/configurable-form";
import type { FormFieldConfig } from "@/components/forms/configurable-form.types";
import { usePageHeader } from "@/components/layout/header-context";
import { useConfirmDialog } from "@/features/employer/components/use-confirm-dialog";
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
import { JobSkillsField } from "./job-skills-field";
import {
  useCloseEmployerJobMutation,
  useCreateEmployerJobMutation,
  usePauseEmployerJobMutation,
  usePublishEmployerJobMutation,
  usePreviewEmployerJobThresholdQuery,
  useUpdateEmployerJobMutation,
} from "@/store/employer/jobs";
import { useGetEmployerOrganisationQuery } from "@/store/employer/settings";
import type { ApiJobStatus } from "../../types";

const employmentOptions = [
  {
    label: "Full time",
    value: "Full time",
  },
  {
    label: "Part time",
    value: "Part time",
  },
  {
    label: "Contract",
    value: "Contract",
  },
];

const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

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
  const currentStatus = statusOverride ?? jobStatus;
  const { confirm, dialog } = useConfirmDialog();
  const isEditing = Boolean(jobId);
  const isDraft = currentStatus === "DRAFT";
  const isPublished = currentStatus === "PUBLISHED";
  const isPaused = currentStatus === "PAUSED";
  const isClosed = currentStatus === "CLOSED";
  const isFormEditable = !isEditing || isDraft || isPaused;
  const canChangeToPublished = !isEditing || isDraft || isPaused;

  const {
    values,
    errors,
    setValue,
    validate,
  } = useJobCreateForm(initialValues);
  const { data: organisation } = useGetEmployerOrganisationQuery(undefined, {
    skip: !canChangeToPublished,
  });
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

  const fields: Array<
    FormFieldConfig<CreateJobFormValues>
  > = [
      {
        name: "title",
        label: "Job title",
        type: "text",
        placeholder: "Lab Analyst Trainee",
        required: true,
        colSpan: 2,
      },
      {
        name: "employmentType",
        label: "Employment type",
        type: "select",
        options: employmentOptions,
        required: true,
      },
      {
        name: "location",
        label: "Location",
        type: "text",
        placeholder: "Kothrud, Pune",
        required: true,
      },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        placeholder:
          "What will this person do day to day?",
        required: true,
        colSpan: 2,
      },
    ];

  const showToast = (message: string) => {
    setToast(message);

    window.setTimeout(
      () => setToast(null),
      2200,
    );
  };

  const saveJob = async () => {
    if (!validate()) return;
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
    if (!canPublish || !validate()) return;

    confirm({
      title: "Publish this job?",
      description:
        "Matching candidates will be able to see and apply to this job straight away.",
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

  const duplicateJob = () => {
    if (!jobId) return;
    router.push(
      `/employer/jobs/create?duplicateFrom=${encodeURIComponent(jobId)}`,
    );
  };

  return (
    <main className="min-h-full bg-[#f7f8fa]">
      <div className="w-full max-w-[800px]">
        <button
          type="button"
          onClick={() =>
            router.push("/employer/jobs")
          }
          className="mb-5 inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-[#283247] hover:text-[#151b2b]"
        >
          <ArrowLeft
            size={16}
            strokeWidth={2}
          />

          Back to jobs
        </button>

        {/* BASICS */}
        <section className="rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)] sm:p-6">
          <SectionTitle>
            Basics
          </SectionTitle>

          <ConfigurableForm<CreateJobFormValues>
            values={values}
            fields={fields}
            errors={errors}
            disabled={!isFormEditable}
            onChange={(name, value) =>
              setValue(
                name,
                value as CreateJobFormValues[typeof name],
              )
            }
            validate={(formValues) => {
              const next = {
                title: !String(
                  formValues.title ?? "",
                ).trim()
                  ? "Job title is required."
                  : undefined,

                location: !String(
                  formValues.location ?? "",
                ).trim()
                  ? "Location is required."
                  : undefined,

                description: !String(
                  formValues.description ?? "",
                ).trim()
                  ? "Description is required."
                  : undefined,
              };

              return Object.fromEntries(
                Object.entries(next).filter(
                  ([, message]) => message,
                ),
              ) as Partial<
                Record<
                  keyof CreateJobFormValues &
                  string,
                  string
                >
              >;
            }}
            onSubmit={() => undefined}
          />
        </section>

        {/* REQUIREMENTS & PAY */}
        <section className="mt-5 rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)] sm:p-6">
          <SectionTitle>
            Requirements &amp; pay
          </SectionTitle>

          <div className="space-y-5">
            <JobSkillsField
              value={values.skills}
              error={errors.skills}
              disabled={!isFormEditable}
              onChange={(skills) =>
                setValue("skills", skills)
              }
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldShell
                label="Salary min (₹/month)"
                error={errors.salaryMin}
              >
                <input
                  type="number"
                  min={0}
                  disabled={!isFormEditable}
                  value={values.salaryMin}
                  onChange={(event) =>
                    setValue(
                      "salaryMin",
                      event.target.value === ""
                        ? ""
                        : Number(
                          event.target.value,
                        ),
                    )
                  }
                  className={inputClasses}
                />
              </FieldShell>

              <FieldShell
                label="Salary max (₹/month)"
                error={errors.salaryMax}
              >
                <input
                  type="number"
                  min={0}
                  disabled={!isFormEditable}
                  value={values.salaryMax}
                  onChange={(event) =>
                    setValue(
                      "salaryMax",
                      event.target.value === ""
                        ? ""
                        : Number(
                          event.target.value,
                        ),
                    )
                  }
                  className={inputClasses}
                />
              </FieldShell>
            </div>

            <FieldShell
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
                disabled={!isFormEditable}
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
            </FieldShell>

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
        </section>

        {/* REVIEW & PUBLISH */}
        <section className="mt-5 rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)] sm:p-6">
          <SectionTitle>
            {isEditing ? "Job actions" : "Review & publish"}
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
        </section>

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

function SectionTitle({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.06em] text-[#687386]">
      {children}
    </h2>
  );
}

function FieldShell({
  label,
  error,
  trailing,
  children,
}: {
  label: string;
  error?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[12px] font-semibold leading-4 text-[#687386]">
        <span>{label}</span>

        {trailing}
      </span>

      {children}

      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-[#b42318]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

const inputClasses =
  "w-full rounded-[10px] border border-[#e1e5ea] bg-white px-4 py-3 text-[14px] font-medium leading-5 text-[#151b2b] outline-none transition focus:border-[#2f5da8] focus:ring-2 focus:ring-[#2f5da8]/10 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]";
