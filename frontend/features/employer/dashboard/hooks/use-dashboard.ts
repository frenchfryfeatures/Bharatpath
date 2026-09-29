"use client";

import { useMemo } from "react";

import { useGetEmployerSubscriptionQuery } from "@/store/employer/billing";
import {
  useGetEmployerDashboardActivityInfiniteQuery,
  useGetEmployerDashboardQuery,
} from "@/store/employer/dashboard";

import type {
  EmployerDashboardActivityItemApiResponse,
  EmployerDashboardApplicationStage,
  EmployerDashboardApiResponse,
} from "@/types/employer/dashboard";
import type {
  EmployerDashboardActivity,
  EmployerDashboardData,
} from "../types";

const STAGE_LABELS: Record<
  EmployerDashboardApplicationStage,
  string
> = {
  SUBMITTED: "submitted",
  VIEWED: "viewed",
  SHORTLISTED: "shortlisted",
  INTERVIEW: "interview",
  DECISION: "decision",
  HIRED: "hired",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
  EXPIRED: "expired",
};

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toActivity(
  activity: EmployerDashboardActivityItemApiResponse,
): EmployerDashboardActivity {
  const job = activity.job_title ?? "a job";

  if (activity.kind === "INTERVIEW_SCHEDULED") {
    return {
      id: activity.id,
      text: `Interview scheduled for ${job}`,
      time: formatActivityTime(activity.occurred_at),
      type: "upload",
    };
  }

  if (activity.kind === "HIRE_PROPOSED") {
    return {
      id: activity.id,
      text: `Hire proposed for ${job}`,
      time: formatActivityTime(activity.occurred_at),
      type: "hire",
    };
  }

  if (activity.kind === "HIRE_DISPUTED") {
    return {
      id: activity.id,
      text: `Hire disputed for ${job}`,
      time: formatActivityTime(activity.occurred_at),
      type: "hire",
    };
  }

  if (activity.to_stage === "SUBMITTED") {
    return {
      id: activity.id,
      text: `New application received for ${job}`,
      time: formatActivityTime(activity.occurred_at),
      type: "link",
    };
  }

  if (activity.to_stage === "HIRED") {
    return {
      id: activity.id,
      text: `Hire confirmed for ${job}`,
      time: formatActivityTime(activity.occurred_at),
      type: "hire",
    };
  }

  return {
    id: activity.id,
    text: `Application moved to ${STAGE_LABELS[activity.to_stage]} for ${job}`,
    time: formatActivityTime(activity.occurred_at),
    type: "upload",
  };
}

function toDashboardData(
  dashboard: EmployerDashboardApiResponse | undefined,
  activities: EmployerDashboardActivityItemApiResponse[],
  hasAccess: boolean,
): EmployerDashboardData {
  return {
    stats: {
      activeJobs: dashboard?.jobs.active ?? 0,
      applicantsInPipeline: dashboard?.applications.open ?? 0,
      interviewsInProgress:
        dashboard?.applications.by_stage.INTERVIEW ?? 0,
      newApplicationsLast7Days:
        dashboard?.applications.new_last_7_days ?? 0,
      hasAccess,
    },
    topJobs:
      dashboard?.top_jobs.map((job) => ({
        id: job.job_id,
        title: job.title,
        applicants: job.applications,
      })) ?? [],
    activities: activities.map(toActivity),
  };
}

export function useDashboard() {
  const subscriptionQuery = useGetEmployerSubscriptionQuery();
  const hasAccess = subscriptionQuery.data?.has_access ?? false;
  const dashboardQuery = useGetEmployerDashboardQuery(
    { topJobs: 3 },
    { skip: !hasAccess },
  );
  const activityQuery = useGetEmployerDashboardActivityInfiniteQuery(
    { limit: 10 },
    { skip: !hasAccess },
  );
  const activityItems = useMemo(
    () =>
      activityQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [activityQuery.data],
  );

  const data = useMemo(
    () =>
      toDashboardData(
        dashboardQuery.data,
        activityItems,
        hasAccess,
      ),
    [
      activityItems,
      dashboardQuery.data,
      hasAccess,
    ],
  );

  return {
    data,
    isLoading:
      subscriptionQuery.isLoading ||
      (hasAccess &&
        (dashboardQuery.isLoading || activityQuery.isLoading)),
    isError:
      subscriptionQuery.isError ||
      (hasAccess &&
        (dashboardQuery.isError || activityQuery.isError)),
    hasMoreActivities: Boolean(activityQuery.hasNextPage),
    isLoadingMoreActivities: activityQuery.isFetchingNextPage,
    loadMoreActivities: () => {
      if (
        activityQuery.hasNextPage &&
        !activityQuery.isFetchingNextPage
      ) {
        void activityQuery.fetchNextPage();
      }
    },
    refetch: () => {
      void subscriptionQuery.refetch();
      if (hasAccess) {
        void dashboardQuery.refetch();
        void activityQuery.refetch();
      }
    },
  };
}
