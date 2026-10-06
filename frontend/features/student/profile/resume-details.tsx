"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CheckCircle2, FileText, History, ShieldCheck, Upload } from "lucide-react";

import { FormSkeleton } from "@/components/common/loading";
import { StudentErrorState } from "@/features/student/components";
import { formatDateTime } from "@/features/student/formatters";
import { ManualStep, PasteStep, resumeFileProblem } from "@/features/student/onboarding/components/intake-steps";
import { ParsingStep, type UploadPhase } from "@/features/student/onboarding/components/parsing-step";
import { ReviewStep } from "@/features/student/onboarding/components/review-step";
import { parseFailureMessage } from "@/features/student/onboarding/constants";
import { StudentPage } from "@/features/student/shell";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useCompleteResumeUploadMutation, useCreateResumeUploadMutation, useGetResumeVersionsQuery, useUploadResumeFileMutation, type ManualResume } from "@/store/student";
import { useGetCareerProfileQuery, useLazyGetProfileResumeDocumentQuery } from "./career-api";

type View =
  | { name: "review"; versionId: string }
  | { name: "edit"; versionId: string; resume: ManualResume }
  | { name: "paste" }
  | { name: "parsing"; fileName: string; fileSize: number; phase: UploadPhase; resumeFileId?: string; uploadId?: string; error?: string };

export function ResumeDetails() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const versions = useGetResumeVersionsQuery();
  const profile = useGetCareerProfileQuery();
  const [getDocument, documentState] = useLazyGetProfileResumeDocumentQuery();
  const [createUpload] = useCreateResumeUploadMutation();
  const [uploadFile] = useUploadResumeFileMutation();
  const [completeUpload] = useCompleteResumeUploadMutation();
  const current = useMemo(
    () => versions.data?.find((version) => !version.superseded) ?? versions.data?.[0],
    [versions.data],
  );
  const [view, setView] = useState<View | null>(null);
  const activeView: View | null =
    view ?? (current ? { name: "review", versionId: current.resumeVersionId } : null);

  const openResume = async () => {
    const versionId = profile.data?.resume_version_id ?? current?.resumeVersionId;
    if (!versionId) return;
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const result = await getDocument(versionId).unwrap();
      if (result.url) {
        if (preview) preview.location.href = result.url;
        else window.location.assign(result.url);
      } else {
        preview?.close();
      }
    } catch {
      preview?.close();
    }
  };

  const finishUpload = async (uploadId: string, fileName: string, fileSize: number) => {
    setView({ name: "parsing", fileName, fileSize, phase: "checking" });
    try {
      const accepted = await completeUpload(uploadId).unwrap();
      setView({ name: "parsing", fileName, fileSize, phase: "reading", resumeFileId: accepted.resumeFileId });
    } catch (error) {
      const code = getApiErrorCode(error);
      setView({ name: "parsing", fileName, fileSize, phase: "checking", uploadId, error: code?.startsWith("upload_") || code === "resume_upload_rejected" ? parseFailureMessage(code) : getApiErrorMessage(error, "We could not check your file. Please try again.") });
    }
  };

  const startUpload = async (file: File) => {
    const localProblem = resumeFileProblem(file);
    if (localProblem) {
      setView({ name: "parsing", fileName: file.name, fileSize: file.size, phase: "uploading", error: localProblem });
      return;
    }
    setView({ name: "parsing", fileName: file.name, fileSize: file.size, phase: "uploading" });
    try {
      const ticket = await createUpload().unwrap();
      const problem = resumeFileProblem(file, ticket.maxBytes);
      if (problem) throw new Error(problem);
      await uploadFile({ ticket, file }).unwrap();
      await finishUpload(ticket.uploadId, file.name, file.size);
    } catch (error) {
      setView({ name: "parsing", fileName: file.name, fileSize: file.size, phase: "uploading", error: error instanceof Error ? error.message : getApiErrorMessage(error, "The upload did not finish. Please try again.") });
    }
  };

  return (
    <StudentPage>
      <div className="w-full">
        <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" aria-label="Upload a new resume" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void startUpload(file); }} />
        <button
          type="button"
          onClick={() => router.push("/student/profile")}
          className="mb-5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#E7E0D4] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#3A4761] transition hover:bg-[#F7F4EC] hover:text-[#0A1931]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to profile
        </button>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,720px)_minmax(260px,1fr)] lg:gap-8">
          <main className="min-w-0">
            {versions.isLoading ? (
              <FormSkeleton fields={6} actions />
            ) : versions.isError ? (
              <StudentErrorState
                error={versions.error}
                title="Resume details could not be loaded"
                onRetry={() => void versions.refetch()}
              />
            ) : !current || !activeView ? (
              <div className="rounded-[24px] border border-dashed border-[#CFC6B4] bg-white p-8 text-center sm:p-12">
                <FileText className="mx-auto h-10 w-10 text-[#5F4DB2]" aria-hidden="true" />
                <h1 className="mt-4 text-2xl font-bold text-[#0A1931]">Add your resume</h1>
                <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-[#5F6B80]">
                  Upload, paste, or enter your details to build your student profile and score.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/signup/student")}
                  className="mt-6 cursor-pointer rounded-full bg-[#5F4DB2] px-6 py-3 text-[14px] font-semibold text-white hover:bg-[#4A3E8F]"
                >
                  Add resume
                </button>
              </div>
            ) : activeView.name === "parsing" ? (
              <ParsingStep key={activeView.resumeFileId ?? activeView.fileName} fileName={activeView.fileName} fileSize={activeView.fileSize} phase={activeView.phase} resumeFileId={activeView.resumeFileId} error={activeView.error} onRetry={activeView.uploadId ? () => void finishUpload(activeView.uploadId!, activeView.fileName, activeView.fileSize) : undefined} onReview={(versionId) => { setView({ name: "review", versionId }); void versions.refetch(); }} onTryAnother={() => fileInput.current?.click()} onPaste={() => setView({ name: "paste" })} />
            ) : activeView.name === "paste" ? (
              <PasteStep onBack={() => { if (current) setView({ name: "review", versionId: current.resumeVersionId }); }} onCreated={(versionId) => { setView({ name: "review", versionId }); void versions.refetch(); }} />
            ) : activeView.name === "edit" ? (
              <ManualStep
                initial={activeView.resume}
                editOf={activeView.versionId}
                defaultName={activeView.resume.full_name}
                onBack={() => setView({ name: "review", versionId: activeView.versionId })}
                onCreated={(versionId) => {
                  setView({ name: "review", versionId });
                  void versions.refetch();
                }}
              />
            ) : (
              <div className="flex flex-col gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => fileInput.current?.click()} className="group relative flex min-h-[104px] min-w-0 cursor-pointer items-center gap-4 overflow-hidden rounded-[22px] border border-[#D9D0F5] bg-gradient-to-br from-white via-white to-[#F7F3FF] px-5 py-4 text-left shadow-[0_4px_16px_rgba(58,43,112,0.07)] transition duration-200 hover:-translate-y-0.5 hover:border-[#8D79D8] hover:shadow-[0_10px_24px_rgba(58,43,112,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/40 focus-visible:ring-offset-2 sm:px-6">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#EEE8FA] text-[#5F4DB2] ring-1 ring-inset ring-[#DED5F4] transition group-hover:bg-[#E7DFFA]"><Upload className="h-6 w-6" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[16px] font-bold tracking-[-0.01em] text-[#0A1931]">Upload new resume</span><span className="mt-1 block text-[13px] leading-5 text-[#5F6B80]">Choose a PDF or DOCX file to update your profile</span></span>
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#5F4DB2] text-white shadow-sm transition group-hover:bg-[#4A3E8F]"><ArrowUpRight className="h-5 w-5" aria-hidden="true" /></span>
                  </button>
                  {current && (
                    <button type="button" onClick={() => void openResume()} disabled={documentState.isLoading} className="group flex min-h-[104px] min-w-0 items-center gap-4 rounded-[22px] border border-[#E5DFD4] bg-white px-5 py-4 text-left shadow-[0_3px_12px_rgba(10,25,49,0.045)] transition duration-200 hover:-translate-y-0.5 hover:border-[#C7BCEB] hover:bg-[#FCFAFF] hover:shadow-[0_9px_20px_rgba(58,43,112,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30 focus-visible:ring-offset-2 disabled:opacity-60 sm:px-6">
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#F1EAF7] text-[#5F4DB2] transition group-hover:bg-[#E9E0F5]"><FileText className="h-5 w-5" aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[16px] font-bold tracking-[-0.01em] text-[#0A1931]">{documentState.isLoading ? "Opening resume…" : "Open resume"}</span><span className="mt-1 block text-[13px] leading-5 text-[#5F6B80]">View your current resume file</span></span>
                      <ArrowUpRight className="h-5 w-5 shrink-0 text-[#5F4DB2] transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <ReviewStep key={activeView.versionId} resumeVersionId={activeView.versionId} title="Resume details" subtitle="Review and edit the details extracted from your resume. Changes are saved as a new version." confirmLabel="Save & update score" startOverLabel="Back to profile" onStartOver={() => router.push("/student/profile")} onEditStructured={(resume, versionId) => setView({ name: "edit", versionId, resume })} onConfirmed={() => { showSuccessFeedback("Resume saved and score update started."); void versions.refetch(); }} />
              </div>
            )}
          </main>

          <aside className="hidden lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4">
            <InfoCard
              icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              title="Your resume stays private"
              body="Employers only receive resume information through the access rules of the student portal."
            />
            {current ? (
              <div className="rounded-[20px] border border-[#E7E0D4] bg-[#F7F4EC] p-5">
                <div className="flex items-center gap-2 text-[#3A4761]">
                  <History className="h-4 w-4" aria-hidden="true" />
                  <span className="text-[12px] font-bold uppercase tracking-[0.1em]">Current version</span>
                </div>
                <p className="mt-3 text-[13px] font-semibold text-[#0A1931]">
                  {current.confirmed ? "Confirmed" : "Needs confirmation"}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-[#5F6B80]">Updated {formatDateTime(current.createdAt)}</p>
                {current.confirmed ? (
                  <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#1F6B45]">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Ready for your profile
                  </span>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </StudentPage>
  );
}

function InfoCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-5">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#F1EAF7] text-[#5F4DB2]">{icon}</span>
      <h2 className="mt-4 text-[16px] font-bold text-[#0A1931]">{title}</h2>
      <p className="mt-2 text-[12px] leading-5 text-[#5F6B80]">{body}</p>
    </div>
  );
}
