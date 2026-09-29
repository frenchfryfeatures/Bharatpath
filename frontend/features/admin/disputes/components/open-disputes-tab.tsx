"use client";

import {
  DataTable,
  type ColumnDef,
} from "@/components/ui/table";
import type { CursorTablePagination } from "@/lib/pagination/use-cursor-pagination";

import { StateBadge } from "../../shared/status-badge";

import type { Dispute } from "../types";

interface OpenDisputesTabProps {
  disputes: Dispute[];
  onOpen: (id: string) => void;
  isLoading?: boolean;
  pagination: CursorTablePagination;
}

export function OpenDisputesTab({
  disputes,
  onOpen,
  isLoading,
  pagination,
}: OpenDisputesTabProps) {
  const columns: ColumnDef<Dispute>[] = [
    {
      id: "dispute",
      header: "Dispute",
      headerClassName: "min-w-[350px]",
      cellClassName: "min-w-[350px]",
      cell: (item) => (
        <button
          type="button"
          onClick={() =>
            onOpen(item.id)
          }
          className="flex w-full min-w-0 cursor-pointer flex-col text-left"
        >
          <p className="truncate text-[13px] font-semibold text-[#172033]">
            {item.title}
          </p>

          <p className="mt-1 truncate text-[11px] text-[#7b8494]">
            {item.parties}
          </p>
        </button>
      ),
    },

    {
      id: "status",
      header: "Status",
      headerClassName: "min-w-[145px]",
      cellClassName: "min-w-[145px]",
      cell: (item) => (
        <StateBadge
          state={item.status}
        />
      ),
    },

    {
      id: "raised",
      header: "Raised",
      headerClassName: "min-w-[110px]",
      cellClassName:
        "min-w-[110px] whitespace-nowrap text-[12px] text-[#687182]",
      cell: (item) => item.raised,
    },

    {
      id: "age",
      header: "Age",
      headerClassName: "min-w-[85px]",
      cellClassName:
        "min-w-[85px] whitespace-nowrap text-[13px] font-semibold text-[#172033]",
      cell: (item) => item.age,
    },
  ];

  return (
    <DataTable<Dispute>
      columns={columns}
      data={disputes}
      keyExtractor={(item) => item.id}
      paginationMode="cursor"
      pageSize={pagination.pageSize}
      currentPage={pagination.currentPage}
      hasNextPage={pagination.hasNextPage}
      onNextPage={pagination.onNextPage}
      onPreviousPage={pagination.onPreviousPage}
      itemLabel="disputes"
      emptyTitle="No open disputes"
      emptySubtitle=""
      isLoading={isLoading}
    />
  );
}