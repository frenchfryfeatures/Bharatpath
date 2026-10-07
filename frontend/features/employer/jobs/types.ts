import type { JobDetails } from "@/features/jobs/job-details";

export type JobStatus = "live" | "draft" | "paused" | "closed";

export interface EmployerJob {
  id: string;
  title: string;
  status: JobStatus;
  location: string;
  salaryMin: number;
  salaryMax: number;
  minScore: number | null;
  applicantsCount: number;
  applicantsInPipelineCount: number;
  viewedCount: number;
  shortlistedCount: number;
  interviewCount: number;
  hiredCount: number;
  rejectedCount: number;
  skills: string[];
}

export type ApiJobStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "PAUSED"
  | "CLOSED";

export type JobWorkMode =
  | "ONSITE"
  | "HYBRID"
  | "REMOTE";

export type ApiApplicationStage =
  | "SUBMITTED"
  | "VIEWED"
  | "SHORTLISTED"
  | "INTERVIEW"
  | "DECISION"
  | "HIRED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED";

export interface EmployerJobApiResponse {
  id: string;
  title: string;
  description: string;
  skills: string[];
  location: string | null;
  work_mode: JobWorkMode | null;
  experience_min_months: number | null;
  salary_min_minor: number;
  salary_max_minor: number;
  min_score: number | null;
  /** Absent from an API that predates `jobs.details`. */
  details?: Partial<JobDetails>;
  status: ApiJobStatus;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface EmployerJobListItemApiResponse
  extends EmployerJobApiResponse {
  application_counts: {
    total: number;
    by_stage: Record<ApiApplicationStage, number>;
  };
}

export interface EmployerJobPageApiResponse {
  items: EmployerJobListItemApiResponse[];
  next_cursor: string | null;
  total: number | null;
}
