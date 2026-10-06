"use client";

import { useRouter } from "next/navigation";
import { OnboardingBackButton } from "@/components/common/onboarding-back-button";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { FormSkeleton } from "@/components/common/loading";
import { Button } from "@/components/ui";
import { CollegeErrorState } from "@/features/college/components/college-error-state";
import { KybSectionFields } from "@/features/employer/onboarding/components/kyb-section-fields";
import {
  SignupShell,
  StepCard,
  type SignupStep,
} from "@/features/employer/onboarding/components/signup-shell";
import {
  sectionPayload,
  validateSection,
  issueMessage,
  type KybFieldErrors,
} from "@/features/employer/onboarding/kyb-form";
import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  useGetCollegeOnboardingQuery,
  useSaveCollegeOnboardingMutation,
  useSubmitCollegeOnboardingMutation,
} from "@/store/college/settings/settings.api";
import type { KybForm, KybSection } from "@/store/employer/kyb";

const NO_UPLOADS: ReadonlySet<string> = new Set();

interface OnboardingIssue {
  field: string;
  code: string;
}

/** The 422 `college_onboarding_invalid` lists every problem by field and code. */
function issuesOf(error: unknown): OnboardingIssue[] {
  const data = (error as { data?: { params?: { issues?: unknown } } } | null)?.data;
  const issues = data?.params?.issues;

  return Array.isArray(issues)
    ? (issues as OnboardingIssue[]).filter(
        (issue) => typeof issue?.field === "string" && typeof issue?.code === "string",
      )
    : [];
}

interface DetailsWizardProps {
  leadingSteps: SignupStep[];
  email: string | null;
  onSignOut: () => void;
}

/**
 * The college onboarding form, one published section at a time. The server
 * owns the field list and every rule (`GET /college/onboarding`); the checks
 * here only save a round trip. Each step saves its answers as a draft, and
 * the last one submits.
 */
export function CollegeDetailsWizard({
  leadingSteps,
  email,
  onSignOut,
}: Readonly<DetailsWizardProps>) {
  const router = useRouter();
  const onboarding = useGetCollegeOnboardingQuery();
  const [save] = useSaveCollegeOnboardingMutation();
  const [submit] = useSubmitCollegeOnboardingMutation();

  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [errors, setErrors] = useState<KybFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = onboarding.data;
  const sections = useMemo(
    () => (data?.form.sections ?? []) as unknown as KybSection[],
    [data],
  );
  const answers = useMemo(() => ({ ...(data?.answers ?? {}), ...edits }), [data, edits]);
  const form = useMemo<KybForm>(
    () => ({
      code: data?.form.code ?? "",
      version: data?.form.version ?? "",
      sections,
      options: data?.options ?? {},
    }),
    [data, sections],
  );

  const submitted = Boolean(data?.submittedAt);
  const section = sections[stepIndex];
  const isLast = stepIndex === sections.length - 1;

  const steps: SignupStep[] = [
    ...leadingSteps,
    ...sections.map((item, index): SignupStep => {
      const visited = !submitted && index <= maxVisited;
      return {
        key: `college-${item.code}`,
        title: item.title,
        status: submitted
          ? "complete"
          : index === stepIndex
            ? "current"
            : index < stepIndex
              ? "complete"
              : "upcoming",
        onSelect: visited && !busy ? () => setStepIndex(index) : undefined,
      };
    }),
  ];

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const setAnswer = (code: string, value: unknown) => {
    setEdits((current) => ({ ...current, [code]: value }));
    setErrors((current) => {
      if (!current[code]) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  };

  const showIssues = (error: unknown): boolean => {
    const issues = issuesOf(error);
    if (issues.length === 0) return false;

    const fields = sections.flatMap((item) => item.fields);
    const next: KybFieldErrors = {};
    for (const issue of issues) {
      next[issue.field] = issueMessage(
        fields.find((field) => field.code === issue.field),
        issue.code,
      );
    }
    setErrors(next);

    // Take them to the first section that still has something to fix.
    const first = sections.findIndex((item) =>
      item.fields.some((field) => next[field.code]),
    );
    if (first >= 0) setStepIndex(first);
    return true;
  };

  const next = async () => {
    if (!section) return;
    setBanner(null);

    const problems = validateSection(section, answers, NO_UPLOADS);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      await save({
        answers: sectionPayload(section, answers),
        __suppressSuccessFeedback: true,
      }).unwrap();

      if (isLast) {
        await submit().unwrap();
        scrollToTop();
        return;
      }

      setStepIndex(stepIndex + 1);
      setMaxVisited((current) => Math.max(current, stepIndex + 1));
      scrollToTop();
    } catch (error) {
      if (!showIssues(error)) {
        setBanner(getApiErrorMessage(error, "We could not save your details. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  if (onboarding.isLoading) {
    return (
      <SignupShell steps={leadingSteps} signedIn email={email} subtitle="College sign-up" onSignOut={onSignOut}>
        <FormSkeleton fields={4} />
      </SignupShell>
    );
  }

  if (onboarding.isError || !data) {
    return (
      <SignupShell steps={leadingSteps} signedIn email={email} subtitle="College sign-up" onSignOut={onSignOut}>
        <CollegeErrorState
          variant="block"
          error={onboarding.error}
          title="Couldn't load the onboarding form"
          fallback="Please try again."
          onRetry={() => void onboarding.refetch()}
        />
      </SignupShell>
    );
  }

  if (submitted) {
    return (
      <SignupShell steps={steps} signedIn email={email} subtitle="College sign-up" onSignOut={onSignOut}>
        <StepCard
          title="Your institution is submitted"
          description="Thank you. BharatPath will review your details. You can open your dashboard now; seats and student linking open once your plan is set up."
        >
          <div className="flex flex-col items-start gap-5">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#eef6f3] px-3 py-1.5 text-xs font-semibold text-[#1f7a63]">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Onboarding submitted
            </span>
            <Button
              type="button"
              variant="dark"
              size="lg"
              onClick={() => router.replace("/college")}
              icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              iconPosition="right"
            >
              Go to your dashboard
            </Button>
          </div>
        </StepCard>
      </SignupShell>
    );
  }

  if (!section) {
    return null;
  }

  return (
    <SignupShell steps={steps} signedIn email={email} subtitle="College sign-up" onSignOut={onSignOut}>
      <StepCard
        eyebrow={`Step ${leadingSteps.length + stepIndex + 1} of ${steps.length}`}
        title={section.title}
        description={section.help_text}
        footer={
          <>
            {stepIndex > 0 ? (
              <OnboardingBackButton
                disabled={busy}
                onClick={() => {
                  setStepIndex(stepIndex - 1);
                  scrollToTop();
                }}
               />
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="dark"
              size="lg"
              isLoading={busy}
              loadingText={isLast ? "Submitting…" : "Saving…"}
              onClick={() => void next()}
              icon={isLast ? undefined : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              iconPosition="right"
            >
              {isLast ? "Submit for review" : "Save and continue"}
            </Button>
          </>
        }
      >
        {banner ? <CollegeErrorState variant="inline" className="mb-5" message={banner} /> : null}
        <KybSectionFields
          form={form}
          section={section}
          answers={answers}
          errors={errors}
          disabled={busy}
          onChange={setAnswer}
        />
      </StepCard>
    </SignupShell>
  );
}
