import { Skeleton } from "@/components/common/loading";

export default function AdminAuditLoading() {
  return (
    <div className="min-w-0 rounded-[12px] border border-[#e5e8ee] bg-white p-5">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton circle width={28} height={28} />
            <div className="flex-1 space-y-2">
              <Skeleton width="60%" height={12} radius={6} />
              <Skeleton width={180} height={10} radius={6} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
