"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export interface InfiniteScrollAreaProps {
  children: ReactNode;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadError: boolean;
  onLoadMore: () => void;
  ariaLabel: string;
}

export function InfiniteScrollArea({
  children,
  hasMore,
  isLoadingMore,
  loadError,
  onLoadMore,
  ariaLabel,
}: Readonly<InfiniteScrollAreaProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestPendingRef = useRef(false);

  useEffect(() => {
    if (!isLoadingMore) {
      requestPendingRef.current = false;
    }
  }, [isLoadingMore]);

  useEffect(() => {
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel || !hasMore || loadError) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          !isLoadingMore &&
          !requestPendingRef.current
        ) {
          requestPendingRef.current = true;
          onLoadMore();
        }
      },
      {
        root: container,
        rootMargin: "0px 0px 120px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadError, onLoadMore]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      className="max-h-[420px] overflow-y-auto pr-1 bp-scrollbar"
    >
      {children}

      {hasMore && (
        <div
          ref={sentinelRef}
          className="flex min-h-12 items-center justify-center py-3"
        >
          {isLoadingMore ? (
            <p
              role="status"
              className="flex items-center gap-2 text-[12px] text-[#777f90]"
            >
              <Loader2 size={14} className="animate-spin" />
              Loading more…
            </p>
          ) : loadError ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="text-[12px] font-semibold text-[#3566b8] hover:underline"
            >
              Could not load more. Retry
            </button>
          ) : (
            <span className="sr-only">Scroll to load more</span>
          )}
        </div>
      )}
    </div>
  );
}
