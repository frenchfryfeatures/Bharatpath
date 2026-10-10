"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ListChecks } from "lucide-react";

import { useLazyGetStudentApplicationsQuery } from "@/store/student";
import { ApplicationCard, EmptyState, StudentErrorState } from "@/features/student/components";
import { StudentApplicationCardSkeleton, StudentApplicationGridSkeleton } from "@/features/student/loading";
import { StudentPage } from "@/features/student/shell";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";

const APPLICATIONS_PAGE_SIZE = 20;
const FILTERS = [{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "closed", label: "Closed" }] as const;

export function ApplicationBoard() {
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
  const [fetchApplications] = useLazyGetStudentApplicationsQuery();
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const applications = useCursorLoadMore(
    useCallback(
      (cursor: string | undefined) =>
        fetchApplications({
          cursor,
          limit: APPLICATIONS_PAGE_SIZE,
          status: filter === "all" ? undefined : filter.toUpperCase() as "ACTIVE" | "CLOSED",
        }).unwrap(),
      [fetchApplications, filter],
    ),
    [filter],
  );
  const loadMoreFromObserver = useEffectEvent(applications.loadMore);
  const visibleApplications = applications.items;

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      !sentinel ||
      !applications.hasMore ||
      applications.isLoading ||
      applications.isLoadingMore ||
      applications.error
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
  }, [
    applications.error,
    applications.hasMore,
    applications.isLoading,
    applications.isLoadingMore,
  ]);

  return (
    <StudentPage
      className={
        applications.isLoading ? "flex min-h-[calc(100dvh-5rem)] flex-col" : ""
      }
    >
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <div className="bp-scrollbar flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/40 ${filter === option.value ? "border-[#C9BEEB] bg-[#F1EAF7] text-[#4A3E8F]" : "border-[#E7E0D4] bg-white text-[#5F6B80] hover:bg-[#F7F3EC]"}`}>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {!applications.isLoading && (
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-[#5F6B80]">
              {visibleApplications.length} {filter === "all" ? "" : `${filter} `}{visibleApplications.length === 1 ? "application" : "applications"}
            </span>
          </div>
        )}

        {applications.isLoading ? (
          <StudentApplicationGridSkeleton count={6} label="Loading your board" />
        ) : applications.error && !applications.items.length ? (
          <StudentErrorState
            icon={<ListChecks size={22} />}
            title="Applications unavailable"
            error={applications.error}
            fallback="Could not load applications."
          />
        ) : applications.items.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleApplications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                />
              ))}
              {applications.isLoadingMore ? (
                <>
                  <span role="status" className="sr-only">Loading more applications</span>
                  {Array.from({ length: 2 }).map((_, index) => <StudentApplicationCardSkeleton key={`loading-${index}`} />)}
                </>
              ) : null}
            </div>
            {!visibleApplications.length ? (
              <EmptyState icon={<ListChecks size={22} />} title={`No ${filter} applications${applications.hasMore ? " loaded yet" : ""}`} message={applications.hasMore ? "Checking more applications for this filter." : "Applications in this category will appear here."} />
            ) : null}

            {applications.error && applications.hasMore ? (
              <div className="flex flex-col items-center gap-2 pt-1">
                <span className="text-[13px] text-[#5F6B80]">
                  Could not load more applications.
                </span>
                <button
                  type="button"
                  onClick={applications.loadMore}
                  className="rounded-full border border-[#E7E0D4] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0A1931] transition-colors hover:bg-[#F7F3EC]"
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
            icon={<ListChecks size={22} />}
            title="Nothing here yet"
            message="Apply to a job and its live status will appear here."
          />
        )}
      </div>
    </StudentPage>
  );
}
