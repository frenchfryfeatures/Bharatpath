"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { DataTable, type ColumnDef } from "@/components/ui/table";
import {
  tablePagination,
  useCursorPagination,
} from "@/lib/pagination/use-cursor-pagination";

import {
  useGetRosterImportQuery,
  useGetRosterImportRowsQuery,
  type RosterRow,
  type RosterRowState,
} from "@/store/college/roster-imports";

export interface RosterPreviewProps {
  importId: string;
}

const FILTERS: { label: string; value: RosterRowState | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Valid", value: "VALID" },
  { label: "Invalid", value: "INVALID" },
  { label: "Duplicate", value: "DUPLICATE" },
];

const ROW_STATE_STYLES: Record<RosterRowState, string> = {
  VALID: "bg-[#eaf5ef] text-[#23805d]",
  INVALID: "bg-[#fdf2f2] text-[#e02424]",
  DUPLICATE: "bg-[#fff5df] text-[#9a6b18]",
};

export function RosterPreview({ importId }: Readonly<RosterPreviewProps>) {
  const [filter, setFilter] = useState<RosterRowState | "ALL">("ALL");
  const pagination = useCursorPagination([importId, filter], 10);
  const importQuery = useGetRosterImportQuery(importId);

  const {
    currentData,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useGetRosterImportRowsQuery({
    importId,
    rowState: filter === "ALL" ? undefined : filter,
    cursor: pagination.cursor,
    limit: pagination.pageSize,
  });

  usePageHeader(
    "Roster preview",
    importQuery.data?.fileName ?? "Review imported student rows",
  );

  const columns: ColumnDef<RosterRow>[] = [
    {
      id: "row",
      header: "#",
      cellClassName: "whitespace-nowrap text-[#777f90]",
      cell: (row) => row.rowNumber,
    },
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <span className="text-[13px] font-medium text-[#151b2b]">
          {row.fullName ?? "—"}
        </span>
      ),
    },
    {
      id: "contact",
      header: "Phone / email",
      cell: (row) => (
        <span className="text-[12px] text-[#5d6673]">
          {row.phone ?? row.email ?? "—"}
        </span>
      ),
    },
    {
      id: "ref",
      header: "Student ref",
      cellClassName: "whitespace-nowrap",
      cell: (row) => (
        <span className="text-[12px] text-[#777f90]">
          {row.studentRef ?? "—"}
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      cellClassName: "whitespace-nowrap",
      cell: (row) => (
        <span className="inline-flex flex-col gap-0.5">
          <span
            className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROW_STATE_STYLES[row.rowState]}`}
          >
            {row.rowState.charAt(0) + row.rowState.slice(1).toLowerCase()}
          </span>
          {row.issues.length > 0 && (
            <span className="text-[10px] text-[#9a6b18]">
              {row.issues.join(", ")}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div
      className="mx-auto max-w-[1280px] space-y-4"
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      <Link
        href="/college/students#roster-imports"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5d6673] transition-colors hover:text-[#151b2b]"
      >
        <ArrowLeft size={15} />
        Back to students
      </Link>

      <section className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-2xs">
        <div className="border-b border-[#e7e9ee] px-6 py-4">
          <h2 className="text-[16px] font-bold text-[#151b2b]">
            Imported rows
          </h2>
          <p className="mt-0.5 text-[12px] text-[#777f90]">
            {importQuery.data?.fileName ??
              "Review rows before committing the roster."}
          </p>
        </div>

        <div className="px-6 py-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                  filter === option.value
                    ? "bg-[#151b2b] text-white"
                    : "bg-[#f3f4f7] text-[#5d6673] hover:bg-[#e9ebf0]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {importQuery.isError || isError ? (
            <div
              role="alert"
              className="rounded-xl border border-[#f3d6d6] bg-[#fdf2f2] px-5 py-8 text-center"
            >
              <p className="text-[13px] text-[#9d2d2d]">
                This roster preview could not be loaded.
              </p>
              <button
                type="button"
                onClick={() => {
                  void importQuery.refetch();
                  void refetch();
                }}
                className="mt-2 text-[12px] font-semibold text-[#3566b8] hover:underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={currentData?.items ?? []}
              paginationMode="cursor"
              {...tablePagination(
                pagination,
                currentData?.nextCursor,
              )}
              keyExtractor={(row) => String(row.rowNumber)}
              itemLabel="rows"
              isLoading={
                importQuery.isLoading || isLoading || isFetching
              }
              skeletonRows={10}
              emptyTitle="No rows"
              emptySubtitle="No rows match this filter."
              className="overflow-hidden"
            />
          )}
        </div>
      </section>
    </div>
  );
}
