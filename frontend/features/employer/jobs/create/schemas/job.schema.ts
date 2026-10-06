import type { CreateJobFormValues } from "../types";
import { passingAnswers } from "../job-form-values";
import { THRESHOLD_MAX, THRESHOLD_MIN } from "../threshold";

/**
 * Keyed by field: a top-level name (`title`), a details path
 * (`basics.department`), or `screening.<index>` for a question.
 */
export type JobValidationErrors = Partial<Record<string, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CHOICE = new Set(["SINGLE_CHOICE", "MULTIPLE_CHOICE"]);

/**
 * The composer's required fields (the asterisks) and the cross-field rules.
 * The API holds the shape and the cross-checks again; it does not hold which
 * fields an employer must fill, so an older client still works.
 */
export function validateJob(values: CreateJobFormValues): JobValidationErrors {
  const errors: JobValidationErrors = {};
  const { details } = values;
  const required = (key: string, value: unknown, message: string) => {
    if (
      value === "" ||
      value == null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !value.some((item) => String(item).trim()))
    ) {
      errors[key] = message;
    }
  };

  // 1. Basic job details
  if (!values.title.trim()) {
    errors.title = "Job title is required.";
  } else if (values.title.trim().length < 3) {
    errors.title = "Job title must be at least 3 characters.";
  }
  required("basics.job_type", details.basics.job_type, "Choose a job type.");
  required(
    "basics.employment_type",
    details.basics.employment_type,
    "Choose an employment type.",
  );
  required("basics.department", details.basics.department, "Department is required.");
  required("basics.category", details.basics.category, "Job category is required.");
  if (!details.basics.openings || details.basics.openings < 1) {
    errors["basics.openings"] = "At least one opening is required.";
  }

  // 2. Location
  required("workMode", values.workMode, "Choose a work mode.");
  required("location", values.location, "Job location is required.");

  // 3. Experience & compensation
  required("experienceMin", values.experienceMin, "Minimum experience is required.");
  required("experienceMax", values.experienceMax, "Maximum experience is required.");
  if (
    values.experienceMin !== "" &&
    values.experienceMax !== "" &&
    values.experienceMax < values.experienceMin
  ) {
    errors.experienceMax = "Maximum experience must be at least the minimum.";
  }
  if (values.experienceMin !== "" && values.experienceMin < 0) {
    errors.experienceMin = "Experience cannot be negative.";
  }
  // The range is mandatory in the API (PRD 5.2), even when it is not shown.
  if (values.salaryMin === "") {
    errors.salaryMin = "Minimum salary is required.";
  } else if (values.salaryMin < 0) {
    errors.salaryMin = "Minimum salary cannot be negative.";
  }
  if (values.salaryMax === "") {
    errors.salaryMax = "Maximum salary is required.";
  } else if (values.salaryMax < 0) {
    errors.salaryMax = "Maximum salary cannot be negative.";
  }
  if (
    values.salaryMin !== "" &&
    values.salaryMax !== "" &&
    values.salaryMax < values.salaryMin
  ) {
    errors.salaryMax =
      "Maximum salary must be greater than or equal to minimum salary.";
  }
  required("compensation.period", details.compensation.period, "Choose a salary period.");

  // 4. Job description
  if (!values.description.trim()) {
    errors.description = "Description is required.";
  } else if (values.description.trim().length < 20) {
    errors.description = "Description should be at least 20 characters.";
  }
  required(
    "content.responsibilities",
    details.content.responsibilities,
    "Add at least one key responsibility.",
  );
  required(
    "content.required_qualifications",
    details.content.required_qualifications,
    "Add at least one required qualification.",
  );

  // 5. Skills
  if (!values.skills.length) {
    errors.skills = "Select at least one required skill.";
  }

  // 8. Application settings
  const { application } = details;
  if (application.email && !EMAIL.test(application.email.trim())) {
    errors["application.email"] = "Enter a valid email address.";
  }
  if (application.method === "EXTERNAL") {
    const url = application.external_url.trim();
    if (!url) {
      errors["application.external_url"] = "External application URL is required.";
    } else if (!url.startsWith("https://")) {
      errors["application.external_url"] = "The URL must start with https://";
    }
  }

  // 9. Screening questions
  details.screening_questions.forEach((question, index) => {
    const key = `screening.${index}`;
    if (question.question.trim().length < 3) {
      errors[key] = "Write the question (at least 3 characters).";
      return;
    }
    const options = question.options.map((o) => o.trim()).filter(Boolean);
    if (CHOICE.has(question.type)) {
      if (options.length < 2) {
        errors[key] = "A choice question needs at least two options.";
        return;
      }
      if (new Set(options.map((o) => o.toLocaleLowerCase())).size !== options.length) {
        errors[key] = "Options must be different from each other.";
        return;
      }
    }
    if (question.knockout) {
      if (!CHOICE.has(question.type) && question.type !== "YES_NO") {
        errors[key] = "Only yes/no and choice questions can be knockout questions.";
      } else if (
        !passingAnswers(question.type, options, question.accepted_answers).length
      ) {
        errors[key] = "Pick the answers that pass this knockout question.";
      }
    }
  });

  // 10. Hiring process
  required(
    "hiring.hiring_manager",
    details.hiring.hiring_manager,
    "Name the hiring manager or recruiter.",
  );

  if (values.minScore < THRESHOLD_MIN || values.minScore > THRESHOLD_MAX) {
    errors.minScore = `Score threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}.`;
  }

  return errors;
}
