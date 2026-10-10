"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { canAccessAdminQueueTab } from "@/lib/auth/route-access";

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

/** "SUBMITTED" / "hidden_text" -> "Submitted" / "Hidden text". */
function humanise(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function relativeTime(value: string | null, prefix: string) {
  if (!value) return `${prefix} date unavailable`;
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${prefix} ${hours}h ago`;
  return `${prefix} ${Math.floor(hours / 24)}d ago`;
}

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function useQueue() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(selectAdminQueue);
  const role = useAppSelector((store) => store.auth.user?.backendRole);
  const canViewKyb = canAccessAdminQueueTab(role, "kyb");
  const canViewIntegrity = canAccessAdminQueueTab(role, "integrity");
  const tab = canAccessAdminQueueTab(role, state.tab) ? state.tab : canViewKyb ? "kyb" : "integrity";

  const pager = useCursorPagination([tab]);

  const kybQuery = useGetAdminKybSubmissionsQuery({
    state: "SUBMITTED",
    limit: pager.pageSize,
    cursor: tab === "kyb" ? pager.cursor : undefined,
  }, { skip: !canViewKyb });
  const integrityQuery = useGetAdminIntegritySignalsQuery({
    state: "OPEN",
    limit: pager.pageSize,
    cursor: tab === "integrity" ? pager.cursor : undefined,
  }, { skip: !canViewIntegrity });
  const [decideKyb, kybDecision] = useDecideAdminKybMutation();
  const [resolveSignal, signalDecision] = useResolveAdminIntegritySignalMutation();

  const kybNextCursor = kybQuery.data?.next_cursor ?? null;
  const integrityNextCursor = integrityQuery.data?.next_cursor ?? null;
  const activeNextCursor =
    tab === "kyb" ? kybNextCursor : integrityNextCursor;

  const kybItems: QueueItem[] = (kybQuery.data?.items ?? []).map((item) => ({
    id: item.id,
    name: item.organisation,
    initials: initials(item.organisation),
    submitted: relativeTime(item.submitted_at ?? item.created_at, "Submitted"),
    secondary: humanise(item.state),
    risk: null,
    date: formatDate(item.submitted_at ?? item.created_at),
    approval: item.auto_approved ? "Auto-approved" : "Manual review",
    type: "KYB",
    resubmitted: (item.review_count ?? 0) > 0 && item.state === "SUBMITTED",
    afterRejection: item.after_rejection ?? false,
  }));

  const integrityItems: QueueItem[] = (integrityQuery.data?.items ?? []).map((item) => ({
    id: item.id,
    name: `Candidate · ${item.candidate_id.slice(0, 8)}`,
    initials: "CA",
    submitted: relativeTime(item.created_at, "Flagged"),
    secondary: humanise(item.rule_id),
    risk: (item.severity[0] + item.severity.slice(1).toLowerCase()) as QueueRisk,
    date: formatDate(item.created_at),
    approval: null,
    type: "Integrity",
    resubmitted: false,
    afterRejection: false,
  }));

  const items = tab === "kyb" ? kybItems : integrityItems;

  const setTab = (tab: QueueTab) => {
    if (!canAccessAdminQueueTab(role, tab)) return;
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

    tab,
    canViewKyb,
    canViewIntegrity,

    openReviewId: state.openReviewId,

    items,

    kybItems,

    integrityItems,

    kybCount: kybItems.length,

    integrityCount: integrityItems.length,

    kybHasMore: Boolean(kybNextCursor),

    integrityHasMore: Boolean(integrityNextCursor),

    pagination: tablePagination(pager, activeNextCursor),

    isLoading: tab === "kyb" ? kybQuery.isLoading : integrityQuery.isLoading,

    error: tab === "kyb" ? kybQuery.error : integrityQuery.error,

    isActing: kybDecision.isLoading || signalDecision.isLoading,

    reviewRequired: kybQuery.data?.review_required ?? false,

    refresh: tab === "kyb" ? kybQuery.refetch : integrityQuery.refetch,

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
