import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

import type {
  KybDocument,
  KybField,
  KybForm,
  KybSection,
  KybState,
  KybSubmission,
} from "@/store/employer/kyb";

/*
 * Pure helpers for the data-driven KYB form. The backend publishes the field
 * list (`GET /employer/kyb/form`); everything here reads that definition
 * rather than hard-coding fields, so a new form version renders unchanged.
 *
 * The rules applied here (required, pattern, max length) are hints the server
 * also publishes. The server is the authority and re-checks every one of
 * them (`app/core/forms.py`); checking them here only saves a round trip.
 */

export type KybAnswers = Record<string, unknown>;
export type KybFieldErrors = Record<string, string>;

export const EDITABLE_KYB_STATES: ReadonlySet<KybState> = new Set([
  "DRAFT",
  "MORE_INFO_REQUIRED",
]);

/** Identifiers printed in capitals on the document they come from. */
const UPPERCASE_FIELDS = new Set(["pan", "gstin", "cin", "tan"]);

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isFileField(field: KybField): boolean {
  return field.type === "FILE";
}

export function isDocumentSection(section: KybSection): boolean {
  return section.fields.length > 0 && section.fields.every(isFileField);
}

export function answerableFields(section: KybSection): KybField[] {
  return section.fields.filter((field) => !isFileField(field));
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** What the input shows while the user types. */
export function inputValue(field: KybField, raw: string): string {
  return UPPERCASE_FIELDS.has(field.code) ? raw.toUpperCase() : raw;
}

/**
 * The value sent to `PUT /answers`. Blank becomes `null`, which clears a
 * stored answer; checkboxes must be a JSON boolean and numbers an integer,
 * or the server answers `wrong_type`.
 */
export function wireValue(field: KybField, value: unknown): unknown {
  if (field.type === "CHECKBOX") {
    return value === true ? true : null;
  }

  if (isBlank(value)) {
    return null;
  }

  if (field.type === "NUMBER") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }

  if (field.type === "MULTISELECT") {
    return Array.isArray(value) ? value : [value];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    // People type these grouped ("+91 98765 43210", "ABCDE 1234F"); the
    // published patterns allow no separators.
    if (field.type === "PHONE") {
      return trimmed.replace(/[\s-]/g, "");
    }

    return UPPERCASE_FIELDS.has(field.code)
      ? trimmed.replace(/\s/g, "").toUpperCase()
      : trimmed;
  }

  return value;
}

export function sectionPayload(
  section: KybSection,
  answers: KybAnswers,
): KybAnswers {
  return Object.fromEntries(
    answerableFields(section).map((field) => [
      field.code,
      wireValue(field, answers[field.code]),
    ]),
  );
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Copy for a field-level problem, from the server's issue code. */
export function issueMessage(field: KybField | undefined, code: string): string {
  const label = field?.label ?? "This field";

  switch (code) {
    case "required":
      if (field?.type === "FILE") return "Upload this document to continue.";
      if (field?.type === "CHECKBOX") return "Please accept this to continue.";
      return `${label} is required.`;
    case "must_be_accepted":
      return "Please accept this to continue.";
    case "invalid_format":
      return formatHint(field);
    case "too_long":
      return field?.max_length
        ? `Use ${field.max_length} characters or fewer.`
        : "This is too long.";
    case "not_an_option":
      return "Choose one of the listed options.";
    case "wrong_type":
      return "This value is not in the expected format.";
    case "not_answerable":
      return "Upload this as a document instead.";
    case "unknown_field":
      return "This field is no longer part of the form. Refresh the page.";
    default:
      return "This value is not valid.";
  }
}

function formatHint(field: KybField | undefined): string {
  switch (field?.code) {
    case "pan":
      return "Enter a 10-character PAN, e.g. ABCDE1234F.";
    case "gstin":
      return "Enter a 15-character GSTIN, e.g. 29ABCDE1234F1Z5.";
    case "cin":
      return "Enter a 21-character CIN or LLPIN, e.g. U72900KA2020PTC123456.";
    case "tan":
      return "Enter a 10-character TAN, e.g. BLRB12345C.";
    case "pincode":
      return "Enter a 6-digit PIN code.";
    default:
      break;
  }

  if (field?.type === "PHONE") {
    return "Enter a 10-digit Indian mobile number, optionally starting +91.";
  }

  if (field?.type === "EMAIL") {
    return "Enter a valid email address.";
  }

  if (field?.type === "DATE") {
    return "Enter a valid date.";
  }

  return "This value is not in the expected format.";
}

/** Client-side check of one answer, mirroring `validate_answers`. */
export function validateField(
  field: KybField,
  value: unknown,
): string | undefined {
  if (isFileField(field)) {
    return undefined;
  }

  if (field.type === "CHECKBOX") {
    return field.required && value !== true
      ? issueMessage(field, "must_be_accepted")
      : undefined;
  }

  if (isBlank(value)) {
    return field.required ? issueMessage(field, "required") : undefined;
  }

  if (field.type === "NUMBER") {
    return Number.isInteger(Number(value))
      ? undefined
      : issueMessage(field, "wrong_type");
  }

  if (field.type === "SELECT" || field.type === "MULTISELECT") {
    return undefined;
  }

  const text = String(wireValue(field, value) ?? "");

  if (field.max_length !== null && text.length > field.max_length) {
    return issueMessage(field, "too_long");
  }

  if (field.type === "EMAIL" && !EMAIL_PATTERN.test(text)) {
    return issueMessage(field, "invalid_format");
  }

  if (field.type === "DATE" && Number.isNaN(Date.parse(text))) {
    return issueMessage(field, "invalid_format");
  }

  if (field.pattern) {
    const pattern = compilePattern(field.pattern);

    if (pattern && !pattern.test(text)) {
      return issueMessage(field, "invalid_format");
    }
  }

  return undefined;
}

export function validateSection(
  section: KybSection,
  answers: KybAnswers,
  uploaded: ReadonlySet<string>,
): KybFieldErrors {
  const errors: KybFieldErrors = {};

  for (const field of section.fields) {
    if (isFileField(field)) {
      if (field.required && !uploaded.has(field.code)) {
        errors[field.code] = issueMessage(field, "required");
      }
      continue;
    }

    const message = validateField(field, answers[field.code]);

    if (message) {
      errors[field.code] = message;
    }
  }

  return errors;
}

export function isSectionComplete(
  section: KybSection,
  answers: KybAnswers,
  uploaded: ReadonlySet<string>,
): boolean {
  return Object.keys(validateSection(section, answers, uploaded)).length === 0;
}

export function allFields(form: KybForm): KybField[] {
  return form.sections.flatMap((section) => section.fields);
}

export function sectionIndexOfField(form: KybForm, code: string): number {
  return form.sections.findIndex((section) =>
    section.fields.some((field) => field.code === code),
  );
}

/**
 * The documents that count toward this submission. A REJECTED submission is
 * terminal and the next save starts a fresh draft with no documents, so its
 * uploads are not carried over.
 */
export function uploadedDocuments(
  submission: KybSubmission | undefined,
): Map<string, KybDocument> {
  const documents = new Map<string, KybDocument>();

  if (!submission || submission.state === "REJECTED") {
    return documents;
  }

  for (const document of submission.documents) {
    documents.set(document.docType, document);
  }

  return documents;
}

export function optionLabel(
  form: KybForm,
  field: KybField,
  value: unknown,
): string {
  const options = field.options_source
    ? (form.options[field.options_source] ?? [])
    : [];
  const values = Array.isArray(value) ? value : [value];

  return values
    .map(
      (item) =>
        options.find((option) => option.code === item)?.label ?? String(item),
    )
    .join(", ");
}

/** A stored answer rendered for the review screen. */
export function displayAnswer(
  form: KybForm,
  field: KybField,
  value: unknown,
): string {
  if (field.type === "CHECKBOX") {
    return value === true ? "Accepted" : "Not accepted";
  }

  if (isBlank(value)) {
    return "-";
  }

  if (field.type === "SELECT" || field.type === "MULTISELECT") {
    return optionLabel(form, field, value);
  }

  return String(value);
}

interface ProblemBody {
  code?: string;
  params?: Record<string, unknown>;
}

function problemOf(error: unknown): ProblemBody | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as FetchBaseQueryError).data === "object" &&
    (error as FetchBaseQueryError).data !== null
  ) {
    return (error as FetchBaseQueryError).data as ProblemBody;
  }

  return null;
}

export function problemCode(error: unknown): string | undefined {
  return problemOf(error)?.code;
}

export function problemParam(error: unknown, name: string): unknown {
  return problemOf(error)?.params?.[name];
}

/**
 * The per-field issues of a `kyb_answers_invalid` refusal, as messages keyed
 * by field code. Every issue comes back at once, so every field is marked.
 */
export function issuesFromError(
  form: KybForm | undefined,
  error: unknown,
): KybFieldErrors {
  if (problemCode(error) !== "kyb_answers_invalid") {
    return {};
  }

  const issues = problemParam(error, "issues");

  if (!Array.isArray(issues)) {
    return {};
  }

  const fields = form ? allFields(form) : [];
  const errors: KybFieldErrors = {};

  for (const issue of issues) {
    if (
      issue &&
      typeof issue === "object" &&
      typeof issue.field === "string" &&
      typeof issue.code === "string"
    ) {
      const field = fields.find((item) => item.code === issue.field);
      errors[issue.field] = issueMessage(field, issue.code);
    }
  }

  return errors;
}

export function documentRejectionMessage(reason: unknown): string {
  switch (reason) {
    case "empty":
      return "That file is empty. Choose a different file.";
    case "too_large":
      return "That file is larger than 10 MB. Choose a smaller file.";
    case "unsupported_type":
      return "Only PDF, JPEG or PNG files are accepted.";
    default:
      return "That file could not be accepted. Choose a different file.";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
