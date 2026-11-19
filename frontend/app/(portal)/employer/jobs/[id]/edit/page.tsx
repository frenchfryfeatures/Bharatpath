import { JobEditPage } from "@/features/employer/jobs/edit";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <JobEditPage jobId={id} />;
}
