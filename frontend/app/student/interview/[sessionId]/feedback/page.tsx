"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  House,
  Lightbulb,
  LoaderCircle,
} from "lucide-react";

import { StudentErrorState } from "@/features/student/components";
import { Skeleton } from "@/components/common/loading";
import { StudentPage } from "@/features/student/shell";
import { useGetInterviewReportQuery } from "@/store/student/learning.api";

const LEVEL_LABELS = {
  STRONG: "Strength",
  DEVELOPING: "Developing",
  FOCUS_AREA: "Focus area",
} as const;

const LEVEL_STYLES = {
  STRONG: "bg-[#E6F1EA] text-[#1F6B45]",
  DEVELOPING: "bg-[#F7EFD6] text-[#7A5C0E]",
  FOCUS_AREA: "bg-[#F9E2DA] text-[#8A3E2A]",
} as const;

export default function InterviewFeedbackPage() {
  const id = useParams<{ sessionId: string }>().sessionId;
  const router = useRouter();
  const report = useGetInterviewReportQuery(id, {
    pollingInterval: 5_000,
    skipPollingIfUnfocused: true,
  });

  const data = report.data;
  const dimensionsByCode = new Map(
    data?.dimensions.map((dimension) => [dimension.code, dimension]) ?? [],
  );
  const focusLabels =
    data?.focus_areas
      .map((code) => dimensionsByCode.get(code)?.label)
      .filter((label): label is string => Boolean(label)) ?? [];

  return (
    <StudentPage>
      <main className="w-full pb-8">
        <button
          type="button"
          onClick={() => router.push("/student/interview")}
          className="mb-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#3A4761] transition-colors hover:text-[#5F4DB2]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full border border-[#E7E0D4] bg-white shadow-sm">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </span>
          Interview feedback
        </button>

        {report.isLoading ? (
          <FeedbackLoading />
        ) : report.isError ? (
          <StudentErrorState
            error={report.error}
            title="Interview feedback could not be loaded"
            fallback="We could not load this report."
            onRetry={() => void report.refetch()}
          />
        ) : data?.status === "PENDING" ? (
          <FeedbackPending />
        ) : data?.status === "FAILED" ? (
          <FeedbackFailed reason={data.failure_reason} />
        ) : data?.status === "READY" ? (
          <>
            <section className="overflow-hidden rounded-2xl bg-[#604BB5] px-6 py-7 text-white shadow-[0_12px_35px_rgba(67,49,143,0.18)] sm:px-8 sm:py-8">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-[#604BB5]">
                <Check className="h-6 w-6 stroke-[3]" aria-hidden="true" />
              </span>
              <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
                Your practice feedback
              </h1>
              <p className="mt-2 max-w-xl text-[14px] leading-6 text-white/80">
                Levels describe this interview only. They do not change your score.
              </p>
            </section>

            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
              <aside className="space-y-5">
                <section>
                  <SectionTitle>Feedback areas</SectionTitle>
                  <div className="mt-3 divide-y divide-[#EEE8DC] rounded-2xl border border-[#E7E0D4] bg-white px-5 shadow-[0_4px_20px_rgba(10,25,49,0.04)]">
                    {data.dimensions.map((dimension) => (
                      <div key={dimension.code} className="py-4">
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="text-[14px] font-bold text-[#0A1931]">
                            {dimension.label}
                          </h2>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${LEVEL_STYLES[dimension.level]}`}>
                            {LEVEL_LABELS[dimension.level]}
                          </span>
                        </div>
                        <p className="mt-2 text-[12px] leading-5 text-[#5F6B80]">
                          {dimension.what_good_looks_like}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl bg-[#F1EEFB] p-5">
                  <div className="flex items-center gap-2 text-[#0A1931]">
                    <Lightbulb className="h-5 w-5 text-[#604BB5]" aria-hidden="true" />
                    <h2 className="text-[15px] font-bold">Focus next time</h2>
                  </div>
                  <p className="mt-2 text-[12px] leading-5 text-[#3A4761]">
                    {focusLabels.length ? focusLabels.join(" · ") : "Keep building on the strengths shown in this interview."}
                  </p>
                </section>
              </aside>

              <section>
                <SectionTitle>Answer by answer</SectionTitle>
                <div className="mt-3 space-y-4">
                  {data.questions.map((question) => (
                    <article
                      key={question.code}
                      className="rounded-2xl border border-[#E7E0D4] bg-white p-5 shadow-[0_4px_20px_rgba(10,25,49,0.04)] sm:p-6"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 text-[13px] font-bold text-[#604BB5]">
                          Q{question.index + 1}
                        </span>
                        <div className="min-w-0">
                          <h2 className="text-[16px] font-bold leading-6 text-[#0A1931] sm:text-[17px]">
                            {question.prompt}
                          </h2>
                          <p className="mt-3 text-[12px] font-medium text-[#7A8496]">
                            {question.spoken ? "Speech detected" : "No speech detected"}
                          </p>
                          {question.comment && (
                            <p className="mt-3 text-[13px] leading-6 text-[#3A4761]">
                              {question.comment}
                            </p>
                          )}
                          <p className="mt-3 text-[13px] leading-6 text-[#604BB5]">
                            <span className="font-semibold">A strong answer includes:</span>{" "}
                            {question.looking_for}
                          </p>
                          <blockquote className="mt-3 border-l-2 border-[#DED7F4] pl-3 text-[13px] italic leading-6 text-[#6A7487]">
                            “{question.transcript || "No answer was detected."}”
                          </blockquote>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:ml-[364px]">
              <Link
                href="/student/jobs"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#604BB5] px-5 py-3.5 text-[13px] font-bold text-white transition-colors hover:bg-[#4A3E8F]"
              >
                <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
                Find jobs
              </Link>
              <Link
                href="/student"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#DCD5C8] bg-white px-5 py-3.5 text-[13px] font-bold text-[#0A1931] transition-colors hover:bg-[#FFFCF7]"
              >
                <House className="h-4 w-4" aria-hidden="true" />
                Go home
              </Link>
            </div>
          </>
        ) : null}
      </main>
    </StudentPage>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5F6B80]">
      {children}
    </h2>
  );
}

function FeedbackLoading() {
  return (
    <div role="status" aria-label="Loading your feedback" className="min-h-[420px] rounded-2xl border border-[#E7E0D4] bg-white p-6 sm:p-8">
      <Skeleton width={54} height={54} circle />
      <Skeleton className="mt-6" width="52%" height={28} radius={8} />
      <Skeleton className="mt-5" width="100%" height={15} radius={7} />
      <Skeleton className="mt-3" width="84%" height={15} radius={7} />
      <div className="mt-8 grid gap-3 sm:grid-cols-2"><Skeleton width="100%" height={104} radius={14} /><Skeleton width="100%" height={104} radius={14} /></div>
    </div>
  );
}

function FeedbackPending() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-2xl border border-[#E7E0D4] bg-white px-6 text-center">
      <div className="max-w-md">
        <LoaderCircle className="mx-auto h-9 w-9 animate-spin text-[#604BB5]" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold text-[#0A1931]">Your feedback is being prepared</h1>
        <p className="mt-2 text-[13px] leading-6 text-[#5F6B80]">We are reviewing your answers. This page will update automatically.</p>
      </div>
    </div>
  );
}

function FeedbackFailed({ reason }: { reason: string | null }) {
  const message = reason === "no_speech"
    ? "We could not detect speech in your recorded answers."
    : "We could not prepare feedback for this interview.";
  return (
    <div className="rounded-2xl border border-[#E9D9A9] bg-[#FFF9E8] p-6 text-center">
      <h1 className="text-xl font-bold text-[#0A1931]">Feedback unavailable</h1>
      <p className="mt-2 text-[13px] leading-6 text-[#5F6B80]">{message}</p>
      <Link href="/student/interview" className="mt-5 inline-flex rounded-lg bg-[#604BB5] px-5 py-3 text-[12px] font-bold text-white">Back to interviews</Link>
    </div>
  );
}
