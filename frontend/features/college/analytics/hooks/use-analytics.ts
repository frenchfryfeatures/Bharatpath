"use client";

import { useMemo } from "react";

import {
  useGetApplicationFunnelQuery,
  useGetCohortOverviewQuery,
  useGetPlacementReportQuery,
} from "@/store/college/analytics/analytics.api";
import { useGetCollegeSeatsQuery } from "@/store/college/settings/settings.api";

import type {
  ApplicationFunnel,
  CohortOverview,
  PlacementReport,
} from "@/store/college/types";

import type {
  AnalyticsMetric,
  CollegeAnalyticsView,
  FunnelCount,
  LocationPlacement,
  MonthPlacement,
} from "../types";

/*
 * The order the backend counts them (`analytics.domain.APPLICATION_STAGES` /
 * `APPLICATION_MILESTONES`), held here rather than read off the response, so
 * the panel's order never depends on JSON key order.
 */
const STAGE_ORDER = [
  "SUBMITTED",
  "VIEWED",
  "SHORTLISTED",
  "INTERVIEW",
  "DECISION",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
] as const;

const MILESTONE_ORDER = [
  "SHORTLISTED",
  "INTERVIEW",
  "DECISION",
  "HIRED",
] as const;

/** `SHORTLISTED` -> `Shortlisted`. The code itself comes from the backend. */
function stageLabel(code: string): string {
  return code.charAt(0) + code.slice(1).toLowerCase();
}

function funnelRows(
  order: readonly string[],
  counts: Record<string, number | null> | undefined,
): FunnelCount[] {
  return order.map((code) => ({
    id: code,
    label: stageLabel(code),
    // `null` is withheld by the privacy floors; a missing key is too.
    value: counts?.[code] ?? null,
  }));
}

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
  funnel: ApplicationFunnel | undefined,
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

    funnelBelowFloor: funnel?.belowFloor ?? false,
    totalApplications: funnel?.totalApplications ?? null,
    funnelStages: funnelRows(STAGE_ORDER, funnel?.byStage),
    funnelMilestones: funnelRows(MILESTONE_ORDER, funnel?.reached),
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
  const funnelQuery = useGetApplicationFunnelQuery();
  const seatsQuery = useGetCollegeSeatsQuery();

  const data = useMemo<CollegeAnalyticsView>(
    () =>
      toView(
        overviewQuery.data,
        placementsQuery.data,
        funnelQuery.data,
        seatsQuery.data ?? undefined,
      ),
    [
      overviewQuery.data,
      placementsQuery.data,
      funnelQuery.data,
      seatsQuery.data,
    ],
  );

  return {
    data,
    seats: seatsQuery.data ?? null,
    // The first failed report, so a missing subscription is shown as that.
    reportError:
      overviewQuery.error ?? placementsQuery.error ?? funnelQuery.error,
    isLoading:
      overviewQuery.isLoading ||
      placementsQuery.isLoading ||
      funnelQuery.isLoading ||
      seatsQuery.isLoading,
    isError:
      overviewQuery.isError ||
      placementsQuery.isError ||
      funnelQuery.isError ||
      seatsQuery.isError,
  };
}
