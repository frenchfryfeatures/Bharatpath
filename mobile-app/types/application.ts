/**
 * BharatPath - Application types
 *
 * Mirrors the backend candidate-facing application contract:
 *   - `ApplicationResponse`        → `GET /candidate/applications`        (list)
 *   - `ApplicationDetailResponse` → `GET /candidate/applications/{id}`   (detail)
 *
 * The candidate's own Application Board. Reading, withdrawing and answering a
 * hire are NOT paywalled (R13 - a lapsed subscriber loses access, not their
 * data). Only applying is behind the subscription.
 *
 * Invariants enforced by the contract:
 *   - No `min_score`, no threshold, no gap (R11 - the score is never explained).
 *   - No employer notes, no recruiter id in the candidate's history. `by` is a
 *     party (`CANDIDATE` | `EMPLOYER` | `SYSTEM`), never "which recruiter".
 *   - `total` is `null` on the board list - counts come from loaded items.
 *   - No location or salary on the application; the job fetch is paywalled and
 *     404s for closed jobs, so the board/detail never show them.
 */

/** The 9 application stages from `applications.domain.STAGES`. */
export type ApplicationStage =
  | 'SUBMITTED'
  | 'VIEWED'
  | 'SHORTLISTED'
  | 'INTERVIEW'
  | 'DECISION'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'EXPIRED';

/** The two-step hire state from `applications.domain.HireState`. */
export type HireConfirmation = 'NONE' | 'PENDING' | 'DISPUTED' | 'CONFIRMED';

/** Who moved an application, as a party - never which recruiter. */
export type ApplicationActor = 'CANDIDATE' | 'EMPLOYER' | 'SYSTEM';

/** Event kinds recorded in `application_events`. */
export type ApplicationEventKind =
  | 'STAGE_CHANGED'
  | 'INTERVIEW_SCHEDULED'
  | 'HIRE_PROPOSED'
  | 'HIRE_DISPUTED';

/** The interview card (SRS 1.13.2). The platform hosts no call; the link is the
 *  employer's own https meeting URL. */
export interface InterviewDetails {
  /** ISO 8601 UTC timestamp. Display in IST. */
  interview_at: string;
  /** Employer's https meeting link. Open externally via `Linking.openURL`. */
  meeting_url: string;
}

/** One of the candidate's own applications, for the board list. */
export interface ApplicationResponse {
  id: string;
  job_id: string;
  job_title: string | null;
  employer_name: string | null;
  stage: ApplicationStage;
  hire_confirmation: HireConfirmation;
  interview: InterviewDetails | null;
  created_at: string;
  updated_at: string;
}

/** One step in the candidate-visible history. */
export interface CandidateHistoryItem {
  kind: ApplicationEventKind;
  from_stage: ApplicationStage | null;
  to_stage: ApplicationStage;
  by: ApplicationActor;
  occurred_at: string;
}

/** One application with its history - the detail view. */
export interface ApplicationDetailResponse extends ApplicationResponse {
  history: CandidateHistoryItem[];
}

/** A message sent by the employer regarding this application. */
export interface CandidateApplicationMessage {
  id: string;
  kind: 'INTERVIEW' | 'ASSESSMENT' | 'GENERAL' | string;
  body: string;
  scheduled_at: string | null;
  link: string | null;
  employer_name: string | null;
  created_at: string;
}

/** A cursor page of applications. `total` is `null` on the board. */
export interface ApplicationPage {
  items: ApplicationResponse[];
  next_cursor: string | null;
  total: number | null;
}

// ---------------------------------------------------------------------------
// Stage helpers - the pipeline, tabs, labels and chip styles.
// ---------------------------------------------------------------------------

/** The open pipeline stages, in order (5 steps). */
export const PIPELINE: readonly ApplicationStage[] = [
  'SUBMITTED',
  'VIEWED',
  'SHORTLISTED',
  'INTERVIEW',
  'DECISION',
] as const;

/** Terminal stages - finished applications. They no longer count against the
 *  one-active-application-per-job rule. */
export const TERMINAL_STAGES: readonly ApplicationStage[] = [
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
] as const;

/** Is the stage active (on the pipeline)? */
export function isActiveStage(stage: ApplicationStage): boolean {
  return (PIPELINE as readonly string[]).includes(stage);
}

/** Is the stage terminal (closed)? */
export function isClosedStage(stage: ApplicationStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

/**
 * The 1-based index of a pipeline stage, for the "Stage N of 5" bar.
 * Returns 0 for terminal stages (no bar rendered for those).
 */
export function pipelineStep(stage: ApplicationStage): number {
  const idx = (PIPELINE as readonly string[]).indexOf(stage);
  return idx >= 0 ? idx + 1 : 0;
}

/** Total pipeline steps (5). */
export const PIPELINE_LENGTH = PIPELINE.length;

/**
 * The candidate-facing label for a stage, per screen-flows §2.10.
 *
 * REJECTED is "Not selected" (not "Rejected") and EXPIRED is "Closed, no
 * response" (not "Expired") - these are deliberate: "not selected" is not a
 * failure, and expiry is the server's housekeeping, not a warning.
 */
export function stageLabel(stage: ApplicationStage): string {
  switch (stage) {
    case 'SUBMITTED':
      return 'Sent';
    case 'VIEWED':
      return 'Viewed by employer';
    case 'SHORTLISTED':
      return 'Shortlisted';
    case 'INTERVIEW':
      return 'Interview';
    case 'DECISION':
      return 'Decision pending';
    case 'HIRED':
      return 'Hired';
    case 'REJECTED':
      return 'Not selected';
    case 'WITHDRAWN':
      return 'Withdrawn';
    case 'EXPIRED':
      return 'Closed, no response';
    default:
      return stage;
  }
}

/** The short status line shown under the "Stage N of 5" bar on an active card. */
export function stageStatusText(stage: ApplicationStage): string {
  switch (stage) {
    case 'SUBMITTED':
      return 'Waiting on employer';
    case 'VIEWED':
      return 'Profile opened by employer';
    case 'SHORTLISTED':
      return 'Shortlisted';
    case 'INTERVIEW':
      return 'Interview scheduled';
    case 'DECISION':
      return 'Decision pending';
    default:
      return stageLabel(stage);
  }
}

/** Chip style bucket for a stage. Only HIRED is coloured (success/green);
 *  every other closed stage is neutral/muted. Active accent stages use indigo. */
export type StageChipStyle = 'neutral' | 'accent' | 'success';

export function stageChipStyle(stage: ApplicationStage): StageChipStyle {
  switch (stage) {
    case 'SHORTLISTED':
    case 'INTERVIEW':
    case 'DECISION':
      return 'accent';
    case 'HIRED':
      return 'success';
    default:
      return 'neutral';
  }
}

/** A human label for a history event, for the detail timeline. */
export function historyEventLabel(item: CandidateHistoryItem): string {
  switch (item.kind) {
    case 'STAGE_CHANGED':
      return stageLabel(item.to_stage);
    case 'INTERVIEW_SCHEDULED':
      return 'Interview scheduled';
    case 'HIRE_PROPOSED':
      return 'Hire proposed';
    case 'HIRE_DISPUTED':
      return 'Hire disputed';
    default:
      return item.kind;
  }
}
