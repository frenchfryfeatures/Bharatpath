"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftToLine, LogOut, X } from "lucide-react";

import logo from "@/assets/bharatpath-icon.png";
import { useGetStudentProfileQuery } from "@/store/student";
import { initials } from "@/features/student/formatters";
import {
  identityDisplayLabel,
  identityInitials,
  useSessionIdentity,
} from "@/lib/auth/use-session-identity";

import { studentNavItems, isNavItemActive } from "./nav-items";

/*
 * ==========================================================================
 * STUDENT SIDEBAR CONTENT
 *
 * One nav body shared by the desktop rail (collapsible) and the mobile drawer.
 * `collapsed` shrinks it to an icon rail; `onToggleCollapse` renders the
 * in-sidebar collapse control (desktop); `onNavigate` closes the drawer on a
 * selection; `onClose` renders the drawer's close button; `onLogout` opens the
 * shared confirmation modal owned by the shell.
 * ==========================================================================
 */

export function StudentSidebarContent({
  collapsed = false,
  onNavigate,
  onLogout,
  onToggleCollapse,
  onClose,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onLogout: () => void;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const { data: profile } = useGetStudentProfileQuery();
  const { user: identity } = useSessionIdentity();
  const email = identity?.email || null;
  const displayName = profile?.fullName?.trim() || identityDisplayLabel(identity, "Student");
  const detail = profile?.fullName && email ? email : "Student account";
  const avatarInitials = profile?.fullName
    ? initials(profile.fullName)
    : identityInitials(email);

  const rowClass = (active: boolean) =>
    [
      "flex items-center rounded-lg text-[13px] font-semibold transition-colors",
      collapsed ? "justify-center px-2 py-2.5" : "gap-2.75 px-2.75 py-2.5",
      active
        ? "bg-[#F1EAF7] text-[#0A1931]"
        : "text-[#5F6B80] hover:bg-[#F7F4EC] hover:text-[#0A1931]",
    ].join(" ");

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Brand + collapse */}
      <div
        className={[
          "flex min-h-16 shrink-0 items-center border-b border-[#E7E0D4]",
          collapsed ? "justify-center px-2" : "gap-2.5 px-3",
        ].join(" ")}
      >
        {collapsed ? (
          <span className="group relative grid h-9 w-9 place-items-center">
            <Link
              href="/student"
              onClick={onNavigate}
              aria-label="Student home"
              className="absolute inset-0 transition-opacity group-hover:opacity-0"
            >
              <Image
                src={logo}
                alt=""
                className="h-full w-full object-contain"
                sizes="36px"
                priority
              />
            </Link>
            {onToggleCollapse ? (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                title="Expand sidebar"
                className="absolute inset-0 grid place-items-center rounded-xl opacity-0 transition-opacity hover:bg-[#F7F4EC] group-hover:opacity-100"
              >
                <ArrowLeftToLine size={16} className="rotate-180 text-[#5F6B80]" />
              </button>
            ) : null}
          </span>
        ) : (
          <>
            <Link
              href="/student"
              onClick={onNavigate}
              aria-label="Student home"
              className="flex min-w-0 flex-1 items-center gap-2.5"
            >
              <span className="h-9 w-9 shrink-0">
                <Image
                  src={logo}
                  alt=""
                  className="h-full w-full object-contain"
                  sizes="36px"
                  priority
                />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[15px] font-bold tracking-[-0.02em] text-[#0A1931]">
                  BharatPath
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5F6B80]">
                  Student
                </span>
              </span>
            </Link>

            {onToggleCollapse ? (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#5F6B80] transition-colors hover:bg-[#F7F4EC]"
              >
                <ArrowLeftToLine size={16} />
              </button>
            ) : null}

            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#5F6B80] transition-colors hover:bg-[#F7F4EC]"
              >
                <X size={18} />
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="bp-scrollbar flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3">
        {studentNavItems.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={rowClass(active)}
            >
              <Icon size={16} strokeWidth={active ? 2.4 : 1.9} className="shrink-0" />
              {!collapsed ? item.label : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer: profile + logout icon */}
      <div className="mt-auto shrink-0 border-t border-[#E7E0D4]">
        <div
          className={[
            "flex min-h-[72px] items-center gap-2.5",
            collapsed ? "flex-col justify-center gap-2 px-2 py-3" : "px-3",
          ].join(" ")}
        >
          <Link
            href="/student/profile"
            onClick={onNavigate}
            title={collapsed ? displayName : undefined}
            className={[
              "flex min-w-0 items-center gap-2.5 rounded-lg transition-colors",
              collapsed ? "" : "flex-1",
            ].join(" ")}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#5F4DB2] text-[13px] font-bold text-white">
              {avatarInitials}
            </span>
            {!collapsed ? (
              <span className="flex min-w-0 flex-col">
                <span
                  className="truncate text-[13px] font-semibold text-[#0A1931]"
                  title={displayName}
                >
                  {displayName}
                </span>
                <span
                  className="truncate text-[12px] text-[#5F6B80]"
                  title={detail}
                >
                  {detail}
                </span>
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#5F6B80] transition-colors hover:bg-[#F8E6E0] hover:text-[#993A22]"
          >
            <LogOut size={16} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  );
}
