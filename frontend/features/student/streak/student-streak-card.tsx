"use client";

import Link from "next/link";
import { Flame } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { useGetStudentStreakSessionQuery } from "@/store/student";

import { statusClasses, statusLabel } from "./streak-utils";
import { StudentErrorState } from "@/features/student/components/student-error-state";

export function StudentStreakCard() {
  const streak = useGetStudentStreakSessionQuery();

  if (streak.isLoading) {
    return <StudentStreakCardSkeleton />;
  }

  if (streak.error || !streak.data) {
    return (
      <div className="flex min-h-44 flex-col justify-between gap-5 rounded-[24px] border border-[#E7E0D4] bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2 text-[#5F6B80]">
          <Flame size={16} className="text-[#F97316]" aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
            Daily streak
          </span>
        </div>
        <StudentErrorState
          variant="inline"
          error={streak.error}
          fallback="We could not load your daily streak."
          onRetry={() => void streak.refetch()}
        />
      </div>
    );
  }

  const data = streak.data;
  const dayLabel = data.currentStreak === 1 ? "day" : "days";

  return (
    <Link
      href="/student/streak"
      aria-label="Open daily streak details"
      className="group block h-full overflow-hidden rounded-[24px] border border-[#E7E0D4] bg-white shadow-[0_5px_18px_rgba(10,25,49,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#D8C7B0] hover:shadow-[0_12px_30px_rgba(10,25,49,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
    >
      <span className="flex h-full flex-col gap-6 p-5 sm:p-6">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[#5F6B80]">
            <Flame size={16} className="text-[#F97316]" aria-hidden="true" />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
              Daily streak
            </span>
          </span>
          <span
            className={[
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
              statusClasses(data.status),
            ].join(" ")}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {statusLabel(data.status)}
          </span>
        </span>

        <span className="grid flex-1 grid-cols-[auto_minmax(0,1fr)] content-center items-center gap-4 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          <span className="grid h-16 w-16 place-items-center rounded-full border border-[#F3D6B4] bg-[#FFF5E8] text-[#F97316] sm:h-[72px] sm:w-[72px]">
            <Flame
              size={36}
              fill="currentColor"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          </span>
          <span className="min-w-0">
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-[34px] font-extrabold leading-none tracking-[-0.04em] text-[#0A1931] sm:text-[42px]">
                {data.currentStreak}
              </span>
              <span className="text-[17px] font-semibold tracking-normal text-[#3A4761] sm:text-[19px] xl:text-[16px]">
                {dayLabel} streak
              </span>
            </span>
            <span className="mt-2 block text-[12px] text-[#5F6B80]">
              Personal best: {data.longestStreak}{" "}
              {data.longestStreak === 1 ? "day" : "days"}
            </span>
          </span>
          <span className="col-span-2 flex items-end justify-between border-t border-[#F0EBDF] pt-4 xl:col-span-1 xl:block xl:w-[112px] xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0 xl:text-right">
            <span className="block text-[26px] font-bold leading-none text-[#0A1931]">
              {data.pointsBalance}
              <span className="ml-1 text-[14px] font-semibold text-[#3A4761]">
                pts
              </span>
            </span>
            <span className="mt-1 block text-[11px] text-[#5F6B80]">
              Engagement balance
            </span>
          </span>
        </span>
      </span>
    </Link>
  );
}

function StudentStreakCardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="h-full min-h-48 overflow-hidden rounded-[24px] border border-[#E7E0D4] bg-white"
    >
      <span className="sr-only">Loading daily streak</span>
      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="flex justify-between gap-3">
          <Skeleton width={112} height={12} radius={6} />
          <Skeleton width={142} height={28} radius={999} />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton width={72} height={72} circle />
          <div className="flex-1">
            <Skeleton width="55%" height={36} radius={8} />
            <Skeleton className="mt-2" width={118} height={11} radius={5} />
          </div>
        </div>
      </div>
    </div>
  );
}
