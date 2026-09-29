import type { CreateJobFormValues } from "../types";
import { THRESHOLD_MAX, THRESHOLD_MIN } from "../threshold";

export type JobValidationErrors = Partial<
  Record<keyof CreateJobFormValues | "form", string>
>;

export function validateJob(
  values: CreateJobFormValues,
): JobValidationErrors {
  const errors: JobValidationErrors = {};

  if (!values.title.trim()) {
    errors.title = "Job title is required.";
  } else if (values.title.trim().length < 3) {
    errors.title = "Job title must be at least 3 characters.";
  }

  if (!values.location.trim()) {
    errors.location = "Location is required.";
  }

  if (!values.description.trim()) {
    errors.description = "Description is required.";
  } else if (values.description.trim().length < 20) {
    errors.description = "Description should be at least 20 characters.";
  }

  if (!values.skills.length) {
    errors.skills = "Select at least one required skill.";
  }

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
    errors.salaryMax = "Maximum salary must be greater than or equal to minimum salary.";
  }

  if (
    values.minScore < THRESHOLD_MIN ||
    values.minScore > THRESHOLD_MAX
  ) {
    errors.minScore = `Score threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}.`;
  }

  return errors;
}
