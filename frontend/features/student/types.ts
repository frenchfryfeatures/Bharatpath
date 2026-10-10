import type { CandidateJobDetails } from "@/features/jobs/job-details";

export type ScoreStatus = "READY" | "PENDING";

export interface StudentScore {
  status: ScoreStatus;
  value: number | null;
  band: string | null;
  computedAt: string | null;
}

/** One band of the score scale, exactly as `GET /candidate/score/scale` returns it. */
export interface ScoreBandRange {
  band: string;
  lowest: number;
  highest: number;
}

/** The score scale. The frontend holds no score numbers of its own. */
export interface ScoreScale {
  lowest: number;
  highest: number;
  bands: ScoreBandRange[];
}

export interface StudentProfile {
  fullName: string | null;
  city: string | null;
  stateCode: string | null;
  updatedAt: string | null;
}

/**
 * One organisation that opened this profile (`GET /candidate/profile/views`).
 * The organisation, never the recruiter in it, and no count of opens -
 * the API holds the field list to those two values, so neither belongs here.
 */
export interface ProfileView {
  employerName: string;
  employerLogoUrl?: string | null;
  lastViewedAt: string;
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
  createdAt: string | null;
}

export interface StudentStreakCheckIn {
  counted: boolean;
  streak: StudentStreak;
  changes: StreakPointsChange[];
}

/**
 * `GET /candidate/streak/me/calendar`: which days the app was opened. Opened
 * or not - the API never returns a count of opens per day, so neither does
 * this.
 */
export type StreakCalendarDayStatus =
  | "ACTIVE"
  | "MISSED"
  | "TODAY_PENDING"
  | "UPCOMING"
  | "BEFORE_START"
  | "NOT_RETAINED";

export interface StreakCalendarDay {
  date: string;
  status: StreakCalendarDayStatus;
  milestoneDays: number | null;
}

export interface StreakCalendar {
  start: string;
  end: string;
  today: string;
  days: StreakCalendarDay[];
  activeDays: number;
  missedDays: number;
  longestRun: number;
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
  /** Presigned and expiring; null without a logo. Never cache it. */
  employerLogoUrl?: string | null;
  description?: string;
  /** The full posting. Only the single-job endpoint sends it. */
  details?: CandidateJobDetails;
  skills: string[];
  location: string | null;
  workMode: JobWorkMode;
  experienceMinMonths: number | null;
  salaryMinMinor: number;
  salaryMaxMinor: number;
  /** False when the employer hides the range; draw "Not disclosed". */
  salaryDisclosed: boolean;
  /**
   * True only when the backend sent this candidate the employer's own link or
   * email. It withholds both from anyone the apply button would refuse.
   */
  canApplyExternally: boolean;
  publishedAt: string;
  eligibility: JobEligibility;
}

export interface RecommendedJob extends JobListing {
  matchedSkills: string[];
}

export interface RecommendedJobs {
  items: RecommendedJob[];
  hasBasis: boolean;
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
  employerLogoUrl?: string | null;
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
  locked: boolean;
  lessonsTotal: number;
  lessonsCompleted: number;
  percentComplete: number;
}

export interface CollegeLink {
  collegeId: string;
  collegeName: string | null;
  collegeLogoUrl?: string | null;
  scope: "ROSTER" | "INDIVIDUAL";
  grantedVia: "REFERRAL_CODE" | "INVITE" | "DIRECT";
  grantedAt: string;
  revokedAt: string | null;
  seatHeld: boolean;
}
