import { baseApi } from "@/store/api/base-api";

import type {
  CollegeOnboarding,
  CollegeOrganisation,
  CollegeSeats,
  CollegeTeamMember,
  CollegeTeamRole,
} from "@/store/college/types";

/* =========================================================
   Organisation
========================================================= */

interface CollegeOrganisationResponse {
  tenant_id: string;
  name: string;
  institution_type: string | null;
  onboarding_submitted_at: string | null;
  verified_at: string | null;
  created_at: string;
}

export function mapCollegeOrganisation(
  organisation: CollegeOrganisationResponse,
): CollegeOrganisation {
  return {
    tenantId: organisation.tenant_id,
    name: organisation.name,
    institutionType: organisation.institution_type,
    onboardingSubmittedAt:
      organisation.onboarding_submitted_at,
    verifiedAt: organisation.verified_at,
    createdAt: organisation.created_at,
  };
}

/* =========================================================
   Team
========================================================= */

interface CollegeTeamMemberResponse {
  user_id: string;
  email: string | null;
  role: CollegeTeamRole;
  added_at: string;
}

export function mapCollegeTeamMember(
  member: CollegeTeamMemberResponse,
): CollegeTeamMember {
  return {
    userId: member.user_id,
    email: member.email ?? "",
    role: member.role,
    addedAt: member.added_at,
  };
}

/* =========================================================
   Seats
========================================================= */

interface CollegeSeatsResponse {
  seats_allocated: number;
  seats_used: number;
  seats_available: number;
  subscription_active: boolean;
}

export function mapCollegeSeats(
  seats: CollegeSeatsResponse,
): CollegeSeats {
  return {
    allocated: seats.seats_allocated,
    used: seats.seats_used,
    available: seats.seats_available,
    subscriptionActive: seats.subscription_active,
  };
}

/* =========================================================
   Onboarding form
========================================================= */

interface CollegeOnboardingResponse {
  form: CollegeOnboarding["form"];
  options: CollegeOnboarding["options"];
  answers: Record<string, unknown>;
  form_version: string | null;
  submitted_at: string | null;
}

function mapCollegeOnboarding(
  response: CollegeOnboardingResponse,
): CollegeOnboarding {
  return {
    form: response.form,
    options: response.options,
    answers: response.answers,
    formVersion: response.form_version,
    submittedAt: response.submitted_at,
  };
}

export const collegeSettingsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCollegeOrganisation: builder.query<
      CollegeOrganisation,
      void
    >({
      query: () => ({
        url: "/college/organisation",
        method: "GET",
      }),
      transformResponse: mapCollegeOrganisation,
      providesTags: [
        { type: "College", id: "ORGANISATION" },
      ],
    }),

    updateCollegeOrganisation: builder.mutation<
      CollegeOrganisation,
      { name: string; institutionType: string | null }
    >({
      query: (organisation) => ({
        url: "/college/organisation",
        method: "PATCH",
        body: {
          name: organisation.name,
          institution_type: organisation.institutionType,
        },
      }),
      transformResponse: mapCollegeOrganisation,
      invalidatesTags: [
        { type: "College", id: "ORGANISATION" },
      ],
    }),

    getCollegeTeam: builder.query<
      CollegeTeamMember[],
      void
    >({
      query: () => ({
        url: "/college/team",
        method: "GET",
      }),
      transformResponse: (
        response: CollegeTeamMemberResponse[],
      ) => response.map(mapCollegeTeamMember),
      providesTags: [{ type: "Team", id: "COLLEGE" }],
    }),

    addCollegeTeamMember: builder.mutation<
      CollegeTeamMember,
      { email: string; role: CollegeTeamRole }
    >({
      query: (payload) => ({
        url: "/college/team",
        method: "POST",
        body: {
          email: payload.email,
          role: payload.role,
        },
      }),
      transformResponse: mapCollegeTeamMember,
      invalidatesTags: [{ type: "Team", id: "COLLEGE" }],
    }),

    changeCollegeTeamMemberRole: builder.mutation<
      CollegeTeamMember,
      { userId: string; role: CollegeTeamRole }
    >({
      query: ({ userId, role }) => ({
        url: `/college/team/${userId}`,
        method: "PATCH",
        body: { role },
      }),
      transformResponse: mapCollegeTeamMember,
      invalidatesTags: [{ type: "Team", id: "COLLEGE" }],
    }),

    removeCollegeTeamMember: builder.mutation<
      void,
      string
    >({
      query: (userId) => ({
        url: `/college/team/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: [{ type: "Team", id: "COLLEGE" }],
    }),

    getCollegeSeats: builder.query<CollegeSeats, void>({
      query: () => ({
        url: "/college/seats",
        method: "GET",
      }),
      transformResponse: mapCollegeSeats,
      providesTags: [{ type: "College", id: "SEATS" }],
    }),

    getCollegeOnboarding: builder.query<
      CollegeOnboarding,
      void
    >({
      query: () => ({
        url: "/college/onboarding",
        method: "GET",
      }),
      transformResponse: mapCollegeOnboarding,
      providesTags: [
        { type: "College", id: "ONBOARDING" },
      ],
    }),

    saveCollegeOnboarding: builder.mutation<
      CollegeOnboarding,
      {
        answers: Record<string, unknown>;
        __suppressSuccessFeedback?: boolean;
      }
    >({
      query: (payload) => ({
        url: "/college/onboarding/answers",
        method: "PUT",
        body: { answers: payload.answers },
      }),
      transformResponse: mapCollegeOnboarding,
      invalidatesTags: [
        { type: "College", id: "ONBOARDING" },
      ],
    }),

    submitCollegeOnboarding: builder.mutation<
      CollegeOnboarding,
      void
    >({
      query: () => ({
        url: "/college/onboarding/submit",
        method: "POST",
      }),
      transformResponse: mapCollegeOnboarding,
      invalidatesTags: [
        { type: "College", id: "ONBOARDING" },
        { type: "College", id: "ORGANISATION" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetCollegeOrganisationQuery,
  useUpdateCollegeOrganisationMutation,
  useGetCollegeTeamQuery,
  useAddCollegeTeamMemberMutation,
  useChangeCollegeTeamMemberRoleMutation,
  useRemoveCollegeTeamMemberMutation,
  useGetCollegeSeatsQuery,
  useGetCollegeOnboardingQuery,
  useSaveCollegeOnboardingMutation,
  useSubmitCollegeOnboardingMutation,
} = collegeSettingsApi;