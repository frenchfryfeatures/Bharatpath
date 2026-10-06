/*
 * A job posting's long form, shared by every portal that draws or edits one.
 *
 * Mirrors `backend/app/modules/jobs/details.py`. The employer reads and writes
 * `JobDetails`; a candidate reads `CandidateJobDetails`, which the backend
 * builds without the hiring manager, the screening questions or the internal
 * settings. Neither has an age or a gender field, and neither may grow one:
 * invariant 5 forbids age-gating, and a gender requirement on a job is the
 * discrimination the platform refuses everywhere else.
 */

export type JobType =
  | ""
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERNSHIP"
  | "FREELANCE";
export type EmploymentKind =
  | ""
  | "PERMANENT"
  | "TEMPORARY"
  | "FIXED_TERM"
  | "APPRENTICESHIP";
export type SalaryPeriod = "" | "HOURLY" | "DAILY" | "MONTHLY" | "ANNUAL";
export type SalaryType =
  | ""
  | "FIXED"
  | "FIXED_PLUS_VARIABLE"
  | "PERFORMANCE_BASED";
export type MinimumEducation =
  | ""
  | "NONE"
  | "CLASS_10"
  | "CLASS_12"
  | "DIPLOMA"
  | "GRADUATE"
  | "POST_GRADUATE"
  | "DOCTORATE";
export type NoticePeriod =
  | ""
  | "IMMEDIATE"
  | "15_DAYS"
  | "30_DAYS"
  | "60_DAYS"
  | "90_DAYS"
  | "ANY";
export type Relocation = "" | "REQUIRED" | "PREFERRED" | "NOT_REQUIRED";
export type ApplicationMethod = "BHARATPATH" | "EXTERNAL";
export type QuestionType =
  | "YES_NO"
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "SHORT_ANSWER"
  | "NUMERIC";
export type HiringTimeline =
  | ""
  | "WITHIN_1_WEEK"
  | "WITHIN_2_WEEKS"
  | "WITHIN_1_MONTH"
  | "WITHIN_3_MONTHS"
  | "FLEXIBLE";
export type Priority = "NORMAL" | "URGENT";
export type Visibility = "PUBLIC" | "PRIVATE" | "INVITE_ONLY";
export type ApplicantAccess = "ALL_MEMBERS" | "HIRING_TEAM";

export interface ScreeningQuestion {
  question: string;
  type: QuestionType;
  options: string[];
  mandatory: boolean;
  knockout: boolean;
  accepted_answers: string[];
}

export interface CandidateApplicationSettings {
  deadline: string | null;
  method: ApplicationMethod;
  email: string;
  external_url: string;
  resume_required: boolean;
  cover_letter_required: boolean;
  portfolio_required: boolean;
}

export interface CandidateHiring {
  interview_rounds: string[];
  timeline: HiringTimeline;
  priority: Priority;
  expected_joining_date: string | null;
}

interface SharedJobDetails {
  basics: {
    job_type: JobType;
    employment_type: EmploymentKind;
    department: string;
    category: string;
    industry: string;
    openings: number | null;
  };
  location: {
    additional_locations: string[];
    relocation_assistance: boolean;
  };
  compensation: {
    experience_max_months: number | null;
    period: SalaryPeriod;
    salary_type: SalaryType;
    disclosed: boolean;
    negotiable: boolean;
  };
  content: {
    responsibilities: string[];
    required_qualifications: string[];
    preferred_qualifications: string[];
    nice_to_have_skills: string[];
    benefits: string[];
  };
  skills: {
    preferred: string[];
    tools: string[];
    primary: string;
    experience: Array<{ skill: string; years: number }>;
  };
  education: {
    minimum: MinimumEducation;
    ug_qualification: string;
    ug_specialization: string;
    pg_qualification: string;
    pg_specialization: string;
    certifications: string[];
  };
  requirements: {
    languages: string[];
    notice_period: NoticePeriod;
    work_authorization: string;
    relocation: Relocation;
  };
}

/** The employer's whole posting. */
export interface JobDetails extends SharedJobDetails {
  application: CandidateApplicationSettings;
  screening_questions: ScreeningQuestion[];
  hiring: CandidateHiring & { hiring_manager: string };
  settings: {
    visibility: Visibility;
    featured: boolean;
    allow_referrals: boolean;
    applicant_access: ApplicantAccess;
    publish_on: string | null;
  };
}

/** What a candidate is sent. */
export interface CandidateJobDetails extends SharedJobDetails {
  application: CandidateApplicationSettings;
  hiring: CandidateHiring;
  featured: boolean;
}

export function emptyJobDetails(): JobDetails {
  return {
    basics: {
      job_type: "",
      employment_type: "",
      department: "",
      category: "",
      industry: "",
      openings: null,
    },
    location: { additional_locations: [], relocation_assistance: false },
    compensation: {
      experience_max_months: null,
      period: "",
      salary_type: "",
      disclosed: true,
      negotiable: false,
    },
    content: {
      responsibilities: [],
      required_qualifications: [],
      preferred_qualifications: [],
      nice_to_have_skills: [],
      benefits: [],
    },
    skills: { preferred: [], tools: [], primary: "", experience: [] },
    education: {
      minimum: "",
      ug_qualification: "",
      ug_specialization: "",
      pg_qualification: "",
      pg_specialization: "",
      certifications: [],
    },
    requirements: {
      languages: [],
      notice_period: "",
      work_authorization: "",
      relocation: "",
    },
    application: {
      deadline: null,
      method: "BHARATPATH",
      email: "",
      external_url: "",
      resume_required: true,
      cover_letter_required: false,
      portfolio_required: false,
    },
    screening_questions: [],
    hiring: {
      hiring_manager: "",
      interview_rounds: [],
      timeline: "",
      priority: "NORMAL",
      expected_joining_date: null,
    },
    settings: {
      visibility: "PUBLIC",
      featured: false,
      allow_referrals: false,
      applicant_access: "ALL_MEMBERS",
      publish_on: null,
    },
  };
}

/**
 * A stored document, every section present. A job saved before details
 * existed comes back from an older API without the key at all.
 */
export function withJobDetailDefaults(
  raw: Partial<JobDetails> | null | undefined,
): JobDetails {
  const base = emptyJobDetails();
  if (!raw) return base;
  return {
    basics: { ...base.basics, ...raw.basics },
    location: { ...base.location, ...raw.location },
    compensation: { ...base.compensation, ...raw.compensation },
    content: { ...base.content, ...raw.content },
    skills: { ...base.skills, ...raw.skills },
    education: { ...base.education, ...raw.education },
    requirements: { ...base.requirements, ...raw.requirements },
    application: { ...base.application, ...raw.application },
    screening_questions: raw.screening_questions ?? [],
    hiring: { ...base.hiring, ...raw.hiring },
    settings: { ...base.settings, ...raw.settings },
  };
}

/** A candidate's document from the API, every section present. */
export function candidateDetailsWithDefaults(
  raw: Partial<CandidateJobDetails>,
): CandidateJobDetails {
  const { featured, hiring, ...shared } = raw;
  return candidateView(
    withJobDetailDefaults({
      ...shared,
      hiring: hiring ? { ...emptyJobDetails().hiring, ...hiring } : undefined,
      settings: { ...emptyJobDetails().settings, featured: Boolean(featured) },
    }),
  );
}

/** The candidate-safe slice of an employer's posting, for previews. */
export function candidateView(details: JobDetails): CandidateJobDetails {
  const { hiring_manager: _hiringManager, ...hiring } = details.hiring;
  void _hiringManager;
  return {
    basics: details.basics,
    location: details.location,
    compensation: details.compensation,
    content: details.content,
    skills: details.skills,
    education: details.education,
    requirements: details.requirements,
    application: details.application,
    hiring,
    featured: details.settings.featured,
  };
}

/* ---------------------------------------------------------------------------
 * Labels. One table per vocabulary, used by the composer's selects and by
 * the description view, so the two never disagree on a word.
 * ------------------------------------------------------------------------- */
export const JOB_TYPE_LABELS: Record<Exclude<JobType, "">, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  FREELANCE: "Freelance",
};

export const EMPLOYMENT_TYPE_LABELS: Record<
  Exclude<EmploymentKind, "">,
  string
> = {
  PERMANENT: "Permanent",
  TEMPORARY: "Temporary",
  FIXED_TERM: "Fixed term",
  APPRENTICESHIP: "Apprenticeship",
};

export const WORK_MODE_LABELS: Record<"ONSITE" | "HYBRID" | "REMOTE", string> =
  {
    ONSITE: "On-site",
    HYBRID: "Hybrid",
    REMOTE: "Remote",
  };

export const SALARY_PERIOD_LABELS: Record<Exclude<SalaryPeriod, "">, string> = {
  HOURLY: "Per hour",
  DAILY: "Per day",
  MONTHLY: "Per month",
  ANNUAL: "Per year",
};

export const SALARY_PERIOD_SUFFIX: Record<Exclude<SalaryPeriod, "">, string> = {
  HOURLY: "/hour",
  DAILY: "/day",
  MONTHLY: "/month",
  ANNUAL: "/year",
};

export const SALARY_TYPE_LABELS: Record<Exclude<SalaryType, "">, string> = {
  FIXED: "Fixed",
  FIXED_PLUS_VARIABLE: "Fixed + Variable",
  PERFORMANCE_BASED: "Performance-based",
};

export const EDUCATION_LABELS: Record<Exclude<MinimumEducation, "">, string> =
  {
    NONE: "No formal requirement",
    CLASS_10: "Class 10",
    CLASS_12: "Class 12",
    DIPLOMA: "Diploma",
    GRADUATE: "Graduate",
    POST_GRADUATE: "Post graduate",
    DOCTORATE: "Doctorate",
  };

export const NOTICE_PERIOD_LABELS: Record<Exclude<NoticePeriod, "">, string> =
  {
    IMMEDIATE: "Immediate joiner",
    "15_DAYS": "15 days or less",
    "30_DAYS": "30 days or less",
    "60_DAYS": "60 days or less",
    "90_DAYS": "90 days or less",
    ANY: "Any notice period",
  };

export const RELOCATION_LABELS: Record<Exclude<Relocation, "">, string> = {
  REQUIRED: "Must be willing to relocate",
  PREFERRED: "Willingness to relocate preferred",
  NOT_REQUIRED: "Relocation not required",
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  YES_NO: "Yes/No",
  SINGLE_CHOICE: "Single choice",
  MULTIPLE_CHOICE: "Multiple choice",
  SHORT_ANSWER: "Short answer",
  NUMERIC: "Numeric",
};

export const TIMELINE_LABELS: Record<Exclude<HiringTimeline, "">, string> = {
  WITHIN_1_WEEK: "Within 1 week",
  WITHIN_2_WEEKS: "Within 2 weeks",
  WITHIN_1_MONTH: "Within 1 month",
  WITHIN_3_MONTHS: "Within 3 months",
  FLEXIBLE: "Flexible",
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  PUBLIC: "Public",
  PRIVATE: "Private",
  INVITE_ONLY: "Invite only",
};

export const APPLICANT_ACCESS_LABELS: Record<ApplicantAccess, string> = {
  ALL_MEMBERS: "Everyone in the organisation",
  HIRING_TEAM: "Hiring team only",
};

/** `{ A: "a" }` as select options, with an optional blank first. */
export function optionsOf<T extends string>(
  labels: Record<T, string>,
  blank?: string,
): Array<{ value: T | ""; label: string }> {
  const options = (Object.entries(labels) as Array<[T, string]>).map(
    ([value, label]) => ({ value, label }),
  );
  return blank ? [{ value: "", label: blank }, ...options] : options;
}

/** A vocabulary value's label, or null for the blank value. */
export function labelOf<T extends string>(
  labels: Record<Exclude<T, "">, string>,
  value: T,
): string | null {
  return value ? labels[value as Exclude<T, "">] ?? null : null;
}

/* ---------------------------------------------------------------------------
 * Formatting shared by every job surface.
 * ------------------------------------------------------------------------- */
const RUPEES = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatExperience(
  minMonths: number | null,
  maxMonths: number | null,
): string | null {
  const years = (months: number) => {
    const value = months / 12;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  };
  if (minMonths == null && maxMonths == null) return null;
  if (minMonths != null && maxMonths != null) {
    if (minMonths === 0 && maxMonths === 0) return "Fresher";
    return `${years(minMonths)} - ${years(maxMonths)} Yrs`;
  }
  if (minMonths != null) {
    return minMonths === 0 ? "Fresher" : `${years(minMonths)}+ Yrs`;
  }
  return `Up to ${years(maxMonths ?? 0)} Yrs`;
}

export function formatJobSalary(
  minMinor: number,
  maxMinor: number,
  compensation: SharedJobDetails["compensation"],
): string {
  if (!compensation.disclosed) return "Not disclosed";
  const low = RUPEES.format(minMinor / 100);
  const high = RUPEES.format(maxMinor / 100);
  const range = minMinor === maxMinor ? low : `${low} - ${high}`;
  const suffix = compensation.period
    ? SALARY_PERIOD_SUFFIX[compensation.period]
    : "";
  return `${range}${suffix}`;
}

export function formatJobDate(value: string | null | undefined): string | null {
  if (!value) return null;
  // A bare `YYYY-MM-DD` is a calendar day, not an instant: read it as local
  // noon so no timezone moves it to the day before.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
