"use client";

import { ArrowLeft, Pencil, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { usePageHeader } from "@/components/layout/header-context";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import {
  APPLICANT_ACCESS_LABELS,
  formatJobDate,
  JobDescriptionView,
  QUESTION_TYPE_LABELS,
  VISIBILITY_LABELS,
  withJobDetailDefaults,
} from "@/features/jobs";
import { useGetEmployerJobQuery } from "@/store/employer/jobs";
import { useGetEmployerOrganisationQuery } from "@/store/employer/settings";

import { JobFormSkeleton } from "../components/job-form-skeleton";
import { jobViewFromApi } from "../job-view-data";
import type { ApiJobStatus } from "../types";

const STATUS: Record<ApiJobStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: "Draft", tone: "muted" },
  PUBLISHED: { label: "Live", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

export function JobViewPage({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { data: job, isLoading, isError, error } = useGetEmployerJobQuery(jobId);
  const { data: organisation } = useGetEmployerOrganisationQuery();

  usePageHeader("Job details", "Exactly what candidates read, with your team's notes beside it");

  if (isLoading) {
    return <JobFormSkeleton />;
  }

  if (isError || !job) {
    return (
      <main className="grid min-h-full place-items-center bg-[#f7f8fa] p-6">
        <EmployerErrorState
          variant="block"
          error={error}
          fallback="Couldn't load this job."
        />
      </main>
    );
  }

  const details = withJobDetailDefaults(job.details);
  const status = STATUS[job.status];

  return (
    <main className="min-h-full bg-[#f7f8fa]">
      <div className="w-full max-w-[1180px]">
        <button
          type="button"
          onClick={() => router.push("/employer/jobs")}
          className="mb-5 inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-[#283247] hover:text-[#151b2b]"
        >
          <ArrowLeft size={16} strokeWidth={2} />
          Back to jobs
        </button>

        <JobDescriptionView
          tone="employer"
          job={jobViewFromApi(job, organisation?.legalName ?? null)}
          badges={<StatusBadge label={status.label} tone={status.tone} />}
          actions={
            <>
              <button
                type="button"
                onClick={() => router.push(`/employer/applications?jobId=${job.id}`)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-[8px] border border-[#e1e5ea] bg-white px-4 py-2.5 text-sm font-semibold text-[#151b2b] transition hover:bg-[#f7f8fa]"
              >
                <Users size={15} aria-hidden="true" />
                Applicants
              </button>
              <button
                type="button"
                onClick={() => router.push(`/employer/jobs/${job.id}/edit`)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-[8px] bg-[#151b2b] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#222b3e]"
              >
                <Pencil size={15} aria-hidden="true" />
                {job.status === "DRAFT" || job.status === "PAUSED" ? "Edit job" : "Manage job"}
              </button>
            </>
          }
          aside={
            <>
              <InternalCard title="Hiring team">
                <Row label="Hiring manager">{details.hiring.hiring_manager || "Not set"}</Row>
                <Row label="Minimum score">
                  {job.min_score ? `${job.min_score}` : "No threshold"}
                </Row>
                <Row label="Created">{formatJobDate(job.created_at)}</Row>
                {job.closed_at ? <Row label="Closed">{formatJobDate(job.closed_at)}</Row> : null}
              </InternalCard>

              <InternalCard title="Visibility">
                <Row label="Job visibility">{VISIBILITY_LABELS[details.settings.visibility]}</Row>
                <Row label="Featured">{details.settings.featured ? "Yes" : "No"}</Row>
                <Row label="Employee referrals">
                  {details.settings.allow_referrals ? "Allowed" : "Not allowed"}
                </Row>
                <Row label="Applicant access">
                  {APPLICANT_ACCESS_LABELS[details.settings.applicant_access]}
                </Row>
                {details.settings.publish_on ? (
                  <Row label="Planned publication">
                    {formatJobDate(details.settings.publish_on)}
                  </Row>
                ) : null}
              </InternalCard>

              <InternalCard title="Screening questions">
                {details.screening_questions.length === 0 ? (
                  <p className="text-[13px] text-[#687386]">None added.</p>
                ) : (
                  <ol className="flex list-decimal flex-col gap-3 pl-4">
                    {details.screening_questions.map((question, index) => (
                      <li key={index} className="text-[13px] leading-5 text-[#283247]">
                        <span className="font-semibold text-[#151b2b]">{question.question}</span>
                        <span className="mt-0.5 block text-[12px] text-[#687386]">
                          {[
                            QUESTION_TYPE_LABELS[question.type],
                            question.mandatory ? "Mandatory" : "Optional",
                            question.knockout
                              ? `Knockout · passes on ${question.accepted_answers.join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {question.options.length ? (
                          <span className="block text-[12px] text-[#687386]">
                            Options: {question.options.join(", ")}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </InternalCard>
            </>
          }
        />
      </div>
    </main>
  );
}

function InternalCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)]">
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#687386]">
        {title}
      </h2>
      <p className="mb-3 text-[11px] text-[#98a1b0]">Only your team sees this.</p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[13px]">
      <span className="font-semibold text-[#687386]">{label}</span>
      <span className="text-right font-medium text-[#151b2b]">{children}</span>
    </div>
  );
}
