import { CardSkeletonGrid, ListSkeleton } from "@/components/common/loading";
import {
  IntakeClearedSkeleton,
  PlatformTotalsSkeleton,
} from "@/features/admin/dashboard/components";

export default function AdminDashboardLoading() {
  return (
    <div className="min-w-0 space-y-5">
      <CardSkeletonGrid count={4} />
      <div className="grid min-w-0 items-stretch gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ListSkeleton rows={5} />
        <div className="flex min-w-0 flex-col gap-4">
          <PlatformTotalsSkeleton />
          <IntakeClearedSkeleton />
        </div>
      </div>
    </div>
  );
}
