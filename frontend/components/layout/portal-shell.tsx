"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";

import { PortalSidebar } from "./portal-sidebar";
import { PortalHeader } from "./portal-header";
import { PortalMobileNav } from "./portal-mobile-nav";
import { HeaderProvider } from "./header-context";

interface PortalShellProps {
  children: ReactNode;
  portal: "college" | "employer" | "student" | "admin";
  demoPanel?: ReactNode;
  onDemoStateClick?: () => void;
}

export function PortalShell({
  children,
  portal,
  demoPanel,
  onDemoStateClick,
}: PortalShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const isSettingsPage = pathname.startsWith(
    `/${portal}/settings`,
  );

  const isCandidatesPage = pathname.startsWith(
    `/${portal}/candidates`,
  );

  const isQueuePage = pathname.startsWith(
    `/${portal}/queue`,
  );

  const isUsersPage = pathname.startsWith(
    `/${portal}/users`,
  );

  const isDisputesPage = pathname.startsWith(
    `/${portal}/disputes`,
  );

  const isApplicationsPage = pathname.startsWith(
    `/${portal}/applications`,
  );

  return (
    <HeaderProvider>
      <div className="flex h-full min-h-0 overflow-hidden bg-[#f8f9fb]">
        {/* =================================================
            SIDEBAR
            ================================================= */}
        <PortalSidebar
          portal={portal}
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
        />

        {/* =================================================
            MAIN CONTENT AREA
            ================================================= */}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* =================================================
              HEADER
              ================================================= */}
          <PortalHeader
            portal={portal}
            onDemoStateClick={onDemoStateClick}
          />

          {/* =================================================
              DEMO STATE PANEL
              Appears directly below the header
              ================================================= */}
          {demoPanel}

          {/* =================================================
              MOBILE NAVIGATION
              ================================================= */}
          <PortalMobileNav portal={portal} />

          {/* =================================================
              PAGE CONTENT
              ================================================= */}
          <main
            className={[
              "min-h-0 min-w-0 flex-1 overflow-x-hidden bp-scrollbar",

              isCandidatesPage || isApplicationsPage
                ? "overflow-hidden p-0"
                : isSettingsPage ||
                    isQueuePage ||
                    isUsersPage ||
                    isDisputesPage
                  ? "overflow-y-auto px-4 pt-0 pb-4"
                  : "overflow-y-auto p-4",
            ].join(" ")}
          >
            {children}
          </main>
        </div>
      </div>
    </HeaderProvider>
  );
}
