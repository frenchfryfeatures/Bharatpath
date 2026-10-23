"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { ResumeBuilderStep } from "@/features/student/onboarding/components/resume-builder-step";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useConfirmResumeVersionMutation, useGetBuilderDraftQuery, type BuilderTemplateKey } from "@/store/student";

export function ResumeBuilderEditor({ templateKey }: { templateKey?: BuilderTemplateKey }) {
  const router = useRouter();
  const draft = useGetBuilderDraftQuery();
  const [confirmVersion] = useConfirmResumeVersionMutation();

  const finish = async (resumeVersionId: string, alreadyConfirmed: boolean) => {
    if (!alreadyConfirmed) await confirmVersion(resumeVersionId).unwrap();
    showSuccessFeedback(alreadyConfirmed ? "Your resume is already up to date." : "Resume saved and score update started.");
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
        profileMode
        onBack={() => router.replace("/student/profile#profile-reports")}
        onSubmitted={(result) => finish(result.resume_version_id, result.confirmed)}
      />
    </div>
  );
}
