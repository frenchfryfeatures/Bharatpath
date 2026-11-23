/**
 * Delay before poll number `attempt` (0-based), growing from `startMs` by
 * `factor` up to `maxMs` (2026-11-23). Waiting for something the server is
 * still doing should ask often at first, when the answer usually arrives,
 * and less often after, instead of every couple of seconds for minutes.
 */
export function backoffDelay(attempt: number, startMs: number, maxMs: number, factor = 1.35): number {
  return Math.min(maxMs, Math.round(startMs * factor ** Math.max(0, attempt)));
}
