/**
 * Refresh for any data screen (2026-11-23): pull-to-refresh plus a quiet
 * refetch whenever the screen comes back into view.
 *
 *   const { refreshing, onRefresh } = useScreenRefresh(load);
 *   <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
 *
 * - `load` should keep what is on screen while it fetches (no full-screen
 *   loader once there is data), so a return to the screen never flashes.
 * - The first focus is skipped when the screen already loads on mount
 *   (`skipFirstFocus`, the default), so nothing is fetched twice.
 * - One fetch at a time: a pull during a refetch waits for it, not a second.
 * - A focus refetch waits `focusGapMs` (30s by default) after the last load,
 *   so hopping between tabs does not ask the server the same question every
 *   few seconds. A pull always fetches: the person asked for it.
 *
 * Not for forms or live sessions: refreshing those would discard what the
 * person is doing.
 */
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export function useScreenRefresh(
  load: () => Promise<unknown> | void,
  { skipFirstFocus = true, focusGapMs = 30_000 }: { skipFirstFocus?: boolean; focusGapMs?: number } = {},
) {
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const focusedBefore = useRef(!skipFirstFocus ? true : false);
  // If `skipFirstFocus` is true, the screen loads on mount so the throttle clock
  // starts now. If `skipFirstFocus` is false, this hook IS the initial load, so
  // the first focus must run immediately.
  const lastLoadedAt = useRef(skipFirstFocus ? Date.now() : 0);
  const latest = useRef(load);
  latest.current = load;

  const run = useCallback(() => {
    if (!inFlight.current) {
      inFlight.current = Promise.resolve()
        .then(() => latest.current())
        .catch(() => undefined)
        .finally(() => {
          inFlight.current = null;
          lastLoadedAt.current = Date.now();
        });
    }
    return inFlight.current;
  }, []);

  useFocusEffect(useCallback(() => {
    if (focusedBefore.current && Date.now() - lastLoadedAt.current >= focusGapMs) void run();
    focusedBefore.current = true;
  }, [run, focusGapMs]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await run();
    } finally {
      setRefreshing(false);
    }
  }, [run]);

  return { refreshing, onRefresh, refresh: run };
}
