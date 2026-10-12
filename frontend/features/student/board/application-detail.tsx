"use client";

import { useParams } from "next/navigation";
import { useGetApplicationMessagesQuery } from "@/store/student/learning.api";
import { CalendarDays, Check, ExternalLink, Undo2 } from "lucide-react";

import {
  useConfirmStudentHireMutation,
  useDisputeStudentHireMutation,
  useGetStudentApplicationQuery,
  useWithdrawStudentApplicationMutation,
} from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  applicationTimeline,
  employerMonogram,
  formatDate,
  formatDateTime,
  stageLabel,
} from "@/features/student/formatters";
import {
  EmptyState,
  MonogramTile,
  PillButton,
  StatusChip,
  StudentCard,
  StudentErrorState,
} from "@/features/student/components";
import { StudentApplicationDetailSkeleton } from "@/features/student/loading";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function ApplicationDetail() {
  const params = useParams<{ id: string }>();
  const application = useGetStudentApplicationQuery(params.id);
  const messages = useGetApplicationMessagesQuery(params.id);
  const [withdraw, withdrawState] = useWithdrawStudentApplicationMutation();
  const [confirmHire, confirmState] = useConfirmStudentHireMutation();
  const [disputeHire, disputeState] = useDisputeStudentHireMutation();

  if (application.isLoading) {
    return <StudentApplicationDetailSkeleton />;
  }

  if (!application.data || application.error) {
    return (
      <StudentPage>
        <StudentTopBar title="Application" />
        <EmptyState
          title="Application unavailable"
          message={getApiErrorMessage(
            application.error,
            "This application is no longer available.",
          )}
        />
      </StudentPage>
    );
  }

  const item = application.data;
  const timeline = applicationTimeline(item);
  const closed = ["HIRED", "REJECTED", "WITHDRAWN", "EXPIRED"].includes(
    item.stage,
  );
  const actionError =
    withdrawState.error ?? confirmState.error ?? disputeState.error;

  return (
    <StudentPage>
      <StudentTopBar title={item.jobTitle ?? "Application"} />
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="rounded-2xl border border-[#E9E3D9] bg-gradient-to-br from-white to-[#FFFCF7] p-5 shadow-[0_2px_10px_rgba(32,40,56,0.035)] sm:p-6">
            <div className="flex flex-wrap items-center gap-4">
              <MonogramTile tint="indigo" size={52} logoUrl={item.employerLogoUrl}>
                {employerMonogram(item.employerName)}
              </MonogramTile>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#778197]">Employer</p>
                <h2 className="mt-1 truncate text-[17px] font-bold text-[#0A1931]">{item.employerName ?? "Employer"}</h2>
                <p className="mt-1 text-[12px] text-[#5F6B80]">Applied {formatDate(item.createdAt)}</p>
              </div>
              <StatusChip tone={closed ? "neutral" : "advanced"}>{stageLabel(item.stage)}</StatusChip>
            </div>
          </section>

          <StudentCard>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><span className="text-[15px] font-semibold text-[#0A1931]">Where things stand</span><p className="mt-1 text-[12px] text-[#778197]">Follow your application through each stage.</p></div>
              {item.stage === "WITHDRAWN" || item.stage === "REJECTED" || item.stage === "EXPIRED" ? null : <span className="rounded-full bg-[#F3F0FB] px-2.5 py-1 text-[11px] font-semibold text-[#5F4DB2]">{timeline.filter((step) => step.reached).length} of {timeline.length} stages</span>}
            </div>
            <ol className="mt-5 flex flex-col">
              {timeline.map((step, index) => (
                <li key={step.label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={["grid h-7 w-7 shrink-0 place-items-center rounded-full", step.reached ? "bg-[#5F4DB2] text-white shadow-[0_2px_6px_rgba(95,77,178,0.22)]" : "border border-[#E7E0D4] bg-white text-[#B5AC96]"].join(" ")}>
                      {step.reached ? <Check size={13} /> : null}
                    </span>
                    {index < timeline.length - 1 ? <span className="min-h-6 w-px flex-1 bg-[#E7E0D4]" /> : null}
                  </div>
                  <span className={`pb-5 pt-1 text-[14px] ${step.reached ? "font-medium text-[#25334D]" : "text-[#8490A3]"}`}>{step.label}</span>
                </li>
              ))}
            </ol>
          </StudentCard>

          {item.history?.length ? (
            <StudentCard>
              <span className="text-[15px] font-semibold text-[#0A1931]">
                Activity
              </span>
              <div className="mt-3 flex flex-col gap-3">
                {item.history.map((event) => (
                  <div
                    key={`${event.kind}-${event.occurredAt}`}
                    className="flex justify-between gap-3 text-[12px]"
                  >
                    <span className="text-[#3A4761]">
                      {event.kind === "HIRE_PROPOSED" ? "Hire proposed" : event.kind === "HIRE_DISPUTED" ? "Hire disputed" : stageLabel(event.toStage)}
                    </span>
                    <span className="text-[#5F6B80]">
                      {formatDateTime(event.occurredAt)}
                    </span>
                  </div>
                ))}
              </div>
            </StudentCard>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
          {!closed ? (
            <StudentCard className="!border-[#E9E3D9] !bg-[#FFFCF7]">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#5F4DB2] ring-1 ring-[#EEE9F3]"><Undo2 size={17} /></span>
                <div><p className="text-[14px] font-semibold text-[#0A1931]">Need to step back?</p><p className="mt-1 text-[12px] leading-5 text-[#68758A]">You can withdraw this application. The employer will be notified.</p></div>
              </div>
              <PillButton
                variant="secondary"
                className="mt-4 w-full !text-[#3A4761]"
                disabled={withdrawState.isLoading}
                onClick={() => {
                  if (window.confirm("Withdraw this application? The employer will be notified.")) void withdraw(item.id);
                }}
              >
                {withdrawState.isLoading ? "Withdrawing…" : "Withdraw application"}
              </PillButton>
            </StudentCard>
          ) : null}

          {messages.data && messages.data.length > 0 ? (
            <StudentCard>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-[#0A1931]">
                    Employer messages
                  </h2>
                </div>
                <span className="text-[12px] text-[#5F6B80]">
                  {messages.data.length} {messages.data.length === 1 ? "update" : "updates"}
                </span>
              </div>
              <ol className="mt-3 divide-y divide-[#EEE9F3] border-t border-[#EEE9F3]">
                {messages.data.map((message) => {
                  const isInterview = message.kind === "INTERVIEW";
                  const isAssessment = message.kind === "ASSESSMENT";
                  const label = isInterview ? "Interview" : isAssessment ? "Assessment" : "Message";

                  return (
                    <li key={message.id} className="py-4 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-[#5F4DB2]">
                          {label}
                        </span>
                        <time dateTime={message.created_at} className="text-[11px] text-[#5F6B80]">
                          {formatDateTime(message.created_at)}
                        </time>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#3A4761]">
                        {message.body}
                      </p>
                      {message.scheduled_at ? (
                        <div className="mt-2 flex items-start gap-2 text-[#5F6B80]">
                          <CalendarDays size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <time dateTime={message.scheduled_at} className="text-[12px] font-medium leading-relaxed text-[#3A4761]">
                            <span className="font-normal text-[#5F6B80]">Scheduled: </span>
                            {formatDateTime(message.scheduled_at)}
                          </time>
                        </div>
                      ) : null}
                      {message.link ? (
                        <a
                          href={message.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded text-[12px] font-semibold text-[#5F4DB2] underline-offset-4 transition-colors hover:text-[#4A3E8F] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F4DB2]"
                        >
                          {isInterview ? "Open invitation" : isAssessment ? "Open assessment" : "Open link"}
                          <ExternalLink size={14} aria-hidden="true" />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </StudentCard>
          ) : null}
          {item.interview ? (
            <StudentCard>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#4A3E8F]">
                Interview scheduled
              </span>
              <span className="mt-2 block text-[18px] font-bold text-[#0A1931]">
                {formatDateTime(item.interview.interviewAt)}
              </span>
              <a
                href={item.interview.meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 text-[14px] font-semibold text-[#5F4DB2] underline-offset-2 transition-colors hover:text-[#4A3E8F] hover:underline"
              >
                Join interview <ExternalLink size={14} />
              </a>
            </StudentCard>
          ) : null}

          {item.hireConfirmation === "PENDING" ? (
            <>
              <PillButton
                className="w-full"
                disabled={confirmState.isLoading}
                onClick={() => {
                  if (window.confirm("Confirm that you were hired? This confirms the hire for both sides.")) void confirmHire(item.id);
                }}
              >
                Confirm hire
              </PillButton>
              <PillButton
                variant="secondary"
                className="w-full"
                disabled={disputeState.isLoading}
                onClick={() => void disputeHire(item.id)}
              >
                Dispute hire
              </PillButton>
            </>
          ) : null}

          {actionError ? (
            <StudentErrorState
              variant="inline"
              error={actionError}
              fallback="Could not update the application."
            />
          ) : null}
        </div>
      </div>
    </StudentPage>
  );
}
