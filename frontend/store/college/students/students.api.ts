import { baseApi } from "@/store/api/base-api";

import type {
  CollegeStudentDetail,
  CollegeStudentLinkState,
  CollegeStudentStageFilter,
  VisibleStudent,
  VisibleStudentsPage,
} from "./types";

interface VisibleStudentResponse {
  candidate_id: string | null;
  roster_entry_id: string | null;
  full_name: string | null;
  stage_since: string;
  visible_since: string | null;
  link_state: CollegeStudentLinkState;
}

interface VisibleStudentsPageResponse {
  items: VisibleStudentResponse[];
  next_cursor: string | null;
}

interface StudentHireResponse {
  job_title: string;
  employer_name: string;
  hired_at: string;
  source: "PLATFORM";
}

interface CollegeStudentDetailResponse {
  candidate_id: string;
  full_name: string | null;
  visible_since: string;
  score: number | null;
  band: "ENTRY" | "DEVELOPING" | "SOLID" | "STRONG" | null;
  scored_at: string | null;
  applications: number;
  interviews: number;
  hires: StudentHireResponse[];
}

function mapVisibleStudent(
  student: VisibleStudentResponse,
): VisibleStudent {
  return {
    candidateId: student.candidate_id,
    rosterEntryId: student.roster_entry_id,
    fullName: student.full_name,
    stageSince: student.stage_since,
    visibleSince: student.visible_since,
    linkState: student.link_state,
  };
}

function mapCollegeStudentDetail(
  student: CollegeStudentDetailResponse,
): CollegeStudentDetail {
  return {
    candidateId: student.candidate_id,
    fullName: student.full_name,
    visibleSince: student.visible_since,
    score: student.score,
    band: student.band,
    scoredAt: student.scored_at,
    applications: student.applications,
    interviews: student.interviews,
    hires: student.hires.map((hire) => ({
      jobTitle: hire.job_title,
      employerName: hire.employer_name,
      hiredAt: hire.hired_at,
      source: hire.source,
    })),
  };
}

export const collegeStudentsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCollegeStudents: builder.query<
      VisibleStudentsPage,
      {
        q?: string;
        stage?: CollegeStudentStageFilter;
        cursor?: string;
        limit?: number;
      } | void
    >({
      query: (args) => ({
        url: "/college/students",
        method: "GET",
        params: {
          q: args?.q,
          stage: args?.stage,
          limit: args?.limit ?? 10,
          cursor: args?.cursor,
        },
      }),
      transformResponse: (
        response: VisibleStudentsPageResponse,
      ): VisibleStudentsPage => ({
        items: response.items.map(mapVisibleStudent),
        nextCursor: response.next_cursor,
      }),
      providesTags: [{ type: "Student", id: "LIST" }],
    }),

    getCollegeStudent: builder.query<
      CollegeStudentDetail,
      string
    >({
      query: (candidateId) => ({
        url: `/college/students/${candidateId}`,
        method: "GET",
      }),
      transformResponse: mapCollegeStudentDetail,
      providesTags: (_result, _error, candidateId) => [
        { type: "Student", id: candidateId },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetCollegeStudentsQuery,
  useGetCollegeStudentQuery,
} = collegeStudentsApi;
