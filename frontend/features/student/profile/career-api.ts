import { baseApi } from "@/store/api/base-api";

export type CareerDetails = Record<string, string | number | string[] | Record<string, string> | null>;
export interface CareerField {
  key: string;
  label: string;
  type: "text" | "tel" | "number" | "month" | "list" | "select";
  required: boolean;
  rules?: {required_when: string; visible_when: string; education_max_years: number};
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
      transformResponse: (fields: CareerField[]) => {
        const workStatus = fields.find((field) => field.key === "work_status");
        const ordered = fields.filter((field) => field.key !== "work_status");
        const employmentIndex = ordered.findIndex((field) => field.section === "employment");
        if (workStatus)
          ordered.splice(employmentIndex < 0 ? ordered.length : employmentIndex, 0, {
            ...workStatus,
            section: "employment",
          });
        return ordered;
      },
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
    // The profile's Preferences tab (2026-11-23). Saving also refreshes the
    // profile and the "fits your profile" jobs, which read the same data.
    getJobPreferences: builder.query<JobPreferencesResponse, void>({
      query: () => "/candidate/profile/preferences",
      providesTags: [{ type: "Student", id: "PREFERENCES" }],
    }),
    getJobPreferenceOptions: builder.query<JobPreferenceOptions, void>({
      query: () => "/candidate/profile/preferences/options",
      keepUnusedDataFor: 600,
    }),
    saveJobPreferences: builder.mutation<JobPreferencesResponse, JobPreferences>({
      query: (body) => ({ url: "/candidate/profile/preferences", method: "PUT", body }),
      invalidatesTags: [
        { type: "Student", id: "PREFERENCES" },
        { type: "Student", id: "CAREER" },
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
  useGetJobPreferencesQuery,
  useGetJobPreferenceOptionsQuery,
  useSaveJobPreferencesMutation,
} = careerApi;

export type WorkModePreference = "ONSITE" | "HYBRID" | "REMOTE";
export type JobTypePreference = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP" | "FREELANCE";

/** What the job engine ranks by, beyond the profile itself. */
export interface JobPreferences {
  preferred_roles: string[];
  preferred_industries: string[];
  work_modes: WorkModePreference[];
  job_types: JobTypePreference[];
  open_to_relocation: boolean;
  preferred_locations: string[];
  preferred_salary: number | null;
  preferred_salary_currency: "INR" | "USD";
}

export interface JobPreferencesResponse extends JobPreferences {
  profile_completed: boolean;
  updated_at: string | null;
}

export interface PreferenceOption {
  value: string;
  label: string;
}

export interface JobPreferenceOptions {
  work_modes: PreferenceOption[];
  job_types: PreferenceOption[];
  industries: PreferenceOption[];
  roles: PreferenceOption[];
  salary_currencies: PreferenceOption[];
}

const inactiveEmploymentFields = [
  "company_name",
  "job_title",
  "employment_start",
  "employment_end",
  "annual_salary",
  "notice_period",
  "job_role",
];


export function careerDetailsForSave(details: CareerDetails): CareerDetails {
  const result = { ...details };
  result.specialization = result.specialization || result.specialization_name || "";
  delete result.specialization_name;
  if (result.work_status === "FRESHER") {
    result.currently_employed = "NO";
    result.experience_years = 0;
    result.experience_months = 0;
  }
  // The deployed backend requires non-empty key_skills when complete=true.
  // Preserve existing skills if present, or provide a default fallback.
  const keySkills = result.key_skills;
  if (!keySkills || (Array.isArray(keySkills) && keySkills.length === 0)) {
    result.key_skills = details.work_status === "FRESHER" ? ["Fresher"] : ["General"];
  }
  if (result.work_status === "FRESHER") {
    for (const key of inactiveEmploymentFields) delete result[key];
  } else if (result.currently_employed === "YES") {
    delete result.employment_end;
  }
  if (result.currently_employed === "NO" || result.work_status === "FRESHER") result.notice_period = "IMMEDIATE";
  result.annual_salary_currency ??= "INR";
  result.preferred_salary_currency ??= "INR";
  return result;
}

function matchesRule(condition: string, details: CareerDetails): boolean {
  return condition === "ALWAYS" || (condition === "EMPLOYMENT_CHOSEN" && ["YES", "NO"].includes(String(details.currently_employed))) || (condition === "EMPLOYED" && details.currently_employed === "YES") ||
    (condition === "EXPERIENCED" && (details.work_status === "EXPERIENCED" || details.currently_employed === "YES")) ||
    (condition === "PREVIOUS" && details.work_status === "EXPERIENCED" && details.currently_employed === "NO");
}

export function careerFieldRequired(field: CareerField, details: CareerDetails) {
  if (field.rules) return matchesRule(field.rules.required_when, details);
  if (field.key === "preferred_salary") return false;
  if (field.key.endsWith('_salary_currency')) return true;
  if (field.key === 'annual_salary') return details.work_status === 'EXPERIENCED' || details.currently_employed === 'YES';
  if (field.key === 'key_skills') return false;
  if (field.key === 'notice_period') return details.currently_employed === 'YES';
  if (field.required || field.key === 'gender') return true;
  if (details.work_status !== 'EXPERIENCED') return false;
  return ['currently_employed', 'company_name', 'job_title', 'employment_start'].includes(field.key) ||
    (field.key === 'employment_end' && details.currently_employed === 'NO');
}
export function visibleCareerField(field: CareerField, details: CareerDetails) {
  if (field.key === "notice_period" && details.currently_employed === "NO") return true;
  if (field.key === "specialization_name") return false;
  if (field.rules) return matchesRule(field.rules.visible_when, details);
  if (field.key === 'key_skills') return false;
  if (field.key === 'currently_employed') return true;
  if (field.key === 'employment_end') return details.work_status === 'EXPERIENCED' && details.currently_employed === 'NO';
  if (field.key === 'notice_period') return details.currently_employed === 'YES';
  const history = ['experience_years','experience_months','company_name','job_title','employment_start',
    'annual_salary','annual_salary_currency','industry','department','role_category','job_role'];
  return !history.includes(field.key) || details.work_status === 'EXPERIENCED' || details.currently_employed === 'YES';
}
