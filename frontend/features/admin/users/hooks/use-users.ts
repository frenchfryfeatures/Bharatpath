"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";

import {
  closeUser,
  openUser,
  setUserSearch,
  setUserSegment,
} from "@/store/admin/users/slice";

import { selectAdminUsers } from "@/store/admin/users/selectors";
import {
  useGetAdminCandidatesQuery,
  useGetAdminTenantsQuery,
  type AdminCandidateRow,
} from "@/store/api/admin-api";
import { useCursorPagination } from "@/lib/pagination/use-cursor-pagination";

import type { UserRow, UserSegment, UserState } from "../types";

function initialsOf(name: string | null): string {
  if (!name) {
    return "-";
  }
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "-"
  );
}

function candidateState(status: AdminCandidateRow["status"]): UserState {
  if (status === "SUSPENDED") {
    return "Suspended";
  }
  if (status === "DELETED") {
    return "Inactive";
  }
  return "Active";
}

export function useUsers() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(
    selectAdminUsers,
  );
  const debouncedSearch = useDebouncedSearch(state.search);
  const isCandidates = state.segment === "candidates";
  const tenantType = state.segment === "employers" ? "EMPLOYER" : "COLLEGE";

  const pagination = useCursorPagination([state.segment, debouncedSearch]);

  // Candidates come from GET /admin/candidates; employers and institutions
  // stay on GET /admin/tenants. Exactly one query runs per segment.
  const candidatesQuery = useGetAdminCandidatesQuery(
    {
      q: debouncedSearch || undefined,
      limit: pagination.pageSize,
      cursor: pagination.cursor,
    },
    { skip: !isCandidates },
  );
  const tenantsQuery = useGetAdminTenantsQuery(
    {
      type: tenantType,
      q: debouncedSearch || undefined,
      limit: pagination.pageSize,
      cursor: pagination.cursor,
    },
    { skip: isCandidates },
  );

  const activeQuery = isCandidates ? candidatesQuery : tenantsQuery;
  const nextCursor = activeQuery.data?.next_cursor ?? null;
  const hasNextPage = Boolean(nextCursor);

  const users: UserRow[] = isCandidates
    ? (candidatesQuery.data?.items ?? []).map((candidate) => ({
        id: candidate.id,
        name: candidate.full_name ?? "Unnamed candidate",
        initials: initialsOf(candidate.full_name),
        identifier:
          candidate.email_masked ?? candidate.phone_masked ?? candidate.id,
        meta:
          [candidate.city, candidate.state_code].filter(Boolean).join(", ") ||
          "Candidate",
        state: candidateState(candidate.status),
        joined: new Date(candidate.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      }))
    : (tenantsQuery.data?.items ?? []).map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        initials: tenant.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase(),
        // The tenant list does not include GSTIN or another public
        // organisation identifier. Never present its internal ID as one.
        identifier: "-",
        meta:
          tenant.type === "EMPLOYER"
            ? "Employer organisation"
            : "College institution",
        state: `${tenant.status[0]}${tenant.status
          .slice(1)
          .toLowerCase()}` as UserState,
        joined: new Date(tenant.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      }));

  const setSegment = (
    segment: UserSegment,
  ) => {
    dispatch(setUserSegment(segment));
  };

  const setSearch = (
    search: string,
  ) => {
    dispatch(setUserSearch(search));
  };

  return {
    state,

    segment: state.segment,

    search: state.search,

    users,

    filteredUsers: users,

    selectedId: state.selectedId,

    isLoading: activeQuery.isLoading || activeQuery.isFetching,

    error: activeQuery.error,

    pageSize: pagination.pageSize,

    currentPage: pagination.currentPage,

    hasNextPage,

    setPageSize: pagination.setPageSize,

    goToNextPage: () => pagination.goToNextPage(nextCursor),

    goToPreviousPage: pagination.goToPreviousPage,

    setSegment,

    setSearch,

    openUser: (id: string) => dispatch(openUser(id)),

    closeUser: () => dispatch(closeUser()),
  };
}
