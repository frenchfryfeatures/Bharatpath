/**
 * BharatPath - Streak & engagement points API client
 *
 * Wraps the three endpoints in `backend/app/modules/engagement/router.py`,
 * all under `/candidate/streak`, all candidate-token only.
 *
 *   GET  /candidate/streak/me              - read current streak + balance
 *   POST /candidate/streak/me/check-in     - record today's app open (idempotent)
 *   GET  /candidate/streak/me/points        - points history, newest first
 *
 * The day a check-in counts for is the server's IST date; the request carries
 * no date. Call `checkIn()` on every app launch and on return to foreground -
 * it is idempotent per calendar day, so multiple calls are safe and expected.
 */
import { apiRequest, ApiError } from './client';
import type {
  StreakResponse,
  StreakCheckInResponse,
  StreakPointsChange,
  StreakCalendarResponse,
  StreakViewPeriod,
} from '@/types/streak';

/** Read the candidate's current streak and engagement-points balance. */
export async function getMyStreak(): Promise<StreakResponse> {
  return apiRequest<StreakResponse>('/candidate/streak/me');
}

/**
 * Record that the candidate opened the app today.
 *
 * 200 (not 201), idempotent by calendar day. `counted` is true on the first
 * check-in of the day; later calls that day change nothing. `changes` lists
 * what today's first check-in did - a break deduction, a milestone award,
 * both, or nothing.
 */
export async function checkIn(): Promise<StreakCheckInResponse> {
  return apiRequest<StreakCheckInResponse>('/candidate/streak/me/check-in', {
    method: 'POST',
  });
}

/** Engagement-points history, newest first. `limit` 1–200, default 50. */
export async function getStreakPointHistory(
  limit = 50,
): Promise<StreakPointsChange[]> {
  return apiRequest<StreakPointsChange[]>(
    `/candidate/streak/me/points?limit=${limit}`,
  );
}

/**
 * Read the candidate's activity calendar for a week, month, year, or explicit range.
 * Defaults to the current week if neither period nor range is specified.
 */
export async function getStreakCalendar(args: {
  period?: StreakViewPeriod;
  date?: string;
  from?: string;
  to?: string;
} = {}): Promise<StreakCalendarResponse> {
  const queryParts: string[] = [];
  if (args.period) queryParts.push(`period=${encodeURIComponent(args.period)}`);
  if (args.date) queryParts.push(`date=${encodeURIComponent(args.date)}`);
  if (args.from) queryParts.push(`from=${encodeURIComponent(args.from)}`);
  if (args.to) queryParts.push(`to=${encodeURIComponent(args.to)}`);
  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  return apiRequest<StreakCalendarResponse>(`/candidate/streak/me/calendar${query}`);
}

/**
 * Human-readable label for a streak status. Kept here so every screen uses the
 * same wording and a status change is one edit.
 */
export function streakStatusLabel(
  status: StreakResponse['status'] | undefined,
): string {
  switch (status) {
    case 'NONE':
      return 'Start your streak';
    case 'ACTIVE_TODAY':
      return 'Streak active today';
    case 'AT_RISK':
      return 'Check in to keep your streak';
    case 'BROKEN':
      return 'Streak broken - start again';
    default:
      return '';
  }
}

/** Short helper text shown under the streak count. */
export function streakSubtitle(
  status: StreakResponse['status'] | undefined,
  current: number,
): string {
  switch (status) {
    case 'NONE':
      return 'Open the app daily to build your streak and earn points.';
    case 'ACTIVE_TODAY':
      return current === 1
        ? 'Day one. Come back tomorrow to keep it going.'
        : `Come back tomorrow to reach day ${current + 1}.`;
    case 'AT_RISK':
      return `You're at ${current} day${current === 1 ? '' : 's'}. Check in today so you don't lose it.`;
    case 'BROKEN':
      return 'You missed a day. Start a new streak today.';
    default:
      return '';
  }
}

/** Friendly label for a points-history row. */
export function pointsChangeLabel(kind: StreakPointsChange['kind']): string {
  return kind === 'MILESTONE_AWARD'
    ? 'Milestone reward'
    : 'Missed-day deduction';
}

/** True when an error from the streak endpoints is auth-related (not a real streak failure). */
export function isStreakAuthError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403;
  }
  return false;
}
