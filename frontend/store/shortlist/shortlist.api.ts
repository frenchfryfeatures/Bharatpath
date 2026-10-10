import { baseApi } from "@/store/api/base-api";
import type {
  CandidateBadge,
  CandidateBand,
} from "@/features/employer/candidates/types";

export type InvitationStatus = "INVITED" | "ACCEPTED" | "DECLINED" | "CANCELLED";
export interface Invitation {
  id: string;
  job_id: string;
  job_title: string | null;
  employer_name: string | null;
  employer_logo_url?: string | null;
  status: InvitationStatus;
  application_id: string | null;
  created_at: string;
  answered_at: string | null;
}
/**
 * `ShortlistEntry.candidate` is the backend's `ApplicantCard`: who they are,
 * with no contact and no score. Null while an integrity review hides them.
 */
export interface ShortlistedCandidate {
  full_name: string | null;
  band: CandidateBand;
  experience_years: number;
  skills: string[];
  badges: CandidateBadge[];
  city: string | null;
  state_code: string | null;
}
export interface EmployerInvitation extends Omit<Invitation, "employer_name" | "employer_logo_url"> {
  candidate_id: string;
  candidate: ShortlistedCandidate | null;
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
