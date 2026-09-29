"use client";

import { useRouter } from "next/navigation";

import { useDashboard } from "../hooks/use-dashboard";
import { usePageHeader } from "@/components/layout/header-context";
import {
  CardSkeletonGrid,
  Skeleton,
} from "@/components/common/loading";
import { RecentActivityList } from "@/components/common/dashboard/recent-activity";
import { ErrorState } from "@/components/ui";

import { DashboardStats } from "./dashboard-stats";
import { QuickActions } from "./quick-actions";
import { TopJobs } from "./top-jobs";

export function EmployerDashboard() {
  const router = useRouter();

  usePageHeader(
    "Dashboard",
    "Overview of your hiring activity and account status",
  );

  const {
    data,
    isLoading,
    isError,
    hasMoreActivities,
    isLoadingMoreActivities,
    loadMoreActivities,
    refetch,
  } = useDashboard();

  /*
   * ==========================================
   * LOADING STATE
   * ==========================================
   */

  if (isLoading) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        {/* Stats */}
        <CardSkeletonGrid count={4} />

        {/* Main dashboard */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)]">
          <div className="flex flex-col gap-4">
            <Skeleton height={180} radius={12} />
            <Skeleton height={220} radius={12} />
          </div>
          <Skeleton height={416} radius={12} />
        </div>
      </div>
    );
  }

  /*
   * ==========================================
   * DASHBOARD
   * ==========================================
   */

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {isError ? (
        <ErrorState
          fallback="Some dashboard data could not be loaded. Please try again."
          onRetry={refetch}
        />
      ) : null}

      <DashboardStats stats={data.stats} />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <QuickActions
            disabled={!data.stats.hasAccess}
            onPostJob={() =>
              router.push("/employer/jobs/create")
            }
            onSearchCandidates={() =>
              router.push("/employer/candidates")
            }
            onReviewApplications={() =>
              router.push("/employer/applications")
            }
          />

          <TopJobs jobs={data.topJobs} />
        </div>

        <RecentActivityList
          activities={data.activities}
          hasMore={hasMoreActivities}
          isLoadingMore={isLoadingMoreActivities}
          onLoadMore={loadMoreActivities}
        />
      </div>
    </div>
  );
}