import { baseApi } from "@/store/api/base-api";

import type {
  CohortOverview,
  LocationHires,
  MonthHires,
  PlacementReport,
  ScoreDistribution,
} from "@/store/college/types";

/* =========================================================
   Cohort overview
========================================================= */

interface ScoreDistributionResponse {
  ENTRY: number | null;
  DEVELOPING: number | null;
  SOLID: number | null;
  STRONG: number | null;
}

interface CohortOverviewResponse {
  connected_students: number;
  individually_visible: number;
  min_cohort_size: number;
  below_floor: boolean;
  scored_students: number | null;
  score_distribution: ScoreDistributionResponse | null;
  median_score: number | null;
  applicants: number | null;
  applications: number | null;
  interviews: number | null;
  platform_hires: number | null;
}

function mapScoreDistribution(
  distribution: ScoreDistributionResponse,
): ScoreDistribution {
  return {
    entry: distribution.ENTRY,
    developing: distribution.DEVELOPING,
    solid: distribution.SOLID,
    strong: distribution.STRONG,
  };
}

function mapCohortOverview(
  overview: CohortOverviewResponse,
): CohortOverview {
  return {
    connectedStudents: overview.connected_students,
    individuallyVisible: overview.individually_visible,
    minCohortSize: overview.min_cohort_size,
    belowFloor: overview.below_floor,
    scoredStudents: overview.scored_students,
    scoreDistribution: overview.score_distribution
      ? mapScoreDistribution(overview.score_distribution)
      : null,
    medianScore: overview.median_score,
    applicants: overview.applicants,
    applications: overview.applications,
    interviews: overview.interviews,
    platformHires: overview.platform_hires,
  };
}

/* =========================================================
   Placements
========================================================= */

interface MonthHiresResponse {
  month: string;
  hires: number | null;
}

interface LocationHiresResponse {
  location: string;
  hires: number;
}

interface PlacementReportResponse {
  source: "PLATFORM";
  min_cohort_size: number;
  below_floor: boolean;
  total_hires: number | null;
  by_month: MonthHiresResponse[];
  by_location: LocationHiresResponse[];
}

function mapPlacementReport(
  report: PlacementReportResponse,
): PlacementReport {
  const byMonth: MonthHires[] = report.by_month.map(
    (entry) => ({
      month: entry.month,
      hires: entry.hires,
    }),
  );

  const byLocation: LocationHires[] =
    report.by_location.map((entry) => ({
      location: entry.location,
      hires: entry.hires,
    }));

  return {
    source: report.source,
    minCohortSize: report.min_cohort_size,
    belowFloor: report.below_floor,
    totalHires: report.total_hires,
    byMonth,
    byLocation,
  };
}

export const collegeAnalyticsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCohortOverview: builder.query<
      CohortOverview,
      void
    >({
      query: () => ({
        url: "/college/analytics/overview",
        method: "GET",
      }),
      transformResponse: mapCohortOverview,
      providesTags: [{ type: "Analytics", id: "OVERVIEW" }],
    }),

    getPlacementReport: builder.query<
      PlacementReport,
      void
    >({
      query: () => ({
        url: "/college/analytics/placements",
        method: "GET",
      }),
      transformResponse: mapPlacementReport,
      providesTags: [
        { type: "Analytics", id: "PLACEMENTS" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetCohortOverviewQuery,
  useGetPlacementReportQuery,
} = collegeAnalyticsApi;