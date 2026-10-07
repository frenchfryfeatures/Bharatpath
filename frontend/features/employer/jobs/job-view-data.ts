import {
  candidateView,
  withJobDetailDefaults,
  type JobDescriptionData,
} from "@/features/jobs";

import { detailsForApi, jobBody } from "./create/job-form-values";
import type { CreateJobFormValues } from "./create/types";
import type { EmployerJobApiResponse } from "./types";

/** A saved job as the description view draws it. */
export function jobViewFromApi(
  job: EmployerJobApiResponse,
  employerName: string | null,
): JobDescriptionData {
  return {
    title: job.title,
    employerName,
    location: job.location,
    workMode: job.work_mode,
    experienceMinMonths: job.experience_min_months,
    salaryMinMinor: job.salary_min_minor,
    salaryMaxMinor: job.salary_max_minor,
    description: job.description,
    skills: job.skills,
    details: candidateView(withJobDetailDefaults(job.details)),
    postedAt: job.published_at,
  };
}

/**
 * The composer's unsaved state, drawn exactly as a candidate would see it --
 * the candidate's projection, so the preview never shows what they won't.
 */
export function jobViewFromForm(
  values: CreateJobFormValues,
  employerName: string | null,
): JobDescriptionData {
  const body = jobBody(values);
  return {
    title: body.title || "Untitled job",
    employerName,
    location: body.location,
    workMode: body.work_mode,
    experienceMinMonths: body.experience_min_months,
    salaryMinMinor: Number.isFinite(body.salary_min_minor) ? body.salary_min_minor : 0,
    salaryMaxMinor: Number.isFinite(body.salary_max_minor) ? body.salary_max_minor : 0,
    description: body.description,
    skills: body.skills,
    details: candidateView(detailsForApi(values)),
    postedAt: null,
  };
}
