/**
 * BharatPath - useJobs hook
 *
 * Cursor-paginated loader for the candidate job board (`GET /candidate/jobs`).
 * Supports infinite scroll via `next_cursor`, debounced text search, and
 * filter changes. The board has no total count - callers render cards only.
 *
 * `eligibility` is the only signal a candidate gets (R11). Never show the
 * threshold or the gap.
 */
import { readScreenCache, writeScreenCache } from '@/services/cache/screenCache';
import { useState, useEffect, useCallback, useRef } from 'react';
import { searchJobs } from '@/services/api/jobs';
import { ApiError } from '@/services/api/client';
import {
  BoardJobSummary,
  JobBoardQuery,
  JobFilters,
  DEFAULT_JOB_FILTERS,
} from '@/types/job';

export interface UseJobsResult {
  /** All jobs loaded so far across pages. */
  jobs: BoardJobSummary[];
  /** True only while the very first page is loading (nothing to show yet). */
  loading: boolean;
  /** A search or filter change is fetching; the previous results stay on
   *  screen until the new ones arrive (2026-11-23). */
  searching: boolean;
  /** True while an additional page is loading (infinite scroll). */
  loadingMore: boolean;
  /** True when `next_cursor` is null - no more pages. */
  hasReachedEnd: boolean;
  /** Error message from the last failed load, or null. */
  error: string | null;
  /** Load the next page, if one exists. No-op at the end. */
  loadMore: () => void;
  /** Re-run the search from page 1 with the given text. */
  setSearch: (q: string) => void;
  /** Current search text. */
  search: string;
  /** Apply a new filter set and reload from page 1. */
  setFilters: (filters: JobFilters) => void;
  /** Current filters. */
  filters: JobFilters;
  /** Whether any non-default filter is active. */
  hasActiveFilters: boolean;
  /** Reset filters and search to defaults and reload. */
  reset: () => void;
  /** Reload from page 1 with current search + filters. */
  reload: () => Promise<void>;
  /** Reload page 1 without showing the loading state (focus refresh). */
  refreshSilently: () => Promise<void>;
}

/** Map the UI filter state to the backend query params. */
function filtersToQuery(
  search: string,
  filters: JobFilters,
  cursor?: string,
): JobBoardQuery {
  const query: JobBoardQuery = { limit: 20 };
  if (search.trim()) query.q = search.trim();
  if (filters.eligible_only) query.eligible_only = true;
  if (filters.location.trim()) query.location = filters.location.trim();
  if (filters.work_mode) query.work_mode = filters.work_mode;
  if (filters.min_salary_minor != null)
    query.min_salary_minor = filters.min_salary_minor;
  if (filters.skill.trim()) query.skill = filters.skill.trim();
  if (cursor) query.cursor = cursor;
  return query;
}

function filtersEqual(a: JobFilters, b: JobFilters): boolean {
  return (
    a.eligible_only === b.eligible_only &&
    a.location === b.location &&
    a.work_mode === b.work_mode &&
    a.min_salary_minor === b.min_salary_minor &&
    a.skill === b.skill
  );
}

function hasActiveFiltersImpl(filters: JobFilters): boolean {
  return !filtersEqual(filters, DEFAULT_JOB_FILTERS);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'subscription_required' || error.status === 402) {
      return 'Membership is required to see jobs.';
    }
    return error.problem.title || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const JOBS_CACHE_KEY = 'jobs:first-page';

export function useJobs(): UseJobsResult {
  // The unfiltered first page from the last visit, if any: drawn at once,
  // then refreshed in the background (2026-11-23).
  const cachedFirstPage = readScreenCache<{ items: BoardJobSummary[]; next: string | null }>(JOBS_CACHE_KEY);
  const [jobs, setJobs] = useState<BoardJobSummary[]>(cachedFirstPage?.items ?? []);
  const [loading, setLoading] = useState(!cachedFirstPage);
  const [searching, setSearching] = useState(false);
  const hasLoadedOnce = useRef(Boolean(cachedFirstPage));
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasReachedEnd, setHasReachedEnd] = useState(Boolean(cachedFirstPage && !cachedFirstPage.next));
  const [error, setError] = useState<string | null>(null);
  const [search, setSearchState] = useState('');
  const [filters, setFiltersState] = useState<JobFilters>(DEFAULT_JOB_FILTERS);

  // The cursor for the next page. Stored in a ref so loadMore doesn't need it
  // as a dependency and doesn't re-trigger the load effect.
  const nextCursorRef = useRef<string | null>(cachedFirstPage?.next ?? null);
  // The opening load refreshes cached data quietly (no dimming).
  const openingLoad = useRef(Boolean(cachedFirstPage));
  // A token to ignore stale responses when search/filters change mid-flight.
  const loadTokenRef = useRef(0);

  const loadFirstPage = useCallback(
    async (searchText: string, currentFilters: JobFilters, silent = false) => {
      const token = ++loadTokenRef.current;
      // The full loading state is for the first page only. After that a new
      // search keeps the current results visible and marks them `searching`,
      // so the screen never blanks while someone types. `silent` (a refetch
      // on return to the screen) shows nothing at all.
      if (!hasLoadedOnce.current) setLoading(true);
      else if (!silent) setSearching(true);
      setError(null);
      try {
        const page = await searchJobs(
          filtersToQuery(searchText, currentFilters),
        );
        if (token !== loadTokenRef.current) return; // stale
        hasLoadedOnce.current = true;
        setJobs(page.items);
        nextCursorRef.current = page.next_cursor;
        // Only the default view is cached: it is what the screen opens with.
        if (!searchText.trim() && filtersEqual(currentFilters, DEFAULT_JOB_FILTERS)) {
          writeScreenCache(JOBS_CACHE_KEY, { items: page.items, next: page.next_cursor });
        }
        setHasReachedEnd(!page.next_cursor);
      } catch (err) {
        if (token !== loadTokenRef.current) return; // stale
        setJobs([]);
        nextCursorRef.current = null;
        setHasReachedEnd(true);
        setError(errorMessage(err, 'Could not load jobs. Pull to retry.'));
      } finally {
        if (token === loadTokenRef.current) {
          setLoading(false);
          setSearching(false);
        }
      }
    },
    [],
  );

  // Initial load + reload on search/filters change (debounced for text).
  useEffect(() => {
    const handle = setTimeout(
      () => {
        loadFirstPage(search, filters, openingLoad.current);
        openingLoad.current = false;
      },
      search ? 300 : 0,
    ); // debounce typing; results stay on screen meanwhile
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters]);

  const loadMore = useCallback(async () => {
    if (loadingMore || hasReachedEnd || loading) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    const token = ++loadTokenRef.current;
    setLoadingMore(true);
    try {
      const page = await searchJobs(filtersToQuery(search, filters, cursor));
      if (token !== loadTokenRef.current) return; // stale
      setJobs((prev) => [...prev, ...page.items]);
      nextCursorRef.current = page.next_cursor;
      setHasReachedEnd(!page.next_cursor);
    } catch (err) {
      if (token !== loadTokenRef.current) return; // stale
      setError(errorMessage(err, 'Could not load more jobs.'));
    } finally {
      if (token === loadTokenRef.current) setLoadingMore(false);
    }
  }, [loadingMore, hasReachedEnd, loading, search, filters]);

  const setSearch = useCallback((q: string) => {
    setSearchState(q);
  }, []);

  const setFilters = useCallback((next: JobFilters) => {
    setFiltersState(next);
  }, []);

  const reset = useCallback(() => {
    setSearchState('');
    setFiltersState(DEFAULT_JOB_FILTERS);
  }, []);

  const reload = useCallback(() => {
    return loadFirstPage(search, filters);
  }, [loadFirstPage, search, filters]);

  const refreshSilently = useCallback(() => {
    return loadFirstPage(search, filters, true);
  }, [loadFirstPage, search, filters]);

  return {
    jobs,
    loading,
    searching,
    loadingMore,
    hasReachedEnd,
    error,
    loadMore,
    setSearch,
    search,
    setFilters,
    filters,
    hasActiveFilters: hasActiveFiltersImpl(filters),
    reset,
    reload,
    refreshSilently,
  };
}
