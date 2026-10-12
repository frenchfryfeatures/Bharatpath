"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";

import type {
  KybDocType,
  KybDocument,
  KybReviewFlag,
  KybSection,
} from "@/store/employer/kyb";

import type { KybFieldErrors } from "../kyb-form";
import type {
  KybDocumentUploader,
  UploadProgress,
} from "../hooks/use-kyb-document-upload";
import { FieldError, FlagNote, renderFieldLabel } from "./kyb-field";

const PHASE_LABEL: Record<UploadProgress["phase"], string> = {
  preparing: "Preparing upload…",
  uploading: "Uploading…",
  verifying: "Checking the file…",
};

const MIME_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
};

interface KybDocumentsProps {
  section: KybSection;
  documents: Map<string, KybDocument>;
  errors: KybFieldErrors;
  /** Documents the reviewer asked to be re-uploaded and that are not yet replaced. */
  flags?: ReadonlyMap<string, KybReviewFlag>;
  disabled?: boolean;
  uploader: KybDocumentUploader;
  /** Opens a freshly fetched link to an uploaded file. */
  onView?: (docType: string) => Promise<boolean>;
}

export function KybDocuments({
  section,
  documents,
  errors,
  flags,
  disabled,
  uploader,
  onView,
}: Readonly<KybDocumentsProps>) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-[#687386]">
        PDF, JPEG or PNG, up to 10 MB each. The file type is checked from its
        contents, not its name.
      </p>

      {section.fields.map((field) => (
        <DocumentRow
          key={field.code}
          docType={field.code as KybDocType}
          label={field.label}
          helpText={field.help_text}
          required={field.required}
          document={documents.get(field.code)}
          flag={flags?.get(field.code)}
          onView={onView ? () => onView(field.code) : undefined}
          progress={uploader.progress[field.code]}
          error={uploader.errors[field.code] ?? errors[field.code]}
          disabled={disabled}
          onSelect={(file) => void uploader.upload(field.code as KybDocType, file)}
        />
      ))}
    </div>
  );
}

interface DocumentRowProps {
  docType: KybDocType;
  label: string;
  helpText: string | null;
  required: boolean;
  document?: KybDocument;
  flag?: KybReviewFlag;
  onView?: () => Promise<boolean>;
  progress?: UploadProgress;
  error?: string;
  disabled?: boolean;
  onSelect: (file: File) => void;
}

function DocumentRow({
  docType,
  label,
  helpText,
  required,
  document,
  flag,
  onView,
  progress,
  error,
  disabled,
  onSelect,
}: Readonly<DocumentRowProps>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState(false);
  const [viewFailed, setViewFailed] = useState(false);
  const busy = Boolean(progress);
  const inputId = `kyb-${docType}`;

  const uploadedAt = document
    ? new Date(document.uploadedAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div
      id={`kyb-field-${docType}`}
      className={`rounded-xl border p-4 transition ${
        error
          ? "border-[#f0c8cc] bg-[#fffafa]"
          : flag
            ? "border-[#f2cf93] bg-[#fffaf0]"
            : document
            ? "border-[#cfe7df] bg-[#f6fbf9]"
            : "border-[#dfe2e8] bg-white"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              flag
              ? "bg-[#fdebc8] text-[#9a5b00]"
              : document
                ? "bg-[#dff1ea] text-[#1f7a63]"
                : "bg-[#f1f4f9] text-[#5d6673]"
            }`}
          >
            {flag ? (
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            ) : document ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <FileText className="h-5 w-5" aria-hidden="true" />
            )}
          </span>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#17233a]">
              {renderFieldLabel(label, required, { showOptional: true })}
            </p>

            {progress ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#3566b8]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {PHASE_LABEL[progress.phase]}{" "}
                <span className="truncate text-[#687386]">{progress.fileName}</span>
              </p>
            ) : document ? (
              <p className={`mt-0.5 text-xs ${flag ? "text-[#687386]" : "text-[#1f7a63]"}`}>
                Uploaded
                {document.mime ? ` · ${MIME_LABEL[document.mime] ?? document.mime}` : ""}
                {uploadedAt ? ` · ${uploadedAt}` : ""}
              </p>
            ) : helpText ? (
              <p className="mt-0.5 text-xs text-[#7b8493]">{helpText}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {document && onView && (
            <button
              type="button"
              disabled={viewing}
              onClick={async () => {
                setViewing(true);
                setViewFailed(false);
                const opened = await onView();
                setViewFailed(!opened);
                setViewing(false);
              }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[#3566b8] transition hover:bg-[#f3f7fd] disabled:cursor-wait disabled:opacity-60"
              aria-label={`View uploaded ${label}`}
            >
              {viewing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              View
            </button>
          )}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            className="sr-only"
            disabled={disabled || busy}
            aria-label={`Upload ${label}`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file again still fires a change.
              event.target.value = "";
              if (file) {
                onSelect(file);
              }
            }}
          />
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              document && !flag
                ? "border-[#dfe2e8] bg-white text-[#4f5666] hover:bg-[#f8f9fb]"
                : "border-[#3566b8] bg-[#3566b8] text-white hover:bg-[#2c579f]"
            }`}
          >
            {document ? (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {flag ? "Re-upload" : document ? "Replace" : "Choose file"}
          </button>
        </div>
      </div>

      {flag && <FlagNote note={flag.note ? `${flag.note.replace(/[.\s]+$/, "")}. Upload a new file.` : "Upload a new file."} />}
      {viewFailed && (
        <p className="mt-2 text-xs font-medium text-[#b42318]">
          We could not open that file. Try again.
        </p>
      )}
      <FieldError id={`${inputId}-error`} message={error} />
    </div>
  );
}
