"use client";

import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { useGetStudentScoreQuery } from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  EmptyState,
  NoteStrip,
  PillButton,
} from "@/features/student/components";
import { ScoreRing } from "@/features/student/components/score-ring";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function ScoreReveal() {
  const router = useRouter();
  const score = useGetStudentScoreQuery();

  return (
    <StudentPage>
      <StudentTopBar title="Your resume score" />
      {score.isLoading ? (
        <div className="rounded-2xl border border-[#E7E0D4] bg-white p-5 text-sm text-[#5F6B80]">
          Loading score…
        </div>
      ) : score.error ? (
        <EmptyState
          title="Score unavailable"
          message={getApiErrorMessage(score.error, "Could not load your score.")}
        />
      ) : score.data?.status === "READY" && score.data.value != null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col items-center gap-4 rounded-[24px] bg-[#5F4DB2] p-6">
            <ScoreRing value={score.data.value} max={990} />
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-[#F4D685]" />
              <span className="text-[13px] text-[#E0DBF4]">
                Band {score.data.band ?? "not available"}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <NoteStrip>
              Your score is computed from your confirmed resume. BharatPath does
              not expose a point-by-point breakdown.
            </NoteStrip>
            {score.data.computedAt ? (
              <span className="text-[12px] text-[#5F6B80]">
                Last computed{" "}
                {new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(score.data.computedAt))}
              </span>
            ) : null}
            <PillButton
              variant="secondary"
              onClick={() => router.push("/student/jobs")}
            >
              View eligible jobs
            </PillButton>
          </div>
        </div>
      ) : (
        <EmptyState
          title="Your score is being prepared"
          message="Once your confirmed resume has been scored, it will appear here."
        />
      )}
    </StudentPage>
  );
}
