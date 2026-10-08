"use client";

import type { ReactNode } from "react";

import { PortalShell } from "@/components/layout/portal-shell";
import { AdminFeedback } from "@/features/admin/shared/admin-feedback";
import { PortalAccessGuard } from "@/components/auth/portal-access-guard";

export default function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <PortalAccessGuard portal="admin">
      <div className="flex h-screen flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <PortalShell portal="admin">
            {children}
          </PortalShell>
          <AdminFeedback />
        </div>
      </div>
    </PortalAccessGuard>
  );
}
