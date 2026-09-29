export interface EmployerDashboardStats {
  activeJobs: number;
  applicantsInPipeline: number;
  interviewsInProgress: number;
  newApplicationsLast7Days: number;
  hasAccess: boolean;
}

export interface EmployerTopJob {
  id: string;
  title: string;
  applicants: number;
}

export interface EmployerDashboardActivity {
  id: string;
  text: string;
  time: string;
  type: "link" | "upload" | "hire" | "invoice";
}

export interface EmployerDashboardData {
  stats: EmployerDashboardStats;
  topJobs: EmployerTopJob[];
  activities: EmployerDashboardActivity[];
}