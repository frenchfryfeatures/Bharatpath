import type { RevealedCandidateResponse } from "@/store/employer/candidates/candidates.api";

export type ApplicationStage =
  | 0
  | 1
  | 2
  | 3
  | 4;

export type ApplicationOutcome =
  | "hired"
  | "rejected"
  | "withdrawn"
  | "expired"
  | null;

export interface ApplicationCandidate {
  id: string;
  name: string;
  initials: string;
  exactScore: number | null;
  location: string;
  jobTitle: string;
  unlocked: boolean;
}

export interface EmployerApplication {
  resume?: RevealedCandidateResponse["resume"];
  id: string;
  jobId: string;
  jobLocation: string | null;
  candidate: ApplicationCandidate;

  stage: ApplicationStage;

  outcome: ApplicationOutcome;

  appliedDate: string;

  meetingLink: string;

  hireEmployerConfirmed?: boolean;
  hireCandidateConfirmed?: boolean;
}

export interface ApplicationColumnDefinition {
  id: string;
  label: string;

  stage: ApplicationStage;

  outcome?: ApplicationOutcome;

  emptyMessage: string;
}
