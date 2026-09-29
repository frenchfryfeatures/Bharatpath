"use client";

import { JobCreatePage } from "@/features/employer/jobs/create";
import { mapApiJobToFormValues } from "@/features/employer/jobs/create/job-form-values";
import { useGetEmployerJobQuery } from "@/store/employer/jobs";
import { ErrorState } from "@/components/ui";
import { JobFormSkeleton } from "../../components/job-form-skeleton";

export interface JobEditPageProps {
  jobId: string;
}

export function JobEditPage({ jobId }: JobEditPageProps) {
  const {
    data: job,
    isLoading,
    isError,
    error,
  } = useGetEmployerJobQuery(jobId);

  if (isLoading) {
    return <JobFormSkeleton />;
  }

  if (isError || !job) {
    return (
      <main className="grid min-h-full place-items-center bg-[#f7f8fa] p-6">
        <ErrorState
          variant="block"
          error={error}
          fallback="Couldn't load this job."
        />
      </main>
    );
  }

  return (
    <JobCreatePage
      key={jobId}
      heading="Edit job"
      jobId={jobId}
      jobStatus={job.status}
      initialValues={mapApiJobToFormValues(job)}
    />
  );
}
