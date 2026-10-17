import { Platform } from 'react-native';
import {
  FileSystemUploadType,
  uploadAsync,
} from 'expo-file-system/legacy';
import { apiRequest, ApiError, getBaseUrl } from './client';

export type InterviewSessionState =
  | 'CREATED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'EVALUATED'
  | 'ABANDONED'
  | 'FAILED';

export type InterviewUploadState = 'PENDING' | 'UPLOADING' | 'STORED' | 'FAILED';

export interface InterviewOffer {
  on_sale: boolean;
  price_minor: number | null;
  currency: string;
  will_increase_score: boolean;
  requires_acknowledgement: boolean;
  device_check_passed: boolean;
  device_check_valid_until: string | null;
  sessions_available: number;
  open_session_id: string | null;
}

export interface DeviceCheckReadings {
  mic_ok: boolean;
  audio_out_ok: boolean;
  network_kbps: number | null;
  storage_mb: number | null;
  quiet_env_ok: boolean;
}

export interface DeviceCheckResult {
  id: string;
  passed: boolean;
  failures: string[];
  rule_version: string;
  checked_at: string;
  valid_until: string | null;
}

export interface InterviewQuestion {
  index: number;
  code: string;
  key: string;
  prompt: string;
  preparation_seconds: number;
  answer_seconds: number;
  looking_for: string | null;
}

export interface InterviewAnswer {
  question_index: number;
  upload_state: InterviewUploadState;
  duration_ms: number | null;
  uploaded_at: string | null;
}

export interface InterviewSession {
  id: string;
  session_number: number;
  state: InterviewSessionState;
  question_set_code: string;
  question_set_title: string;
  question_set_version: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  questions_total?: number;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
}

export interface InterviewSessionSummary {
  id: string;
  session_number: number;
  state: InterviewSessionState;
  question_set_code: string;
  created_at: string;
  completed_at: string | null;
}

export interface AnswerUploadTicket {
  url: string;
  method: 'PUT';
  expires_in_seconds: number;
  max_bytes: number;
  max_duration_ms: number;
  accepted_types: string[];
}

export type FeedbackLevel = 'STRONG' | 'DEVELOPING' | 'FOCUS_AREA';

export interface InterviewReport {
  session_id: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  failure_reason: string | null;
  evaluated_at: string | null;
  report_version: string | null;
  dimensions: Array<{
    code: string;
    key: string;
    label: string;
    level: FeedbackLevel;
    what_good_looks_like: string;
  }>;
  strengths: string[];
  focus_areas: string[];
  questions: Array<{
    index: number;
    code: string;
    prompt: string;
    looking_for: string;
    transcript: string;
    spoken: boolean;
    comment: string | null;
  }>;
}

import { CheckoutResponse } from './subscription';

export const getInterviewOffer = () =>
  apiRequest<InterviewOffer>('/candidate/interview/offer');

export const checkoutInterviewSession = (acknowledgeNoScoreIncrease: boolean = false) =>
  apiRequest<CheckoutResponse>('/candidate/interview/checkout', {
    method: 'POST',
    body: { acknowledge_no_score_increase: acknowledgeNoScoreIncrease },
  });

export const recordDeviceCheck = (readings: DeviceCheckReadings) =>
  apiRequest<DeviceCheckResult>('/candidate/interview/device-checks', {
    method: 'POST',
    body: readings,
  });

export const startInterviewSession = () =>
  apiRequest<InterviewSession>('/candidate/interview/sessions', { method: 'POST' });

export const listInterviewSessions = () =>
  apiRequest<InterviewSessionSummary[]>('/candidate/interview/sessions');

export const getInterviewSession = (sessionId: string) =>
  apiRequest<InterviewSession>(`/candidate/interview/sessions/${sessionId}`);

export const issueAnswerUpload = (sessionId: string, questionIndex: number) =>
  apiRequest<AnswerUploadTicket>(
    `/candidate/interview/sessions/${sessionId}/answers/${questionIndex}/upload`,
    { method: 'POST' }
  );

function reachableStorageUrl(url: string): string {
  const backendHost = new URL(getBaseUrl()).hostname;
  if (backendHost === 'localhost' || backendHost === '127.0.0.1') return url;
  return url.replace('localhost', backendHost).replace('127.0.0.1', backendHost);
}

/**
 * Object storage answers a refusal with XML carrying a machine-readable
 * `<Code>`, which is the difference between "retry" and "the bucket is gone".
 */
function storageRefusal(status: number, body: string): Error {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
  if (code === 'NoSuchBucket') {
    return new Error(
      'Audio storage is not set up on this backend (NoSuchBucket). Recreate the buckets and try again.'
    );
  }
  return new Error(
    code
      ? `Audio upload was refused (HTTP ${status} ${code}).`
      : `Audio upload was refused (HTTP ${status}).`
  );
}

export async function putInterviewAudio(
  ticket: AnswerUploadTicket,
  fileUri: string,
  mimeType: string
): Promise<void> {
  const url = reachableStorageUrl(ticket.url);
  if (Platform.OS !== 'web') {
    const result = await uploadAsync(url, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': mimeType },
    });
    if (result.status < 200 || result.status >= 300) {
      throw storageRefusal(result.status, result.body ?? '');
    }
    return;
  }

  const local = await fetch(fileUri);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: await local.blob(),
  });
  if (!response.ok) {
    throw storageRefusal(response.status, await response.text());
  }
}

export const completeInterviewAnswer = (
  sessionId: string,
  questionIndex: number,
  durationMs: number
) =>
  apiRequest<InterviewAnswer & { looking_for: string | null }>(
    `/candidate/interview/sessions/${sessionId}/answers/${questionIndex}/complete`,
    { method: 'POST', body: { duration_ms: durationMs } }
  );

export const getNextInterviewQuestion = (sessionId: string) =>
  apiRequest<InterviewSession>(`/candidate/interview/sessions/${sessionId}/next-question`, {
    method: 'POST',
  });

export interface InterviewQuestionAudio {
  url: string;
  expires_in_seconds: number;
  mime: string;
}

/** The link is a plain presigned mp3 and needs no auth header. */
export const getInterviewQuestionAudio = (sessionId: string, questionIndex: number) =>
  apiRequest<InterviewQuestionAudio>(
    `/candidate/interview/sessions/${sessionId}/questions/${questionIndex}/audio`
  );

export const completeInterviewSession = (sessionId: string) =>
  apiRequest<InterviewSession>(`/candidate/interview/sessions/${sessionId}/complete`, {
    method: 'POST',
  });

export const getInterviewReport = (sessionId: string) =>
  apiRequest<InterviewReport>(`/candidate/interview/sessions/${sessionId}/report`);

const ERROR_MESSAGES: Record<string, string> = {
  interview_device_check_required: 'Run and pass the device check before paying.',
  interview_purchase_required: 'A confirmed interview purchase is required.',
  interview_no_score_increase_unacknowledged:
    'Confirm that this practice session will not increase your score.',
  interview_answer_not_uploaded: 'The audio did not reach storage. Try sending it again.',
  answer_too_small: 'That recording is too short to be an answer. Record it again.',
  answer_too_large: 'That recording is too long to send. Record a shorter answer.',
  answer_not_audio: 'The recording did not arrive as audio. Record it again.',
  answer_duration_out_of_range: 'An answer must be between 1 second and 2 minutes long.',
  interview_answer_already_stored: 'This answer is already safely stored.',
  interview_answers_missing: 'Every answer must finish uploading before the session can end.',
  interview_session_not_completed: 'The report is available after all six answers are stored.',
  network_error: 'Cannot reach BharatPath. Check your connection and try again.',
};

export function interviewErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] || error.problem.title || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
