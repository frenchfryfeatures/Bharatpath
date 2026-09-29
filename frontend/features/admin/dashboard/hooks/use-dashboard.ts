"use client";

import type {
  DashboardMetric,
  IntakeClearedItem,
  OldestDashboardItem,
  PlatformTotal,
} from "@/store/admin/dashboard/slice";
import {
  useGetAdminDashboardQuery,
  type AdminDashboardResponse,
  type AdminOldestWaitingItem,
} from "@/store/api/admin-api";

const EMPTY_METRICS: DashboardMetric[] = [];
const EMPTY_OLDEST: OldestDashboardItem[] = [];
const EMPTY_TOTALS: PlatformTotal[] = [];
const EMPTY_INTAKE: IntakeClearedItem[] = [];

/*
 * "2h", "3d", or "just now" from an ISO timestamp — how long an item has been
 * waiting in a queue, computed on the client from the server's timestamp.
 */
function waitingFor(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "—";
  }
  const hours = Math.floor(Math.max(0, Date.now() - then) / 3_600_000);
  if (hours < 1) {
    return "just now";
  }
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function initialsOf(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function typeOf(
  type: AdminOldestWaitingItem["type"],
): OldestDashboardItem["type"] {
  if (type === "KYB") {
    return "KYB";
  }
  if (type === "DISPUTE") {
    return "Dispute";
  }
  return "Integrity";
}

function riskOf(
  severity: AdminOldestWaitingItem["severity"],
): OldestDashboardItem["risk"] {
  if (severity === "HIGH") {
    return "High";
  }
  if (severity === "MEDIUM") {
    return "Medium";
  }
  if (severity === "LOW") {
    return "Low";
  }
  return "—";
}

function shortId(value: string | null): string | null {
  return value ? value.slice(0, 8) : null;
}

function subjectOf(item: AdminOldestWaitingItem): string {
  if (item.organisation) {
    return item.organisation;
  }

  if (item.type === "INTEGRITY") {
    return `Candidate ${shortId(item.candidate_id) ?? shortId(item.id)}`;
  }

  if (item.type === "KYB") {
    return `Organisation ${shortId(item.tenant_id) ?? shortId(item.id)}`;
  }

  const party = item.party
    ? `${item.party[0]}${item.party.slice(1).toLowerCase()}`
    : "Platform";
  return `${party} dispute ${shortId(item.id)}`;
}

function humaniseCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toMetrics(data: AdminDashboardResponse): DashboardMetric[] {
  const { kyb, integrity, disputes, organisations } = data;
  const metrics: DashboardMetric[] = [];

  if (kyb) {
    metrics.push({
      title: "KYB awaiting review",
      value: kyb.awaiting_review,
      tone: "purple",
      status: kyb.review_required
        ? "Manual review enabled"
        : "Automatic approval",
      statusTone: "neutral",
    });
  }

  if (integrity) {
    metrics.push({
      title: "Integrity flags",
      value: integrity.open,
      tone: "amber",
      status:
        integrity.candidates_held_back > 0
          ? `${integrity.candidates_held_back} held back`
          : "None held back",
      statusTone: integrity.candidates_held_back > 0 ? "warning" : "neutral",
    });
  }

  if (disputes) {
    metrics.push({
      title: "Open disputes",
      value: disputes.open,
      tone: "red",
      status:
        disputes.unassigned > 0
          ? `${disputes.unassigned} unassigned`
          : "All assigned",
      statusTone: disputes.unassigned > 0 ? "warning" : "neutral",
    });
  }

  if (organisations) {
    metrics.push({
      title: "Active employers",
      value: organisations.employers.active,
      tone: "navy",
      status:
        organisations.employers.suspended > 0
          ? `${organisations.employers.suspended} suspended`
          : "None suspended",
      statusTone: "neutral",
    });
  }

  return metrics;
}

function toOldestItems(
  items: AdminOldestWaitingItem[],
): OldestDashboardItem[] {
  return items.map((item) => {
    const subject = subjectOf(item);
    return {
      name: subject,
      meta: humaniseCode(item.detail),
      initials: initialsOf(subject) || "—",
      type: typeOf(item.type),
      risk: riskOf(item.severity),
      waiting: waitingFor(item.waiting_since),
    };
  });
}

function toPlatformTotals(
  totals: AdminDashboardResponse["platform_totals"],
): PlatformTotal[] {
  return [
    { label: "Candidates", value: String(totals.candidates) },
    { label: "Employers", value: String(totals.employers) },
    { label: "Institutions", value: String(totals.colleges) },
    { label: "Published jobs", value: String(totals.jobs_published) },
    { label: "Applications", value: String(totals.applications) },
    { label: "Confirmed hires", value: String(totals.hires) },
  ];
}

function toIntakeCleared(
  throughput: AdminDashboardResponse["throughput"],
): IntakeClearedItem[] {
  const maxValue = Math.max(
    1,
    ...throughput.map((point) => Math.max(point.intake, point.cleared)),
  );

  return throughput.map((point) => {
    const parsed = new Date(point.date);
    const day = Number.isNaN(parsed.getTime())
      ? point.date
      : parsed.toLocaleDateString("en-IN", { day: "numeric" });

    return {
      day,
      intake: point.intake,
      cleared: point.cleared,
      intakeHeight: (point.intake / maxValue) * 100,
      clearedHeight: (point.cleared / maxValue) * 100,
    };
  });
}

/*
 * The operations dashboard is served by one audited request,
 * GET /api/v1/admin/dashboard, mapped here into the shapes each panel renders.
 */
export function useDashboard() {
  const { data, isLoading, isFetching, error, refetch } =
    useGetAdminDashboardQuery();

  return {
    metrics: data ? toMetrics(data) : EMPTY_METRICS,
    oldestItems: data ? toOldestItems(data.oldest_waiting) : EMPTY_OLDEST,
    platformTotals: data ? toPlatformTotals(data.platform_totals) : EMPTY_TOTALS,
    intakeCleared: data ? toIntakeCleared(data.throughput) : EMPTY_INTAKE,
    isLoading: isLoading || isFetching,
    error,
    refetch,
  };
}