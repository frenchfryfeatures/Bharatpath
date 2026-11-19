import { CardSkeletonGrid, Skeleton } from "@/components/common/loading";

export default function EmployerDashboardLoading() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CardSkeletonGrid count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)]">
        <Skeleton height={300} radius={12} />
        <Skeleton height={520} radius={12} />
      </div>
    </div>
  );
}
