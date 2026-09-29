"use client";

import { useState } from "react";

import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  useCompleteEmployerKybDocumentMutation,
  useCreateEmployerKybDocumentTicketMutation,
  useUploadEmployerKybDocumentMutation,
  type KybDocType,
  type KybSubmission,
} from "@/store/employer/kyb";

import {
  documentRejectionMessage,
  formatBytes,
  problemCode,
  problemParam,
} from "../kyb-form";

export type UploadPhase = "preparing" | "uploading" | "verifying";

export interface UploadProgress {
  phase: UploadPhase;
  fileName: string;
}

/* Published by the backend in each ticket; used only to refuse an obviously
   wrong file before asking for one. The ticket's own values win. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

function precheck(
  file: File,
  maxBytes: number,
  acceptedTypes: string[],
): string | null {
  if (file.size === 0) {
    return documentRejectionMessage("empty");
  }

  if (file.size > maxBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  }

  // The server sniffs the bytes, so an unknown browser type is left to it.
  if (file.type && !acceptedTypes.includes(file.type)) {
    return documentRejectionMessage("unsupported_type");
  }

  return null;
}

/**
 * The three-call KYB document upload: ask for a presigned URL, PUT the raw
 * bytes to S3, then ask the backend to check and attach the stored object.
 */
export function useKybDocumentUpload(
  onUploaded: (submission: KybSubmission) => void,
) {
  const [createTicket] = useCreateEmployerKybDocumentTicketMutation();
  const [uploadToStorage] = useUploadEmployerKybDocumentMutation();
  const [completeUpload] = useCompleteEmployerKybDocumentMutation();

  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setPhase = (docType: string, phase: UploadPhase, fileName: string) =>
    setProgress((current) => ({ ...current, [docType]: { phase, fileName } }));

  const clearPhase = (docType: string) =>
    setProgress((current) => {
      const next = { ...current };
      delete next[docType];
      return next;
    });

  const setError = (docType: string, message: string | null) =>
    setErrors((current) => {
      const next = { ...current };
      if (message) {
        next[docType] = message;
      } else {
        delete next[docType];
      }
      return next;
    });

  async function upload(docType: KybDocType, file: File): Promise<boolean> {
    setError(docType, null);

    const early = precheck(file, DEFAULT_MAX_BYTES, DEFAULT_ACCEPTED_TYPES);
    if (early) {
      setError(docType, early);
      return false;
    }

    setPhase(docType, "preparing", file.name);

    try {
      const ticket = await createTicket(docType).unwrap();

      const refused = precheck(file, ticket.maxBytes, ticket.acceptedTypes);
      if (refused) {
        setError(docType, refused);
        return false;
      }

      setPhase(docType, "uploading", file.name);

      try {
        await uploadToStorage({ ticket, file }).unwrap();
      } catch {
        setError(
          docType,
          "The file could not be uploaded. Check your connection and try again.",
        );
        return false;
      }

      setPhase(docType, "verifying", file.name);

      const submission = await completeUpload({
        uploadId: ticket.uploadId,
        docType,
      }).unwrap();

      onUploaded(submission);
      return true;
    } catch (error) {
      setError(
        docType,
        problemCode(error) === "kyb_document_rejected"
          ? documentRejectionMessage(problemParam(error, "reason"))
          : getApiErrorMessage(error, "The document could not be uploaded."),
      );
      return false;
    } finally {
      clearPhase(docType);
    }
  }

  return {
    upload,
    progress,
    errors,
    isUploading: Object.keys(progress).length > 0,
  };
}

export type KybDocumentUploader = ReturnType<typeof useKybDocumentUpload>;
