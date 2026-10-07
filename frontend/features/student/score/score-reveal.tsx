"use client";

import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import {
  useGetStudentScoreQuery,
  useGetStudentScoreScaleQuery,
} from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { Skeleton } from "@/components/common/loading";
import {
  EmptyState,
  NoteStrip,
  PillButton,
  ScoreBandBar,
  ScoreScaleUnavailable,
  StudentErrorState,
} from "@/features/student/components";
import { ScoreRing } from "@/features/student/components/score-ring";
import { bandLabel } from "@/features/student/formatters";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function ScoreReveal() {
  const router = useRouter();
  const score = useGetStudentScoreQuery();
  const scale = useGetStudentScoreScaleQuery();

  return (
    <StudentPage>
      <StudentTopBar title="Your resume score" />
      {score.isLoading ? (
        <div role="status" aria-label="Loading resume score" className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col items-center gap-5 rounded-[24px] bg-[#5F4DB2] p-6">
            <Skeleton className="opacity-55" width={190} height={190} circle />
            <Skeleton className="opacity-55" width={110} height={16} radius={7} />
          </div>
          <div className="rounded-[24px] border border-[#E7E0D4] bg-white p-6">
            <Skeleton width="58%" height={22} radius={7} />
            <Skeleton className="mt-5" width="100%" height={14} radius={6} />
            <Skeleton className="mt-3" width="80%" height={14} radius={6} />
            <Skeleton className="mt-7" width="100%" height={48} radius={12} />
          </div>
        </div>
      ) : score.error ? (
        <StudentErrorState
          title="Score unavailable"
          error={score.error}
          fallback="Could not load your score."
          onRetry={() => void score.refetch()}
        />
      ) : score.data?.status === "READY" && score.data.value != null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col items-center gap-5 rounded-[24px] bg-[#5F4DB2] p-6">
            {scale.isLoading ? (
              <div role="status" aria-busy="true" className="flex flex-col items-center gap-4">
                <span className="sr-only">Loading score scale</span>
                <Skeleton className="opacity-55" width={190} height={190} circle />
              </div>
            ) : scale.data ? (
              <ScoreRing
                value={score.data.value}
                min={scale.data.lowest}
                max={scale.data.highest}
              />
            ) : (
              <span className="py-10 text-[64px] font-extrabold leading-none tracking-[-0.045em] text-white">
                {score.data.value}
              </span>
            )}
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-[#F4D685]" />
              <span className="text-[13px] text-[#E0DBF4]">
                {bandLabel(score.data.band)} band
              </span>
            </div>
            {scale.data ? (
              <div className="w-full max-w-sm">
                <ScoreBandBar
                  scale={scale.data}
                  band={score.data.band}
                  value={score.data.value}
                  showLabels
                />
              </div>
            ) : scale.error ? (
              <ScoreScaleUnavailable
                onRetry={() => void scale.refetch()}
                message={getApiErrorMessage(
                  scale.error,
                  "The score scale could not be loaded.",
                )}
              />
            ) : null}
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
              onClick={() => router.push("/student")}
            >
              Continue to dashboard
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
