import { baseApi } from "@/store/api/base-api";

import type {
  KybDocType,
  KybDocumentTicket,
  KybForm,
  KybSubmission,
} from "./types";

/* =========================================================
   Wire shapes (snake_case, straight off the backend)
========================================================= */

interface KybFormResponse {
  code: string;
  version: string;
  sections: KybForm["sections"];
  options: KybForm["options"];
}

interface KybDocumentResponse {
  doc_type: string;
  mime: string | null;
  uploaded_at: string;
}

interface KybSubmissionResponse {
  submission_id: string | null;
  state: KybSubmission["state"];
  form_version: string | null;
  answers: Record<string, unknown>;
  documents: KybDocumentResponse[];
  submitted_at: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  auto_approved: boolean;
}

interface KybDocumentTicketResponse {
  upload_id: string;
  doc_type: string;
  url: string;
  method: "PUT";
  expires_in_seconds: number;
  max_bytes: number;
  accepted_types: string[];
}

/* =========================================================
   Mappers
========================================================= */

function mapKybForm(response: KybFormResponse): KybForm {
  return {
    code: response.code,
    version: response.version,
    sections: response.sections,
    options: response.options,
  };
}

function mapKybSubmission(response: KybSubmissionResponse): KybSubmission {
  return {
    submissionId: response.submission_id,
    state: response.state,
    formVersion: response.form_version,
    answers: response.answers ?? {},
    documents: (response.documents ?? []).map((document) => ({
      docType: document.doc_type,
      mime: document.mime,
      uploadedAt: document.uploaded_at,
    })),
    submittedAt: response.submitted_at,
    reviewedAt: response.reviewed_at,
    decisionReason: response.decision_reason,
    autoApproved: response.auto_approved,
  };
}

function mapKybDocumentTicket(
  response: KybDocumentTicketResponse,
): KybDocumentTicket {
  return {
    uploadId: response.upload_id,
    docType: response.doc_type,
    url: response.url,
    method: response.method,
    expiresInSeconds: response.expires_in_seconds,
    maxBytes: response.max_bytes,
    acceptedTypes: response.accepted_types,
  };
}

/* =========================================================
   Endpoints — all under /employer/kyb, owner only.
   See docs/kyb-frontend-integration.md.
========================================================= */

export const employerKybApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmployerKybForm: builder.query<KybForm, void>({
      query: () => ({ url: "/employer/kyb/form", method: "GET" }),
      transformResponse: mapKybForm,
      providesTags: [{ type: "Kyb", id: "FORM" }],
    }),

    getEmployerKyb: builder.query<KybSubmission, void>({
      query: () => ({ url: "/employer/kyb", method: "GET" }),
      transformResponse: mapKybSubmission,
      providesTags: [{ type: "Kyb", id: "SUBMISSION" }],
    }),

    saveEmployerKybAnswers: builder.mutation<
      KybSubmission,
      { answers: Record<string, unknown>; __suppressSuccessFeedback?: boolean }
    >({
      query: ({ answers }) => ({
        url: "/employer/kyb/answers",
        method: "PUT",
        body: { answers },
      }),
      transformResponse: mapKybSubmission,
      invalidatesTags: [{ type: "Kyb", id: "SUBMISSION" }],
    }),

    createEmployerKybDocumentTicket: builder.mutation<
      KybDocumentTicket,
      KybDocType
    >({
      query: (docType) => ({
        url: "/employer/kyb/documents",
        method: "POST",
        body: { doc_type: docType },
      }),
      transformResponse: mapKybDocumentTicket,
    }),

    /*
     * PUTs the raw file bytes straight to the presigned S3 URL. This is a
     * plain fetch, NOT through the API base query, because S3 must never
     * receive our Authorization header and the body is raw bytes, not JSON.
     */
    uploadEmployerKybDocument: builder.mutation<
      null,
      { ticket: KybDocumentTicket; file: File }
    >({
      queryFn: async ({ ticket, file }) => {
        try {
          const response = await fetch(ticket.url, {
            method: ticket.method,
            body: file,
            headers: file.type ? { "Content-Type": file.type } : undefined,
          });

          if (!response.ok) {
            return {
              error: {
                status: response.status,
                data: await response.text(),
              },
            };
          }

          return { data: null };
        } catch (error) {
          return {
            error: {
              status: "FETCH_ERROR" as const,
              error: String(error),
            },
          };
        }
      },
    }),

    completeEmployerKybDocument: builder.mutation<
      KybSubmission,
      { uploadId: string; docType: KybDocType }
    >({
      query: ({ uploadId, docType }) => ({
        url: `/employer/kyb/documents/${uploadId}/complete`,
        method: "POST",
        body: { doc_type: docType },
      }),
      transformResponse: mapKybSubmission,
      invalidatesTags: [{ type: "Kyb", id: "SUBMISSION" }],
    }),

    submitEmployerKyb: builder.mutation<KybSubmission, void>({
      query: () => ({ url: "/employer/kyb/submit", method: "POST" }),
      transformResponse: mapKybSubmission,
      invalidatesTags: [
        { type: "Kyb", id: "SUBMISSION" },
        { type: "Team", id: "ORGANISATION" },
        { type: "Job", id: "LIST" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetEmployerKybFormQuery,
  useGetEmployerKybQuery,
  useSaveEmployerKybAnswersMutation,
  useCreateEmployerKybDocumentTicketMutation,
  useUploadEmployerKybDocumentMutation,
  useCompleteEmployerKybDocumentMutation,
  useSubmitEmployerKybMutation,
} = employerKybApi;
