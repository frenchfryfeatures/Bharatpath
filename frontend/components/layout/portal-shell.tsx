"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useScrollLock } from "@/hooks/use-scroll-lock";

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
  const [mobileOpen, setMobileOpen] = useState(false);
  useScrollLock(mobileOpen);

  const pathname = usePathname();

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  useEffect(() => {
    const desktopLayout = window.matchMedia("(min-width: 768px)");
    const closeOnResize = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    desktopLayout.addEventListener("change", closeOnResize);
    return () => desktopLayout.removeEventListener("change", closeOnResize);
  }, []);

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

        {mobileOpen && (
          <div data-scroll-lock-root className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-[#0a1931]/40"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              id="portal-mobile-menu"
              className="relative h-full w-72 max-w-[82vw] shadow-2xl"
            >
              <PortalSidebar
                portal={portal}
                collapsed={false}
                onToggle={() => {}}
                mobile
                onNavigate={() => setMobileOpen(false)}
                onClose={() => setMobileOpen(false)}
              />
            </div>
          </div>
        )}

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
            onOpenMenu={() => setMobileOpen(true)}
            menuOpen={mobileOpen}
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
