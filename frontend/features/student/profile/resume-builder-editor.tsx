"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { ResumeBuilderStep } from "@/features/student/onboarding/components/resume-builder-step";
import { getApiErrorCode, getApiErrorMessage, getApiErrorParams } from "@/lib/api/error-message";
import { showErrorFeedback, showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useConfirmResumeVersionMutation, useGetBuilderDraftQuery, useGetResumeScoringWindowQuery, type BuilderTemplateKey } from "@/store/student";

function nextScoringMessage(nextScoringAt: string | null | undefined): string {
  if (!nextScoringAt) return "You can apply this resume when your scoring window reopens.";
  const date = new Date(nextScoringAt);
  if (Number.isNaN(date.getTime())) return "You can apply this resume when your scoring window reopens.";
  const days = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
  const relative = days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`;
  const formatted = new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  }).format(date);
  return `You can apply this resume on ${formatted} IST (${relative}).`;
}

export function ResumeBuilderEditor({ templateKey, section, returnTo = "profile" }: { templateKey?: BuilderTemplateKey; section?: string; returnTo?: "profile" | "resume-details" }) {
  const router = useRouter();
  const draft = useGetBuilderDraftQuery();
  const scoringWindow = useGetResumeScoringWindowQuery();
  const [confirmVersion] = useConfirmResumeVersionMutation();
  const scoreWindow = scoringWindow.data;
  const scoringEligibilityKnown = scoreWindow !== undefined;
  const scoringCooldown = scoreWindow !== undefined && scoreWindow.intervalDays !== 0 && !scoreWindow.canConfirmNow;

  const checkScoringWindow = async () => {
    try {
      const freshWindow = await scoringWindow.refetch().unwrap();
      if (freshWindow.intervalDays !== 0 && !freshWindow.canConfirmNow) {
        showSuccessFeedback(nextScoringMessage(freshWindow.nextScoringAt));
        return false;
      }
      return true;
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "Score availability could not be checked. Try again."));
      return false;
    }
  };

  const finish = async (resumeVersionId: string, alreadyConfirmed: boolean) => {
    if (alreadyConfirmed) {
      showSuccessFeedback("Your resume is already up to date.");
    } else {
      try {
        await confirmVersion(resumeVersionId).unwrap();
        void scoringWindow.refetch();
        showSuccessFeedback("Resume saved and score update started.");
      } catch (failure) {
        void scoringWindow.refetch();
        if (getApiErrorCode(failure) !== "resume_scoring_cooldown") throw failure;
        const next = getApiErrorParams(failure)?.next_scoring_at;
        showSuccessFeedback(nextScoringMessage(typeof next === "string" ? next : scoringWindow.data?.nextScoringAt));
      }
    }
    router.replace("/student/profile/resume");
  };

  if (draft.isLoading || !draft.data && !draft.isError) {
    return <div className="grid min-h-full place-items-center text-sm text-[#5F4DB2]"><span className="inline-flex items-center gap-2"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Loading your resume…</span></div>;
  }

  if (draft.isError) {
    return <div className="mx-auto max-w-lg p-8 text-center" role="alert"><p className="text-sm text-red-700">Your resume details could not be loaded.</p><button type="button" onClick={() => void draft.refetch()} className="mt-3 rounded-full bg-[#5F4DB2] px-4 py-2 text-sm font-semibold text-white">Try again</button><button type="button" onClick={() => router.replace("/student/profile#profile-reports")} className="ml-3 text-sm underline">Back to profile</button></div>;
  }

  const selectedTemplate = templateKey ?? draft.data?.template_key ?? "classic";
  return (
    <div className="h-full min-h-0">
      <ResumeBuilderStep
        key={selectedTemplate}
        initialTemplate={selectedTemplate}
        focusSection={section}
        profileMode
        profileSubmissionLabel="Save & update score"
        profileSubmissionDisabled={scoringCooldown}
        profileSubmissionNotice={!scoringEligibilityKnown ? "Score availability is checked when you apply this resume." : scoringCooldown ? nextScoringMessage(scoringWindow.data?.nextScoringAt) : undefined}
        onBeforeSubmit={checkScoringWindow}
        onBack={() => router.replace(returnTo === "resume-details" ? "/student/profile/resume" : "/student/profile#profile-reports")}
        onSubmitted={(result) => finish(result.resume_version_id, result.confirmed)}
      />
    </div>
  );
}
