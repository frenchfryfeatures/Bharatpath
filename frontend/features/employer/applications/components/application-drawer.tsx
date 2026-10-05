"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useGetEmployerApplicationQuery } from "@/store/employer/applications/applications.api";
import { useScrollLock } from "@/hooks/use-scroll-lock";

import type { EmployerApplication, ApplicationStage } from "../types";
import { getScoreBand } from "../band";
import { APPLICATION_STAGES } from "../drawer-data";
import { StageProgress, StageMoveControls } from "./drawer-stage-controls";
import { InterviewField } from "./drawer-interview-field";
import { HirePanel } from "./drawer-hire-panel";
import { ApplicationMessages } from "./application-messages";

interface ApplicationDrawerProps {
  application: EmployerApplication | null;
  onClose: () => void;
  onMoveStage: (stage: ApplicationStage) => void;
  onMeetingLinkChange: (value: string) => void;
  onConfirmHire: () => void;
}

export function ApplicationDrawer({
  application,
  onClose,
  onMoveStage,
  onMeetingLinkChange,
  onConfirmHire,
}: ApplicationDrawerProps) {
  useScrollLock(application !== null);
  const detail = useGetEmployerApplicationQuery(application?.id ?? "", { skip: !application });
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    if (!application) return;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [application]);

  if (!application) {
    return null;
  }

  const candidate = application.candidate;
  const resume = detail.currentData ? detail.currentData.resume : application.resume;
  const band = getScoreBand(application.candidate.exactScore);

  const currentStage = Number(application.stage);
  const currentStageLabel =
    application.outcome === "hired"
      ? "Hired"
      : application.outcome === "rejected"
        ? "Rejected"
        : application.outcome === "withdrawn"
          ? "Withdrawn"
          : application.outcome === "expired"
            ? "Expired"
            : APPLICATION_STAGES[currentStage]?.label ?? "Submitted";

  const canConfirmHire =
    currentStage === 4 &&
    application.outcome === null &&
    !application.hireEmployerConfirmed;

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-50">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close application drawer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[rgba(19,26,38,0.4)]"
      />

      {/* Drawer */}
      <aside className="absolute right-0 top-0 flex h-full w-[520px] max-w-[100vw] flex-col bg-white shadow-[-8px_0_30px_rgba(19,26,38,0.14)]">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[#e7e9ee] px-6 py-5">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="truncate text-[16px] font-semibold leading-[21px] text-[#151b2b]">
              {candidate.name}
            </span>

            <span className="truncate text-[12px] font-normal leading-[17px] text-[#777f90]">
              Applied to {application.candidate.jobTitle} · {application.appliedDate}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#e1e5eb] bg-white text-[#151b2b] transition hover:bg-[#f3f4f7]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-5">
            {/* Score band */}
            <span
              className="w-fit rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.04em]"
              style={{
                backgroundColor: band.background,
                color: band.color,
              }}
            >
              {application.candidate.exactScore === null
                ? band.label
                : `${band.label} · ${application.candidate.exactScore}`}
            </span>

            <StageProgress
              currentStage={currentStage}
              currentStageLabel={currentStageLabel}
            />

            <section className="space-y-3 rounded-lg border border-[#e7e9ee] p-4">
              <h3 className="text-sm font-semibold text-[#151b2b]">Resume</h3>
              {detail.isFetching ? <p role="status" className="text-xs text-[#777f90]">Loading resume...</p> : detail.isError ? (
                <div className="text-xs"><p>Unable to load resume.</p><button type="button" onClick={() => void detail.refetch()} className="mt-2 font-semibold text-[#51449a]">Retry</button></div>
              ) : resume ? (
                <>
                  {resume.file_url && (resume.file_url_expires_at && Date.parse(resume.file_url_expires_at) <= currentTime ? (
                    <button type="button" onClick={() => void detail.refetch()} className="text-xs font-semibold text-[#51449a]">Refresh resume download link</button>
                  ) : <a href={resume.file_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[#51449a] hover:underline">Download original resume</a>)}
                  {resume.sections.length > 0 ? resume.sections.map((section, index) => (
                    <div key={`${section.kind}-${index}`}>
                      <h4 className="text-xs font-semibold text-[#273142]">{section.heading || section.kind.replaceAll("_", " ")}</h4>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#43516a]">{section.body}</p>
                    </div>
                  )) : <p className="whitespace-pre-wrap break-words text-xs leading-5 text-[#43516a]">{resume.text || "No resume content is available."}</p>}
                </>
              ) : <p className="text-xs text-[#777f90]">No confirmed resume is available.</p>}
            </section>

            {application.outcome === null && (
              <StageMoveControls
                currentStage={currentStage}
                application={application}
                onMoveStage={onMoveStage}
              />
            )}

            {currentStage === 3 && application.outcome === null && (
              <InterviewField
                meetingLink={application.meetingLink}
                onMeetingLinkChange={onMeetingLinkChange}
              />
            )}

            {currentStage === 4 &&
              (application.outcome === null || application.outcome === "hired") && (
              <HirePanel
                employerConfirmed={Boolean(application.hireEmployerConfirmed)}
                candidateConfirmed={Boolean(application.hireCandidateConfirmed)}
                canConfirmHire={canConfirmHire}
                onConfirmHire={onConfirmHire}
              />
            )}
            {!application.outcome && <ApplicationMessages applicationId={application.id} />}
          </div>
        </div>
      </aside>
    </div>
  );
}
