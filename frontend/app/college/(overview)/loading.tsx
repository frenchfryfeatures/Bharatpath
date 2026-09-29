import { CardSkeletonGrid, Skeleton } from "@/components/common/loading";

export default function CollegeRootLoading() {
  return (
    <div className="flex flex-col gap-4">
      <CardSkeletonGrid count={4} />
      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton height={280} radius={12} />
          <Skeleton height={140} radius={12} />
        </div>
        <Skeleton height={420} radius={12} />
      </div>
    </div>
  );
}
