import { baseApi } from "@/store/api/base-api";
import type {
  EmployerDashboardActivityActor,
  EmployerDashboardActivityPageApiResponse,
  EmployerDashboardApiResponse,
} from "@/types/employer/dashboard";

interface EmployerDashboardActivityQuery {
  actor?: EmployerDashboardActivityActor;
  limit?: number;
}

export const employerDashboardApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmployerDashboard: builder.query<
      EmployerDashboardApiResponse,
      { topJobs?: number } | void
    >({
      query: (params) => ({
        url: "/employer/dashboard",
        method: "GET",
        params: params
          ? {
              top_jobs: params.topJobs,
            }
          : undefined,
      }),
      providesTags: [
        { type: "Application", id: "EMPLOYER_LIST" },
        { type: "Job", id: "LIST" },
      ],
    }),
    getEmployerDashboardActivity: builder.infiniteQuery<
      EmployerDashboardActivityPageApiResponse,
      EmployerDashboardActivityQuery,
      string | null
    >({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (lastPage) =>
          lastPage.next_cursor ?? undefined,
      },
      query: ({ queryArg, pageParam }) => ({
        url: "/employer/dashboard/activity",
        method: "GET",
        params: {
          actor: queryArg.actor,
          cursor: pageParam ?? undefined,
          limit: queryArg.limit,
        },
      }),
      providesTags: [
        { type: "Application", id: "EMPLOYER_LIST" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetEmployerDashboardQuery,
  useGetEmployerDashboardActivityInfiniteQuery,
} = employerDashboardApi;
