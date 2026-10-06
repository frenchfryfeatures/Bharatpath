"use client";

import { useCallback, useMemo, useState } from "react";

import {
  useGetCollegeOnboardingQuery,
  useSaveCollegeOnboardingMutation,
  useSubmitCollegeOnboardingMutation,
} from "@/store/college/settings/settings.api";
import { getApiErrorMessage } from "@/lib/api/error-message";

/** One `{ field, code }` problem returned by the server's 422. */
interface OnboardingIssue {
  field: string;
  code: string;
}

/*
 * The server owns validation: `PUT .../answers` and `POST .../submit` both
 * return a 422 whose `params.issues` names every malformed or missing field by
 * a machine code. We surface those against the fields rather than guessing the
 * rules on the client, which is only ever a hint (SRS - the browser is not
 * ours).
 */
function extractIssues(error: unknown): OnboardingIssue[] {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "params" in error.data &&
    error.data.params &&
    typeof error.data.params === "object" &&
    "issues" in error.data.params &&
    Array.isArray(error.data.params.issues)
  ) {
    return error.data.params.issues as OnboardingIssue[];
  }

  return [];
}

export function useCollegeOnboarding() {
  const onboardingQuery = useGetCollegeOnboardingQuery();
  const [saveOnboarding, saveState] = useSaveCollegeOnboardingMutation();
  const [submitOnboarding, submitState] = useSubmitCollegeOnboardingMutation();

  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const data = onboardingQuery.data;

  /*
   * The server holds the persisted answers; local `edits` overlay them so the
   * component never has to copy server state into local state (which would be a
   * setState-in-effect). A saved edit simply re-applies over the refetched
   * value, which is idempotent.
   */
  const answers = useMemo<Record<string, unknown>>(
    () => ({ ...(data?.answers ?? {}), ...edits }),
    [data, edits],
  );

  const setAnswer = useCallback((code: string, value: unknown) => {
    setEdits((current) => ({ ...current, [code]: value }));
    setFieldErrors((current) => {
      if (!current[code]) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  }, []);

  const applyIssues = useCallback((issues: OnboardingIssue[]) => {
    setFieldErrors(
      Object.fromEntries(issues.map((issue) => [issue.field, issue.code])),
    );
  }, []);

  const saveDraft = useCallback(async () => {
    setFormError(null);
    try {
      await saveOnboarding({ answers }).unwrap();
      setFieldErrors({});
      setSavedAt(Date.now());
    } catch (error) {
      const issues = extractIssues(error);
      if (issues.length > 0) {
        applyIssues(issues);
      } else {
        setFormError(getApiErrorMessage(error, "Could not save. Please try again."));
      }
    }
  }, [saveOnboarding, answers, applyIssues]);

  const submit = useCallback(async () => {
    setFormError(null);
    try {
      /* Persist the latest answers first, then submit for validation. */
      await saveOnboarding({
        answers,
        __suppressSuccessFeedback: true,
      }).unwrap();
      await submitOnboarding().unwrap();
      setFieldErrors({});
    } catch (error) {
      const issues = extractIssues(error);
      if (issues.length > 0) {
        applyIssues(issues);
        setFormError("Some answers still need attention.");
      } else {
        setFormError(getApiErrorMessage(error, "Could not submit. Please try again."));
      }
    }
  }, [saveOnboarding, submitOnboarding, answers, applyIssues]);

  const submittedAt = data?.submittedAt ?? null;

  return useMemo(
    () => ({
      form: data?.form ?? null,
      options: data?.options ?? {},
      answers,
      setAnswer,
      isLoading: onboardingQuery.isLoading,
      isError: onboardingQuery.isError,
      submittedAt,
      fieldErrors,
      formError,
      savedAt,
      saveDraft,
      isSaving: saveState.isLoading,
      submit,
      isSubmitting: submitState.isLoading,
    }),
    [
      data,
      answers,
      setAnswer,
      onboardingQuery.isLoading,
      onboardingQuery.isError,
      submittedAt,
      fieldErrors,
      formError,
      savedAt,
      saveDraft,
      saveState.isLoading,
      submit,
      submitState.isLoading,
    ],
  );
}
