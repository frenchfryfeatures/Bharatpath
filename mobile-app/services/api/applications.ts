/**
 * BharatPath - Applications Service
 * Integrates with Backend /api/v1/candidate/applications endpoints.
 *
 * The candidate's own Application Board. Reading, withdrawing and answering a
 * hire are NOT paywalled (R13 - a lapsed subscriber loses access, not their
 * data). Only applying is behind the subscription.
 *
 * The list endpoint is cursor-paginated and `total` is always `null` on the
 * board (the backend never computes it here). To count the candidate's
 * applications for the profile card we walk the pages; the board is not
 * expected to be large for a single candidate.
 */
import { apiRequest, ApiError } from './client';
import {
  ApplicationDetailResponse,
  ApplicationPage,
  ApplicationResponse,
  CandidateApplicationMessage,
} from '@/types/application';

/**
 * List the candidate's own applications, newest first.
 *
 * `limit` caps a page (1–100). Pass a `cursor` from a previous response's
 * `next_cursor` to continue. The backend returns `total: null` here, so
 * callers that need a count must walk the pages themselves.
 */
export async function listMyApplications(opts?: {
  cursor?: string | null;
  limit?: number;
}): Promise<ApplicationPage> {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const endpoint = qs
    ? `/candidate/applications?${qs}`
    : '/candidate/applications';
  return apiRequest<ApplicationPage>(endpoint);
}

/**
 * Count all of the candidate's applications by walking the cursor pages.
 *
 * Used by the profile screen's "Applied" stat card. A candidate's board is
 * small, so this is at most a couple of round trips. Returns 0 on error so
 * the card never shows a spinner forever - the number is a convenience, not
 * a guarantee, and a 402 (lapsed subscription) is a normal "no count" case
 * for reading-derived stats.
 */
export async function countMyApplications(): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  // Hard cap to avoid an unbounded loop if the API misbehaves.
  for (let page = 0; page < 50; page++) {
    const result = await listMyApplications({ cursor, limit: 100 });
    count += result.items.length;
    if (result.total != null) {
      // If the backend provides a total, trust it and stop.
      return result.total;
    }
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return count;
}

/**
 * One of the candidate's applications, with its history timeline.
 *
 * `GET /candidate/applications/{id}`. Not paywalled. Another candidate's
 * application reads as 404, never 403.
 */
export async function getMyApplication(
  applicationId: string,
): Promise<ApplicationDetailResponse> {
  return apiRequest<ApplicationDetailResponse>(
    `/candidate/applications/${applicationId}`,
  );
}

/**
 * Messages the employer sent about this application, oldest first.
 *
 * `GET /candidate/applications/{id}/messages`. Not paywalled.
 */
export async function getApplicationMessages(
  applicationId: string,
): Promise<CandidateApplicationMessage[]> {
  return apiRequest<CandidateApplicationMessage[]>(
    `/candidate/applications/${applicationId}/messages`,
  );
}

/**
 * Withdraw one of the candidate's applications.
 *
 * `POST /candidate/applications/{id}/withdraw`. Allowed at any active stage
 * before the outcome; idempotent (withdrawing twice returns the withdrawn
 * application). 409 `application_invalid_transition` if the application is
 * already HIRED/REJECTED/EXPIRED - the state changed while the screen was
 * open; show "This application has changed" and reload.
 */
export async function withdrawApplication(
  applicationId: string,
): Promise<ApplicationResponse> {
  return apiRequest<ApplicationResponse>(
    `/candidate/applications/${applicationId}/withdraw`,
    { method: 'POST' },
  );
}

/**
 * Confirm a hire the employer proposed. Makes the hire final (→ HIRED).
 *
 * `POST /candidate/applications/{id}/hire/confirm`. Allowed only when
 * `hire_confirmation === 'PENDING'` (or `DISPUTED` - a candidate who disputed
 * by mistake can still confirm). 409 `hire_confirmation_not_pending` if there
 * is nothing to confirm - reload.
 */
export async function confirmHire(
  applicationId: string,
): Promise<ApplicationResponse> {
  return apiRequest<ApplicationResponse>(
    `/candidate/applications/${applicationId}/hire/confirm`,
    { method: 'POST' },
  );
}

/**
 * Dispute a hire the employer proposed. Records the dispute; the hire stays
 * unconfirmed (stays at DECISION with `hire_confirmation = DISPUTED`).
 *
 * `POST /candidate/applications/{id}/hire/dispute`. Allowed only when
 * `hire_confirmation === 'PENDING'`. 409 `hire_confirmation_not_pending` if
 * the state changed - reload.
 */
export async function disputeHire(
  applicationId: string,
): Promise<ApplicationResponse> {
  return apiRequest<ApplicationResponse>(
    `/candidate/applications/${applicationId}/hire/dispute`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Did an action fail because the application's state changed while the screen
 * was open? (409 `application_invalid_transition` on withdraw, or
 * `hire_confirmation_not_pending` on confirm/dispute.)
 *
 * Per screen-flows §2.10: show "This application has changed" and reload.
 */
export function isApplicationChangedError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    err.code === 'application_invalid_transition' ||
    err.code === 'hire_confirmation_not_pending'
  );
}

/** Human message for an application action error, or null if not actionable. */
export function applicationActionErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (isApplicationChangedError(err)) {
    return 'This application has changed. Refreshing…';
  }
  return err.problem.title || err.code;
}
