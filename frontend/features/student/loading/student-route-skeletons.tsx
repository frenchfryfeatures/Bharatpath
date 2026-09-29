import { Skeleton, SkeletonText } from "@/components/common/loading";
import { StudentPage } from "@/features/student/shell/student-page";

function LoadingRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function TopBarSkeleton({ actions = false }: { actions?: boolean }) {
  return (
    <div className="mb-5 flex h-10 items-center gap-3">
      <Skeleton circle width={40} height={40} />
      <Skeleton className="flex-1" width="32%" height={20} radius={7} />
      {actions ? (
        <div className="flex gap-2">
          <Skeleton circle width={40} height={40} />
          <Skeleton circle width={40} height={40} />
        </div>
      ) : null}
    </div>
  );
}

function ApplicationCardSkeleton() {
  return (
    <div className="flex min-h-[116px] flex-col gap-3 rounded-[20px] border border-[#E7E0D4] bg-white p-4">
      <div className="flex items-center gap-3">
        <Skeleton width={40} height={40} radius={14} />
        <div className="min-w-0 flex-1">
          <Skeleton width="58%" height={15} radius={6} />
          <Skeleton className="mt-2" width="76%" height={11} radius={6} />
        </div>
        <Skeleton width={72} height={24} radius={999} />
      </div>
      <div className="mt-auto grid grid-cols-5 gap-1">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} height={4} radius={999} />
        ))}
      </div>
      <div className="flex justify-between">
        <Skeleton width={64} height={10} radius={5} />
        <Skeleton width={72} height={10} radius={5} />
      </div>
    </div>
  );
}

export function StudentJobGridSkeleton({
  count = 3,
  label = "Loading jobs",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex min-h-[166px] flex-col gap-3.5 rounded-[20px] border border-[#E7E0D4] bg-white p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton width={44} height={44} radius={14} />
            <div className="min-w-0 flex-1">
              <Skeleton width="68%" height={16} radius={6} />
              <Skeleton className="mt-2" width="52%" height={12} radius={6} />
            </div>
            <Skeleton circle width={36} height={36} />
          </div>
          <div className="flex items-center gap-2.5">
            <Skeleton width={88} height={13} radius={6} />
            <Skeleton width={72} height={13} radius={6} />
            <Skeleton width={54} height={13} radius={6} />
          </div>
          <div className="mt-auto flex items-center gap-2 border-t border-[#F0EBDF] pt-3">
            <Skeleton circle width={14} height={14} />
            <Skeleton className="flex-1" width="42%" height={11} radius={6} />
            <Skeleton width={62} height={24} radius={999} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StudentBoardSkeleton() {
  return (
    <StudentPage>
      <LoadingRegion label="Loading applications">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3.5">
            <Skeleton width={164} height={28} radius={8} />
            <div className="flex gap-2">
              {[52, 68, 88, 72].map((width) => (
                <Skeleton key={width} width={width} height={36} radius={999} />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <ApplicationCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </LoadingRegion>
    </StudentPage>
  );
}

export function StudentApplicationDetailSkeleton() {
  return (
    <StudentPage>
      <LoadingRegion label="Loading application">
        <TopBarSkeleton />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Skeleton width={48} height={48} radius={14} />
              <div className="flex-1">
                <Skeleton width="42%" height={15} radius={6} />
                <Skeleton className="mt-2" width="30%" height={11} radius={6} />
              </div>
              <Skeleton width={82} height={24} radius={999} />
            </div>
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
              <Skeleton width={148} height={15} radius={6} />
              <div className="mt-5 space-y-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton circle width={24} height={24} />
                    <Skeleton
                      width={index === 3 ? "38%" : "28%"}
                      height={12}
                      radius={6}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
              <Skeleton width={72} height={15} radius={6} />
              <SkeletonText className="mt-4" lines={3} lastLineWidth="54%" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
              <Skeleton width={138} height={11} radius={5} />
              <Skeleton className="mt-3" width="68%" height={20} radius={7} />
              <Skeleton className="mt-4" width={112} height={14} radius={6} />
            </div>
            <Skeleton height={52} radius={999} />
            <Skeleton height={52} radius={999} />
          </div>
        </div>
      </LoadingRegion>
    </StudentPage>
  );
}

export function StudentJobDetailSkeleton() {
  return (
    <StudentPage>
      <LoadingRegion label="Loading job">
        <TopBarSkeleton actions />
        <div className="flex min-h-40 flex-col justify-between rounded-[24px] bg-[#5F4DB2] p-5 sm:p-6">
          <div className="flex items-center gap-3.5">
            <Skeleton
              className="opacity-55"
              width={56}
              height={56}
              radius={16}
            />
            <div className="flex-1">
              <Skeleton
                className="opacity-55"
                width="42%"
                height={22}
                radius={7}
              />
              <Skeleton
                className="mt-2 opacity-55"
                width="28%"
                height={12}
                radius={6}
              />
            </div>
          </div>
          <Skeleton
            className="opacity-55"
            width={118}
            height={24}
            radius={999}
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="flex flex-col gap-3.5">
            <div className="flex gap-2">
              <Skeleton width={112} height={32} radius={999} />
              <Skeleton width={88} height={32} radius={999} />
            </div>
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
              <Skeleton width={112} height={16} radius={6} />
              <SkeletonText className="mt-4" lines={4} lastLineWidth="48%" />
            </div>
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
              <Skeleton width={64} height={16} radius={6} />
              <div className="mt-4 flex flex-wrap gap-2">
                {[82, 96, 74, 106].map((width) => (
                  <Skeleton key={width} width={width} height={32} radius={999} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
              <Skeleton width="72%" height={20} radius={7} />
              <Skeleton className="mt-3" width="56%" height={11} radius={6} />
            </div>
            <Skeleton height={52} radius={999} />
          </div>
        </div>
      </LoadingRegion>
    </StudentPage>
  );
}

function ProfileRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4">
      <Skeleton circle width={20} height={20} />
      <div className="flex-1">
        <Skeleton width="38%" height={14} radius={6} />
        <Skeleton className="mt-2" width="62%" height={11} radius={6} />
      </div>
    </div>
  );
}

export function StudentProfileSkeleton() {
  return (
    <StudentPage>
      <LoadingRegion label="Loading profile">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Skeleton circle width={56} height={56} />
            <div className="flex-1">
              <Skeleton width={180} height={22} radius={7} />
              <Skeleton className="mt-2" width={124} height={12} radius={6} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:max-w-md">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-[#E7E0D4] bg-white p-3"
              >
                <Skeleton width="48%" height={22} radius={7} />
                <Skeleton className="mt-2" width="72%" height={11} radius={6} />
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Skeleton width={132} height={12} radius={6} />
              <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-4">
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index}>
                      <Skeleton width={72} height={11} radius={5} />
                      <Skeleton className="mt-2" height={42} radius={12} />
                    </div>
                  ))}
                </div>
                <Skeleton className="mt-4" height={52} radius={999} />
              </div>
              <ProfileRowSkeleton />
              <ProfileRowSkeleton />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton width={124} height={12} radius={6} />
              <ProfileRowSkeleton />
              <ProfileRowSkeleton />
              <ProfileRowSkeleton />
            </div>
          </div>
        </div>
      </LoadingRegion>
    </StudentPage>
  );
}
