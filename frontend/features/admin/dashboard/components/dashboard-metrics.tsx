"use client";

import {
  Building2,
  Gavel,
  IdCard,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { MetricCard } from "@/components/common/dashboard/metric-card";

import type { DashboardMetric } from "@/store/admin/dashboard/slice";

interface DashboardMetricsProps {
  metrics: DashboardMetric[];
}

const METRIC_ICONS = {
  "KYB awaiting review": IdCard,
  "Integrity flags": ShieldAlert,
  "Open disputes": Gavel,
  "Active employers": Building2,
} as const;

export function DashboardMetrics({
  metrics,
}: DashboardMetricsProps) {
  const router = useRouter();

  const getMetricRoute = (title: string) => {
    switch (title) {
      case "KYB awaiting review":
        return "/admin/queue?tab=kyb";

      case "Integrity flags":
        return "/admin/queue?tab=integrity";

      case "Open disputes":
        return "/admin/disputes";

      case "Active employers":
        return "/admin/users?segment=employers";

      default:
        return "/admin/dashboard";
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-4">
      {metrics.map((metric) => {
        const Icon =
          METRIC_ICONS[
            metric.title as keyof typeof METRIC_ICONS
          ];

        return (
          <MetricCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            icon={Icon}
            tone={metric.tone}
            status={metric.status}
            statusTone={metric.statusTone}
            onClick={() =>
              router.push(getMetricRoute(metric.title))
            }
          />
        );
      })}
    </div>
  );
}