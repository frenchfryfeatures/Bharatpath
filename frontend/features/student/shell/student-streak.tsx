"use client";

import Link from "next/link";
import { Flame } from "lucide-react";

import { useGetStudentStreakSessionQuery } from "@/store/student";

const widgetClassName =
  "flex h-9 min-w-[58px] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[13px] font-bold tabular-nums";

export function StudentStreak() {
  const { data, isError } = useGetStudentStreakSessionQuery();

  if (isError) {
    return (
      <Link
        href="/student/streak"
        aria-label="View daily streak"
        title="Daily streak unavailable. View streak page."
        className={`${widgetClassName} border-[#E7E0D4] bg-[#F7F4EC] text-[#8A6240] transition-colors hover:border-[#D8C7B0] hover:bg-[#F2ECDF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/30`}
      >
        <Flame size={17} aria-hidden="true" />
        <span aria-hidden="true">!</span>
      </Link>
    );
  }

  if (!data) {
    return (
      <Link
        href="/student/streak"
        aria-label="View daily streak (loading)"
        className={`${widgetClassName} border-[#F3DFC2] bg-[#FFF8EC] text-[#B96A12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/30`}
      >
        <Flame
          size={17}
          className="animate-pulse"
          aria-hidden="true"
        />
        <span className="h-3.5 w-4 animate-pulse rounded bg-[#F3DFC2]" />
      </Link>
    );
  }

  const { currentStreak, longestStreak, pointsBalance } = data;
  const dayLabel = currentStreak === 1 ? "day" : "days";

  return (
    <Link
      href="/student/streak"
      aria-label={`${currentStreak} ${dayLabel} in your current streak`}
      title={`${currentStreak}-day streak | Longest Streak: ${longestStreak} | ${pointsBalance} streak points`}
      className={`${widgetClassName} border-[#F3DFC2] bg-[#FFF8EC] text-[#B96A12] transition-colors hover:border-[#E8C894] hover:bg-[#FFF1D8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/30`}
    >
      <Flame
        size={18}
        fill="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span>{currentStreak}</span>
    </Link>
  );
}
