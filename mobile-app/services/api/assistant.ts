/**
 * BharatPath - Career Assistant API Service
 * Integrates with Backend /api/v1/candidate/assistant/messages
 * (Documented in docs/backend-guide/17-assistant-apis.md).
 *
 * Provides:
 * - Conversational Q&A on platform and career guidance
 * - Job recommendations (interactive job cards with numbering 1-5)
 * - Automated / In-app job application proposals
 */
import { apiRequest, ApiError } from './client';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantMessageRequest {
  message: string;
  history?: AssistantTurn[];
  state?: string;
}

export interface AssistantReplyJob {
  id: string;
  title: string;
  employer_name?: string | null;
  location?: string | null;
  work_mode?: string | null;
  salary_min_minor?: number | null;
  salary_max_minor?: number | null;
  salary_currency?: string | null;
  min_salary_minor?: number | null;
  max_salary_minor?: number | null;
  eligibility?: 'ELIGIBLE' | 'SCORE_PENDING' | 'BELOW_THRESHOLD' | string | null;
  matched_skills?: string[];
  department?: string | null;
  created_at?: string | null;
}

export interface AssistantReplyApply {
  job_id: string;
  job_title: string;
  employer_name: string | null;
  in_app: boolean;
}

export interface AssistantReplyApplication {
  id: string;
  job_id: string;
  job_title?: string | null;
  employer_name?: string | null;
  stage: string;
  created_at?: string | null;
}

export interface AssistantReply {
  reply: string;
  action:
    | 'SEARCH'
    | 'MATCH_MY_PROFILE'
    | 'SIMILAR_TO_APPLIED'
    | 'MORE_RESULTS'
    | 'SHOW_JOB'
    | 'APPLY'
    | 'MY_APPLICATIONS'
    | 'REPLY';
  jobs: AssistantReplyJob[];
  has_more: boolean;
  job: AssistantReplyJob | null;
  apply: AssistantReplyApply | null;
  applications: AssistantReplyApplication[];
  suggestions: string[];
  state: string;
}

/**
 * Send a message to the BharatPath job-search assistant.
 * Handles state-invalidation gracefully by falling back if state is stale.
 */
export async function sendAssistantMessage(
  payload: AssistantMessageRequest,
): Promise<AssistantReply> {
  try {
    return await apiRequest<AssistantReply>('/candidate/assistant/messages', {
      method: 'POST',
      body: {
        message: payload.message,
        history: payload.history ?? [],
        ...(payload.state ? { state: payload.state } : {}),
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'assistant_state_invalid') {
      // Per doc §5: The state was edited or truncated. Drop state and resend.
      return apiRequest<AssistantReply>('/candidate/assistant/messages', {
        method: 'POST',
        body: {
          message: payload.message,
          history: [],
        },
      });
    }
    throw error;
  }
}
