"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";

import {
  closeReview,
  openReview,
  setQueueTab,
} from "@/store/admin/queue/slice";
import { showAdminFeedback } from "@/store/admin";

import {
  selectAdminQueue,
} from "@/store/admin/queue/selectors";

import {
  useDecideAdminKybMutation,
  useGetAdminIntegritySignalsQuery,
  useGetAdminKybSubmissionsQuery,
  useResolveAdminIntegritySignalMutation,
} from "@/store/api/admin-api";
import {
  tablePagination,
  useCursorPagination,
} from "@/lib/pagination/use-cursor-pagination";

import type { QueueItem, QueueRisk, QueueTab } from "../types";

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function relativeTime(value: string | null, prefix: string) {
  if (!value) return `${prefix} date unavailable`;
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${prefix} ${hours}h ago`;
  return `${prefix} ${Math.floor(hours / 24)}d ago`;
}

function waitingTime(value: string | null) {
  if (!value) return "Unknown";
  const hours = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 3_600_000);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function useQueue() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(selectAdminQueue);

  const pager = useCursorPagination([state.tab]);

  const kybQuery = useGetAdminKybSubmissionsQuery({
    state: "SUBMITTED",
    limit: pager.pageSize,
    cursor: state.tab === "kyb" ? pager.cursor : undefined,
  });
  const integrityQuery = useGetAdminIntegritySignalsQuery({
    state: "OPEN",
    limit: pager.pageSize,
    cursor: state.tab === "integrity" ? pager.cursor : undefined,
  });
  const [decideKyb, kybDecision] = useDecideAdminKybMutation();
  const [resolveSignal, signalDecision] = useResolveAdminIntegritySignalMutation();

  const kybNextCursor = kybQuery.data?.next_cursor ?? null;
  const integrityNextCursor = integrityQuery.data?.next_cursor ?? null;
  const activeNextCursor =
    state.tab === "kyb" ? kybNextCursor : integrityNextCursor;

  const kybItems: QueueItem[] = (kybQuery.data?.items ?? []).map((item) => ({
    id: item.id,
    name: item.organisation,
    initials: initials(item.organisation),
    submitted: relativeTime(item.submitted_at ?? item.created_at, "Submitted"),
    secondary: item.state.replaceAll("_", " "),
    risk: item.auto_approved ? "Low" : "Medium",
    waiting: waitingTime(item.submitted_at ?? item.created_at),
    type: "KYB",
  }));

  const integrityItems: QueueItem[] = (integrityQuery.data?.items ?? []).map((item) => ({
    id: item.id,
    name: `Candidate · ${item.candidate_id.slice(0, 8)}`,
    initials: "CA",
    submitted: relativeTime(item.created_at, "Flagged"),
    secondary: item.rule_id.replaceAll("_", " "),
    risk: (item.severity[0] + item.severity.slice(1).toLowerCase()) as QueueRisk,
    waiting: waitingTime(item.created_at),
    type: "Integrity",
  }));

  const items = state.tab === "kyb" ? kybItems : integrityItems;

  const setTab = (tab: QueueTab) => {
    dispatch(setQueueTab(tab));
  };

  const openReviewItem = (id: string) => {
    dispatch(openReview(id));
  };

  const closeReviewItem = () => {
    dispatch(closeReview());
  };

  return {
    state,

    tab: state.tab,

    openReviewId: state.openReviewId,

    items,

    kybItems,

    integrityItems,

    kybCount: kybItems.length,

    integrityCount: integrityItems.length,

    kybHasMore: Boolean(kybNextCursor),

    integrityHasMore: Boolean(integrityNextCursor),

    pagination: tablePagination(pager, activeNextCursor),

    isLoading: state.tab === "kyb" ? kybQuery.isLoading : integrityQuery.isLoading,

    error: state.tab === "kyb" ? kybQuery.error : integrityQuery.error,

    isActing: kybDecision.isLoading || signalDecision.isLoading,

    reviewRequired: kybQuery.data?.review_required ?? false,

    refresh: state.tab === "kyb" ? kybQuery.refetch : integrityQuery.refetch,

    approve: async (item: QueueItem) => {
      if (item.type === "KYB") {
        await decideKyb({ submissionId: item.id, decision: "APPROVED" }).unwrap();
        dispatch(showAdminFeedback("KYB submission approved."));
      } else {
        await resolveSignal({ signalId: item.id, outcome: "CLEARED" }).unwrap();
        dispatch(showAdminFeedback("Integrity signal cleared."));
      }
    },

    setTab,

    openReview: openReviewItem,

    closeReview: closeReviewItem,
  };
}