"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useGetEmployerApplicationQuery } from "@/store/employer/applications/applications.api";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { ResumeShowcase } from "@/features/employer/components/resume-showcase";

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
  onReject: () => void;
}

export function ApplicationDrawer({
  application,
  onClose,
  onMoveStage,
  onMeetingLinkChange,
  onConfirmHire,
  onReject,
}: ApplicationDrawerProps) {
  useScrollLock(application !== null);
  const detail = useGetEmployerApplicationQuery(application?.id ?? "", { skip: !application });
  const [isExpanded, setIsExpanded] = useState(false);
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
  const band = getScoreBand(
    application.candidate.exactScore ??
      (application.candidate.band === "STRONG" ? 850
        : application.candidate.band === "SOLID" ? 750
          : application.candidate.band === "DEVELOPING" ? 600
            : application.candidate.band === "ENTRY" ? 400
              : null),
  );

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
      <aside
        className={`absolute right-0 top-0 flex h-full ${
          isExpanded ? "w-[860px]" : "w-[540px]"
        } max-w-[100vw] flex-col bg-white shadow-[-8px_0_30px_rgba(19,26,38,0.14)] transition-[width] duration-200`}
      >
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

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-label={isExpanded ? "Standard width" : "Expand drawer"}
              title={isExpanded ? "Collapse drawer width" : "Expand drawer width"}
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#e1e5eb] bg-white text-[#151b2b] transition hover:bg-[#f3f4f7]"
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#e1e5eb] bg-white text-[#151b2b] transition hover:bg-[#f3f4f7]"
            >
              <X size={14} />
            </button>
          </div>
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

            <div>
              <h3 className="mb-1 text-sm font-semibold text-[#151b2b]">Resume</h3>
              {detail.isFetching ? (
                <p role="status" className="text-xs text-[#777f90]">
                  Loading resume...
                </p>
              ) : detail.isError ? (
                <div className="text-xs">
                  <p>Unable to load resume.</p>
                  <button
                    type="button"
                    onClick={() => void detail.refetch()}
                    className="mt-2 font-semibold text-[#51449a]"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <ResumeShowcase
                  resume={resume}
                  candidateName={candidate.name}
                  currentTime={currentTime}
                  onRefresh={() => void detail.refetch()}
                  isExpanded={isExpanded}
                  onToggleExpand={() => setIsExpanded((prev) => !prev)}
                />
              )}
            </div>

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
                canReject={currentStage === 4 && application.outcome === null}
                onReject={onReject}
              />
            )}
            {!application.outcome && <ApplicationMessages applicationId={application.id} />}
          </div>
        </div>
      </aside>
    </div>
  );
}
