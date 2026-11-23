/**
 * BharatPath - Jobs Service
 * Integrates with Backend /api/v1/candidate/jobs endpoints.
 *
 * The candidate job board. Both endpoints require CANDIDATE role + an active
 * subscription (R13/R15). A lapsed subscriber gets 402 `subscription_required`.
 *
 * The board is cursor-paginated and `total` is deliberately `null` - the
 * backend does not compute a total count for candidates. Use `next_cursor`
 * for infinite scroll; never render "Showing X of Y".
 *
 * `eligibility` is the only signal a candidate gets about whether they can
 * apply. The backend omits `min_score` from the response (R11 - the score is
 * never explained, and the threshold/gap must never be shown).
 */
import { apiRequest, ApiError } from './client';
import { publishApplicationChange } from '@/services/applicationEvents';
import {
  BoardJobSummary,
  BoardJobDetail,
  JobPage,
  JobBoardQuery,
  WorkMode,
} from '@/types/job';

/** Build the query string for `GET /candidate/jobs`, omitting empty params. */
function buildJobQuery(opts?: JobBoardQuery): string {
  const params = new URLSearchParams();
  if (opts?.q && opts.q.trim()) params.set('q', opts.q.trim());
  if (opts?.location && opts.location.trim())
    params.set('location', opts.location.trim());
  if (opts?.work_mode) params.set('work_mode', opts.work_mode);
  if (opts?.skill && opts.skill.trim()) params.set('skill', opts.skill.trim());
  if (opts?.min_salary_minor != null)
    params.set('min_salary_minor', String(opts.min_salary_minor));
  if (opts?.eligible_only) params.set('eligible_only', 'true');
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return qs ? `/candidate/jobs?${qs}` : '/candidate/jobs';
}

/**
 * Search the candidate job board.
 *
 * Pass a `cursor` from a previous response's `next_cursor` to load the next
 * page. `limit` caps a page (1–100, backend default 50). The response's
 * `total` is `null` - do not render a count.
 */
export async function searchJobs(opts?: JobBoardQuery): Promise<JobPage> {
  const endpoint = buildJobQuery(opts);
  return apiRequest<JobPage>(endpoint);
}

/**
 * Fetch a single published job's detail.
 *
 * Returns `BoardJobDetail` (summary + `description`). 404 for anything not
 * currently on the board (draft, paused, closed all look the same).
 */
export async function getJobDetail(jobId: string): Promise<BoardJobDetail> {
  return apiRequest<BoardJobDetail>(`/candidate/jobs/${jobId}`);
}

/**
 * Skills that live jobs ask for, for the board's skill filter (2026-11-23).
 * Labels only, most asked-for first; every one leads to at least one job.
 */
export async function getBoardSkills(q?: string, limit = 40): Promise<string[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q && q.trim()) params.set('q', q.trim());
  const page = await apiRequest<{ items: string[] }>(`/candidate/jobs/skills?${params.toString()}`);
  return page.items;
}

export type RecommendationKind = 'similar-to-applied' | 'matching-profile';
export interface RecommendedJob extends BoardJobSummary { matched_skills: string[]; match_reasons?: string[] }
export function getRecommendedJobs(kind: RecommendationKind, limit = 12): Promise<{ items: RecommendedJob[]; has_basis: boolean }> {
  return apiRequest(`/candidate/recommended-jobs/${kind}?limit=${limit}`);
}

/**
 * Apply to a job - `POST /candidate/applications { job_id }`.
 *
 * The request body is just `{ job_id}`: no stage, no score, no tenant.
 * Eligibility is re-checked server-side against the stored score.
 *
 * Returns the created `ApplicationResponse`:
 *   - 201 - new application
 *   - 200 - already applied (returns the existing application)
 *
 * Throws `ApiError` for:
 *   - 403 `eligibility_below_threshold` - re-render detail as not eligible
 *   - 409 `score_pending`              - score still calculating
 *   - 409 `application_unavailable`     - job no longer accepting applications
 *   - 404                              - job has closed
 *   - 402 `subscription_required`       - paywall
 */
export async function applyToJob(jobId: string): Promise<{
  id: string;
  job_id: string;
  job_title: string | null;
  employer_name: string | null;
  stage: string;
  hire_confirmation: string;
  interview: { interview_at: string; meeting_url: string } | null;
  created_at: string;
  updated_at: string;
}> {
  const application = await apiRequest<Awaited<ReturnType<typeof applyToJob>>>('/candidate/applications', {
    method: 'POST',
    body: { job_id: jobId },
  });
  // 201 new or 200 already applied: either way every screen now knows.
  publishApplicationChange(application as any);
  return application;
}

// ─── Error helpers ─────────────────────────────────────────────

/**
 * Map an apply-flow `ApiError` to a user-facing message.
 *
 * Follows `docs/screen-flows.md` S18: never show the threshold number or the
 * gap on `eligibility_below_threshold`; show a generic message for
 * `application_unavailable` (also covers an account held back for review).
 */
export function applyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'eligibility_below_threshold':
        return 'Your Bharatpath Score does not meet this employer’s requirement.';
      case 'score_pending':
        return 'Your Bharatpath Score is still being calculated. Try again shortly.';
      case 'application_unavailable':
        return 'This job is no longer accepting applications.';
      case 'subscription_required':
        return 'Membership is required to apply.';
      default:
        if (error.status === 404) return 'This job has closed.';
        if (error.status === 402) return 'Membership is required to apply.';
        return error.problem.title || fallback;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Whether an apply error means the detail screen should re-render as not eligible. */
export function isEligibilityError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.code === 'eligibility_below_threshold'
  );
}

/** Whether an apply error means the job is gone (closed / unavailable). */
export function isJobGoneError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 404 || error.code === 'application_unavailable';
}

// ─── Re-exports for convenience ────────────────────────────────
export type {
  BoardJobSummary,
  BoardJobDetail,
  JobPage,
  JobBoardQuery,
  WorkMode,
};
