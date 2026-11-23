"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

/**
 * "Load more" accumulation over a cursor endpoint.
 *
 * For card/feed surfaces that grow a single list rather than replacing a page.
 * `fetchPage` fetches one page for the given cursor (undefined = first page);
 * the hook resets and reloads whenever `resetKeys` change, and appends each
 * further page onto the accumulated list.
 */
export interface CursorPageResult<TItem> {
  items: TItem[];
  nextCursor: string | null;
}

export interface CursorLoadMore<TItem> {
  items: TItem[];
  /** First-page load. */
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  refresh: () => void;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function useCursorLoadMore<TItem>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPageResult<TItem>>,
  resetKeys: readonly unknown[] = [],
  enabled = true,
  { keepPreviousData = false, refreshOnFocus = false } = {},
): CursorLoadMore<TItem> {
  const [items, setItems] = useState<TItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const initialPendingRef = useRef(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadingMoreRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const fetchInitialPage = useEffectEvent(() => fetchPage(undefined));

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    loadingMoreRef.current = false;
    initialPendingRef.current = true;

    if (!enabled) {
      return;
    }

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setIsLoading(!keepPreviousData || !hasLoadedRef.current);
        setIsRefreshing(keepPreviousData && hasLoadedRef.current);
        setNextCursor(null);
        setIsLoadingMore(false);
        setError(null);
        return fetchInitialPage();
      })
      .then((page) => {
        if (cancelled || !page) return;
        hasLoadedRef.current = true;
        initialPendingRef.current = false;
        setIsRefreshing(false);
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setIsLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        initialPendingRef.current = false;
        setIsRefreshing(false);
        setError(cause);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...resetKeys, reloadToken, enabled, keepPreviousData]);

  const loadMore = useCallback(() => {
    if (!enabled || initialPendingRef.current || !nextCursor || loadingMoreRef.current) {
      return;
    }

    const generation = requestGenerationRef.current;
    loadingMoreRef.current = true;
    setError(null);
    setIsLoadingMore(true);
    fetchPage(nextCursor)
      .then((page) => {
        if (requestGenerationRef.current !== generation) {
          return;
        }
        setItems((previous) => [...previous, ...page.items]);
        setNextCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause) => {
        if (requestGenerationRef.current !== generation) {
          return;
        }
        setError(cause);
      })
      .finally(() => {
        if (requestGenerationRef.current === generation) {
          setIsLoadingMore(false);
          loadingMoreRef.current = false;
        }
      });
  }, [enabled, fetchPage, nextCursor]);

  const refresh = useCallback(() => setReloadToken((current) => current + 1), []);
  const retry = useCallback(() => {
    if (!keepPreviousData && items.length > 0 && nextCursor) {
      loadMore();
      return;
    }
    refresh();
  }, [keepPreviousData, items.length, nextCursor, loadMore, refresh]);

  useEffect(() => {
    if (!enabled || !refreshOnFocus) return;
    const onReturn = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [enabled, refreshOnFocus, refresh]);

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore: Boolean(nextCursor),
    loadMore,
    retry,
    refresh,
    isRefreshing,
  };
}
