import type {
  StreakStatus,
  StudentStreak,
} from "@/features/student/types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_IN_MS);
}

export function weekFor(today: string): Date[] {
  const date = parseDateKey(today);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(date, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function activeDateKeys(streak: StudentStreak): Set<string> {
  if (streak.currentStreak === 0 || !streak.lastActiveOn) {
    return new Set();
  }

  /*
   * Fallback only. The day-by-day calendar is `GET /candidate/streak/me/calendar`;
   * this is what the strip shows while that request is in flight or has failed.
   * A current streak is, by definition, one uninterrupted run ending on
   * last_active_on, so those dates can be derived exactly. Older activity
   * before the current run is deliberately not guessed.
   */
  const lastActive = parseDateKey(streak.lastActiveOn);
  return new Set(
    Array.from({ length: streak.currentStreak }, (_, index) =>
      toDateKey(addDays(lastActive, -index)),
    ),
  );
}

export function statusLabel(status: StreakStatus): string {
  return {
    NONE: "Start your streak today",
    ACTIVE_TODAY: "Streak active today",
    AT_RISK: "Login today",
    BROKEN: "Streak ready to restart",
  }[status];
}

export function statusMessage(streak: StudentStreak): string {
  if (streak.status === "AT_RISK") {
    return `Open today to keep your ${streak.currentStreak}-day streak going.`;
  }
  if (streak.status === "BROKEN") {
    return "A day was missed. Open the app to begin a new run.";
  }
  if (streak.status === "NONE" || streak.currentStreak === 0) {
    return "Open the app each day to begin building your streak.";
  }
  if (streak.currentStreak === 1) {
    return "Day one. Come back tomorrow to keep it going.";
  }
  return `${streak.currentStreak} days strong. Come back tomorrow to keep it going.`;
}

export function statusClasses(status: StreakStatus): string {
  if (status === "ACTIVE_TODAY") {
    return "border-[#BFD8C9] bg-[#E6F1EA] text-[#1F6B45]";
  }
  if (status === "AT_RISK") {
    return "border-[#E6D8A8] bg-[#F7EFD6] text-[#7A5C0E]";
  }
  if (status === "BROKEN") {
    return "border-[#E7BEB2] bg-[#F8E6E0] text-[#993A22]";
  }
  return "border-[#DDD6C7] bg-[#F7F4EC] text-[#5F6B80]";
}

export function milestoneProgress(streak: StudentStreak): number {
  if (!streak.nextMilestone) {
    return streak.milestones.length > 0 ? 100 : 0;
  }
  return Math.min(
    100,
    Math.round((streak.currentStreak / streak.nextMilestone.days) * 100),
  );
}

export function daysToNextMilestone(streak: StudentStreak): number {
  if (!streak.nextMilestone) {
    return 0;
  }
  return Math.max(0, streak.nextMilestone.days - streak.currentStreak);
}
