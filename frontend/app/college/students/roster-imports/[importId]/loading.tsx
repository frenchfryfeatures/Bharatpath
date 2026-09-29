import { Skeleton, TableSkeleton } from "@/components/common/loading";

export default function RosterImportRowsLoading() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton width={140} height={30} radius={8} />
        <Skeleton width={220} height={14} radius={6} />
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 sm:p-5">
        <div className="mb-3 flex gap-1.5">
          {[64, 76, 84, 96].map((width) => (
            <Skeleton key={width} width={width} height={26} radius={999} />
          ))}
        </div>
        <TableSkeleton columns={5} rows={10} />
      </div>
    </div>
  );
}
