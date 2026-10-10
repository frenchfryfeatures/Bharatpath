"use client";

import { useMemo, useState } from "react";
import { OnboardingBackButton } from "@/components/common/onboarding-back-button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { FormSkeleton } from "@/components/common/loading";
import { Button, ErrorState } from "@/components/ui";
import { getApiErrorMessage, getApiErrorStatus } from "@/lib/api/error-message";
import {
  useGetEmployerKybFormQuery,
  useGetEmployerKybQuery,
  useSaveEmployerKybAnswersMutation,
  useSubmitEmployerKybMutation,
  type KybForm,
  type KybSubmission,
} from "@/store/employer/kyb";
import {
  useGetEmployerOrganisationQuery,
  type CompanyProfile,
} from "@/store/employer/settings";

import {
  answerableFields,
  EDITABLE_KYB_STATES,
  isDocumentSection,
  isSectionComplete,
  issuesFromError,
  problemCode,
  sectionIndexOfField,
  sectionPayload,
  uploadedDocuments,
  validateSection,
  type KybAnswers,
  type KybFieldErrors,
} from "../kyb-form";
import { useKybDocumentUpload } from "../hooks/use-kyb-document-upload";
import { KybDocuments } from "./kyb-documents";
import { KybReview } from "./kyb-review";
import { KybSectionFields } from "./kyb-section-fields";
import { KybStatus } from "./kyb-status";
import { SignupShell, StepCard, type SignupStep } from "./signup-shell";

interface KybWizardProps {
  /** Steps before KYB (account, organisation), already complete. */
  leadingSteps: SignupStep[];
  email: string | null;
  onSignOut: () => void;
}

/**
 * Loads the published form, the current submission and the organisation,
 * then hands them to the step-by-step flow. Every KYB route is owner-only.
 */
export function KybWizard({
  leadingSteps,
  email,
  onSignOut,
}: Readonly<KybWizardProps>) {
  const formQuery = useGetEmployerKybFormQuery();
  const submissionQuery = useGetEmployerKybQuery();
  const organisationQuery = useGetEmployerOrganisationQuery();

  const loading =
    formQuery.isLoading || submissionQuery.isLoading || organisationQuery.isLoading;
  const error = formQuery.error ?? submissionQuery.error;

  const placeholderSteps: SignupStep[] = [
    ...leadingSteps,
    { key: "kyb", title: "Business verification", status: "current" },
    { key: "review", title: "Review & submit", status: "upcoming" },
  ];

  if (loading) {
    return (
      <SignupShell steps={placeholderSteps} signedIn email={email} onSignOut={onSignOut}>
        <FormSkeleton fields={6} />
      </SignupShell>
    );
  }

  if (error || !formQuery.data || !submissionQuery.data) {
    const forbidden = getApiErrorStatus(error) === 403;

    return (
      <SignupShell steps={placeholderSteps} signedIn email={email} onSignOut={onSignOut}>
        <ErrorState
          variant="block"
          title={
            forbidden
              ? "Only the organisation owner can complete verification"
              : "We could not load the verification form"
          }
          error={error}
          onRetry={
            forbidden
              ? undefined
              : () => {
                  void formQuery.refetch();
                  void submissionQuery.refetch();
                }
          }
        />
      </SignupShell>
    );
  }

  return (
    <KybFlow
      form={formQuery.data}
      initialSubmission={submissionQuery.data}
      organisation={organisationQuery.data}
      leadingSteps={leadingSteps}
      email={email}
      onSignOut={onSignOut}
      reloadSubmission={async () => (await submissionQuery.refetch()).data}
    />
  );
}

interface KybFlowProps {
  form: KybForm;
  initialSubmission: KybSubmission;
  organisation?: CompanyProfile;
  leadingSteps: SignupStep[];
  email: string | null;
  onSignOut: () => void;
  reloadSubmission: () => Promise<KybSubmission | undefined>;
}

/** Answers the organisation step already collected, used as defaults. */
function organisationDefaults(organisation?: CompanyProfile): KybAnswers {
  if (!organisation) {
    return {};
  }

  return Object.fromEntries(
    Object.entries({
      legal_name: organisation.legalName,
      employer_type: organisation.businessType,
      industry: organisation.industry,
    }).filter(([, value]) => Boolean(value)),
  );
}

function firstStep(
  form: KybForm,
  submission: KybSubmission,
  answers: KybAnswers,
): number {
  // Nothing saved yet: start at the beginning even if defaults fill it.
  if (!submission.submissionId || submission.state === "REJECTED" ||
      (submission.state === "DRAFT" && submission.previousSubmissionId)) {
    return 0;
  }

  const uploaded = new Set(uploadedDocuments(submission).keys());
  const incomplete = form.sections.findIndex(
    (section) => !isSectionComplete(section, answers, uploaded),
  );

  return incomplete === -1 ? form.sections.length : incomplete;
}

function scrollToTop() {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function KybFlow({
  form,
  initialSubmission,
  organisation,
  leadingSteps,
  email,
  onSignOut,
  reloadSubmission,
}: Readonly<KybFlowProps>) {
  const router = useRouter();
  const restartedAfterRejection = Boolean(initialSubmission.previousSubmissionId);
  const [submission, setSubmission] = useState(initialSubmission);
  const [answers, setAnswers] = useState<KybAnswers>(() => ({
    ...organisationDefaults(organisation),
    ...initialSubmission.answers,
  }));
  const [editing, setEditing] = useState(() =>
    EDITABLE_KYB_STATES.has(initialSubmission.state),
  );
  const [stepIndex, setStepIndex] = useState(() =>
    firstStep(form, initialSubmission, {
      ...organisationDefaults(organisation),
      ...initialSubmission.answers,
    }),
  );
  const [maxVisited, setMaxVisited] = useState(stepIndex);
  const [errors, setErrors] = useState<KybFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);

  const [saveAnswers, { isLoading: isSaving }] = useSaveEmployerKybAnswersMutation();
  const [submitKyb, { isLoading: isSubmitting }] = useSubmitEmployerKybMutation();

  const uploader = useKybDocumentUpload((result) => {
    // Two uploads can finish together, each answering with its own snapshot;
    // keep every document either of them reported.
    setSubmission((current) => {
      if (current.submissionId !== result.submissionId) {
        return result;
      }

      const byType = new Map(
        current.documents.map((document) => [document.docType, document]),
      );
      for (const document of result.documents) {
        byType.set(document.docType, document);
      }

      return { ...result, documents: [...byType.values()] };
    });
    setErrors((current) => {
      const nextErrors = { ...current };
      for (const document of result.documents) {
        delete nextErrors[document.docType];
      }
      return nextErrors;
    });
  });

  const documents = useMemo(() => uploadedDocuments(submission), [submission]);
  const uploaded = useMemo(() => new Set(documents.keys()), [documents]);

  const sections = form.sections;
  const reviewIndex = sections.length;
  const onReview = stepIndex === reviewIndex;
  const section = onReview ? null : sections[stepIndex];
  const saving = isSaving || isSubmitting;
  // Nothing moves on while a document is still on its way.
  const busy = saving || uploader.isUploading;

  const goTo = (index: number) => {
    setStepIndex(index);
    setMaxVisited((current) => Math.max(current, index));
    setBanner(null);
    scrollToTop();
  };

  const change = (code: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [code]: value }));
    setErrors((current) => {
      if (!current[code]) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  };

  /** The submission moved on elsewhere (another tab, a reviewer). */
  const handleStale = async () => {
    const latest = await reloadSubmission();
    if (latest) {
      setSubmission(latest);
      setEditing(EDITABLE_KYB_STATES.has(latest.state));
    }
  };

  const handleFailure = async (error: unknown) => {
    const code = problemCode(error);

    if (code === "kyb_not_editable" || code === "kyb_already_verified") {
      await handleStale();
      return;
    }

    const fieldErrors = issuesFromError(form, error);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);

      const firstInvalid = Math.min(
        ...Object.keys(fieldErrors)
          .map((field) => sectionIndexOfField(form, field))
          .filter((index) => index >= 0),
      );

      if (Number.isFinite(firstInvalid) && firstInvalid !== stepIndex) {
        goTo(firstInvalid);
      }
    }

    setBanner(getApiErrorMessage(error, "We could not save your details."));
  };

  const next = async () => {
    if (!section || busy) return;

    const sectionErrors = validateSection(section, answers, uploaded);

    if (Object.keys(sectionErrors).length > 0) {
      setErrors(sectionErrors);
      setBanner("Some details need attention. Check the highlighted fields.");
      return;
    }

    setErrors({});

    if (answerableFields(section).length > 0) {
      try {
        setSubmission(
          await saveAnswers({ answers: sectionPayload(section, answers) }).unwrap(),
        );
      } catch (error) {
        await handleFailure(error);
        return;
      }
    }

    goTo(stepIndex + 1);
  };

  const submit = async () => {
    if (busy) return;

    const allErrors: KybFieldErrors = {};
    for (const item of sections) {
      Object.assign(allErrors, validateSection(item, answers, uploaded));
    }

    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      const firstInvalid = sections.findIndex((item) =>
        item.fields.some((field) => allErrors[field.code]),
      );
      goTo(firstInvalid);
      setBanner("A few details are still missing. Complete them to submit.");
      return;
    }

    // Save everything once more: a section edited and then left through the
    // step list was never saved on its own.
    const payload = Object.assign(
      {},
      ...sections.map((item) => sectionPayload(item, answers)),
    ) as KybAnswers;

    try {
      await saveAnswers({
        answers: payload,
        __suppressSuccessFeedback: true,
      }).unwrap();
      const result = await submitKyb().unwrap();
      setSubmission(result);
      setEditing(EDITABLE_KYB_STATES.has(result.state));
      setBanner(null);
      scrollToTop();
    } catch (error) {
      await handleFailure(error);
    }
  };

  const steps: SignupStep[] = [
    ...leadingSteps,
    ...sections.map((item, index): SignupStep => {
      const visited = editing && index <= maxVisited;
      const done = !editing || (index !== stepIndex && visited && isSectionComplete(item, answers, uploaded));

      return {
        // Namespaced: the form's own "organisation" section would otherwise
        // collide with the leading "Your organisation" step.
        key: `kyb-${item.code}`,
        title: item.title,
        status: editing && index === stepIndex ? "current" : done ? "complete" : "upcoming",
        onSelect: visited && !busy ? () => goTo(index) : undefined,
      };
    }),
    {
      key: "review",
      title: editing ? "Review & submit" : "Submitted",
      status: !editing ? "current" : onReview ? "current" : "upcoming",
      onSelect: editing && maxVisited >= reviewIndex && !busy ? () => goTo(reviewIndex) : undefined,
    },
  ];

  // Sent-back submissions and rejections still begin from Settings.
  // Once restarted, a new draft goes through these onboarding steps.
  const fixFromProfile =
    submission.state === "MORE_INFO_REQUIRED" ||
    submission.state === "REJECTED";

  if (fixFromProfile) {
    return (
      <SignupShell steps={steps} signedIn email={email} onSignOut={onSignOut}>
        <StepCard
          eyebrow="Verification"
          title={
            submission.state === "REJECTED"
              ? "Your verification was not approved"
              : "Your verification needs changes"
          }
          description="Review what was raised and update it from your company profile."
        >
          {submission.decisionReason && (
            <div className="mb-4 rounded-xl border border-[#f2cf93] bg-[#fffaf0] p-4 text-sm leading-6 text-[#7a4a00]">
              {submission.decisionReason}
            </div>
          )}
          <Link
            href="/employer/settings"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#17233a] px-4 text-sm font-semibold text-white transition hover:bg-[#223453]"
          >
            Open company profile
          </Link>
        </StepCard>
      </SignupShell>
    );
  }

  if (!editing) {
    return (
      <SignupShell steps={steps} signedIn email={email} onSignOut={onSignOut}>
        <KybStatus submission={submission} />
      </SignupShell>
    );
  }

  const totalSteps = steps.length;
  const stepNumber = leadingSteps.length + stepIndex + 1;

  return (
    <SignupShell steps={steps} signedIn email={email} onSignOut={onSignOut}>
      {restartedAfterRejection ? (
        <OnboardingBackButton
          label="Back to company profile"
          className="mb-4"
          disabled={busy}
          onClick={() => router.push("/employer/settings")}
        />
      ) : null}
      <StepCard
        eyebrow={`Business verification · Step ${stepNumber} of ${totalSteps}`}
        title={onReview ? "Review and submit" : (section?.title ?? "")}
        description={
          onReview
            ? "Check your details before submitting. You cannot edit them while they are being reviewed."
            : section?.help_text
        }
        footer={
          <>
            <div className="ml-auto flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
              {!onReview && (
                <p className="text-center text-[11px] text-[#8790a0] sm:text-right">
                  Your progress is saved at every step.
                </p>
              )}
              {onReview ? (
                <Button
                  type="button"
                  variant="dark"
                  size="lg"
                  icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                  isLoading={saving}
                  disabled={uploader.isUploading}
                  loadingText="Submitting…"
                  onClick={() => void submit()}
                >
                  Submit for verification
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="dark"
                  size="lg"
                  icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  iconPosition="right"
                  isLoading={saving}
                  disabled={uploader.isUploading}
                  loadingText="Saving…"
                  onClick={() => void next()}
                >
                  {section && isDocumentSection(section) ? "Continue" : "Save and continue"}
                </Button>
              )}
            </div>
          </>
        }
      >
        {banner && <ErrorState className="mb-5" message={banner} />}

        {onReview ? (
          <KybReview
            form={form}
            answers={answers}
            documents={documents}
            onEdit={(index) => goTo(index)}
          />
        ) : section && isDocumentSection(section) ? (
          <KybDocuments
            section={section}
            documents={documents}
            errors={errors}
            disabled={busy}
            uploader={uploader}
          />
        ) : section ? (
          <KybSectionFields
            form={form}
            section={section}
            answers={answers}
            errors={errors}
            disabled={busy}
            onChange={change}
          />
        ) : null}
      </StepCard>
    </SignupShell>
  );
}
