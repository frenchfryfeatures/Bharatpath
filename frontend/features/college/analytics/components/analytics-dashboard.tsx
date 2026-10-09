"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { useScrollToHash } from "@/lib/hooks/use-scroll-to-hash";
import {
  BarChart,
  Button,
  Panel,
  ProgressList,
  StatCard,
} from "@/components/ui";

import {
  CollegeErrorState,
  isSubscriptionRequired,
} from "../../components/college-error-state";
import { seatStat } from "../../seat-stat";
import { useAnalytics } from "../hooks/use-analytics";
import { CollegeAnalyticsView, FunnelCount } from "../types";
import { AnalyticsSkeleton } from "./analytics-skeleton";
import { PlacementsByLocationTable } from "./outcomes-table";

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsDashboard() {
  const { data, seats, reportError, isLoading, isError } = useAnalytics();

  useScrollToHash(!isLoading);

  const headerAction = useMemo(
    () => (
      <Button
        type="button"
        variant="primary"
        size="md"
        icon={<Download size={15} strokeWidth={2.2} />}
        onClick={() => exportPlacements(data)}
        disabled={isLoading || isSubscriptionRequired(reportError)}
        className="shadow-sm"
      >
        Export report
      </Button>
    ),
    [data, isLoading, reportError],
  );

  usePageHeader(
    "Analytics & Outcomes",
    "Cohort score analytics and platform-sourced outcomes",
    {
      stat: seatStat(seats, isLoading),
      action: headerAction,
    },
  );

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  // No plan, or the reports failed outright: one clear panel, not a page of
  // zeros and dashes.
  if (reportError && isSubscriptionRequired(reportError)) {
    return (
      <div className="mx-auto max-w-[1280px]">
        <CollegeErrorState
          error={reportError}
          title="Analytics unavailable"
        />
      </div>
    );
  }

  const maxLocationHires = Math.max(
    ...data.placementsByLocation.map((entry) => entry.hires),
    1,
  );

  return (
    <div
      className="mx-auto max-w-[1280px] space-y-5"
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {isError ? (
        <CollegeErrorState
          error={reportError}
          fallback="Some analytics data could not be loaded. Please refresh and try again."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard
            key={metric.id}
            value={metric.value}
            label={metric.label}
          />
        ))}
      </div>

      <Panel
        title="Where applications stand"
        meta={
          data.totalApplications != null
            ? `${data.totalApplications} applications`
            : undefined
        }
        footer="Counted over students who have consented to share, as they stand now."
      >
        {data.funnelBelowFloor ? (
          <FunnelBelowFloorNote />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-(--ink-muted)">
                Current stage
              </p>
              <ProgressList items={funnelProgress(data.funnelStages)} />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-(--ink-muted)">
                Ever reached
              </p>
              <ProgressList items={funnelProgress(data.funnelMilestones)} />
            </div>
          </div>
        )}
      </Panel>

      <div
        id="hires"
        className="grid scroll-mt-4 items-stretch gap-4 lg:grid-cols-[1.55fr_1fr]"
      >
        <Panel
          title="Hires by month"
          footer="Platform-sourced hires among students who consented to share."
        >
          {data.placementsBelowFloor ? (
            <BelowFloorNote />
          ) : (
            <BarChart
              items={data.placementsByMonth.map((entry) => ({
                label: entry.month,
                value: entry.hires ?? 0,
                display: entry.hires === null ? "0" : undefined,
              }))}
            />
          )}
        </Panel>

        <Panel
          title="Hires by location"
          footerClassName="mt-0 border-t border-(--border-hair) pt-3"
          className="rounded-[12px] shadow-[0_4px_12px_rgba(19,26,38,0.024)]"
        >
          {data.placementsBelowFloor ? (
            <BelowFloorNote />
          ) : (
            <ProgressList
              items={data.placementsByLocation.map((entry) => ({
                label: entry.location,
                value: Math.round((entry.hires / maxLocationHires) * 100),
                display: `${entry.hires} hired`,
              }))}
            />
          )}
        </Panel>
      </div>

      <PlacementsByLocationTable placements={data.placementsByLocation} />
    </div>
  );
}

/**
 * Bars are drawn relative to the largest count in their own column; the
 * number itself is what is displayed. A withheld cell (`null`) is rendered
 * as zero with a zero-width bar.
 */
function funnelProgress(rows: FunnelCount[]) {
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    value: row.value == null ? 0 : Math.round((row.value / max) * 100),
    display: row.value == null ? "—" : String(row.value),
    tone: "info" as const,
  }));
}

function FunnelBelowFloorNote() {
  return (
    <p className="rounded-lg bg-[#f5f6f8] p-4 text-xs text-[#697386]">
      Application figures are withheld until more students consent to share,
      to protect individual privacy.
    </p>
  );
}

function BelowFloorNote() {
  return (
    <p className="rounded-lg bg-[#f5f6f8] p-4 text-xs text-[#697386]">
      Placement figures are withheld until more students consent to share, to
      protect individual privacy.
    </p>
  );
}

function exportPlacements(data: CollegeAnalyticsView) {
  downloadCsv("bharatpath-placements.csv", [
    ["Location", "Hired via platform"],
    ...data.placementsByLocation.map((entry) => [
      entry.location,
      String(entry.hires),
    ]),
  ]);
}
