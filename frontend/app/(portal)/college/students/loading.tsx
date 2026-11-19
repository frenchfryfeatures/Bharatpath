import { Skeleton, TableSkeleton } from "@/components/common/loading";

export default function CollegeStudentsLoading() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
      {/* Filter & search bar */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton width={300} height={38} radius={10} />
        <Skeleton width={160} height={36} radius={10} />
      </div>

      {/* Roster table */}
      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white">
        <TableSkeleton columns={5} rows={8} />
      </div>

      {/* Bottom cards */}
      <div className="grid grid-cols-1 gap-5 pt-1 md:grid-cols-2">
        <Skeleton height={200} radius={16} />
        <Skeleton height={200} radius={16} />
      </div>

      {/* Roster imports and referral codes */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton height={216} radius={16} />
        <Skeleton height={188} radius={16} />
      </div>
    </div>
  );
}
