import { CardSkeletonGrid, Skeleton } from "@/components/common/loading";

/*
 * The Analytics & Outcomes page in outline: four metric cards, the two
 * placement panels and the by-location table. Used by the route's
 * `loading.tsx` and by the page while its data is still loading, so there is
 * no jump between the two.
 */
export function AnalyticsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto max-w-[1280px] space-y-5"
    >
      <span className="sr-only">Loading analytics</span>
      <CardSkeletonGrid count={4} />
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Skeleton height={360} radius={12} />
        <Skeleton height={360} radius={12} />
      </div>
      <Skeleton height={280} radius={12} />
    </div>
  );
}
