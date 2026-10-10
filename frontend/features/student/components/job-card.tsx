"use client";

import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
} from "lucide-react";

import type { JobListing } from "@/features/student/types";
import {
  employerMonogram,
  formatDate,
  formatSalary,
  workModeLabel,
} from "@/features/student/formatters";

import { interactiveCardClass, MonogramTile, StatusChip } from "./primitives";

export function JobCard({ job, matchedSkills }: { job: JobListing; matchedSkills?: string[] }) {
  const router = useRouter();
  const open = () => router.push(`/student/jobs/${job.id}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className={`flex flex-col gap-3.5 rounded-[20px] border border-[#E7E0D4] bg-white p-4 text-left ${interactiveCardClass}`}
    >
      <div className="flex items-center gap-3">
        <MonogramTile tint="indigo" logoUrl={job.employerLogoUrl}>
          {employerMonogram(job.employerName)}
        </MonogramTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[16px] font-bold leading-5 tracking-[-0.02em] text-[#0A1931]">
            {job.title}
          </span>
          <span className="truncate text-[13px] leading-4 text-[#5F6B80]">
            {job.employerName ?? "Employer"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[14px] font-bold leading-[18px] text-[#0A1931]">
          {formatSalary(job)}
        </span>
        <Dot />
        <span className="text-[13px] leading-[18px] text-[#5F6B80]">
          {job.location ?? "Location not specified"}
        </span>
        <Dot />
        <span className="text-[13px] leading-[18px] text-[#5F6B80]">
          {workModeLabel(job.workMode)}
        </span>
      </div>

      {matchedSkills && matchedSkills.length > 0 ? (
        <p className="text-[12px] leading-4 text-[#4A3E8F]">
          <span className="font-semibold">Matches:</span> {matchedSkills.join(", ")}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-t border-[#F0EBDF] pt-3">
        <Clock size={14} className="text-[#5F6B80]" />
        <span className="flex-1 text-[12px] leading-4 text-[#5F6B80]">
          Posted {formatDate(job.publishedAt)}
        </span>
        {job.eligibility === "ELIGIBLE" ? (
          <StatusChip tone="match" icon={<CheckCircle2 size={12} />}>
            Eligible
          </StatusChip>
        ) : (
          <StatusChip tone="waiting">
            {job.eligibility === "SCORE_PENDING"
              ? "Score pending"
              : "Not eligible"}
          </StatusChip>
        )}
        <ChevronRight size={13} className="text-[#6E7889]" />
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-[3px] w-[3px] rounded-full bg-[#B5AC96]" />;
}
