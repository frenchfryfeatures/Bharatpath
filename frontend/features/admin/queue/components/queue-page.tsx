"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { usePageHeader } from "@/components/layout/header-context";
import { canAccessAdminQueueTab } from "@/lib/auth/route-access";
import { useAppDispatch } from "@/store/hooks";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { setQueueTab } from "@/store/admin/queue/slice";

import { DataTable } from "@/components/ui/table";
import type { ColumnDef } from "@/components/ui/table";
import { ErrorState } from "@/components/ui";

import { RiskBadge } from "../../shared/status-badge";

import { QueueDrawer } from "./queue-drawer";

import { useQueue } from "../hooks/use-queue";

import type {
  QueueItem,
  QueueTab,
} from "../types";

const BADGE_TONES = {
  blue: "bg-[#eef0ff] text-[#385da8]",
  amber: "bg-[#fff5df] text-[#9a6b18]",
  green: "bg-[#eef7f1] text-[#2f7b4b]",
  neutral: "bg-[#f0f2f5] text-[#687182]",
} as const;

function QueueBadge({
  tone,
  children,
}: {
  tone: keyof typeof BADGE_TONES;
  children: string;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string): keyof typeof BADGE_TONES {
  switch (status.toLowerCase()) {
    case "submitted":
      return "blue";
    case "under review":
      return "amber";
    case "approved":
      return "green";
    default:
      return "neutral";
  }
}

export function QueuePage() {
  usePageHeader(
    "KYB & Integrity queue",
    "Review submissions and flagged accounts, then act",
  );

  const {
    tab,
    canViewKyb,
    canViewIntegrity,
    items,
    kybCount,
    integrityCount,
    kybHasMore,
    integrityHasMore,
    pagination,
    isLoading,
    error,
    isActing,
    approve,
    refresh,
    openReview,
    setTab,
  } = useQueue();

  const isKyb = tab === "kyb";

  // Links such as the dashboard's "Integrity flags" card name the tab to open.
  const dispatch = useAppDispatch();
  const { user } = useSessionIdentity();
  const requestedTab = useSearchParams().get("tab");
  useEffect(() => {
    if ((requestedTab === "kyb" || requestedTab === "integrity") && canAccessAdminQueueTab(user?.backendRole, requestedTab)) {
      dispatch(setQueueTab(requestedTab));
    }
  }, [dispatch, requestedTab, user?.backendRole]);

  const RISK_COLUMN: ColumnDef<QueueItem> = {
      id: "risk",

      header: "Risk",

      headerClassName:
        "min-w-[118px]",

      cellClassName:
        "min-w-[118px]",

      cell: (item) => (
        item.risk ? <RiskBadge risk={item.risk} /> : null
      ),
    };

  const columns: ColumnDef<QueueItem>[] = [
    {
      id: "subject",

      header: "Subject",

      headerClassName:
        "min-w-[310px]",

      cellClassName:
        "min-w-[310px]",

      cell: (item) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#eef3fb] text-[10px] font-bold text-[#315c9f]">
            {item.initials}
          </span>

          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-5 text-[#172033]">
              {item.name}
            </p>

            <p className="truncate text-[11px] leading-4 text-[#7b8494]">
              {item.submitted}
            </p>
          </div>
        </div>
      ),
    },

    {
      id: "secondary",

      header: isKyb
        ? "Status"
        : "Flag",

      headerClassName:
        `min-w-[175px] ${isKyb ? "text-center" : ""}`,

      cellClassName:
        `min-w-[175px] whitespace-nowrap text-[12px] text-[#344054] ${isKyb ? "text-center" : ""}`,

      cell: (item) =>
        isKyb ? (
          <QueueBadge tone={statusTone(item.secondary)}>
            {item.secondary}
          </QueueBadge>
        ) : (
          item.secondary
        ),
    },

    {
      id: "date",

      header: isKyb ? "Submitted" : "Flagged",

      headerClassName:
        "min-w-[170px]",

      cellClassName:
        "min-w-[170px] whitespace-nowrap text-[12px] text-[#344054]",

      cell: (item) =>
        item.date,
    },

    ...(isKyb
      ? [
          {
            id: "approval",

            header: "Decision",

            headerClassName:
              "min-w-[140px] text-center",

            cellClassName:
              "min-w-[140px] whitespace-nowrap text-center text-[12px] text-[#344054]",

            cell: (item: QueueItem) =>
              item.approval ? (
                <QueueBadge
                  tone={item.approval === "Auto-approved" ? "green" : "amber"}
                >
                  {item.approval}
                </QueueBadge>
              ) : null,
          },
        ]
      : []),

    {
      id: "actions",

      header: "Actions",

      headerClassName:
        "min-w-[170px]",

      cellClassName:
        "min-w-[170px]",

      cell: (item) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              openReview(item.id)
            }
            className="cursor-pointer rounded-lg border border-[#e2e5eb] bg-white px-3 py-2 text-[11px] font-semibold text-[#172033] transition-colors hover:bg-[#f8f9fb]"
          >
            Review
          </button>

          <button
            type="button"
            disabled={isActing}
            onClick={() => void approve(item)}
            className="cursor-pointer rounded-lg bg-[#5b4fcf] px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#4f44bc]"
          >
            {isActing ? "Saving..." : isKyb ? "Approve" : "Clear"}
          </button>
        </div>
      ),
    },
  ];

  // The KYB list carries no risk rating, so only integrity gets the column.
  const visibleColumns = isKyb
    ? columns
    : [...columns.slice(0, 2), RISK_COLUMN, ...columns.slice(2)];

  const allTabs: Array<
    [QueueTab, string]
  > = [
    [
      "kyb",
      `KYB · ${kybCount}${kybHasMore ? "+" : ""}`,
    ],
    [
      "integrity",
      `Integrity · ${integrityCount}${integrityHasMore ? "+" : ""}`,
    ],
  ];
  const tabs = allTabs.filter(([key]) => key === "kyb" ? canViewKyb : canViewIntegrity);

  return (
    <>
      <div className="min-w-0 space-y-0">
        {/* ================================================================ */}
        {/* Tabs                                                             */}
        {/* ================================================================ */}

        <div className="border-b border-[#e7e9ee]">
          <div className="flex items-center gap-1">
            {tabs.map(
              ([key, label]) => {
                const active =
                  tab === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setTab(key)
                    }
                    className={[
                      "relative cursor-pointer px-4 py-3 text-[13px] font-semibold transition-colors",
                      active
                        ? "text-[#172033]"
                        : "text-[#687182] hover:text-[#172033]",
                    ].join(" ")}
                  >
                    {label}

                    {active && (
                      <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#315c9f]" />
                    )}
                  </button>
                );
              },
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* Filters / Summary                                                */}
        {/* ================================================================ */}

        <div className="flex flex-wrap items-center gap-3 px-0 pt-4">
          <span className="text-[12px] text-[#7b8494]">
            {isKyb
              ? `${kybCount} submissions awaiting review`
              : `${integrityCount} flags awaiting action`}
          </span>
        </div>

        {/* ================================================================ */}
        {/* Queue Table                                                      */}
        {/* ================================================================ */}

        <div className="pt-4">
          {error ? (
            <ErrorState error={error} fallback="Could not load this queue." onRetry={() => void refresh()} className="mb-3" />
          ) : null}
          <DataTable<QueueItem>
            columns={visibleColumns}
            data={items}
            keyExtractor={(item) =>
              item.id
            }
            paginationMode="cursor"
            pageSize={pagination.pageSize}
            currentPage={pagination.currentPage}
            hasNextPage={pagination.hasNextPage}
            onNextPage={pagination.onNextPage}
            onPreviousPage={pagination.onPreviousPage}
            onPageSizeChange={pagination.onPageSizeChange}
            itemLabel={isKyb ? "submissions" : "flags"}
            isLoading={isLoading}
            emptyTitle={
              isKyb
                ? "No KYB submissions found"
                : "No integrity flags found"
            }
            emptySubtitle=""
            className="w-full"
          />
        </div>
      </div>

      {/* ================================================================ */}
      {/* Review Drawer                                                     */}
      {/* ================================================================ */}

      <QueueDrawer />
    </>
  );
}

export const AdminQueuePage =
  QueuePage;
