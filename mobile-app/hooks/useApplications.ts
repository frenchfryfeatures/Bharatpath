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
import { readScreenCache, writeScreenCache } from '@/services/cache/screenCache';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { subscribeToApplicationChanges } from '@/services/applicationEvents';
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

const BOARD_CACHE_KEY = 'applications:first-page';

export function useApplications(): UseApplicationsResult {
  // Opens with the board from the last visit, then refreshes behind it
  // (2026-11-23).
  const cached = readScreenCache<{ items: ApplicationResponse[]; next: string | null }>(BOARD_CACHE_KEY);
  const [applications, setApplications] = useState<ApplicationResponse[]>(cached?.items ?? []);
  const [loading, setLoading] = useState(!cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasReachedEnd, setHasReachedEnd] = useState(Boolean(cached && !cached.next));
  const [error, setError] = useState<string | null>(null);

  // The cursor for the next page. Stored in a ref so loadMore doesn't need it
  // as a dependency and doesn't re-trigger the load effect.
  const nextCursorRef = useRef<string | null>(cached?.next ?? null);
  // A token to ignore stale responses when reload fires mid-flight.
  const loadTokenRef = useRef(0);

  const hasDataRef = useRef(false);
  hasDataRef.current = applications.length > 0;

  const loadFirstPage = useCallback(async () => {
    const token = ++loadTokenRef.current;
    // A refetch on return keeps the board on screen; only an empty board
    // shows the loading state (no flash, no lost scroll position).
    setLoading(!hasDataRef.current);
    setLoadingMore(false);
    setError(null);
    try {
      const page = await listMyApplications({ limit: 50 });
      if (token !== loadTokenRef.current) return; // stale
      setApplications(page.items);
      writeScreenCache(BOARD_CACHE_KEY, { items: page.items, next: page.next_cursor });
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

  // A withdraw/confirm/dispute/apply anywhere shows here at once; a new
  // application goes to the top, as the server orders newest first.
  useEffect(() => subscribeToApplicationChanges((change) => {
    setApplications((prev) => {
      const index = prev.findIndex((item) => item.id === change.id);
      if (index === -1) return change.created_at ? [change as ApplicationResponse, ...prev] : prev;
      const next = prev.slice();
      next[index] = { ...prev[index], ...change };
      const saved = readScreenCache<{ items: ApplicationResponse[]; next: string | null }>(BOARD_CACHE_KEY);
      if (saved) writeScreenCache(BOARD_CACHE_KEY, { ...saved, items: next.slice(0, saved.items.length) });
      return next;
    });
  }), []);

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
