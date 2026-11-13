import { FormSkeleton, Skeleton } from "@/components/common/loading";

export default function AdminSettingsLoading() {
  return (
    <div className="min-w-0">
      <div className="flex h-[42px] items-center gap-1 border-b border-[#e7e9ee]">
        <Skeleton className="mx-4" width={86} height={12} radius={6} />
        <Skeleton className="mx-4" width={54} height={12} radius={6} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,348px)]">
        <FormSkeleton fields={3} />
        <Skeleton height={220} radius={12} />
      </div>
    </div>
  );
}
