"use client";

import { EyeOff, Info } from "lucide-react";

import { EmptyState, NoteStrip } from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function WhoSawMe() {
  return (
    <StudentPage>
      <div className="flex flex-col gap-4">
        <StudentTopBar title="Profile visibility" />
        <EmptyState
          icon={<EyeOff size={22} />}
          title="View history is not available"
          message="Employer profile-view history is not available in your account yet."
        />
        <NoteStrip icon={<Info size={16} />}>
          Your resume file is never returned through employer discovery.
        </NoteStrip>
      </div>
    </StudentPage>
  );
}
