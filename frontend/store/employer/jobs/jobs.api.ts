import { baseApi } from "@/store/api/base-api";
import type {
  ApiJobStatus,
  EmployerJob,
  EmployerJobApiResponse,
  EmployerJobListItemApiResponse,
  EmployerJobPageApiResponse,
} from "@/features/employer/jobs/types";
import type { CreateJobFormValues } from "@/features/employer/jobs/create";
import { jobBody } from "@/features/employer/jobs/create/job-form-values";

export interface ThresholdPreview {
  min_score: number;
  approximate_count: number;
  fewer_than_ten: boolean;
}

export interface EmployerJobsQuery {
  status?: ApiJobStatus;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface EmployerJobsPage {
  items: EmployerJob[];
  nextCursor: string | null;
}

const API_STATUS_TO_JOB_STATUS: Record<
  ApiJobStatus,
  EmployerJob["status"]
> = {
  DRAFT: "draft",
  PUBLISHED: "live",
  PAUSED: "paused",
  CLOSED: "closed",
};

function mapApiJobToEmployerJob(
  job: EmployerJobListItemApiResponse,
): EmployerJob {
  const stageCounts = job.application_counts.by_stage;

  return {
    id: job.id,
    title: job.title,
    status: API_STATUS_TO_JOB_STATUS[job.status],
    location: job.location ?? "Location not specified",
    salaryMin: job.salary_min_minor / 100,
    salaryMax: job.salary_max_minor / 100,
    minScore: job.min_score,
    skills: job.skills,
    applicantsCount: job.application_counts.total,
    applicantsInPipelineCount:
      stageCounts.SUBMITTED +
      stageCounts.VIEWED +
      stageCounts.SHORTLISTED +
      stageCounts.INTERVIEW +
      stageCounts.DECISION,
    viewedCount: stageCounts.VIEWED,
    shortlistedCount: stageCounts.SHORTLISTED,
    interviewCount: stageCounts.INTERVIEW,
    hiredCount: stageCounts.HIRED,
    rejectedCount: stageCounts.REJECTED,
  };
}

export const employerJobsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmployerJobs: builder.query<
      EmployerJobsPage,
      EmployerJobsQuery | void
    >({
      query: (params) => ({
        url: "/employer/jobs",
        method: "GET",
        params: params
          ? {
              status: params.status,
              q: params.q,
              cursor: params.cursor,
              limit: params.limit,
            }
          : undefined,
      }),

      transformResponse: (
        response: EmployerJobPageApiResponse | EmployerJobListItemApiResponse[],
      ) => {
        // The paginated backend returns `{ items, next_cursor }`; a backend
        // that has not yet deployed that change still answers with a bare
        // array. Accept both so the jobs list never crashes on an old build.
        const page = Array.isArray(response)
          ? { items: response, next_cursor: null }
          : response;

        return {
          items: (page.items ?? []).map(mapApiJobToEmployerJob),
          nextCursor: page.next_cursor ?? null,
        };
      },

      providesTags: (result) =>
        result
          ? [
              ...result.items.map((job) => ({
                type: "Job" as const,
                id: job.id,
              })),
              { type: "Job" as const, id: "LIST" },
            ]
          : [{ type: "Job" as const, id: "LIST" }],
    }),

    getEmployerJob: builder.query<
      EmployerJobApiResponse,
      string
    >({
      query: (id) => ({
        url: `/employer/jobs/${id}`,
        method: "GET",
      }),

      providesTags: (_result, _error, id) => [
        { type: "Job" as const, id },
      ],
    }),
    previewEmployerJobThreshold: builder.query<ThresholdPreview, number>({
      query: (minScore) => ({ url: "/employer/jobs/threshold-preview", params: { min_score: minScore } }),
    }),
    createEmployerJob: builder.mutation<EmployerJobApiResponse, CreateJobFormValues>({
      query: (values) => ({ url: "/employer/jobs", method: "POST", body: jobBody(values) }),
      invalidatesTags: [{ type: "Job", id: "LIST" }],
    }),
    updateEmployerJob: builder.mutation<EmployerJobApiResponse, { id: string; values: CreateJobFormValues }>({
      query: ({ id, values }) => ({ url: `/employer/jobs/${id}`, method: "PATCH", body: jobBody(values) }),
      invalidatesTags: (_result, _error, { id }) => [{ type: "Job", id }, { type: "Job", id: "LIST" }],
    }),
    publishEmployerJob: builder.mutation<EmployerJobApiResponse, string>({
      query: (id) => ({ url: `/employer/jobs/${id}/publish`, method: "POST" }),
      invalidatesTags: (_result, _error, id) => [{ type: "Job", id }, { type: "Job", id: "LIST" }],
    }),
    pauseEmployerJob: builder.mutation<EmployerJobApiResponse, string>({
      query: (id) => ({ url: `/employer/jobs/${id}/pause`, method: "POST" }),
      invalidatesTags: (_result, _error, id) => [{ type: "Job", id }, { type: "Job", id: "LIST" }],
    }),
    closeEmployerJob: builder.mutation<EmployerJobApiResponse, string>({
      query: (id) => ({ url: `/employer/jobs/${id}/close`, method: "POST" }),
      invalidatesTags: (_result, _error, id) => [{ type: "Job", id }, { type: "Job", id: "LIST" }],
    }),
  }),

  overrideExisting: false,
});

export const {
  useGetEmployerJobsQuery,
  useLazyGetEmployerJobsQuery,
  useGetEmployerJobQuery,
  usePreviewEmployerJobThresholdQuery,
  useCreateEmployerJobMutation,
  useUpdateEmployerJobMutation,
  usePublishEmployerJobMutation,
  usePauseEmployerJobMutation,
  useCloseEmployerJobMutation,
} = employerJobsApi;
