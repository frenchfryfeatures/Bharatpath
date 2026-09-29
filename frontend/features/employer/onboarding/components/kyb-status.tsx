"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";

import type { KybSubmission } from "@/store/employer/kyb";

import { StepCard } from "./signup-shell";

interface KybStatusProps {
  submission: KybSubmission;
  onRestart?: () => void;
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
export function KybStatus({ submission, onRestart }: Readonly<KybStatusProps>) {
  const submittedAt = formatDate(submission.submittedAt);

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
          </div>
        )}
        <p className="text-sm leading-6 text-[#4f5666]">
          You can correct your details and submit again. Your previous answers
          are filled in for you; documents need to be uploaded again.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {onRestart && (
            <button
              type="button"
              onClick={onRestart}
              className={`${primaryLink} cursor-pointer`}
            >
              Start a new submission
            </button>
          )}
          <Link href="/employer" className={secondaryLink}>
            Go to your dashboard
          </Link>
        </div>
      </StepCard>
    );
  }

  return (
    <StepCard eyebrow="Submitted" title="Verification in progress">
      <StatusIcon tone="pending" />
      <p className="text-sm leading-6 text-[#4f5666]">
        {submission.state === "UNDER_REVIEW"
          ? "A reviewer is looking at your details now."
          : "Thanks — your details are with our review team."}{" "}
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
    </StepCard>
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
