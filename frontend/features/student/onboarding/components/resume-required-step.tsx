"use client";

import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, FilePenLine, Loader2, ShieldCheck, Upload } from "lucide-react";

import { StudentBackButton } from "@/features/student/components/student-back-button";
import { RESUME_MAX_BYTES, resumeFileProblem } from "./intake-steps";
import { ErrorNote, StepHeader } from "./ui";

/**
 * Shown after the last onboarding step when no resume file is on record:
 * scoring reads a resume, so one is needed before the profile can finish.
 */
export function ResumeRequiredStep({
  busy,
  error,
  onFile,
  onBack,
  onGenerate,
}: {
  busy: boolean;
  error?: string;
  onFile: (file: File) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const shown = fileError ?? error ?? null;

  const accept = (file: File | undefined) => {
    if (!file || busy) return;
    const problem = resumeFileProblem(file);
    setFileError(problem);
    if (!problem) onFile(file);
  };

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        title="One last thing: your resume"
        subtitle="Your details are saved. Upload your resume so we can score your profile."
      />

      {shown && <ErrorNote>{shown}</ErrorNote>}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        aria-label="Choose your resume file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          accept(file);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col gap-4 rounded-[20px] border-0 bg-[#5E4DB2] p-5 text-left transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-90 sm:p-6 ${
          dragging ? "ring-4 ring-[#5F4DB2]/30" : ""
        }`}
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#4A3E8F]">
          {busy ? (
            <Loader2 className="h-[21px] w-[21px] animate-spin text-[#FFFCF7]" aria-hidden="true" />
          ) : (
            <Upload className="h-[21px] w-[21px] text-[#FFFCF7]" aria-hidden="true" />
          )}
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-[22px] font-bold leading-[26px] tracking-[-0.02em] text-white">
            {busy ? "Uploading your resume…" : "Upload your resume"}
          </span>
          <span className="text-[14px] leading-5 text-[#E0DBF4]">
            {busy ? "This only takes a moment." : <>Choose a file{" "}<span className="hidden sm:inline">or drop it here.</span></>}
          </span>
        </span>
        <span className="flex w-full items-center gap-2.5 border-t border-[rgba(255,252,247,0.28)] pt-3.5">
          <span className="flex-1 text-[11px] font-bold tracking-[0.1em] text-[#E0DBF4]">
            PDF · DOCX · UP TO {Math.round(RESUME_MAX_BYTES / (1024 * 1024))} MB
          </span>
          <ArrowRight className="h-4 w-4 text-[#FFFCF7]" aria-hidden="true" />
        </span>
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onGenerate}
        className="flex items-center gap-4 rounded-[20px] border border-[#DDD6C7] bg-white p-5 text-left transition hover:border-[#5F4DB2] hover:bg-[#F8F5FF] active:scale-[0.99] disabled:opacity-60"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#5F4DB2]">
          <FilePenLine className="h-[21px] w-[21px] text-[#FFFCF7]" aria-hidden="true" />
        </span>
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-[17px] font-bold text-[#0A1931]">Generate a resume instead</span>
          <span className="text-[13px] leading-5 text-[#3A4761]">
            No file? We build one from your answers. Edit it, add projects, preview and download it.
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-[#5F4DB2]" aria-hidden="true" />
      </button>

      <ul className="grid gap-3 rounded-2xl border border-[#EFE9DB] bg-white p-4 text-[13px] text-[#3A4761]">
        <li className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5F4DB2]" aria-hidden="true" />
          Your profile answers stay saved while you upload.
        </li>
        <li className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#5F4DB2]" aria-hidden="true" />
          Employers only see your resume through the access rules of the student portal.
        </li>
      </ul>

      <div className="mt-1">
        <StudentBackButton onClick={onBack} disabled={busy} />
      </div>
    </div>
  );
}
