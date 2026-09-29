"use client";

import React, { useMemo } from "react";
import { Eye } from "lucide-react";

import {
  DataTable,
  type ColumnDef,
} from "@/components/ui/table";

import { Avatar } from "@/components/ui/avatar";
import { LinkStateBadge } from "@/components/ui/link-state-badge";

import type { CollegeStudent } from "./types";

export interface StudentTableProps {
  students: CollegeStudent[];
  currentPage: number;
  hasNextPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  isLoading?: boolean;
  onView?: (student: CollegeStudent) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function createStudentColumns(
  onView: StudentTableProps["onView"],
): ColumnDef<CollegeStudent>[] {
  return [
    {
      id: "student",
      header: "Student",
      headerClassName: "whitespace-nowrap",
      cellClassName: "min-w-[240px]",
      cell: (student) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            name={student.name}
            size="sm"
          />

          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-4.25 text-[#151b2b]">
              {student.name}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "link-state",
      header: "Link State",
      headerClassName: "whitespace-nowrap",
      cellClassName: "whitespace-nowrap",
      cell: (student) => (
        <LinkStateBadge state={student.status} />
      ),
    },
    {
      id: "visible-since",
      header: "Stage since",
      headerClassName: "whitespace-nowrap",
      cellClassName: "whitespace-nowrap",
      cell: (student) => (
        <span className="text-[12px] text-[#777f90]">
          {formatDate(student.stageSince)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "whitespace-nowrap text-right",
      cellClassName: "whitespace-nowrap text-right",
      cell: (student) =>
        student.candidateId ? (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              aria-label={`View ${student.name}`}
              title="View student"
              onClick={() => onView?.(student)}
              className="
                grid
                h-8
                w-8
                shrink-0
                place-items-center
                rounded-lg
                border
                border-[#e2e5eb]
                bg-white
                text-[#6c7482]
                transition-colors
                hover:bg-[#f8f9fb]
                hover:text-[#151b2b]
              "
            >
              <Eye
                size={14}
                strokeWidth={2}
              />
            </button>
          </div>
        ) : (
          <span className="text-[12px] text-[#a0a6b2]">—</span>
        ),
    },
  ];
}

export function StudentTable({
  students,
  currentPage,
  hasNextPage,
  onNextPage,
  onPreviousPage,
  isLoading = false,
  onView,
}: Readonly<StudentTableProps>) {
  const columns = useMemo<ColumnDef<CollegeStudent>[]>(
    () => createStudentColumns(onView),
    [onView],
  );

  return (
    <DataTable
      columns={columns}
      data={students}
      paginationMode="cursor"
      pageSize={10}
      currentPage={currentPage}
      hasNextPage={hasNextPage}
      onNextPage={onNextPage}
      onPreviousPage={onPreviousPage}
      keyExtractor={(student) => student.id}
      itemLabel="students"
      isLoading={isLoading}
      skeletonRows={10}
      emptyTitle="No individually-visible students yet"
      emptySubtitle="Students appear here only after they grant your college individual visibility."
      className="overflow-hidden"
    />
  );
}
