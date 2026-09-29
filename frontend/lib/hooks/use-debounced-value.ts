"use client";

import { useEffect, useState } from "react";

/**
 * How long a search box must be idle before its text reaches the API.
 * Typing "software engineer" is one request, not seventeen.
 */
export const SEARCH_DEBOUNCE_MS = 600;

/**
 * `value`, but only once it has stopped changing for `delayMs`.
 *
 * Values for which `immediate(value)` is true skip the wait - used so that
 * clearing a search box restores the unfiltered list at once.
 */
export function useDebouncedValue<T>(
  value: T,
  delayMs: number = SEARCH_DEBOUNCE_MS,
  immediate?: (value: T) => boolean,
): T {
  const [debounced, setDebounced] = useState(value);
  const skipWait = immediate?.(value) ?? false;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebounced(value),
      skipWait ? 0 : delayMs,
    );

    return () => window.clearTimeout(timer);
  }, [value, delayMs, skipWait]);

  // Returned directly so an immediate value never waits even one render
  // for the timer above to catch the state up.
  return skipWait ? value : debounced;
}

function isBlank(value: string): boolean {
  return value.length === 0;
}

/**
 * A search box's text as the API should see it: trimmed, and settled for
 * `SEARCH_DEBOUNCE_MS`. An empty box applies at once.
 */
export function useDebouncedSearch(
  value: string,
  delayMs: number = SEARCH_DEBOUNCE_MS,
): string {
  return useDebouncedValue(value.trim(), delayMs, isBlank);
}
