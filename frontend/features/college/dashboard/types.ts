/*
 * Dashboard view model.
 *
 * Every field here is derived from a real backend response - the cohort
 * analytics overview, seat usage and the college's referral codes. Nothing on
 * this screen is fabricated: where the API withholds a number (a cohort below
 * the privacy floor, or a metric the college has not earned yet) the value is
 * `null` and the UI renders a neutral placeholder rather than a made-up figure.
 */

export interface DashboardBand {
  /** Band name as used by scoring (Entry, Developing, Solid, Strong). */
  label: string;
  /**
   * Number of consenting students in the band, or `null` when privacy rules
   * suppress the count.
   */
  count: number | null;
}

export interface CollegeDashboardView {
  /* Cohort */
  connectedStudents: number;
  individuallyVisible: number;
  medianScore: number | null;
  platformHires: number | null;
  applicants: number | null;
  applications: number | null;
  interviews: number | null;
  belowFloor: boolean;
  minCohortSize: number;
  bands: DashboardBand[];

  /* Linking */
  referralCode: string | null;

  /* Seats */
  seatsUsed: number;
  seatsTotal: number;
  seatsAvailable: number;
  subscriptionActive: boolean;
}