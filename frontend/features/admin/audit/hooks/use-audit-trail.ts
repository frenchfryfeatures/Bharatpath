"use client";

import { humanizeCode } from "@/lib/format/labels";

import { useCallback } from "react";

import {
  type AuditEventRow,
  useLazyGetAdminAuditEventsQuery,
} from "@/store/api/admin-api";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";

import type { AuditIcon, AuditItem } from "@/features/admin/disputes/types";

/** Audit events loaded per request as the page scrolls. */
const AUDIT_PAGE_SIZE = 20;

function auditView(item: AuditEventRow): AuditItem {
  const icon: AuditIcon = item.action.includes("dispute")
    ? "gavel"
    : item.action.includes("integrity")
      ? "alert"
      : "check";
  return {
    id: String(item.id),
    description: `${humanizeCode(item.action)} · ${humanizeCode(item.target_type)}`,
    operator: humanizeCode(item.actor_role),
    timestamp: new Date(item.occurred_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    icon,
  };
}

/** The platform audit trail (`GET /admin/audit-events`), newest first. */
export function useAuditTrail() {
  const [fetchAudit] = useLazyGetAdminAuditEventsQuery();
  const audit = useCursorLoadMore<AuditEventRow>(
    useCallback(
      async (cursor) => {
        const page = await fetchAudit({
          limit: AUDIT_PAGE_SIZE,
          cursor,
        }).unwrap();
        return { items: page.items, nextCursor: page.next_cursor };
      },
      [fetchAudit],
    ),
    [],
  );

  return {
    items: audit.items.map(auditView),
    isLoading: audit.isLoading,
    isLoadingMore: audit.isLoadingMore,
    hasMore: audit.hasMore,
    loadMore: audit.loadMore,
    retry: audit.retry,
    error: audit.error,
  };
}
