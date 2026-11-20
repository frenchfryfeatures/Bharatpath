/**
 * BharatPath - useApplications hook
 *
 * Cursor-paginated loader for the candidate's own Application Board
 * (`GET /candidate/applications`). The board has no stage filter on the API,
 * so this hook loads ALL of the candidate's applications and the screen
 * partitions them into Active / Closed client-side using the stage sets.
 *
 * `total` is always `null` on the board list, so the screen's filter-pill
 * counts come from the loaded items, not from a server total.
 *
 * Reading the board is NOT paywalled (R13 - a lapsed subscriber loses access,
 * not their data). A 402 here is therefore unexpected; we surface it as a
 * generic error rather than a membership prompt.
 */
import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { listMyApplications } from '@/services/api/applications';
import { ApiError } from '@/services/api/client';
import { ApplicationResponse } from '@/types/application';

export interface UseApplicationsResult {
  /** All applications loaded so far across pages. */
  applications: ApplicationResponse[];
  /** True while the first page is loading. */
  loading: boolean;
  /** True while an additional page is loading (infinite scroll). */
  loadingMore: boolean;
  /** True when `next_cursor` is null - no more pages. */
  hasReachedEnd: boolean;
  /** Error message from the last failed load, or null. */
  error: string | null;
  /** Load the next page, if one exists. No-op at the end. */
  loadMore: () => void;
  /** Reload from page 1. */
  reload: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.problem.title || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function useApplications(): UseApplicationsResult {
  const [applications, setApplications] = useState<ApplicationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The cursor for the next page. Stored in a ref so loadMore doesn't need it
  // as a dependency and doesn't re-trigger the load effect.
  const nextCursorRef = useRef<string | null>(null);
  // A token to ignore stale responses when reload fires mid-flight.
  const loadTokenRef = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const page = await listMyApplications({ limit: 50 });
      if (token !== loadTokenRef.current) return; // stale
      setApplications(page.items);
      nextCursorRef.current = page.next_cursor;
      setHasReachedEnd(!page.next_cursor);
    } catch (err) {
      if (token !== loadTokenRef.current) return; // stale
      setApplications([]);
      nextCursorRef.current = null;
      setHasReachedEnd(true);
      setError(errorMessage(err, 'Could not load your applications.'));
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, []);

  // Initial load.
  useFocusEffect(useCallback(() => {
    void loadFirstPage();
    return () => { loadTokenRef.current += 1; };
  }, [loadFirstPage]));

  const loadMore = useCallback(async () => {
    if (loadingMore || hasReachedEnd || loading) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    const token = ++loadTokenRef.current;
    setLoadingMore(true);
    try {
      const page = await listMyApplications({ cursor, limit: 50 });
      if (token !== loadTokenRef.current) return; // stale
      setApplications((prev) => [...prev, ...page.items]);
      nextCursorRef.current = page.next_cursor;
      setHasReachedEnd(!page.next_cursor);
    } catch (err) {
      if (token !== loadTokenRef.current) return; // stale
      setError(errorMessage(err, 'Could not load more applications.'));
    } finally {
      if (token === loadTokenRef.current) setLoadingMore(false);
    }
  }, [loadingMore, hasReachedEnd, loading]);

  const reload = useCallback(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  return {
    applications,
    loading,
    loadingMore,
    hasReachedEnd,
    error,
    loadMore,
    reload,
  };
}
