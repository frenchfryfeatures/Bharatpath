/*
 * Analytics view model.
 *
 * Everything here is derived from the real cohort-overview and placement-report
 * endpoints plus live seat usage. Monthly placements are exact once the cohort
 * floor is met, with zero for an empty month. When the whole report is below
 * that floor, the API returns `null` and the UI shows a neutral placeholder.
 */

export interface AnalyticsMetric {
  id: string;
  value: string | number;
  label: string;
}

export interface MonthPlacement {
  month: string;
  /** `null` when the month is withheld: too few hires to show safely. */
  hires: number | null;
}

export interface LocationPlacement {
  location: string;
  hires: number;
}

export interface CollegeAnalyticsView {
  seatsUsed: number;
  seatsTotal: number;

  cohortBelowFloor: boolean;
  minCohortSize: number;
  metrics: AnalyticsMetric[];

  placementsBelowFloor: boolean;
  totalHires: number | null;
  placementsByMonth: MonthPlacement[];
  placementsByLocation: LocationPlacement[];
}
