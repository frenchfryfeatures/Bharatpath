import { baseApi } from "@/store/api/base-api";
import type { RevealedCandidateResponse } from "@/store/employer/candidates/candidates.api";

export type EmployerApplicationStage =
  | "SUBMITTED"
  | "VIEWED"
  | "SHORTLISTED"
  | "INTERVIEW"
  | "DECISION"
  | "HIRED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED";

export interface EmployerApplicationApiModel {
  id: string;
  jobId: string;
  jobLocation: string | null;
  candidateId: string;
  stage: 0 | 1 | 2 | 3 | 4;
  outcome: "hired" | "rejected" | "withdrawn" | "expired" | null;
  appliedDate: string;
  meetingLink: string;
  hireEmployerConfirmed: boolean;
  hireCandidateConfirmed: boolean;
  resume?: RevealedCandidateResponse["resume"];
  candidate: {
    id: string;
    name: string;
    initials: string;
    exactScore: number | null;
    location: string;
    jobTitle: string;
    unlocked: boolean;
  };
}

interface EmployerApplicationResponse {
  candidate?: {
    full_name: string | null;
    city: string | null;
    state_code: string | null;
    score?: number;
    resume?: RevealedCandidateResponse["resume"];
  } | null;
  id: string;
  job_id: string;
  candidate_id: string;
  stage: EmployerApplicationStage;
  hire_confirmation: "NONE" | "PENDING" | "DISPUTED" | "CONFIRMED";
  interview: {
    interview_at: string;
    meeting_url: string;
  } | null;
  created_at: string;
  updated_at: string;
}

interface EmployerApplicationListItemResponse
  extends EmployerApplicationResponse {
  job_title: string | null;
  job_location: string | null;
}

interface EmployerApplicationDetailResponse extends EmployerApplicationResponse {
  history: unknown[];
}

interface EmployerApplicationPage {
  items: EmployerApplicationListItemResponse[];
  next_cursor: string | null;
}

const STAGE_TO_NUMBER: Record<EmployerApplicationStage, 0 | 1 | 2 | 3 | 4> = {
  SUBMITTED: 0,
  VIEWED: 1,
  SHORTLISTED: 2,
  INTERVIEW: 3,
  DECISION: 4,
  HIRED: 4,
  REJECTED: 4,
  WITHDRAWN: 4,
  EXPIRED: 4,
};

export function mapEmployerApplication(
  application: EmployerApplicationResponse,
  jobTitle = "Employer application",
  jobLocation: string | null = null,
): EmployerApplicationApiModel {
  const outcome =
    application.stage === "HIRED"
      ? "hired"
      : application.stage === "REJECTED"
        ? "rejected"
        : application.stage === "WITHDRAWN"
          ? "withdrawn"
          : application.stage === "EXPIRED"
            ? "expired"
        : null;
  const maskedCandidateId = application.candidate_id.slice(0, 8);

  return {
    id: application.id,
    jobId: application.job_id,
    jobLocation,
    candidateId: application.candidate_id,
    resume: application.candidate?.resume,
    stage: STAGE_TO_NUMBER[application.stage],
    outcome,
    appliedDate: new Date(application.created_at).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    meetingLink: application.interview?.meeting_url ?? "",
    hireEmployerConfirmed:
      application.stage === "HIRED" ||
      application.hire_confirmation === "PENDING" ||
      application.hire_confirmation === "CONFIRMED",
    hireCandidateConfirmed: application.hire_confirmation === "CONFIRMED",
    candidate: {
      id: application.candidate_id,
      name: application.candidate?.full_name ?? `Candidate ${maskedCandidateId}`,
      initials: application.candidate?.full_name?.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "MC",
      exactScore: application.candidate?.score ?? null,
      location: [application.candidate?.city, application.candidate?.state_code].filter(Boolean).join(" · ") || "Location not shared",
      jobTitle,
      unlocked: application.candidate?.score !== undefined,
    },
  };
}

export const employerApplicationsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmployerMessages: builder.query<Array<{ id: string; kind: string; body: string; scheduled_at: string | null; link: string | null; created_at: string }>, string>({ query: (id) => `/employer/applications/${id}/messages`, providesTags: (_r, _e, id) => [{ type: "Application", id: `MESSAGES_${id}` }] }),
    sendEmployerMessage: builder.mutation<unknown, { applicationId: string; kind: "INTERVIEW" | "ASSESSMENT" | "GENERAL"; body: string; scheduled_at?: string; link?: string }>({
      query: ({ applicationId, ...body }) => ({ url: `/employer/applications/${applicationId}/messages`, method: "POST", body }),
      invalidatesTags: (_r, _e, { applicationId }) => [{ type: "Application", id: `MESSAGES_${applicationId}` }],
    }),
    getEmployerApplications: builder.query<
      { items: EmployerApplicationApiModel[]; nextCursor: string | null },
      {
        stage?: EmployerApplicationStage;
        cursor?: string;
        limit?: number;
      }
    >({
      query: ({ stage, cursor, limit }) => ({
        url: "/employer/applications",
        method: "GET",
        params: {
          stage,
          cursor,
          limit,
        },
      }),
      transformResponse: (
        response: EmployerApplicationPage,
      ) => ({
        items: response.items.map((application) =>
          mapEmployerApplication(
            application,
            application.job_title ?? "Employer application",
            application.job_location,
          ),
        ),
        nextCursor: response.next_cursor,
      }),
      providesTags: [{ type: "Application", id: "EMPLOYER_LIST" }],
    }),

    getEmployerApplication: builder.query<
      EmployerApplicationApiModel,
      string
    >({
      query: (applicationId) => ({
        url: `/employer/applications/${applicationId}`,
        method: "GET",
      }),
      transformResponse: (response: EmployerApplicationDetailResponse) =>
        mapEmployerApplication(response),
      providesTags: (_result, _error, applicationId) => [
        { type: "Application", id: applicationId },
      ],
    }),

    moveEmployerApplication: builder.mutation<
      EmployerApplicationApiModel,
      { applicationId: string; stage: "VIEWED" | "SHORTLISTED" | "INTERVIEW" | "DECISION" | "REJECTED" }
    >({
      query: ({ applicationId, stage }) => ({
        url: `/employer/applications/${applicationId}/stage`,
        method: "POST",
        body: { stage },
      }),
      transformResponse: (response: EmployerApplicationDetailResponse) =>
        mapEmployerApplication(response),
      invalidatesTags: [{ type: "Application", id: "EMPLOYER_LIST" }],
    }),

    proposeEmployerHire: builder.mutation<
      EmployerApplicationApiModel,
      string
    >({
      query: (applicationId) => ({
        url: `/employer/applications/${applicationId}/hire`,
        method: "POST",
      }),
      transformResponse: (response: EmployerApplicationDetailResponse) =>
        mapEmployerApplication(response),
      invalidatesTags: [{ type: "Application", id: "EMPLOYER_LIST" }],
    }),
    scheduleEmployerInterview: builder.mutation<
      EmployerApplicationApiModel,
      { applicationId: string; interviewAt: string; meetingUrl: string }
    >({
      query: ({ applicationId, interviewAt, meetingUrl }) => ({
        url: `/employer/applications/${applicationId}/interview`,
        method: "PUT",
        body: { interview_at: interviewAt, meeting_url: meetingUrl },
      }),
      transformResponse: (response: EmployerApplicationDetailResponse) => mapEmployerApplication(response),
      invalidatesTags: (_result, _error, { applicationId }) => [
        { type: "Application", id: applicationId },
        { type: "Application", id: "EMPLOYER_LIST" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetEmployerMessagesQuery,
  useSendEmployerMessageMutation,
  useGetEmployerApplicationsQuery,
  useLazyGetEmployerApplicationsQuery,
  useGetEmployerApplicationQuery,
  useLazyGetEmployerApplicationQuery,
  useMoveEmployerApplicationMutation,
  useProposeEmployerHireMutation,
  useScheduleEmployerInterviewMutation,
} = employerApplicationsApi;
