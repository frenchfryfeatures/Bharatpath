"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { useScrollToHash } from "@/lib/hooks/use-scroll-to-hash";
import {
  BarChart,
  Button,
  ErrorState,
  Panel,
  ProgressList,
  StatCard,
} from "@/components/ui";

import { useAnalytics } from "../hooks/use-analytics";
import { CollegeAnalyticsView } from "../types";
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
  const { data, isLoading, isError } = useAnalytics();

  useScrollToHash(!isLoading);

  const headerAction = useMemo(
    () => (
      <Button
        type="button"
        variant="primary"
        size="md"
        icon={<Download size={15} strokeWidth={2.2} />}
        onClick={() => exportPlacements(data)}
        disabled={isLoading}
        className="shadow-sm"
      >
        Export report
      </Button>
    ),
    [data, isLoading],
  );

  usePageHeader(
    "Analytics & Outcomes",
    "Cohort score analytics and platform-sourced outcomes",
    {
      stat: {
        label: `${data.seatsUsed} of ${data.seatsTotal} seats used`,
        progress:
          data.seatsTotal > 0
            ? (data.seatsUsed / data.seatsTotal) * 100
            : 0,
        isLoading,
      },
      action: headerAction,
    },
  );

  if (isLoading) {
    return <AnalyticsSkeleton />;
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
        <ErrorState fallback="Some analytics data could not be loaded. Please refresh and try again." />
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
                display: entry.hires === null ? "—" : undefined,
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
