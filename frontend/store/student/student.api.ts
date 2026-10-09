import { baseApi } from "@/store/api/base-api";
import {
  candidateDetailsWithDefaults,
  type CandidateJobDetails,
} from "@/features/jobs/job-details";
import type {
  CollegeLink,
  Course,
  InterviewOffer,
  JobApplication,
  JobListing,
  Page,
  ProfileView,
  QuestionnaireView,
  RecommendedJobs,
  ScoreScale,
  StreakCalendar,
  StreakCalendarDayStatus,
  StudentProfile,
  StudentScore,
  StudentStreak,
  StudentStreakCheckIn,
} from "@/features/student/types";

interface StudentScoreResponse {
  status: StudentScore["status"];
  value: number | null;
  band: string | null;
  computed_at: string | null;
}

interface ScoreScaleResponse {
  lowest: number;
  highest: number;
  bands: Array<{ band: string; lowest: number; highest: number }>;
}

interface StudentProfileResponse {
  full_name: string | null;
  city: string | null;
  state_code: string | null;
  updated_at: string | null;
}

interface StreakMilestoneResponse {
  days: number;
  points: number;
}

interface StreakResponse {
  status: StudentStreak["status"];
  current_streak: number;
  longest_streak: number;
  last_active_on: string | null;
  today: string;
  points_balance: number;
  next_milestone: StreakMilestoneResponse | null;
  milestones: StreakMilestoneResponse[];
  break_penalty: number;
  rules_version: string;
}

interface StreakPointsChangeResponse {
  kind: StudentStreakCheckIn["changes"][number]["kind"];
  points: number;
  balance_after: number;
  streak_length: number;
  milestone_days: number | null;
  activity_on: string;
  created_at: string | null;
}

interface StreakCheckInResponse {
  counted: boolean;
  streak: StreakResponse;
  changes: StreakPointsChangeResponse[];
}

/** `GET /candidate/profile/views`: one entry per organisation, latest first. */
interface ProfileViewResponse {
  employer_name: string;
  last_viewed_at: string;
}

interface StreakCalendarDayResponse {
  date: string;
  status: StreakCalendarDayStatus;
  milestone_days: number | null;
}

interface StreakCalendarResponse {
  start: string;
  end: string;
  today: string;
  days: StreakCalendarDayResponse[];
  active_days: number;
  missed_days: number;
  longest_run: number;
}

interface JobResponse {
  id: string;
  title: string;
  employer_name: string | null;
  description?: string;
  details?: Partial<CandidateJobDetails>;
  skills: string[];
  location: string | null;
  work_mode: JobListing["workMode"];
  experience_min_months: number | null;
  salary_min_minor: number;
  salary_max_minor: number;
  salary_disclosed?: boolean;
  can_apply_externally?: boolean;
  published_at: string;
  eligibility: JobListing["eligibility"];
}

interface RecommendedJobsResponse {
  items: Array<JobResponse & { matched_skills: string[] }>;
  has_basis: boolean;
}

interface ApplicationResponse {
  id: string;
  job_id: string;
  job_title: string | null;
  employer_name: string | null;
  stage: JobApplication["stage"];
  hire_confirmation: JobApplication["hireConfirmation"];
  interview: {
    interview_at: string;
    meeting_url: string;
  } | null;
  created_at: string;
  updated_at: string;
  history?: Array<{
    kind: NonNullable<JobApplication["history"]>[number]["kind"];
    from_stage: JobApplication["stage"] | null;
    to_stage: JobApplication["stage"];
    by: NonNullable<JobApplication["history"]>[number]["by"];
    occurred_at: string;
  }>;
}

interface ApiPage<T> {
  items: T[];
  next_cursor: string | null;
  total: number | null;
}

interface QuestionnaireResponse {
  bank_version: string;
  sections: Array<{
    code: string;
    questions: Array<{
      code: string;
      key: string;
      prompt: string;
      type: QuestionnaireView["sections"][number]["questions"][number]["type"];
      options: Array<{ code: string; label: string }>;
      required: boolean;
      help_text: string | null;
    }>;
  }>;
  answers: Record<string, unknown>;
  submitted: boolean;
  submitted_at: string | null;
  updated_at: string | null;
}

interface InterviewOfferResponse {
  on_sale: boolean;
  price_minor: number | null;
  currency: string;
  will_increase_score: boolean;
  requires_acknowledgement: boolean;
  device_check_passed: boolean;
  device_check_valid_until: string | null;
  sessions_available: number;
  open_session_id: string | null;
}

interface CourseResponse {
  id: string;
  code: string;
  title: string;
  price_minor: number;
  currency: string;
  purchased: boolean;
  completed: boolean;
  locked: boolean;
  lessons_total: number;
  lessons_completed: number;
  percent_complete: number;
}

interface CollegeLinkResponse {
  college_id: string;
  college_name: string | null;
  scope: CollegeLink["scope"];
  granted_via: CollegeLink["grantedVia"];
  granted_at: string;
  revoked_at: string | null;
  seat_held: boolean;
}

interface CollegeConsentTermsResponse {
  consent_version: string;
  scope: "ROSTER" | "INDIVIDUAL";
  key: string;
  text: string;
}

function mapProfile(response: StudentProfileResponse): StudentProfile {
  return {
    fullName: response.full_name,
    city: response.city,
    stateCode: response.state_code,
    updatedAt: response.updated_at,
  };
}

function mapScore(response: StudentScoreResponse): StudentScore {
  return {
    status: response.status,
    value: response.value,
    band: response.band,
    computedAt: response.computed_at,
  };
}

function mapStreak(response: StreakResponse): StudentStreak {
  return {
    status: response.status,
    currentStreak: response.current_streak,
    longestStreak: response.longest_streak,
    lastActiveOn: response.last_active_on,
    today: response.today,
    pointsBalance: response.points_balance,
    nextMilestone: response.next_milestone,
    milestones: response.milestones,
    breakPenalty: response.break_penalty,
    rulesVersion: response.rules_version,
  };
}

function mapStreakPointsChange(
  change: StreakPointsChangeResponse,
): StudentStreakCheckIn["changes"][number] {
  return {
    kind: change.kind,
    points: change.points,
    balanceAfter: change.balance_after,
    streakLength: change.streak_length,
    milestoneDays: change.milestone_days,
    activityOn: change.activity_on,
    createdAt: change.created_at,
  };
}

function mapJob(response: JobResponse): JobListing {
  return {
    id: response.id,
    title: response.title,
    employerName: response.employer_name,
    description: response.description,
    details: response.details
      ? candidateDetailsWithDefaults(response.details)
      : undefined,
    skills: response.skills,
    location: response.location,
    workMode: response.work_mode,
    experienceMinMonths: response.experience_min_months,
    salaryMinMinor: response.salary_min_minor,
    salaryMaxMinor: response.salary_max_minor,
    salaryDisclosed: response.salary_disclosed ?? true,
    canApplyExternally: response.can_apply_externally ?? false,
    publishedAt: response.published_at,
    eligibility: response.eligibility,
  };
}

function mapRecommendedJobs(response: RecommendedJobsResponse): RecommendedJobs {
  return {
    items: response.items.map((job) => ({
      ...mapJob(job),
      matchedSkills: job.matched_skills,
    })),
    hasBasis: response.has_basis,
  };
}

function mapApplication(response: ApplicationResponse): JobApplication {
  return {
    id: response.id,
    jobId: response.job_id,
    jobTitle: response.job_title,
    employerName: response.employer_name,
    stage: response.stage,
    hireConfirmation: response.hire_confirmation,
    interview: response.interview
      ? {
          interviewAt: response.interview.interview_at,
          meetingUrl: response.interview.meeting_url,
        }
      : null,
    createdAt: response.created_at,
    updatedAt: response.updated_at,
    history: response.history?.map((item) => ({
      kind: item.kind,
      fromStage: item.from_stage,
      toStage: item.to_stage,
      by: item.by,
      occurredAt: item.occurred_at,
    })),
  };
}

function mapQuestionnaire(
  response: QuestionnaireResponse,
): QuestionnaireView {
  return {
    bankVersion: response.bank_version,
    sections: response.sections.map((section) => ({
      code: section.code,
      questions: section.questions.map((question) => ({
        code: question.code,
        key: question.key,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
        required: question.required,
        helpText: question.help_text,
      })),
    })),
    answers: response.answers,
    submitted: response.submitted,
    submittedAt: response.submitted_at,
    updatedAt: response.updated_at,
  };
}

export const studentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getStudentProfile: builder.query<StudentProfile, void>({
      query: () => "/candidate/profile",
      transformResponse: mapProfile,
      providesTags: [{ type: "Student", id: "PROFILE" }],
    }),
    updateStudentName: builder.mutation<StudentProfile, string>({
      query: (fullName) => ({
        url: "/candidate/profile/name",
        method: "PUT",
        body: { full_name: fullName },
      }),
      transformResponse: mapProfile,
      invalidatesTags: [{ type: "Student", id: "PROFILE" }],
    }),
    updateStudentLocation: builder.mutation<
      StudentProfile,
      { city: string | null; stateCode: string | null }
    >({
      query: ({ city, stateCode }) => ({
        url: "/candidate/profile/location",
        method: "PUT",
        body: { city, state_code: stateCode },
      }),
      transformResponse: mapProfile,
      invalidatesTags: [{ type: "Student", id: "PROFILE" }],
    }),
    getStudentProfileViews: builder.query<
      Page<ProfileView>,
      { cursor?: string; limit?: number } | void
    >({
      query: (args) => ({
        url: "/candidate/profile/views",
        params: args
          ? { cursor: args.cursor, limit: args.limit }
          : undefined,
      }),
      transformResponse: (
        response: ApiPage<ProfileViewResponse>,
      ): Page<ProfileView> => ({
        items: response.items.map((view) => ({
          employerName: view.employer_name,
          lastViewedAt: view.last_viewed_at,
        })),
        nextCursor: response.next_cursor,
        total: response.total,
      }),
      providesTags: [{ type: "Student", id: "PROFILE_VIEWS" }],
    }),
    getStudentScore: builder.query<StudentScore, void>({
      query: () => "/candidate/score/me",
      transformResponse: mapScore,
      providesTags: [{ type: "Student", id: "SCORE" }],
    }),
    getStudentScoreScale: builder.query<ScoreScale, void>({
      query: () => "/candidate/score/scale",
      transformResponse: (response: ScoreScaleResponse): ScoreScale => ({
        lowest: response.lowest,
        highest: response.highest,
        bands: [...response.bands].sort((a, b) => a.lowest - b.lowest),
      }),
      providesTags: [{ type: "Student", id: "SCORE_SCALE" }],
    }),
    getStudentStreakSession: builder.query<StudentStreak, void>({
      query: () => ({
        url: "/candidate/streak/me/check-in",
        method: "POST",
      }),
      transformResponse: (response: StreakCheckInResponse) =>
        mapStreak(response.streak),
      providesTags: [{ type: "Student", id: "STREAK_SESSION" }],
    }),
    getStudentStreakPoints: builder.query<
      StudentStreakCheckIn["changes"],
      number | void
    >({
      query: (limit) => ({
        url: "/candidate/streak/me/points",
        params: { limit: limit ?? 200 },
      }),
      transformResponse: (response: StreakPointsChangeResponse[]) =>
        response.map(mapStreakPointsChange),
      providesTags: [{ type: "Student", id: "STREAK_POINTS" }],
    }),
    getStudentStreakCalendar: builder.query<
      StreakCalendar,
      {
        period?: "week" | "month" | "year";
        /** The server's IST day the period is around. Never the browser's. */
        date?: string;
        /** With `to`, an explicit range instead of a period (the year view). */
        from?: string;
        to?: string;
      }
    >({
      query: (args) => ({
        url: "/candidate/streak/me/calendar",
        params: {
          period: args.period,
          date: args.date,
          from: args.from,
          to: args.to,
        },
      }),
      transformResponse: (response: StreakCalendarResponse): StreakCalendar => ({
        start: response.start,
        end: response.end,
        today: response.today,
        days: response.days.map((day) => ({
          date: day.date,
          status: day.status,
          milestoneDays: day.milestone_days,
        })),
        activeDays: response.active_days,
        missedDays: response.missed_days,
        longestRun: response.longest_run,
      }),
      providesTags: [{ type: "Student", id: "STREAK_CALENDAR" }],
    }),
    getStudentJobs: builder.query<
      Page<JobListing>,
      {
        q?: string;
        location?: string;
        workMode?: string;
        skill?: string;
        minSalaryMinor?: number;
        eligibleOnly?: boolean;
        cursor?: string;
        limit?: number;
      } | void
    >({
      query: (args) => ({
        url: "/candidate/jobs",
        params: args
          ? {
              q: args.q || undefined,
              location: args.location || undefined,
              work_mode: args.workMode || undefined,
              skill: args.skill || undefined,
              min_salary_minor: args.minSalaryMinor,
              eligible_only: args.eligibleOnly,
              cursor: args.cursor,
              limit: args.limit,
            }
          : undefined,
      }),
      transformResponse: (response: ApiPage<JobResponse>) => ({
        items: response.items.map(mapJob),
        nextCursor: response.next_cursor,
        total: response.total,
      }),
      providesTags: [{ type: "Job", id: "STUDENT_LIST" }],
    }),
    getJobsSimilarToApplied: builder.query<RecommendedJobs, { limit: number; eligibleOnly?: boolean }>({
      query: ({ limit, eligibleOnly }) => ({
        url: "/candidate/recommended-jobs/similar-to-applied",
        params: { limit, eligible_only: eligibleOnly },
      }),
      transformResponse: mapRecommendedJobs,
      providesTags: [
        { type: "Job", id: "RECOMMENDED_SIMILAR" },
        { type: "Application", id: "STUDENT_LIST" },
      ],
    }),
    getJobsMatchingProfile: builder.query<RecommendedJobs, { limit: number; eligibleOnly?: boolean }>({
      query: ({ limit, eligibleOnly }) => ({
        url: "/candidate/recommended-jobs/matching-profile",
        params: { limit, eligible_only: eligibleOnly },
      }),
      transformResponse: mapRecommendedJobs,
      providesTags: [
        { type: "Job", id: "RECOMMENDED_PROFILE" },
        { type: "Student", id: "CAREER" },
        { type: "Application", id: "STUDENT_LIST" },
      ],
    }),
    getStudentJob: builder.query<JobListing, string>({
      query: (jobId) => `/candidate/jobs/${jobId}`,
      transformResponse: mapJob,
      providesTags: (_result, _error, jobId) => [
        { type: "Job", id: jobId },
      ],
    }),
    getStudentApplications: builder.query<
      Page<JobApplication>,
      { cursor?: string; limit?: number; status?: "ACTIVE" | "CLOSED" } | void
    >({
      query: (args) => ({
        url: "/candidate/applications",
        params: args ?? undefined,
      }),
      transformResponse: (response: ApiPage<ApplicationResponse>) => ({
        items: response.items.map(mapApplication),
        nextCursor: response.next_cursor,
        total: response.total,
      }),
      providesTags: [{ type: "Application", id: "STUDENT_LIST" }],
    }),
    getStudentApplication: builder.query<JobApplication, string>({
      query: (applicationId) =>
        `/candidate/applications/${applicationId}`,
      transformResponse: mapApplication,
      providesTags: (_result, _error, applicationId) => [
        { type: "Application", id: applicationId },
      ],
    }),
    applyToStudentJob: builder.mutation<JobApplication, string>({
      query: (jobId) => ({
        url: "/candidate/applications",
        method: "POST",
        body: { job_id: jobId },
      }),
      transformResponse: mapApplication,
      invalidatesTags: [{ type: "Application", id: "STUDENT_LIST" }],
    }),
    withdrawStudentApplication: builder.mutation<JobApplication, string>({
      query: (applicationId) => ({
        url: `/candidate/applications/${applicationId}/withdraw`,
        method: "POST",
      }),
      transformResponse: mapApplication,
      invalidatesTags: (_result, _error, applicationId) => [
        { type: "Application", id: applicationId },
        { type: "Application", id: "STUDENT_LIST" },
      ],
    }),
    confirmStudentHire: builder.mutation<JobApplication, string>({
      query: (applicationId) => ({
        url: `/candidate/applications/${applicationId}/hire/confirm`,
        method: "POST",
      }),
      transformResponse: mapApplication,
      invalidatesTags: (_result, _error, applicationId) => [
        { type: "Application", id: applicationId },
        { type: "Application", id: "STUDENT_LIST" },
      ],
    }),
    disputeStudentHire: builder.mutation<JobApplication, string>({
      query: (applicationId) => ({
        url: `/candidate/applications/${applicationId}/hire/dispute`,
        method: "POST",
      }),
      transformResponse: mapApplication,
      invalidatesTags: (_result, _error, applicationId) => [
        { type: "Application", id: applicationId },
        { type: "Application", id: "STUDENT_LIST" },
      ],
    }),
    getQuestionnaire: builder.query<QuestionnaireView, void>({
      query: () => "/candidate/questionnaire",
      transformResponse: mapQuestionnaire,
      providesTags: [{ type: "Student", id: "QUESTIONNAIRE" }],
    }),
    saveQuestionnaireAnswers: builder.mutation<
      QuestionnaireView,
      {
        answers: Record<string, unknown>;
        __suppressSuccessFeedback?: boolean;
      }
    >({
      query: (payload) => ({
        url: "/candidate/questionnaire/answers",
        method: "PUT",
        body: { answers: payload.answers },
      }),
      transformResponse: mapQuestionnaire,
      invalidatesTags: [{ type: "Student", id: "QUESTIONNAIRE" }],
    }),
    submitQuestionnaire: builder.mutation<QuestionnaireView, void>({
      query: () => ({
        url: "/candidate/questionnaire/submit",
        method: "POST",
      }),
      transformResponse: mapQuestionnaire,
      invalidatesTags: [{ type: "Student", id: "QUESTIONNAIRE" }],
    }),
    getInterviewOffer: builder.query<InterviewOffer, void>({
      query: () => "/candidate/interview/offer",
      transformResponse: (response: InterviewOfferResponse) => ({
        onSale: response.on_sale,
        priceMinor: response.price_minor,
        currency: response.currency,
        willIncreaseScore: response.will_increase_score,
        requiresAcknowledgement: response.requires_acknowledgement,
        deviceCheckPassed: response.device_check_passed,
        deviceCheckValidUntil: response.device_check_valid_until,
        sessionsAvailable: response.sessions_available,
        openSessionId: response.open_session_id,
      }),
      providesTags: [{ type: "Student", id: "INTERVIEW_OFFER" }],
    }),
    getStudentCourses: builder.query<Course[], void>({
      query: () => "/candidate/courses",
      transformResponse: (response: CourseResponse[]) =>
        response.map((course) => ({
          id: course.id,
          code: course.code,
          title: course.title,
          priceMinor: course.price_minor,
          currency: course.currency,
          purchased: course.purchased,
          completed: course.completed,
          locked: course.locked,
          lessonsTotal: course.lessons_total,
          lessonsCompleted: course.lessons_completed,
          percentComplete: course.percent_complete,
        })),
      providesTags: [{ type: "Student", id: "COURSES" }],
    }),
    getStudentCollegeLinks: builder.query<CollegeLink[], void>({
      query: () => "/candidate/colleges",
      transformResponse: (response: CollegeLinkResponse[]) =>
        response.map((link) => ({
          collegeId: link.college_id,
          collegeName: link.college_name,
          scope: link.scope,
          grantedVia: link.granted_via,
          grantedAt: link.granted_at,
          revokedAt: link.revoked_at,
          seatHeld: link.seat_held,
        })),
      providesTags: [{ type: "Student", id: "COLLEGES" }],
    }),
    getCollegeConsentTerms: builder.query<CollegeConsentTermsResponse, "ROSTER" | "INDIVIDUAL">({
      query: (scope) => ({ url: "/candidate/colleges/consent-terms", params: { scope } }),
    }),
    linkStudentCollegeByReferral: builder.mutation<CollegeLink, { code: string; consentVersion: string }>({
      query: ({ code, consentVersion }) => ({
        url: "/candidate/colleges/link",
        method: "POST",
        body: { code, consent_version: consentVersion },
      }),
      transformResponse: (link: CollegeLinkResponse) => ({
        collegeId: link.college_id,
        collegeName: link.college_name,
        scope: link.scope,
        grantedVia: link.granted_via,
        grantedAt: link.granted_at,
        revokedAt: link.revoked_at,
        seatHeld: link.seat_held,
      }),
      invalidatesTags: [{ type: "Student", id: "COLLEGES" }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetStudentProfileQuery,
  useUpdateStudentNameMutation,
  useUpdateStudentLocationMutation,
  useGetStudentScoreQuery,
  useGetStudentScoreScaleQuery,
  useGetStudentStreakSessionQuery,
  useGetStudentStreakPointsQuery,
  useGetStudentStreakCalendarQuery,
  useGetStudentProfileViewsQuery,
  useGetStudentJobsQuery,
  useGetJobsSimilarToAppliedQuery,
  useGetJobsMatchingProfileQuery,
  useLazyGetStudentJobsQuery,
  useGetStudentJobQuery,
  useGetStudentApplicationsQuery,
  useLazyGetStudentApplicationsQuery,
  useGetStudentApplicationQuery,
  useApplyToStudentJobMutation,
  useWithdrawStudentApplicationMutation,
  useConfirmStudentHireMutation,
  useDisputeStudentHireMutation,
  useGetQuestionnaireQuery,
  useSaveQuestionnaireAnswersMutation,
  useSubmitQuestionnaireMutation,
  useGetInterviewOfferQuery,
  useGetStudentCoursesQuery,
  useGetStudentCollegeLinksQuery,
  useGetCollegeConsentTermsQuery,
  useLinkStudentCollegeByReferralMutation,
} = studentApi;
