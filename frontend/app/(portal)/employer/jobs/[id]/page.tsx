import { JobViewPage } from "@/features/employer/jobs/view";

export default async function EmployerJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <JobViewPage jobId={id} />;
}
