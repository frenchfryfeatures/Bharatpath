import { Skeleton, TableSkeleton } from "@/components/common/loading";

export default function AdminQueueLoading() {
  return (
    <div className="min-w-0 space-y-0">
      <div className="flex h-[42px] items-center gap-1 border-b border-[#e7e9ee]">
        <Skeleton className="mx-4" width={62} height={12} radius={6} />
        <Skeleton className="mx-4" width={76} height={12} radius={6} />
      </div>

      <div className="pt-4">
        <Skeleton width={190} height={11} radius={6} />
      </div>

      <div className="pt-4">
        <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white">
          <TableSkeleton columns={5} rows={8} />
        </div>
      </div>
    </div>
  );
}
