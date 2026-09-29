"use client";

import { Info } from "lucide-react";

import { NoteStrip, PillButton } from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function ScoreBreakdown() {
  return (
    <StudentPage>
      <StudentTopBar title="Score details" />
      <div className="flex flex-col gap-4">
        <h1 className="text-[26px] font-bold text-[#0A1931]">
          Your score stays private and consistent
        </h1>
        <NoteStrip icon={<Info size={16} />}>
          BharatPath shows your current score and band, without a category
          breakdown or point-level explanation.
        </NoteStrip>
        <PillButton variant="secondary" onClick={() => history.back()}>
          Back to score
        </PillButton>
      </div>
    </StudentPage>
  );
}
