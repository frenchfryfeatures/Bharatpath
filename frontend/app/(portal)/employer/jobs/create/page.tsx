import {
  JobCreatePage,
  JobDuplicatePage,
} from "@/features/employer/jobs/create";

export default async function CreateJobPage({
  searchParams,
}: {
  searchParams: Promise<{
    duplicateFrom?: string | string[];
  }>;
}) {
  const { duplicateFrom } = await searchParams;
  const sourceJobId =
    typeof duplicateFrom === "string"
      ? duplicateFrom
      : undefined;

  if (sourceJobId) {
    return (
      <JobDuplicatePage
        sourceJobId={sourceJobId}
      />
    );
  }

  return <JobCreatePage />;
}
