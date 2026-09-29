import { baseApi } from "./base-api";

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
};

export type KybSubmissionsPage = CursorPage<KybSubmissionRow> & {
  review_required: boolean;
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
  }>;
  submitted_at: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  auto_approved: boolean;
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
 * GET /api/v1/admin/dashboard — everything the operations dashboard needs in
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
    getAdminKybSubmission: builder.query<KybSubmission, string>({
      query: (submissionId) => `/admin/kyb/submissions/${submissionId}`,
      providesTags: ["Admin"],
    }),
    decideAdminKyb: builder.mutation<KybSubmission, { submissionId: string; decision: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "MORE_INFO_REQUIRED"; reason?: string }>({
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
  useGetAdminSearchFiltersQuery,
  useGetAdminSearchFilterQuery,
  useCreateAdminSearchFilterMutation,
  useImportAdminSearchFiltersMutation,
  useUpdateAdminSearchFilterMutation,
  useGetAdminKybSubmissionsQuery,
  useGetAdminKybSubmissionQuery,
  useDecideAdminKybMutation,
  useGetAdminIntegritySignalsQuery,
  useGetAdminIntegritySignalQuery,
  useResolveAdminIntegritySignalMutation,
  useGetAdminTenantsQuery,
  useGetAdminCandidatesQuery,
  useSuspendAdminTenantMutation,
  useReinstateAdminTenantMutation,
  useGetAdminTenantSuspensionsQuery,
  useAllocateAdminCollegeSeatsMutation,
  useGetAdminCandidateQuery,
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