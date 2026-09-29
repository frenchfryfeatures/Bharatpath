"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";
import { Check, Search } from "lucide-react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectJobQualifiedOnly,
  selectJobSearch,
  selectJobWorkMode,
  setJobSearch,
  setJobWorkMode,
  toggleQualifiedOnly,
  useLazyGetStudentJobsQuery,
} from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";
import { EmptyState, JobCard } from "@/features/student/components";
import { StudentJobGridSkeleton } from "@/features/student/loading";
import { StudentPage } from "@/features/student/shell";

const WORK_MODES = ["ONSITE", "HYBRID", "REMOTE"] as const;
const JOBS_PAGE_SIZE = 10;

export function JobFeed() {
  const dispatch = useAppDispatch();
  const search = useAppSelector(selectJobSearch);
  const debouncedSearch = useDebouncedSearch(search);
  const qualifiedOnly = useAppSelector(selectJobQualifiedOnly);
  const workMode = useAppSelector(selectJobWorkMode);
  const [fetchJobs] = useLazyGetStudentJobsQuery();
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const jobs = useCursorLoadMore(
    useCallback(
      (cursor: string | undefined) =>
        fetchJobs({
          q: debouncedSearch || undefined,
          workMode: workMode ?? undefined,
          eligibleOnly: qualifiedOnly,
          cursor,
          limit: JOBS_PAGE_SIZE,
        }).unwrap(),
      [fetchJobs, debouncedSearch, workMode, qualifiedOnly],
    ),
    [debouncedSearch, workMode, qualifiedOnly],
  );
  const loadMoreFromObserver = useEffectEvent(jobs.loadMore);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      !sentinel ||
      !jobs.hasMore ||
      jobs.isLoading ||
      jobs.isLoadingMore ||
      jobs.error
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadMoreFromObserver();
        }
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [jobs.error, jobs.hasMore, jobs.isLoading, jobs.isLoadingMore]);

  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <span className="text-[24px] font-bold leading-7 tracking-[-0.025em] text-[#0A1931] sm:text-[28px]">
            Jobs
          </span>
          <label className="flex items-center gap-3 rounded-full border border-[#E7E0D4] bg-white px-4 py-3">
            <Search size={16} className="text-[#5F6B80]" />
            <input
              value={search}
              onChange={(event) => dispatch(setJobSearch(event.target.value))}
              placeholder="Role, company or skill"
              aria-label="Search jobs"
              className="flex-1 bg-transparent text-[15px] leading-5 text-[#0A1931] outline-none placeholder:text-[#8891a0]"
            />
          </label>
          <div className="bp-scrollbar flex gap-2 overflow-x-auto pb-1">
            <FilterButton
              active={qualifiedOnly}
              onClick={() => dispatch(toggleQualifiedOnly())}
            >
              {qualifiedOnly ? <Check size={11} /> : null}
              I qualify
            </FilterButton>
            {WORK_MODES.map((mode) => (
              <FilterButton
                key={mode}
                active={workMode === mode}
                onClick={() => dispatch(setJobWorkMode(mode))}
              >
                {mode[0] + mode.slice(1).toLowerCase()}
              </FilterButton>
            ))}
          </div>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-[#5F6B80]">
            {jobs.items.length} jobs
          </span>
        </div>

        {jobs.isLoading ? (
          <StudentJobGridSkeleton count={6} />
        ) : jobs.error && !jobs.items.length ? (
          <EmptyState
            icon={<Search size={22} />}
            title="Jobs unavailable"
            message={getApiErrorMessage(jobs.error, "Could not load jobs.")}
          />
        ) : jobs.items.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {jobs.items.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>

            {jobs.isLoadingMore ? (
              <StudentJobGridSkeleton
                label="Loading more jobs"
              />
            ) : null}

            {jobs.error && jobs.hasMore ? (
              <div className="flex flex-col items-center gap-2 pt-1">
                <span className="text-[13px] text-[#5F6B80]">
                  Could not load more jobs.
                </span>
                <button
                  type="button"
                  onClick={jobs.loadMore}
                  className="rounded-full border border-[#E7E0D4] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0A1931] transition-colors hover:bg-[#F7F3EC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Try again
                </button>
              </div>
            ) : null}

            <div
              ref={loadMoreSentinelRef}
              aria-hidden="true"
              className="h-px w-full"
            />
          </>
        ) : (
          <EmptyState
            icon={<Search size={22} />}
            title="No jobs match"
            message="Try clearing a filter or changing your search."
          />
        )}
      </div>
    </StudentPage>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
        active
          ? "border border-[#C9BEEB] bg-[#F1EAF7] text-[#4A3E8F] hover:bg-[#E8DEF3]"
          : "border border-[#E7E0D4] bg-white text-[#0A1931] hover:border-[#C9BEEB] hover:bg-[#F7F4EC]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
