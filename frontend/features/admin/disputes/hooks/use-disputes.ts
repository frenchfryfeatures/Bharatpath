"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";

import {
  closeDispute,
  openDispute,
  setDisputeTab,
} from "@/store/admin/disputes/slice";

import {
  selectAdminDisputes,
} from "@/store/admin/disputes/selectors";

import {
  type DisputeRow,
  useGetAdminDisputesQuery,
} from "@/store/api/admin-api";
import {
  tablePagination,
  useCursorPagination,
} from "@/lib/pagination/use-cursor-pagination";

import type { Dispute, DisputeStatus, DisputeTab } from "../types";

function age(value: string) {
  const hours = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 3_600_000);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function status(value: DisputeRow["state"]): DisputeStatus {
  if (value === "IN_REVIEW") return "Investigating";
  return (value[0] + value.slice(1).toLowerCase()) as DisputeStatus;
}

function disputeView(item: DisputeRow): Dispute {
  return {
    id: item.id,
    title: `${item.kind[0]}${item.kind.slice(1).toLowerCase()} dispute`,
    parties: `${item.party} · ${item.tenant_id ?? item.raised_by}`,
    status: status(item.state),
    raised: new Date(item.created_at).toLocaleDateString(),
    age: age(item.created_at),
    claim: "Open this dispute to view the submitted claim.",
    evidence: [],
  };
}

export function useDisputes() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(
    selectAdminDisputes,
  );

  const openPage = useCursorPagination([], 10);
  const resolvedPage = useCursorPagination([], 10);
  const rejectedPage = useCursorPagination([], 10);
  const openQuery = useGetAdminDisputesQuery({
    state_group: "ACTIVE",
    limit: openPage.pageSize,
    cursor: openPage.cursor,
  });
  const resolvedQuery = useGetAdminDisputesQuery({
    state: "RESOLVED",
    limit: resolvedPage.pageSize,
    cursor: resolvedPage.cursor,
  });
  const rejectedQuery = useGetAdminDisputesQuery({
    state: "REJECTED",
    limit: rejectedPage.pageSize,
    cursor: rejectedPage.cursor,
  });
  const openNextCursor = openQuery.data?.next_cursor ?? null;
  const resolvedNextCursor = resolvedQuery.data?.next_cursor ?? null;
  const rejectedNextCursor = rejectedQuery.data?.next_cursor ?? null;
  const openDisputes = (openQuery.data?.items ?? []).map(disputeView);
  const resolvedDisputes = (resolvedQuery.data?.items ?? []).map(disputeView);
  const rejectedDisputes = (rejectedQuery.data?.items ?? []).map(disputeView);

  return {
    state,

    openDisputes,

    resolvedDisputes,

    rejectedDisputes,

    openLoading: openQuery.isLoading,

    resolvedLoading: resolvedQuery.isLoading,

    rejectedLoading: rejectedQuery.isLoading,

    disputeError:
      state.tab === "open"
        ? openQuery.error
        : state.tab === "resolved"
          ? resolvedQuery.error
          : rejectedQuery.error,

    retryDisputes:
      state.tab === "open"
        ? openQuery.refetch
        : state.tab === "resolved"
          ? resolvedQuery.refetch
          : rejectedQuery.refetch,

    openCount: openDisputes.length,
    openHasMore: Boolean(openNextCursor),
    openPagination: tablePagination(openPage, openNextCursor),

    resolvedCount: resolvedDisputes.length,
    resolvedHasMore: Boolean(resolvedNextCursor),
    resolvedPagination: tablePagination(resolvedPage, resolvedNextCursor),

    rejectedCount: rejectedDisputes.length,
    rejectedHasMore: Boolean(rejectedNextCursor),
    rejectedPagination: tablePagination(rejectedPage, rejectedNextCursor),

    setTab: (tab: DisputeTab) => {
      dispatch(setDisputeTab(tab));
    },

    openDispute: (id: string) => {
      dispatch(openDispute(id));
    },

    closeDispute: () => {
      dispatch(closeDispute());
    },
  };
}