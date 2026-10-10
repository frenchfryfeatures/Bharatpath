/*
 * Employer KYB domain types.
 *
 * The form is data-driven: the backend publishes the field list and the client
 * renders it. Field keys stay snake_case because the `sections` array is passed
 * through untouched from the API (it is a published definition, not a mapped
 * domain object). See `docs/kyb-frontend-integration.md`.
 */

export type KybState =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "MORE_INFO_REQUIRED";

export type KybFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "SELECT"
  | "MULTISELECT"
  | "DATE"
  | "FILE"
  | "CHECKBOX";

export interface KybField {
  code: string;
  key: string;
  label: string;
  type: KybFieldType;
  required: boolean;
  pattern: string | null;
  max_length: number | null;
  help_text: string | null;
  options_source: string | null;
  public: boolean;
  verification_note: string | null;
}

export interface KybSection {
  code: string;
  title: string;
  fields: KybField[];
  help_text: string | null;
}

export interface KybOption {
  code: string;
  label: string;
}

export interface KybForm {
  code: string;
  version: string;
  sections: KybSection[];
  options: Record<string, KybOption[]>;
}

export interface KybDocument {
  docType: string;
  mime: string | null;
  uploadedAt: string;
  /** Short-lived (15 min) link to the uploaded file. Never cache it. */
  url: string | null;
}

/** A form field or document (`doc_*`) a reviewer asked to be corrected. */
export interface KybReviewFlag {
  field: string;
  note: string | null;
}

/** One earlier decision on a submission. Reviewer names are never sent. */
export interface KybReviewEntry {
  decision: string;
  reason: string | null;
  flags: KybReviewFlag[];
  reviewedAt: string;
}

export interface KybChangedSinceReview {
  fields: string[];
  documents: string[];
}

/*
 * The four document types the KYB form accepts. Only `doc_pan` is mandatory.
 */
export type KybDocType =
  | "doc_pan"
  | "doc_registration"
  | "doc_gst"
  | "doc_authorisation";

export interface KybSubmission {
  submissionId: string | null;
  state: KybState;
  formVersion: string | null;
  answers: Record<string, unknown>;
  documents: KybDocument[];
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  autoApproved: boolean;
  /** Fields and documents to fix; empty once the submission is resubmitted. */
  reviewFlags: KybReviewFlag[];
  /** Past decisions, oldest first. */
  reviews: KybReviewEntry[];
  changedSinceLastReview: KybChangedSinceReview | null;
  /** Set when this draft was started after a rejection. */
  previousSubmissionId: string | null;
}

export interface KybDocumentTicket {
  uploadId: string;
  docType: string;
  url: string;
  method: "PUT";
  expiresInSeconds: number;
  maxBytes: number;
  acceptedTypes: string[];
}
