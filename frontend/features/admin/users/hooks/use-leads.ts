"use client";

import { useCursorPagination } from "@/lib/pagination/use-cursor-pagination";
import {
  useGetAdminLeadsQuery,
  useGetAdminLeadsSummaryQuery,
  type LeadRow,
  type LeadStage,
} from "@/store/api/admin-api";

import type { UsersPagination } from "../types";

export type LeadTab = "signed_up" | "others";

/** Not yet paid: the follow-up list. Everyone else holds a subscription or a college seat. */
export const LEAD_STAGES: Record<LeadTab, LeadStage[]> = {
  signed_up: ["SIGNED_UP", "PROFILE_COMPLETE", "RESUME_DOWNLOADED"],
  others: ["PAID", "COLLEGE_SEAT"],
};

/** Reads `GET /admin/leads` for the open tab, and the stage counts for the tab labels. */
export function useLeads(tab: LeadTab, enabled: boolean, search: string) {
  const pager = useCursorPagination([tab]);
  const query = useGetAdminLeadsQuery(
    { stages: LEAD_STAGES[tab], limit: pager.pageSize, cursor: pager.cursor },
    { skip: !enabled },
  );
  const summary = useGetAdminLeadsSummaryQuery(undefined, { skip: !enabled });

  // The list has no search parameter, so this narrows the page that is open.
  const needle = search.trim().toLowerCase();
  const all: LeadRow[] = query.data?.items ?? [];
  const rows = needle
    ? all.filter((lead) =>
        [lead.full_name, lead.email, lead.phone, lead.city]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
      )
    : all;

  const nextCursor = query.data?.next_cursor ?? null;
  const counts: Record<LeadTab, number | null> = summary.data
    ? {
        signed_up: summary.data.signed_up + summary.data.profile_complete + summary.data.resume_downloaded,
        others: summary.data.paid + summary.data.college_seat,
      }
    : { signed_up: null, others: null };

  const pagination: UsersPagination = {
    pageSize: pager.pageSize,
    currentPage: pager.currentPage,
    hasNextPage: Boolean(nextCursor),
    onNextPage: () => pager.goToNextPage(nextCursor),
    onPreviousPage: pager.goToPreviousPage,
    onPageSizeChange: pager.setPageSize,
  };

  return {
    rows,
    counts,
    pagination,
    isLoading: query.isLoading || query.isFetching,
    error: query.error,
  };
}
