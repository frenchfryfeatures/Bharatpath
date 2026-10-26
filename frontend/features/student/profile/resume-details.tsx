"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CheckCircle2, FilePenLine, FileText, History, ShieldCheck, Upload } from "lucide-react";

import { FormSkeleton } from "@/components/common/loading";
import { StudentErrorState } from "@/features/student/components";
import { formatDateTime } from "@/features/student/formatters";
import { PasteStep, resumeFileProblem } from "@/features/student/onboarding/components/intake-steps";
import { ParsingStep, type UploadPhase } from "@/features/student/onboarding/components/parsing-step";
import { ReviewStep } from "@/features/student/onboarding/components/review-step";
import { parseFailureMessage } from "@/features/student/onboarding/constants";
import { StudentPage } from "@/features/student/shell";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import { showErrorFeedback, showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useCompleteResumeUploadMutation, useCreateResumeUploadMutation, useGetBuilderDraftQuery, useGetResumeFilesQuery, useGetResumeScoringWindowQuery, useGetResumeVersionsQuery, useUploadResumeFileMutation, type ResumeScoringWindow } from "@/store/student";
import { useGetCareerProfileQuery, useLazyGetProfileResumeDocumentQuery } from "./career-api";
import { ResumeTemplateDialog } from "./resume-template-dialog";

type View =
  | { name: "review"; versionId: string }
  | { name: "paste" }
  | { name: "parsing"; fileName: string; fileSize: number; phase: UploadPhase; resumeFileId?: string; uploadId?: string; error?: string };

export function ResumeDetails() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const versions = useGetResumeVersionsQuery();
  const builderDraft = useGetBuilderDraftQuery();
  const profile = useGetCareerProfileQuery();
  const [getDocument, documentState] = useLazyGetProfileResumeDocumentQuery();
  const [createUpload] = useCreateResumeUploadMutation();
  const [uploadFile] = useUploadResumeFileMutation();
  const [completeUpload] = useCompleteResumeUploadMutation();
  const current = useMemo(
    // The server says which version is current; confirmed && !superseded can match two after a builder push.
    () => versions.data?.find((version) => version.current) ?? versions.data?.[0],
    [versions.data],
  );
  const scoringWindow = useGetResumeScoringWindowQuery(undefined, { skip: !current?.confirmed });
  const [view, setView] = useState<View | null>(null);
  const [resumeTemplatePromptOpen, setResumeTemplatePromptOpen] = useState(false);
  const activeView: View | null =
    view ?? (current ? { name: "review", versionId: current.resumeVersionId } : null);
  const selectedFromHistory = view?.name === "review" && view.versionId !== current?.resumeVersionId;
  const selectedVersion = activeView?.name === "review"
    ? versions.data?.find((version) => version.resumeVersionId === activeView.versionId)
    : undefined;

  const cancelUpdate = () => {
    setView(null);
  };

  const openResume = async () => {
    const versionId = current?.resumeVersionId ?? profile.data?.resume_version_id;
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
        showErrorFeedback("Your resume file isn't available to open right now. Try uploading it again.");
      }
    } catch (error) {
      preview?.close();
      showErrorFeedback(getApiErrorMessage(error, "We couldn't open your resume. Please try again."));
    }
  };

  const finishUpload = async (uploadId: string, fileName: string, fileSize: number) => {
    setView({ name: "parsing", fileName, fileSize, phase: "checking" });
    try {
      const accepted = await completeUpload({ uploadId, filename: fileName }).unwrap();
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
          onClick={() => router.push("/student/profile#profile-reports")}
          className="mb-3 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1.5 text-[12px] font-semibold text-[#677188] transition-colors hover:bg-[#F0ECF6] hover:text-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to profile
        </button>

        <div className={`grid items-start gap-6 ${activeView?.name === "parsing" ? "grid-cols-1" : "lg:grid-cols-[minmax(0,720px)_minmax(260px,1fr)] lg:gap-8"}`}>
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
              <ParsingStep key={activeView.resumeFileId ?? activeView.fileName} fileName={activeView.fileName} fileSize={activeView.fileSize} phase={activeView.phase} resumeFileId={activeView.resumeFileId} error={activeView.error} onRetry={activeView.uploadId ? () => void finishUpload(activeView.uploadId!, activeView.fileName, activeView.fileSize) : undefined} onReview={(versionId) => { setView({ name: "review", versionId }); void versions.refetch(); }} onTryAnother={() => fileInput.current?.click()} onPaste={() => setView({ name: "paste" })} onCancel={cancelUpdate} />
            ) : activeView.name === "paste" ? (
              <PasteStep onBack={() => { if (current) setView({ name: "review", versionId: current.resumeVersionId }); }} onCreated={(versionId) => { setView({ name: "review", versionId }); void versions.refetch(); }} />
            ) : (
              <div className="flex flex-col gap-4">
                <section aria-label="Resume workspace" className="relative border-b border-[#E6DFEE] pb-4 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4">
                  <header className="min-w-0 flex-1 border-l-[3px] border-[#7B61C5] pl-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                                            <div className="min-w-0">
                        <h1 className="text-[22px] font-bold leading-7 tracking-[-0.035em] text-[#0A1931]">Your resume</h1>

                      </div>
                    </div>
                    {!selectedFromHistory && (
                    <span className={`mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium ${current.confirmed ? "text-[#1F6B45]" : "text-[#85650F]"}`}>
                      {current.confirmed && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      {current.confirmed ? "Profile ready" : "Needs confirmation"}
                    </span>
                    )}
                  </header>
                  <div role="group" aria-label="Resume actions" className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
                    <button type="button" onClick={() => setResumeTemplatePromptOpen(true)} className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[#D9CFF0] bg-[#EEE7FA] py-2 pl-3.5 pr-4 text-[12px] font-semibold text-[#5B42A3] transition-colors hover:border-[#BBA8DF] hover:bg-[#E4D8F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2] focus-visible:ring-offset-2 sm:flex-none">
                      <FilePenLine className="h-4 w-4 text-[#7154B5]" aria-hidden="true" /> Build resume
                    </button>
                    <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[12px] font-semibold text-[#3A3156] transition-colors hover:bg-[#EEE8F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2] focus-visible:ring-offset-2 sm:flex-none">
                      <Upload className="h-4 w-4 text-[#75639E]" aria-hidden="true" /> Upload new
                    </button>
                    <button type="button" onClick={() => void openResume()} disabled={documentState.isLoading} aria-busy={documentState.isLoading} className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold text-[#5F4DB2] transition-colors hover:bg-[#EEE8F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:ml-auto sm:flex-none">
                      {documentState.isLoading ? "Opening..." : "Open resume"}<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  </div>
                  {builderDraft.data && !builderDraft.data.pushed_is_current && (
                    <div role="status" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[#796A92]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#A28ABD]" aria-hidden="true" />
                      <p className="text-[11px] leading-5 text-[#796A92]">Draft changes waiting</p>
                      <button type="button" onClick={() => router.push("/student/profile/resume/edit?from=resume-details")} className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[11px] font-semibold text-[#5F4DB2] underline decoration-[#CABCE4] underline-offset-4 transition-colors hover:bg-[#EEE8F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A47B35] focus-visible:ring-offset-2">
                        Review draft <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </section>
                {selectedFromHistory && <div role="status" className="flex items-start gap-3 rounded-[18px] border border-[#D9D0F5] bg-[#F8F5FF] px-4 py-3 text-[#3A4761]">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-[#5F4DB2]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="break-words text-[13px] font-semibold text-[#0A1931]">Viewing: {selectedVersion?.filename || "Saved resume"}</p>
                    <p className="mt-1 text-[12px] leading-5">{selectedVersion ? `Version from ${formatDateTime(selectedVersion.createdAt)}. ` : ""}Save this resume to use it for your profile. Its score updates only when you are eligible.</p>
                  </div>
                </div>}
                <ReviewStep key={activeView.versionId} resumeVersionId={activeView.versionId} title="Your details" subtitle="Review each section and use the edit button to update it. Changes are saved as a new version." confirmLabel="Save & update score" startOverLabel="Cancel and return to previous resume" restoreFromHistory={selectedFromHistory} onStartOver={cancelUpdate} onConfirmed={() => { showSuccessFeedback("Resume saved and score update started."); setView(null); void versions.refetch(); }} />
              </div>
            )}
          </main>

          <aside className={`${activeView?.name === "parsing" ? "hidden" : "hidden lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col lg:gap-4 lg:overflow-y-auto lg:pb-28"}`}>
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
                  <>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#1F6B45]">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Ready for your profile
                    </span>
                    <ResumeScoreStatus window={scoringWindow.data} loading={scoringWindow.isLoading} error={scoringWindow.isError} />
                  </>
                ) : null}
              </div>
            ) : null}
            <ResumeHistory selectedVersionId={activeView?.name === "review" ? activeView.versionId : undefined} currentVersionId={current?.resumeVersionId} onOpen={(versionId) => setView({ name: "review", versionId })} />
          </aside>
        </div>
      </div>
      <ResumeTemplateDialog
        open={resumeTemplatePromptOpen}
        onClose={() => setResumeTemplatePromptOpen(false)}
        onKeep={() => { setResumeTemplatePromptOpen(false); router.replace("/student/profile/resume/edit?template=keep&from=resume-details"); }}
        onTemplateSelected={(template) => { setResumeTemplatePromptOpen(false); router.replace(`/student/profile/resume/edit?template=${template}&from=resume-details`); }}
      />
    </StudentPage>
  );
}

const HISTORY_PREVIEW = 3;

function ResumeScoreStatus({ window, loading, error }: { window?: ResumeScoringWindow; loading: boolean; error: boolean }) {
  if (loading) return <p className="mt-3 text-[11px] leading-5 text-[#5F6B80]">Checking when you can refresh your resume score…</p>;
  if (error || !window) return null;
  if (window.intervalDays === 0 || window.canConfirmNow) return <p className="mt-3 text-[11px] leading-5 text-[#5F6B80]">Your score is calculated from this resume. You can refresh it now by confirming an updated resume.</p>;
  if (!window.nextScoringAt) return <p className="mt-3 text-[11px] leading-5 text-[#5F6B80]">Your score is calculated from this resume. Score refresh is temporarily unavailable.</p>;
  return <p className="mt-3 text-[11px] leading-5 text-[#5F6B80]">Your score is calculated from this resume. You can refresh it again on {formatScoreRefreshTime(window.nextScoringAt)} ({timeUntil(window.nextScoringAt)}).</p>;
}

function formatScoreRefreshTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  }).format(date)} IST`;
}

function timeUntil(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "later";
  const milliseconds = Math.max(0, date.getTime() - Date.now());
  const days = Math.floor(milliseconds / 86_400_000);
  const hours = Math.ceil((milliseconds % 86_400_000) / 3_600_000);
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ${hours ? `and ${hours} ${hours === 1 ? "hour" : "hours"} ` : ""}remaining`.trim();
  return `${Math.max(1, hours)} ${hours === 1 ? "hour" : "hours"} remaining`;
}

/** One row per uploaded file, from GET /candidate/resume/files. */
function ResumeHistory({ onOpen, selectedVersionId, currentVersionId }: { onOpen: (versionId: string) => void; selectedVersionId?: string; currentVersionId?: string }) {
  const files = useGetResumeFilesQuery();
  const [showAll, setShowAll] = useState(false);
  if (!files.data?.length) return null;
  const rows = showAll ? files.data : files.data.slice(0, HISTORY_PREVIEW);
  return (
    <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-5">
      <div className="flex items-center gap-2 text-[#3A4761]">
        <History className="h-4 w-4" aria-hidden="true" />
        <span className="text-[12px] font-bold uppercase tracking-[0.1em]">Resume history</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((file, index) => (
          <li key={file.resumeFileId ?? `${file.name}-${index}`} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${file.latestVersionId === selectedVersionId || (file.current && selectedVersionId === currentVersionId) ? "border-[#8D79D8] bg-[#F1EAF7]" : "border-transparent bg-[#F7F4EC]"}`}>
            <FileText className="h-4 w-4 shrink-0 text-[#5F4DB2]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[#0A1931]">{file.name}</p>
              <p className="text-[11px] text-[#5F6B80]">{[file.status && file.status.toLowerCase().replace(/_/g, " "), file.uploadedAt && formatDateTime(file.uploadedAt)].filter(Boolean).join(" · ")}</p>
            </div>
            {file.current && <span className="rounded-full bg-[#E8F4EA] px-2 py-0.5 text-[10px] font-semibold text-[#1F6B45]">Current</span>}
            {(file.latestVersionId === selectedVersionId || (file.current && selectedVersionId === currentVersionId)) ? (
              <span className="rounded-full bg-[#E8E1FA] px-2 py-0.5 text-[10px] font-semibold text-[#5F4DB2]">Viewing</span>
            ) : file.latestVersionId ? (
              <button type="button" onClick={() => onOpen(file.latestVersionId!)} className="text-[11px] font-semibold text-[#5F4DB2] underline">View</button>
            ) : null}
          </li>
        ))}
      </ul>
      {files.data.length > HISTORY_PREVIEW && (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-3 text-[12px] font-semibold text-[#5F4DB2] underline">
          {showAll ? "Show less" : `Show all (${files.data.length})`}
        </button>
      )}
    </div>
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
