import { baseApi } from "@/store/api/base-api";

export type CareerDetails = Record<string, string | number | string[] | null>;
export interface CareerField {
  key: string;
  label: string;
  type: "text" | "tel" | "number" | "month" | "list" | "select";
  required: boolean;
  section: "basic" | "employment" | "education" | "preferences";
  options: { value: string; label: string }[];
}
export interface CareerProfile {
  details: CareerDetails;
  resume_version_id: string | null;
  resume_file_id: string | null;
  resume_filename: string | null;
  completed: boolean;
  updated_at: string | null;
}
export interface ResumeDraft {
  full_name: string;
  email: string;
  details: CareerDetails;
}
export const careerApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    previewSignupResume: builder.mutation<ResumeDraft, File>({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/auth/resume-preview", method: "POST", body };
      },
    }),
    intakeCareerResume: builder.mutation<{ resume_version_id: string }, File>({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/candidate/resume/intake", method: "POST", body };
      },
      invalidatesTags: [{ type: "Student", id: "RESUME_VERSIONS" }],
    }),
    getCareerIdentity: builder.query<
      { email: string | null; full_name: string | null },
      void
    >({ query: () => "/auth/me" }),
    getCareerFields: builder.query<CareerField[], void>({
      query: () => "/candidate/profile/form",
    }),
    getCareerProfile: builder.query<CareerProfile, void>({
      query: () => "/candidate/profile/details",
      providesTags: [{ type: "Student", id: "CAREER" }],
    }),
    prefillCareerProfile: builder.mutation<CareerProfile, string>({
      query: (id) => ({
        url: `/candidate/profile/prefill/${id}`,
        method: "POST",
      }),
      invalidatesTags: [{ type: "Student", id: "CAREER" }],
    }),
    saveCareerProfile: builder.mutation<
      CareerProfile,
      {
        details: CareerDetails;
        resume_version_id?: string | null;
        resume_filename?: string;
        complete: boolean;
      }
    >({
      query: (body) => ({
        url: "/candidate/profile/details",
        method: "PUT",
        body,
      }),
      invalidatesTags: [
        { type: "Student", id: "CAREER" },
        { type: "Student", id: "PROFILE" },
      ],
    }),
    getProfileResumeDocument: builder.query<{ url: string | null }, string>({
      query: (id) => `/candidate/resume/versions/${id}/document`,
      keepUnusedDataFor: 0,
    }),
  }),
});
export const {
  usePreviewSignupResumeMutation,
  useIntakeCareerResumeMutation,
  useGetCareerIdentityQuery,
  useGetCareerFieldsQuery,
  useGetCareerProfileQuery,
  useLazyGetCareerProfileQuery,
  usePrefillCareerProfileMutation,
  useSaveCareerProfileMutation,
  useLazyGetProfileResumeDocumentQuery,
} = careerApi;

export function careerFieldRequired(
  field: CareerField,
  details: CareerDetails,
) {
  if (field.required) return true;
  if (details.work_status !== "EXPERIENCED") return false;
  return (
    [
      "currently_employed",
      "company_name",
      "job_title",
      "employment_start",
    ].includes(field.key) ||
    (field.key === "employment_end" && details.currently_employed === "NO")
  );
}
export function visibleCareerField(field: CareerField, details: CareerDetails) {
  const experiencedOnly = [
    "currently_employed",
    "experience_years",
    "experience_months",
    "company_name",
    "job_title",
    "employment_start",
    "employment_end",
    "annual_salary",
    "notice_period",
    "industry",
    "department",
    "role_category",
    "job_role",
  ];
  return (
    !(
      details.work_status === "FRESHER" && experiencedOnly.includes(field.key)
    ) &&
    !(field.key === "employment_end" && details.currently_employed === "YES")
  );
}
