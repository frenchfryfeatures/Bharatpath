import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

import { ApiError } from "./errors";

/**
 * The backend answers with RFC 9457 problem+json: a stable machine-readable
 * `code` plus params, never a user-facing sentence (see backend
 * `app/core/errors.py`). The client owns the copy, so we map `code` - and, as
 * a fallback, the HTTP status - to a friendly English message here.
 */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  params?: Record<string, unknown>;
  request_id?: string;
}

const GENERIC_MESSAGE =
  "Something went wrong. Please try again.";

/** Known backend `code`s that benefit from specific copy. */
const CODE_MESSAGES: Record<string, string> = {
  shortlist_not_found:
    "This invitation is no longer available. Check your latest invitations.",
  shortlist_not_pending:
    "This invitation has already been answered or cancelled. Check its latest status.",
  already_applied:
    "This candidate has already applied to this job. You can review their application in Applications.",
  shortlist_job_not_open:
    "This job is no longer open, so the invitation cannot be accepted.",
  application_unavailable:
    "Your profile is currently unavailable for applications. Check your profile visibility before trying again.",
  rate_limited:
    "Too many requests. Please wait a moment and try again.",
  operation_in_progress:
    "An identical request is already being processed.",
  idempotency_key_reuse:
    "This request was already submitted with different details.",
  no_active_membership:
    "Your account is not linked to an organisation yet.",
  subscription_required:
    "An active subscription is required to continue.",
  interview_device_check_required:
    "Complete a passing microphone, audio, network and storage check before checkout.",
  interview_no_score_increase_unacknowledged:
    "Confirm that this interview will not increase your score before continuing.",
  interview_unavailable:
    "Interview sessions are temporarily unavailable. Please try again later.",
  access_window_expired:
    "Your access window has expired. Renew to continue.",
  account_inactive:
    "This account is no longer active.",
  account_contact_in_use:
    "This email is already in use with a different account.",
  kyb_config_invalid:
    "Verification is temporarily unavailable. Please try again later.",
  kyb_answers_invalid:
    "Some details need attention. Check the highlighted fields.",
  kyb_not_editable:
    "Your verification has already been submitted and can no longer be edited.",
  kyb_already_verified:
    "Your organisation is already verified.",
  kyb_document_rejected:
    "That file could not be accepted. Upload a PDF, JPEG or PNG under 10 MB.",
  kyb_upload_not_found:
    "The upload did not finish. Please try uploading the file again.",
  kyb_unknown_document_type:
    "That document type is not recognised. Refresh the page and try again.",
  business_account_required:
    "This needs a business account. Sign up as an employer to continue.",
  pool_role_mismatch:
    "This email belongs to a candidate account. Use a business email instead.",
  identity_already_in_organisation:
    "Your account already belongs to an organisation.",
  identity_account_exists:
    "An account already exists for this email address.",
  admin_account_invalid:
    "Some invitation details are not valid. Please check the form.",
  discount_code_invalid: "This discount code is invalid or is not available for this plan.",
  discount_code_expired: "This discount code has expired.",
  discount_code_exhausted: "This discount code has reached its usage limit.",
  discount_code_already_used: "This discount code has already been used for this account.",
  discount_exceeds_price: "This discount cannot be applied to this plan.",
  discount_code_taken: "That discount code already exists. Choose another code.",
  discount_code_terms_invalid: "Check the discount value and validity dates.",
  discount_code_not_found: "That discount code could not be found.",
  referral_code_invalid: "This college referral code is invalid, expired, revoked, or has reached its usage limit.",
  consent_version_outdated: "The college consent terms changed. Review them and try again.",
  internal_error:
    "Something went wrong on our end. Please try again.",
};

/** Fallback copy keyed on HTTP status when no `code` matches. */
const STATUS_MESSAGES: Record<number, string> = {
  400: "The request could not be processed. Please check your input.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to do that.",
  404: "We could not find what you were looking for.",
  408: "The request timed out. Please try again.",
  409: "That action conflicts with the current state. Please refresh.",
  413: "The file is too large to upload.",
  422: "Some of the details provided are not valid.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on our end. Please try again.",
  502: "The service is temporarily unavailable. Please try again.",
  503: "The service is temporarily unavailable. Please try again.",
  504: "The service took too long to respond. Please try again.",
};

function isFetchBaseQueryError(
  error: unknown,
): error is FetchBaseQueryError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  );
}

function problemFrom(
  data: unknown,
): ProblemDetail | null {
  if (typeof data === "object" && data !== null) {
    return data as ProblemDetail;
  }
  return null;
}

/** Extract the backend problem `code`, if any. */
export function getApiErrorCode(
  error: unknown,
): string | undefined {
  if (error instanceof ApiError) {
    return error.code;
  }

  if (isFetchBaseQueryError(error)) {
    return problemFrom(error.data)?.code;
  }

  return undefined;
}

/** Extract the HTTP status, if the error carries one. */
export function getApiErrorStatus(
  error: unknown,
): number | undefined {
  if (error instanceof ApiError) {
    return error.status;
  }

  if (isFetchBaseQueryError(error) && typeof error.status === "number") {
    return error.status;
  }

  const problem =
    isFetchBaseQueryError(error) && problemFrom(error.data);

  return problem ? problem.status : undefined;
}

/**
 * FastAPI's 422 body: `{"detail": [{"loc": [...], "msg": "..."}]}`. Returns the
 * server's reasons as readable sentences, or an empty list when there are none.
 */
export function getApiValidationMessages(error: unknown): string[] {
  const data = isFetchBaseQueryError(error) ? error.data : undefined;
  const detail = (data as { detail?: unknown } | undefined)?.detail;
  if (!Array.isArray(detail)) return [];
  return detail.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { loc, msg } = item as { loc?: unknown[]; msg?: unknown };
    if (typeof msg !== "string") return [];
    const field = Array.isArray(loc)
      ? loc.filter((part) => typeof part === "string" && part !== "body").pop()
      : undefined;
    const reason = msg.replace(/^Value error, /, "");
    const label = typeof field === "string" ? field.replace(/_/g, " ") : "";
    return [label ? `${label}: ${reason}` : reason];
  });
}

function messageFromFetchError(
  error: FetchBaseQueryError,
  fallback: string,
): string {
  if (error.status === 422) {
    const reasons = getApiValidationMessages(error);
    if (reasons.length) return reasons.slice(0, 2).join(" · ");
  }

  if (typeof error.status === "number") {
    return STATUS_MESSAGES[error.status] ?? fallback;
  }

  if (error.status === "TIMEOUT_ERROR") {
    return "The request timed out. Please try again.";
  }

  if (error.status === "FETCH_ERROR") {
    return "Could not reach the server. Check your connection and try again.";
  }

  return fallback;
}

/**
 * Turn any thrown/returned error - RTK Query's `FetchBaseQueryError`, a
 * `SerializedError`, the legacy `ApiError`, or an unknown value - into a
 * consistent, user-facing message.
 */
export function getApiErrorMessage(
  error: unknown,
  fallback: string = GENERIC_MESSAGE,
): string {
  if (error == null) {
    return fallback;
  }

  const code = getApiErrorCode(error);
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }

  if (isFetchBaseQueryError(error)) {
    return messageFromFetchError(error, fallback);
  }

  const status = getApiErrorStatus(error);
  if (status && STATUS_MESSAGES[status]) {
    return STATUS_MESSAGES[status];
  }

  return fallback;
}
