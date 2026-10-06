"use client";

import { FormSkeleton } from "@/components/common/loading";
import { StructuredResumeReview } from "./structured-resume-review";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { useGetResumeVersionQuery } from "@/store/student";

import { ErrorNote, PillButton, StepHeader } from "./ui";

interface ReviewStepProps {
  resumeVersionId: string;
  onConfirmed: (confirmedAt: string) => void;
  onStartOver: () => void;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  startOverLabel?: string;
}

/* -------------------------------------------------------------------------
 * Review the structured resume -> edit a section in the drawer -> confirm
 * ---------------------------------------------------------------------- */
export function ReviewStep({
  resumeVersionId,
  onConfirmed,
  onStartOver,
  title = "Review details",
  subtitle = "Nothing is scored until you confirm. Tap anything that looks wrong.",
  confirmLabel = "Confirm",
  startOverLabel = "Use a different resume",
}: Readonly<ReviewStepProps>) {
  const version = useGetResumeVersionQuery(resumeVersionId);

  if (version.isLoading) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader title="Review details" subtitle="Nothing is scored until you confirm." />
        <FormSkeleton fields={5} actions={false} />
      </div>
    );
  }

  if (version.isError || !version.data) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader title="Review details" />
        <ErrorNote>
          {getApiErrorMessage(version.error, "We could not load what we read. Please try again.")}
        </ErrorNote>
        <div className="flex gap-2">
          <PillButton variant="secondary" onClick={onStartOver} className="flex-1">
            Start over
          </PillButton>
          <PillButton onClick={() => void version.refetch()} className="flex-1">
            Try again
          </PillButton>
        </div>
      </div>
    );
  }

  if (version.data.structuredStatus !== "READY" || !version.data.structuredResume) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader title={title} />
        <ErrorNote>
          We could not organise this resume into sections. Try again, or upload the file again.
        </ErrorNote>
        <div className="flex gap-2">
          <PillButton variant="secondary" onClick={onStartOver} className="flex-1">
            {startOverLabel}
          </PillButton>
          <PillButton onClick={() => void version.refetch()} className="flex-1">
            Try again
          </PillButton>
        </div>
      </div>
    );
  }

  return (
    <StructuredResumeReview
      key={version.data.resumeVersionId}
      version={version.data}
      onConfirmed={onConfirmed}
      onStartOver={onStartOver}
      title={title}
      subtitle={subtitle}
      confirmLabel={confirmLabel}
      startOverLabel={startOverLabel}
    />
  );
}
