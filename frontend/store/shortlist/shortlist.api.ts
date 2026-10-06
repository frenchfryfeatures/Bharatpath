import { baseApi } from "@/store/api/base-api";

export type InvitationStatus = "INVITED" | "ACCEPTED" | "DECLINED" | "CANCELLED";
export interface Invitation {
  id: string;
  job_id: string;
  job_title: string | null;
  employer_name: string | null;
  status: InvitationStatus;
  application_id: string | null;
  created_at: string;
  answered_at: string | null;
}
export interface EmployerInvitation extends Omit<Invitation, "employer_name"> {
  candidate_id: string;
  candidate: {
    full_name: string | null;
    city: string | null;
    band: string;
    state_code?: string | null;
    experience_years?: number | null;
    skills?: string[];
  } | null;
}
interface Page<T> { items: T[]; next_cursor: string | null }
interface Query { cursor?: string; job_id?: string; status?: InvitationStatus; limit?: number }
export const shortlistApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmployerInvitations: builder.query<Page<EmployerInvitation>, Query>({
      query: (params) => ({ url: "/employer/shortlist", params }),
      providesTags: [{ type: "Candidate", id: "INVITATIONS" }],
    }),
    cancelEmployerInvitation: builder.mutation<Invitation, string>({
      query: (id) => ({ url: `/employer/shortlist/${id}/cancel`, method: "POST" }),
      invalidatesTags: (result, error) => error ? [] : [
        { type: "Candidate", id: "INVITATIONS" },
        { type: "Application", id: "LIST" },
        ...(result?.application_id ? [{ type: "Application" as const, id: result.application_id }] : []),
        ...(result ? [{ type: "Job" as const, id: result.job_id }] : []),
      ],
    }),
    getStudentInvitations: builder.query<Page<Invitation>, Omit<Query, "job_id">>({
      query: (params) => ({ url: "/candidate/shortlist-invitations", params }),
      providesTags: [{ type: "Student", id: "INVITATIONS" }],
    }),
    answerStudentInvitation: builder.mutation<Invitation, { id: string; action: "accept" | "decline" }>({
      query: ({ id, action }) => ({ url: `/candidate/shortlist-invitations/${id}/${action}`, method: "POST" }),
      invalidatesTags: (result, error) => error ? [] : [
        { type: "Student", id: "INVITATIONS" },
        { type: "Application", id: "STUDENT_LIST" },
        { type: "Application", id: "LIST" },
        { type: "Candidate", id: "INVITATIONS" },
        ...(result?.application_id ? [{ type: "Application" as const, id: result.application_id }] : []),
        ...(result ? [{ type: "Job" as const, id: result.job_id }] : []),
      ],
    }),
  }),
});
export const { useLazyGetEmployerInvitationsQuery, useCancelEmployerInvitationMutation, useLazyGetStudentInvitationsQuery, useAnswerStudentInvitationMutation } = shortlistApi;
