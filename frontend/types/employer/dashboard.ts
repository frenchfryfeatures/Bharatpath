export type EmployerDashboardApplicationStage =
  | "SUBMITTED"
  | "VIEWED"
  | "SHORTLISTED"
  | "INTERVIEW"
  | "DECISION"
  | "HIRED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED";

export type EmployerDashboardJobStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "PAUSED"
  | "CLOSED";

export type EmployerDashboardActivityKind =
  | "STAGE_CHANGED"
  | "INTERVIEW_SCHEDULED"
  | "HIRE_PROPOSED"
  | "HIRE_DISPUTED";

export type EmployerDashboardActivityActor =
  | "CANDIDATE"
  | "EMPLOYER"
  | "SYSTEM";

export interface EmployerDashboardApiResponse {
  generated_at: string;
  jobs: {
    total: number;
    active: number;
    draft: number;
    paused: number;
    closed: number;
  };
  applications: {
    total: number;
    open: number;
    distinct_candidates: number;
    new_last_7_days: number;
    new_last_30_days: number;
    by_stage: Record<EmployerDashboardApplicationStage, number>;
  };
  needs_attention: {
    unreviewed: number;
    interviews_to_schedule: number;
    interviews_next_7_days: number;
    hires_awaiting_candidate: number;
    hires_disputed: number;
    expiring_within_7_days: number;
  };
  candidates_revealed: {
    total: number;
    last_7_days: number;
  };
  top_jobs: Array<{
    job_id: string;
    title: string;
    status: EmployerDashboardJobStatus;
    applications: number;
    open: number;
    new_last_7_days: number;
    last_applied_at: string;
  }>;
  upcoming_interviews: Array<{
    application_id: string;
    job_id: string;
    job_title: string;
    interview_at: string;
    meeting_url: string;
  }>;
  applications_per_day: Array<{
    date: string;
    count: number;
  }>;
}

export interface EmployerDashboardActivityItemApiResponse {
  id: string;
  application_id: string;
  job_id: string;
  job_title: string | null;
  kind: EmployerDashboardActivityKind;
  from_stage: EmployerDashboardApplicationStage | null;
  to_stage: EmployerDashboardApplicationStage;
  by: EmployerDashboardActivityActor;
  actor_id: string | null;
  occurred_at: string;
}

export interface EmployerDashboardActivityPageApiResponse {
  items: EmployerDashboardActivityItemApiResponse[];
  next_cursor: string | null;
  total: number | null;
}