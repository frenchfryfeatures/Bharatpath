import { baseApi } from "@/store/api/base-api";

import type { CompanyProfile, TeamMember, TeamRole } from "./types";

interface EmployerOrganisationResponse {
  tenant_id: string;
  legal_name: string;
  employer_type: string | null;
  industry: string | null;
  kyb_status: string;
}

export interface EmployerReferenceResponse {
  employer_types: Array<{ code: string; label: string }>;
  industries: Array<{ code: string; label: string }>;
}

export function mapEmployerOrganisation(
  organisation: EmployerOrganisationResponse,
): CompanyProfile {
  return {
    legalName: organisation.legal_name,
    businessType: organisation.employer_type ?? "",
    industry: organisation.industry ?? "",
    kybStatus: organisation.kyb_status,
    pan: "",
    gstin: "",
    cin: "",
    tan: "",
    address: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    pincode: "",
    signatoryName: "",
    signatoryDesignation: "",
    workEmail: "",
    workPhone: "",
    documents: [],
    undertakings: {
      genuineHiring: true,
      noRedistribution: true,
      authorised: true,
      submittedAt: null,
    },
    tradeName: "",
    employeeCountBand: "",
    website: "",
    about: "",
    hasSeparateCorrespondenceAddress: false,
    correspondenceAddress: "",
  };
}

type EmployerTeamRole =
  | "EMPLOYER_OWNER"
  | "EMPLOYER_RECRUITER"
  | "EMPLOYER_VIEWER";

interface EmployerTeamMemberResponse {
  user_id: string;
  email: string | null;
  role: EmployerTeamRole;
  added_at: string;
}

const ROLE_LABELS: Record<EmployerTeamRole, TeamRole> = {
  EMPLOYER_OWNER: "Owner",
  EMPLOYER_RECRUITER: "Recruiter",
  EMPLOYER_VIEWER: "View only",
};

function displayName(email: string | null) {
  if (!email) {
    return "Team member";
  }

  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function mapEmployerTeamMember(
  member: EmployerTeamMemberResponse,
): TeamMember {
  return {
    id: member.user_id,
    name: displayName(member.email),
    email: member.email ?? "",
    role: ROLE_LABELS[member.role],
    status: "Active",
    // The API exposes active memberships only. Owners cannot be removed.
    canRemove: member.role !== "EMPLOYER_OWNER",
  };
}

export const employerSettingsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmployerTeam: builder.query<TeamMember[], void>({
      query: () => ({
        url: "/employer/team",
        method: "GET",
      }),
      transformResponse: (response: EmployerTeamMemberResponse[]) =>
        response.map(mapEmployerTeamMember),
      providesTags: [{ type: "Team", id: "LIST" }],
    }),
    getEmployerReference: builder.query<EmployerReferenceResponse, void>({
      query: () => ({ url: "/employer/reference", method: "GET" }),
    }),

    createEmployerOrganisation: builder.mutation<
      CompanyProfile,
      { legalName: string; businessType?: string; industry?: string }
    >({
      query: ({ legalName, businessType, industry }) => ({
        url: "/employer/organisation",
        method: "POST",
        body: {
          legal_name: legalName,
          employer_type: businessType || null,
          industry: industry || null,
        },
      }),
      transformResponse: (response: EmployerOrganisationResponse) =>
        mapEmployerOrganisation(response),
      invalidatesTags: [{ type: "Team", id: "ORGANISATION" }],
    }),

    getEmployerOrganisation: builder.query<CompanyProfile, void>({
      query: () => ({
        url: "/employer/organisation",
        method: "GET",
      }),
      transformResponse: (response: EmployerOrganisationResponse) =>
        mapEmployerOrganisation(response),
      providesTags: [{ type: "Team", id: "ORGANISATION" }],
    }),
    addEmployerTeamMember: builder.mutation<TeamMember, { email: string; role: TeamRole }>({
      query: ({ email, role }) => ({
        url: "/employer/team",
        method: "POST",
        body: {
          email,
          role: role === "Recruiter" ? "EMPLOYER_RECRUITER" : role === "View only" ? "EMPLOYER_VIEWER" : "EMPLOYER_OWNER",
        },
      }),
      transformResponse: (response: EmployerTeamMemberResponse) => mapEmployerTeamMember(response),
      invalidatesTags: [{ type: "Team", id: "LIST" }],
    }),
    updateEmployerTeamMember: builder.mutation<TeamMember, { userId: string; role: TeamRole }>({
      query: ({ userId, role }) => ({
        url: `/employer/team/${userId}`,
        method: "PATCH",
        body: { role: role === "Recruiter" ? "EMPLOYER_RECRUITER" : role === "View only" ? "EMPLOYER_VIEWER" : "EMPLOYER_OWNER" },
      }),
      transformResponse: (response: EmployerTeamMemberResponse) => mapEmployerTeamMember(response),
      invalidatesTags: [{ type: "Team", id: "LIST" }],
    }),
    removeEmployerTeamMember: builder.mutation<void, string>({
      query: (userId) => ({ url: `/employer/team/${userId}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Team", id: "LIST" }],
    }),

    updateEmployerOrganisation: builder.mutation<
      CompanyProfile,
      Partial<Pick<CompanyProfile, "legalName" | "businessType" | "industry">>
    >({
      query: (company) => ({
        url: "/employer/organisation",
        method: "PATCH",
        body: {
          ...(company.legalName !== undefined ? { legal_name: company.legalName } : {}),
          ...(company.businessType !== undefined ? { employer_type: company.businessType || null } : {}),
          ...(company.industry !== undefined ? { industry: company.industry || null } : {}),
        },
      }),
      transformResponse: (response: EmployerOrganisationResponse) =>
        mapEmployerOrganisation(response),
      invalidatesTags: [{ type: "Team", id: "ORGANISATION" }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetEmployerTeamQuery,
  useGetEmployerOrganisationQuery,
  useCreateEmployerOrganisationMutation,
  useUpdateEmployerOrganisationMutation,
  useGetEmployerReferenceQuery,
  useAddEmployerTeamMemberMutation,
  useUpdateEmployerTeamMemberMutation,
  useRemoveEmployerTeamMemberMutation,
} = employerSettingsApi;
