import { baseApi } from "./base-api";
import type { CareerField, CareerProfile } from "@/features/student/profile/career-api";

export type CursorPage<T> = {
  items: T[];
  next_cursor: string | null;
};

export type AuthIdentity = {
  user_id: string;
  role: string;
  pool: string;
  tenant_id: string | null;
};

export type AdminListParams = {
  cursor?: string;
  limit?: number;
};

export type KybSubmissionRow = {
  id: string;
  tenant_id: string;
  organisation: string;
  state: string;
  form_version: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  auto_approved: boolean;
  created_at: string;
  /** Decisions made so far. Above 0 on a SUBMITTED row means sent back, corrected, resubmitted. */
  review_count?: number;
  /** True when the organisation started this one after a rejection. */
  after_rejection?: boolean;
};

export type KybSubmissionsPage = CursorPage<KybSubmissionRow> & {
  review_required: boolean;
};

export type KybReviewFlag = {
  /** A form field code (`pan`) or a document code (`doc_pan`). */
  field: string;
  note?: string | null;
};

export type KybReviewEntry = {
  decision: string;
  reason: string | null;
  flags: KybReviewFlag[];
  reviewed_at: string;
};

export type KybSubmission = {
  submission_id: string | null;
  state: string;
  form_version: string | null;
  answers: Record<string, unknown>;
  documents: Array<{
    doc_type: string;
    mime: string | null;
    uploaded_at: string;
    /** Expires after 15 minutes. Never cache it. */
    url?: string | null;
  }>;
  submitted_at: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  auto_approved: boolean;
  review_flags?: KybReviewFlag[];
  /** Earlier decisions, oldest first. */
  reviews?: KybReviewEntry[];
  /** Null before the first decision. */
  changed_since_last_review?: { fields: string[]; documents: string[] } | null;
};

export type IntegritySignalRow = {
  id: string;
  candidate_id: string;
  resume_version_id: string | null;
  rule_id: string;
  rule_version: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  state: "OPEN" | "CLEARED" | "CONFIRMED";
  created_at: string;
  resolved_at: string | null;
};

export type IntegritySignalDetail = IntegritySignalRow & {
  thresholds_version: string;
  evidence: Record<string, unknown>;
  resolved_by: string | null;
  resolution_note: string | null;
};

export type TenantRow = {
  id: string;
  type: "EMPLOYER" | "COLLEGE";
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  created_at: string;
};

export type SubscriptionSummary = {
  state: string;
  plan_code: string;
  current_period_end: string | null;
};

export type SuspensionResponse = {
  id: string;
  tenant_id: string;
  reason: string;
  suspended_by: string;
  suspended_at: string;
  lifted_by: string | null;
  lifted_at: string | null;
};

export type CandidateDrilldown = {
  id: string;
  status: string;
  locale: string;
  created_at: string;
  full_name: string | null;
  city: string | null;
  state_code: string | null;
  phone_masked: string | null;
  email_masked: string | null;
  score: { display_value: number; band: string; computed_at: string; scores_computed: number } | null;
  resume: { files: number; versions: number; last_confirmed_at: string | null };
  visible_to_employers: boolean;
  integrity_signals: Array<{ severity: string; state: string; count: number }>;
  applications_by_stage: Record<string, number>;
  hire_disputes: number;
  subscription: SubscriptionSummary | null;
  college_links: Array<{ tenant_id: string; college: string; scope: string; granted_at: string }>;
  seat_held: boolean;
  disputes_by_state: Record<string, number>;
};

export type CandidateOnboarding = {
  id: string; full_name: string | null; email: string | null; phone: string | null;
  city: string | null; state_code: string | null; locale: string;
  career?: CareerProfile | null;
  career_fields?: CareerField[];
  questionnaire_submitted_at: string | null;
  questionnaire: Array<{ code: string; question: string; answer: string }>;
  college_links: Array<{ tenant_id: string; college: string; scope: string; granted_at: string }>;
};
export type CandidateResume = { latest: ResumeVersion | null; confirmed: ResumeVersion | null };
export type ResumeVersion = { id: string; source: string; created_at: string; text: string | null; fields: Record<string, unknown>; structured_resume?: import("@/components/resume/structured-resume").StructuredResume | null; structured_status?: import("@/components/resume/structured-resume").StructuredStatus; file_url: string | null; confirmed_at: string | null };
export type ScoreTimeline = { points: Array<{ computed_at: string; display_value: number; band: string; change: number | null; cause: string }> };
export type InterviewRow = { id: string; session_number: number; state: string; question_set_title: string; created_at: string; completed_at: string | null; questions_asked: number; answers_stored: number; report_status: string };
export type RecordingRow = { question_index: number; question_code: string; prompt: string; url: string; expires_in_seconds: number; mime: string | null; duration_ms: number | null; uploaded_at: string | null; transcript: string | null };
export type CourseStatus = { code: string; title: string; purchased: boolean; lessons_total: number; lessons_completed: number; percent_complete: number; completed_at: string | null };
export type AdminCourseLesson = {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
  duration_seconds: number;
  media_kind: "YOUTUBE" | "UPLOAD";
  youtube_video_id: string | null;
  media_ready: boolean;
  mime: string | null;
  size_bytes: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};
export type AdminCourseModule = {
  id: string;
  title: string;
  sort_order: number;
  active: boolean;
  lessons: AdminCourseLesson[];
};
export type AdminCourse = {
  id: string;
  code: string;
  title: string;
  version: number;
  price_minor: number;
  published: boolean;
  modules: AdminCourseModule[];
};
export type CourseModuleInput = { title: string; sort_order?: number };
export type CourseModuleUpdate = { title?: string; sort_order?: number; active?: boolean };
export type CourseLessonInput = {
  title: string;
  description?: string | null;
  sort_order?: number;
  youtube_url?: string | null;
};
export type CourseLessonUpdate = Partial<CourseLessonInput> & { active?: boolean };
export type LessonUpload = {
  url: string;
  method: "PUT";
  expires_in_seconds: number;
  max_bytes: number;
  accepted_types: string[];
};
export type CandidateApplications = { items: Array<{ id: string; job_title: string; employer_name: string | null; stage: string; applied_at: string }>; analytics: { total: number; open: number; by_stage: Record<string, number>; reached: Record<string, number> } };

export type EmployerDrilldown = {
  tenant_id: string;
  name: string;
  status: string;
  created_at: string;
  legal_name: string | null;
  employer_type: string | null;
  industry: string | null;
  kyb_status: string | null;
  verified_at: string | null;
  latest_kyb: { id: string; state: string; submitted_at: string | null; reviewed_at: string | null; auto_approved: boolean } | null;
  members_by_role: Record<string, number>;
  jobs_by_status: Record<string, number>;
  applications_by_stage: Record<string, number>;
  subscription: SubscriptionSummary | null;
  suspension: { id: string; suspended_at: string; suspended_by: string } | null;
  candidates_viewed_last_day: number;
  candidates_viewed_last_30_days: number;
  view_anomaly_flags_last_30_days: number;
  disputes_by_state: Record<string, number>;
};

export type CollegeDrilldown = {
  tenant_id: string;
  name: string;
  status: string;
  created_at: string;
  institution_type: string | null;
  onboarding_submitted_at: string | null;
  verified_at: string | null;
  members_by_role: Record<string, number>;
  seats: { allocated: number; used: number; plan_allowance: number | null } | null;
  live_referral_codes: number;
  connected_students: number;
  individually_visible: number;
  roster_imports_by_state: Record<string, number>;
  invitations_by_state: Record<string, number>;
  subscription: SubscriptionSummary | null;
  suspension: { id: string; suspended_at: string; suspended_by: string } | null;
  disputes_by_state: Record<string, number>;
};

export type DisputeRow = {
  id: string;
  kind: "HIRE" | "PAYMENT" | "ACCOUNT" | "OTHER";
  party: "CANDIDATE" | "EMPLOYER" | "COLLEGE";
  source: string;
  raised_by: string;
  tenant_id: string | null;
  application_id: string | null;
  state: "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED";
  assigned_to: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type DisputeDetail = DisputeRow & {
  description: string;
  resolution: string | null;
  resolved_by: string | null;
  links: {
    candidate_id: string | null;
    raiser_tenant_id: string | null;
    application: {
      id: string;
      candidate_id: string;
      employer_tenant_id: string;
      job_id: string;
      stage: string;
      employer_confirmed_at: string | null;
      candidate_confirmed_at: string | null;
      hire_disputed_at: string | null;
    } | null;
    live_integrity_signals: Record<string, number>;
  };
};

export type AuditEventRow = {
  id: number;
  actor_id: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  tenant_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

type KybListParams = AdminListParams & { state?: string };
type IntegrityListParams = AdminListParams & {
  state?: "OPEN" | "CLEARED" | "CONFIRMED";
  severity?: "LOW" | "MEDIUM" | "HIGH";
};
type TenantListParams = AdminListParams & {
  type?: "EMPLOYER" | "COLLEGE";
  status?: "ACTIVE" | "SUSPENDED" | "CLOSED";
  q?: string;
};
type DisputeListParams = AdminListParams & {
  state?: DisputeRow["state"];
  state_group?: "ACTIVE" | "CLOSED";
  kind?: DisputeRow["kind"];
  party?: DisputeRow["party"];
};

export type SearchFilterKind = "SKILL" | "CITY";

export type SearchFilterOption = {
  id: string;
  kind: SearchFilterKind;
  label: string;
  key: string;
  aliases: string[];
  state_code: string | null;
  featured: boolean;
  sort_order: number;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSearchFilterOption = {
  kind: SearchFilterKind;
  label: string;
  aliases?: string[];
  state_code?: string | null;
  featured?: boolean;
  sort_order?: number;
};

export type UpdateSearchFilterOption = {
  label?: string;
  aliases?: string[];
  state_code?: string | null;
  featured?: boolean;
  sort_order?: number;
  active?: boolean;
};

export type SearchFilterOptionsPage = {
  items: SearchFilterOption[];
  next_cursor: string | null;
  catalogue_version: string;
};

type SearchFilterListParams = AdminListParams & {
  kind?: SearchFilterKind;
  q?: string;
  includeInactive?: boolean;
};

/*
 * GET /api/v1/admin/dashboard - everything the operations dashboard needs in
 * one audited request. Field names follow the backend contract; nested shapes
 * the contract does not spell out in full are typed conservatively and the
 * hook maps them defensively.
 */
export type OrganisationStatusCounts = {
  active: number;
  suspended: number;
  closed: number;
};

export type AdminOldestWaitingItem = {
  type: "KYB" | "INTEGRITY" | "DISPUTE";
  id: string;
  waiting_since: string;
  detail: string;
  organisation: string | null;
  tenant_id: string | null;
  candidate_id: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | null;
  party: "CANDIDATE" | "EMPLOYER" | "COLLEGE" | null;
};

export type AdminThroughputPoint = {
  date: string;
  intake: number;
  cleared: number;
};

export type AdminCandidateRow = {
  id: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  full_name: string | null;
  city: string | null;
  state_code: string | null;
  phone_masked: string | null;
  email_masked: string | null;
  created_at: string;
};

export type AdminCandidateListParams = AdminListParams & {
  status?: "ACTIVE" | "SUSPENDED" | "DELETED";
  q?: string;
  email?: string;
};

export type DiscountAudience = "CANDIDATE" | "EMPLOYER" | "COLLEGE";
export type DiscountStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "DISABLED";

export type DiscountCode = {
  id: string;
  code: string;
  audience: DiscountAudience;
  percent_off: number | null;
  amount_off_minor: number | null;
  valid_from: string;
  valid_until: string | null;
  usage_limit: number | null;
  usage_count: number;
  status: DiscountStatus;
  label: string | null;
  created_by: string;
  created_at: string;
  disabled_at: string | null;
  disabled_by: string | null;
};

export type CreateDiscountCodeRequest = {
  code?: string;
  audience: DiscountAudience;
  percent_off?: number;
  amount_off_minor?: number;
  valid_from?: string;
  valid_until?: string;
  usage_limit?: number;
  label?: string;
};

export type DiscountCodesPage = CursorPage<DiscountCode> & { policy_version: string };
export type DiscountRedemption = {
  id: string;
  payment_id: string;
  user_id: string;
  subscriber_type: string;
  subscriber_id: string;
  organisation: string | null;
  list_amount_minor: number;
  discount_minor: number;
  amount_minor: number;
  redeemed_at: string;
};

export type ProvisionedAccountResponse = {
  user_id: string;
  kind: "CANDIDATE" | "EMPLOYER" | "COLLEGE" | "MEMBER";
  tenant_id: string | null;
  role: string | null;
  invitation: "SENT" | "ALREADY_REGISTERED";
  prefilled: string[];
};

export type ProvisionCandidateRequest = {
  email: string;
  full_name?: string;
  city?: string;
  state_code?: string;
};

export type InviteAdminAccountRequest = {
  email: string;
  kind: "CANDIDATE" | "EMPLOYER" | "COLLEGE";
};

export type ProvisionEmployerRequest = {
  owner_email: string;
  legal_name: string;
  employer_type?: string;
  industry?: string;
  kyb_answers?: Record<string, unknown>;
};

export type ProvisionCollegeRequest = {
  admin_email: string;
  name: string;
  institution_type: string;
  onboarding_answers?: Record<string, unknown>;
};

export type AdminAccountFormField = {
  code: string;
  key: string;
  label: string;
  type: "TEXT" | "TEXTAREA" | "EMAIL" | "PHONE" | "NUMBER" | "SELECT" | "MULTISELECT" | "DATE";
  required: boolean;
  pattern: string | null;
  max_length: number | null;
  help_text: string | null;
  options_source: string | null;
  public: boolean;
  verification_note: string | null;
};

export type AdminAccountForm = {
  code: string;
  version: string;
  sections: Array<{
    code: string;
    title: string;
    fields: AdminAccountFormField[];
    help_text: string | null;
  }>;
  options: Record<string, Array<{ code: string; label: string }>>;
};

export type AdminAccountFormsResponse = {
  employer: AdminAccountForm;
  college: AdminAccountForm;
};

export type AdminDashboardResponse = {
  generated_at: string;
  kyb: {
    awaiting_review: number;
    awaiting_employer: number;
    review_required: boolean;
    oldest_waiting_since: string | null;
  } | null;
  integrity: {
    open: number;
    open_by_severity: Record<"LOW" | "MEDIUM" | "HIGH", number>;
    candidates_held_back: number;
    oldest_waiting_since: string | null;
  } | null;
  disputes: {
    open: number;
    in_review: number;
    unassigned: number;
    by_kind: Record<string, number>;
    oldest_waiting_since: string | null;
  } | null;
  organisations: {
    employers: OrganisationStatusCounts;
    colleges: OrganisationStatusCounts;
  } | null;
  oldest_waiting: AdminOldestWaitingItem[];
  platform_totals: {
    candidates: number;
    employers: number;
    colleges: number;
    jobs_published: number;
    applications: number;
    hires: number;
  };
  throughput: AdminThroughputPoint[];
};

export const adminApi = baseApi.injectEndpoints({
  overrideExisting: true,
  endpoints: (builder) => ({
    getAdminIdentity: builder.query<AuthIdentity, void>({
      query: () => "/auth/me",
      providesTags: ["Auth"],
    }),
    getAdminDashboard: builder.query<AdminDashboardResponse, void>({
      query: () => "/admin/dashboard",
      providesTags: ["Admin"],
    }),
    getAdminCourses: builder.query<AdminCourse[], void>({
      query: () => "/admin/courses",
      providesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    createAdminCourseModule: builder.mutation<AdminCourse, { code: string; body: CourseModuleInput }>({
      query: ({ code, body }) => ({ url: `/admin/courses/${encodeURIComponent(code)}/modules`, method: "POST", body }),
      invalidatesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    updateAdminCourseModule: builder.mutation<AdminCourse, { moduleId: string; body: CourseModuleUpdate }>({
      query: ({ moduleId, body }) => ({ url: `/admin/course-modules/${moduleId}`, method: "PATCH", body }),
      invalidatesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    createAdminCourseLesson: builder.mutation<AdminCourseLesson, { moduleId: string; body: CourseLessonInput }>({
      query: ({ moduleId, body }) => ({ url: `/admin/course-modules/${moduleId}/lessons`, method: "POST", body }),
      invalidatesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    updateAdminCourseLesson: builder.mutation<AdminCourseLesson, { lessonId: string; body: CourseLessonUpdate }>({
      query: ({ lessonId, body }) => ({ url: `/admin/course-lessons/${lessonId}`, method: "PATCH", body }),
      invalidatesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    issueAdminLessonUpload: builder.mutation<LessonUpload, string>({
      query: (lessonId) => ({ url: `/admin/course-lessons/${lessonId}/upload`, method: "POST" }),
    }),
    confirmAdminLessonUpload: builder.mutation<AdminCourseLesson, string>({
      query: (lessonId) => ({ url: `/admin/course-lessons/${lessonId}/upload/confirm`, method: "POST" }),
      invalidatesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    publishAdminCourse: builder.mutation<AdminCourse, { code: string; published: boolean }>({
      query: ({ code, published }) => ({ url: `/admin/courses/${encodeURIComponent(code)}/published`, method: "PUT", body: { published } }),
      invalidatesTags: [{ type: "Admin", id: "COURSES" }],
    }),
    getAdminSearchFilters: builder.query<
      SearchFilterOptionsPage,
      SearchFilterListParams | void
    >({
      query: (params) => ({
        url: "/admin/search-filters",
        params: params
          ? {
              kind: params.kind,
              q: params.q,
              include_inactive: params.includeInactive,
              cursor: params.cursor,
              limit: params.limit,
            }
          : undefined,
      }),
      providesTags: [{ type: "Admin", id: "SEARCH_FILTERS" }],
    }),
    getAdminSearchFilter: builder.query<SearchFilterOption, string>({
      query: (optionId) => `/admin/search-filters/${optionId}`,
      providesTags: (_result, _error, optionId) => [
        { type: "Admin", id: `SEARCH_FILTER_${optionId}` },
      ],
    }),
    createAdminSearchFilter: builder.mutation<
      SearchFilterOption,
      CreateSearchFilterOption
    >({
      query: (body) => ({
        url: "/admin/search-filters",
        method: "POST",
        body,
      }),
      invalidatesTags: [
        { type: "Admin", id: "SEARCH_FILTERS" },
        { type: "Candidate", id: "FILTERS" },
      ],
    }),
    importAdminSearchFilters: builder.mutation<
      { items: SearchFilterOption[] },
      CreateSearchFilterOption[]
    >({
      query: (items) => ({
        url: "/admin/search-filters/import",
        method: "POST",
        body: { items },
      }),
      invalidatesTags: [
        { type: "Admin", id: "SEARCH_FILTERS" },
        { type: "Candidate", id: "FILTERS" },
      ],
    }),
    updateAdminSearchFilter: builder.mutation<
      SearchFilterOption,
      { optionId: string; changes: UpdateSearchFilterOption }
    >({
      query: ({ optionId, changes }) => ({
        url: `/admin/search-filters/${optionId}`,
        method: "PATCH",
        body: changes,
      }),
      invalidatesTags: (_result, _error, { optionId }) => [
        { type: "Admin", id: "SEARCH_FILTERS" },
        { type: "Admin", id: `SEARCH_FILTER_${optionId}` },
        { type: "Candidate", id: "FILTERS" },
      ],
    }),
    getAdminKybSubmissions: builder.query<KybSubmissionsPage, KybListParams | void>({
      query: (params) => ({ url: "/admin/kyb/submissions", params: params ?? undefined }),
      providesTags: ["Admin"],
    }),
    getAdminKybApprovalMode: builder.query<{ review_required: boolean }, void>({
      query: () => "/admin/settings/kyb-approval",
      providesTags: ["Admin"],
    }),
    setAdminKybApprovalMode: builder.mutation<{ review_required: boolean }, boolean>({
      query: (review_required) => ({
        url: "/admin/settings/kyb-approval",
        method: "PUT",
        body: { review_required },
      }),
      invalidatesTags: ["Admin"],
    }),
    getAdminKybSubmission: builder.query<KybSubmission, string>({
      query: (submissionId) => `/admin/kyb/submissions/${submissionId}`,
      providesTags: ["Admin"],
    }),
    decideAdminKyb: builder.mutation<KybSubmission, { submissionId: string; decision: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "MORE_INFO_REQUIRED"; reason?: string; flags?: KybReviewFlag[] }>({
      query: ({ submissionId, ...body }) => ({ url: `/admin/kyb/submissions/${submissionId}/decision`, method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    getAdminIntegritySignals: builder.query<CursorPage<IntegritySignalRow>, IntegrityListParams | void>({
      query: (params) => ({ url: "/admin/integrity/signals", params: params ?? undefined }),
      providesTags: ["Admin"],
    }),
    getAdminIntegritySignal: builder.query<IntegritySignalDetail, string>({
      query: (signalId) => `/admin/integrity/signals/${signalId}`,
      providesTags: ["Admin"],
    }),
    resolveAdminIntegritySignal: builder.mutation<IntegritySignalDetail, { signalId: string; outcome: "CLEARED" | "CONFIRMED"; note?: string }>({
      query: ({ signalId, ...body }) => ({ url: `/admin/integrity/signals/${signalId}/resolve`, method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    getAdminTenants: builder.query<CursorPage<TenantRow>, TenantListParams | void>({
      query: (params) => ({ url: "/admin/tenants", params: params ?? undefined }),
      providesTags: ["Admin"],
    }),
    getAdminCandidates: builder.query<CursorPage<AdminCandidateRow>, AdminCandidateListParams | void>({
      query: (params) => ({ url: "/admin/candidates", params: params ?? undefined }),
      providesTags: ["Admin"],
    }),
    getAdminDiscountCodes: builder.query<DiscountCodesPage, AdminListParams & { audience?: DiscountAudience }>({
      query: (params) => ({ url: "/admin/discount-codes", params }),
      providesTags: [{ type: "Admin", id: "DISCOUNT_CODES" }],
    }),
    getAdminDiscountCode: builder.query<DiscountCode, string>({
      query: (id) => `/admin/discount-codes/${id}`,
      providesTags: (_result, _error, id) => [{ type: "Admin", id: `DISCOUNT_CODE_${id}` }],
    }),
    createAdminDiscountCode: builder.mutation<DiscountCode, CreateDiscountCodeRequest>({
      query: (body) => ({ url: "/admin/discount-codes", method: "POST", body }),
      invalidatesTags: [{ type: "Admin", id: "DISCOUNT_CODES" }],
    }),
    disableAdminDiscountCode: builder.mutation<DiscountCode, string>({
      query: (id) => ({ url: `/admin/discount-codes/${id}/disable`, method: "POST" }),
      invalidatesTags: (_result, _error, id) => [
        { type: "Admin", id: "DISCOUNT_CODES" },
        { type: "Admin", id: `DISCOUNT_CODE_${id}` },
      ],
    }),
    getAdminDiscountRedemptions: builder.query<CursorPage<DiscountRedemption>, AdminListParams & { id: string }>({
      query: ({ id, ...params }) => ({ url: `/admin/discount-codes/${id}/redemptions`, params }),
      providesTags: (_result, _error, { id }) => [{ type: "Admin", id: `DISCOUNT_REDEMPTIONS_${id}` }],
    }),
    getAdminAccountForms: builder.query<AdminAccountFormsResponse, void>({
      query: () => "/admin/accounts/forms",
      providesTags: [{ type: "Admin", id: "ACCOUNT_FORMS" }],
    }),
    inviteAdminAccount: builder.mutation<{ invitation: "SENT" }, InviteAdminAccountRequest>({
      query: (body) => ({ url: "/admin/accounts/invitations", method: "POST", body }),
    }),
    provisionAdminCandidate: builder.mutation<ProvisionedAccountResponse, ProvisionCandidateRequest>({
      query: (body) => ({ url: "/admin/accounts/candidates", method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    provisionAdminEmployer: builder.mutation<ProvisionedAccountResponse, ProvisionEmployerRequest>({
      query: (body) => ({ url: "/admin/accounts/employers", method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    provisionAdminCollege: builder.mutation<ProvisionedAccountResponse, ProvisionCollegeRequest>({
      query: (body) => ({ url: "/admin/accounts/colleges", method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    suspendAdminTenant: builder.mutation<SuspensionResponse, { tenantId: string; reason: string }>({
      query: ({ tenantId, reason }) => ({ url: `/admin/tenants/${tenantId}/suspend`, method: "POST", body: { reason } }),
      invalidatesTags: ["Admin"],
    }),
    reinstateAdminTenant: builder.mutation<SuspensionResponse, string>({
      query: (tenantId) => ({ url: `/admin/tenants/${tenantId}/reinstate`, method: "POST" }),
      invalidatesTags: ["Admin"],
    }),
    getAdminTenantSuspensions: builder.query<SuspensionResponse[], string>({
      query: (tenantId) => `/admin/tenants/${tenantId}/suspensions`,
      providesTags: ["Admin"],
    }),
    allocateAdminCollegeSeats: builder.mutation<{ allocated: number; used: number; filled: number }, { tenantId: string; seats: number }>({
      query: ({ tenantId, seats }) => ({ url: `/admin/colleges/${tenantId}/seats`, method: "PUT", body: { seats } }),
      invalidatesTags: ["Admin"],
    }),
    getAdminCandidate: builder.query<CandidateDrilldown, string>({
      query: (userId) => `/admin/candidates/${userId}`,
      providesTags: ["Admin"],
    }),
    getAdminCandidateOnboarding: builder.query<CandidateOnboarding, string>({ query: (id) => `/admin/candidates/${id}/onboarding` }),
    getAdminCandidateResume: builder.query<CandidateResume, string>({ query: (id) => `/admin/candidates/${id}/resume` }),
    getAdminCandidateScoreTimeline: builder.query<ScoreTimeline, string>({ query: (id) => `/admin/candidates/${id}/score-timeline` }),
    getAdminCandidateInterviews: builder.query<InterviewRow[], string>({ query: (id) => `/admin/candidates/${id}/interviews` }),
    getAdminCandidateRecordings: builder.query<RecordingRow[], { id: string; sessionId: string }>({ query: ({ id, sessionId }) => `/admin/candidates/${id}/interviews/${sessionId}/recordings` }),
    getAdminCandidateCourses: builder.query<CourseStatus[], string>({ query: (id) => `/admin/candidates/${id}/courses` }),
    getAdminCandidateApplications: builder.query<CandidateApplications, string>({ query: (id) => `/admin/candidates/${id}/applications` }),
    getAdminEmployer: builder.query<EmployerDrilldown, string>({
      query: (tenantId) => `/admin/employers/${tenantId}`,
      providesTags: ["Admin"],
    }),
    getAdminCollege: builder.query<CollegeDrilldown, string>({
      query: (tenantId) => `/admin/colleges/${tenantId}`,
      providesTags: ["Admin"],
    }),
    suppressAdminNotifications: builder.mutation<{ user_id: string; channel: string; created: boolean }, { userId: string; channel: "SMS" | "EMAIL" | "PUSH" | "ALL"; reason: "BOUNCED" | "COMPLAINED" | "SUPPORT_REQUEST" }>({
      query: ({ userId, ...body }) => ({ url: `/admin/users/${userId}/notification-suppressions`, method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    getAdminDisputes: builder.query<CursorPage<DisputeRow>, DisputeListParams | void>({
      query: (params) => ({ url: "/admin/disputes", params: params ?? undefined }),
      providesTags: ["Admin"],
    }),
    getAdminDispute: builder.query<DisputeDetail, string>({
      query: (disputeId) => `/admin/disputes/${disputeId}`,
      providesTags: ["Admin"],
    }),
    assignAdminDispute: builder.mutation<DisputeDetail, string>({
      query: (disputeId) => ({ url: `/admin/disputes/${disputeId}/assign`, method: "POST" }),
      invalidatesTags: ["Admin"],
    }),
    resolveAdminDispute: builder.mutation<DisputeDetail, { disputeId: string; outcome: "RESOLVED" | "REJECTED"; resolution: string }>({
      query: ({ disputeId, ...body }) => ({ url: `/admin/disputes/${disputeId}/resolve`, method: "POST", body }),
      invalidatesTags: ["Admin"],
    }),
    getAdminAuditEvents: builder.query<CursorPage<AuditEventRow>, AdminListParams & { actor_id?: string; action?: string; target_type?: string; target_id?: string; tenant_id?: string; from?: string; to?: string }>({
      query: (params) => ({ url: "/admin/audit-events", params }),
      providesTags: ["Admin"],
    }),
  }),
});

export const {
  useGetAdminIdentityQuery,
  useLazyGetAdminIdentityQuery,
  useGetAdminDashboardQuery,
  useGetAdminCoursesQuery,
  useCreateAdminCourseModuleMutation,
  useUpdateAdminCourseModuleMutation,
  useCreateAdminCourseLessonMutation,
  useUpdateAdminCourseLessonMutation,
  useIssueAdminLessonUploadMutation,
  useConfirmAdminLessonUploadMutation,
  usePublishAdminCourseMutation,
  useGetAdminDiscountCodesQuery,
  useGetAdminDiscountCodeQuery,
  useCreateAdminDiscountCodeMutation,
  useDisableAdminDiscountCodeMutation,
  useGetAdminDiscountRedemptionsQuery,
  useGetAdminSearchFiltersQuery,
  useGetAdminSearchFilterQuery,
  useCreateAdminSearchFilterMutation,
  useImportAdminSearchFiltersMutation,
  useUpdateAdminSearchFilterMutation,
  useGetAdminKybApprovalModeQuery,
  useGetAdminKybSubmissionsQuery,
  useSetAdminKybApprovalModeMutation,
  useGetAdminKybSubmissionQuery,
  useDecideAdminKybMutation,
  useGetAdminIntegritySignalsQuery,
  useGetAdminIntegritySignalQuery,
  useResolveAdminIntegritySignalMutation,
  useGetAdminTenantsQuery,
  useGetAdminCandidatesQuery,
  useGetAdminAccountFormsQuery,
  useInviteAdminAccountMutation,
  useProvisionAdminCandidateMutation,
  useProvisionAdminEmployerMutation,
  useProvisionAdminCollegeMutation,
  useSuspendAdminTenantMutation,
  useReinstateAdminTenantMutation,
  useGetAdminTenantSuspensionsQuery,
  useAllocateAdminCollegeSeatsMutation,
  useGetAdminCandidateQuery,
  useGetAdminCandidateOnboardingQuery,
  useGetAdminCandidateResumeQuery,
  useGetAdminCandidateScoreTimelineQuery,
  useGetAdminCandidateInterviewsQuery,
  useGetAdminCandidateRecordingsQuery,
  useGetAdminCandidateCoursesQuery,
  useGetAdminCandidateApplicationsQuery,
  useGetAdminEmployerQuery,
  useGetAdminCollegeQuery,
  useSuppressAdminNotificationsMutation,
  useGetAdminDisputesQuery,
  useGetAdminDisputeQuery,
  useAssignAdminDisputeMutation,
  useResolveAdminDisputeMutation,
  useGetAdminAuditEventsQuery,
  useLazyGetAdminAuditEventsQuery,
} = adminApi;
