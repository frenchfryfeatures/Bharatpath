"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Circle,
  Flame,
  History,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { AppSelect } from "@/components/ui/app-select";
import {
  useGetStudentStreakCalendarQuery,
  useGetStudentStreakPointsQuery,
  useGetStudentStreakSessionQuery,
} from "@/store/student";
import type {
  StreakPointsChange,
  StudentStreak,
} from "@/features/student/types";
import {
  SectionEyebrow,
  StudentErrorState,
} from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

import {
  activeDateKeys,
  addDays,
  daysToNextMilestone,
  milestoneProgress,
  parseDateKey,
  statusClasses,
  statusLabel,
  statusMessage,
  toDateKey,
  WEEKDAY_LABELS,
  weekFor,
} from "./streak-utils";

export function StudentStreakPage() {
  const router = useRouter();
  const streak = useGetStudentStreakSessionQuery();
  const points = useGetStudentStreakPointsQuery(200, {
    skip: !streak.data,
  });

  return (
    <StudentPage className="pb-10">
      <StudentTopBar
        title="Daily streak"
        onBack={() => router.push("/student")}
      />

      {streak.isLoading ? (
        <StreakPageSkeleton />
      ) : streak.error || !streak.data ? (
        <StudentErrorState
          icon={<Flame size={22} />}
          title="Streak unavailable"
          error={streak.error}
          fallback="We could not load your daily streak."
          onRetry={() => void streak.refetch()}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-12">
          <StreakHero streak={streak.data} />
          <WeeklyActivity streak={streak.data} />
          <NextMilestone streak={streak.data} />
          <MilestoneLadder streak={streak.data} />
          <PointsActivity
            rows={points.data}
            isLoading={points.isLoading}
            error={points.error}
            onRetry={() => void points.refetch()}
          />
        </div>
      )}
    </StudentPage>
  );
}

function StreakHero({ streak }: { streak: StudentStreak }) {
  const dayLabel = streak.currentStreak === 1 ? "day" : "days";

  return (
    <section className="flex flex-col gap-6 rounded-[24px] border border-[#E7E0D4] bg-white p-5 shadow-[0_5px_18px_rgba(10,25,49,0.06)] sm:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)] lg:items-center xl:col-span-12">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionEyebrow icon={<Flame size={13} />}>
            Your streak
          </SectionEyebrow>
          <span
            className={[
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
              statusClasses(streak.status),
            ].join(" ")}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {statusLabel(streak.status)}
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-[#F3D6B4] bg-[#FFF5E8] text-[#F97316] sm:h-24 sm:w-24">
            <Flame
              size={48}
              fill="currentColor"
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[54px] font-extrabold leading-none tracking-[-0.055em] text-[#0A1931] sm:text-[68px]">
                {streak.currentStreak}
              </span>
              <span className="text-[20px] font-semibold text-[#3A4761] sm:text-[24px]">
                {dayLabel} streak
              </span>
            </div>
            <p className="mt-2 max-w-xl text-[13px] leading-5 text-[#5F6B80] sm:text-[15px] sm:leading-6">
              {statusMessage(streak)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<Zap size={16} />}
          label="Points"
          value={String(streak.pointsBalance)}
          detail="Engagement balance"
        />
        <StatTile
          icon={<Trophy size={16} />}
          label="Longest"
          value={`${streak.longestStreak} ${
            streak.longestStreak === 1 ? "day" : "days"
          }`}
          detail="Personal best"
        />
      </div>
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[20px] border border-[#E7E0D4] bg-[#F7F4EC] p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[#B9891A]">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#5F6B80]">
          {label}
        </span>
      </div>
      <p className="mt-4 text-[25px] font-bold leading-none tracking-[-0.03em] text-[#0A1931] sm:text-[30px]">
        {value}
      </p>
      <p className="mt-2 text-[12px] text-[#5F6B80]">{detail}</p>
    </div>
  );
}

/**
 * Which days a view draws. `today` is the server's IST day, so neither the
 * browser's clock nor its time zone ever picks the range.
 *
 * The year view asks for the calendar year explicitly: `period=year` is the
 * rolling 366 days ending today, while this heatmap is drawn January to
 * December.
 */
function calendarArgsFor(
  view: "week" | "month" | "year",
  today: string,
): {
  period?: "week" | "month" | "year";
  date?: string;
  from?: string;
  to?: string;
} {
  if (view === "year") {
    const year = today.slice(0, 4);
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { period: view, date: today };
}

function WeeklyActivity({ streak }: { streak: StudentStreak }) {
  const [view, setView] = useState<"week" | "month" | "year">("week");
  // `today` is the server's IST date. Never use the browser's calendar here.
  const calendar = useGetStudentStreakCalendarQuery(
    calendarArgsFor(view, streak.today),
  );
  const week = weekFor(streak.today);

  /*
   * `GET /candidate/streak/me/calendar` decides which days were opened. Until
   * it answers (first paint, or a failed request) we fall back to the current
   * run, which is exactly derivable from the streak - older activity is never
   * guessed at.
   */
  const active = useMemo(() => {
    const days = calendar.data?.days;
    if (days) {
      return new Set(
        days
          .filter((day) => day.status === "ACTIVE")
          .map((day) => day.date),
      );
    }
    return activeDateKeys(streak);
  }, [calendar.data, streak]);

  return (
    <section className="flex flex-col gap-3 xl:col-span-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionEyebrow icon={<Flame size={13} />}>
          {view === "week" ? "This week's activity" : view === "month" ? "This month's activity" : "This year's activity"}
        </SectionEyebrow>
        {calendar.data ? (
          <span className="text-[11px] font-semibold text-[#5F6B80]">
            {calendar.data.activeDays} opened · {calendar.data.missedDays}{" "}
            missed · best run {calendar.data.longestRun}
          </span>
        ) : null}
      </div>
      <div className="flex h-[222px] min-w-0 flex-col rounded-[24px] border border-[#E7E0D4] bg-white p-4 shadow-[0_4px_14px_rgba(10,25,49,0.05)] sm:p-5">
        <div className="min-h-0 flex-1">
        {view === "week" ? (
          <div className="grid grid-cols-7 gap-1 sm:gap-3">
            {week.map((date, index) => {
            const key = toDateKey(date);
            const isToday = key === streak.today;
            const isActive = active.has(key);
            return (
              <div
                key={key}
                className={[
                  "flex min-w-0 flex-col items-center gap-2 rounded-2xl px-0.5 py-2 sm:px-2",
                  isToday ? "bg-[#FFF8EC]" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "text-[10px] font-semibold sm:text-[12px]",
                    isToday ? "text-[#D9650B]" : "text-[#5F6B80]",
                  ].join(" ")}
                >
                  {WEEKDAY_LABELS[index]}
                </span>
                <span
                  className={[
                    "grid h-9 w-9 place-items-center rounded-full border sm:h-11 sm:w-11",
                    isActive
                      ? "border-[#F3D6B4] bg-[#F97316] text-white shadow-[0_4px_10px_rgba(249,115,22,0.22)]"
                      : "border-[#E7E0D4] bg-[#FFFCF7] text-[#D8D3C8]",
                  ].join(" ")}
                  aria-label={isActive ? `${key} opened` : `${key} not opened`}
                >
                  {isActive ? (
                    <Flame
                      size={19}
                      fill="currentColor"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      size={8}
                      fill="currentColor"
                      stroke="none"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="text-[10px] tabular-nums text-[#5F6B80] sm:text-[12px]">
                  {date.getUTCDate()}
                </span>
              </div>
            );
            })}
          </div>
        ) : view === "month" ? (
          <MonthActivity today={streak.today} active={active} />
        ) : (
          <ActivityHeatmap today={streak.today} active={active} />
        )}
        </div>
        <div className="flex items-center justify-between gap-3 border-[#F0EBDF] pt-1 text-[12px] leading-5 text-[#5F6B80] sm:text-[13px]">
          <div className="flex min-w-0 items-start gap-2">
          {streak.status === "ACTIVE_TODAY" ? (
            <Check
              size={16}
              className="mt-0.5 shrink-0 text-[#1F6B45]"
              aria-hidden="true"
            />
          ) : (
            <Flame
              size={15}
              className="mt-0.5 shrink-0 text-[#F97316]"
              aria-hidden="true"
            />
          )}
          <span className="line-clamp-2">{view === "week" ? weeklyStatusMessage(streak) : "Colored days are days you opened the app."}</span>
          </div>
          <AppSelect
            value={view}
            onChange={(value) => setView(value as "week" | "month" | "year")}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
            ]}
            ariaLabel="View activity by"
            menuPlacement="top"
            className="w-[100px] shrink-0"
          />
        </div>
      </div>
    </section>
  );
}

function MonthActivity({ today, active }: { today: string; active: Set<string> }) {
  const date = parseDateKey(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const weekday = firstDay.getUTCDay();
  const monday = addDays(firstDay, -(weekday === 0 ? 6 : weekday - 1));
  const dayCount = Math.round((lastDay.getTime() - monday.getTime()) / 86400000) + 1;
  const days = Array.from(
    { length: Math.ceil(dayCount / 7) * 7 },
    (_, index) => addDays(monday, index),
  );
  const completedCount = days.filter((day) => active.has(toDateKey(day)) && day.getUTCMonth() === month).length;

  return (
    <div className="flex h-full w-full flex-col justify-center">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#0A1931]">
          {new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(date)}
        </span>
        <span className="text-[#5F6B80]">{completedCount} opened</span>
      </div>
      <div className="mb-0.5 grid grid-cols-7 gap-1 text-center text-[9px] font-semibold text-[#5F6B80]">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-x-1 gap-y-0.5">
        {days.map((day) => {
          const key = toDateKey(day);
          const inMonth = day.getUTCMonth() === month;
          const completed = inMonth && active.has(key);
          const isToday = key === today;
          return (
            <span
              key={key}
              title={inMonth ? `${key}${completed ? " · opened" : ""}` : undefined}
              aria-label={inMonth ? `${key}${completed ? " opened" : key > today ? " upcoming" : " not opened"}` : undefined}
              className={[
                "grid place-items-center rounded-md border text-[10px] font-semibold tabular-nums",
                days.length > 35 ? "h-[15px]" : "h-[18px]",
                !inMonth
                  ? "border-transparent text-transparent"
                  : completed
                    ? "border-[#F97316] bg-[#F97316] text-white"
                    : isToday
                      ? "border-[#F3D6B4] bg-[#FFF8EC] text-[#D9650B]"
                      : key > today
                        ? "border-[#F0EBDF] bg-white text-[#B8B1A4]"
                        : "border-[#E7E0D4] bg-[#F7F4EC] text-[#5F6B80]",
              ].join(" ")}
            >
              {inMonth ? day.getUTCDate() : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ActivityHeatmap({
  today,
  active,
}: {
  today: string;
  active: Set<string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const date = parseDateKey(today);
  const year = date.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const weekday = start.getUTCDay();
  const firstMonday = addDays(start, -(weekday === 0 ? 6 : weekday - 1));
  const dayCount = Math.round((end.getTime() - firstMonday.getTime()) / 86400000) + 1;
  const days = Array.from(
    { length: Math.ceil(dayCount / 7) * 7 },
    (_, index) => addDays(firstMonday, index),
  );
  const weeks = Array.from({ length: days.length / 7 }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [today]);

  return (
    <div className="flex h-full min-w-0 flex-col justify-center overflow-hidden">
      <p className="text-[11px] font-semibold text-[#5F6B80]">
        {year}
      </p>
      <div
        ref={scrollRef}
        className="bp-scrollbar h-[116px] shrink-0 overflow-x-auto overflow-y-hidden pb-1"
      >
        <div className="flex w-max gap-[3px]">
          {weeks.map((week, index) => {
            const monthStart = week.find(
              (day) => day.getUTCDate() === 1 && day.getUTCFullYear() === year,
            );
            return (
              <div
                key={index}
                className="relative flex flex-col gap-y-px pt-3"
              >
                {monthStart ? (
                  <span className="absolute left-0 top-0 text-[9px] font-semibold text-[#5F6B80]">
                    {new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(monthStart)}
                  </span>
                ) : null}
                {week.map((day) => {
                  const key = toDateKey(day);
                  const inRange = day >= start && day <= end;
                  const isFuture = key > today;
                  const completed = inRange && !isFuture && active.has(key);
                  return (
                    <span
                      key={key}
                      title={`${key}${completed ? " · opened" : ""}`}
                      aria-label={`${key}${completed ? " opened" : isFuture ? " upcoming" : " not opened"}`}
                      className={[
                        "block rounded-[3px] border",
                        "h-[12px] w-[12px]",
                        completed
                          ? "border-[#F97316] bg-[#F97316]"
                          : inRange && isFuture
                            ? "border-[#E7E0D4] bg-white"
                            : inRange
                              ? "border-[#E7E0D4] bg-[#F7F4EC]"
                              : "border-transparent bg-transparent",
                      ].join(" ")}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function weeklyStatusMessage(streak: StudentStreak): string {
  if (streak.status === "ACTIVE_TODAY") {
    return "Today completed! Keep up the daily momentum.";
  }
  if (streak.status === "AT_RISK") {
    return "Open today to keep your current streak going.";
  }
  if (streak.status === "BROKEN") {
    return "Your previous streak ended after a missed day.";
  }
  return "Open the app today to begin your first streak.";
}

function NextMilestone({ streak }: { streak: StudentStreak }) {
  const progress = milestoneProgress(streak);
  const daysToGo = daysToNextMilestone(streak);

  return (
    <section className="flex flex-col gap-3 xl:col-span-5">
      <SectionEyebrow icon={<Trophy size={13} />}>
        Next milestone
      </SectionEyebrow>
      <div className="flex h-full min-h-44 flex-col justify-center rounded-[24px] border border-[#E7E0D4] bg-white p-5 shadow-[0_4px_14px_rgba(10,25,49,0.05)] sm:p-6">
        {streak.nextMilestone ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[28px] font-bold leading-none tracking-[-0.03em] text-[#0A1931]">
                  {streak.nextMilestone.days} days
                </p>
                <p className="mt-2 text-[13px] text-[#5F6B80]">
                  Milestone target
                </p>
              </div>
              <span className="rounded-full border border-[#E9CF68] bg-[#FFF5C8] px-4 py-2 text-[13px] font-bold text-[#8C681D]">
                +{streak.nextMilestone.points} pts
              </span>
            </div>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#EEE9DD]">
              <div
                className="h-full rounded-full bg-[#B9891A] transition-[width] duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex justify-between text-[12px] text-[#5F6B80]">
              <span>
                {daysToGo} {daysToGo === 1 ? "day" : "days"} to go
              </span>
              <span>{progress}%</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#FFF5C8] text-[#B9891A]">
              <Trophy size={23} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[18px] font-bold text-[#0A1931]">
                {streak.milestones.length > 0
                  ? "Milestone ladder complete"
                  : "No milestones configured"}
              </p>
              <p className="mt-1 text-[13px] text-[#5F6B80]">
                {streak.milestones.length > 0
                  ? "You reached every milestone in the current rules."
                  : "Your daily streak continues even without milestone awards."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MilestoneLadder({ streak }: { streak: StudentStreak }) {
  return (
    <section className="flex flex-col gap-3 xl:col-span-7">
      <SectionEyebrow icon={<Sparkles size={13} />}>
        Milestones
      </SectionEyebrow>
      <div
        className={[
          "flex-1 rounded-[24px] border border-[#E7E0D4] bg-white p-4 shadow-[0_4px_14px_rgba(10,25,49,0.05)] sm:p-5",
          streak.milestones.length > 0
            ? "grid gap-3 sm:grid-cols-3"
            : "flex min-h-40 items-center justify-center",
        ].join(" ")}
      >
        {streak.milestones.length > 0 ? (
          streak.milestones.map((milestone) => {
            const completed = streak.currentStreak >= milestone.days;
            const current = streak.nextMilestone?.days === milestone.days;
            return (
              <div
                key={milestone.days}
                className={[
                  "rounded-[18px] border p-4",
                  completed
                    ? "border-[#BFD8C9] bg-[#E6F1EA]"
                    : current
                      ? "border-[#E9CF68] bg-[#FFF9E5]"
                      : "border-[#E7E0D4] bg-[#F7F4EC]",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={[
                      "grid h-9 w-9 place-items-center rounded-full",
                      completed
                        ? "bg-[#1F6B45] text-white"
                        : "bg-white text-[#B9891A]",
                    ].join(" ")}
                  >
                    {completed ? (
                      <Check size={17} aria-hidden="true" />
                    ) : (
                      <Trophy size={16} aria-hidden="true" />
                    )}
                  </span>
                  <span className="text-[11px] font-bold text-[#8C681D]">
                    +{milestone.points} pts
                  </span>
                </div>
                <p className="mt-4 text-[20px] font-bold text-[#0A1931]">
                  {milestone.days} days
                </p>
                <p className="mt-1 text-[11px] text-[#5F6B80]">
                  {completed
                    ? "Completed"
                    : current
                      ? "In progress"
                      : "Upcoming"}
                </p>
              </div>
            );
          })
        ) : (
          <div className="text-center">
            <p className="text-[14px] font-bold text-[#0A1931]">
              No milestone awards are configured
            </p>
            <p className="mt-1 text-[12px] text-[#5F6B80]">
              Daily check-ins still build your current and longest streaks.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PointsActivity({
  rows,
  isLoading,
  error,
  onRetry,
}: {
  rows: StreakPointsChange[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 xl:col-span-5">
      <SectionEyebrow icon={<History size={13} />}>
        Points activity
      </SectionEyebrow>
      <div className="flex flex-1 flex-col rounded-[24px] border border-[#E7E0D4] bg-white p-4 shadow-[0_4px_14px_rgba(10,25,49,0.05)] sm:p-5">
        {isLoading ? (
          <div className="flex flex-col gap-4" aria-label="Loading points activity">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <Skeleton width={38} height={38} circle />
                <div className="flex-1">
                  <Skeleton width="55%" height={13} radius={6} />
                  <Skeleton className="mt-2" width="36%" height={10} radius={5} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <StudentErrorState
            variant="inline"
            error={error}
            fallback="We could not load points activity."
            onRetry={onRetry}
          />
        ) : rows?.length ? (
          // On xl the list is taken out of flow so the card matches the
          // Milestones card beside it, and scrolls inside that height.
          <div className="relative flex-1 xl:min-h-32">
            <div
              tabIndex={0}
              aria-label="Points activity, newest first"
              className="bp-scrollbar max-h-80 divide-y divide-[#F0EBDF] overflow-y-auto pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30 xl:absolute xl:inset-0 xl:max-h-none"
            >
              {rows.map((row, index) => (
                <PointActivityRow
                  key={`${row.kind}-${row.activityOn}-${index}`}
                  row={row}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#F7F4EC] text-[#B9891A]">
              <Sparkles size={19} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[14px] font-bold text-[#0A1931]">
                No points activity yet
              </p>
              <p className="mx-auto mt-1 max-w-xs text-[12px] leading-5 text-[#5F6B80]">
                Points change only when you reach a milestone or restart after
                a broken streak.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PointActivityRow({ row }: { row: StreakPointsChange }) {
  const award = row.kind === "MILESTONE_AWARD";
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={[
          "grid h-10 w-10 shrink-0 place-items-center rounded-full",
          award
            ? "bg-[#E6F1EA] text-[#1F6B45]"
            : "bg-[#F8E6E0] text-[#993A22]",
        ].join(" ")}
      >
        {award ? (
          <Trophy size={17} aria-hidden="true" />
        ) : (
          <Flame size={17} aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[#0A1931]">
          {award
            ? `${row.milestoneDays ?? row.streakLength}-day milestone`
            : "Streak restarted"}
        </p>
        <p className="mt-0.5 text-[11px] text-[#5F6B80]">
          {formatServerDate(row.activityOn)} · Balance {row.balanceAfter}
        </p>
      </div>
      <span
        className={[
          "text-[14px] font-bold tabular-nums",
          award ? "text-[#1F6B45]" : "text-[#993A22]",
        ].join(" ")}
      >
        {row.points > 0 ? "+" : ""}
        {row.points}
      </span>
    </div>
  );
}

function formatServerDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function StreakPageSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-12" aria-label="Loading daily streak">
      <div className="rounded-[24px] border border-[#E7E0D4] bg-white p-5 sm:p-6 xl:col-span-12">
        <div className="flex justify-between gap-3">
          <Skeleton width={112} height={12} radius={6} />
          <Skeleton width={146} height={28} radius={999} />
        </div>
        <div className="mt-7 flex items-center gap-5">
          <Skeleton width={96} height={96} circle />
          <div className="flex-1">
            <Skeleton width="38%" height={56} radius={10} />
            <Skeleton className="mt-3" width="62%" height={13} radius={6} />
          </div>
        </div>
      </div>
      {[7, 5, 7, 5].map((span, index) => (
        <div
          key={index}
          className={[
            "min-h-56 rounded-[24px] border border-[#E7E0D4] bg-white p-5",
            span === 7 ? "xl:col-span-7" : "xl:col-span-5",
          ].join(" ")}
        >
          <Skeleton width="42%" height={13} radius={6} />
          <Skeleton className="mt-6" width="100%" height={140} radius={18} />
        </div>
      ))}
    </div>
  );
}
