"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Loader2, RotateCcw, ShieldAlert } from "lucide-react";

import { ErrorState } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { openFreshDocument } from "@/lib/open-document";
import {
  useGetEmployerKybFormQuery,
  useLazyGetEmployerKybQuery,
  useSaveEmployerKybAnswersMutation,
  useSubmitEmployerKybMutation,
  type KybForm,
  type KybReviewFlag,
  type KybSection,
  type KybSubmission,
} from "@/store/employer/kyb";
import { KybDocuments } from "@/features/employer/onboarding/components/kyb-documents";
import { KybReviewBanner } from "@/features/employer/onboarding/components/kyb-review-banner";
import { KybSectionFields } from "@/features/employer/onboarding/components/kyb-section-fields";
import { useKybDocumentUpload } from "@/features/employer/onboarding/hooks/use-kyb-document-upload";
import {
  activeFlags,
  flagLabel,
  isDocumentSection,
  issuesFromError,
  problemCode,
  sectionPayload,
  uploadedDocuments,
  validateSection,
  type KybAnswers,
  type KybFieldErrors,
} from "@/features/employer/onboarding/kyb-form";

/**
 * Opens an uploaded KYB file. The link lasts 15 minutes, so each click asks
 * the server for a fresh one rather than reusing what the page loaded.
 */
export function useKybDocumentViewer() {
  const [load] = useLazyGetEmployerKybQuery();

  return (docType: string) =>
    openFreshDocument(async () => {
      const latest = await load(undefined, false).unwrap();
      return latest.documents.find((document) => document.docType === docType)?.url;
    });
}

/** Whether the owner has something to fix or restart in their verification. */
export function needsVerificationChanges(kyb: KybSubmission | undefined): boolean {
  return Boolean(
    kyb &&
      (kyb.state === "MORE_INFO_REQUIRED" ||
        kyb.state === "REJECTED" ||
        (kyb.state === "DRAFT" && kyb.previousSubmissionId)),
  );
}

interface CarriedReview {
  reason: string | null;
  flags: KybReviewFlag[];
}

/**
 * The verification a reviewer sent back or rejected, fixed from the profile.
 * Renders nothing in any other state, except a short thank-you right after
 * the corrections are submitted.
 */
export function KybChangesPanel({ kyb }: Readonly<{ kyb: KybSubmission }>) {
  // What a rejection raised, kept to guide the new draft that follows it.
  const [carried, setCarried] = useState<CarriedReview | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (needsVerificationChanges(kyb)) {
    return (
      <KybEditor
        key={kyb.submissionId ?? "none"}
        kyb={kyb}
        carried={carried}
        onRestarted={setCarried}
        onSubmitted={() => setSubmitted(true)}
      />
    );
  }

  if (submitted && kyb.state === "SUBMITTED") {
    return (
      <div
        role="status"
        className="rounded-xl border border-[#abefc6] bg-[#ecfdf3] p-4 text-[13px] leading-5 text-[#05603a]"
      >
        <span className="font-semibold">Corrections sent.</span> Our review team
        will check what changed and let you know. You will get an email and a
        notification.
      </div>
    );
  }

  return null;
}

interface KybEditorProps {
  kyb: KybSubmission;
  carried: CarriedReview | null;
  onRestarted: (review: CarriedReview) => void;
  onSubmitted: () => void;
}

function KybEditor({ kyb, carried, onRestarted, onSubmitted }: Readonly<KybEditorProps>) {
  const formQuery = useGetEmployerKybFormQuery();
  const form = formQuery.data;

  if (formQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#e0e4e9] bg-white p-5 text-xs text-[#687386]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your verification details…
      </div>
    );
  }

  if (!form) {
    return (
      <ErrorState
        error={formQuery.error}
        fallback="We could not load your verification form."
        onRetry={() => void formQuery.refetch()}
      />
    );
  }

  return kyb.state === "REJECTED" ? (
    <RejectedNotice kyb={kyb} form={form} onRestarted={onRestarted} />
  ) : (
    <ChangesForm kyb={kyb} form={form} carried={carried} onSubmitted={onSubmitted} />
  );
}

/* =========================================================
   Rejected: read the reason, then start a pre-filled draft
========================================================= */

function RejectedNotice({
  kyb,
  form,
  onRestarted,
}: Readonly<{
  kyb: KybSubmission;
  form: KybForm;
  onRestarted: (review: CarriedReview) => void;
}>) {
  const [saveAnswers, { isLoading }] = useSaveEmployerKybAnswersMutation();
  const [error, setError] = useState<string | null>(null);

  // An empty save makes the server open a new draft that already holds the
  // old answers and documents. The profile then re-renders as the editor.
  const startAgain = async () => {
    setError(null);
    try {
      await saveAnswers({ answers: {}, __suppressSuccessFeedback: true }).unwrap();
      onRestarted({ reason: kyb.decisionReason, flags: kyb.reviewFlags });
    } catch (failure) {
      setError(getApiErrorMessage(failure, "We could not start a new submission. Try again."));
    }
  };

  return (
    <section
      aria-label="Verification not approved"
      className="rounded-xl border border-[#fecdca] bg-[#fffbfa] p-5 shadow-sm sm:p-6"
    >
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fdecee] text-[#c52b2b]">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-[#111827]">Your verification was not approved</h2>
          {kyb.decisionReason && (
            <p className="mt-1 text-[13px] leading-5 text-[#7f1d2a]">
              <span className="font-semibold">Reviewer&apos;s note: </span>
              {kyb.decisionReason}
            </p>
          )}
        </div>
      </div>

      {kyb.reviewFlags.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-[#fecdca] pt-3">
          {kyb.reviewFlags.map((flag) => (
            <li key={flag.field} className="text-[13px] leading-5 text-[#7f1d2a]">
              <span className="font-semibold">{flagLabel(form, flag.field)}</span>
              {flag.note ? ` - ${flag.note}` : ""}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-5 text-[#687386]">
        This submission is closed. Starting again gives you a new one with your
        previous answers and documents already filled in, so you only need to fix
        what was raised and submit it.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-xs font-medium text-[#b42318]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void startAgain()}
        disabled={isLoading}
        className="mt-4 inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#17233a] px-5 text-xs font-semibold text-white transition hover:bg-[#223453] disabled:cursor-wait disabled:opacity-70"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        )}
        {isLoading ? "Preparing…" : "Start again"}
      </button>
    </section>
  );
}

/* =========================================================
   Sent back / new draft: edit what was flagged and resubmit
========================================================= */

function ChangesForm({
  kyb,
  form,
  carried,
  onSubmitted,
}: Readonly<{
  kyb: KybSubmission;
  form: KybForm;
  carried: CarriedReview | null;
  onSubmitted: () => void;
}>) {
  const [saveAnswers, { isLoading: isSaving }] = useSaveEmployerKybAnswersMutation();
  const [submitKyb, { isLoading: isSubmitting }] = useSubmitEmployerKybMutation();
  const viewDocument = useKybDocumentViewer();

  const [answers, setAnswers] = useState<KybAnswers>(() => ({ ...kyb.answers }));
  const [errors, setErrors] = useState<KybFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Flagged fields and documents the owner has changed since the review.
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());

  const markResolved = (code: string) =>
    setResolved((current) => (current.has(code) ? current : new Set(current).add(code)));

  const uploader = useKybDocumentUpload((_result, docType) => {
    markResolved(docType);
    setErrors((current) => {
      const next = { ...current };
      delete next[docType];
      return next;
    });
  });

  const documents = useMemo(() => uploadedDocuments(kyb), [kyb]);
  const uploaded = useMemo(() => new Set(documents.keys()), [documents]);

  // This submission's flags, or the ones that came with the rejection it was
  // started from.
  const allFlags = useMemo(
    () => (kyb.reviewFlags.length > 0 ? kyb.reviewFlags : (carried?.flags ?? [])),
    [kyb.reviewFlags, carried],
  );
  const flags = useMemo(() => activeFlags(allFlags, resolved), [allFlags, resolved]);
  const reason = carried?.reason ?? kyb.decisionReason;
  const sentBack = kyb.state === "MORE_INFO_REQUIRED";

  // Only what was raised, unless nothing specific was or the owner asks for more.
  const flaggedCodes = new Set(allFlags.map((flag) => flag.field));
  const includeAll = showAll || flaggedCodes.size === 0;
  const sections = form.sections
    .map((section): KybSection => ({
      ...section,
      fields: section.fields.filter((field) => includeAll || flaggedCodes.has(field.code)),
    }))
    .filter((section) => section.fields.length > 0);

  const busy = isSaving || isSubmitting || uploader.isUploading;

  const change = (code: string, value: unknown) => {
    markResolved(code);
    setAnswers((current) => ({ ...current, [code]: value }));
    setErrors((current) => {
      if (!current[code]) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  };

  const jumpTo = (code: string) => {
    document.getElementById(`kyb-field-${code}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const submit = async () => {
    if (busy) return;

    const found: KybFieldErrors = {};
    for (const section of sections) {
      Object.assign(found, validateSection(section, answers, uploaded));
    }

    if (Object.keys(found).length > 0) {
      setErrors(found);
      setBanner("Some details need attention. Check the highlighted fields.");
      const first = sections
        .flatMap((section) => section.fields)
        .find((field) => found[field.code]);
      if (first) jumpTo(first.code);
      return;
    }

    setErrors({});
    setBanner(null);

    const payload = Object.assign(
      {},
      ...sections.map((section) => sectionPayload(section, answers)),
    ) as KybAnswers;

    try {
      if (Object.keys(payload).length > 0) {
        await saveAnswers({ answers: payload, __suppressSuccessFeedback: true }).unwrap();
      }
      await submitKyb().unwrap();
      onSubmitted();
    } catch (error) {
      const fieldErrors = issuesFromError(form, error);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      }
      setBanner(
        problemCode(error) === "kyb_not_editable"
          ? "This verification has already been submitted and can no longer be edited."
          : getApiErrorMessage(error, "We could not submit your changes."),
      );
    }
  };

  return (
    <section
      aria-label="Verification changes"
      className="rounded-xl border border-[#f2cf93] bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="mb-4 border-b border-[#eef2f6] pb-4">
        <h2 className="text-[14px] font-bold text-[#111827]">
          {sentBack ? "Your verification needs changes" : "Update and resubmit your verification"}
        </h2>
        <p className="mt-0.5 text-xs text-[#687386]">
          Make the changes below and submit them for review. Everything else stays as you sent it.
        </p>
      </div>

      <KybReviewBanner
        form={form}
        variant={sentBack ? "sent_back" : "restarted"}
        reason={reason}
        flags={allFlags}
        resolved={resolved}
        disabled={busy}
        onJump={jumpTo}
      />

      {banner && <ErrorState className="mb-4" message={banner} />}

      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.code}>
            <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.06em] text-[#687386]">
              {section.title}
            </h3>
            {isDocumentSection(section) ? (
              <KybDocuments
                section={section}
                documents={documents}
                errors={errors}
                flags={flags}
                disabled={busy}
                uploader={uploader}
                onView={viewDocument}
              />
            ) : (
              <KybSectionFields
                form={form}
                section={section}
                answers={answers}
                errors={errors}
                flags={flags}
                disabled={busy}
                onChange={change}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-[#eef2f6] pt-4 sm:flex-row sm:items-center sm:justify-between">
        {flaggedCodes.size > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            disabled={busy}
            className="cursor-pointer text-left text-xs font-semibold text-[#3566b8] hover:underline disabled:opacity-50"
          >
            {showAll ? "Show only what was raised" : "Edit other verification details too"}
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#17233a] px-5 text-xs font-semibold text-white transition hover:bg-[#223453] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving || isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          )}
          {isSaving || isSubmitting ? "Submitting…" : "Submit for review"}
        </button>
      </div>
    </section>
  );
}
