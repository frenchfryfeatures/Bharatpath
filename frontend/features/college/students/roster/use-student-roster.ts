"use client";

import { useMemo } from "react";

import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useCursorPagination } from "@/lib/pagination/use-cursor-pagination";
import {
  useGetCollegeStudentsQuery,
  type CollegeStudentStageFilter,
  type VisibleStudent,
} from "@/store/college/students";

import type {
  CollegeStudent,
  StudentStatus,
} from "./types";

const LINK_STATE_MAP: Record<VisibleStudent["linkState"], StudentStatus> = {
  LINKED: "linked",
  INVITED: "invited",
  CONSENT_PENDING: "consent_pending",
};

const STAGE_FILTER_MAP: Record<
  StudentStatus | "all",
  CollegeStudentStageFilter
> = {
  all: "ALL",
  linked: "LINKED",
  invited: "INVITED",
  consent_pending: "CONSENT_PENDING",
};

function mapStudent(student: VisibleStudent): CollegeStudent {
  const id = student.candidateId ?? student.rosterEntryId;
  if (!id) {
    throw new Error("College student list item has no identifier");
  }

  return {
    id:
      student.candidateId === null
        ? `roster:${id}`
        : id,
    candidateId: student.candidateId,
    name: student.fullName ?? "Unnamed student",
    status: LINK_STATE_MAP[student.linkState],
    stageSince: student.stageSince,
    visibleSince: student.visibleSince,
  };
}

export function useStudentRoster(
  search: string,
  status: StudentStatus | "all",
) {
  const debouncedSearch = useDebouncedSearch(search);
  const stage = STAGE_FILTER_MAP[status];
  const pagination = useCursorPagination(
    [debouncedSearch, stage],
    10,
  );
  const query = useGetCollegeStudentsQuery({
    q: debouncedSearch || undefined,
    stage,
    cursor: pagination.cursor,
    limit: pagination.pageSize,
  });
  const students = useMemo<CollegeStudent[]>(
    () => (query.currentData?.items ?? []).map(mapStudent),
    [query.currentData],
  );
  const nextCursor = query.currentData?.nextCursor ?? null;

  return {
    students,
    isLoadingStudents: query.isLoading || query.isFetching,
    studentsError: query.isError,
    studentsPagination: {
      currentPage: pagination.currentPage,
      hasNextPage: Boolean(nextCursor),
      goToNextPage: () => pagination.goToNextPage(nextCursor),
      goToPreviousPage: pagination.goToPreviousPage,
    },
  };
}
