import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

import { ApiError } from "./errors";

/**
 * The backend answers with RFC 9457 problem+json: a stable machine-readable
 * `code` plus params, never a user-facing sentence (see backend
 * `app/core/errors.py`). The client owns the copy, so we map `code` — and, as
 * a fallback, the HTTP status — to a friendly English message here.
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

function messageFromFetchError(
  error: FetchBaseQueryError,
  fallback: string,
): string {
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
 * Turn any thrown/returned error — RTK Query's `FetchBaseQueryError`, a
 * `SerializedError`, the legacy `ApiError`, or an unknown value — into a
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
