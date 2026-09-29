"use client";

import { usePageHeader } from "@/components/layout/header-context";
import { AuditTrail } from "@/features/admin/disputes/components/audit-trail";

import { useAuditTrail } from "../hooks/use-audit-trail";

export function AuditPage() {
  usePageHeader(
    "Audit trail",
    "Every operator action on the platform, newest first",
  );

  const audit = useAuditTrail();

  return (
    <div className="min-w-0">
      <AuditTrail
        variant="page"
        items={audit.items}
        isLoading={audit.isLoading}
        isLoadingMore={audit.isLoadingMore}
        hasMore={audit.hasMore}
        onLoadMore={audit.loadMore}
        error={audit.error}
        onRetry={audit.retry}
      />
    </div>
  );
}

export const AdminAuditPage = AuditPage;
