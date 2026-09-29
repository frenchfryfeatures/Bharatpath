"use client";

import {
  BriefcaseBusiness,
  CalendarCheck,
  ListChecks,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { MetricCard } from "@/components/common/dashboard/metric-card";

import type { EmployerDashboardStats } from "../types";

interface DashboardStatsProps {
  stats: EmployerDashboardStats;
}

export function DashboardStats({
  stats,
}: DashboardStatsProps) {
  const router = useRouter();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Active jobs"
        value={stats.activeJobs}
        icon={BriefcaseBusiness}
        tone="blue"
        onClick={() => router.push("/employer/jobs")}
      />

      <MetricCard
        title="Applicants in pipeline"
        value={stats.applicantsInPipeline}
        icon={ListChecks}
        tone="green"
        onClick={() => router.push("/employer/applications")}
      />

      <MetricCard
        title="Interviews in progress"
        value={stats.interviewsInProgress}
        icon={CalendarCheck}
        tone="orange"
        onClick={() => router.push("/employer/applications")}
      />

      <MetricCard
        title="New applications"
        value={stats.newApplicationsLast7Days}
        icon={UserPlus}
        tone="purple"
        status="Last 7 days"
        onClick={() => router.push("/employer/applications")}
      />
    </div>
  );
}