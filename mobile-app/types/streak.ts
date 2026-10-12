/**
 * BharatPath - Streak & engagement points types
 *
 * Mirrors `backend/app/modules/engagement/schemas.py`. Engagement points are a
 * SEPARATE balance from the 700–990 candidate score and must never be rendered
 * beside it (see `docs/streaks.md` §2). The field is named `points_balance`,
 * never `score`, on purpose.
 */

export type StreakStatus = 'NONE' | 'ACTIVE_TODAY' | 'AT_RISK' | 'BROKEN';

export type PointsKind = 'STREAK_BREAK_PENALTY' | 'MILESTONE_AWARD';

export interface StreakMilestone {
  days: number;
  points: number;
}

export interface StreakResponse {
  /** NONE: never opened. ACTIVE_TODAY: today counted. AT_RISK: last was
   *  yesterday, opening today continues it. BROKEN: a day was missed; the
   *  deduction is applied at the next check-in. */
  status: StreakStatus;
  /** 0 once a day has been missed. */
  current_streak: number;
  longest_streak: number;
  last_active_on: string | null;
  /** The server's calendar day (IST) these values are for. */
  today: string;
  /** Engagement points. Separate from the candidate score. */
  points_balance: number;
  next_milestone: StreakMilestone | null;
  milestones: StreakMilestone[];
  break_penalty: number;
  rules_version: string;
}

export interface StreakPointsChange {
  kind: PointsKind;
  /** Applied, signed. A deduction is negative. */
  points: number;
  balance_after: number;
  /** The streak broken, or the one reached. */
  streak_length: number;
  milestone_days: number | null;
  activity_on: string;
  created_at: string | null;
}

export interface StreakCheckInResponse {
  /** True on the first check-in of the day. Later calls that day change nothing. */
  counted: boolean;
  streak: StreakResponse;
  changes: StreakPointsChange[];
}

export type StreakCalendarDayStatus =
  | 'ACTIVE'
  | 'MISSED'
  | 'TODAY_PENDING'
  | 'UPCOMING'
  | 'BEFORE_START'
  | 'NOT_RETAINED';

export interface StreakCalendarDay {
  date: string;
  status: StreakCalendarDayStatus;
  milestone_days: number | null;
}

export interface StreakCalendarResponse {
  start: string;
  end: string;
  today: string;
  days: StreakCalendarDay[];
  active_days: number;
  missed_days: number;
  longest_run: number;
}

export type StreakViewPeriod = 'week' | 'month' | 'year';
