"use client";

import {
  Armchair,
  ChevronRight,
  Menu,
  // FlaskConical, // kept for the temporarily disabled DEMO STATE control
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { selectPortal } from "@/store/common/selectors/tenant.selectors";

import {
  PORTAL_TYPES,
  PortalType,
} from "@/config/portal";

import { useGetEmployerSubscriptionQuery } from "@/store/employer/billing";
import { setActiveTab } from "@/store/employer/settings";

import { NotificationCenter } from "@/features/notifications";
import { Skeleton } from "@/components/common/loading";

import { SubscriptionStatusButton } from "@/features/employer/billing/components/subscription-status-button";

import { useHeaderContent } from "./header-context";

interface PortalHeaderProps {
  portal: "college" | "employer" | "student" | "admin";
  onOpenMenu?: () => void;
  menuOpen?: boolean;

  /**
   * Called when the DEMO STATE control is clicked.
   *
   * The actual demo-state panel is controlled by
   * the parent Portal/Admin layout.
   */
  onDemoStateClick?: () => void;
}

const PORTAL_BADGE_LABEL: Record<PortalType, string> = {
  [PORTAL_TYPES.COLLEGE]: "DEMO STATE",
  [PORTAL_TYPES.STUDENT]: "DEMO STATE",
  [PORTAL_TYPES.EMPLOYER]: "DEMO STATE",
  [PORTAL_TYPES.ADMIN]: "DEMO STATE",
};

const createJobButtonClassName =
  "h-[36px] shrink-0 items-center gap-[7px] rounded-[8px] bg-[#5B4FCF] px-[14px] text-[13px] font-[600] text-white transition-colors hover:bg-[#5044C0] active:bg-[#483cb2]";

export function PortalHeader({
  portal: currentPortal,
  onDemoStateClick,
  onOpenMenu,
  menuOpen = false,
}: PortalHeaderProps) {
  /*
   * ==========================================
   * HEADER CONTENT
   * ==========================================
   */

  const {
    title,
    subtitle,
    breadcrumbs,
    // badge, // kept for the temporarily disabled DEMO STATE control
    stat,
    action,
  } = useHeaderContent();

  /*
   * ==========================================
   * ROUTER
   * ==========================================
   */

  const pathname = usePathname();
  const router = useRouter();

  /*
   * ==========================================
   * CURRENT PORTAL
   * ==========================================
   */

  const reduxPortal = useAppSelector(selectPortal);

  const portal =
    currentPortal ?? reduxPortal;

  /*
   * ==========================================
   * REDUX
   * ==========================================
   */

  const dispatch = useAppDispatch();

  /*
   * ==========================================
   * PORTAL CHECK
   * ==========================================
   */

  const isEmployer =
    portal === PORTAL_TYPES.EMPLOYER;

  /*
   * ==========================================
   * EMPLOYER SUBSCRIPTION
   *
   * The header billing widget reflects the real
   * subscription (GET /employer/subscription).
   * Skipped entirely outside the employer portal.
   * ==========================================
   */

  const {
    data: subscription,
    isLoading: isSubscriptionLoading,
  } = useGetEmployerSubscriptionQuery(undefined, {
    skip: !isEmployer,
  });

  const isAdmin =
    portal === PORTAL_TYPES.ADMIN;

  /*
   * ==========================================
   * JOBS PAGE CHECK
   *
   * Create Job is shown only for Employer Jobs.
   * ==========================================
   */

  const isEmployerJobsPage =
    isEmployer &&
    pathname === "/employer/jobs";

  /*
   * ==========================================
   * RESOLVED BADGE
   * ==========================================
   */

  // Temporarily disabled with the DEMO STATE control below (kept for later).
  // const resolvedBadge = badge ?? {
  //   icon: FlaskConical,
  //   label:
  //     portal &&
  //     portal in PORTAL_BADGE_LABEL
  //       ? PORTAL_BADGE_LABEL[
  //           portal as PortalType
  //         ]
  //       : "DEMO STATE",
  // };

  /*
   * ==========================================
   * BILLING
   *
   * The widget routes to the real billing surface
   * (Settings → Subscription), not a mock credit modal.
   * ==========================================
   */

  const handleOpenBilling = () => {
    dispatch(setActiveTab("subscription"));
    router.push("/employer/settings");
  };

  /*
   * ==========================================
   * CREATE JOB
   * ==========================================
   */

  const handleCreateJob = () => {
    router.push("/employer/jobs/create");
  };

  return (
    <>
      <header
        className="
          flex
          min-h-[64px]
          shrink-0
          items-center
          gap-[12px]
          border-b
          border-[#e7e9ee]
          bg-white
          px-[16px]
          py-[10px]
          max-md:flex-wrap
          max-md:gap-y-2
        "
        style={{
          fontFamily:
            "'General Sans', sans-serif",
        }}
      >
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          aria-controls="portal-mobile-menu"
          aria-expanded={menuOpen}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#151b2b] hover:bg-[#f3f4f7] md:hidden"
        >
          <Menu size={20} />
        </button>
        {/* ==========================================
            TITLE + SUBTITLE
            ========================================== */}

        <div
          className="
            flex
            min-w-0
            flex-1
            flex-col
            gap-[2px]
            max-md:order-1
          "
        >
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-[6px] text-[12px] leading-[16px]"
              style={{ fontFamily: "'General Sans', sans-serif" }}
            >
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <span
                    key={`${crumb.label}-${index}`}
                    className="flex min-w-0 items-center gap-[6px]"
                  >
                    {crumb.isLoading ? (
                      <span role="status" className="flex items-center">
                        <span className="sr-only">{crumb.label}</span>
                        <Skeleton width={112} height={12} radius={6} />
                      </span>
                    ) : crumb.href && !isLast ? (
                      <button
                        type="button"
                        onClick={() => router.push(crumb.href as string)}
                        className="shrink-0 cursor-pointer font-[500] text-[#3566b8] hover:underline"
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span
                        className={
                          isLast
                            ? "truncate font-[500] text-[#5D6673]"
                            : "shrink-0 text-[#5D6673]"
                        }
                      >
                        {crumb.label}
                      </span>
                    )}

                    {!isLast ? (
                      <ChevronRight
                        size={13}
                        className="shrink-0 text-[#9aa2b1]"
                      />
                    ) : null}
                  </span>
                );
              })}
            </nav>
          ) : null}

          <h1
            className="
              m-0
              truncate
              text-[18px]
              font-[700]
              leading-[23px]
              tracking-[-0.01em]
              text-[#151b2b]
            "
            style={{
              fontFamily:
                "'General Sans', sans-serif",
              fontWeight: 700,
            }}
          >
            {title}
          </h1>

          <span
            className="
              truncate
              whitespace-nowrap
              text-[12px]
              font-[400]
              leading-[17px]
              text-[#5D6673]
            "
            style={{
              fontFamily:
                "'General Sans', sans-serif",
              fontWeight: 400,
            }}
          >
            {subtitle}
          </span>
        </div>

        {/* ==========================================
            DEMO STATE - temporarily disabled (kept for later)
            ========================================== */}

        {/* {!isAdmin && <button
          type="button"
          onClick={onDemoStateClick}
          aria-label="Open demo state options"
          aria-expanded={Boolean(onDemoStateClick)}
          className="
            hidden
            shrink-0
            items-center
            gap-[6px]
            rounded-[8px]
            px-[6px]
            py-[7px]
            text-[#5d6673]
            transition-colors
            hover:bg-[#f5f7fa]
            hover:text-[#151b2b]
            sm:flex
          "
        >
          {resolvedBadge.icon && (
            <resolvedBadge.icon
              size={14}
              strokeWidth={2}
              className="shrink-0"
            />
          )}

          <span
            className="
              text-[11px]
              font-[600]
              leading-[14px]
              tracking-[0.04em]
            "
          >
            {resolvedBadge.label}
          </span>
        </button>} */}

        {/* ==========================================
            EMPLOYER CREDITS
            ========================================== */}

        {isEmployer && (
          <>
            <div className="hidden md:block">
              <SubscriptionStatusButton
                subscription={subscription}
                isLoading={isSubscriptionLoading}
                onClick={handleOpenBilling}
              />
            </div>
            <div className={`order-3 flex w-full flex-wrap items-center gap-2 md:hidden ${isEmployerJobsPage ? "justify-between" : "justify-end"}`}>
              {isEmployerJobsPage && (
                <button
                  type="button"
                  onClick={handleCreateJob}
                  className={`inline-flex ${createJobButtonClassName}`}
                >
                  Create job
                </button>
              )}
              <SubscriptionStatusButton
                subscription={subscription}
                isLoading={isSubscriptionLoading}
                onClick={handleOpenBilling}
              />
            </div>
          </>
        )}

        {/* ==========================================
            COLLEGE / STUDENT STAT
            ========================================== */}

        {!isEmployer && !isAdmin && stat?.isLoading ? (
          <div
            role="status"
            aria-label="Loading seat usage"
            aria-busy="true"
            className="
              flex
              h-[40px]
              shrink-0
              items-center
              gap-[10px]
              rounded-xl
              border
              border-[#e5e7ec]
              bg-white
              px-[10px]
              pl-[6px]
              max-md:order-3
              max-md:basis-full
            "
          >
            <span className="sr-only">Loading seat usage…</span>
            <Skeleton width={28} height={28} radius={8} />
            <span className="flex flex-col gap-[5px]">
              <Skeleton width={112} height={13} radius={6} />
              <Skeleton width={96} height={4} radius={999} />
            </span>
            <Skeleton width={14} height={14} radius={5} />
          </div>
        ) : null}

        {!isEmployer && !isAdmin && stat && !stat.isLoading ? (
          <button
            type="button"
            aria-label={
              stat.warning ? `${stat.label} - open billing` : "Seats used - open billing"
            }
            title={
              stat.warning
                ? `${stat.label} - open Seats & payment to buy a plan`
                : `${stat.label} - open Seats & payment to add more before you run out`
            }
            onClick={() => {
              if (stat.href) router.push(stat.href);
            }}
            className={`
              flex
              h-[40px]
              shrink-0
              cursor-pointer
              items-center
              gap-[10px]
              rounded-xl
              border
              px-[10px]
              pl-[6px]
              transition-colors
              max-md:order-3
              max-md:basis-full
              ${
                stat.warning
                  ? "border-[#f2d3a0] bg-[#fff8ec] hover:bg-[#fff1d9]"
                  : "border-[#e5e7ec] bg-white hover:border-[#cfd3dc] hover:bg-[#f8fafc]"
              }
            `}
          >
            <span
              className={`
                grid
                h-[28px]
                w-[28px]
                shrink-0
                place-items-center
                rounded-[8px]
                ${stat.warning ? "bg-[#ffecc8]" : "bg-[#edf2fa]"}
              `}
            >
              <Armchair
                size={15}
                strokeWidth={2.2}
                className={stat.warning ? "text-[#ad6b0b]" : "text-[#2c62c4]"}
              />
            </span>

            <span
              className="
                flex
                min-w-0
                flex-col
                gap-[3px]
              "
            >
              <span
                className={`
                  whitespace-nowrap
                  text-[13px]
                  font-[700]
                  leading-[16px]
                  ${stat.warning ? "text-[#8a5a00]" : "text-[#151b2b]"}
                `}
              >
                {stat.label}
              </span>

              {typeof stat.progress ===
                "number" && (
                <span
                  className="
                    block
                    h-[3.5px]
                    w-[96px]
                    overflow-hidden
                    rounded-full
                    bg-[#e5e7ec]
                  "
                >
                  <span
                    className="
                      block
                      h-full
                      rounded-full
                      bg-[#2c62c4]
                    "
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          stat.progress,
                        ),
                      )}%`,
                    }}
                  />
                </span>
              )}
            </span>

            <ChevronRight
              size={14}
              strokeWidth={2}
              className="shrink-0 text-[#777f90]"
            />
          </button>
        ) : null}

        {/* ==========================================
            OTHER PAGE ACTION
            ========================================== */}

        {action && (
          <div
            className="
              flex
              shrink-0
              items-center
              max-md:order-4
            "
          >
            {action}
          </div>
        )}

        {/* ==========================================
            NOTIFICATIONS
            ========================================== */}

        <div className="shrink-0 max-md:order-2">
          <NotificationCenter />
        </div>

        {/* ==========================================
            CREATE JOB
            ONLY ON EMPLOYER JOBS PAGE
            ========================================== */}

        {isEmployerJobsPage && (
          <button
            type="button"
            onClick={handleCreateJob}
            className={`hidden md:inline-flex ${createJobButtonClassName}`}
          >
            Create job
          </button>
        )}
      </header>
    </>
  );
}
