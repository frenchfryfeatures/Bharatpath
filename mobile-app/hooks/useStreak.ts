/**
 * BharatPath - useStreak hook
 *
 * Loads the candidate's streak and performs a check-in on app open and on
 * return to the foreground. The backend's `POST /me/check-in` is idempotent
 * per calendar day (server's IST date), so calling it on every app open and
 * every foreground transition is safe and expected - only the first call on a
 * given day actually counts.
 *
 * Engagement points are a SEPARATE balance from the 700–990 candidate score
 * and must never be rendered beside it (`docs/streaks.md` §2).
 *
 * Usage:
 *   const { streak, loading, error, refresh } = useStreak();
 *
 * The hook is safe to mount in multiple screens - the check-in is idempotent,
 * and `GET /me` is cheap. Auth errors (401/403) are swallowed silently so a
 * signed-out state does not surface as a streak error.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { getMyStreak, checkIn, isStreakAuthError } from '@/services/api/streak';
import { StreakResponse } from '@/types/streak';

export interface UseStreakResult {
  /** Current streak + points balance, or null while loading / on auth error. */
  streak: StreakResponse | null;
  /** True during the first load. */
  loading: boolean;
  /** True while a check-in or refresh is in flight (after the first load). */
  refreshing: boolean;
  /** Non-auth error message from the last load, or null. */
  error: string | null;
  /** Re-fetch `GET /me` without a check-in. */
  refresh: () => void;
}

// ─── Today's check-in, remembered (2026-11-23) ────────────────────
// A check-in counts once per India-time day, and the server ignores the
// rest. Every screen using this hook, and every return to the foreground,
// used to send one anyway. Now the first success of the day is remembered and
// reused until the IST date changes; logout forgets it.
let checkedIn: { day: string; streak: StreakResponse } | null = null;

function istDay(now = Date.now()): string {
  return new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function todaysCheckIn(): StreakResponse | null {
  return checkedIn && checkedIn.day === istDay() ? checkedIn.streak : null;
}

function rememberCheckIn(streak: StreakResponse): void {
  checkedIn = { day: istDay(), streak };
}

export function forgetCheckIn(): void {
  checkedIn = null;
}

export function useStreak(): UseStreakResult {
  const [streak, setStreak] = useState<StreakResponse | null>(() => todaysCheckIn());
  const [loading, setLoading] = useState(() => !todaysCheckIn());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against overlapping calls and stale responses.
  const inFlightRef = useRef(false);
  const loadTokenRef = useRef(0);

  const loadStreak = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const token = ++loadTokenRef.current;
    try {
      const data = await getMyStreak();
      // A fresh read is the newest truth for the rest of today too.
      if (todaysCheckIn()) rememberCheckIn(data);
      if (token === loadTokenRef.current) {
        setStreak(data);
        setError(null);
      }
    } catch (err: any) {
      if (token === loadTokenRef.current) {
        // Auth errors mean there is no candidate session - leave streak null
        // and silent rather than surfacing a "streak failed" banner.
        if (!isStreakAuthError(err)) {
          setError(err?.message ?? 'Could not load your streak.');
        } else {
          setStreak(null);
          setError(null);
        }
      }
    } finally {
      inFlightRef.current = false;
      if (token === loadTokenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const doCheckIn = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const token = ++loadTokenRef.current;
    try {
      // Already counted today (India time): nothing for the server to do.
      const known = todaysCheckIn();
      const result = known ? { streak: known } : await checkIn();
      if (!known) rememberCheckIn(result.streak);
      if (token === loadTokenRef.current) {
        // The check-in response carries the full updated streak, so we use it
        // directly - no need for a second GET.
        setStreak(result.streak);
        setError(null);
      }
    } catch (err: any) {
      if (token === loadTokenRef.current) {
        if (!isStreakAuthError(err)) {
          // A failed check-in should not clobber a streak we already have.
          setError(err?.message ?? 'Could not record your check-in.');
        }
      }
    } finally {
      inFlightRef.current = false;
      if (token === loadTokenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // On mount: check in first (this also returns the current streak), then the
  // streak state is populated from the check-in response. If check-in fails
  // for a non-auth reason, fall back to a read so we still show something.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const known = todaysCheckIn();
        const result = known ? { streak: known } : await checkIn();
        if (!known) rememberCheckIn(result.streak);
        if (!cancelled) {
          setStreak(result.streak);
          setError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        if (!isStreakAuthError(err)) {
          // Fall back to a read; the check-in may have failed transiently.
          await loadStreak();
        } else {
          setStreak(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On return to foreground: check in again. Idempotent per day, so this is
  // safe even if the app was only backgrounded for a moment.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          doCheckIn();
        }
      },
    );
    return () => {
      subscription.remove();
    };
  }, [doCheckIn]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    loadStreak();
  }, [loadStreak]);

  return { streak, loading, refreshing, error, refresh };
}
