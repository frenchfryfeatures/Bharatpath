"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";

import type { KybForm, KybSubmission } from "@/store/employer/kyb";

import { flagLabel } from "../kyb-form";
import { KybReviewHistory } from "./kyb-review-history";
import { StepCard } from "./signup-shell";

interface KybStatusProps {
  submission: KybSubmission;
  form?: KybForm;
  /** Opens a freshly fetched link to an uploaded file. */
  onViewDocument?: (docType: string) => Promise<boolean>;
}

function formatDate(value: string | null): string | null {
  return value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
}

const primaryLink =
  "inline-flex h-10 items-center justify-center rounded-lg bg-[#17233a] px-4 text-sm font-semibold text-white transition hover:bg-[#223453]";
const secondaryLink =
  "inline-flex h-10 items-center justify-center rounded-lg border border-[#dfe2e8] bg-white px-4 text-sm font-semibold text-[#303747] transition hover:bg-[#f8f9fb]";

/** What an employer sees once the submission can no longer be edited. */
export function KybStatus({
  submission,
  form,
  onViewDocument,
}: Readonly<KybStatusProps>) {
  const submittedAt = formatDate(submission.submittedAt);
  const extras = (
    <>
      <KybDocumentList
        form={form}
        submission={submission}
        onView={onViewDocument}
      />
      <KybReviewHistory
        form={form}
        reviews={submission.reviews}
        className="mt-6"
      />
    </>
  );

  if (submission.state === "APPROVED") {
    return (
      <StepCard eyebrow="All done" title="Your organisation is verified">
        <StatusIcon tone="success" />
        <p className="text-sm leading-6 text-[#4f5666]">
          {submission.autoApproved
            ? "Your details were accepted as soon as you submitted them."
            : "A reviewer has approved your details."}{" "}
          You can now publish jobs. Publishing also needs an active
          subscription, which you can choose from Settings &amp; Billing.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/employer" className={primaryLink}>
            Go to your dashboard
          </Link>
          <Link href="/employer/jobs/create" className={secondaryLink}>
            Post your first job
          </Link>
        </div>
        {extras}
      </StepCard>
    );
  }

  if (submission.state === "REJECTED") {
    return (
      <StepCard eyebrow="Verification" title="Your verification was not approved">
        <StatusIcon tone="danger" />
        {submission.decisionReason && (
          <div className="mb-4 rounded-xl border border-[#f0c8cc] bg-[#fff7f7] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9f2432]">
              Reviewer&apos;s note
            </p>
            <p className="mt-1 text-sm leading-6 text-[#7f1d2a]">
              {submission.decisionReason}
            </p>

            {submission.reviewFlags.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-[#f0c8cc] pt-3">
                {submission.reviewFlags.map((flag) => (
                  <li
                    key={flag.field}
                    className="text-[13px] leading-5 text-[#7f1d2a]"
                  >
                    <span className="font-semibold">
                      {flagLabel(form, flag.field)}
                    </span>
                    {flag.note ? ` - ${flag.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-sm leading-6 text-[#4f5666]">
          This submission is closed. You can start a new one from your company
          profile, with your previous answers and documents already filled in.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/employer/settings" className={primaryLink}>
            Open company profile
          </Link>
          <Link href="/employer" className={secondaryLink}>
            Go to your dashboard
          </Link>
        </div>
        {extras}
      </StepCard>
    );
  }

  return (
    <StepCard eyebrow="Submitted" title="Verification in progress">
      <StatusIcon tone="pending" />
      <p className="text-sm leading-6 text-[#4f5666]">
        {submission.state === "UNDER_REVIEW"
          ? "A reviewer is looking at your details now."
          : submission.reviews.length > 0
            ? "Thanks - your corrections are back with our review team, who will check what changed."
            : "Thanks - your details are with our review team."}{" "}
        This usually takes 1 to 2 business days. You can draft jobs and browse
        candidates while you wait; publishing opens once you are verified.
      </p>
      {submittedAt && (
        <p className="mt-3 text-xs text-[#8790a0]">Submitted {submittedAt}</p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href="/employer" className={primaryLink}>
          Go to your dashboard
        </Link>
      </div>
      {extras}
    </StepCard>
  );
}

/** Uploaded documents, each openable. Links last 15 minutes, so each click asks for a fresh one. */
function KybDocumentList({
  form,
  submission,
  onView,
}: {
  form?: KybForm;
  submission: KybSubmission;
  onView?: (docType: string) => Promise<boolean>;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (submission.documents.length === 0) {
    return null;
  }

  return (
    <section className="mt-6" aria-label="Uploaded documents">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8790a0]">
        Your documents
      </h3>
      <ul className="divide-y divide-[#eef1f5] rounded-xl border border-[#e1e6ee] bg-white">
        {submission.documents.map((document) => (
          <li
            key={document.docType}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-[#303747]">
              <FileText
                className="h-4 w-4 shrink-0 text-[#8790a0]"
                aria-hidden="true"
              />
              <span className="truncate">
                {flagLabel(form, document.docType)}
              </span>
            </span>
            {onView && (
              <button
                type="button"
                disabled={opening === document.docType}
                onClick={async () => {
                  setOpening(document.docType);
                  setFailed(false);
                  const opened = await onView(document.docType);
                  setFailed(!opened);
                  setOpening(null);
                }}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#3566b8] transition hover:bg-[#f3f7fd] disabled:cursor-wait disabled:opacity-60"
              >
                {opening === document.docType ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                View
              </button>
            )}
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="mt-2 text-xs font-medium text-[#b42318]">
          We could not open that file. Try again.
        </p>
      )}
    </section>
  );
}

function StatusIcon({ tone }: { tone: "success" | "pending" | "danger" }) {
  const styles = {
    success: "bg-[#e3f4ee] text-[#1f8a70]",
    pending: "bg-[#eaf1fb] text-[#3566b8]",
    danger: "bg-[#fdecee] text-[#c52b2b]",
  }[tone];

  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : Clock3;

  return (
    <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${styles}`}>
      <Icon className="h-6 w-6" aria-hidden="true" />
    </span>
  );
}
