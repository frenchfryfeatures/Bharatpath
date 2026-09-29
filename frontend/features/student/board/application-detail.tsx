"use client";

import { useParams } from "next/navigation";
import { Check, ExternalLink, Undo2 } from "lucide-react";

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
  NoteStrip,
  PillButton,
  StatusChip,
  StudentCard,
} from "@/features/student/components";
import { StudentApplicationDetailSkeleton } from "@/features/student/loading";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function ApplicationDetail() {
  const params = useParams<{ id: string }>();
  const application = useGetStudentApplicationQuery(params.id);
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
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <MonogramTile tint="indigo" size={48}>
              {employerMonogram(item.employerName)}
            </MonogramTile>
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[15px] font-bold text-[#0A1931]">
                {item.employerName ?? "Employer"}
              </span>
              <span className="text-[12px] text-[#5F6B80]">
                Applied {formatDate(item.createdAt)}
              </span>
            </div>
            <StatusChip
              tone={closed ? "neutral" : "advanced"}
            >
              {stageLabel(item.stage)}
            </StatusChip>
          </div>

          <StudentCard>
            <span className="text-[15px] font-semibold text-[#0A1931]">
              Where things stand
            </span>
            <ol className="mt-4 flex flex-col">
              {timeline.map((step, index) => (
                <li key={step.label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={[
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full",
                        step.reached
                          ? "bg-[#5F4DB2] text-white"
                          : "border border-[#E7E0D4] bg-white text-[#B5AC96]",
                      ].join(" ")}
                    >
                      {step.reached ? <Check size={12} /> : null}
                    </span>
                    {index < timeline.length - 1 ? (
                      <span className="min-h-6 w-px flex-1 bg-[#E7E0D4]" />
                    ) : null}
                  </div>
                  <span className="pb-5 text-[14px] text-[#3A4761]">
                    {step.label}
                  </span>
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
                      {stageLabel(event.toStage)}
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

        <div className="flex flex-col gap-3">
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
                onClick={() => void confirmHire(item.id)}
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

          {!closed ? (
            <PillButton
              variant="secondary"
              className="w-full !text-[#3A4761]"
              icon={<Undo2 size={16} />}
              disabled={withdrawState.isLoading}
              onClick={() => void withdraw(item.id)}
            >
              Withdraw application
            </PillButton>
          ) : null}

          {actionError ? (
            <NoteStrip tone="amber">
              {getApiErrorMessage(actionError, "Could not update the application.")}
            </NoteStrip>
          ) : null}
        </div>
      </div>
    </StudentPage>
  );
}
