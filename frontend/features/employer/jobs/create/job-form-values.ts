import type { EmployerJobApiResponse } from "@/features/employer/jobs/types";

import { thresholdFromApi } from "./threshold";
import type { CreateJobFormValues } from "./types";

export function mapApiJobToFormValues(
  job: EmployerJobApiResponse,
): CreateJobFormValues {
  return {
    title: job.title,
    employmentType: "Full time",
    location: job.location ?? "",
    description: job.description,
    skills: job.skills,
    salaryMin: job.salary_min_minor / 100,
    salaryMax: job.salary_max_minor / 100,
    minScore: thresholdFromApi(job.min_score),
  };
}
