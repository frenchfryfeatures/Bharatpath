"use client";

import { useEffect } from "react";
import { Flame, RefreshCw } from "lucide-react";

import { useCheckInStudentStreakMutation } from "@/store/student";

const widgetClassName =
  "flex h-9 min-w-[58px] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[13px] font-bold tabular-nums";

export function StudentStreak() {
  const [checkIn, { data, isLoading, isError }] =
    useCheckInStudentStreakMutation();

  useEffect(() => {
    void checkIn();
  }, [checkIn]);

  if (isError) {
    return (
      <button
        type="button"
        onClick={() => void checkIn()}
        aria-label="Daily streak unavailable. Try again."
        title="Daily streak unavailable. Try again."
        className={`${widgetClassName} border-[#E7E0D4] bg-[#F7F4EC] text-[#8A6240] transition-colors hover:border-[#D8C7B0] hover:bg-[#F2ECDF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/30`}
      >
        <Flame size={17} aria-hidden="true" />
        <RefreshCw
          size={12}
          className={isLoading ? "animate-spin" : ""}
          aria-hidden="true"
        />
      </button>
    );
  }

  if (!data) {
    return (
      <div
        role="status"
        aria-label="Loading daily streak"
        className={`${widgetClassName} border-[#F3DFC2] bg-[#FFF8EC] text-[#B96A12]`}
      >
        <Flame
          size={17}
          className="animate-pulse"
          aria-hidden="true"
        />
        <span className="h-3.5 w-4 animate-pulse rounded bg-[#F3DFC2]" />
      </div>
    );
  }

  const { currentStreak, longestStreak, pointsBalance } = data.streak;
  const dayLabel = currentStreak === 1 ? "day" : "days";

  return (
    <div
      role="status"
      aria-label={`${currentStreak} ${dayLabel} in your current streak`}
      title={`${currentStreak}-day streak | Longest: ${longestStreak} | ${pointsBalance} streak points`}
      className={`${widgetClassName} border-[#F3DFC2] bg-[#FFF8EC] text-[#B96A12]`}
    >
      <Flame
        size={18}
        fill="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span>{currentStreak}</span>
    </div>
  );
}
