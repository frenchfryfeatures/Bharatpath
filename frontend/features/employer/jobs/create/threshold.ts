/*
 * The job form's minimum-score threshold.
 *
 * The slider runs from 690 to 990 (the real scale is 700-990), so any
 * threshold below 700 filters nobody out. Such a value is sent to the API as
 * `null` (no threshold), which the backend requires: `min_score` must be null
 * or between 700 and 990. Slider values above 990 use the API's maximum.
 */
/** One step under the floor means "no minimum". */
export const THRESHOLD_MIN = 690;
export const THRESHOLD_MAX = 990;
const API_THRESHOLD_MAX = 990;
/** The threshold preview only accepts multiples of this step. */
export const THRESHOLD_STEP = 10;
/** The lowest score a candidate can hold. */
export const SCORE_FLOOR = 700;

export function hasThreshold(minScore: number): boolean {
  return minScore >= SCORE_FLOOR;
}

/** The value to send as `min_score`: null when it would filter nobody. */
export function thresholdForApi(minScore: number): number | null {
  return hasThreshold(minScore) ? Math.min(minScore, API_THRESHOLD_MAX) : null;
}

/** A stored threshold (possibly null) as a slider position. */
export function thresholdFromApi(minScore: number | null | undefined): number {
  return minScore ?? THRESHOLD_MIN;
}

/** The nearest threshold the preview endpoint accepts. */
export function previewThreshold(minScore: number): number {
  return Math.min(
    Math.round(minScore / THRESHOLD_STEP) * THRESHOLD_STEP,
    API_THRESHOLD_MAX,
  );
}
