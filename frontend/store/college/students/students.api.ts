import { baseApi } from "@/store/api/base-api";
import type { StructuredResume, StructuredStatus } from "@/components/resume/structured-resume";

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
  employer_logo_url?: string | null;
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
      employerLogoUrl: hire.employer_logo_url ?? null,
      hiredAt: hire.hired_at,
      source: hire.source,
    })),
  };
}

export const collegeStudentsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCollegeStudentDetails: builder.query<{
      email: string | null; phone: string | null; city: string | null; state_code: string | null; locale: string;
      questionnaire: Array<{ code: string; question: string; answer: string }>;
      questionnaire_submitted_at: string | null; resume_confirmed_at: string | null;
      interviews_completed: number; has_resume_file: boolean;
      courses: Array<{ code: string; title: string; purchased_at: string; percent_complete: number; lessons_completed: number; lessons_total: number; completed_at: string | null }>;
      applications: Array<{ job_title: string; employer_name: string; employer_logo_url?: string | null; job_location: string | null; stage: string; applied_at: string; updated_at: string }>;
      analytics: { total: number; open: number; by_stage: Record<string, number>; reached: Record<string, number> };
    }, string>({ query: (id) => `/college/students/${id}/details` }),
    getCollegeStudentResume: builder.query<{ confirmed_at: string | null; text: string | null; fields: Record<string, unknown>; structured_resume?: StructuredResume | null; structured_status?: StructuredStatus; file_url: string | null; file_mime: string | null; source: string }, string>({ query: (id) => `/college/students/${id}/resume` }),
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
  useGetCollegeStudentDetailsQuery,
  useGetCollegeStudentResumeQuery,
  useGetCollegeStudentsQuery,
  useGetCollegeStudentQuery,
} = collegeStudentsApi;
