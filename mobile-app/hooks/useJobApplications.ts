import { isScreenCacheFresh, readScreenCache, writeScreenCache } from '@/services/cache/screenCache';
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToApplicationChanges } from '@/services/applicationEvents';
import { useFocusEffect } from 'expo-router';
import { listMyApplications } from '@/services/api/applications';
import type { ApplicationResponse } from '@/types/application';

/** Compatibility for APIs predating application_stage on the job response.
 * Walk every page: an application older than the first page still counts.
 */
const CACHE_KEY = 'applications:by-job';
/** How long a walk of every application page is reused on screen entry. */
const REUSE_FOR_MS = 60_000;

export function useJobApplications() {
  // Opens with the last walk's result (2026-11-23); changes made anywhere in
  // the app arrive through the application bus below, so a recent walk is
  // reused on entry rather than repeated.
  const [byJob, setByJob] = useState<Record<string, ApplicationResponse>>(
    () => readScreenCache<Record<string, ApplicationResponse>>(CACHE_KEY) ?? {},
  );
  const [loading, setLoading] = useState(() => readScreenCache(CACHE_KEY) === undefined);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const latest = useRef(byJob);
  latest.current = byJob;
  const reload = useCallback(async () => {
    const token = ++revision.current;
    // Only the first load shows "checking"; a refetch keeps what is shown.
    setLoading((current) => current && Object.keys(latest.current).length === 0);
    setError(false);
    try {
      const index: Record<string, ApplicationResponse> = {};
      const visited = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await listMyApplications({ limit: 100, cursor });
        for (const application of page.items) {
          const previous = index[application.job_id];
          if (!previous || application.created_at > previous.created_at) index[application.job_id] = application;
        }
        cursor = page.next_cursor;
        if (cursor && visited.has(cursor)) throw new Error('Repeated application cursor');
        if (cursor) visited.add(cursor);
      } while (cursor);
      if (token === revision.current) {
        setByJob(index);
        writeScreenCache(CACHE_KEY, index);
      }
    } catch {
      if (token === revision.current) setError(true);
    } finally {
      if (token === revision.current) setLoading(false);
    }
  }, []);
  // A mutation anywhere updates this screen's map at once, even while it is
  // under another screen; the focus refetch below then reconciles.
  useEffect(() => subscribeToApplicationChanges((change) => {
    setByJob((prev) => {
      const next = {
        ...prev,
        [change.job_id]: { ...(prev[change.job_id] ?? {}), ...change } as ApplicationResponse,
      };
      writeScreenCache(CACHE_KEY, next);
      return next;
    });
  }), []);
  useFocusEffect(useCallback(() => {
    if (!isScreenCacheFresh(CACHE_KEY, REUSE_FOR_MS)) void reload();
    return () => { revision.current += 1; };
  }, [reload]));
  return { byJob, loading, error, reload };
}
