"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAppDispatch } from "@/store/hooks";
import { clearUser } from "@/store/common/slices/auth.slice";
import { clearTenant } from "@/store/common/slices/tenant.slice";
import { authService } from "@/features/auth/services/auth.service";
import { AccountDestinationLoading } from "@/components/common/account-destination-loading";
import { ConfirmModal } from "@/components/ui";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { baseApi } from "@/store/api/base-api";
import { notificationApi } from "@/store/api/notification-api";
import { PortalAssistant } from "@/components/assistant/portal-assistant";

import { StudentHeader } from "./student-header";
import { StudentSidebarContent } from "./student-sidebar";

/*
 * ==========================================================================
 * STUDENT WEB SHELL
 *
 * A production-style web layout: a full-width header on top, a collapsible
 * sidebar on desktop (icon rail when collapsed) and a slide-in drawer on
 * mobile, and a fluid content area that expands as the sidebar collapses.
 * Logout reuses the project's clearUser/clearTenant flow + ConfirmModal.
 * ==========================================================================
 */

export function StudentAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const dispatch = useAppDispatch();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerPath, setMobileDrawerPath] = useState<string | null>(null);
  const mobileOpen = mobileDrawerPath === pathname;
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useScrollLock(mobileOpen);
  useLayoutEffect(() => {
    const isReportsPage = [
      "/student/profile/resume",
      "/student/courses",
      "/student/college",
      "/student/attribute",
      "/student/interview",
    ].some((route) => pathname === route || pathname.startsWith(`${route}/`));
    if ((pathname === "/student/profile" || isReportsPage) && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [pathname]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await authService.logout();
    } catch {
      // The auth service clears local credentials even when remote sign-out fails.
    }
    dispatch(clearUser());
    dispatch(clearTenant());
    dispatch(baseApi.util.resetApiState());
    dispatch(notificationApi.util.resetApiState());
    setLogoutOpen(false);
    router.replace("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#FFFCF7] font-sans text-[13px] leading-5">
      {/* Desktop sidebar - full height, collapsible to an icon rail */}
      <aside
        className={[
          "hidden shrink-0 border-r border-[#E7E0D4] bg-white transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-[232px]",
        ].join(" ")}
      >
        <StudentSidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
          onLogout={() => setLogoutOpen(true)}
        />
      </aside>

      {/* Mobile drawer + scrim */}
      <div
        data-scroll-lock-root
        className={[
          "fixed inset-0 z-40 md:hidden",
          mobileOpen ? "" : "pointer-events-none",
        ].join(" ")}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={mobileOpen ? 0 : -1}
          onClick={() => setMobileDrawerPath(null)}
          className={[
            "absolute inset-0 bg-[#0A1931]/40 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
        <aside
          className={[
            "absolute inset-y-0 left-0 w-72 max-w-[82%] border-r border-[#E7E0D4] bg-white shadow-2xl transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <StudentSidebarContent
            onNavigate={() => setMobileDrawerPath(null)}
            onClose={() => setMobileDrawerPath(null)}
            onLogout={() => {
              setMobileDrawerPath(null);
              setLogoutOpen(true);
            }}
          />
        </aside>
      </div>

      {/* Content column - header above the page content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <StudentHeader onOpenDrawer={() => setMobileDrawerPath(pathname)} />

        <main ref={contentRef} className="bp-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>

      <ConfirmModal
        open={logoutOpen}
        confirmLoading={isLoggingOut}
        variant="student"
        title="Log out?"
        description="You'll need to sign in again to see your score and applications."
        confirmLabel="Log out"
        cancelLabel="Stay"
        onConfirm={handleLogout}
        onClose={() => setLogoutOpen(false)}
      />
      <PortalAssistant />
      {isLoggingOut && (
        <div className="fixed inset-0 z-[120]">
          <AccountDestinationLoading message="Signing you out…" />
        </div>
      )}
    </div>
  );
}
