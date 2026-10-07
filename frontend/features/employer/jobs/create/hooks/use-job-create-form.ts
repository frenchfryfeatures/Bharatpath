"use client";

import { useState } from "react";

import type { JobDetails } from "@/features/jobs/job-details";

import { initialJobFormValues } from "../job-form-values";
import type { CreateJobFormValues } from "../types";
import { validateJob, type JobValidationErrors } from "../schemas/job.schema";

type Section = keyof Omit<JobDetails, "screening_questions">;

export function useJobCreateForm(initialValues?: CreateJobFormValues) {
  const [values, setValues] = useState<CreateJobFormValues>(
    () => initialValues ?? initialJobFormValues(),
  );
  const [errors, setErrors] = useState<JobValidationErrors>({});

  const clearError = (key: string) =>
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  const setValue = <K extends keyof CreateJobFormValues>(
    name: K,
    value: CreateJobFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [name]: value }));
    clearError(name);
  };

  /** One field of one `details` section, e.g. `("basics", "openings", 3)`. */
  const setDetail = <S extends Section, F extends keyof JobDetails[S]>(
    section: S,
    field: F,
    value: JobDetails[S][F],
  ) => {
    setValues((current) => ({
      ...current,
      details: {
        ...current.details,
        [section]: { ...current.details[section], [field]: value },
      },
    }));
    clearError(`${section}.${String(field)}`);
  };

  const setScreeningQuestions = (
    questions: JobDetails["screening_questions"],
  ) => {
    setValues((current) => ({
      ...current,
      details: { ...current.details, screening_questions: questions },
    }));
    setErrors((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith("screening")),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  };

  const validate = () => {
    const nextErrors = validateJob(values);
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  return {
    values,
    errors,
    setValue,
    setDetail,
    setScreeningQuestions,
    setErrors,
    validate,
  };
}
