"use client";

import { useState } from "react";

/**
 * Server-driven (cursor) pagination shared by every list surface.
 *
 * The backend list endpoints return `{ items, next_cursor }` and never a total,
 * so we can only step forward one page at a time (using the cursor the server
 * just returned) and back through pages already visited. This hook keeps a
 * stack of the cursors seen so far and resets whenever the query changes.
 */
export interface CursorPaginationControls {
  /** Cursor to pass to the query for the current page (undefined on page 1). */
  cursor: string | undefined;
  pageSize: number;
  currentPage: number;
  setPageSize: (pageSize: number) => void;
  /** Advance using the page's just-fetched next cursor. No-op when null. */
  goToNextPage: (nextCursor: string | null | undefined) => void;
  goToPreviousPage: () => void;
}

export function useCursorPagination(
  resetKeys: readonly unknown[] = [],
  initialPageSize = 10,
): CursorPaginationControls {
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  // index 0 is the first page (no cursor); each later entry is the cursor
  // that fetches that page.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);

  // Reset while rendering, not in an effect: an effect runs after the query
  // has already fired once with the new filters and the old page's cursor.
  const keys = [...resetKeys, pageSize];
  const [seenKeys, setSeenKeys] = useState(keys);
  if (
    keys.length !== seenKeys.length ||
    keys.some((key, index) => !Object.is(key, seenKeys[index]))
  ) {
    setSeenKeys(keys);
    setCursors([undefined]);
    setPageIndex(0);
  }

  const goToNextPage = (nextCursor: string | null | undefined) => {
    if (!nextCursor) {
      return;
    }

    setCursors((previous) => {
      const trimmed = previous.slice(0, pageIndex + 1);
      trimmed[pageIndex + 1] = nextCursor;
      return trimmed;
    });
    setPageIndex((index) => index + 1);
  };

  return {
    cursor: cursors[pageIndex],
    pageSize,
    currentPage: pageIndex + 1,
    setPageSize: (next) => setPageSizeState(next),
    goToNextPage,
    goToPreviousPage: () => setPageIndex((index) => Math.max(0, index - 1)),
  };
}

/** Props for a cursor-paginated DataTable, built from the controls. */
export interface CursorTablePagination {
  pageSize: number;
  currentPage: number;
  hasNextPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * Turn the controls plus the page's just-fetched `next_cursor` into the props
 * a cursor `DataTable` needs. Spread with `paginationMode="cursor"`.
 */
export function tablePagination(
  controls: CursorPaginationControls,
  nextCursor: string | null | undefined,
): CursorTablePagination {
  return {
    pageSize: controls.pageSize,
    currentPage: controls.currentPage,
    hasNextPage: Boolean(nextCursor),
    onNextPage: () => controls.goToNextPage(nextCursor),
    onPreviousPage: controls.goToPreviousPage,
    onPageSizeChange: controls.setPageSize,
  };
}
