"use client";

import { ErrorState } from "@/components/ui";
import { useGetEmployerJobQuery } from "@/store/employer/jobs";

import { JobFormSkeleton } from "../../components/job-form-skeleton";
import { mapApiJobToFormValues } from "../job-form-values";
import { JobCreatePage } from "./job-create-page";

export interface JobDuplicatePageProps {
  sourceJobId: string;
}

export function JobDuplicatePage({
  sourceJobId,
}: JobDuplicatePageProps) {
  const {
    data: sourceJob,
    isLoading,
    isError,
    error,
  } = useGetEmployerJobQuery(sourceJobId);

  if (isLoading) {
    return <JobFormSkeleton />;
  }

  if (isError || !sourceJob) {
    return (
      <main className="grid min-h-full place-items-center bg-[#f7f8fa] p-6">
        <ErrorState
          variant="block"
          error={error}
          fallback="Couldn't load the job to duplicate."
        />
      </main>
    );
  }

  return (
    <JobCreatePage
      heading="Duplicate job"
      initialValues={mapApiJobToFormValues(sourceJob)}
    />
  );
}
