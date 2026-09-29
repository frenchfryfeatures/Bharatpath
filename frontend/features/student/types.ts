export type ScoreStatus = "READY" | "PENDING";

export interface StudentScore {
  status: ScoreStatus;
  value: number | null;
  band: string | null;
  computedAt: string | null;
}

export interface StudentProfile {
  fullName: string | null;
  city: string | null;
  stateCode: string | null;
  updatedAt: string | null;
}

export type StreakStatus =
  | "NONE"
  | "ACTIVE_TODAY"
  | "AT_RISK"
  | "BROKEN";

export interface StreakMilestone {
  days: number;
  points: number;
}

export interface StudentStreak {
  status: StreakStatus;
  currentStreak: number;
  longestStreak: number;
  lastActiveOn: string | null;
  today: string;
  pointsBalance: number;
  nextMilestone: StreakMilestone | null;
  milestones: StreakMilestone[];
  breakPenalty: number;
  rulesVersion: string;
}

export interface StreakPointsChange {
  kind: "STREAK_BREAK_PENALTY" | "MILESTONE_AWARD";
  points: number;
  balanceAfter: number;
  streakLength: number;
  milestoneDays: number | null;
  activityOn: string;
  createdAt: string;
}

export interface StudentStreakCheckIn {
  counted: boolean;
  streak: StudentStreak;
  changes: StreakPointsChange[];
}

export type JobEligibility =
  | "ELIGIBLE"
  | "BELOW_THRESHOLD"
  | "SCORE_PENDING";

export type JobWorkMode =
  | "ONSITE"
  | "HYBRID"
  | "REMOTE"
  | null;

export interface JobListing {
  id: string;
  title: string;
  employerName: string | null;
  description?: string;
  skills: string[];
  location: string | null;
  workMode: JobWorkMode;
  experienceMinMonths: number | null;
  salaryMinMinor: number;
  salaryMaxMinor: number;
  publishedAt: string;
  eligibility: JobEligibility;
}

export type ApplicationStatus =
  | "SUBMITTED"
  | "VIEWED"
  | "SHORTLISTED"
  | "INTERVIEW"
  | "DECISION"
  | "HIRED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED";

export type HireConfirmation =
  | "NONE"
  | "PENDING"
  | "DISPUTED"
  | "CONFIRMED";

export interface InterviewDetails {
  interviewAt: string;
  meetingUrl: string;
}

export interface ApplicationHistoryItem {
  kind:
    | "STAGE_CHANGED"
    | "INTERVIEW_SCHEDULED"
    | "HIRE_PROPOSED"
    | "HIRE_DISPUTED";
  fromStage: ApplicationStatus | null;
  toStage: ApplicationStatus;
  by: "CANDIDATE" | "EMPLOYER" | "SYSTEM";
  occurredAt: string;
}

export interface JobApplication {
  id: string;
  jobId: string;
  jobTitle: string | null;
  employerName: string | null;
  stage: ApplicationStatus;
  hireConfirmation: HireConfirmation;
  interview: InterviewDetails | null;
  createdAt: string;
  updatedAt: string;
  history?: ApplicationHistoryItem[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export type QuestionnaireQuestionType =
  | "SINGLE"
  | "MULTI"
  | "NUMBER"
  | "BOOLEAN"
  | "TEXT";

export interface QuestionnaireOption {
  code: string;
  label: string;
}

export interface QuestionnaireQuestion {
  code: string;
  key: string;
  prompt: string;
  type: QuestionnaireQuestionType;
  options: QuestionnaireOption[];
  required: boolean;
  helpText: string | null;
}

export interface QuestionnaireSection {
  code: string;
  questions: QuestionnaireQuestion[];
}

export interface QuestionnaireView {
  bankVersion: string;
  sections: QuestionnaireSection[];
  answers: Record<string, unknown>;
  submitted: boolean;
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface InterviewOffer {
  onSale: boolean;
  priceMinor: number | null;
  currency: string;
  willIncreaseScore: boolean;
  requiresAcknowledgement: boolean;
  deviceCheckPassed: boolean;
  deviceCheckValidUntil: string | null;
  sessionsAvailable: number;
  openSessionId: string | null;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  priceMinor: number;
  currency: string;
  purchased: boolean;
  completed: boolean;
}

export interface CollegeLink {
  collegeId: string;
  collegeName: string | null;
  scope: "ROSTER" | "INDIVIDUAL";
  grantedVia: "REFERRAL_CODE" | "INVITE" | "DIRECT";
  grantedAt: string;
  revokedAt: string | null;
  seatHeld: boolean;
}
