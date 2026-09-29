import { Skeleton } from "@/components/common/loading";
import { CandidateListSkeleton } from "@/features/employer/candidates/candidate-list-skeleton";

export default function EmployerCandidatesLoading() {
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#f7f8fa]">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[54px] shrink-0 items-center justify-between px-4">
          <Skeleton width={150} height={12} radius={6} />
          <Skeleton width={110} height={10} radius={6} />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-3">
          <CandidateListSkeleton count={7} />
        </div>

        <div className="flex h-[58px] shrink-0 items-center justify-between border-t border-[#e7e9ee] bg-white px-4">
          <Skeleton width={104} height={12} radius={6} />
          <div className="flex items-center gap-4">
            <Skeleton width={118} height={12} radius={6} />
            <Skeleton width={74} height={32} radius={8} />
            <Skeleton width={100} height={28} radius={8} />
          </div>
        </div>
      </main>

      <aside
        aria-hidden="true"
        className="flex h-full w-[268px] shrink-0 flex-col border-l border-[#e7eaef] bg-white"
      >
        <div className="flex flex-col gap-[18px] overflow-hidden px-[18px] pb-[64px] pt-4">
          <Skeleton width={48} height={14} radius={6} />
          <Skeleton width="100%" height={40} radius={10} />

          {[4, 7, 4, 4, 3].map((rowCount, sectionIndex) => (
            <div
              key={sectionIndex}
              className="flex flex-col gap-[10px] border-t border-[#eef0f3] pt-[18px] first:border-t-0 first:pt-0"
            >
              <Skeleton width={sectionIndex === 2 ? 68 : 112} height={10} radius={5} />
              {Array.from({ length: rowCount }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-2 py-1">
                  <Skeleton circle width={16} height={16} />
                  <Skeleton
                    width={72 + ((rowIndex + sectionIndex) % 3) * 18}
                    height={11}
                    radius={5}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
