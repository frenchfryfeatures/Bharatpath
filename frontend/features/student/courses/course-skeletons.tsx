import { Skeleton } from "@/components/common/loading";
import { StudentPage } from "@/features/student/shell";

export function CourseListSkeleton() {
  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        <div className="flex h-10 items-center gap-3"><Skeleton circle width={40} height={40} /><Skeleton width={135} height={20} radius={7} /></div>
        <Skeleton width="62%" height={15} radius={6} />
        <CourseGridSkeleton />
      </div>
    </StudentPage>
  );
}

export function CourseGridSkeleton() {
  return (
    <div role="status" aria-label="Loading courses" className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-5 rounded-[20px] border border-[#E7E0D4] bg-white p-5">
          <div className="flex items-center gap-3">
            <Skeleton width={46} height={46} radius={12} />
            <div className="flex-1"><Skeleton width="64%" height={19} radius={7} /><Skeleton className="mt-2" width="35%" height={12} radius={6} /></div>
            <Skeleton width={70} height={26} radius={999} />
          </div>
          <Skeleton width={120} height={25} radius={999} />
          <Skeleton width={125} height={42} radius={999} />
        </div>
      ))}
    </div>
  );
}

export function CourseDetailSkeleton() {
  return <StudentPage><div role="status" aria-label="Loading course"><div className="mb-5 flex h-10 items-center gap-3"><Skeleton circle width={40} height={40} /><Skeleton width={160} height={20} radius={7} /></div><div className="rounded-[20px] border border-[#E7E0D4] bg-white p-5"><Skeleton width={88} height={23} radius={999} /><Skeleton className="mt-4" width="48%" height={26} /><Skeleton className="mt-3" width="70%" height={13} /><Skeleton className="mt-6" width="100%" height={6} /></div><div className="mt-5 space-y-3">{Array.from({ length: 2 }).map((_, index) => <div key={index} className="rounded-[20px] border border-[#E7E0D4] bg-white p-5"><Skeleton width="35%" height={19} /><Skeleton className="mt-5" width="80%" height={14} /><Skeleton className="mt-4" width="65%" height={14} /></div>)}</div></div></StudentPage>;
}
