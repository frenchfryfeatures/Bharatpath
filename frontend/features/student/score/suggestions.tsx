"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import { NoteStrip, PillButton } from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function Suggestions() {
  const router = useRouter();
  return (
    <StudentPage>
      <StudentTopBar title="Update your resume" />
      <div className="flex flex-col gap-4">
        <h1 className="text-[26px] font-bold text-[#0A1931]">
          Keep your resume accurate
        </h1>
        <NoteStrip icon={<FileText size={16} />}>
          BharatPath does not generate point-targeted suggestions. Update your
          resume only when your real education, skills or experience changes.
        </NoteStrip>
        <PillButton onClick={() => router.push("/student/profile")}>
          Go to profile
        </PillButton>
      </div>
    </StudentPage>
  );
}
