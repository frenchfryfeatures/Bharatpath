import { Skeleton, TableSkeleton } from "@/components/common/loading";

export default function AdminUsersLoading() {
  return (
    <div className="min-w-0 space-y-0">
      <div className="py-4">
        <Skeleton width={246} height={38} radius={8} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white">
        <TableSkeleton columns={6} rows={9} />
      </div>
    </div>
  );
}
