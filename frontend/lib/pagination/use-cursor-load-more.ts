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
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function useCursorLoadMore<TItem>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPageResult<TItem>>,
  resetKeys: readonly unknown[] = [],
  enabled = true,
): CursorLoadMore<TItem> {
  const [items, setItems] = useState<TItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadingMoreRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const fetchInitialPage = useEffectEvent(() => fetchPage(undefined));

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    loadingMoreRef.current = false;

    if (!enabled) {
      return;
    }

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        if (cancelled) return;
        setIsLoading(true);
        setIsLoadingMore(false);
        setError(null);
        return fetchInitialPage();
      })
      .then((page) => {
        if (cancelled || !page) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setIsLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...resetKeys, reloadToken, enabled]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMoreRef.current) {
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
  }, [fetchPage, nextCursor]);

  const retry = useCallback(() => {
    if (items.length > 0 && nextCursor) {
      loadMore();
      return;
    }
    setReloadToken((current) => current + 1);
  }, [items.length, loadMore, nextCursor]);

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasMore: Boolean(nextCursor),
    loadMore,
    retry,
  };
}
