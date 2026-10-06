import { baseApi } from "@/store/api/base-api";
import type { StructuredResume, StructuredStatus } from "@/components/resume/structured-resume";

/*
 * Candidate resume intake, review and confirm - `/candidate/resume/*`.
 *
 * Every route needs a signed-in candidate (there is no guest upload). The
 * flow is: create a version (upload, paste or form) -> review it -> correct
 * it (which creates a new version) -> confirm. Only a confirmed version is
 * ever scored (SRS 1.4.4).
 */

export type ResumeVersionSource = "UPLOAD" | "PASTE" | "MANUAL" | "EDIT";
export type ResumeParseStatus = "QUEUED" | "DONE" | "FAILED" | "BLOCKED";
export type ResumeSectionKind =
  | "header"
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills"
  | "certifications"
  | "languages"
  | "achievements"
  | "activities"
  | "personal";

export interface ResumeUploadTicket {
  uploadId: string;
  url: string;
  method: "PUT";
  expiresInSeconds: number;
  maxBytes: number;
  acceptedTypes: string[];
}

export interface ResumeUploadAccepted {
  resumeFileId: string;
  scanStatus: string;
  parseStatus: ResumeParseStatus;
}

export interface ResumeFileStatus {
  resumeFileId: string;
  scanStatus: string;
  parseStatus: ResumeParseStatus;
  parseErrorCode: string | null;
  terminal: boolean;
  uploadedAt: string;
  resumeVersionId: string | null;
}

export interface ResumeVersionCreated {
  resumeVersionId: string;
  source: ResumeVersionSource;
  confirmed: boolean;
  createdAt: string;
}

export interface ResumeVersionSummary extends ResumeVersionCreated {
  confirmedAt: string | null;
  supersedesId: string | null;
  superseded: boolean;
}

export interface ResumeSectionItem {
  text: string;
  unclear: boolean;
  suggestion: string | null;
}

export interface ResumeSection {
  kind: ResumeSectionKind;
  heading: string | null;
  body: string;
  items: ResumeSectionItem[] | null;
}

export interface ManualExperience {
  employer: string;
  title: string;
  start_year: number;
  end_year: number | null;
  summary: string | null;
}

export interface ManualEducation {
  institution: string;
  qualification: string;
  completed_year: number | null;
}

/** The structured form, sent as-is (the backend's field names). */
export interface ManualResume {
  full_name: string;
  headline: string | null;
  experience: ManualExperience[];
  education: ManualEducation[];
  skills: string[];
}

export interface ResumeVersionDetail {
  resumeVersionId: string;
  source: ResumeVersionSource;
  parsed: Record<string, unknown>;
  /** Null for a structured (form) version, whose `parsed` holds the fields. */
  sections: ResumeSection[] | null;
  structuredResume: StructuredResume | null;
  structuredStatus: StructuredStatus;
  confirmed: boolean;
  confirmedAt: string | null;
  supersedesId: string | null;
  superseded: boolean;
  createdAt: string;
}

export interface ResumeConfirmed {
  resumeVersionId: string;
  confirmedAt: string;
  alreadyConfirmed: boolean;
}

export type ResumeEdit =
  | { sections: Array<Pick<ResumeSection, "kind" | "heading" | "body">> }
  | { structured: ManualResume }
  | { text: string };

/* Wire shapes ---------------------------------------------------------- */

interface VersionCreatedResponse {
  resume_version_id: string;
  source: ResumeVersionSource;
  confirmed: boolean;
  created_at: string;
}

interface VersionSummaryResponse extends VersionCreatedResponse {
  confirmed_at: string | null;
  supersedes_id: string | null;
  superseded: boolean;
}

interface VersionDetailResponse extends VersionSummaryResponse {
  parsed: Record<string, unknown>;
  sections: ResumeSection[] | null;
  structured_resume: StructuredResume | null;
  structured_status: StructuredStatus;
}

const mapCreated = (response: VersionCreatedResponse): ResumeVersionCreated => ({
  resumeVersionId: response.resume_version_id,
  source: response.source,
  confirmed: response.confirmed,
  createdAt: response.created_at,
});

const mapSummary = (response: VersionSummaryResponse): ResumeVersionSummary => ({
  ...mapCreated(response),
  confirmedAt: response.confirmed_at,
  supersedesId: response.supersedes_id,
  superseded: response.superseded,
});

export const studentResumeApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createResumeUpload: builder.mutation<ResumeUploadTicket, void>({
      query: () => ({ url: "/candidate/resume/uploads", method: "POST" }),
      transformResponse: (response: {
        upload_id: string;
        url: string;
        method: "PUT";
        expires_in_seconds: number;
        max_bytes: number;
        accepted_types: string[];
      }) => ({
        uploadId: response.upload_id,
        url: response.url,
        method: response.method,
        expiresInSeconds: response.expires_in_seconds,
        maxBytes: response.max_bytes,
        acceptedTypes: response.accepted_types,
      }),
    }),

    /*
     * PUTs the raw bytes to the presigned S3 URL. A plain fetch, not the API
     * base query: S3 must never see our Authorization header.
     */
    uploadResumeFile: builder.mutation<
      null,
      { ticket: ResumeUploadTicket; file: File }
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
              error: { status: response.status, data: await response.text() },
            };
          }

          return { data: null };
        } catch (error) {
          return {
            error: { status: "FETCH_ERROR" as const, error: String(error) },
          };
        }
      },
    }),

    completeResumeUpload: builder.mutation<ResumeUploadAccepted, string>({
      query: (uploadId) => ({
        url: `/candidate/resume/uploads/${uploadId}/complete`,
        method: "POST",
      }),
      transformResponse: (response: {
        resume_file_id: string;
        scan_status: string;
        parse_status: ResumeParseStatus;
      }) => ({
        resumeFileId: response.resume_file_id,
        scanStatus: response.scan_status,
        parseStatus: response.parse_status,
      }),
    }),

    getResumeFileStatus: builder.query<ResumeFileStatus, string>({
      query: (resumeFileId) => `/candidate/resume/files/${resumeFileId}`,
      transformResponse: (response: {
        resume_file_id: string;
        scan_status: string;
        parse_status: ResumeParseStatus;
        parse_error_code: string | null;
        terminal: boolean;
        uploaded_at: string;
        resume_version_id: string | null;
      }) => ({
        resumeFileId: response.resume_file_id,
        scanStatus: response.scan_status,
        parseStatus: response.parse_status,
        parseErrorCode: response.parse_error_code,
        terminal: response.terminal,
        uploadedAt: response.uploaded_at,
        resumeVersionId: response.resume_version_id,
      }),
      keepUnusedDataFor: 0,
    }),

    submitResumeText: builder.mutation<ResumeVersionCreated, string>({
      query: (text) => ({
        url: "/candidate/resume/text",
        method: "POST",
        body: { text },
      }),
      transformResponse: mapCreated,
      invalidatesTags: [{ type: "Student", id: "RESUME_VERSIONS" }],
    }),

    submitManualResume: builder.mutation<ResumeVersionCreated, ManualResume>({
      query: (resume) => ({
        url: "/candidate/resume/manual",
        method: "POST",
        body: resume,
      }),
      transformResponse: mapCreated,
      invalidatesTags: [{ type: "Student", id: "RESUME_VERSIONS" }],
    }),

    getResumeVersions: builder.query<ResumeVersionSummary[], void>({
      query: () => "/candidate/resume/versions",
      transformResponse: (response: VersionSummaryResponse[]) =>
        response.map(mapSummary),
      providesTags: [{ type: "Student", id: "RESUME_VERSIONS" }],
    }),

    getResumeVersion: builder.query<ResumeVersionDetail, string>({
      query: (resumeVersionId) =>
        `/candidate/resume/versions/${resumeVersionId}`,
      transformResponse: (response: VersionDetailResponse) => ({
        ...mapSummary(response),
        parsed: response.parsed ?? {},
        sections: response.sections,
        structuredResume: response.structured_resume,
        structuredStatus: response.structured_status,
      }),
      providesTags: (_result, _error, id) => [
        { type: "Student", id: `RESUME_VERSION_${id}` },
      ],
    }),

    editResumeVersion: builder.mutation<
      ResumeVersionCreated,
      {
        resumeVersionId: string;
        edit: ResumeEdit;
        __suppressSuccessFeedback?: boolean;
      }
    >({
      query: ({ resumeVersionId, edit }) => ({
        url: `/candidate/resume/versions/${resumeVersionId}/edit`,
        method: "POST",
        body: edit,
      }),
      transformResponse: mapCreated,
      invalidatesTags: [{ type: "Student", id: "RESUME_VERSIONS" }],
    }),

    confirmResumeVersion: builder.mutation<ResumeConfirmed, string>({
      query: (resumeVersionId) => ({
        url: `/candidate/resume/versions/${resumeVersionId}/confirm`,
        method: "POST",
      }),
      transformResponse: (response: {
        resume_version_id: string;
        confirmed_at: string;
        already_confirmed: boolean;
      }) => ({
        resumeVersionId: response.resume_version_id,
        confirmedAt: response.confirmed_at,
        alreadyConfirmed: response.already_confirmed,
      }),
      invalidatesTags: [
        { type: "Student", id: "RESUME_VERSIONS" },
        { type: "Student", id: "SCORE" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useCreateResumeUploadMutation,
  useUploadResumeFileMutation,
  useCompleteResumeUploadMutation,
  useGetResumeFileStatusQuery,
  useSubmitResumeTextMutation,
  useSubmitManualResumeMutation,
  useGetResumeVersionsQuery,
  useLazyGetResumeVersionsQuery,
  useGetResumeVersionQuery,
  useEditResumeVersionMutation,
  useConfirmResumeVersionMutation,
} = studentResumeApi;
