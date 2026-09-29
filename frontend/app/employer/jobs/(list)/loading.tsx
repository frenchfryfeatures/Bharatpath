import { Skeleton, TableSkeleton } from "@/components/common/loading";

export default function EmployerJobsLoading() {
  return (
    <main className="min-h-full bg-[#f7f8fa]">
      <section className="overflow-hidden rounded-[12px] border border-[#e5e8ed] bg-white">
        <div className="flex items-center gap-2 border-b border-[#edf0f3] px-5 py-3">
          <Skeleton width={230} height={36} radius={8} />
          <Skeleton width={116} height={36} radius={8} />
        </div>
        <TableSkeleton columns={6} rows={8} />
      </section>
    </main>
  );
}
