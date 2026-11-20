import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listMyApplications } from '@/services/api/applications';
import type { ApplicationResponse } from '@/types/application';

/** Compatibility for APIs predating application_stage on the job response.
 * Walk every page: an application older than the first page still counts.
 */
export function useJobApplications() {
  const [byJob, setByJob] = useState<Record<string, ApplicationResponse>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const reload = useCallback(async () => {
    const token = ++revision.current;
    setLoading(true);
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
      if (token === revision.current) setByJob(index);
    } catch {
      if (token === revision.current) setError(true);
    } finally {
      if (token === revision.current) setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { revision.current += 1; };
  }, [reload]));
  return { byJob, loading, error, reload };
}
