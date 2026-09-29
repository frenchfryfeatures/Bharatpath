"use client";

import { useRouter } from "next/navigation";

import type { JobApplication } from "@/features/student/types";
import {
  employerMonogram,
  formatDate,
  stageIndex,
  stageLabel,
} from "@/features/student/formatters";

import {
  interactiveCardClass,
  MonogramTile,
  StatusChip,
  type ChipTone,
} from "./primitives";

const STATUS_TONE: Record<JobApplication["stage"], ChipTone> = {
  SUBMITTED: "waiting",
  VIEWED: "waiting",
  SHORTLISTED: "advanced",
  INTERVIEW: "advanced",
  DECISION: "waiting",
  HIRED: "advanced",
  REJECTED: "short",
  WITHDRAWN: "neutral",
  EXPIRED: "neutral",
};

export function ApplicationCard({
  application,
}: {
  application: JobApplication;
}) {
  const router = useRouter();
  const progress = stageIndex(application.stage);

  return (
    <button
      type="button"
      onClick={() => router.push(`/student/board/${application.id}`)}
      className={`flex w-full flex-col gap-3 rounded-[20px] border border-[#E7E0D4] bg-white p-4 text-left ${interactiveCardClass}`}
    >
      <div className="flex items-center gap-3">
        <MonogramTile tint="indigo" size={40}>
          {employerMonogram(application.employerName)}
        </MonogramTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[15px] font-bold leading-5 tracking-[-0.02em] text-[#0A1931]">
            {application.jobTitle ?? "Job application"}
          </span>
          <span className="truncate text-[12px] leading-4 text-[#5F6B80]">
            {application.employerName ?? "Employer"} · applied{" "}
            {formatDate(application.createdAt)}
          </span>
        </div>
        <StatusChip tone={STATUS_TONE[application.stage]}>
          {stageLabel(application.stage)}
        </StatusChip>
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex gap-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <span
              key={index}
              className="h-1 flex-1 rounded-full"
              style={{
                background: index < progress ? "#5E4DB2" : "#F0EBDF",
              }}
            />
          ))}
        </span>
        <span className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase leading-3 tracking-[0.06em] text-[#5F6B80]">
            Stage {progress} of 5
          </span>
          <span className="text-[11px] font-medium leading-3 text-[#3A4761]">
            {stageLabel(application.stage)}
          </span>
        </span>
      </div>
    </button>
  );
}
