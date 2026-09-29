"use client";

import { useMemo } from "react";
import { ListChecks } from "lucide-react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectBoardFilter,
  setBoardFilter,
  type BoardFilter,
  useGetStudentApplicationsQuery,
} from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { ApplicationCard, EmptyState } from "@/features/student/components";
import { StudentBoardSkeleton } from "@/features/student/loading";
import { StudentPage } from "@/features/student/shell";

const FILTERS: { key: BoardFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "interview", label: "Interview" },
  { key: "closed", label: "Closed" },
];
const ACTIVE = new Set(["SUBMITTED", "VIEWED", "SHORTLISTED"]);
const INTERVIEWING = new Set(["INTERVIEW", "DECISION", "HIRED"]);
const CLOSED = new Set(["REJECTED", "WITHDRAWN", "EXPIRED"]);

export function ApplicationBoard() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector(selectBoardFilter);
  const applications = useGetStudentApplicationsQuery({ limit: 100 });
  const filtered = useMemo(
    () =>
      (applications.data?.items ?? []).filter((application) => {
        if (filter === "active") return ACTIVE.has(application.stage);
        if (filter === "interview") return INTERVIEWING.has(application.stage);
        if (filter === "closed") return CLOSED.has(application.stage);
        return true;
      }),
    [applications.data?.items, filter],
  );

  if (applications.isLoading) {
    return <StudentBoardSkeleton />;
  }

  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <span className="text-[24px] font-bold leading-7 tracking-[-0.025em] text-[#0A1931] sm:text-[28px]">
            Your board
          </span>
          <div className="bp-scrollbar flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => dispatch(setBoardFilter(tab.key))}
                className={[
                  "cursor-pointer whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
                  filter === tab.key
                    ? "border border-[#C9BEEB] bg-[#F1EAF7] text-[#4A3E8F] hover:bg-[#E8DEF3]"
                    : "border border-[#E7E0D4] bg-white text-[#0A1931] hover:border-[#C9BEEB] hover:bg-[#F7F4EC]",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {applications.error ? (
          <EmptyState
            icon={<ListChecks size={22} />}
            title="Applications unavailable"
            message={getApiErrorMessage(
              applications.error,
              "Could not load applications.",
            )}
          />
        ) : filtered.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
              />
            ))}
          </div>
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
