"use client";

import { useMemo } from "react";

import {
  useGetCohortOverviewQuery,
  useGetPlacementReportQuery,
} from "@/store/college/analytics/analytics.api";
import { useGetCollegeSeatsQuery } from "@/store/college/settings/settings.api";

import type {
  CohortOverview,
  PlacementReport,
} from "@/store/college/types";

import type {
  AnalyticsMetric,
  CollegeAnalyticsView,
  LocationPlacement,
  MonthPlacement,
} from "../types";

function metricsFrom(
  overview: CohortOverview | undefined,
): AnalyticsMetric[] {
  return [
    {
      id: "median-score",
      label: "Median cohort score",
      value: overview?.medianScore ?? "—",
    },
    {
      id: "applications",
      label: "Applications sent",
      value: overview?.applications ?? "—",
    },
    {
      id: "interviews",
      label: "Interviews scheduled",
      value: overview?.interviews ?? "—",
    },
    {
      id: "hired",
      label: "Hired via platform",
      value: overview?.platformHires ?? "—",
    },
  ];
}

function monthsFrom(report: PlacementReport | undefined): MonthPlacement[] {
  return (report?.byMonth ?? []).map((entry) => ({
    month: entry.month,
    hires: entry.hires,
  }));
}

function locationsFrom(
  report: PlacementReport | undefined,
): LocationPlacement[] {
  return (report?.byLocation ?? []).map((entry) => ({
    location: entry.location,
    hires: entry.hires,
  }));
}

function toView(
  overview: CohortOverview | undefined,
  report: PlacementReport | undefined,
  seats:
    | { allocated: number; used: number }
    | undefined,
): CollegeAnalyticsView {
  return {
    seatsUsed: seats?.used ?? 0,
    seatsTotal: seats?.allocated ?? 0,

    cohortBelowFloor: overview?.belowFloor ?? false,
    minCohortSize: overview?.minCohortSize ?? 0,
    metrics: metricsFrom(overview),

    placementsBelowFloor: report?.belowFloor ?? false,
    totalHires: report?.totalHires ?? null,
    placementsByMonth: monthsFrom(report),
    placementsByLocation: locationsFrom(report),
  };
}

/*
 * Single source of truth for the college analytics screen. Cohort analytics,
 * the platform-sourced placement report and seat usage all come from the
 * backend through RTK Query.
 */
export function useAnalytics() {
  const overviewQuery = useGetCohortOverviewQuery();
  const placementsQuery = useGetPlacementReportQuery();
  const seatsQuery = useGetCollegeSeatsQuery();

  const data = useMemo<CollegeAnalyticsView>(
    () =>
      toView(
        overviewQuery.data,
        placementsQuery.data,
        seatsQuery.data ?? undefined,
      ),
    [overviewQuery.data, placementsQuery.data, seatsQuery.data],
  );

  return {
    data,
    isLoading:
      overviewQuery.isLoading ||
      placementsQuery.isLoading ||
      seatsQuery.isLoading,
    isError:
      overviewQuery.isError ||
      placementsQuery.isError ||
      seatsQuery.isError,
  };
}
