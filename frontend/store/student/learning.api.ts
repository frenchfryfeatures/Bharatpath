import { baseApi } from "@/store/api/base-api";

export type CourseLesson = { id: string; title: string; description: string | null; media_kind: "YOUTUBE" | "UPLOAD"; media_url: string | null; position_seconds: number; duration_seconds: number; completed: boolean };
export type CourseDetail = {
  id: string; title: string; price_minor: number; currency: string; purchased: boolean; locked: boolean; completed: boolean; lessons_total: number; lessons_completed: number; percent_complete: number;
  modules: Array<{ id: string; title: string; lessons: CourseLesson[] }>;
};
export type LessonProgress = { lesson_id: string; position_seconds: number; completed: boolean; lessons_total: number; lessons_completed: number; percent_complete: number; course_completed: boolean };
export type PaymentCheckout = { payment_id: string; redirect_url: string | null; status: string; amount_minor: number; list_amount_minor: number | null; currency: string };
export type InterviewHistory = { id: string; session_number: number; state: string; created_at: string; completed_at: string | null; question_set_title: string; questions_asked: number; answers_stored: number; report_status: string };
export type InterviewSession = { id: string; state: string; questions_total: number; questions: Array<{ index: number; prompt: string; preparation_seconds: number; answer_seconds: number }>; answers: Array<{ question_index: number; upload_state: string }> };
export type InterviewQuestionAudio = { url: string; expires_in_seconds: number; mime: string };
export type InterviewReport = {
  session_id: string;
  status: "PENDING" | "READY" | "FAILED";
  failure_reason: string | null;
  evaluated_at: string | null;
  report_version: string | null;
  dimensions: Array<{ code: string; label: string; level: "STRONG" | "DEVELOPING" | "FOCUS_AREA"; what_good_looks_like: string }>;
  strengths: string[];
  focus_areas: string[];
  questions: Array<{ index: number; code: string; prompt: string; looking_for: string; transcript: string; spoken: boolean; comment: string | null }>;
};

export const learningApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCourseDetail: builder.query<CourseDetail, string>({ query: (id) => `/candidate/courses/${id}`, providesTags: ["Student"] }),
    checkoutCourse: builder.mutation<PaymentCheckout, string>({ query: (id) => ({ url: `/candidate/courses/${id}/checkout`, method: "POST" }) }),
    updateLessonProgress: builder.mutation<LessonProgress, { courseId: string; lessonId: string; positionSeconds: number }>({
      query: ({ courseId, lessonId, positionSeconds }) => ({ url: `/candidate/courses/${courseId}/lessons/${lessonId}/progress`, method: "POST", body: { position_seconds: positionSeconds } }),
      invalidatesTags: ["Student"],
    }),
    getInterviewHistory: builder.query<InterviewHistory[], void>({ query: () => "/candidate/interview/history", providesTags: ["Student"] }),
    getInterviewRecordings: builder.query<Array<{ question_index: number; prompt: string; url: string; transcript: string | null }>, string>({ query: (id) => `/candidate/interview/sessions/${id}/recordings` }),
    getInterviewReport: builder.query<InterviewReport, string>({ query: (id) => `/candidate/interview/sessions/${id}/report` }),
    getApplicationMessages: builder.query<Array<{ id: string; kind: string; body: string; scheduled_at: string | null; link: string | null; employer_name: string | null; created_at: string }>, string>({ query: (id) => `/candidate/applications/${id}/messages` }),
    checkoutInterview: builder.mutation<PaymentCheckout, { acknowledge_no_score_increase: boolean }>({ query: (body) => ({ url: "/candidate/interview/checkout", method: "POST", body }) }),
    checkInterviewDevice: builder.mutation<{ passed: boolean; failures: string[] }, { mic_ok: boolean; audio_out_ok: boolean; quiet_env_ok: boolean; network_kbps: number | null; storage_mb: number | null }>({ query: (body) => ({ url: "/candidate/interview/device-checks", method: "POST", body }), invalidatesTags: ["Student"] }),
    startInterview: builder.mutation<InterviewSession, void>({ query: () => ({ url: "/candidate/interview/sessions", method: "POST" }), invalidatesTags: ["Student"] }),
    getInterviewSession: builder.query<InterviewSession, string>({ query: (id) => `/candidate/interview/sessions/${id}`, providesTags: ["Student"] }),
    getInterviewUpload: builder.mutation<{ url: string; accepted_types: string[]; max_bytes: number; max_duration_ms: number }, { id: string; index: number }>({ query: ({ id, index }) => ({ url: `/candidate/interview/sessions/${id}/answers/${index}/upload`, method: "POST" }) }),
    completeInterviewAnswer: builder.mutation<unknown, { id: string; index: number; durationMs: number }>({ query: ({ id, index, durationMs }) => ({ url: `/candidate/interview/sessions/${id}/answers/${index}/complete`, method: "POST", body: { duration_ms: durationMs } }) }),
    getInterviewQuestionAudio: builder.query<InterviewQuestionAudio, { id: string; index: number }>({ query: ({ id, index }) => `/candidate/interview/sessions/${id}/questions/${index}/audio`, keepUnusedDataFor: 0 }),
    nextInterviewQuestion: builder.mutation<InterviewSession, string>({ query: (id) => ({ url: `/candidate/interview/sessions/${id}/next-question`, method: "POST" }), invalidatesTags: ["Student"] }),
    completeInterview: builder.mutation<InterviewSession, string>({ query: (id) => ({ url: `/candidate/interview/sessions/${id}/complete`, method: "POST" }), invalidatesTags: ["Student"] }),
  }),
});

export const { useGetCourseDetailQuery, useCheckoutCourseMutation, useUpdateLessonProgressMutation, useGetInterviewHistoryQuery, useGetInterviewRecordingsQuery, useGetInterviewReportQuery, useGetApplicationMessagesQuery, useCheckoutInterviewMutation, useCheckInterviewDeviceMutation, useStartInterviewMutation, useGetInterviewSessionQuery, useGetInterviewUploadMutation, useGetInterviewQuestionAudioQuery, useCompleteInterviewAnswerMutation, useNextInterviewQuestionMutation, useCompleteInterviewMutation } = learningApi;
