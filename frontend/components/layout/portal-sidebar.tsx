"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftToLine,
  LogOut,
} from "lucide-react";

import {
  adminNavigation,
  collegeNavigation,
  employerNavigation,
} from "@/config/navigation";

import {
  useAppDispatch,
} from "@/store/hooks";

import {
  clearTenant,
} from "@/store/common/slices/tenant.slice";

import {
  clearUser,
} from "@/store/common/slices/auth.slice";

import { clearStoredToken } from "@/lib/auth/token";
import {
  identityInitials,
  roleLabel,
  useSessionIdentity,
} from "@/lib/auth/use-session-identity";

import { ConfirmModal } from "@/components/ui";
import { Skeleton } from "@/components/common/loading";
import { useGetCollegeOrganisationQuery } from "@/store/college/settings/settings.api";
import { useGetEmployerDashboardQuery } from "@/store/employer/dashboard";
import { useGetEmployerOrganisationQuery } from "@/store/employer/settings";
import logo from "@/assets/Logo.png";

interface PortalSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  portal: "college" | "employer" | "student" | "admin";
}

export function PortalSidebar({
  collapsed,
  onToggle,
  portal,
}: Readonly<PortalSidebarProps>) {
  const pathname = usePathname();
  const router = useRouter();

  const dispatch = useAppDispatch();
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);

  /*
   * ============================================================
   * SIGNED-IN ACCOUNT
   * ============================================================
   *
   * The person comes from the session; the organisation from the
   * portal's own organisation endpoint. Nothing here is a placeholder:
   * while either is loading, a skeleton is shown instead.
   */

  const { user: identity, isResolving: isIdentityResolving } =
    useSessionIdentity();
  const employerOrganisation = useGetEmployerOrganisationQuery(undefined, {
    skip: portal !== "employer",
  });
  const collegeOrganisation = useGetCollegeOrganisationQuery(undefined, {
    skip: portal !== "college",
  });

  const organisationName =
    portal === "employer"
      ? employerOrganisation.data?.legalName || null
      : portal === "college"
        ? collegeOrganisation.data?.name || null
        : portal === "admin"
          ? "BharatPath operations"
          : null;

  const accountEmail = identity?.email || null;
  const accountTitle = accountEmail ?? "Signed-in account";
  const accountRole = roleLabel(identity?.backendRole);
  const accountDetail =
    [accountRole, organisationName].filter(Boolean).join(" · ") ||
    (portal === "employer"
      ? "Employer account"
      : portal === "college"
        ? "College account"
        : "Staff account");
  const initials = identityInitials(accountEmail);

  /*
   * ============================================================
   * APPLICATIONS BADGE
   * ============================================================
   *
   * Only employer has Applications.
   *
   * The paginated applications list only contains loaded rows. The dashboard
   * aggregate is the authoritative count across the full organisation.
   */

  const employerDashboardQuery = useGetEmployerDashboardQuery(
    { topJobs: 3 },
    { skip: portal !== "employer" },
  );
  const pendingApplications =
    portal === "employer"
      ? employerDashboardQuery.data?.applications.open ?? 0
      : 0;

  /*
   * ============================================================
   * NAVIGATION
   * ============================================================
   *
   * Employer has its own navigation.
   *
   * Student currently falls back to college navigation until
   * studentNavigation exists.
   */

  const navigation =
    portal === "employer"
      ? employerNavigation
      : portal === "admin"
        ? adminNavigation
        : collegeNavigation;

  /*
   * ============================================================
   * BASE PATH
   * ============================================================
   */

  const basePath =
    portal === "employer"
      ? "/employer"
      : portal === "admin"
        ? "/admin/dashboard"
      : portal === "student"
        ? "/student"
        : "/college";

  /*
   * ============================================================
   * PORTAL LABEL
   * ============================================================
   */

  const portalLabel =
    portal === "employer"
      ? "EMPLOYER"
      : portal === "admin"
        ? "ADMIN"
      : portal === "student"
        ? "STUDENT"
        : "COLLEGE";

  /*
   * ============================================================
   * LOGOUT
   * ============================================================
   */

  const handleLogout = () => {
    clearStoredToken();
    dispatch(clearUser());
    dispatch(clearTenant());

    router.push("/api/auth/logout");
  };

  return (
    <aside
      className="
        hidden
        h-full
        shrink-0
        flex-col
        border-r
        border-[#e7e9ee]
        bg-white
        transition-all
        duration-200
        lg:flex
      "
      style={{
        width: collapsed ? 64 : 232,
      }}
    >
      {/* =========================================================
          SIDEBAR HEADER
      ========================================================= */}

      <div
        className={`group relative flex min-h-6 items-center gap-2.25 ${
          collapsed
            ? "justify-center px-2 py-5"
            : ""
        }`}
        style={
          collapsed
            ? undefined
            : {
                padding:
                  "20px 12px 16px 16px",
              }
        }
      >
        {collapsed ? (
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
            {/* =====================================================
                COLLAPSED LOGO
            ====================================================== */}

            <Link
              href={basePath}
              aria-label="Go to dashboard"
              className="
                absolute
                inset-0
                cursor-pointer
                opacity-100
                transition-opacity
                group-hover:opacity-0
              "
            >
              <Image
                src={logo}
                alt=""
                className="h-full w-full object-contain"
                sizes="32px"
                priority
              />
            </Link>

            {/* =====================================================
                EXPAND BUTTON
            ====================================================== */}

            <button
              type="button"
              onClick={onToggle}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="
                absolute
                inset-0
                grid
                cursor-pointer
                place-items-center
                rounded-lg
                opacity-0
                transition-opacity
                hover:bg-[#f3f4f7]
                group-hover:opacity-100
              "
            >
              <ArrowLeftToLine
                size={16}
                className="rotate-180"
                style={{
                  color:
                    "var(--ink-muted)",
                }}
              />
            </button>
          </span>
        ) : (
          <>
            {/* =====================================================
                LOGO
            ====================================================== */}

            <Link
              href={basePath}
              aria-label="Go to dashboard"
              className="
                h-8
                w-8
                shrink-0
                cursor-pointer
              "
            >
              <Image
                src={logo}
                alt=""
                className="h-full w-full object-contain"
                sizes="32px"
                priority
              />
            </Link>

            {/* =====================================================
                BRAND
            ====================================================== */}

            <span className="flex min-w-0 flex-1 flex-col overflow-hidden whitespace-nowrap">
              <span
                style={{
                  font: '800 14px/17px "General Sans", sans-serif',
                  letterSpacing:
                    "-0.01em",
                  color: "#151b2b",
                }}
              >
                BharatPath
              </span>

              <span
                style={{
                  font: '700 10px/13px "General Sans", sans-serif',
                  letterSpacing:
                    "0.14em",
                  color:
                    "var(--ink-muted)",
                }}
              >
                {portalLabel}
              </span>
            </span>

            {/* =====================================================
                COLLAPSE BUTTON
            ====================================================== */}

            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="
                grid
                h-7
                w-7
                shrink-0
                cursor-pointer
                place-items-center
                rounded-lg
                hover:bg-[#f3f4f7]
              "
            >
              <ArrowLeftToLine
                size={16}
                style={{
                  color:
                    "var(--ink-muted)",
                }}
              />
            </button>
          </>
        )}
      </div>

      {/* =========================================================
          NAVIGATION
      ========================================================= */}

      <nav className="flex-1 overflow-y-auto px-3 bp-scrollbar">
        <div className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;

            /*
             * ======================================
             * RESOLVE HREF
             * ======================================
             */

            let href: string;

            if (portal === "employer" || portal === "admin") {
              /*
               * Employer navigation already contains
               * /employer/... paths.
               */
              href = item.href;
            } else if (portal === "student") {
              /*
               * Student currently uses the same navigation
               * structure as college, but under /student.
               */
              href =
                item.href === "/"
                  ? "/student"
                  : `/student${item.href}`;
            } else {
              /*
               * College navigation uses relative paths.
               */
              href =
                item.href === "/"
                  ? "/college"
                  : `/college${item.href}`;
            }

            /*
             * ======================================
             * ACTIVE STATE
             * ======================================
             */

            const isDashboard =
              portal === "employer"
                ? item.href === "/employer"
                : portal === "admin"
                  ? item.href === "/admin/dashboard"
                  : item.href === "/";

            const active = isDashboard
              ? pathname === href
              : pathname === href ||
                pathname.startsWith(
                  `${href}/`,
                );

            /*
             * ======================================
             * APPLICATIONS ITEM
             * ======================================
             *
             * We identify Applications using its key.
             *
             * This is safer than checking the label.
             */

            const isApplications =
              portal === "employer" &&
              item.key === "applications";

            return (
              <Link
                key={item.key}
                href={href}
                title={
                  collapsed
                    ? item.label
                    : undefined
                }
                style={{
                  font: '600 13px/17px "General Sans", sans-serif',
                  color: active
                    ? "var(--navy)"
                    : "var(--ink-muted)",
                  whiteSpace: "nowrap",
                  background: active
                    ? "var(--indigo-bg)"
                    : undefined,
                }}
                className={`
                  relative
                  flex
                  min-h-10
                  cursor-pointer
                  items-center
                  gap-2.75
                  rounded-lg
                  px-2.75
                  py-2.5
                  transition
                  ${
                    collapsed
                      ? "justify-center px-2"
                      : "justify-start"
                  }
                  ${
                    active
                      ? ""
                      : "hover:bg-[#f5f6f8] hover:text-(--navy)"
                  }
                `}
              >
                {/* =================================================
                    ICON
                ================================================== */}

                <Icon
                  size={16}
                  strokeWidth={1.9}
                  className="shrink-0"
                />

                {!collapsed && (
                  <>
                    {/* =============================================
                        LABEL
                    ============================================== */}

                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>

                    {/* =============================================
                        APPLICATIONS BADGE
                    ==============================================

                        IMPORTANT:

                        This is intentionally rendered even when
                        Applications is the ACTIVE page.

                        Therefore:

                        Dashboard       → Applications 5
                        Jobs             → Applications 5
                        Candidates      → Applications 5
                        Applications    → Applications 5
                        Settings        → Applications 5

                        It disappears only when the pending count
                        becomes zero.
                    ============================================== */}

                    {isApplications &&
                      pendingApplications >
                        0 && (
                        <span
                          aria-label={`${pendingApplications} applications in pipeline`}
                          className="
                            grid
                            h-5
                            min-w-5
                            shrink-0
                            place-items-center
                            rounded-full
                            bg-[#c9342f]
                            px-1.5
                            text-[10px]
                            font-bold
                            leading-none
                            text-white
                          "
                        >
                          {pendingApplications >
                          99
                            ? "99+"
                            : pendingApplications}
                        </span>
                      )}
                  </>
                )}

                {/* =================================================
                    COLLAPSED SIDEBAR APPLICATION BADGE
                ==================================================

                    When sidebar is collapsed there is no label,
                    so we position a small badge over the item.

                    The Link has `relative`, so this stays attached
                    to the Applications navigation item.
                ================================================== */}

                {collapsed &&
                  isApplications &&
                  pendingApplications >
                    0 && (
                    <span
                      aria-label={`${pendingApplications} applications in pipeline`}
                      className="
                        absolute
                        right-[2px]
                        top-[2px]
                        grid
                        h-4
                        min-w-4
                        place-items-center
                        rounded-full
                        bg-[#c9342f]
                        px-1
                        text-[8px]
                        font-bold
                        leading-none
                        text-white
                        ring-2
                        ring-white
                      "
                    >
                      {pendingApplications >
                      99
                        ? "99+"
                        : pendingApplications}
                    </span>
                  )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* =========================================================
          BOTTOM USER SECTION
      ========================================================= */}

      <div
        className="mt-auto shrink-0 border-t"
        style={{
          borderColor:
            "var(--border-hair)",
        }}
      >
        <div
          className={`
            flex
            min-h-[76px]
            items-center
            gap-[10px]
            ${
              collapsed
                ? "flex-col justify-center gap-2 px-2 py-3"
                : "px-[16px]"
            }
          `}
        >
          {/* =====================================================
              USER AVATAR
          ====================================================== */}

          <span
            title={collapsed ? accountTitle : undefined}
            className="
              grid
              h-10
              w-10
              shrink-0
              place-items-center
              rounded-full
            "
            style={{
              background:
                "var(--navy)",
              color: "#fff",
              font: '600 13px/16px "General Sans", sans-serif',
            }}
          >
            {isIdentityResolving ? "" : initials}
          </span>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              {!isIdentityResolving ? (
                <>
                  {/* ===========================================
                      SIGNED-IN PERSON
                  ============================================ */}

                  <div
                    className="truncate"
                    title={accountTitle}
                    style={{
                      font: '600 13px/17px "General Sans", sans-serif',
                      color:
                        "var(--navy)",
                    }}
                  >
                    {accountTitle}
                  </div>

                  {/* ===========================================
                      ROLE · ORGANISATION
                  ============================================ */}

                  <div
                    className="truncate"
                    title={accountDetail}
                    style={{
                      marginTop: "1px",
                      font: '400 12px/16px "General Sans", sans-serif',
                      color:
                        "var(--ink-muted)",
                    }}
                  >
                    {accountDetail}
                  </div>
                </>
              ) : (
                <div aria-busy="true" className="space-y-1.5">
                  <span className="sr-only">Loading account</span>
                  <Skeleton width="80%" height={12} radius={6} />
                  <Skeleton width="55%" height={10} radius={6} />
                </div>
              )}
            </div>
          )}

          {/* =================================================
              LOGOUT — available collapsed too
          ================================================== */}

          <button
            type="button"
            onClick={() => setLogoutModalOpen(true)}
            aria-label="Log out"
            title="Log out"
            className="
              grid
              h-8
              w-8
              shrink-0
              cursor-pointer
              place-items-center
              rounded-lg
              text-(--ink-muted)
              transition-colors
              hover:bg-[#fdecec]
              hover:text-[#c43d3d]
            "
          >
            <LogOut
              size={18}
              strokeWidth={1.8}
            />
          </button>
        </div>
      </div>

      <ConfirmModal
        open={logoutModalOpen}
        title="Log out of BharatPath?"
        description="You will need to sign in again to access this portal."
        confirmLabel="Log out"
        onClose={() => setLogoutModalOpen(false)}
        onConfirm={handleLogout}
      />
    </aside>
  );
}
