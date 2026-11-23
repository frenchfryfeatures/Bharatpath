/**
 * In-memory screen cache (2026-11-23): stale-while-revalidate for the data
 * the main screens open with.
 *
 * Revisiting Jobs, Board or Home used to start from nothing -- a loader and
 * every request again -- because each visit was a fresh screen with empty
 * state. Now a screen first draws what it showed last time (from here), then
 * refreshes in the background and swaps the new data in. The server stays the
 * source of truth: nothing here is ever written back, and every entry is
 * replaced by the next successful response.
 *
 * Memory only (never written to the device) and cleared on sign-out or when
 * the signed-in account changes, so one person's data can never appear for
 * another.
 */
interface Entry {
  value: unknown;
  at: number;
}

const entries = new Map<string, Entry>();

export function readScreenCache<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

/** True when the entry exists and is younger than `maxAgeMs`. */
export function isScreenCacheFresh(key: string, maxAgeMs: number): boolean {
  const entry = entries.get(key);
  return !!entry && Date.now() - entry.at < maxAgeMs;
}

export function writeScreenCache(key: string, value: unknown): void {
  entries.set(key, { value, at: Date.now() });
}

export function clearScreenCache(): void {
  entries.clear();
}
