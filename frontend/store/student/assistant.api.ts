import type { JobApplication, JobListing, RecommendedJob } from "@/features/student/types";
import { baseApi } from "@/store/api/base-api";
import { mapApplication, mapJob, type ApplicationResponse, type JobResponse } from "./student.api";

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantRequest {
  message: string;
  history: AssistantTurn[];
  state?: string;
}

export interface AssistantReply {
  reply: string;
  action: "SEARCH" | "MATCH_MY_PROFILE" | "SIMILAR_TO_APPLIED" | "MORE_RESULTS" | "SHOW_JOB" | "APPLY" | "MY_APPLICATIONS" | "REPLY";
  jobs: RecommendedJob[];
  hasMore: boolean;
  job: JobListing | null;
  apply: { jobId: string; jobTitle: string; employerName: string | null; inApp: boolean } | null;
  applications: JobApplication[];
  suggestions: string[];
  state: string;
}

interface AssistantResponse {
  reply: string;
  action: AssistantReply["action"];
  jobs: Array<JobResponse & { matched_skills: string[] }>;
  has_more: boolean;
  job: JobResponse | null;
  apply: { job_id: string; job_title: string; employer_name: string | null; in_app: boolean } | null;
  applications: ApplicationResponse[];
  suggestions: string[];
  state: string;
}

export const assistantApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    sendAssistantMessage: builder.mutation<AssistantReply, AssistantRequest>({
      query: (body) => ({
        url: "/candidate/assistant/messages",
        method: "POST",
        body,
      }),
      transformResponse: (response: AssistantResponse): AssistantReply => ({
        reply: response.reply,
        action: response.action,
        jobs: response.jobs.map((job) => ({ ...mapJob(job), matchedSkills: job.matched_skills })),
        hasMore: response.has_more,
        job: response.job ? mapJob(response.job) : null,
        apply: response.apply ? {
          jobId: response.apply.job_id,
          jobTitle: response.apply.job_title,
          employerName: response.apply.employer_name,
          inApp: response.apply.in_app,
        } : null,
        applications: response.applications.map(mapApplication),
        suggestions: response.suggestions,
        state: response.state,
      }),
    }),
  }),
});

export const { useSendAssistantMessageMutation } = assistantApi;
