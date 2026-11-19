import { Skeleton } from "@/components/common/loading";
import { ApplicationsPipelineSkeleton } from "@/features/employer/applications";

export default function EmployerApplicationsLoading() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#f8f9fb] p-4">
      <div className="flex shrink-0 items-center gap-3 pb-4">
        <Skeleton width={178} height={36} radius={8} />
        <Skeleton width={72} height={12} radius={6} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ApplicationsPipelineSkeleton />
      </div>
    </div>
  );
}
