import type { EmployerJobApiResponse } from "@/features/employer/jobs/types";
import {
  emptyJobDetails,
  withJobDetailDefaults,
  type JobDetails,
} from "@/features/jobs/job-details";

import { thresholdForApi, thresholdFromApi } from "./threshold";
import type { CreateJobFormValues } from "./types";

const MONTHS_PER_YEAR = 12;

export function initialJobFormValues(): CreateJobFormValues {
  const details = emptyJobDetails();
  details.basics.job_type = "FULL_TIME";
  details.basics.openings = 1;
  details.compensation.period = "MONTHLY";
  return {
    title: "",
    workMode: "ONSITE",
    location: "",
    description: "",
    skills: [],
    experienceMin: "",
    experienceMax: "",
    salaryMin: "",
    salaryMax: "",
    minScore: 750,
    details,
  };
}

function monthsToYears(months: number | null | undefined): number | "" {
  return months == null ? "" : Math.round((months / MONTHS_PER_YEAR) * 10) / 10;
}

function yearsToMonths(years: number | ""): number | null {
  return years === "" ? null : Math.round(Number(years) * MONTHS_PER_YEAR);
}

export function mapApiJobToFormValues(
  job: EmployerJobApiResponse,
): CreateJobFormValues {
  const details = withJobDetailDefaults(job.details);
  return {
    title: job.title,
    workMode: job.work_mode ?? "",
    location: job.location ?? "",
    description: job.description,
    skills: job.skills,
    experienceMin: monthsToYears(job.experience_min_months),
    experienceMax: monthsToYears(details.compensation.experience_max_months),
    salaryMin: job.salary_min_minor / 100,
    salaryMax: job.salary_max_minor / 100,
    minScore: thresholdFromApi(job.min_score),
    details,
  };
}

function lines(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

/** The details document as the API takes it: blanks dropped, units fixed. */
export function detailsForApi(values: CreateJobFormValues): JobDetails {
  const { details } = values;
  const choice = (type: string) =>
    type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE";

  return {
    ...details,
    compensation: {
      ...details.compensation,
      experience_max_months: yearsToMonths(values.experienceMax),
    },
    content: {
      responsibilities: lines(details.content.responsibilities),
      required_qualifications: lines(details.content.required_qualifications),
      preferred_qualifications: lines(details.content.preferred_qualifications),
      nice_to_have_skills: details.content.nice_to_have_skills,
      benefits: lines(details.content.benefits),
    },
    skills: {
      ...details.skills,
      // A primary skill that is no longer required is dropped rather than
      // sent for the API to refuse.
      primary: values.skills.some(
        (skill) =>
          skill.toLocaleLowerCase() ===
          details.skills.primary.toLocaleLowerCase(),
      )
        ? details.skills.primary
        : "",
      experience: details.skills.experience.filter((row) =>
        row.skill.trim(),
      ),
    },
    application: {
      ...details.application,
      email: details.application.email.trim(),
      external_url:
        details.application.method === "EXTERNAL"
          ? details.application.external_url.trim()
          : "",
    },
    screening_questions: details.screening_questions.map((question) => {
      const options = choice(question.type) ? lines(question.options) : [];
      return {
        ...question,
        question: question.question.trim(),
        options,
        accepted_answers: question.knockout
          ? passingAnswers(question.type, options, question.accepted_answers)
          : [],
      };
    }),
    hiring: {
      ...details.hiring,
      hiring_manager: details.hiring.hiring_manager.trim(),
    },
  };
}

/** The accepted answers still among the question's options. */
export function passingAnswers(
  type: string,
  options: string[],
  accepted: string[],
): string[] {
  const allowed = type === "YES_NO" ? ["Yes", "No"] : options;
  return accepted.filter((answer) => allowed.includes(answer));
}

export function jobBody(values: CreateJobFormValues) {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    skills: values.skills,
    location: values.location.trim() || null,
    work_mode: values.workMode || null,
    experience_min_months: yearsToMonths(values.experienceMin),
    salary_min_minor: Math.round(Number(values.salaryMin) * 100),
    salary_max_minor: Math.round(Number(values.salaryMax) * 100),
    min_score: thresholdForApi(values.minScore),
    details: detailsForApi(values),
  };
}
