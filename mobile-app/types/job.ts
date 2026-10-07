/**
 * BharatPath - Job types
 *
 * Mirrors the backend candidate-facing job board contract:
 *   - `BoardJobSummary`  → `GET /candidate/jobs`        (list)
 *   - `BoardJobDetail`   → `GET /candidate/jobs/{id}`  (detail)
 *
 * Money is integer paise (minor units), never a float - columns are named
 * `*_minor`. Convert for display only.
 *
 * `eligibility` is the ONLY signal a candidate gets about whether they can
 * apply. The backend deliberately omits `min_score` from the board response
 * (R11 - the score is never explained, and the threshold/gap must never be
 * shown). Do not add a `min_score` field here.
 */

/** Work mode for a job. `null` means the employer did not specify one. */
export type WorkMode = 'ONSITE' | 'HYBRID' | 'REMOTE';

/**
 * Eligibility of the signed-in candidate for a job, computed server-side
 * against the candidate's stored score.
 *
 * - `ELIGIBLE`        - candidate's score meets the job's `min_score`.
 * - `BELOW_THRESHOLD` - score is below the job's `min_score`. Never show the
 *                       threshold number or the gap (R11).
 * - `SCORE_PENDING`   - the candidate's score is still being calculated.
 *                       `SCORE_PENDING` wins over `ELIGIBLE`/`BELOW_THRESHOLD`.
 */
export type EligibilityStatus =
  | 'ELIGIBLE'
  | 'BELOW_THRESHOLD'
  | 'SCORE_PENDING';

/**
 * A job summary on the candidate board (`BoardJobSummary`).
 *
 * NOTE: there is intentionally NO `min_score` field. The backend does not
 * send the threshold to candidates (R11). `eligibility` is the only signal.
 */
export interface BoardJobSummary {
  id: string;
  title: string;
  /** Resolved employer display name. `null` if the employer has no public name. */
  employer_name: string | null;
  /** Skills the employer asked for. May be empty. */
  skills: string[];
  /** Free-text location. `null` if unspecified. */
  location: string | null;
  /** Work mode. `null` if unspecified. */
  work_mode: WorkMode | null;
  /** Minimum experience required, in months. Show as years. */
  experience_min_months: number | null;
  /** Minimum monthly salary, integer paise. Always present (NOT NULL in DB). */
  salary_min_minor: number;
  /** Maximum monthly salary, integer paise. Always present (NOT NULL in DB). */
  salary_max_minor: number;
  /** False when the employer chose not to show the range (PRD 5.2). */
  salary_disclosed?: boolean;
  /** When the job was published (ISO 8601). */
  published_at: string;
  /** Eligibility of the signed-in candidate for this job. */
  eligibility: EligibilityStatus;
}

export interface CandidateJobBasics {
  job_type?: string;
  employment_type?: string;
  department?: string;
  category?: string;
  industry?: string;
  openings?: number | null;
}

export interface CandidateJobLocation {
  additional_locations?: string[];
  relocation_assistance?: boolean;
}

export interface CandidateJobCompensation {
  experience_max_months?: number | null;
  period?: string;
  salary_type?: string;
  disclosed?: boolean;
  negotiable?: boolean;
}

export interface CandidateJobContent {
  responsibilities?: string[];
  required_qualifications?: string[];
  preferred_qualifications?: string[];
  nice_to_have_skills?: string[];
  benefits?: string[];
}

export interface CandidateSkillExperience {
  skill: string;
  years: number;
}

export interface CandidateJobSkills {
  preferred?: string[];
  tools?: string[];
  primary?: string;
  experience?: CandidateSkillExperience[];
}

export interface CandidateJobEducation {
  minimum?: string;
  ug_qualification?: string;
  ug_specialization?: string;
  pg_qualification?: string;
  pg_specialization?: string;
  certifications?: string[];
}

export interface CandidateJobRequirements {
  languages?: string[];
  notice_period?: string;
  work_authorization?: string;
  relocation?: string;
}

export interface CandidateJobApplication {
  deadline?: string | null;
  method?: 'BHARATPATH' | 'EXTERNAL';
  email?: string;
  external_url?: string;
  resume_required?: boolean;
  cover_letter_required?: boolean;
  portfolio_required?: boolean;
}

export interface CandidateJobDetails {
  basics?: CandidateJobBasics;
  location?: CandidateJobLocation;
  compensation?: CandidateJobCompensation;
  content?: CandidateJobContent;
  skills?: CandidateJobSkills;
  education?: CandidateJobEducation;
  requirements?: CandidateJobRequirements;
  application?: CandidateJobApplication;
}

/**
 * A single job's detail (`BoardJobDetail`). Extends the summary with the
 * full description and projection details.
 */
export interface BoardJobDetail extends BoardJobSummary {
  /** Full job description (20–20,000 chars on the backend). */
  description: string;
  /** Extended details projection when provided by backend. */
  details?: CandidateJobDetails;
  /** True when the candidate can apply externally via company site / email. */
  can_apply_externally?: boolean;
}

/**
 * Cursor-paginated page of jobs (`Page[BoardJobSummary]`).
 *
 * `total` is deliberately `null` on the board - the backend does not compute
 * a total count for candidates. Do not render "Showing X of Y". Use
 * `next_cursor` for infinite scroll.
 */
export interface JobPage {
  items: BoardJobSummary[];
  next_cursor: string | null;
  total: number | null;
}

/**
 * Query parameters for `GET /candidate/jobs`. All optional.
 */
export interface JobBoardQuery {
  /** Words in title or description. ≤ 100 chars. */
  q?: string;
  /** Free-text location filter. ≤ 100 chars. */
  location?: string;
  /** Work mode filter. */
  work_mode?: WorkMode;
  /** A single skill that must match. ≤ 80 chars. */
  skill?: string;
  /** Floor on monthly salary, in paise. */
  min_salary_minor?: number;
  /** When true, only return jobs the candidate is `ELIGIBLE` for. */
  eligible_only?: boolean;
  /** Keyset cursor from a previous page's `next_cursor`. */
  cursor?: string;
  /** Page size, 1–100. Backend default is 50. */
  limit?: number;
}

/**
 * Filters captured in the filters sheet, before mapping to `JobBoardQuery`.
 *
 * `min_salary_minor` is `null` when "no minimum" is selected. `work_mode`
 * is `null` when "any" is selected. These map directly to the query params.
 */
export interface JobFilters {
  eligible_only: boolean;
  location: string;
  work_mode: WorkMode | null;
  min_salary_minor: number | null;
  skill: string;
}

/** The default, empty filter state. */
export const DEFAULT_JOB_FILTERS: JobFilters = {
  eligible_only: false,
  location: '',
  work_mode: null,
  min_salary_minor: null,
  skill: '',
};
